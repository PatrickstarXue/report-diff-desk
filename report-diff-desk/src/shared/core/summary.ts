import type { BatchCompareResult, CompareResult, DiffKind } from '../types'

export interface PairSummary {
  index: number
  baseFileName: string
  currFileName: string
  totalDiffs: number
  counts: Record<DiffKind, number>
  matchedSheets: number
  /** 绝对值最大的变动率，格式如 "±70%"；0 变动时为 null */
  peakChangeLabel: string | null
}

export interface OverviewData {
  totalPairs: number
  totalDiffs: number
  unmatched: string[]
  pairSummaries: PairSummary[]
}

const EMPTY_COUNTS: Record<DiffKind, number> = {
  increase: 0,
  decrease: 0,
  'zero-base': 0,
  new: 0,
  removed: 0
}

/** 单对文件比对结果 → 概览卡汇总（纯函数） */
export function buildPairSummary(index: number, pair: CompareResult): PairSummary {
  const counts: Record<DiffKind, number> = { ...EMPTY_COUNTS }
  let peakAbs = 0
  for (const d of pair.diffs) {
    counts[d.kind]++
    const abs = Math.abs(d.changeRate ?? 0)
    if (abs > peakAbs) peakAbs = abs
  }
  return {
    index,
    baseFileName: pair.baseLabel,
    currFileName: pair.currLabel,
    totalDiffs: pair.diffs.length,
    counts,
    matchedSheets: pair.sheetsMatched.length,
    peakChangeLabel: pair.diffs.length === 0 ? null : `±${(peakAbs * 100).toFixed(0)}%`
  }
}

/** 批量比对结果 → 全局概览（纯函数） */
export function buildOverview(batch: BatchCompareResult): OverviewData {
  return {
    totalPairs: batch.pairs.length,
    totalDiffs: batch.totalDiffs,
    unmatched: [...batch.unmatchedBase],
    pairSummaries: batch.pairs.map((p, i) => buildPairSummary(i, p.compare))
  }
}
