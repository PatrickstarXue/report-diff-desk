import type { WorkbookData } from '@shared/types'

/** 会话内存缓存：工作簿按 id 持有，避免大对象反复过 IPC */
const cache = new Map<string, WorkbookData>()

export function putWorkbook(wb: WorkbookData): WorkbookData {
  cache.set(wb.id, wb)
  return wb
}

export function getWorkbook(id: string): WorkbookData | undefined {
  return cache.get(id)
}
