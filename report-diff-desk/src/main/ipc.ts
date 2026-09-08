import { app, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import { compareWorkbooks } from '@shared/core/engine'
import type {
  CompareRequest,
  CompareResult,
  LoadReportResult,
  MappingRows,
  OpenFileKind,
  OpenFileRequest,
  OpenFileResult,
  RecentEntry,
  SheetData
} from '@shared/types'
import { loadReportFile } from './file/loader'
import { parseExcel } from './file/excel'
import { getWorkbook } from './store'

const FILE_FILTERS: Record<OpenFileKind, { name: string; extensions: string[] }[]> = {
  report: [{ name: 'Excel 报表', extensions: ['xlsx', 'xls'] }],
  zip: [{ name: 'Zip 压缩包', extensions: ['zip'] }],
  mapping: [{ name: 'Excel 映射表', extensions: ['xlsx', 'xls'] }],
  doc: [{ name: '口径文档', extensions: ['docx', 'pdf', 'txt'] }]
}

function recentPath(): string {
  return join(app.getPath('userData'), 'recent.json')
}

export function registerIpc(): void {
  ipcMain.handle(IPC.dialogOpenFile, async (_e, req: OpenFileRequest): Promise<OpenFileResult> => {
    const filters = FILE_FILTERS[req?.kind] ?? FILE_FILTERS.report
    const r = await dialog.showOpenDialog({
      title: req?.title,
      filters,
      properties: ['openFile']
    })
    return r.canceled || !r.filePaths[0] ? { canceled: true } : { canceled: false, path: r.filePaths[0] }
  })

  ipcMain.handle(IPC.reportLoad, async (_e, req: { path: string }): Promise<LoadReportResult> => {
    if (typeof req?.path !== 'string') throw new Error('无效的报表路径')
    try {
      const workbooks = await loadReportFile(req.path)
      return { workbooks }
    } catch (err) {
      return { workbooks: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.reportGetSheet,
    async (_e, req: { workbookId: string; sheetName: string }): Promise<SheetData> => {
      const wb = getWorkbook(req?.workbookId)
      if (!wb) throw new Error('工作簿不存在或已被释放')
      const sheet = wb.sheets[req?.sheetName]
      if (!sheet) throw new Error(`工作表不存在：${req?.sheetName}`)
      return sheet
    }
  )

  ipcMain.handle(IPC.compareRun, async (_e, req: CompareRequest): Promise<CompareResult> => {
    if (typeof req?.baseId !== 'string' || typeof req?.currId !== 'string') {
      throw new Error('无效的比对请求')
    }
    const base = getWorkbook(req.baseId)
    const curr = getWorkbook(req.currId)
    if (!base) throw new Error('上期工作簿不存在或已被释放')
    if (!curr) throw new Error('本期工作簿不存在或已被释放')
    return compareWorkbooks(base, curr, typeof req.threshold === 'number' ? req.threshold : 0.5)
  })

  ipcMain.handle(IPC.mappingLoad, async (_e, req: { path: string }): Promise<MappingRows> => {
    if (typeof req?.path !== 'string') throw new Error('无效的映射表路径')
    const wb = parseExcel(await readFile(req.path), 'mapping', 'file')
    const sheet = wb.sheets[wb.sheetNames[0]]
    const rows: string[][] = []
    for (const row of sheet?.cells ?? []) {
      rows.push([String(row[0]?.v ?? ''), String(row[1]?.v ?? '')])
    }
    return { rows }
  })

  ipcMain.handle(IPC.recentGet, async (): Promise<RecentEntry[]> => {
    try {
      const data = JSON.parse(await readFile(recentPath(), 'utf-8'))
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.recentSet, async (_e, req: { items: RecentEntry[] }): Promise<void> => {
    try {
      await writeFile(recentPath(), JSON.stringify(req?.items ?? []), 'utf-8')
    } catch {
      // 写失败静默降级，不影响主流程
    }
  })
}
