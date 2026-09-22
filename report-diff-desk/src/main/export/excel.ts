import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readFile } from 'fs/promises'
import { read as readXlsx, utils as xlsxUtils } from 'xlsx'
import type { BatchCompareResult, CellDiff, CompareResult, SheetData } from '@shared/types'
import { parseExcel } from '../file/excel'
import { patchXlsHits, type XlsHit } from './xls-patch'

/** 变动格紫色填充（ARGB，浅紫） */
export const PURPLE_FILL_ARG = 'FFE6E0F8'
const PURPLE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_FILL_ARG } }

/**
 * .xls（BIFF8）能带过去的排版信息。
 * 字体、居中、边框在开源 SheetJS 社区版里读不到（`cell.s` 是 undefined），只能给到这四样。
 */
interface XlsLayout {
  /** 列宽（字符数），下标对齐列号 */
  colWidths: (number | undefined)[]
  /** 行高（磅），下标对齐「行号 - 1」 */
  rowHeights: (number | undefined)[]
  /** 数值格式：`"行|列"`（0 起始）→ Excel 格式串，如 `0.0000_` */
  formats: Map<string, string>
}

const EMPTY_LAYOUT: XlsLayout = { colWidths: [], rowHeights: [], formats: new Map() }

/** 用 SheetJS 读 .xls 的排版信息（值仍走 parseExcel，保证与比对口径一致） */
function readXlsLayout(buffer: Buffer): Map<string, XlsLayout> {
  const wb = readXlsx(buffer, { type: 'buffer', cellNF: true })
  const out = new Map<string, XlsLayout>()
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const colWidths = (ws['!cols'] ?? []).map((c) => c?.wch ?? c?.width)
    const rowHeights = (ws['!rows'] ?? []).map(
      (r) => r?.hpt ?? (r?.hpx === undefined ? undefined : r.hpx * 0.75)
    )
    const formats = new Map<string, string>()
    const ref = ws['!ref']
    if (ref) {
      const range = xlsxUtils.decode_range(ref)
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const z = ws[xlsxUtils.encode_cell({ r, c })]?.z
          if (typeof z === 'string' && z !== '' && z !== 'General') formats.set(`${r}|${c}`, z)
        }
      }
    }
    out.set(name, { colWidths, rowHeights, formats })
  }
  return out
}

/**
 * 按 zip 条目顺序（与顺序配对语义一致）读取全部 xlsx/xls 原始 buffer；
 * 非 zip 单文件返回自身 buffer。
 */
async function readSourceBuffers(path: string): Promise<Buffer[]> {
  const buf = await readFile(path)
  if (!/\.zip$/i.test(path)) return [buf]
  const zip = await JSZip.loadAsync(buf)
  const out: Buffer[] = []
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(xlsx|xls)$/i.test(entry.name)) continue
    out.push(Buffer.from(await entry.async('uint8array')))
  }
  return out
}

/** xlsx：exceljs 读取保留原样式；.xls：exceljs 不支持 biff8，降级为 SheetJS 解析值 + 能读到的排版 */
type XlsSheet = { data: SheetData; layout: XlsLayout }
type ExportSource = { kind: 'xlsx'; wb: ExcelJS.Workbook } | { kind: 'xls'; sheets: XlsSheet[] }

async function loadSource(buffer: Buffer): Promise<ExportSource> {
  // exceljs 的 d.ts 声明了局部 Buffer 接口遮蔽全局 Node Buffer，需按形参类型断言
  const data = buffer as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0]
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(data)
    // biff8 老格式：exceljs load 不抛错但解析出 0 个 sheet，须降级
    if (wb.worksheets.length > 0) return { kind: 'xlsx', wb }
  } catch {
    // 非 xlsx 输入：降级
  }
  const parsed = parseExcel(buffer, 'legacy.xls', 'file')
  const layouts = readXlsLayout(buffer)
  return {
    kind: 'xls',
    sheets: parsed.sheetNames.map((n) => ({
      data: parsed.sheets[n],
      layout: layouts.get(n) ?? EMPTY_LAYOUT
    }))
  }
}

