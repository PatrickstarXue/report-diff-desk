import type { GridCell } from '@shared/types'

/**
 * 单元格数值化：数字原值；文本去千分位、% 结尾先除 100 再 parseFloat；
 * 日期、布尔、空、非法文本一律 null（不参与环比）。
 */
export function toNumeric(cell: GridCell | null): number | null {
  if (!cell || cell.isDate) return null
  const v = cell.v
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return null

  let s = v.trim()
  if (s === '') return null
  let factor = 1
  if (s.endsWith('%')) {
    s = s.slice(0, -1).trim()
    factor = 0.01
  }
  s = s.replace(/,/g, '')
  if (s === '') return null

  // Number() 要求整串合法，避免 parseFloat 截断 "12%x" 这类混排文本
  const n = Number(s)
  return Number.isFinite(n) ? n * factor : null
}
