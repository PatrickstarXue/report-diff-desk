import { onScopeDispose, ref, type Ref } from 'vue'

/** 位移阈值（px）：小于此值视为点击，不进入拖拽，避免吞掉单元格点击 */
const DRAG_THRESHOLD = 4

export interface DragPan {
  /** 本次交互是否为拖拽（供 cell-click 等处理器判断并忽略该次点击） */
  dragging: Ref<boolean>
  onMouseDown: (e: MouseEvent) => void
}

/**
 * 左键拖拽平移滚动容器（滚轮滚动保持原生行为）。
 * 左键专用于平移，不保留原生文本选择。
 * @param getScroller 返回真正承担溢出的滚动元素
 */
export function useDragPan(getScroller: () => HTMLElement | null): DragPan {
  const dragging = ref(false)
  let teardown: (() => void) | null = null

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    const el = getScroller()
    if (!el) return

    e.preventDefault() // 阻止原生文本选择：左键专用于平移
    const startX = e.clientX
    const startY = e.clientY
    const startLeft = el.scrollLeft
    const startTop = el.scrollTop
    let moved = false
    let raf = 0

    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        moved = true
        dragging.value = true
        document.body.classList.add('is-panning')
      }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        el.scrollLeft = startLeft - dx
        el.scrollTop = startTop - dy
      })
    }

    const finish = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', finish)
      cancelAnimationFrame(raf)
      document.body.classList.remove('is-panning')
      teardown = null
      // click 在 mouseup 之后同步派发，延迟一拍再清标志
      if (moved) setTimeout(() => (dragging.value = false), 0)
    }

    teardown = finish
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finish)
  }

  // 拖拽途中组件销毁（切标签页）时收尾，避免光标卡在 grabbing
  onScopeDispose(() => teardown?.())

  return { dragging, onMouseDown }
}
