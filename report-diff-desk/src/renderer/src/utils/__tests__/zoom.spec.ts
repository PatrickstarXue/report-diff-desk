import { describe, it, expect, vi } from 'vitest'
import { useGridZoom } from '../zoom'

/** 造一个够用的 WheelEvent 替身（node 环境没有 DOM） */
const wheel = (init: { ctrlKey?: boolean; deltaY?: number } = {}): WheelEvent =>
  ({ ctrlKey: false, deltaY: -100, preventDefault: vi.fn(), ...init }) as unknown as WheelEvent

describe('useGridZoom', () => {
  it('Ctrl+滚轮：上滚放大、下滚缩小，一档 10%', () => {
    const z = useGridZoom()
    z.onWheel(wheel({ ctrlKey: true, deltaY: -100 }))
    expect(z.pct.value).toBe(110)
    expect(z.zoom.value).toBeCloseTo(1.1)
    z.onWheel(wheel({ ctrlKey: true, deltaY: 100 }))
    z.onWheel(wheel({ ctrlKey: true, deltaY: 100 }))
    expect(z.pct.value).toBe(90)
  })

  it('Ctrl+滚轮一定吃掉默认行为（否则整个页面被 Chromium 缩放）', () => {
    const z = useGridZoom()
    const e = wheel({ ctrlKey: true, deltaY: -100 })
    z.onWheel(e)
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('没按 Ctrl 或零位移不拦截，交回原生滚动', () => {
    const z = useGridZoom()
    const plain = wheel({ ctrlKey: false })
    z.onWheel(plain)
    expect(plain.preventDefault).not.toHaveBeenCalled()
    const zero = wheel({ ctrlKey: true, deltaY: 0 })
    z.onWheel(zero)
    expect(zero.preventDefault).not.toHaveBeenCalled()
    expect(z.pct.value).toBe(100)
  })

  it('档位夹在 50%–300%', () => {
    const z = useGridZoom()
    for (let i = 0; i < 40; i++) z.onWheel(wheel({ ctrlKey: true, deltaY: 100 }))
    expect(z.pct.value).toBe(50)
    for (let i = 0; i < 60; i++) z.onWheel(wheel({ ctrlKey: true, deltaY: -100 }))
    expect(z.pct.value).toBe(300)
  })

  it('reset 回 100%；档位没变时不触发 onChange', () => {
    const onChange = vi.fn()
    const z = useGridZoom({ onChange })
    z.onWheel(wheel({ ctrlKey: true, deltaY: -100 }))
    expect(onChange).toHaveBeenCalledTimes(1)
    z.reset()
    expect(z.pct.value).toBe(100)
    expect(onChange).toHaveBeenCalledTimes(2)
    z.reset()
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})
