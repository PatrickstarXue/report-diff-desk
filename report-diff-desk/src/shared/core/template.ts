import type {
  CellRange,
  RuleTable,
  RuleTablePair,
  SheetData,
  TemplateCellRef,
  TemplateDiff,
  TemplatePairResult,
  TemplateSheet,
  TemplateTablePair,
  WorkbookData
} from '../types'
import { buildMergeSpans } from './merge'
import { toNumeric } from './numeric'
import { colLetter } from './sheet-view'

/** 标签文本归一化：去首尾空白，内部连续空白压成单个空格 */
export function normLabel(s: unknown): string {
  return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim()
}

/** 表样键：zip 条目名取最后一段、去扩展名 */
export function templateKeyOf(fileName: string): string {
  return (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.(xlsx|xls)$/i, '')
}

/** 表号：整段匹配 字母+数字，失败再匹配名字开头；都失败返回 null（交给人工配对） */
export function tableNoOf(fileName: string): string | null {
  const base = templateKeyOf(fileName)
  const m = /^([A-Za-z]+)(\d+)$/.exec(base) ?? /^([A-Za-z]+)(\d+)/.exec(base)
  return m ? m[2].replace(/^0+(?=\d)/, '') : null
}

/** 合并填充后的标签矩阵：合并区域内所有格取主格归一化文本，其余取自身文本 */
function mergedLabelMatrix(sheet: SheetData): string[][] {
  const { rowCount, colCount } = sheet
  const m: string[][] = Array.from({ length: rowCount }, () => Array<string>(colCount).fill(''))
  const filled: boolean[][] = Array.from({ length: rowCount }, () =>
    Array<boolean>(colCount).fill(false)
  )
  for (const mg of sheet.merges ?? []) {
    if (mg.r1 >= rowCount || mg.c1 >= colCount) continue
    const r2 = Math.min(mg.r2, rowCount - 1)
    const c2 = Math.min(mg.c2, colCount - 1)
    const t = normLabel(sheet.cells[mg.r1]?.[mg.c1]?.v)
    for (let r = mg.r1; r <= r2; r++) {
      for (let c = mg.c1; c <= c2; c++) {
        m[r][c] = t
        filled[r][c] = true
      }
    }
  }
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      if (!filled[r][c]) m[r][c] = normLabel(sheet.cells[r]?.[c]?.v)
    }
  }
  return m
}

/** 路径拼接：跳过空段，相邻重复段合并 */
function joinPath(parts: string[]): string {
  const out: string[] = []
  for (const p of parts) {
    if (p && p !== out[out.length - 1]) out.push(p)
  }
  return out.join('/')
}

/** 种子规则值：行标签 + 列标签 */
function ruleValueOf(rowPath: string, colPath: string): string {
  return `${rowPath}_${colPath}`
}

/** 默认锚点词：报表标签区左上角那一格的文本 */
export const DEFAULT_ANCHORS = ['项目']

/** 比较用：去掉全部空白，避免「项 目」这类排版空格导致漏匹配 */
function bareLabel(s: string): string {
  return s.replace(/\s+/g, '')
}

/** 候选词清洗：去空白项；一个都不剩时回落到默认锚点 */
function resolveAnchors(anchors?: string[]): string[] {
  const list = (Array.isArray(anchors) ? anchors : [])
    .map((s) => normLabel(s))
    .filter((s) => bareLabel(s) !== '')
  return list.length > 0 ? list : DEFAULT_ANCHORS
}

/** 锚点：归一化文本命中候选词的格；按候选词顺序尝试，每个词左上优先 */
function findAnchor(m: string[][], anchors: string[]): { r: number; c: number } | null {
  for (const word of anchors) {
    const want = bareLabel(word)
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (bareLabel(m[r][c]) === want) return { r, c }
      }
    }
  }
  return null
}

