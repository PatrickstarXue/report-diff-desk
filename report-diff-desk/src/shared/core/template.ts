import type {
  AlignConfig,
  CellRange,
  SheetData,
  TemplateCellRef,
  TemplateDiff,
  TemplateOnlyEntry,
  TemplatePairResult,
  TemplateSheet,
  TemplateTablePair,
  WorkbookData
} from '../types'
import { buildMergeSpans } from './merge'
import { toNumeric } from './numeric'

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

/** 锚点：归一化文本等于「项 目」的格，左上优先 */
function findAnchor(m: string[][]): { r: number; c: number } | null {
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (/^项\s*目$/.test(m[r][c])) return { r, c }
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

/** 解析失败时的空表样（带 error），保证返回类型稳定 */
function emptySheet(
  base: Omit<TemplateSheet, 'headerRange' | 'labelEnd' | 'dataStartRow' | 'dataStartCol' | 'cells' | 'manualHeader'>,
  error: string
): TemplateSheet {
  return {
    ...base,
    headerRange: { r1: 0, c1: 0, r2: 0, c2: 0 },
    labelEnd: 0,
    dataStartRow: 1,
    dataStartCol: 1,
    cells: [],
    manualHeader: false,
    error
  }
}

/**
 * 解析单张表：定位表头区与标签列，提取「有值行」及其全部数据格。
 * 表头区默认由「项 目」锚点格的合并范围决定；cfg 中有该表样的人工范围时优先使用。
 */
export function parseTemplateSheet(
  input: { sheet: SheetData; fileName: string; workbookId: string },
  cfg?: AlignConfig
): TemplateSheet {
  const { sheet, fileName, workbookId } = input
  const key = templateKeyOf(fileName)
  const base = {
    key,
    tableNo: tableNoOf(fileName),
    fileName,
    workbookId,
    sheetName: sheet.name
  }

  if (sheet.rowCount === 0 || sheet.colCount === 0) {
    return emptySheet(base, '工作表为空')
  }

  const m = mergedLabelMatrix(sheet)
  const manual = cfg?.templates?.[key]?.headerRange
  let headerRange: CellRange

  if (manual) {
    headerRange = clampRange(manual, sheet)
  } else {
    const a = findAnchor(m)
    if (!a) return emptySheet(base, '未找到「项 目」锚点，请手动指定表样范围')
    const mg = (sheet.merges ?? []).find((x) => x.r1 === a.r && x.c1 === a.c)
    headerRange = mg
      ? clampRange({ r1: mg.r1, c1: mg.c1, r2: mg.r2, c2: mg.c2 }, sheet)
      : { r1: a.r, c1: a.c, r2: a.r, c2: a.c }
  }

  const labelEnd = headerRange.c2
  const dataStartRow = headerRange.r2 + 1
  const dataStartCol = labelEnd + 1
  const partial = {
    ...base,
    headerRange,
    labelEnd,
    dataStartRow,
    dataStartCol,
    manualHeader: !!manual
  }

  // 列路径：表头行范围内有标签的列才是数据列
  const colPaths = new Map<number, string>()
  for (let c = dataStartCol; c < sheet.colCount; c++) {
    const parts: string[] = []
    for (let r = headerRange.r1; r <= headerRange.r2; r++) parts.push(m[r]?.[c] ?? '')
    const p = joinPath(parts)
    if (p) colPaths.set(c, p)
  }
  if (colPaths.size === 0) {
    return { ...partial, cells: [], error: '表头区未识别到数据列，请手动指定表样范围' }
  }

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
      const cell = sheet.cells[r]?.[c] ?? null
      rowCells.push({
        row: r,
        col: c,
        rowPath,
        colPath,
        text: normLabel(cell?.v),
        num: toNumeric(cell)
      })
    }
    // 有值行：至少一个数据格可数值化（注释行/表尾行因此被自然排除）
    if (rowCells.some((x) => x.num !== null)) cells.push(...rowCells)
  }

  return { ...partial, cells }
}

/** 取工作簿第一个 sheet 解析（本项目报表均为单 sheet） */
export function parseWorkbook(wb: WorkbookData, cfg?: AlignConfig): TemplateSheet {
  const name = wb.sheetNames[0]
  const sheet = name ? wb.sheets[name] : undefined
  if (!sheet) {
    return emptySheet(
      {
        key: templateKeyOf(wb.fileName),
        tableNo: tableNoOf(wb.fileName),
        fileName: wb.fileName,
        workbookId: wb.id,
        sheetName: ''
      },
      '工作簿中没有工作表'
    )
  }
  return parseTemplateSheet({ sheet, fileName: wb.fileName, workbookId: wb.id }, cfg)
}

/** 表对配对结果 */
export interface TemplatePairing {
  pairs: { left: WorkbookData; right: WorkbookData }[]
  unmatchedLeft: string[]
  unmatchedRight: string[]
}

/**
 * 按表号自动配对；manualPairs 指定的表对优先并占用名额。
 * 表号提不出或一侧出现多个同号候选时不自动配对，交给人工指定。
 */
