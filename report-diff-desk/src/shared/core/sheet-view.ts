import type { MergeSpan } from './merge'

/** el-table 列序号 → 数据列索引（第 0 列是行号列，数据列从 1 开始） */
export function dataCol(columnIndex: number): number {
  return columnIndex - 1
}

/** 列序号 → Excel 列字母（1 → A、27 → AA） */
export function colLetters(colCount: number): string[] {
  const out: string[] = []
  for (let c = 1; c <= colCount; c++) {
    let n = c
    let letters = ''
    while (n > 0) {
      const rem = (n - 1) % 26
      letters = String.fromCharCode(65 + rem) + letters
      n = Math.floor((n - 1) / 26)
    }
    out.push(letters)
  }
  return out
}

/**
 * el-table span-method 工厂：主格展开，被覆盖格隐藏；行号列（第 0 列）不参与合并。
 * @param getSpans 返回 span 矩阵（行 0 起始，与 data 行索引一致）
 */
export function makeSpanMethod(
  getSpans: () => (MergeSpan | null)[][] | null
): (p: { rowIndex: number; columnIndex: number }) => [number, number] {
  return ({ rowIndex, columnIndex }) => {
    const c = dataCol(columnIndex)
    if (c < 0) return [1, 1]
    const s = getSpans()?.[rowIndex]?.[c]
    if (!s) return [1, 1]
    return [s.rowspan, s.colspan]
  }
}
