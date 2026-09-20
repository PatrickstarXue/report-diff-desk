import { describe, it, expect } from 'vitest'
import { colLetters, dataCol, makeSpanMethod } from '../sheet-view'
import type { MergeSpan } from '../merge'

describe('colLetters', () => {
  it('1 → A、3 → C、26 → Z、27 → AA、28 → AB', () => {
    expect(colLetters(3)).toEqual(['A', 'B', 'C'])
    expect(colLetters(26)[25]).toBe('Z')
    expect(colLetters(27)[26]).toBe('AA')
    expect(colLetters(28)[27]).toBe('AB')
  })
})

describe('dataCol', () => {
  it('第 0 列是行号列，数据列索引从 0 开始', () => {
    expect(dataCol(0)).toBe(-1)
    expect(dataCol(1)).toBe(0)
  })
})

describe('makeSpanMethod', () => {
  const spans: (MergeSpan | null)[][] = [
    [{ rowspan: 2, colspan: 1 }, { rowspan: 0, colspan: 0 }],
    [null, { rowspan: 1, colspan: 1 }]
  ]

  it('主格展开、被覆盖格隐藏、无合并返回 [1,1]', () => {
    const m = makeSpanMethod(() => spans)
    expect(m({ rowIndex: 0, columnIndex: 1 })).toEqual([2, 1]) // 行号列偏移：columnIndex 1 = 数据列 0
    expect(m({ rowIndex: 0, columnIndex: 2 })).toEqual([0, 0])
    expect(m({ rowIndex: 1, columnIndex: 1 })).toEqual([1, 1])
  })

  it('行号列（columnIndex 0）不参与合并', () => {
    const m = makeSpanMethod(() => spans)
    expect(m({ rowIndex: 0, columnIndex: 0 })).toEqual([1, 1])
  })

  it('spans 为 null 时全部返回 [1,1]', () => {
    const m = makeSpanMethod(() => null)
    expect(m({ rowIndex: 0, columnIndex: 1 })).toEqual([1, 1])
  })
})
