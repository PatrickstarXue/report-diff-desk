import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readFile } from 'fs/promises'
import type { BatchCompareResult, CellDiff, CompareResult, SheetData } from '@shared/types'
import { parseExcel } from '../file/excel'

/** 变动格紫色填充（ARGB，浅紫） */
export const PURPLE_FILL_ARG = 'FFE6E0F8'
const PURPLE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_FILL_ARG } }

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

/** xlsx：exceljs 读取保留原样式；.xls：exceljs 不支持 biff8，降级为 SheetJS 解析值 */
type ExportSource = { kind: 'xlsx'; wb: ExcelJS.Workbook } | { kind: 'xls'; sheets: SheetData[] }

async function loadSource(buffer: Buffer): Promise<ExportSource> {
  // exceljs 的 d.ts 声明了局部 Buffer 接口遮蔽全局 Node Buffer，需按形参类型断言
  const data = buffer as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0]
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(data)
    return { kind: 'xlsx', wb }
  } catch {
    const parsed = parseExcel(buffer, 'legacy.xls', 'file')
    return { kind: 'xls', sheets: parsed.sheetNames.map((n) => parsed.sheets[n]) }
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

/** .xls 降级路径：按值+合并重建（无原字体样式）后标紫 */
function rebuildSheet(dst: ExcelJS.Workbook, data: SheetData, outName: string, hits: Map<string, Set<string>>): void {
  const ws = dst.addWorksheet(outName)
  data.cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell && cell.v !== null) ws.getCell(r + 1, c + 1).value = cell.v
    })
  })
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
    for (const data of src.sheets) rebuildSheet(dst, data, outSheetName(prefix, data.name, single), hits)
  }
}

async function appendPair(dst: ExcelJS.Workbook, compare: CompareResult, baseBuf: Buffer, currBuf: Buffer): Promise<void> {
  const [baseSrc, currSrc] = await Promise.all([loadSource(baseBuf), loadSource(currBuf)])
  appendSourceSheets(dst, baseSrc, '上期', hitMap(compare.diffs, 'base'))
  appendSourceSheets(dst, currSrc, '本期', hitMap(compare.diffs, 'curr'))
}

/**
 * 批量比对 → zip 压缩包：每个文件对一个 xlsx（条目名 = 上期原文件名），
 * 内含「上期」「本期」两个 sheet（按原表格式 + 变动格紫色填充）。
 */
export async function buildExcelZipBuffer(
  batch: BatchCompareResult,
  basePath: string,
  currPath: string
): Promise<Buffer> {
  const baseBufs = await readSourceBuffers(basePath)
  const currBufs = await readSourceBuffers(currPath)
  if (baseBufs.length < batch.pairs.length || currBufs.length < batch.pairs.length) {
    throw new Error('原文件与比对结果不一致（文件可能已被修改），请重新加载后再导出')
  }

  const zip = new JSZip()
  for (let i = 0; i < batch.pairs.length; i++) {
    const p = batch.pairs[i]
    const out = new ExcelJS.Workbook()
    await appendPair(out, p.compare, baseBufs[i], currBufs[i])
    const entryName = p.baseFileName.split('/').pop() ?? p.baseFileName
    zip.file(entryName, Buffer.from(await out.xlsx.writeBuffer()))
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}