/** diff → 某侧需标紫的 `sheet(trim)|r|c` 集合；该侧无值的格（new 的上期侧 / removed 的本期侧）不标 */
function hitMap(diffs: CellDiff[], side: 'base' | 'curr'): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const d of diffs) {
    const v = side === 'base' ? d.prevValue : d.currValue
    if (v === null) continue
    const key = d.sheet.trim()
    const set = m.get(key) ?? new Set<string>()
    set.add(`${d.row}|${d.col}`)
    m.set(key, set)
  }
  return m
}

/** 单 sheet 文件直接命名为「上期/本期」；多 sheet 加前缀避免两侧重名冲突 */
function outSheetName(prefix: '上期' | '本期', name: string, singleSheetFile: boolean): string {
  return singleSheetFile ? prefix : `${prefix}_${name}`.slice(0, 31)
}

/** 给命中格填充紫色 */
function markHits(cellAt: (r: number, c: number) => ExcelJS.Cell, sheetName: string, hits: Map<string, Set<string>>): void {
  const set = hits.get(sheetName.trim())
  if (!set) return
  for (const rc of set) {
    const [r, c] = rc.split('|').map(Number)
    cellAt(r, c).fill = PURPLE_FILL
  }
}

/** xlsx 路径：model 拷贝（保留字体/填充/列宽/合并）后标紫 */
function copyXlsxSheet(dst: ExcelJS.Workbook, src: ExcelJS.Worksheet, outName: string, hits: Map<string, Set<string>>): void {
  const ws = dst.addWorksheet(outName)
  const model = src.model
  model.name = outName // model 内嵌原 sheet 名，setter 会覆盖目标名导致重名冲突
  ws.model = model
  // exceljs 的 model setter 不解析 merges 字段，需手动重建
  for (const m of model.merges ?? []) ws.mergeCells(m)
  markHits((r, c) => ws.getCell(r, c), src.name, hits)
}

/**
 * .xls 降级路径：按值 + 合并重建，再尽量贴回列宽/行高/数值格式（字体、居中、边框读不到）后标紫。
 * 数值格式必须带：原始 0.1060 若丢了格式会显示成 0.106。
 */
function rebuildSheet(dst: ExcelJS.Workbook, sheet: XlsSheet, outName: string, hits: Map<string, Set<string>>): void {
  const { data, layout } = sheet
  const ws = dst.addWorksheet(outName)
  data.cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell && cell.v !== null) ws.getCell(r + 1, c + 1).value = cell.v
    })
  })
  layout.colWidths.forEach((w, i) => {
    if (w) ws.getColumn(i + 1).width = w
  })
  layout.rowHeights.forEach((h, i) => {
    if (h) ws.getRow(i + 1).height = h
  })
  for (const [rc, z] of layout.formats) {
    const [r, c] = rc.split('|').map(Number)
    const cell = ws.getCell(r + 1, c + 1)
    if (cell.value !== null && cell.value !== undefined) cell.numFmt = z
  }
  for (const m of data.merges ?? []) ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1)
  markHits((r, c) => ws.getCell(r, c), data.name, hits)
}

/** 把一侧工作簿的全部 sheet 拷入目标（sheet 名按单/多 sheet 规则），并标紫 */
function appendSourceSheets(dst: ExcelJS.Workbook, src: ExportSource, prefix: '上期' | '本期', hits: Map<string, Set<string>>): void {
  if (src.kind === 'xlsx') {
    const single = src.wb.worksheets.length === 1
    for (const ws of src.wb.worksheets) copyXlsxSheet(dst, ws, outSheetName(prefix, ws.name, single), hits)
  } else {
    const single = src.sheets.length === 1
    for (const s of src.sheets) rebuildSheet(dst, s, outSheetName(prefix, s.data.name, single), hits)
  }
}

