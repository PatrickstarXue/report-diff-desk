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
  /** pdf：原始文件 base64，renderer 端转 blob 用内置查看器展示 */
  pdfBase64?: string
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

// —— 表样核对 ——

/** 单元格矩形范围（0 起始，含端点）；仅供锚点合并区裁剪使用 */
export interface CellRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** 规则表：位置键 `"row,col"`（0 起始）→ 规则值；空串表示该格不参与比对 */
export type RuleTable = Record<string, string>

/** 一对表的规则表 */
export interface RuleTablePair {
  left: RuleTable
  right: RuleTable
}

/** 表样中的一个「数据格」 */
export interface TemplateCellRef {
  /** 0 起始行号 */
  row: number
  /** 0 起始列号 */
  col: number
  /** 行标签：正常为行路径（`贴现/银承/3个月（含）以内`），降级为 `第6行` */
  rowPath: string
  /** 列标签：正常为列路径（`发生额`），降级为列字母（`D`） */
  colPath: string
  text: string
  num: number | null
  /** 种子规则值 = `${rowPath}_${colPath}` */
  seed: string
}

/** 一张表解析后的表样视图 */
export interface TemplateSheet {
  /** 表样键：文件名去扩展名，如 "R06" */
  key: string
  /** 表号：文件名中「字母+数字」的数字部分去前导零，如 "6"；提不出为 null */
  tableNo: string | null
  fileName: string
  workbookId: string
  sheetName: string
  cells: TemplateCellRef[]
  /** 锚点未识别：cells 只有位置/文本/数值，行/列标签已退化为行列位置 */
  degraded: boolean
  /** 锚点命中的格（0 起始）与命中的候选词，供界面提示「这个报表认的是哪个词」；降级时缺席 */
  anchor?: { row: number; col: number; word: string }
  error?: string
}

export type TemplateDiffKind = 'diff' | 'left-only-value' | 'right-only-value'

export interface TemplateDiff {
  /** 配对的规则值（两侧相同） */
  rule: string
  leftRow: number
  leftCol: number
  rightRow: number
  rightCol: number
  leftText: string
  rightText: string
  leftNum: number | null
  rightNum: number | null
  /** |左-右| / max(|左|,|右|)；单侧有值时为 null */
  relDiff: number | null
  kind: TemplateDiffKind
}

/** 未配上的条目：格子 + 其生效规则值（规则表覆盖 > 种子） */
export interface TemplateRuleEntry {
  cell: TemplateCellRef
  rule: string
}

/** 同一个规则值在一侧出现多次 → 该值整体不参与配对 */
export interface TemplateDuplicateRule {
  side: 'left' | 'right'
  rule: string
  count: number
}

export interface TemplatePairResult {
  tableNo: string | null
  leftFile: string
  rightFile: string
  left: TemplateSheet | null
  right: TemplateSheet | null
  diffs: TemplateDiff[]
  duplicateRules: TemplateDuplicateRule[]
  /** 规则值只在左侧出现 */
  onlyInLeft: TemplateRuleEntry[]
  /** 规则值只在右侧出现 */
  onlyInRight: TemplateRuleEntry[]
  totalCompared: number
}

export interface TemplateCheckResult {
  pairs: TemplatePairResult[]
  unmatchedLeft: string[]
  unmatchedRight: string[]
  threshold: number
  totalDiffs: number
  generatedAt: string
}

/** 规则表配置。v1（按坐标的人工配对/忽略）不做迁移，读到非 v2 一律按空配置 */
export interface AlignConfig {
  version: 2
  /** 键：`左表样键|右表样键` */
  ruleTables: Record<string, RuleTablePair>
  /** 锚点词候选，按序尝试；缺席时用默认「项目」 */
  anchors?: string[]
}

/** 手动指定的表对关系（表号提不出或冲突时用），仅本次生效 */
export interface TemplateTablePair {
  leftId: string
  rightId: string
}

export interface TemplateCheckRequest {
  leftIds: string[]
  rightIds: string[]
  /** 优先于按表号自动配对 */
  manualTablePairs?: TemplateTablePair[]
  /** 已保存的规则表，按 `左键|右键` 索引；缺席的表对全部用种子 */
  ruleTables?: Record<string, RuleTablePair>
  /** 锚点词候选，按序尝试；缺席时用默认「项目」 */
  anchors?: string[]
  threshold: number
}