export function pairTemplateWorkbooks(
  left: WorkbookData[],
  right: WorkbookData[],
  manualPairs: TemplateTablePair[] = []
): TemplatePairing {
  const pairs: { left: WorkbookData; right: WorkbookData }[] = []
  const usedL = new Set<string>()
  const usedR = new Set<string>()

  for (const mp of manualPairs) {
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
  config?: AlignConfig
}

/** (行路径|列路径) → 单元格；同键重复时追加序号 #2、#3，避免静默错配 */
function indexCells(cells: TemplateCellRef[]): Map<string, TemplateCellRef> {
  const seen = new Map<string, number>()
  const out = new Map<string, TemplateCellRef>()
  for (const c of cells) {
    const base = `${c.rowPath} ${c.colPath}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.set(n === 1 ? base : `${base} #${n}`, c)
  }
  return out
}

function toOnly(side: 'left' | 'right', c: TemplateCellRef): TemplateOnlyEntry {
  return { side, rowPath: c.rowPath, colPath: c.colPath, row: c.row, col: c.col, text: c.text }
}

/** 两侧同键单元格比值：命中阈值产出 diff，一侧为空产出单侧有值，其余跳过 */
function collect(
  out: TemplateDiff[],
  l: TemplateCellRef,
  r: TemplateCellRef,
  threshold: number
): void {
  const a = l.num
  const b = r.num
  if (a === null && b === null) return
  const common = {
    rowPath: l.rowPath,
    colPath: l.colPath,
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

const atLeft = (d: TemplateDiff, r: number, c: number): boolean =>
  d.leftRow === r && d.leftCol === c
const atRight = (d: TemplateDiff, r: number, c: number): boolean =>
  d.rightRow === r && d.rightCol === c

/**
 * 套用人工配对与忽略名单：先移除涉及这两个格子的自动结果，再按人工配对重新产出条目。
 * 规则的表样键必须与当前表对一致，否则整条忽略（换了一套报表后旧规则自然失效，不误套）。
 */
function applyRules(res: TemplatePairResult, cfg: AlignConfig | undefined, threshold: number): void {
  const left = res.left
  const right = res.right
  if (!cfg || !left || !right || left.error || right.error) return
  const rules = cfg.pairs.filter((p) => p.left === left.key && p.right === right.key)
  if (rules.length === 0) return

  for (const rule of rules) {
    res.diffs = res.diffs.filter((d) => !atLeft(d, rule.fromRow, rule.fromCol))
    res.onlyInLeft = res.onlyInLeft.filter(
      (e) => !(e.row === rule.fromRow && e.col === rule.fromCol)
    )

    if (rule.ignored) continue
    if (rule.toRow === undefined || rule.toCol === undefined) continue

    res.diffs = res.diffs.filter((d) => !atRight(d, rule.toRow as number, rule.toCol as number))
    res.onlyInRight = res.onlyInRight.filter(
      (e) => !(e.row === rule.toRow && e.col === rule.toCol)
    )

    const l = left.cells.find((c) => c.row === rule.fromRow && c.col === rule.fromCol)
    const r = right.cells.find((c) => c.row === rule.toRow && c.col === rule.toCol)
    if (!l || !r) continue
    res.manualPairs++
    const before = res.diffs.length
    collect(res.diffs, l, r, threshold)
    if (res.diffs.length > before) res.diffs[res.diffs.length - 1].manual = true
  }
}

function sortResult(res: TemplatePairResult): void {
  const byPath = (a: { rowPath: string; colPath: string }, b: { rowPath: string; colPath: string }): number =>
    a.rowPath.localeCompare(b.rowPath, 'zh') || a.colPath.localeCompare(b.colPath, 'zh')
  res.diffs.sort(byPath)
  res.onlyInLeft.sort(byPath)
  res.onlyInRight.sort(byPath)
}

/** 逐表配对并比对；左右任一解析失败时返回空结果（错误随 TemplateSheet.error 传出） */
export function checkTemplates(
  left: TemplateSheet,
  right: TemplateSheet,
  opts: TemplateCheckOptions
): TemplatePairResult {
  const res: TemplatePairResult = {
    tableNo: left.tableNo ?? right.tableNo,
    pairLabel: `${left.fileName} ↔ ${right.fileName}`,
    leftFile: left.fileName,
    rightFile: right.fileName,
    left,
    right,
    diffs: [],
    onlyInLeft: [],
    onlyInRight: [],
    totalCompared: 0,
    manualPairs: 0
  }
  if (left.error || right.error) return res

  const li = indexCells(left.cells)
  const ri = indexCells(right.cells)

  for (const [k, lc] of li) {
    const rc = ri.get(k)
    if (!rc) {
      res.onlyInLeft.push(toOnly('left', lc))
      continue
    }
    res.totalCompared++
    collect(res.diffs, lc, rc, opts.threshold)
  }
  for (const [k, rc] of ri) {
    if (!li.has(k)) res.onlyInRight.push(toOnly('right', rc))
  }

  applyRules(res, opts.config, opts.threshold)
  sortResult(res)
  return res
}
