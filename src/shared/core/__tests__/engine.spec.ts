import { describe, it, expect } from 'vitest'
import { compareWorkbooks } from '../engine'
import type { CellValue, GridCell, SheetData, WorkbookData } from '@shared/types'

const n = (v: CellValue, extra?: Partial<GridCell>): GridCell => ({ v, ...extra })

function makeWorkbook(
  id: string,
  sheetRows: Record<string, (GridCell | null)[][]>
): WorkbookData {
  const sheets: Record<string, SheetData> = {}
  for (const [name, cells] of Object.entries(sheetRows)) {
    sheets[name] = {
      name,
      rowCount: cells.length,
      colCount: Math.max(0, ...cells.map((r) => r.length)),
      cells
    }
  }
  return { id, fileName: id, source: 'file', sheetNames: Object.keys(sheetRows), sheets }
}

/** 快速造单 sheet 两个工作簿：rows 的每个元素是该行需要填充的列 */
function pair(
  baseRows: (GridCell | null)[][],
  currRows: (GridCell | null)[][],
  threshold = 0.5,
  sheetName = '数据'
): ReturnType<typeof compareWorkbooks> {
  return compareWorkbooks(
    makeWorkbook('base', { [sheetName]: baseRows }),
    makeWorkbook('curr', { [sheetName]: currRows }),
    threshold
  )
}

