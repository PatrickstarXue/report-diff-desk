import { describe, it, expect } from 'vitest'
import { buildMergeSpans } from '../merge'

describe('buildMergeSpans', () => {
  it('无合并区域时全为 null', () => {
    const spans = buildMergeSpans(undefined, 3, 3)
    expect(spans).toHaveLength(3)
    expect(spans.flat()).toEqual(Array(9).fill(null))
  })

  it('单个合并区域：主格给跨度，被覆盖格为 0 隐藏', () => {
    // A1:C2 合并（跨 3 列 2 行）
    const spans = buildMergeSpans([{ r1: 0, c1: 0, r2: 1, c2: 2 }], 3, 4)
    expect(spans[0][0]).toEqual({ rowspan: 2, colspan: 3 })
    expect(spans[0][1]).toEqual({ rowspan: 0, colspan: 0 })
    expect(spans[0][2]).toEqual({ rowspan: 0, colspan: 0 })
    expect(spans[1][0]).toEqual({ rowspan: 0, colspan: 0 })
    expect(spans[1][1]).toEqual({ rowspan: 0, colspan: 0 })
    expect(spans[1][2]).toEqual({ rowspan: 0, colspan: 0 })
    // 区域外不受影响
    expect(spans[2][0]).toBeNull()
    expect(spans[0][3]).toBeNull()
  })

  it('多个合并区域互不影响', () => {
    const spans = buildMergeSpans(
      [
        { r1: 0, c1: 0, r2: 0, c2: 1 },
        { r1: 2, c1: 2, r2: 3, c2: 2 }
      ],
      4,
      3
    )
    expect(spans[0][0]).toEqual({ rowspan: 1, colspan: 2 })
    expect(spans[0][1]).toEqual({ rowspan: 0, colspan: 0 })
    expect(spans[2][2]).toEqual({ rowspan: 2, colspan: 1 })
    expect(spans[3][2]).toEqual({ rowspan: 0, colspan: 0 })
    expect(spans[1][0]).toBeNull()
  })

  it('合并区域超出行列范围时按边界截断不报错', () => {
    const spans = buildMergeSpans([{ r1: 0, c1: 0, r2: 9, c2: 9 }], 2, 2)
    expect(spans[0][0]).toEqual({ rowspan: 2, colspan: 2 })
    expect(spans[1][1]).toEqual({ rowspan: 0, colspan: 0 })
  })

  it('起点越界或空区域直接忽略', () => {
    const spans = buildMergeSpans([{ r1: 5, c1: 5, r2: 6, c2: 6 }], 2, 2)
    expect(spans.flat()).toEqual(Array(4).fill(null))
  })
})
