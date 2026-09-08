import type { BatchCompareResult, WorkbookData } from '@shared/types'
import { compareWorkbooks } from './engine'

/** 按数组顺序（zip 解析顺序）逐位配对，每对复用单对引擎；余量记入 unmatched */
export function matchWorkbookPairs(
  base: WorkbookData[],
  curr: WorkbookData[],
  threshold: number
): BatchCompareResult {
  const n = Math.min(base.length, curr.length)
  const pairs = []
  for (let i = 0; i < n; i++) {
    pairs.push({
      pairLabel: `${base[i].fileName} → ${curr[i].fileName}`,
      baseFileName: base[i].fileName,
      currFileName: curr[i].fileName,
      compare: compareWorkbooks(base[i], curr[i], threshold)
    })
  }
  return {
    pairs,
    unmatchedBase: base.slice(n).map((w) => w.fileName),
    unmatchedCurr: curr.slice(n).map((w) => w.fileName),
    totalDiffs: pairs.reduce((s, p) => s + p.compare.diffs.length, 0)
  }
}
