import type {
  BatchCompareResult,
  CompareRequest,
  DocContent,
  ExportRequest,
  ExportResult,
  LoadReportResult,
  MappingRows,
  OpenFileRequest,
  OpenFileResult,
  RecentEntry,
  SheetData
} from './types'

/** preload 暴露给 renderer 的 window.api 契约。修改时 preload/index.ts 必须同步实现。 */
export interface Api {
  openFile(req: OpenFileRequest): Promise<OpenFileResult>
  loadReport(path: string): Promise<LoadReportResult>
  getSheet(workbookId: string, sheetName: string): Promise<SheetData>
  compare(req: CompareRequest): Promise<BatchCompareResult>
  loadMapping(path: string): Promise<MappingRows>
  loadDoc(path: string): Promise<DocContent>
  /** 口径文档库：已加载文档路径的持久化列表 */
  getDocLibrary(): Promise<string[]>
  setDocLibrary(paths: string[]): Promise<void>
  export(req: ExportRequest): Promise<ExportResult>
  getRecent(): Promise<RecentEntry[]>
  setRecent(items: RecentEntry[]): Promise<void>
  /** 应用版本号（Electron app.getVersion） */
  getVersion(): Promise<string>
}
