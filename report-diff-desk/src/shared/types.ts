// 全部核心类型。main 与 renderer 共享，必须 JSON 可序列化（无 Map/Set/类实例）。

export type CellValue = number | string | boolean | null

export interface GridCell {
  /** 显示值；公式格为缓存计算值 */
  v: CellValue
  /** 公式文本（若有） */
  f?: string
  /** 原为日期单元格（v 为 ISO 字符串） */
  isDate?: boolean
}

/** 合并区域（0 起始，含端点），对应 Excel !merges */
export interface MergedRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

export interface SheetData {
  name: string
  rowCount: number
  colCount: number
  /** 按行存储，缺省格为 null */
  cells: (GridCell | null)[][]
  /** 合并区域；仅主格（左上角）有值 */
  merges?: MergedRange[]
}

export interface WorkbookData {
  id: string
  fileName: string
  source: 'file' | 'zip'
  sheetNames: string[]
  sheets: Record<string, SheetData>
}

// —— 比对 ——

export type DiffKind = 'increase' | 'decrease' | 'zero-base' | 'new' | 'removed'

export interface CellDiff {
  sheet: string
  /** 展示坐标，如 "C12"（1 起始） */
  ref: string
  row: number
  col: number
  prevValue: CellValue
  currValue: CellValue
  prevNum: number | null
  currNum: number | null
  /** 小数（0.5 = 50%）；zero-base/new 固定 1，removed 固定 -1 */
  changeRate: number | null
  kind: DiffKind
}

export interface CompareResult {
  baseId: string
  currId: string
  baseLabel: string
  currLabel: string
  threshold: number
  sheetsMatched: string[]
  sheetsOnlyInBase: string[]
  sheetsOnlyInCurr: string[]
  /** 仅含命中阈值者，按 sheet → row → col 排序 */
  diffs: CellDiff[]
  totalCellsCompared: number
  generatedAt: string
}

// —— 口径映射与文档 ——

/** 两列映射 Excel 的原样数据（列 0 = 指标名，列 1 = 口径说明） */
export interface MappingRows {
  rows: string[][]
}

export type DocKind = 'docx' | 'pdf' | 'txt' | 'xlsx' | 'xls'

export interface DocContent {
  kind: DocKind
  name: string
  /** 来源文件路径（持久化文档库恢复用） */
  path: string
  /** docx：mammoth 输出的 HTML */
  html?: string
  /** pdf 逐页文本；txt 为单元素数组 */
  pages?: string[]
  /** xlsx/xls：全表数据（含 merges） */
  workbooks?: SheetData[]
}

// —— 最近记录 ——

export interface RecentEntry {
  basePath: string
  currPath: string
  at: string
}

// —— IPC 契约（入参/出参类型） ——

export type OpenFileKind = 'report' | 'zip' | 'mapping' | 'doc'

export interface OpenFileRequest {
  kind: OpenFileKind
  title?: string
}

export interface OpenFileResult {
  canceled: boolean
  path?: string
}

export interface LoadReportResult {
  workbooks: WorkbookData[]
  /** 解析失败时的用户可读错误信息 */
  error?: string
}

export interface CompareRequest {
  /** 工作簿 id 数组，顺序 = 配对顺序 */
  baseIds: string[]
  currIds: string[]
  threshold: number
}

/** 一对文件的比对结果 */
export interface FilePairResult {
  pairLabel: string
  baseFileName: string
  currFileName: string
  compare: CompareResult
}

/** 批量比对结果：按顺序配对的逐份结果 + 未参与列表 */
export interface BatchCompareResult {
  pairs: FilePairResult[]
  unmatchedBase: string[]
  unmatchedCurr: string[]
  totalDiffs: number
}

export interface ExportRequest {
  format: 'excel' | 'html'
  compare: BatchCompareResult
  /** 原文件路径：zip 导出需要重新读取原文件以保留格式 */
  basePath?: string
  currPath?: string
  targetPath?: string
}

export interface ExportResult {
  canceled: boolean
  path?: string
}