describe('compareWorkbooks', () => {
  it('increase：100→200 记 rate 1', () => {
    const r = pair([[n(100)]], [[n(200)]])
    expect(r.diffs).toHaveLength(1)
    expect(r.diffs[0]).toMatchObject({ kind: 'increase', row: 1, col: 1, ref: 'A1' })
    expect(r.diffs[0].changeRate).toBe(1)
  })

  it('decrease：100→40 记 rate -0.6', () => {
    const r = pair([[n(100)]], [[n(40)]])
    expect(r.diffs[0]).toMatchObject({ kind: 'decrease' })
    expect(r.diffs[0].changeRate).toBeCloseTo(-0.6)
  })

  it('恰 ±50% 不标记（严格大于阈值）', () => {
    expect(pair([[n(100)]], [[n(150)]]).diffs).toHaveLength(0)
    expect(pair([[n(100)]], [[n(50)]]).diffs).toHaveLength(0)
  })

  it('双 0 跳过', () => {
    expect(pair([[n(0)]], [[n(0)]]).diffs).toHaveLength(0)
  })

  it('上期 0 本期非 0 → zero-base rate 1', () => {
    const r = pair([[n(0)]], [[n(100)]])
    expect(r.diffs[0]).toMatchObject({ kind: 'zero-base' })
    expect(r.diffs[0].changeRate).toBe(1)
  })

  it('上期空 本期有值 → new rate 1', () => {
    const r = pair([[null]], [[n(100)]])
    expect(r.diffs[0]).toMatchObject({ kind: 'new' })
    expect(r.diffs[0].changeRate).toBe(1)
  })

  it('上期有值 本期空 → removed rate -1', () => {
    const r = pair([[n(100)]], [[null]])
    expect(r.diffs[0]).toMatchObject({ kind: 'removed' })
    expect(r.diffs[0].changeRate).toBe(-1)
  })

  it('本期 0：100→0 记 -100% decrease', () => {
    const r = pair([[n(100)]], [[n(0)]])
    expect(r.diffs[0]).toMatchObject({ kind: 'decrease' })
    expect(r.diffs[0].changeRate).toBe(-1)
  })

  it('上期为负：-100→100 rate -2', () => {
    const r = pair([[n(-100)]], [[n(100)]])
    expect(r.diffs[0]).toMatchObject({ kind: 'decrease' })
    expect(r.diffs[0].changeRate).toBe(-2)
  })

  it('文本格：双文本跳过，数值文本参与', () => {
    expect(pair([[n('abc')]], [[n('def')]]).diffs).toHaveLength(0)
    const r = pair([[n('1,000')]], [[n('2,000')]])
    expect(r.diffs).toHaveLength(1)
    expect(r.diffs[0]).toMatchObject({ kind: 'increase', prevNum: 1000, currNum: 2000 })
  })

  it('日期格跳过', () => {
    expect(
      pair(
        [[n('2026-01-15', { isDate: true })]],
        [[n('2026-02-15', { isDate: true })]]
      ).diffs
    ).toHaveLength(0)
  })

  it('sheet 名 trim 后匹配', () => {
    const base = makeWorkbook('base', { ' 经营数据 ': [[n(100)]] })
    const curr = makeWorkbook('curr', { 经营数据: [[n(300)]] })
    const r = compareWorkbooks(base, curr, 0.5)
    expect(r.sheetsMatched).toEqual([' 经营数据 '])
    expect(r.diffs).toHaveLength(1)
  })

  it('不匹配的 sheet 记入 OnlyIn 列表', () => {
    const base = makeWorkbook('base', { 数据: [[n(100)]], 旧表: [[n(1)]] })
    const curr = makeWorkbook('curr', { 数据: [[n(200)]], 新表: [[n(2)]] })
    const r = compareWorkbooks(base, curr, 0.5)
    expect(r.sheetsMatched).toEqual(['数据'])
    expect(r.sheetsOnlyInBase).toEqual(['旧表'])
    expect(r.sheetsOnlyInCurr).toEqual(['新表'])
  })

  it('行数不一致：多出的行记 new', () => {
    const r = pair([[n(100)]], [[n(200)], [n(5)]])
    expect(r.diffs).toHaveLength(2)
    expect(r.diffs[1]).toMatchObject({ kind: 'new', row: 2, col: 1 })
  })

  it('列数不一致：多出的列记 new', () => {
    const r = pair([[n(100), null]], [[n(200), n(5)]])
    expect(r.diffs).toHaveLength(2)
    expect(r.diffs[1]).toMatchObject({ kind: 'new', row: 1, col: 2 })
  })

  it('diffs 按 sheet → row → col 排序', () => {
    const base = makeWorkbook('base', {
      甲: [[n(100)], [n(100)]],
      乙: [[n(100)]]
    })
    const curr = makeWorkbook('curr', {
      甲: [[n(200)], [n(300)]],
      乙: [[n(400)]]
    })
    const r = compareWorkbooks(base, curr, 0.5)
    expect(r.diffs.map((d) => `${d.sheet}:${d.ref}`)).toEqual(['甲:A1', '甲:A2', '乙:A1'])
  })

  it('totalCellsCompared 统计所有匹配 sheet 的 max 区域', () => {
    const r = pair([[n(100), n(100)]], [[n(200), n(300)]])
    expect(r.totalCellsCompared).toBe(2)
  })

  it('阈值参数生效：rate 0.02 在 0.01 阈值标记、0.5 阈值不标', () => {
    expect(pair([[n(100)]], [[n(102)]], 0.01).diffs).toHaveLength(1)
    expect(pair([[n(100)]], [[n(102)]], 0.5).diffs).toHaveLength(0)
  })

  it('无匹配 sheet 时 diffs 为空且不报错', () => {
    const base = makeWorkbook('base', { 甲: [[n(1)]] })
    const curr = makeWorkbook('curr', { 乙: [[n(2)]] })
    const r = compareWorkbooks(base, curr, 0.5)
    expect(r.diffs).toHaveLength(0)
    expect(r.sheetsOnlyInBase).toEqual(['甲'])
    expect(r.sheetsOnlyInCurr).toEqual(['乙'])
  })

  it('坐标 ref：第 3 列第 12 行 = C12', () => {
    const rows: (GridCell | null)[][] = Array.from({ length: 12 }, () => [n(1), n(1), n(1)])
    const base = makeWorkbook('base', { 数据: rows })
    const curr = makeWorkbook('curr', { 数据: rows.map((row) => row.slice()) })
    curr.sheets['数据'].cells[11][2] = n(300)
    const r = compareWorkbooks(base, curr, 0.5)
    expect(r.diffs.some((d) => d.ref === 'C12' && d.col === 3 && d.row === 12)).toBe(true)
  })
})
