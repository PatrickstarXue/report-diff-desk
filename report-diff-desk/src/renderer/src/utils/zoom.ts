import { computed, ref, type ComputedRef, type Ref } from 'vue'

/** 缩放档位：50%–300%，每档 10% */
const MIN_PCT = 50
const MAX_PCT = 300
const STEP_PCT = 10

export interface GridZoom {
  /** 当前档位（百分数整数），用于显示 */
  pct: Ref<number>
  /** 缩放倍数，直接绑到容器的 style.zoom */
  zoom: ComputedRef<number>
  /** Ctrl+滚轮：上滚放大、下滚缩小；非 Ctrl 或零位移不拦截 */
  onWheel: (e: WheelEvent) => void
  /** 回到 100% */
  reset: () => void
}

/**
 * Excel 展示区缩放（Ctrl+滚轮）。
 * 必须吃掉默认行为——否则 Chromium 会把整个页面（连带工具栏）一起缩放掉。
 * 用 CSS zoom 而不是 transform：zoom 连布局一起重排，里头的 el-table 滚动容器、
 * 固定表头、横向滚动条才会跟着对；transform 只是视觉拉伸，滚动范围不变。
 */
export function useGridZoom(opts: { onChange?: () => void } = {}): GridZoom {
  const pct = ref(100)
  const zoom = computed(() => pct.value / 100)

  function setPct(next: number): void {
    const snapped = Math.round(next / STEP_PCT) * STEP_PCT
    const v = Math.min(MAX_PCT, Math.max(MIN_PCT, snapped))
    if (v === pct.value) return
    pct.value = v
    opts.onChange?.()
  }

  return {
    pct,
    zoom,
    onWheel: (e: WheelEvent): void => {
      if (!e.ctrlKey || e.deltaY === 0) return
      e.preventDefault()
      setPct(pct.value - Math.sign(e.deltaY) * STEP_PCT)
    },
    reset: () => setPct(100)
  }
}
