/**
 * 把表格里的目标单元格滚进视野。供「整体概览 → 高亮显示」与
 * 「高亮显示 → Mapping口径」两处跳转共用。
 *
 * 不用 scrollIntoView：它要沿祖先链自己找滚动容器，在标签页刚从隐藏变可见、
 * 以及表格带 CSS zoom 时落点不可靠——实测纵向能滚、横向不动。
 * el-table 的表体滚动容器是内部的 .el-scrollbar__wrap（左键拖拽平移用的也是它），
 * 直接改它的 scrollLeft/scrollTop 最确定，横竖一起处理。
 */

const SCROLLER_SELECTOR = '.el-table__body-wrapper .el-scrollbar__wrap'
const RETRY_MS = 50
const MAX_ATTEMPTS = 20

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 让 cell 的中心落到 container 中心的所需滚动增量（布局像素）。
 *
 * CSS zoom 下 getBoundingClientRect 给的是缩放后的视觉像素，而 scrollLeft/scrollTop
 * 是布局像素，所以要除掉缩放系数。
 */
export function centeringDelta(
  container: { left: number; width: number },
  cell: { left: number; width: number },
  scale: number
): number {
  const s = scale > 0 ? scale : 1
  return (cell.left + cell.width / 2 - (container.left + container.width / 2)) / s
}

/**
 * 定位成功返回 true；表格还没渲染出来、或还在未激活的标签页里（量不出尺寸）时返回 false。
 */
export function revealCell(root: HTMLElement | null | undefined, cellSelector: string): boolean {
  const scroller = root?.querySelector<HTMLElement>(SCROLLER_SELECTOR)
  const cell = root?.querySelector<HTMLElement>(cellSelector)
  if (!scroller || !cell || !scroller.clientWidth || !scroller.clientHeight) return false

  const sRect = scroller.getBoundingClientRect()
  const cRect = cell.getBoundingClientRect()
  // 用容器自身「视觉宽 / 布局宽」之比反推缩放系数，不依赖调用方把档位传进来。
  // 容器无边框、原生滚动条也已隐藏，这个比值就是缩放倍数（略有误差也只影响居中的几像素）。
  const scale = sRect.width / scroller.clientWidth

  scroller.scrollLeft += centeringDelta(sRect, cRect, scale)
  scroller.scrollTop += centeringDelta(
    { left: sRect.top, width: sRect.height },
    { left: cRect.top, width: cRect.height },
    scale
  )
  return true
}

/**
 * 等目标格真正出现在 DOM 后再定位：换 sheet、切标签页时数据是异步取回来的，
 * 表格重排完成前查不到那一行。
 *
 * @param prepare 每次尝试前调用，用来让 el-table 重新量一遍（切标签页后尤其需要）
 */
export async function revealCellWhenReady(
  root: () => HTMLElement | null | undefined,
  cellSelector: string,
  prepare?: () => void
): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    prepare?.()
    if (revealCell(root(), cellSelector)) return
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
  }
}