async function appendPair(dst: ExcelJS.Workbook, compare: CompareResult, baseBuf: Buffer, currBuf: Buffer): Promise<void> {
  const [baseSrc, currSrc] = await Promise.all([loadSource(baseBuf), loadSource(currBuf)])
  appendSourceSheets(dst, baseSrc, '上期', hitMap(compare.diffs, 'base'))
  appendSourceSheets(dst, currSrc, '本期', hitMap(compare.diffs, 'curr'))
}

/** OLE2（.xls）文件头 —— 比扩展名可靠 */
function isOle2(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0
}

/**
 * 命中格 → patchXlsHits 要的入参。
 * CellDiff 的行列是 1 起始（同 `ref:"C12"`），BIFF 记录里是 0 起始，这里统一减 1。
 */
function xlsHits(compare: CompareResult, side: 'base' | 'curr'): XlsHit[] {
  const out: XlsHit[] = []
  for (const [sheet, set] of hitMap(compare.diffs, side)) {
    for (const rc of set) {
      const [row, col] = rc.split('|').map(Number)
      out.push({ sheet, row: row - 1, col: col - 1 })
    }
  }
  return out
}

/** 条目名：只取文件名部分，不改扩展名 */
function entryNameOf(fileName: string): string {
  return fileName.split('/').pop() ?? fileName
}

/**
 * 批量比对 → zip 压缩包。
 * - 两侧都是 .xls：**就地打标**（保持 .xls 与原格式），每对输出上期/本期两个文件，文件名不变
 * - 其余（.xlsx 源）：每个文件对一个 xlsx（条目名 = 上期原文件名），内含「上期」「本期」两个 sheet
 * 返回值里的 note 由调用方展示给用户（.xls 的紫色是调色板近似色等）。
 */
export async function buildExcelZipBuffer(
  batch: BatchCompareResult,
  basePath: string,
  currPath: string
): Promise<{ buffer: Buffer; note?: string }> {
  const baseBufs = await readSourceBuffers(basePath)
  const currBufs = await readSourceBuffers(currPath)
  if (baseBufs.length < batch.pairs.length || currBufs.length < batch.pairs.length) {
    throw new Error('原文件与比对结果不一致（文件可能已被修改），请重新加载后再导出')
  }

  const zip = new JSZip()
  let patched = 0
  const fallbacks: string[] = []
  for (let i = 0; i < batch.pairs.length; i++) {
    const p = batch.pairs[i]
    if (isOle2(baseBufs[i]) && isOle2(currBufs[i])) {
      try {
        zip.file(entryNameOf(p.baseFileName), patchXlsHits(baseBufs[i], xlsHits(p.compare, 'base')))
        zip.file(entryNameOf(p.currFileName), patchXlsHits(currBufs[i], xlsHits(p.compare, 'curr')))
        patched++
        continue
      } catch (err) {
        fallbacks.push(err instanceof Error ? err.message : String(err))
      }
    } else if (isOle2(baseBufs[i]) || isOle2(currBufs[i])) {
      fallbacks.push('两侧格式不一致')
    }
    const out = new ExcelJS.Workbook()
    await appendPair(out, p.compare, baseBufs[i], currBufs[i])
    // 导出内容统一为 xlsx（含 .xls 降级重建），扩展名必须与内容一致
    const name = entryNameOf(p.baseFileName).replace(/\.xls$/i, '.xlsx')
    zip.file(name, Buffer.from(await out.xlsx.writeBuffer()))
  }

  const notes: string[] = []
  if (patched > 0) {
    notes.push(
      `.xls 源已在原文件上就地打标：保持 .xls 与原表格式（字体/居中/边框/列宽/行高/合并全不动），每对输出上期、本期两个文件。` +
        'BIFF8 只能用调色板色，紫色取的是最接近的 CCCCFF。'
    )
  }
  if (fallbacks.length > 0) {
    notes.push(
      `有 ${fallbacks.length} 个文件无法就地打标（${fallbacks[0]}），已退回重建 xlsx：该文件的字体、居中、边框会丢失。`
    )
  }
  return {
    buffer: Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })),
    note: notes.length > 0 ? notes.join(' ') : undefined
  }
}
