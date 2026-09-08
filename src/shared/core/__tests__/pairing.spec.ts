import { describe, it, expect } from 'vitest'
import { matchWorkbookPairs } from '../pairing'
import type { GridCell, WorkbookData } from '@shared/types'

function wb(id: string, value = 100): WorkbookData {
  const cells: (GridCell | null)[][] = [[{ v: value }]]
  return {
    id,
    fileName: id,
    source: 'file',
    sheetNames: ['数据'],
    sheets: { 数据: { name: '数据', rowCount: 1, colCount: 1, cells } }
  }
}

describe('matchWorkbookPairs', () => {
  it('按顺序配对 2 vs 2', () => {
    const r = matchWorkbookPairs([wb('A.xlsx'), wb('B.xlsx')], [wb('A2.xlsx'), wb('B2.xlsx')], 0.5)
    expect(r.pairs).toHaveLength(2)
    expect(r.pairs[0].pairLabel).toBe('A.xlsx → A2.xlsx')
    expect(r.pairs[1].pairLabel).toBe('B.xlsx → B2.xlsx')
    expect(r.unmatchedBase).toEqual([])
    expect(r.unmatchedCurr).toEqual([])
    expect(r.totalDiffs).toBe(0)
  })

  it('数量不等：多出的记入 unmatched', () => {
    const r = matchWorkbookPairs([wb('A.xlsx'), wb('B.xlsx')], [wb('A2.xlsx')], 0.5)
    expect(r.pairs).toHaveLength(1)
    expect(r.unmatchedBase).toEqual(['B.xlsx'])
    expect(r.unmatchedCurr).toEqual([])
  })

  it('空数组不报错', () => {
    const r = matchWorkbookPairs([], [], 0.5)
    expect(r.pairs).toEqual([])
    expect(r.totalDiffs).toBe(0)
  })

  it('单文件 vs 单文件（老场景兼容）且 totalDiffs 汇总', () => {
    const base = wb('上期.xlsx')
    const curr = wb('本期.xlsx', 300)
    const r = matchWorkbookPairs([base], [curr], 0.5)
    expect(r.pairs).toHaveLength(1)
    expect(r.pairs[0].pairLabel).toBe('上期.xlsx → 本期.xlsx')
    expect(r.pairs[0].compare.diffs).toHaveLength(1)
    expect(r.totalDiffs).toBe(1)
  })
})
