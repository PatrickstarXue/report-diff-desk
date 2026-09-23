/** 明细分页。抽成纯函数是为了可单测——仓库里没有组件/DOM 测试。 */

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]
export const DEFAULT_PAGE_SIZE = 50

export interface Page<T> {
  /** 当前页的数据 */
  slice: T[]
  /** 夹紧后的页码（从 1 起）——分页器必须绑这个值而不是原始 page */
  page: number
  /** 总条数 */
  total: number
}

/**
 * 取第 page 页的数据（page 从 1 起）。
 *
 * 数据变少时（换筛选、重新比对）页码会越界，这里夹回最后一页并把规范化后的页码回传，
 * 否则分页器会显示第 5 页而表里是第 2 页的内容，或者干脆空表。
 */
export function paginate<T>(rows: T[], page: number, pageSize: number): Page<T> {
  const total = rows.length
  const size = pageSize > 0 ? Math.floor(pageSize) : DEFAULT_PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(total / size))
  const raw = Math.floor(page)
  const safe = Number.isFinite(raw) ? Math.min(Math.max(1, raw), pageCount) : 1
  const start = (safe - 1) * size
  return { slice: rows.slice(start, start + size), page: safe, total }
}
