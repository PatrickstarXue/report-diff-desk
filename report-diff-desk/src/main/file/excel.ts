import { read, utils } from 'xlsx'
import type { GridCell, MergedRange, SheetData, WorkbookData } from '@shared/types'

/**
 * 展开范围硬上限：防「幽灵选区」（残留格式把 !ref 撑到 1048576 行）
 * 与真实超大表把主进程内存打爆。超限即截断并标记 truncated。
 */
const MAX_ROWS = 100_000
const MAX_COLS = 2_000
const MAX_CELLS = 4_000_000

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

/** 解析单元格坐标键（"B7" → {r,c}）；元数据键（!ref 等）与非法键返回 null */
function decodeCellKey(key: string): { r: number; c: number } | null {
  if (key.charCodeAt(0) === 33 /* '!' */) return null
  try {
    return utils.decode_cell(key)
  } catch {
    return null
  }
}

/**
 * 从 ws 实际数据键计算最大行/列（跳过 !ref/!merges 等元数据键）；无数据格返回 null。
 * 幽灵选区的 !ref 远大于此边界，按它展开会生成千万级 null 格。
 */
function dataMaxBounds(ws: Record<string, unknown>): { maxR: number; maxC: number } | null {
  let maxR = -1
  let maxC = -1
  for (const key of Object.keys(ws)) {
    const cell = decodeCellKey(key)
    if (!cell) continue
    if (cell.r > maxR) maxR = cell.r
    if (cell.c > maxC) maxC = cell.c
  }
  return maxR < 0 ? null : { maxR, maxC }
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
    const ws = wb.Sheets[name] as Record<string, unknown> | undefined
    if (!ws) {
      sheets[name] = { name, rowCount: 0, colCount: 0, cells: [] }
      continue
    }
    const ref = ws['!ref'] as string | undefined
    const bounds = dataMaxBounds(ws)
    if (!ref || !bounds) {
      // 无 !ref 或无任何数据格（幽灵 !ref 不展开为空表）
      sheets[name] = { name, rowCount: 0, colCount: 0, cells: [] }
      continue
    }
    const range = utils.decode_range(ref)
    // 起点保持 !ref 不变（全应用坐标基准：diff 行号/规则表/锚点均按 cells 下标）
    const s = { r: range.s.r, c: range.s.c }
    // 终点按实际数据收缩：!ref 可能被残留格式撑到百万行，按它全量展开必炸内存
    let e = { r: Math.min(range.e.r, bounds.maxR), c: Math.min(range.e.c, bounds.maxC) }
    let truncated = false
    if (e.r - s.r + 1 > MAX_ROWS) {
      e.r = s.r + MAX_ROWS - 1
      truncated = true
    }
    if (e.c - s.c + 1 > MAX_COLS) {
      e.c = s.c + MAX_COLS - 1
      truncated = true
    }
    const rowCount = e.r - s.r + 1
    if (rowCount * (e.c - s.c + 1) > MAX_CELLS) {
      // 行宽各自合规但乘积超限：保行号连续性，缩列
      e.c = s.c + Math.max(1, Math.floor(MAX_CELLS / rowCount)) - 1
      truncated = true
    }
    const colCount = e.c - s.c + 1

    // 只按实际数据键铺格：复杂度 = 真实数据格数，幽灵范围/空缺格一次都不碰
    const cells: (GridCell | null)[][] = Array.from({ length: rowCount }, () =>
      Array<GridCell | null>(colCount).fill(null)
    )
    for (const key of Object.keys(ws)) {
      const cell = decodeCellKey(key)
      if (!cell || cell.r < s.r || cell.r > e.r || cell.c < s.c || cell.c > e.c) continue
      const raw = ws[key] as Record<string, unknown> | undefined
      if (raw) cells[cell.r - s.r][cell.c - s.c] = toGridCell(raw)
    }

    // 合并区：主格落在展开范围内即保留（从格可被 render 侧按 rowCount/colCount 截断）；
    // 主格越界的幽灵残留合并直接丢弃，不过 IPC
    const merges: MergedRange[] = []
    for (const m of (ws['!merges'] as
      | { s: { r: number; c: number }; e: { r: number; c: number } }[]
      | undefined) ?? []) {
      if (m.s.r < s.r || m.s.c < s.c || m.s.r > e.r || m.s.c > e.c) continue
      merges.push({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c })
    }

    sheets[name] = {
      name,
      rowCount,
      colCount,
      cells,
      merges: merges.length > 0 ? merges : undefined,
      truncated: truncated || undefined
    }
  }

  return { id: crypto.randomUUID(), fileName, source, sheetNames, sheets }
}
