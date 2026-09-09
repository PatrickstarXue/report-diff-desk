import { describe, it, expect } from 'vitest'
import { buildPairSummary, buildOverview } from '../summary'
import type { BatchCompareResult, CompareResult } from '@shared/types'

function makePair(overrides: Partial<CompareResult> = {}): CompareResult {
  return {
    baseId: 'b',
    currId: 'c',
    baseLabel: 'base.xlsx',
    currLabel: 'curr.xlsx',
    threshold: 0.5,
    sheetsMatched: ['数据', '附注'],
    sheetsOnlyInBase: [],
    sheetsOnlyInCurr: [],
    totalCellsCompared: 200,
    generatedAt: '2026-09-09T00:00:00Z',
    diffs: [],
    ...overrides
  }
}

describe('buildPairSummary', () => {
  it('五类计数、匹配数、峰值标签', () => {
    const r = makePair({
      diffs: [
        { sheet: '数据', ref: 'B2', row: 2, col: 2, prevValue: 100, currValue: 200, prevNum: 100, currNum: 200, changeRate: 1, kind: 'increase' },
        { sheet: '数据', ref: 'B3', row: 3, col: 2, prevValue: 100, currValue: 30, prevNum: 100, currNum: 30, changeRate: -0.7, kind: 'decrease' },
        { sheet: '数据', ref: 'B4', row: 4, col: 2, prevValue: 0, currValue: 50, prevNum: 0, currNum: 50, changeRate: 1, kind: 'zero-base' },
        { sheet: '数据', ref: 'C2', row: 2, col: 3, prevValue: null, currValue: 10, prevNum: null, currNum: 10, changeRate: 1, kind: 'new' },
        { sheet: '数据', ref: 'D2', row: 2, col: 4, prevValue: 80, currValue: null, prevNum: 80, currNum: null, changeRate: -1, kind: 'removed' }
      ]
    })
    const s = buildPairSummary(0, r)
    expect(s.totalDiffs).toBe(5)
    expect(s.counts).toEqual({ increase: 1, decrease: 1, 'zero-base': 1, new: 1, removed: 1 })
    expect(s.matchedSheets).toBe(2)
    // 峰值取绝对值最大者：zero-base/new/removed 均为 ±100%，高于 decrease 的 70%
    expect(s.peakChangeLabel).toBe('±100%')
  })

  it('0 变动返回 null 峰值标签、五类全 0', () => {
    const s = buildPairSummary(0, makePair({ diffs: [] }))
    expect(s.totalDiffs).toBe(0)
    expect(s.peakChangeLabel).toBeNull()
    expect(Object.values(s.counts).every((n) => n === 0)).toBe(true)
  })
})

describe('buildOverview', () => {
  const base: BatchCompareResult = {
    pairs: [
      { pairLabel: 'NR01', baseFileName: 'NR01_20260731.xlsx', currFileName: 'NR01_20260831.xlsx', compare: makePair() },
      {
        pairLabel: 'NR02',
        baseFileName: 'NR02_20260731.xlsx',
        currFileName: 'NR02_20260831.xlsx',
        compare: makePair({ sheetsMatched: [] })
      }
    ],
    unmatchedBase: ['NR03_20260731.xlsx'],
    unmatchedCurr: [],
    totalDiffs: 0
  }

  it('全局指标：文件对数、未参与列表、逐对汇总', () => {
    const o = buildOverview(base)
    expect(o.totalPairs).toBe(2)
    expect(o.unmatched).toEqual(['NR03_20260731.xlsx'])
    expect(o.pairSummaries).toHaveLength(2)
    expect(o.pairSummaries[1].matchedSheets).toBe(0)
  })
})
