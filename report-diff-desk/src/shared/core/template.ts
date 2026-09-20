import type { AlignConfig, CellRange, SheetData, TemplateCellRef, TemplateSheet, WorkbookData } from '../types'
import { buildMergeSpans } from './merge'
import { toNumeric } from './numeric'

/** 标签文本归一化：去首尾空白，内部连续空白压成单个空格 */
export function normLabel(s: unknown): string {
  return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim()
}

/** 表样键：zip 条目名取最后一段、去扩展名 */
export function templateKeyOf(fileName: string): string {
  return (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.(xlsx|xls)$/i, '')
}

/** 表号：整段匹配 字母+数字，失败再匹配名字开头；都失败返回 null（交给人工配对） */
export function tableNoOf(fileName: string): string | null {
  const base = templateKeyOf(fileName)
  const m = /^([A-Za-z]+)(\d+)$/.exec(base) ?? /^([A-Za-z]+)(\d+)/.exec(base)
  return m ? m[2].replace(/^0+(?=\d)/, '') : null
}

/** 合并填充后的标签矩阵：合并区域内所有格取主格归一化文本，其余取自身文本 */
function mergedLabelMatrix(sheet: SheetData): string[][] {
  const { rowCount, colCount } = sheet
  const m: string[][] = Array.from({ length: rowCount }, () => Array<string>(colCount).fill(''))
  const filled: boolean[][] = Array.from({ length: rowCount }, () =>
    Array<boolean>(colCount).fill(false)
  )
  for (const mg of sheet.merges ?? []) {
    if (mg.r1 >= rowCount || mg.c1 >= colCount) continue
    const r2 = Math.min(mg.r2, rowCount - 1)
    const c2 = Math.min(mg.c2, colCount - 1)
    const t = normLabel(sheet.cells[mg.r1]?.[mg.c1]?.v)
    for (let r = mg.r1; r <= r2; r++) {
      for (let c = mg.c1; c <= c2; c++) {
        m[r][c] = t
        filled[r][c] = true
      }
    }
  }
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      if (!filled[r][c]) m[r][c] = normLabel(sheet.cells[r]?.[c]?.v)
    }
  }
  return m
}

/** 路径拼接：跳过空段，相邻重复段合并 */
function joinPath(parts: string[]): string {
  const out: string[] = []
  for (const p of parts) {
    if (p && p !== out[out.length - 1]) out.push(p)
  }
  return out.join('/')
}

/** 锚点：归一化文本等于「项 目」的格，左上优先 */
function findAnchor(m: string[][]): { r: number; c: number } | null {
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (/^项\s*目$/.test(m[r][c])) return { r, c }
    }
  }
  return null
}

/** 把范围裁剪到工作表边界内 */
function clampRange(r: CellRange, sheet: SheetData): CellRange {
  const cl = (v: number, max: number): number => Math.max(0, Math.min(v, max))
  return {
    r1: cl(r.r1, sheet.rowCount - 1),
    c1: cl(r.c1, sheet.colCount - 1),
    r2: cl(r.r2, sheet.rowCount - 1),
    c2: cl(r.c2, sheet.colCount - 1)
  }
}

/** 解析失败时的空表样（带 error），保证返回类型稳定 */
function emptySheet(
  base: Omit<TemplateSheet, 'headerRange' | 'labelEnd' | 'dataStartRow' | 'dataStartCol' | 'cells' | 'manualHeader'>,
  error: string
): TemplateSheet {
  return {
    ...base,
    headerRange: { r1: 0, c1: 0, r2: 0, c2: 0 },
    labelEnd: 0,
    dataStartRow: 1,
    dataStartCol: 1,
    cells: [],
    manualHeader: false,
    error
  }
}

/**
 * 解析单张表：定位表头区与标签列，提取「有值行」及其全部数据格。
 * 表头区默认由「项 目」锚点格的合并范围决定；cfg 中有该表样的人工范围时优先使用。
 */
