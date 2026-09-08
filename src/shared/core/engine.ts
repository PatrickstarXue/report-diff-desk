import type { CellDiff, CompareResult, DiffKind, GridCell, WorkbookData } from '@shared/types'
import { toNumeric } from './numeric'

/** 变动类型中文标签（UI 与导出共用） */
export const KIND_LABEL: Record<DiffKind, string> = {
  increase: '增长',
  decrease: '下降',
  'zero-base': '从零新增',
  new: '新增',
  removed: '移除'
}

/** 1 起始坐标 → "C12" 展示坐标 */
export function encodeCell(row: number, col: number): string {
  let c = col
  let letters = ''
  while (c > 0) {
    const rem = (c - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    c = Math.floor((c - 1) / 26)
  }
  return `${letters}${row}`
}

/** 结构对齐比对：同 sheet 名（trim 后精确匹配）+ 同坐标逐格对比 */
export function compareWorkbooks(
  base: WorkbookData,
  curr: WorkbookData,
  threshold: number
): CompareResult {
  const sheetsMatched: string[] = []
  const sheetsOnlyInBase: string[] = []
  const sheetsOnlyInCurr: string[] = []
  const diffs: CellDiff[] = []
  let totalCellsCompared = 0

  const currByName = new Map(curr.sheetNames.map((name) => [name.trim(), name]))

  for (const baseName of base.sheetNames) {
    const currName = currByName.get(baseName.trim())
    if (currName === undefined) {
      sheetsOnlyInBase.push(baseName)
      continue
    }
    currByName.delete(baseName.trim())
    sheetsMatched.push(baseName)

    const bs = base.sheets[baseName]
    const cs = curr.sheets[currName]
    const maxR = Math.max(bs.rowCount, cs.rowCount)
    const maxC = Math.max(bs.colCount, cs.colCount)
    totalCellsCompared += maxR * maxC

    for (let r = 0; r < maxR; r++) {
      for (let c = 0; c < maxC; c++) {
        const prev = bs.cells[r]?.[c] ?? null
        const cur = cs.cells[r]?.[c] ?? null
        const diff = diffCell(baseName, r + 1, c + 1, prev, cur, threshold)
        if (diff) diffs.push(diff)
      }
    }
  }

  for (const name of currByName.values()) sheetsOnlyInCurr.push(name)

  diffs.sort((a, b) => a.sheet.localeCompare(b.sheet, 'zh-CN') || a.row - b.row || a.col - b.col)

  return {
    baseId: base.id,
    currId: curr.id,
    baseLabel: base.fileName,
    currLabel: curr.fileName,
    threshold,
    sheetsMatched,
    sheetsOnlyInBase,
    sheetsOnlyInCurr,
    diffs,
    totalCellsCompared,
    generatedAt: new Date().toISOString()
  }
}

function diffCell(
  sheet: string,
  row: number,
  col: number,
  prev: GridCell | null,
  curr: GridCell | null,
  threshold: number
): CellDiff | null {
  const prevNum = toNumeric(prev)
  const currNum = toNumeric(curr)

  // 双空 / 双文本 / 日期格 / 双 0 → 跳过
  if (prevNum === null && currNum === null) return null
  if (prevNum === 0 && currNum === 0) return null

  let kind: CellDiff['kind']
  let changeRate: number
  if (prevNum === null) {
    kind = 'new'
    changeRate = 1
  } else if (currNum === null) {
    kind = 'removed'
    changeRate = -1
  } else if (prevNum === 0) {
    kind = 'zero-base'
    changeRate = 1
  } else {
    changeRate = (currNum - prevNum) / prevNum
    if (Math.abs(changeRate) <= threshold) return null
    kind = changeRate > 0 ? 'increase' : 'decrease'
  }

  return {
    sheet,
    ref: encodeCell(row, col),
    row,
    col,
    prevValue: prev?.v ?? null,
    currValue: curr?.v ?? null,
    prevNum,
    currNum,
    changeRate,
    kind
  }
}