/** 把范围裁剪到工作表边界内 */
function clampRange(r: CellRange, sheet: SheetData): CellRange {
  const cl = (v: number, max: number): number => Math.max(0, Math.min(v, max))
  return {
    r1: cl(r.r1, sheet.rowCount - 1),
    c1: cl(r.c1, sheet.colCount - 1),
    r2: cl(r.r2, sheet.rowCount - 1),
    c2: cl(r.c2, sheet.colCount - 1)
  }
}

/**
 * 降级解析：锚点缺失或表头区无数据列时使用。
 * 只取全表可数值化的格（合并覆盖格跳过），行/列标签退化为行列位置。
 */
function degradedSheet(
  base: Omit<TemplateSheet, 'cells' | 'degraded' | 'error'>,
  sheet: SheetData,
  error?: string
): TemplateSheet {
  const spans = buildMergeSpans(sheet.merges, sheet.rowCount, sheet.colCount)
  const cells: TemplateCellRef[] = []
  for (let r = 0; r < sheet.rowCount; r++) {
    for (let c = 0; c < sheet.colCount; c++) {
      if (spans[r]?.[c]?.rowspan === 0) continue
      const raw = sheet.cells[r]?.[c] ?? null
      const num = toNumeric(raw)
      if (num === null) continue
      const rowPath = `第${r + 1}行`
      const colPath = colLetter(c)
      cells.push({
        row: r,
        col: c,
        rowPath,
        colPath,
        text: normLabel(raw?.v),
        num,
        seed: ruleValueOf(rowPath, colPath)
      })
    }
  }
  return error ? { ...base, cells, degraded: true, error } : { ...base, cells, degraded: true }
}

/**
 * 解析单张表：定位表头区与标签列，提取「有值行」及其全部数据格，并为每格生成种子规则值。
 * 表头区由锚点格（文本命中锚点词，默认「项目」）的合并范围决定；
 * 找不到锚点时降级为全表位置解析，不再报错中止。
 */
export function parseTemplateSheet(input: {
  sheet: SheetData
  fileName: string
  workbookId: string
  /** 锚点词候选，按序尝试；缺席或全是空串时用默认「项目」 */
  anchors?: string[]
}): TemplateSheet {
  const { sheet, fileName, workbookId, anchors } = input
  const base = {
    key: templateKeyOf(fileName),
    tableNo: tableNoOf(fileName),
    fileName,
    workbookId,
    sheetName: sheet.name
  }

  if (sheet.rowCount === 0 || sheet.colCount === 0) {
    return degradedSheet(base, sheet, '工作表为空')
  }

  const m = mergedLabelMatrix(sheet)
  const a = findAnchor(m, resolveAnchors(anchors))
  if (!a) return degradedSheet(base, sheet)

  const mg = (sheet.merges ?? []).find((x) => x.r1 === a.r && x.c1 === a.c)
  const headerRange: CellRange = mg
    ? clampRange({ r1: mg.r1, c1: mg.c1, r2: mg.r2, c2: mg.c2 }, sheet)
    : { r1: a.r, c1: a.c, r2: a.r, c2: a.c }

  const labelEnd = headerRange.c2
  const dataStartRow = headerRange.r2 + 1
  const dataStartCol = labelEnd + 1

  // 列路径：表头行范围内有标签的列才是数据列
  const colPaths = new Map<number, string>()
  for (let c = dataStartCol; c < sheet.colCount; c++) {
    const parts: string[] = []
    for (let r = headerRange.r1; r <= headerRange.r2; r++) parts.push(m[r]?.[c] ?? '')
    const p = joinPath(parts)
    if (p) colPaths.set(c, p)
  }
  // 表头区找不到数据列时同样降级，让用户用规则表人工维护
  if (colPaths.size === 0) return degradedSheet(base, sheet)

  const spans = buildMergeSpans(sheet.merges, sheet.rowCount, sheet.colCount)
  const cells: TemplateCellRef[] = []
  for (let r = dataStartRow; r < sheet.rowCount; r++) {
    const parts: string[] = []
    for (let c = 0; c <= labelEnd; c++) parts.push(m[r]?.[c] ?? '')
    const rowPath = joinPath(parts)
    if (!rowPath) continue

    const rowCells: TemplateCellRef[] = []
    for (const [c, colPath] of colPaths) {
      // 合并覆盖格跳过，值归主格，避免同一数值重复计数
      if (spans[r]?.[c]?.rowspan === 0) continue
      const raw = sheet.cells[r]?.[c] ?? null
      rowCells.push({
        row: r,
        col: c,
        rowPath,
        colPath,
        text: normLabel(raw?.v),
        num: toNumeric(raw),
        seed: ruleValueOf(rowPath, colPath)
      })
    }
    // 只按「有没有数据格」判行，不要求格里有数值：整行为空的行必须保留，
    // 否则「一侧为空、另一侧有值」会配不上，退化成未配上而不是判据表里的「单侧有值」。
    // 注释行/表尾行仍被自然排除——它们的数据区被整行合并覆盖（rowCells 为空），或标签列为空（rowPath 为空）。
    if (rowCells.length > 0) cells.push(...rowCells)
  }

  return { ...base, cells, degraded: false, anchor: { row: a.r, col: a.c } }
}

