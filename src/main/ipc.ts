import { app, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { IPC } from '@shared/ipc'
import { matchWorkbookPairs } from '@shared/core/pairing'
import type {
  BatchCompareResult,
  CompareRequest,
  DocContent,
  ExportRequest,
  ExportResult,
  LoadReportResult,
  MappingRows,
  OpenFileKind,
  OpenFileRequest,
  OpenFileResult,
  RecentEntry,
  SheetData
} from '@shared/types'
import { loadDocFile, loadReportFile } from './file/loader'
import { parseExcel } from './file/excel'
import { buildExcelZipBuffer } from './export/excel'
import { buildHtmlReport } from './export/html'
import { getWorkbook } from './store'

const FILE_FILTERS: Record<OpenFileKind, { name: string; extensions: string[] }[]> = {
  report: [{ name: 'Excel 报表 / Zip 压缩包', extensions: ['xlsx', 'xls', 'zip'] }],
  zip: [{ name: 'Zip 压缩包', extensions: ['zip'] }],
  mapping: [{ name: 'Excel 映射表', extensions: ['xlsx', 'xls'] }],
  doc: [{ name: '口径文档', extensions: ['docx', 'pdf', 'txt'] }]
}

function recentPath(): string {
  return join(app.getPath('userData'), 'recent.json')
}

function lastDirPath(): string {
  return join(app.getPath('userData'), 'last-dir.json')
}

/** 上次打开文件对话框的目录（持久化到 userData），作为下次对话框默认目录 */
let lastOpenDir: string | null = null

async function loadLastDir(): Promise<void> {
  try {
    const data = JSON.parse(await readFile(lastDirPath(), 'utf-8'))
    if (typeof data === 'string') lastOpenDir = data
  } catch {
    lastOpenDir = null
  }
}

function rememberDir(path: string): void {
  lastOpenDir = dirname(path)
  void writeFile(lastDirPath(), JSON.stringify(lastOpenDir), 'utf-8').catch(() => {
    // 写失败静默，仅影响下次默认目录
  })
}

export function registerIpc(): void {
  void loadLastDir()

  ipcMain.handle(IPC.dialogOpenFile, async (_e, req: OpenFileRequest): Promise<OpenFileResult> => {
    const filters = FILE_FILTERS[req?.kind] ?? FILE_FILTERS.report
    const r = await dialog.showOpenDialog({
      title: req?.title,
      defaultPath: lastOpenDir ?? undefined,
      filters,
      properties: ['openFile']
    })
    if (!r.canceled && r.filePaths[0]) {
      rememberDir(r.filePaths[0])
      return { canceled: false, path: r.filePaths[0] }
    }
    return { canceled: true }
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

  ipcMain.handle(IPC.compareRun, async (_e, req: CompareRequest): Promise<BatchCompareResult> => {
    if (!Array.isArray(req?.baseIds) || !Array.isArray(req?.currIds)) {
      throw new Error('无效的比对请求')
    }
    const base = req.baseIds.map((id) => getWorkbook(id)).filter((w) => w !== undefined)
    const curr = req.currIds.map((id) => getWorkbook(id)).filter((w) => w !== undefined)
    if (base.length !== req.baseIds.length || curr.length !== req.currIds.length) {
      throw new Error('部分工作簿不存在或已被释放')
    }
    if (base.length === 0 || curr.length === 0) throw new Error('请先选择两份报表')
    return matchWorkbookPairs(base, curr, typeof req.threshold === 'number' ? req.threshold : 0.5)
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

  ipcMain.handle(IPC.docLoad, async (_e, req: { path: string }): Promise<DocContent> => {
    if (typeof req?.path !== 'string') throw new Error('无效的口径文档路径')
    return loadDocFile(req.path)
  })

  ipcMain.handle(IPC.exportRun, async (_e, req: ExportRequest): Promise<ExportResult> => {
    if (!req?.compare || (req.format !== 'excel' && req.format !== 'html')) {
      throw new Error('无效的导出请求')
    }
    // excel 格式导出为 zip 压缩包（每对文件一个 xlsx，保持原表格式）
    const ext = req.format === 'excel' ? 'zip' : 'html'
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:]/g, '')
      .replace('T', '_')
    let target = req.targetPath
    if (!target) {
      const r = await dialog.showSaveDialog({
        title: '导出比对结果',
        defaultPath: join(app.getPath('documents'), `比对结果_${stamp}.${ext}`),
        filters: [
          { name: ext === 'zip' ? 'Zip 压缩包' : 'HTML 报告', extensions: [ext] }
        ]
      })
      if (r.canceled || !r.filePath) return { canceled: true }
      target = r.filePath
    }

    if (req.format === 'excel') {
      if (typeof req.basePath !== 'string' || typeof req.currPath !== 'string') {
        throw new Error('缺少原文件路径，无法导出')
      }
      try {
        await writeFile(target, await buildExcelZipBuffer(req.compare, req.basePath, req.currPath))
      } catch (err) {
        throw new Error(
          `原报表读取失败（文件可能已被移动或修改），请重新加载后再导出：${err instanceof Error ? err.message : String(err)}`
        )
      }
    } else {
      await writeFile(target, buildHtmlReport(req.compare), 'utf-8')
    }
    shell.showItemInFolder(target)
    return { canceled: false, path: target }
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
