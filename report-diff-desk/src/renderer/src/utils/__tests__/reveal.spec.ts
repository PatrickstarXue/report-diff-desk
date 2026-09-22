import { describe, it, expect } from 'vitest'
import { centeringDelta, revealCell } from '../reveal'

const box = (left: number, width: number): { left: number; width: number } => ({ left, width })

describe('centeringDelta', () => {
  it('目标在容器右侧时按中心距给正增量', () => {
    // 容器 [0,400] 中心 200；目标 [600,700] 中心 650 → 差 450
    expect(centeringDelta(box(0, 400), box(600, 100), 1)).toBe(450)
  })

  it('目标在容器左侧时给负增量', () => {
    expect(centeringDelta(box(0, 400), box(-300, 100), 1)).toBe(-450)
  })

  it('已居中时为 0', () => {
    expect(centeringDelta(box(0, 400), box(150, 100), 1)).toBe(0)
  })

  it('CSS zoom 下折算回布局像素', () => {
    // 视觉上差 450px，缩放了 1.5 倍 → 布局坐标只差 300
    expect(centeringDelta(box(0, 400), box(600, 100), 1.5)).toBe(300)
  })

  it('缩放系数为 0 或非法时按 1 处理，不产出 Infinity/NaN', () => {
    expect(centeringDelta(box(0, 400), box(600, 100), 0)).toBe(450)
    expect(centeringDelta(box(0, 400), box(600, 100), Number.NaN)).toBe(450)
  })
})

// —— revealCell 的 DOM 层：只用到 querySelector / getBoundingClientRect / clientWidth / scrollLeft，
//    桩对象即可覆盖，不必引入 jsdom ——

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

function makeScroller(rect: Rect, clientWidth: number, clientHeight: number) {
  return {
    clientWidth,
    clientHeight,
    scrollLeft: 0,
    scrollTop: 0,
    getBoundingClientRect: (): Rect => rect
  }
}

function makeEl(rect: Rect) {
  return { getBoundingClientRect: (): Rect => rect }
}

/** 模拟 el-table 的 DOM：容器选择器命中 scroller，其余命中目标格 */
function makeRoot(scroller: unknown, cell: unknown): HTMLElement {
  return {
    querySelector: (sel: string) => (sel.includes('el-scrollbar__wrap') ? scroller : cell)
  } as unknown as HTMLElement
}

describe('revealCell', () => {
  const sRect: Rect = { left: 0, top: 0, width: 400, height: 300 }

  it('横竖都按中心距滚动（横向不再被忽略）', () => {
    const scroller = makeScroller(sRect, 400, 300)
    // 目标格中心视觉上在 (650, 450)，容器中心是 (200, 150) → 应各滚 450 / 300
    const cell = makeEl({ left: 600, top: 400, width: 100, height: 100 })
    expect(revealCell(makeRoot(scroller, cell), 'td.cell-focused')).toBe(true)
    expect(scroller.scrollLeft).toBe(450)
    expect(scroller.scrollTop).toBe(300)
  })

  it('已居中的格子不产生位移', () => {
    const scroller = makeScroller(sRect, 400, 300)
    const cell = makeEl({ left: 150, top: 100, width: 100, height: 100 })
    expect(revealCell(makeRoot(scroller, cell), 'td.cell-focused')).toBe(true)
    expect(scroller.scrollLeft).toBe(0)
    expect(scroller.scrollTop).toBe(0)
  })

  it('CSS zoom 下按缩放系数折算（rect 是视觉像素、scrollLeft 是布局像素）', () => {
    // 容器视觉宽是布局宽的两倍 → 缩放 2 倍
    const scroller = makeScroller({ left: 0, top: 0, width: 800, height: 600 }, 400, 300)
    const cell = makeEl({ left: 600, top: 400, width: 100, height: 100 })
    expect(revealCell(makeRoot(scroller, cell), 'td.cell-focused')).toBe(true)
    // 水平：格中心视觉 x=650，容器中心视觉 x=400，差 250 视觉像素 → 布局 125
    expect(scroller.scrollLeft).toBe(125)
    // 垂直：格中心视觉 y=450，容器中心视觉 y=300，差 150 → 布局 75
    expect(scroller.scrollTop).toBe(75)
  })

  it('未激活标签页（容器量不出尺寸）时不滚动，返回 false 交给外层重试', () => {
    const scroller = makeScroller({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)
    const cell = makeEl({ left: 600, top: 400, width: 100, height: 100 })
    expect(revealCell(makeRoot(scroller, cell), 'td.cell-focused')).toBe(false)
    expect(scroller.scrollLeft).toBe(0)
    expect(scroller.scrollTop).toBe(0)
  })

  it('目标格不在 DOM 里时不滚动，返回 false', () => {
    const scroller = makeScroller(sRect, 400, 300)
    expect(revealCell(makeRoot(scroller, null), 'td.cell-focused')).toBe(false)
    expect(scroller.scrollLeft).toBe(0)
    expect(scroller.scrollTop).toBe(0)
  })
})
