import { read, utils } from 'xlsx'
import type { GridCell, SheetData, WorkbookData } from '@shared/types'

/** Excel Date（本地时区）→ "YYYY-MM-DD"，避免 toISOString 跨时区错位一天 */
function formatLocalDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** SheetJS 单元格 → GridCell；不可解析者返回 null */
function toGridCell(raw: Record<string, unknown>): GridCell | null {
  const v = raw.v
  if (v == null) return null
  const cell: GridCell = { v: null }
  if (typeof raw.f === 'string') cell.f = raw.f
  if (v instanceof Date) {
    cell.v = formatLocalDate(v)
    cell.isDate = true
  } else if (raw.t === 'e') {
    // 错误值（#DIV/0! 等）：取显示文本
    cell.v = typeof raw.w === 'string' ? raw.w : String(v)
  } else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
    cell.v = v
  } else {
    cell.v = String(v)
  }
  return cell
}

/** 解析 .xlsx/.xls Buffer → WorkbookData（公式格保留 f；无缓存值则 v 为 null） */
export function parseExcel(
  buffer: Buffer,
  fileName: string,
  source: 'file' | 'zip'
): WorkbookData {
  const wb = read(buffer, { type: 'buffer', cellFormula: true, cellDates: true })
  const sheetNames: string[] = wb.SheetNames
  const sheets: Record<string, SheetData> = {}

  for (const name of sheetNames) {
    const ws = wb.Sheets[name]
    if (!ws['!ref']) {
      sheets[name] = { name, rowCount: 0, colCount: 0, cells: [] }
      continue
    }
    const range = utils.decode_range(ws['!ref'])
    const cells: (GridCell | null)[][] = []
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: (GridCell | null)[] = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        const raw = ws[utils.encode_cell({ r, c })]
        row.push(raw ? toGridCell(raw) : null)
      }
      cells.push(row)
    }
    sheets[name] = { name, rowCount: range.e.r - range.s.r + 1, colCount: range.e.c - range.s.c + 1, cells }
  }

  return { id: crypto.randomUUID(), fileName, source, sheetNames, sheets }
}
