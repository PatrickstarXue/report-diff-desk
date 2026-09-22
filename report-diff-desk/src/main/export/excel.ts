import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readFile } from 'fs/promises'
import { read as readXlsx, utils as xlsxUtils } from 'xlsx'
import type { BatchCompareResult, CellDiff, CompareResult, SheetData } from '@shared/types'
import { parseExcel } from '../file/excel'
import { convertXlsToXlsx, detectWps } from './wps'

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

/** 源文件条目：名字用来判断扩展名（WPS 按扩展名选解析器，导出条目名也由它推导） */
interface SourceEntry {
  name: string
  buffer: Buffer
}

/**
 * 按 zip 条目顺序（与顺序配对语义一致）读取全部 xlsx/xls 原始 buffer；
 * 非 zip 单文件返回自身 buffer。
 */
async function readSourceBuffers(path: string): Promise<SourceEntry[]> {
  const buf = await readFile(path)
  if (!/\.zip$/i.test(path)) return [{ name: path.split(/[\\/]/).pop() ?? path, buffer: buf }]
  const zip = await JSZip.loadAsync(buf)
  const out: SourceEntry[] = []
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(xlsx|xls)$/i.test(entry.name)) continue
    out.push({ name: entry.name, buffer: Buffer.from(await entry.async('uint8array')) })
  }
  return out
}

const isXlsEntry = (e: SourceEntry): boolean => /\.xls$/i.test(e.name)

/**
 * 把两侧的 .xls 条目就地换成 WPS 转出来的 .xlsx。一次 COM 会话处理全部，避免多次 WPS 启动开销。
 * 转换失败时调用方会退回内置重建路径（那条路会如实告知字体/居中/边框无法保留）。
 */
async function convertXlsEntries(base: SourceEntry[], curr: SourceEntry[]): Promise<void> {
  const xlsBase = base.filter(isXlsEntry)
  const xlsCurr = curr.filter(isXlsEntry)
  const converted = await convertXlsToXlsx([...xlsBase, ...xlsCurr].map((e) => e.buffer))
  const apply = (list: SourceEntry[], from: number): void => {
    let n = from
    for (const entry of list) {
      if (!isXlsEntry(entry)) continue
      entry.buffer = converted[n++]
      entry.name = entry.name.replace(/\.xls$/i, '.xlsx')
    }
  }
  apply(base, 0)
  apply(curr, xlsBase.length)
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
    const cell = cellAt(r, c)
    // exceljs 的 Cell.model setter 按引用接管 style（实测 701 个非空格只对应 27 个 style 对象），
    // 而这些引用又是从源表 model 直接搬过来的，直接写 cell.fill 会把所有共用该样式的格子一起染紫。
    // 先换成一个属于本格的 style 对象再写。
    cell.style = { ...cell.style, fill: PURPLE_FILL }
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

async function appendPair(dst: ExcelJS.Workbook, compare: CompareResult, baseBuf: Buffer, currBuf: Buffer): Promise<boolean> {
  const [baseSrc, currSrc] = await Promise.all([loadSource(baseBuf), loadSource(currBuf)])
  appendSourceSheets(dst, baseSrc, '上期', hitMap(compare.diffs, 'base'))
  appendSourceSheets(dst, currSrc, '本期', hitMap(compare.diffs, 'curr'))
  return baseSrc.kind === 'xls' || currSrc.kind === 'xls'
}

/**
 * 批量比对 → zip 压缩包：每个文件对一个 xlsx（条目名 = 上期原文件名），
 * 内含「上期」「本期」两个 sheet（按原表格式 + 变动格紫色填充）。
 *
 * .xls 源先用本机 WPS/Excel 转成 .xlsx（见 wps.ts），之后与 .xlsx 源走同一条完整保真的路径；
 * 没有 WPS 或转换失败时退回「重建」——exceljs 读不了 biff8、BIFF8 也写不出来，
 * 那条路字体/居中/边框保留不了，note 里如实说明。
 *
 * @param opts.useWps 缺席 = 自动（有 .xls 源且检测到 WPS 时启用）；false = 强制走重建路径；true = 强制尝试转换
 */
export async function buildExcelZipBuffer(
  batch: BatchCompareResult,
  basePath: string,
  currPath: string,
  opts?: { useWps?: boolean }
): Promise<{ buffer: Buffer; note?: string }> {
  const baseEntries = await readSourceBuffers(basePath)
  const currEntries = await readSourceBuffers(currPath)
  if (baseEntries.length < batch.pairs.length || currEntries.length < batch.pairs.length) {
    throw new Error('原文件与比对结果不一致（文件可能已被修改），请重新加载后再导出')
  }

  if (opts?.useWps !== false && (baseEntries.some(isXlsEntry) || currEntries.some(isXlsEntry))) {
    if (opts?.useWps === true || (await detectWps())) {
      try {
        await convertXlsEntries(baseEntries, currEntries)
      } catch {
        // 保真转换失败就按原样走重建路径，note 会如实告知字体/居中/边框无法保留
      }
    }
  }

  let usedXls = false
  const zip = new JSZip()
  for (let i = 0; i < batch.pairs.length; i++) {
    const p = batch.pairs[i]
    const out = new ExcelJS.Workbook()
    if (await appendPair(out, p.compare, baseEntries[i].buffer, currEntries[i].buffer)) usedXls = true
    // 导出内容统一为 xlsx（含 .xls 降级重建），扩展名必须与内容一致
    const entryName = (p.baseFileName.split('/').pop() ?? p.baseFileName).replace(/\.xls$/i, '.xlsx')
    zip.file(entryName, Buffer.from(await out.xlsx.writeBuffer()))
  }
  return {
    buffer: Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })),
    note: usedXls
      ? '源文件里有 .xls：老格式的字体、居中、边框无法保留（数值格式、列宽、行高、合并已尽量带上）。' +
        '把源另存为 .xlsx 再上传，导出就是一个文件两个 sheet 且与原表一致。'
      : undefined
  }
}