/** 取工作簿第一个 sheet 解析（本项目报表均为单 sheet） */
export function parseWorkbook(wb: WorkbookData, anchors?: string[]): TemplateSheet {
  const name = wb.sheetNames[0]
  const sheet = name ? wb.sheets[name] : undefined
  const base = {
    key: templateKeyOf(wb.fileName),
    tableNo: tableNoOf(wb.fileName),
    fileName: wb.fileName,
    workbookId: wb.id,
    sheetName: ''
  }
  if (!sheet) return { ...base, cells: [], degraded: true, error: '工作簿中没有工作表' }
  return parseTemplateSheet({ sheet, fileName: wb.fileName, workbookId: wb.id, anchors })
}

/** 表对配对结果 */
export interface TemplatePairing {
  pairs: { left: WorkbookData; right: WorkbookData }[]
  unmatchedLeft: string[]
  unmatchedRight: string[]
}

/**
 * 按表号自动配对；manualTablePairs 指定的表对优先并占用名额。
 * 表号提不出或一侧出现多个同号候选时不自动配对，交给人工指定。
 */
export function pairTemplateWorkbooks(
  left: WorkbookData[],
  right: WorkbookData[],
  manualTablePairs: TemplateTablePair[] = []
): TemplatePairing {
  const pairs: { left: WorkbookData; right: WorkbookData }[] = []
  const usedL = new Set<string>()
  const usedR = new Set<string>()

  for (const mp of manualTablePairs) {
    const l = left.find((w) => w.id === mp.leftId)
    const r = right.find((w) => w.id === mp.rightId)
    if (!l || !r || usedL.has(l.id) || usedR.has(r.id)) continue
    pairs.push({ left: l, right: r })
    usedL.add(l.id)
    usedR.add(r.id)
  }

  const byNo = new Map<string, WorkbookData[]>()
  for (const w of right) {
    const no = tableNoOf(w.fileName)
    if (!no) continue
    const list = byNo.get(no)
    if (list) list.push(w)
    else byNo.set(no, [w])
  }

  for (const w of left) {
    if (usedL.has(w.id)) continue
    const no = tableNoOf(w.fileName)
    if (!no) continue
    const cands = byNo.get(no)
    if (!cands || cands.length !== 1 || usedR.has(cands[0].id)) continue
    pairs.push({ left: w, right: cands[0] })
    usedL.add(w.id)
    usedR.add(cands[0].id)
  }

  return {
    pairs,
    unmatchedLeft: left.filter((w) => !usedL.has(w.id)).map((w) => w.fileName),
    unmatchedRight: right.filter((w) => !usedR.has(w.id)).map((w) => w.fileName)
  }
}

export interface TemplateCheckOptions {
  threshold: number
  /** 当前表对的规则表；缺席时全部用种子 */
  ruleTable?: RuleTablePair
}

