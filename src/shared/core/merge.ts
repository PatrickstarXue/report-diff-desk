import type { MergedRange } from '../types'

export interface MergeSpan {
  rowspan: number
  colspan: number
}

/**
 * 将 Excel 合并区域转为渲染用 span 矩阵：
 * 主格（左上角）存 {rowspan, colspan}；被覆盖格存 {0, 0}（隐藏）；其余为 null（单格）。
 * 供 el-table span-method 使用；越界区域按边界截断，起点越界忽略。
 */
export function buildMergeSpans(
  merges: MergedRange[] | undefined,
  rowCount: number,
  colCount: number
): (MergeSpan | null)[][] {
  const spans: (MergeSpan | null)[][] = Array.from({ length: rowCount }, () =>
    Array<MergeSpan | null>(colCount).fill(null)
  )
  for (const m of merges ?? []) {
    if (m.r1 >= rowCount || m.c1 >= colCount) continue
    const r2 = Math.min(m.r2, rowCount - 1)
    const c2 = Math.min(m.c2, colCount - 1)
    if (r2 < m.r1 || c2 < m.c1) continue
    spans[m.r1][m.c1] = { rowspan: r2 - m.r1 + 1, colspan: c2 - m.c1 + 1 }
    for (let r = m.r1; r <= r2; r++) {
      for (let c = m.c1; c <= c2; c++) {
        if (r !== m.r1 || c !== m.c1) spans[r][c] = { rowspan: 0, colspan: 0 }
      }
    }
  }
  return spans
}