export function parseTemplateSheet(
  input: { sheet: SheetData; fileName: string; workbookId: string },
  cfg?: AlignConfig
): TemplateSheet {
  const { sheet, fileName, workbookId } = input
  const key = templateKeyOf(fileName)
  const base = {
    key,
    tableNo: tableNoOf(fileName),
    fileName,
    workbookId,
    sheetName: sheet.name
  }

  if (sheet.rowCount === 0 || sheet.colCount === 0) {
    return emptySheet(base, '工作表为空')
  }

  const m = mergedLabelMatrix(sheet)
  const manual = cfg?.templates?.[key]?.headerRange
  let headerRange: CellRange

  if (manual) {
    headerRange = clampRange(manual, sheet)
  } else {
    const a = findAnchor(m)
    if (!a) return emptySheet(base, '未找到「项 目」锚点，请手动指定表样范围')
    const mg = (sheet.merges ?? []).find((x) => x.r1 === a.r && x.c1 === a.c)
    headerRange = mg
      ? clampRange({ r1: mg.r1, c1: mg.c1, r2: mg.r2, c2: mg.c2 }, sheet)
      : { r1: a.r, c1: a.c, r2: a.r, c2: a.c }
  }

  const labelEnd = headerRange.c2
  const dataStartRow = headerRange.r2 + 1
  const dataStartCol = labelEnd + 1
  const partial = {
    ...base,
    headerRange,
    labelEnd,
    dataStartRow,
    dataStartCol,
    manualHeader: !!manual
  }

  // 列路径：表头行范围内有标签的列才是数据列
  const colPaths = new Map<number, string>()
  for (let c = dataStartCol; c < sheet.colCount; c++) {
    const parts: string[] = []
    for (let r = headerRange.r1; r <= headerRange.r2; r++) parts.push(m[r]?.[c] ?? '')
    const p = joinPath(parts)
    if (p) colPaths.set(c, p)
  }
  if (colPaths.size === 0) {
    return { ...partial, cells: [], error: '表头区未识别到数据列，请手动指定表样范围' }
  }

  const spans = buildMergeSpans(sheet.merges, sheet.rowCount, sheet.colCount)
  const cells: TemplateCellRef[] = []
  for (let r = dataStartRow; r < sheet.rowCount; r++) {
    const parts: string[] = []
    for (let c = 0; c <= labelEnd; c++) parts.push(m[r]?.[c] ?? '')
    const rowPath = joinPath(parts)
    if (!rowPath) continue

    const rowCells: TemplateCellRef[] = []
    for (const [c, colPath] of colPaths) {
      // 合并覆盖格跳过，值归主格，避免同一数值重复计数
      if (spans[r]?.[c]?.rowspan === 0) continue
      const cell = sheet.cells[r]?.[c] ?? null
      rowCells.push({
        row: r,
        col: c,
        rowPath,
        colPath,
        text: normLabel(cell?.v),
        num: toNumeric(cell)
      })
    }
    // 有值行：至少一个数据格可数值化（注释行/表尾行因此被自然排除）
    if (rowCells.some((x) => x.num !== null)) cells.push(...rowCells)
  }

  return { ...partial, cells }
}

/** 取工作簿第一个 sheet 解析（本项目报表均为单 sheet） */
export function parseWorkbook(wb: WorkbookData, cfg?: AlignConfig): TemplateSheet {
  const name = wb.sheetNames[0]
  const sheet = name ? wb.sheets[name] : undefined
  if (!sheet) {
    return emptySheet(
      {
        key: templateKeyOf(wb.fileName),
        tableNo: tableNoOf(wb.fileName),
        fileName: wb.fileName,
        workbookId: wb.id,
        sheetName: ''
      },
      '工作簿中没有工作表'
    )
  }
  return parseTemplateSheet({ sheet, fileName: wb.fileName, workbookId: wb.id }, cfg)
}