/** 生效规则值：规则表有该位置则以其为准（空串 = 不比对），否则用种子。比较前 trim */
export function effectiveRule(table: RuleTable | undefined, cell: TemplateCellRef): string {
  const v = table?.[`${cell.row},${cell.col}`]
  return (v === undefined ? cell.seed : v).trim()
}

/** 规则值 → 该值对应的全部格子（空规则值不入索引） */
function indexByRule(
  cells: TemplateCellRef[],
  table: RuleTable | undefined
): Map<string, TemplateCellRef[]> {
  const out = new Map<string, TemplateCellRef[]>()
  for (const c of cells) {
    const rule = effectiveRule(table, c)
    if (!rule) continue
    const list = out.get(rule)
    if (list) list.push(c)
    else out.set(rule, [c])
  }
  return out
}

/** 两侧规则值相同的格比值：命中阈值产出 diff，一侧为空产出单侧有值，其余跳过 */
function collect(
  out: TemplateDiff[],
  l: TemplateCellRef,
  r: TemplateCellRef,
  rule: string,
  threshold: number
): void {
  const a = l.num
  const b = r.num
  if (a === null && b === null) return
  const common = {
    rule,
    leftRow: l.row,
    leftCol: l.col,
    rightRow: r.row,
    rightCol: r.col,
    leftText: l.text,
    rightText: r.text,
    leftNum: a,
    rightNum: b
  }
  if (a === null || b === null) {
    out.push({
      ...common,
      relDiff: null,
      kind: a === null ? 'right-only-value' : 'left-only-value'
    })
    return
  }
  const denom = Math.max(Math.abs(a), Math.abs(b))
  if (denom === 0) return // 双 0
  const relDiff = Math.abs(a - b) / denom
  if (relDiff > threshold) out.push({ ...common, relDiff, kind: 'diff' })
}

function sortResult(res: TemplatePairResult): void {
  const byRule = (a: { rule: string }, b: { rule: string }): number =>
    a.rule.localeCompare(b.rule, 'zh')
  res.diffs.sort(byRule)
  res.onlyInLeft.sort(byRule)
  res.onlyInRight.sort(byRule)
}

/** 逐表比对：按规则值等值配对；左右任一解析失败时返回空结果（错误随 TemplateSheet.error 传出） */
export function checkTemplates(
  left: TemplateSheet,
  right: TemplateSheet,
  opts: TemplateCheckOptions
): TemplatePairResult {
  const res: TemplatePairResult = {
    tableNo: left.tableNo ?? right.tableNo,
    leftFile: left.fileName,
    rightFile: right.fileName,
    left,
    right,
    diffs: [],
    duplicateRules: [],
    onlyInLeft: [],
    onlyInRight: [],
    totalCompared: 0
  }
  if (left.error || right.error) return res

  const li = indexByRule(left.cells, opts.ruleTable?.left)
  const ri = indexByRule(right.cells, opts.ruleTable?.right)

  // 规则值重复的整值不参与配对（用户在「规则值重复」里能看到并去修），因此也不进「未配上」
  const dup = new Set<string>()
  for (const [rule, cs] of li) {
    if (cs.length > 1) {
      dup.add(rule)
      res.duplicateRules.push({ side: 'left', rule, count: cs.length })
    }
  }
  for (const [rule, cs] of ri) {
    if (cs.length > 1) {
      dup.add(rule)
      res.duplicateRules.push({ side: 'right', rule, count: cs.length })
    }
  }

  for (const [rule, cs] of li) {
    if (dup.has(rule)) continue
    const r = ri.get(rule)
    if (r) {
      res.totalCompared++
      collect(res.diffs, cs[0], r[0], rule, opts.threshold)
    } else {
      res.onlyInLeft.push({ cell: cs[0], rule })
    }
  }
  for (const [rule, cs] of ri) {
    if (dup.has(rule) || li.has(rule)) continue
    res.onlyInRight.push({ cell: cs[0], rule })
  }

  sortResult(res)
  return res
}
