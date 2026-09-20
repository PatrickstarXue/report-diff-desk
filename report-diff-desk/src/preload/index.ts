import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { Api } from '@shared/api'
import type {
  AlignConfig,
  CompareRequest,
  ExportRequest,
  OpenFileRequest,
  RecentEntry,
  TemplateCheckRequest
} from '@shared/types'

// 逐 channel 包装 invoke，不向 renderer 暴露 ipcRenderer 本体
const api: Api = {
  openFile: (req: OpenFileRequest) => ipcRenderer.invoke(IPC.dialogOpenFile, req),
  loadReport: (path: string) => ipcRenderer.invoke(IPC.reportLoad, { path }),
  getSheet: (workbookId: string, sheetName: string) =>
    ipcRenderer.invoke(IPC.reportGetSheet, { workbookId, sheetName }),
  compare: (req: CompareRequest) => ipcRenderer.invoke(IPC.compareRun, req),
  loadMapping: (path: string) => ipcRenderer.invoke(IPC.mappingLoad, { path }),
  loadDoc: (path: string) => ipcRenderer.invoke(IPC.docLoad, { path }),
  getDocLibrary: () => ipcRenderer.invoke(IPC.docLibraryGet),
  setDocLibrary: (paths: string[]) => ipcRenderer.invoke(IPC.docLibrarySet, { paths }),
  export: (req: ExportRequest) => ipcRenderer.invoke(IPC.exportRun, req),
  getRecent: () => ipcRenderer.invoke(IPC.recentGet),
  setRecent: (items: RecentEntry[]) => ipcRenderer.invoke(IPC.recentSet, { items }),
  checkTemplate: (req: TemplateCheckRequest) => ipcRenderer.invoke(IPC.templateCheck, req),
  getAlignConfig: () => ipcRenderer.invoke(IPC.templateAlignGet),
  setAlignConfig: (cfg: AlignConfig) => ipcRenderer.invoke(IPC.templateAlignSet, { cfg }),
  getVersion: () => ipcRenderer.invoke(IPC.appVersion)
}

contextBridge.exposeInMainWorld('api', api)
