import { describe, it, expect } from 'vitest'
import { DEFAULT_PAGE_SIZE, paginate } from '../pagination'

/** range(5) → [1..5]；range(51, 101) → [51..100]（含头不含尾） */
const range = (from: number, to?: number): number[] =>
  to === undefined
    ? Array.from({ length: from }, (_, i) => i + 1)
    : Array.from({ length: to - from }, (_, i) => from + i)

describe('paginate', () => {
  it('空数据：返回空切片，页码规范化为 1，总数为 0', () => {
    expect(paginate([], 3, 50)).toEqual({ slice: [], page: 1, total: 0 })
  })

  it('单页数据全部返回', () => {
    expect(paginate(range(10), 1, 50).slice).toEqual(range(10))
  })

  it('多页：按页取切片', () => {
    const rows = range(120)
    expect(paginate(rows, 1, 50).slice).toEqual(range(50))
    expect(paginate(rows, 2, 50).slice).toEqual(range(51, 101))
    expect(paginate(rows, 3, 50).slice).toEqual(range(101, 121))
  })

  it('恰好整页：不产生空尾页', () => {
    const p = paginate(range(100), 2, 50)
    expect(p.slice).toEqual(range(51, 101))
    expect(p.page).toBe(2)
  })

  it('页码越界时夹回最后一页（数据变少的关键场景）', () => {
    const p = paginate(range(60), 5, 50)
    expect(p.page).toBe(2)
    expect(p.slice).toEqual(range(51, 61))
  })

  it('页码小于 1 时夹到第 1 页', () => {
    expect(paginate(range(60), 0, 50).page).toBe(1)
    expect(paginate(range(60), -3, 50).page).toBe(1)
  })

  it('页码非数字时退回第 1 页，不产出 NaN 切片', () => {
    expect(paginate(range(60), Number.NaN, 50).page).toBe(1)
    expect(paginate(range(60), Number.NaN, 50).slice).toEqual(range(50))
  })

  it('页大小为 0 或负数时退回默认页大小', () => {
    expect(paginate(range(60), 1, 0).slice).toEqual(range(DEFAULT_PAGE_SIZE))
    expect(paginate(range(60), 1, -10).slice).toEqual(range(DEFAULT_PAGE_SIZE))
  })

  it('页大小变大后重新计算页数', () => {
    const rows = range(120)
    expect(paginate(rows, 3, 50).page).toBe(3)
    // 换成每页 200 后只有一页，原第 3 页夹回第 1 页
    const p = paginate(rows, 3, 200)
    expect(p.page).toBe(1)
    expect(p.slice).toEqual(rows)
  })
})
