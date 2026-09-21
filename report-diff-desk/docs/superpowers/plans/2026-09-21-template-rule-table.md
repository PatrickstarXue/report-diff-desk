# 表样核对 v2：规则表范式 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 用「左右各一张与报表同形的规则表」取代 v1 的三个人工兜底机制（手动指定表头区 / 网格右键指定配对 / 忽略此项）——两侧规则值相等才参与比对，空串表示不比对。

**架构：** 引擎把配对键从「(行路径, 列路径) 自动推导」换成「规则值显式声明」：每格有一个由解析结果生成的**种子**规则值（`行路径_列路径`；锚点识别失败时降级为 `第N行_列字母`），规则表按位置覆盖种子，两侧等值即成对。规则表按表样对持久化，配置升到 `version: 2`。UI 在「表样核对」模块内分「比对结果」「对比规则」两个子标签页。

**技术栈：** Electron + Vue3 + Element Plus + Pinia + vitest（沿用既有，无新依赖）

**规格：** `docs/superpowers/specs/2026-09-21-template-rule-table-design.md`（取代 `2026-09-20-template-check-design.md` 的人工兜底章节）

---

## 全局约束

- `src/shared/` 是**纯逻辑**：零 Node/Electron/Vue 依赖，只允许 `import type` 引用类型、引用同目录纯函数模块
- **所有 IPC 载荷必须可结构化克隆**：Pinia 响应式 Proxy 直传会抛 `DataCloneError`，渲染进程侧一律 `JSON.parse(JSON.stringify(...))` 深拷贝（`session.ts` 里已有先例与注释）
- `noUnusedLocals: true`：只 import 实际用到的东西
- el-table 的 `cell-click` 里不得用 `column._columnIndex`（合并列下不可靠），统一用 `column.property`（形如 `"c0"`）
- 测试：vitest 覆盖 `src/shared` + `src/main/file` + `src/main/export` + store；**不为 renderer 组件写单测**（node 环境跑不了组件）
- `samples/` 在 `.gitignore` 里，**不可提交**任何样例文件
- `ELECTRON_RUN_AS_NODE=1` 在本机 shell 存在（会阻止 Electron 启动）——**不要**尝试 `npm run dev`；GUI 冒烟由人类伙伴执行
- 基线：`npm test` = 117 passed + 2 skipped；本轮会改写大量既有用例

**类型检查在本次重构期间的预期状态：** 这是一次跨文件的类型重构，任务 1、2 结束时 `npm run typecheck` **会在尚未适配的调用点报错**（每个任务里逐条列出了具体文件）。这是预期的——不要为了让 typecheck 变绿去改属于后续任务的文件。你的验证证据是你自己那部分文件的聚焦测试。

---

## 文件结构

| 文件 | 职责 | 改动 |
|---|---|---|
| `src/shared/types.ts` | 全部类型 | 表样核对段落重写为 v2（规则表、条目、去坐标规则） |
| `src/shared/core/template.ts` | 解析 + 配对 + 比对引擎 | 种子生成、降级解析、等值配对；删 `applyRules` 等 |
| `src/shared/core/sheet-view.ts` | 网格渲染纯函数 | 新增 `colLetter(c)`（0 起始列号 → 列字母） |
| `src/main/align.ts` | 规则表持久化 | 配置形状改 v2，非 v2 按空配置 |
| `src/main/ipc.ts` | IPC handler | `template:check` 按表对键取规则表传给引擎 |
| `src/renderer/src/stores/session.ts` | 全局状态 | 规则表草稿、脏标记、保存/重置；删 `setTemplateHeaderRange` |
| `src/renderer/src/components/RuleTable.vue` | **新建**：单侧规则表网格 | 可编辑、整行/整列批量设置 |
| `src/renderer/src/components/RulePanel.vue` | **新建**：对比规则子标签页 | 左右并排 + 工具栏 |
| `src/renderer/src/components/TemplatePanel.vue` | 表样核对页 | 加子标签页；删全部人工配对/忽略/范围机制 |
| `src/renderer/src/components/TemplateGrid.vue` | 单侧网格（高亮与定位） | 删右键菜单与 `pick-pair` emit |
| `src/shared/core/__tests__/template.spec.ts` | 引擎单测 | 改写 |
| `src/main/file/__tests__/template-samples.spec.ts` | 真实样例端到端 | 改写 |
| `src/renderer/src/stores/__tests__/session.template.spec.ts` | store 单测 | 改写 |
| `CLAUDE.md` | 项目说明 | 更新模块与测试描述 |

---

## 任务 1：类型 v2 与规则值配对引擎

**文件：**
- 修改：`src/shared/types.ts`（表样核对段落）
- 修改：`src/shared/core/template.ts`
- 修改：`src/shared/core/sheet-view.ts`（新增 `colLetter`）
- 测试：`src/shared/core/__tests__/template.spec.ts`

- [ ] **步骤 1：在 `sheet-view.ts` 新增 `colLetter`**

在 `src/shared/core/sheet-view.ts` 的 `colLetters` 之后追加：

```ts
/** 0 起始列号 → 列字母（0 → A、25 → Z、26 → AA） */
export function colLetter(col: number): string {
  return colLetters(col + 1)[col]
}
```

- [ ] **步骤 2：改写 `types.ts` 的表样核对段落**

把 `src/shared/types.ts` 中 `// —— 表样核对 ——` 到文件末尾的整段替换为：

```ts
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
  threshold: number
}
```

- [ ] **步骤 3：改写 `template.ts` 的解析段落**

在 `src/shared/core/template.ts` 中：

1. 把顶部 type import 改为：
```ts
import type {
  CellRange,
  RuleTable,
  RuleTablePair,
  SheetData,
  TemplateCellRef,
  TemplateDiff,
  TemplatePairResult,
  TemplateRuleEntry,
  TemplateSheet,
  TemplateTablePair,
  WorkbookData
} from '../types'
import { buildMergeSpans } from './merge'
import { toNumeric } from './numeric'
import { colLetter } from './sheet-view'
```

2. 删除 `emptySheet` 函数（用字面量替代，见下）。

3. 在 `joinPath` 之后新增：
```ts
/** 种子规则值：行标签 + 列标签 */
function ruleValueOf(rowPath: string, colPath: string): string {
  return `${rowPath}_${colPath}`
}
```

4. 把 `parseTemplateSheet` 整体替换为：

```ts
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
 * 锚点「项 目」的合并范围即表头区；找不到锚点时降级为全表位置解析（不再报错中止）。
 */
export function parseTemplateSheet(input: {
  sheet: SheetData
  fileName: string
  workbookId: string
}): TemplateSheet {
  const { sheet, fileName, workbookId } = input
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
  const a = findAnchor(m)
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
    // 有值行：至少一个数据格可数值化（注释行/表尾行因此被自然排除）
    if (rowCells.some((x) => x.num !== null)) cells.push(...rowCells)
  }

  return { ...base, cells, degraded: false }
}

/** 取工作簿第一个 sheet 解析（本项目报表均为单 sheet） */
export function parseWorkbook(wb: WorkbookData): TemplateSheet {
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
  return parseTemplateSheet({ sheet, fileName: wb.fileName, workbookId: wb.id })
}
```

**注意**：`clampRange` 与 `parseTemplateSheet` 里的 `headerRange` 仍要用 `CellRange`，所以它必须留在 type import 里（上面的 import 块已包含）。别顺手删掉它。

- [ ] **步骤 4：改写 `template.ts` 的比对段落**

1. 删除 `indexCells`、`toOnly`、`applyRules`、`atLeft` 四个函数。

2. 把 `TemplateCheckOptions` 改为：
```ts
export interface TemplateCheckOptions {
  threshold: number
  /** 当前表对的规则表；缺席时全部用种子 */
  ruleTable?: RuleTablePair
}
```

3. 新增：
```ts
/** 生效规则值：规则表有该位置则以其为准（空串 = 不比对），否则用种子。比较前 trim */
export function effectiveRule(table: RuleTable | undefined, cell: TemplateCellRef): string {
  const v = table?.[`${cell.row},${cell.col}`]
  return (v === undefined ? cell.seed : v).trim()
}

/** 规则值 → 该值对应的全部格子（非空规则值才入索引） */
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
```

4. `collect` 改签名，`rule` 取代 `rowPath`/`colPath`/`manual`：
```ts
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
```

5. `sortResult` 改为按规则值排序：
```ts
function sortResult(res: TemplatePairResult): void {
  const byRule = (a: { rule: string }, b: { rule: string }): number =>
    a.rule.localeCompare(b.rule, 'zh')
  res.diffs.sort(byRule)
  res.onlyInLeft.sort(byRule)
  res.onlyInRight.sort(byRule)
}
```

6. 把 `checkTemplates` 整体替换为：
```ts
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

  // 规则值重复的整值不参与配对（用户在差异列表里能看到并去修），因此也不进「未配上」
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
      res.onlyInLeft.push({ cell: cs[0], rule } satisfies TemplateRuleEntry)
    }
  }
  for (const [rule, cs] of ri) {
    if (dup.has(rule) || li.has(rule)) continue
    res.onlyInRight.push({ cell: cs[0], rule } satisfies TemplateRuleEntry)
  }

  sortResult(res)
  return res
}
```

- [ ] **步骤 5：运行测试确认 RED**

运行：`npx vitest run src/shared/core/__tests__/template.spec.ts`
预期：大量失败（旧用例引用已删除的类型与函数）。这一步只是确认改动已生效。

- [ ] **步骤 6：改写 `template.spec.ts`**

把 `src/shared/core/__tests__/template.spec.ts` 整体替换为下面内容（保留 `templateKeyOf` / `tableNoOf` / `pairTemplateWorkbooks` 的既有用例，重写解析与比对部分）：

```ts
import { describe, it, expect } from 'vitest'
import {
  checkTemplates,
  effectiveRule,
  pairTemplateWorkbooks,
  parseTemplateSheet,
  parseWorkbook,
  tableNoOf,
  templateKeyOf
} from '../template'
import { toNumeric } from '../numeric'
import type {
  MergedRange,
  RuleTablePair,
  SheetData,
  TemplateSheet,
  WorkbookData
} from '@shared/types'

// ——— 造表工具 ———

/** 造 SheetData：cells 用 [row, col, value] 三元组描述，其余为空格 */
function sheetOf(
  rowCount: number,
  colCount: number,
  entries: [number, number, string | number][],
  merges: MergedRange[] = []
): SheetData {
  const cells = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => null as { v: string | number } | null)
  )
  for (const [r, c, v] of entries) cells[r][c] = { v }
  return { name: 'S', rowCount, colCount, cells, merges }
}

/** 标准锚点表：第 3 行为「项 目」，表头区 A4:C5，数据从 D 列第 6 行起 */
function anchoredSheet(entries: [number, number, string | number][], rowCount = 12): SheetData {
  return sheetOf(rowCount, 8, [
    [3, 0, '项    目'],
    [3, 3, '发生额'],
    [4, 3, ''],
    [5, 0, '贴现'],
    [5, 1, '银承'],
    [5, 2, '3个月'],
    ...entries
  ], [
    { r1: 3, c1: 0, r2: 4, c2: 2 },
    { r1: 3, c1: 3, r2: 4, c2: 3 }
  ])
}

const parse = (s: SheetData, fileName = 'R06.xls'): TemplateSheet =>
  parseTemplateSheet({ sheet: s, fileName, workbookId: 'w1' })

/** 直接造 TemplateSheet，跳过解析，专测配对与比对 */
function tsheet(
  key: string,
  cells: [number, number, string, string, string | number | null][]
): TemplateSheet {
  return {
    key,
    tableNo: key.replace(/^[A-Za-z]+/, ''),
    fileName: `${key}.xls`,
    workbookId: key,
    sheetName: key,
    degraded: false,
    cells: cells.map(([row, col, rowPath, colPath, v]) => ({
      row,
      col,
      rowPath,
      colPath,
      text: v === null ? '' : String(v),
      num: toNumeric(v === null ? null : { v }),
      seed: `${rowPath}_${colPath}`
    }))
  }
}

const check = (
  l: TemplateSheet,
  r: TemplateSheet,
  threshold = 0.0001,
  ruleTable?: RuleTablePair
): ReturnType<typeof checkTemplates> => checkTemplates(l, r, { threshold, ruleTable })

// ——— 表号与表样键 ———

describe('templateKeyOf', () => {
  it('取 zip 条目名最后一段并去扩展名', () => {
    expect(templateKeyOf('R06.xls')).toBe('R06')
    expect(templateKeyOf('上期包.zip/R06.xlsx')).toBe('R06')
    expect(templateKeyOf('zip/R06.xls')).toBe('R06')
  })

  it('大小写扩展名都能去', () => {
    expect(templateKeyOf('R06.XLS')).toBe('R06')
    expect(templateKeyOf('R06.Xlsx')).toBe('R06')
  })
})

describe('tableNoOf', () => {
  it('整段匹配 字母+数字', () => {
    expect(tableNoOf('R06.xls')).toBe('6')
    expect(tableNoOf('NR31.xls')).toBe('31')
  })

  it('整段匹配失败时取名字开头的 字母+数字', () => {
    expect(tableNoOf('R06-人民币贴现利率水平表.xls')).toBe('6')
  })

  it('纯数字或中文开头返回 null', () => {
    expect(tableNoOf('附件2.xls')).toBeNull()
    expect(tableNoOf('报表.xls')).toBeNull()
  })

  it('去前导零', () => {
    expect(tableNoOf('R006.xls')).toBe('6')
  })
})

// ——— 解析与种子 ———

describe('parseTemplateSheet', () => {
  it('锚点合并范围决定表头区，数据格带种子规则值', () => {
    const t = parse(anchoredSheet([[5, 3, 1.1]]))
    expect(t.error).toBeUndefined()
    expect(t.degraded).toBe(false)
    expect(t.cells).toHaveLength(1)
    expect(t.cells[0].rowPath).toBe('贴现/银承/3个月')
    expect(t.cells[0].colPath).toBe('发生额')
    expect(t.cells[0].seed).toBe('贴现/银承/3个月_发生额')
  })

  it('行路径由标签列各段拼接，合并格向下填充', () => {
    const t = parse(anchoredSheet([[5, 3, 1], [6, 3, 2]]))
    expect(t.cells.map((c) => c.rowPath)).toEqual(['贴现/银承/3个月', '贴现/银承/3个月'])
  })

  it('找不到锚点时降级：行列标签退化为位置，锚点缺失不再报错', () => {
    const t = parse(sheetOf(3, 3, [[0, 0, '随便'], [1, 1, 5]], []))
    expect(t.error).toBeUndefined()
    expect(t.degraded).toBe(true)
    expect(t.cells).toHaveLength(1)
    expect(t.cells[0].rowPath).toBe('第2行')
    expect(t.cells[0].colPath).toBe('B')
    expect(t.cells[0].seed).toBe('第2行_B')
  })

  it('表头区找不到数据列时同样降级', () => {
    // 锚点在 A4，但表头行里没有任何列标签
    const s = sheetOf(8, 4, [[3, 0, '项    目'], [5, 2, 9]], [
      { r1: 3, c1: 0, r2: 4, c2: 2 }
    ])
    const t = parse(s)
    expect(t.error).toBeUndefined()
    expect(t.degraded).toBe(true)
    expect(t.cells).toHaveLength(1)
  })

  it('数据列全空的行不产出 cells（两侧都空即无差异）', () => {
    const t = parse(anchoredSheet([[5, 3, null as unknown as string]]))
    expect(t.cells).toHaveLength(0)
  })

  it('数据区合并覆盖格跳过，只取主格值', () => {
    const s = anchoredSheet([[5, 3, 7]], 8)
    s.merges.push({ r1: 5, c1: 3, r2: 5, c2: 4 })
    const t = parse(s)
    expect(t.cells.map((c) => c.col)).toEqual([3])
    expect(t.cells[0].num).toBe(7)
  })

  it('工作簿中没有工作表时报错', () => {
    const wb: WorkbookData = {
      id: 'w1',
      fileName: 'R06.xls',
      source: 'file',
      sheetNames: [],
      sheets: {}
    }
    expect(parseWorkbook(wb).error).toBe('工作簿中没有工作表')
  })
})

// ——— 规则值与生效值 ———

describe('effectiveRule', () => {
  const cell = tsheet('R06', [[5, 3, '甲', '乙', 1]]).cells[0]

  it('规则表缺席时用种子', () => {
    expect(effectiveRule(undefined, cell)).toBe('甲_乙')
  })

  it('规则表有该位置时以其为准', () => {
    expect(effectiveRule({ '5,3': '自定义' }, cell)).toBe('自定义')
  })

  it('空串表示不比对，且不会被种子顶替', () => {
    expect(effectiveRule({ '5,3': '' }, cell)).toBe('')
  })

  it('比较前 trim', () => {
    expect(effectiveRule({ '5,3': '  甲_乙  ' }, cell)).toBe('甲_乙')
  })
})

// ——— 等值配对与比对判据 ———

describe('checkTemplates', () => {
  it('两侧规则值相同即配对（跨行坐标不影响）', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 10]])
    const r = tsheet('NR06', [[9, 3, '甲', '乙', 10]])
    const res = check(l, r)
    expect(res.totalCompared).toBe(1)
    expect(res.diffs).toHaveLength(0)
  })

  it('规则值不同则不配对，各自进未配上清单', () => {
    const l = tsheet('R31', [[5, 3, '单位存款', '乙', 1.1]])
    const r = tsheet('NR31', [[5, 3, '一、活期/单位存款', '乙', 1]])
    const res = check(l, r)
    expect(res.totalCompared).toBe(0)
    expect(res.onlyInLeft.map((e) => e.rule)).toEqual(['单位存款_乙'])
    expect(res.onlyInRight.map((e) => e.rule)).toEqual(['一、活期/单位存款_乙'])
  })

  it('规则表把两侧规则值改成一致后即配对并比对', () => {
    const l = tsheet('R31', [[5, 3, '单位存款', '乙', 1.1]])
    const r = tsheet('NR31', [[5, 3, '一、活期/单位存款', '乙', 1]])
    const ruleTable: RuleTablePair = { left: { '5,3': '活期单位存款_乙' }, right: { '5,3': '活期单位存款_乙' } }
    const res = check(l, r, 0.0001, ruleTable)
    expect(res.totalCompared).toBe(1)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].rule).toBe('活期单位存款_乙')
    expect(res.diffs[0].kind).toBe('diff')
  })

  it('空串规则值不参与比对（两侧都空也不报错）', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 1]])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', 2]])
    const ruleTable: RuleTablePair = { left: { '5,3': '' }, right: {} }
    const res = check(l, r, 0.0001, ruleTable)
    expect(res.totalCompared).toBe(0)
    expect(res.onlyInLeft).toHaveLength(0)
    expect(res.onlyInRight).toHaveLength(0)
    expect(res.diffs).toHaveLength(0)
  })

  it('规则值在一侧重复时该值整体不配对，且进 duplicateRules', () => {
    const l = tsheet('R06', [
      [5, 3, '甲', '乙', 1],
      [6, 3, '甲', '乙', 2]
    ])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', 1]])
    const res = check(l, r)
    expect(res.totalCompared).toBe(0)
    expect(res.diffs).toHaveLength(0)
    expect(res.duplicateRules).toEqual([{ side: 'left', rule: '甲_乙', count: 2 }])
    expect(res.onlyInLeft).toHaveLength(0)
    expect(res.onlyInRight).toHaveLength(0)
  })

  it('相对差超过阈值标记 diff', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 1.2]])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', 1]])
    const res = check(l, r)
    expect(res.diffs[0].kind).toBe('diff')
    expect(res.diffs[0].relDiff).toBeCloseTo(1 / 6, 10)
  })

  it('相对差恰好等于阈值不标记（严格大于）', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 2]])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', 1]])
    // |2-1| / max(2,1) = 0.5，阈值取同一个算式算出的值，规避浮点误差
    const res = check(l, r, Math.abs(2 - 1) / Math.max(2, 1))
    expect(res.diffs).toHaveLength(0)
  })

  it('双 0 跳过、两侧都无数值跳过', () => {
    const l = tsheet('R06', [
      [5, 3, '甲', '乙', 0],
      [6, 3, '甲', '丙', null],
      [7, 3, '甲', '丁', '文本']
    ])
    const r = tsheet('NR06', [
      [5, 3, '甲', '乙', 0],
      [6, 3, '甲', '丙', null],
      [7, 3, '甲', '丁', '文本']
    ])
    expect(check(l, r).diffs).toHaveLength(0)
  })

  it('一侧有值一侧为空记单侧有值', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 1]])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', null]])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].kind).toBe('left-only-value')
    expect(res.diffs[0].relDiff).toBeNull()
  })

  it('负值与千分位文本贯通数值化', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', '-1,200']])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', -600]])
    const res = check(l, r)
    expect(res.diffs[0].leftNum).toBe(-1200)
    expect(res.diffs[0].relDiff).toBeCloseTo(0.5, 10)
  })

  it('解析失败的表返回空结果', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 1]])
    const bad: TemplateSheet = { ...tsheet('NR06', []), error: '工作簿中没有工作表' }
    const res = check(l, bad)
    expect(res.diffs).toHaveLength(0)
    expect(res.totalCompared).toBe(0)
  })
})

// ——— 表对配对 ———

describe('pairTemplateWorkbooks', () => {
  const wb = (fileName: string, id = fileName): WorkbookData => ({
    id,
    fileName,
    source: 'file',
    sheetNames: [],
    sheets: {}
  })

  it('按表号自动配对', () => {
    const res = pairTemplateWorkbooks([wb('R06.xls'), wb('R31.xls')], [wb('NR06.xls'), wb('NR31.xls')])
    expect(res.pairs.map((p) => [p.left.fileName, p.right.fileName])).toEqual([
      ['R06.xls', 'NR06.xls'],
      ['R31.xls', 'NR31.xls']
    ])
    expect(res.unmatchedLeft).toEqual([])
    expect(res.unmatchedRight).toEqual([])
  })

  it('表号提不出的进 unmatched', () => {
    const res = pairTemplateWorkbooks([wb('R06.xls'), wb('附件2.xls')], [wb('NR06.xls')])
    expect(res.unmatchedLeft).toEqual(['附件2.xls'])
  })

  it('同号多候选时不自动配对（交给人工）', () => {
    const res = pairTemplateWorkbooks([wb('R06.xls')], [wb('NR06.xls'), wb('NR06-副本.xls')])
    expect(res.pairs).toHaveLength(0)
    expect(res.unmatchedLeft).toEqual(['R06.xls'])
  })

  it('manualTablePairs 优先并占用名额', () => {
    const res = pairTemplateWorkbooks(
      [wb('R06.xls')],
      [wb('NR06.xls')],
      [{ leftId: 'R06.xls', rightId: 'NR06.xls' }]
    )
    expect(res.pairs).toHaveLength(1)
    expect(res.unmatchedLeft).toEqual([])
    expect(res.unmatchedRight).toEqual([])
  })
})
```

- [ ] **步骤 7：运行测试确认 GREEN**

运行：`npx vitest run src/shared/core/__tests__/template.spec.ts`
预期：全部 PASS，输出干净

- [ ] **步骤 8：确认 typecheck 的预期报错范围**

运行：`npm run typecheck`
预期：**报错集中在尚未适配的调用点**——`src/main/align.ts`、`src/main/ipc.ts`、`src/renderer/src/stores/session.ts`、`src/renderer/src/components/TemplatePanel.vue`。这些属于任务 2、3，**不要动**。除此之外不应有错。

- [ ] **步骤 9：Commit**

```bash
git add src/shared/types.ts src/shared/core/template.ts src/shared/core/sheet-view.ts src/shared/core/__tests__/template.spec.ts
git commit -m "feat(template): 规则值配对引擎与类型 v2，解析降级取代人工指定表头区"
```

---

## 任务 2：主进程与 store 接入规则表

**文件：**
- 修改：`src/main/align.ts`
- 修改：`src/main/ipc.ts`
- 修改：`src/renderer/src/stores/session.ts`
- 测试：`src/renderer/src/stores/__tests__/session.template.spec.ts`

- [ ] **步骤 1：改写 `align.ts` 的配置形状**

把 `src/main/align.ts` 的 `loadAlignConfig` 替换为：

```ts
const EMPTY: AlignConfig = { version: 2, ruleTables: {} }

/**
 * 读取规则表配置。
 * - 文件不存在（ENOENT）→ 返回空配置（首次运行，正常）
 * - 其余读取错误 / JSON 解析失败 → 抛错，绝不静默退化为空配置：
 *   调用方若拿空配置做基准保存，会把盘上已有规则整体覆盖。
 * - version 不是 2 → 按空配置（v1 的坐标规则与规则值语义没有对应关系，不做迁移）
 */
export async function loadAlignConfig(): Promise<AlignConfig> {
  let text: string
  try {
    text = await readFile(alignPath(), 'utf-8')
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'ENOENT') return EMPTY
    throw new Error(`人工规则配置读取失败：${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const raw = JSON.parse(text)
    const tables = raw?.ruleTables
    if (raw?.version !== 2 || typeof tables !== 'object' || tables === null) return EMPTY
    return { version: 2, ruleTables: tables }
  } catch {
    throw new Error('人工规则配置解析失败：文件内容不是合法 JSON')
  }
}
```

- [ ] **步骤 2：改 `ipc.ts` 的 `template:check` handler**

1. 在 `src/main/ipc.ts` 顶部 import 中加入 `templateKeyOf`（从 `@shared/core/template`，与既有的 `pairTemplateWorkbooks` / `checkTemplates` / `parseWorkbook` 同一行）。
2. 把 handler 里构造 `pairs` 的那段替换为：

```ts
      const threshold = typeof req.threshold === 'number' ? req.threshold : 0.0001
      const pairing = pairTemplateWorkbooks(
        left as WorkbookData[],
        right as WorkbookData[],
        req.manualTablePairs ?? []
      )
      const pairs = pairing.pairs.map((p) => {
        const key = `${templateKeyOf(p.left.fileName)}|${templateKeyOf(p.right.fileName)}`
        return checkTemplates(parseWorkbook(p.left), parseWorkbook(p.right), {
          threshold,
          ruleTable: req.ruleTables?.[key]
        })
      })
```

**注意**：`const cfg = await loadAlignConfig()` 这一行以及 `parseWorkbook(p.left, cfg)` 的 `cfg` 参数都已不存在——`parseWorkbook` 不再接收配置。`loadAlignConfig` 在本 handler 里不再需要，删掉那一行（但**不要**删 `template:align:get` / `template:align:set` 两个 handler）。

- [ ] **步骤 3：在 store 里加规则表草稿与读写**

在 `src/renderer/src/stores/session.ts` 中：

1. 顶部 type import 加入 `RuleTablePair`、`TemplateSheet`（若未在列）。
2. `interface SessionState` 里：删 `templateRangeError`，新增：
```ts
  /** 规则表草稿，键 `左表样键|右表样键`；与已保存配置合并后参与核对（草稿优先） */
  ruleDrafts: Record<string, RuleTablePair>
  /** 草稿有未保存修改 */
  ruleDirty: boolean
```
3. `state()` 里：删 `templateRangeError: ''`，新增：
```ts
    ruleDrafts: {},
    ruleDirty: false,
```
4. getters 里新增：
```ts
    /** 当前表对的配置键 `左表样键|右表样键`；无表对时为空串 */
    activeRuleKey: (s): string => {
      const p = s.templateResult?.pairs[s.templatePairIndex]
      if (!p) return ''
      return `${templateKeyOf(p.leftFile)}|${templateKeyOf(p.rightFile)}`
    },
    /** 当前表对的规则表草稿；尚未初始化时为 null */
    activeRuleDraft: (s): RuleTablePair | null => s.ruleDrafts[s.activeRuleKey] ?? null
```
（`templateKeyOf` 需要从 `@shared/core/template` import——`session.ts` 已经在 import 它。）
5. actions 里删除 `setTemplateHeaderRange`，并新增：

```ts
    /** 初始化当前表对的规则表草稿：已保存的值优先，缺席的位置用种子补齐 */
    initRuleDraft(): void {
      const p = this.templateResult?.pairs[this.templatePairIndex]
      const key = this.activeRuleKey
      if (!p || !key || this.ruleDrafts[key]) return
      const saved = this.alignConfig?.ruleTables[key]
      const build = (t: TemplateSheet | null, side: 'left' | 'right'): Record<string, string> => {
        const out: Record<string, string> = { ...(saved?.[side] ?? {}) }
        for (const c of t?.cells ?? []) {
          const pos = `${c.row},${c.col}`
          if (out[pos] === undefined) out[pos] = c.seed
        }
        return out
      }
      this.ruleDrafts = {
        ...this.ruleDrafts,
        [key]: { left: build(p.left, 'left'), right: build(p.right, 'right') }
      }
      this.ruleDirty = false
    },

    /** 丢弃人工修改，按种子重置当前表对的草稿 */
    reseedRuleTable(): void {
      const key = this.activeRuleKey
      if (!key) return
      const rest = { ...this.ruleDrafts }
      delete rest[key]
      this.ruleDrafts = rest
      this.ruleDirty = false
      this.initRuleDraft()
    },

    /** 保存当前表对的规则表；写盘失败如实抛出由调用方提示 */
    async saveRuleTable(): Promise<void> {
      const key = this.activeRuleKey
      const draft = this.ruleDrafts[key]
      if (!draft) return
      const base = this.alignConfig
      if (!base) throw new Error('配置未就绪，已放弃保存以避免覆盖已有规则')
      const cfg: AlignConfig = {
        version: 2,
        // Pinia 响应式 Proxy 无法被 IPC 结构化克隆，先深拷贝为纯对象
        ruleTables: JSON.parse(
          JSON.stringify({ ...base.ruleTables, [key]: draft })
        ) as Record<string, RuleTablePair>
      }
      await window.api.setAlignConfig(cfg)
      this.alignConfig = cfg
      this.ruleDirty = false
      await this.runTemplateCheck({ keepPairIndex: true })
    },
```
6. `runTemplateCheck` 的请求体加上规则表（草稿优先于已保存配置）：

```ts
    async runTemplateCheck(opts: { keepPairIndex?: boolean } = {}): Promise<void> {
      if (!this.templateLeft.length || !this.templateRight.length) return
      this.loading = true
      try {
        const merged: Record<string, RuleTablePair> = {
          ...(this.alignConfig?.ruleTables ?? {}),
          ...this.ruleDrafts
        }
        const req = {
          leftIds: this.templateLeft.map((w) => w.id),
          rightIds: this.templateRight.map((w) => w.id),
          manualTablePairs: this.manualTablePairs,
          ruleTables: merged,
          threshold: this.templateThreshold
        }
        // Pinia 响应式 Proxy 无法被 IPC 结构化克隆，先深拷贝为纯对象
        this.templateResult = await window.api.checkTemplate(JSON.parse(JSON.stringify(req)))
        const last = Math.max(0, (this.templateResult?.pairs.length ?? 0) - 1)
        this.templatePairIndex = opts.keepPairIndex ? Math.min(this.templatePairIndex, last) : 0
        this.templateFocus = null
      } finally {
        this.loading = false
      }
    },
```

- [ ] **步骤 4：改写 store 单测**

把 `src/renderer/src/stores/__tests__/session.template.spec.ts` 整体替换为：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../session'
import type {
  AlignConfig,
  TemplateCellRef,
  TemplateCheckResult,
  TemplatePairResult,
  TemplateSheet,
  WorkbookData
} from '@shared/types'

/** 桩：IPC 边界就是结构化克隆，入参进桩先 clone——忠实模拟 Electron 的接收行为 */
const cloneThroughIpc = structuredClone

const seedCell = (): TemplateCellRef => ({
  row: 5,
  col: 3,
  rowPath: '甲',
  colPath: '乙',
  text: '1',
  num: 1,
  seed: '甲_乙'
})

const seedSheet = (key: string, fileName: string, workbookId: string): TemplateSheet => ({
  key,
  tableNo: key.replace(/^[A-Za-z]+/, ''),
  fileName,
  workbookId,
  sheetName: key,
  degraded: false,
  cells: [seedCell()]
})

/** 造一个表对结果；桩固定返回两对（R06/NR06 与 R31/NR31），好让「保留表对索引」可被区分 */
const pairResult = (
  tableNo: string,
  leftKey: string,
  rightKey: string
): TemplatePairResult => ({
  tableNo,
  leftFile: `${leftKey}.xls`,
  rightFile: `${rightKey}.xls`,
  left: seedSheet(leftKey, `${leftKey}.xls`, 'L'),
  right: seedSheet(rightKey, `${rightKey}.xls`, 'R'),
  diffs: [],
  duplicateRules: [],
  onlyInLeft: [],
  onlyInRight: [],
  totalCompared: 1
})

let storedConfig: AlignConfig
let setCalls: AlignConfig[]
let lastRequest: Record<string, unknown>

function installApi(): void {
  storedConfig = { version: 2, ruleTables: {} }
  setCalls = []
  lastRequest = {}
  const result: TemplateCheckResult = {
    pairs: [pairResult('6', 'R06', 'NR06'), pairResult('31', 'R31', 'NR31')],
    unmatchedLeft: [],
    unmatchedRight: [],
    threshold: 0.0001,
    totalDiffs: 0,
    generatedAt: '2026-09-21T00:00:00.000Z'
  }
  vi.stubGlobal('window', {
    api: {
      getAlignConfig: () => Promise.resolve(cloneThroughIpc(storedConfig)),
      setAlignConfig: (cfg: AlignConfig) => {
        const plain = cloneThroughIpc(cfg)
        setCalls.push(plain)
        storedConfig = plain
        return Promise.resolve()
      },
      checkTemplate: (req: Record<string, unknown>) => {
        lastRequest = cloneThroughIpc(req)
        return Promise.resolve(cloneThroughIpc(result))
      }
    }
  })
}

const wb = (id: string, fileName: string): WorkbookData => ({
  id,
  fileName,
  source: 'file',
  sheetNames: [],
  sheets: {}
})

beforeEach(() => {
  setActivePinia(createPinia())
  installApi()
})

describe('runTemplateCheck', () => {
  it('请求载荷可被结构化克隆（Pinia Proxy 不得直传）', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.manualTablePairs = [{ leftId: 'L', rightId: 'R' }]
    await expect(s.runTemplateCheck()).resolves.toBeUndefined()
  })

  it('规则表草稿并入请求载荷', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.ruleDrafts = { 'R06|NR06': { left: { '5,3': '甲_乙' }, right: {} } }
    await s.runTemplateCheck()
    expect(lastRequest.ruleTables).toEqual({ 'R06|NR06': { left: { '5,3': '甲_乙' }, right: {} } })
  })

  it('保存触发的核对保留表对索引；主动核对回到第 1 对', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    expect(s.templatePairIndex).toBe(0)

    s.templatePairIndex = 1 // 切到第 2 对（R31|NR31）
    s.ruleDrafts['R31|NR31'] = { left: {}, right: {} }
    await s.saveRuleTable()
    expect(s.templatePairIndex).toBe(1) // 保存不该把用户弹回第 1 对

    await s.runTemplateCheck()
    expect(s.templatePairIndex).toBe(0) // 主动核对才回到第 1 对
  })
})

describe('规则表草稿', () => {
  const seedPair = (): void => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
  }

  it('initRuleDraft 用种子补齐缺席位置，已保存的值优先', async () => {
    storedConfig = {
      version: 2,
      ruleTables: { 'R06|NR06': { left: { '5,3': '人工值' }, right: {} } }
    }
    const s = useSessionStore()
    seedPair()
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    s.initRuleDraft()
    const d = s.activeRuleDraft
    expect(d?.left['5,3']).toBe('人工值')
    expect(d?.right['5,3']).toBe('甲_乙')
  })

  it('reseedRuleTable 丢弃人工修改', async () => {
    const s = useSessionStore()
    seedPair()
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    s.initRuleDraft()
    s.ruleDrafts['R06|NR06'].left['5,3'] = '改过的'
    s.reseedRuleTable()
    expect(s.activeRuleDraft?.left['5,3']).toBe('甲_乙')
    expect(s.ruleDirty).toBe(false)
  })

  it('saveRuleTable 深拷贝后写盘并清除脏标记', async () => {
    const s = useSessionStore()
    seedPair()
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    s.initRuleDraft()
    s.ruleDrafts['R06|NR06'].left['5,3'] = '甲_乙（改）'
    s.ruleDirty = true
    await s.saveRuleTable()
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0].ruleTables['R06|NR06'].left['5,3']).toBe('甲_乙（改）')
    expect(s.ruleDirty).toBe(false)
    expect(s.alignConfig?.ruleTables['R06|NR06'].left['5,3']).toBe('甲_乙（改）')
  })

  it('配置未就绪时拒绝保存，避免以空基准覆盖盘上规则', async () => {
    const s = useSessionStore()
    seedPair()
    await s.runTemplateCheck()
    s.initRuleDraft()
    s.alignConfig = null
    await expect(s.saveRuleTable()).rejects.toThrow('配置未就绪')
    expect(setCalls).toHaveLength(0)
  })
})
```

**注意**：`RuleTablePair` 在上面的用例里没有直接用到，如果 typecheck 报未使用，请从 import 列表里删掉它。

- [ ] **步骤 5：运行 store 单测确认 GREEN**

运行：`npx vitest run src/renderer/src/stores/__tests__/session.template.spec.ts`
预期：全部 PASS

- [ ] **步骤 6：确认 typecheck 的预期报错范围**

运行：`npm run typecheck`
预期：只剩 `src/renderer/src/components/TemplatePanel.vue` 报错（属于任务 3）。`src/main/` 与 `stores/session.ts` 不应再有错。

- [ ] **步骤 7：Commit**

```bash
git add src/main/align.ts src/main/ipc.ts src/renderer/src/stores/session.ts src/renderer/src/stores/__tests__/session.template.spec.ts
git commit -m "feat(template): 主进程与 store 接入规则表（配置 v2、草稿、保存/重置）"
```

---

## 任务 3：规则表编辑器与子标签页

**文件：**
- 创建：`src/renderer/src/components/RuleTable.vue`
- 创建：`src/renderer/src/components/RulePanel.vue`
- 修改：`src/renderer/src/components/TemplatePanel.vue`
- 修改：`src/renderer/src/components/TemplateGrid.vue`

- [ ] **步骤 1：删掉 `TemplateGrid.vue` 的右键菜单**

在 `src/renderer/src/components/TemplateGrid.vue` 中：

1. 删掉 `defineEmits` 整块（三个 emit 都不再需要）。
2. 删掉 `onCellClick`、`ctxMenu`、`closeCtxMenu`、`onCellContextMenu`、`startPick`、`ignoreCell`、两个 `onMounted`/`onUnmounted` 监听。
3. 模板里：`<el-table>` 去掉 `@cell-click` 与 `@cell-contextmenu`；删掉 `template-ctx-menu` 那个 `<div>` 整块。
4. `<style>` 里删掉 `.template-ctx-menu` 及其 `.ctx-item` 规则。
5. 保留：`cellClass`、`spans`/`spanMethod`、`rows`、`cellText`、拖拽平移、聚焦滚动 `watch`、`diff-hit` / `cell-focused` / `merge-master` 样式。

- [ ] **步骤 2：创建 `RuleTable.vue`**

```vue
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { TemplateCellRef } from '@shared/types'

const props = defineProps<{
  title: string
  cells: TemplateCellRef[]
  /** 位置键 `"row,col"` → 规则值（含空串=不比对） */
  modelValue: Record<string, string>
  /** 对侧的规则值集合，用于标记哪些格子已配上 */
  peerValues: Set<string>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, string>): void
  (e: 'change'): void
}>()

/** 有值的行/列（按出现顺序去重） */
const rowList = computed(() => [...new Set(props.cells.map((c) => c.row))])
const colList = computed(() => [...new Set(props.cells.map((c) => c.col))])

/** (row,col) → 该格的标签来源 */
const cellAt = computed(() => {
  const m = new Map<string, TemplateCellRef>()
  for (const c of props.cells) m.set(`${c.row},${c.col}`, c)
  return m
})

const rowLabel = (row: number): string => cellAt.value.get(`${row},${colList.value[0]}`)?.rowPath ?? ''
const colLabel = (col: number): string => cellAt.value.get(`${rowList.value[0]},${col}`)?.colPath ?? ''
const seedOf = (row: number, col: number): string =>
  cellAt.value.get(`${row},${col}`)?.seed ?? ''

/** 生效规则值：草稿有该位置则以其为准（空串=不比对），否则用种子 */
function valueAt(row: number, col: number): string {
  const v = props.modelValue[`${row},${col}`]
  return v === undefined ? seedOf(row, col) : v
}

const rows = computed(() =>
  rowList.value.map((row) => ({
    row,
    label: rowLabel(row),
    cells: colList.value.map((col) => ({ col, exists: cellAt.value.has(`${row},${col}`) }))
  }))
)

// —— 单元格编辑：同时只存在一个输入框 ——

const editing = ref<{ row: number; col: number } | null>(null)
const editingText = ref('')
/** 用函数 ref 而不是 ref="inputRef"：输入框在 v-for 里，模板 ref 会被 Vue 收集成数组 */
let inputEl: { focus: () => void } | null = null
const setInputRef = (el: unknown): void => {
  inputEl = el as { focus: () => void } | null
}

async function startEdit(row: number, col: number): Promise<void> {
  if (!cellAt.value.has(`${row},${col}`)) return
  editing.value = { row, col }
  editingText.value = valueAt(row, col)
  await nextTick()
  inputEl?.focus()
}

function commitEdit(): void {
  const e = editing.value
  if (!e) return
  editing.value = null
  const key = `${e.row},${e.col}`
  const v = editingText.value
  // 与种子相同的值不落草稿，保持草稿精简
  const next = { ...props.modelValue }
  if (v === seedOf(e.row, e.col)) delete next[key]
  else next[key] = v
  emit('update:modelValue', next)
  emit('change')
}

/** 整行 / 整列批量设置：把该范围内的规则值一次改成同一个 */
async function bulkSet(kind: 'row' | 'col', index: number): Promise<void> {
  const seedHint = kind === 'row' ? rowLabel(index) : colLabel(index)
  let v: string
  try {
    const r = await ElMessageBox.prompt(
      `${kind === 'row' ? '整行' : '整列'}「${seedHint}」的规则值统一设为：`,
      '批量设置',
      { inputValue: seedHint, inputPlaceholder: '规则值' }
    )
    v = r.value ?? ''
  } catch {
    return
  }
  const next = { ...props.modelValue }
  if (kind === 'row') {
    for (const col of colList.value) {
      const key = `${index},${col}`
      if (!cellAt.value.has(key)) continue
      if (v === seedOf(index, col)) delete next[key]
      else next[key] = v
    }
  } else {
    for (const row of rowList.value) {
      const key = `${row},${index}`
      if (!cellAt.value.has(key)) continue
      if (v === seedOf(row, index)) delete next[key]
      else next[key] = v
    }
  }
  emit('update:modelValue', next)
  emit('change')
}
</script>

<template>
  <div class="rule-table">
    <div class="rule-title">{{ title }}</div>
    <div class="rule-scroll">
      <table class="rule-grid">
        <thead>
          <tr>
            <th class="corner"></th>
            <th v-for="col in colList" :key="col" class="col-head">
              <span class="head-text">{{ colLabel(col) }}</span>
              <el-button link size="small" @click="bulkSet('col', col)">批量</el-button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.row">
            <th class="row-head">
              <span class="head-text">{{ r.label }}</span>
              <el-button link size="small" @click="bulkSet('row', r.row)">批量</el-button>
            </th>
            <td
              v-for="c in r.cells"
              :key="c.col"
              :class="{ 'not-exist': !c.exists, matched: c.exists && peerValues.has(valueAt(r.row, c.col).trim()) }"
              @click="startEdit(r.row, c.col)"
            >
              <el-input
                v-if="editing && editing.row === r.row && editing.col === c.col"
                :ref="setInputRef"
                v-model="editingText"
                size="small"
                @blur="commitEdit"
                @keyup.enter="commitEdit"
              />
              <template v-else>{{ c.exists ? valueAt(r.row, c.col) : '' }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.rule-table {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.rule-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.rule-scroll {
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  max-height: 60vh;
}
.rule-grid {
  border-collapse: collapse;
  font-size: 12px;
  width: max-content;
}
.rule-grid th,
.rule-grid td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 2px 6px;
  white-space: nowrap;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rule-grid thead th {
  position: sticky;
  top: 0;
  background: #f5f7fa;
  z-index: 1;
}
.rule-grid .corner,
.rule-grid .row-head {
  position: sticky;
  left: 0;
  background: #f5f7fa;
  text-align: left;
  z-index: 2;
}
.rule-grid td {
  cursor: text;
  background: #fff;
}
.rule-grid td.not-exist {
  background: #fafafa;
  cursor: default;
}
.rule-grid td.matched {
  background: #e8f5e9;
}
.head-text {
  margin-right: 4px;
}
</style>
```

- [ ] **步骤 3：创建 `RulePanel.vue`**

```vue
<script setup lang="ts">
import { computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSessionStore } from '../stores/session'
import RuleTable from './RuleTable.vue'

const session = useSessionStore()

const pair = computed(() => session.activeTemplatePair)
const draft = computed(() => session.activeRuleDraft)

/** 对侧生效规则值集合：用于把「已配上」的格子标绿 */
function valuesOf(side: 'left' | 'right'): Set<string> {
  const d = draft.value
  const t = side === 'left' ? pair.value?.left : pair.value?.right
  const out = new Set<string>()
  if (!d || !t) return out
  for (const c of t.cells) {
    const v = d[side][`${c.row},${c.col}`]
    const rule = (v === undefined ? c.seed : v).trim()
    if (rule) out.add(rule)
  }
  return out
}

const peerOfLeft = computed(() => valuesOf('right'))
const peerOfRight = computed(() => valuesOf('left'))

// 核对结果或表对变化后初始化草稿。用 watch 而非 onMounted：el-tab-pane 默认全部预渲染，
// 组件挂载时往往还没核对过，只靠 onMounted 会永远停在空态
watch(
  () => [session.activeRuleKey, session.templateResult] as const,
  () => session.initRuleDraft(),
  { immediate: true }
)

function onEdit(key: 'left' | 'right', v: Record<string, string>): void {
  const d = draft.value
  if (!d) return
  session.ruleDrafts[session.activeRuleKey] = { ...d, [key]: v }
  session.ruleDirty = true
}

async function save(): Promise<void> {
  try {
    await session.saveRuleTable()
    ElMessage.success('规则已保存')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function reseed(): Promise<void> {
  try {
    await ElMessageBox.confirm('丢弃对规则表的人工修改，按解析结果重新生成？', '确认', {
      type: 'warning'
    })
  } catch {
    return
  }
  session.reseedRuleTable()
  ElMessage.success('已恢复自动填充')
}
</script>

<template>
  <div class="rule-panel">
    <div v-if="!draft || !pair" class="rule-empty">
      <el-empty description="先选两套报表并核对，再在此维护规则表" />
    </div>
    <template v-else>
      <div class="rule-toolbar">
        <span class="hint">
          两侧规则值<strong>相同</strong>才参与比对；清空某格 = 该格不比对。
          改动即时生效，点「保存规则」持久化。
        </span>
        <span v-if="session.ruleDirty" class="dirty">有未保存的修改</span>
        <el-button size="small" type="primary" @click="save">保存规则</el-button>
        <el-button size="small" plain @click="reseed">恢复自动填充</el-button>
      </div>
      <div class="rule-tables">
        <RuleTable
          title="左侧（R 系列）"
          :cells="pair.left?.cells ?? []"
          :model-value="draft.left"
          :peer-values="peerOfLeft"
          @update:model-value="(v) => onEdit('left', v)"
        />
        <RuleTable
          title="右侧（NR 系列）"
          :cells="pair.right?.cells ?? []"
          :model-value="draft.right"
          :peer-values="peerOfRight"
          @update:model-value="(v) => onEdit('right', v)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.rule-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 4px;
}
.rule-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.dirty {
  font-size: 12px;
  color: #d6336c;
  font-weight: 600;
}
.rule-tables {
  display: flex;
  gap: 10px;
  min-width: 0;
}
</style>
```

- [ ] **步骤 4：改 `TemplatePanel.vue`：加子标签页 + 删旧机制**

在 `src/renderer/src/components/TemplatePanel.vue` 中：

**删掉**（script 与 template 里都要删干净，包括 import）：
- 状态：`pickSource`、`rangeArmed`、`rangeStart`
- 计算：`pickHint`
- 函数：`startRangePick`、`onPickPair`、`onCellClick`、`finishPair`、`finishRange`、`saveRules`、`ignoreDiff`、`ignoreAt`、`clearTableRules`
- 模板：「手动指定表头区」「清除本表对规则」两个按钮、`pick-hint` / `err-hint` 两个 span（`pairError` 的展示改到子标签页顶部保留即可）、`TemplateGrid` 上的 `@pick-pair` / `@ignore` / `@cell-click` 三个绑定
- 不再使用的 import：`AlignPairRule`、`colLetters`（若只被 `a1()` 用则 `a1` 一起删）

**保留**：`runCheck`、`openSide`、`addManualPair`、`onPairIndexChange`、`onSideChange`、`onDiffCurrentChange`、表对下拉、左右侧 radio、阈值、开始核对按钮、差异列表、`TemplateGrid`、未配上折叠区。

**改动**：

1. `diffRows` 的 key 与 `onlyRows`：`onlyInLeft`/`onlyInRight` 的元素现在是 `TemplateRuleEntry`（`.cell` + `.rule`）。把两处 computed 替换为：

```ts
/** 差异拍平成一张表，带表对索引 */
const diffRows = computed(() => {
  const out: { key: string; tableNo: string; diff: TemplateDiff; pairIndex: number }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const d of p.diffs) {
      out.push({ key: `${pi}|${d.leftRow},${d.leftCol}|${d.rule}`, tableNo: p.tableNo ?? '—', diff: d, pairIndex: pi })
    }
  })
  return out
})

/** 未配上的规则值（两侧改一致或清空即可） */
const onlyRows = computed(() => {
  const out: { key: string; tableNo: string; side: string; rule: string }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const e of p.onlyInLeft) {
      out.push({ key: `${pi}|L|${e.cell.row},${e.cell.col}`, tableNo: p.tableNo ?? '—', side: '左', rule: e.rule })
    }
    for (const e of p.onlyInRight) {
      out.push({ key: `${pi}|R|${e.cell.row},${e.cell.col}`, tableNo: p.tableNo ?? '—', side: '右', rule: e.rule })
    }
  })
  return out
})

/** 规则值重复（同值在一侧出现多次 → 该值整体不配对） */
const dupRows = computed(() => {
  const out: { key: string; tableNo: string; side: string; rule: string; count: number }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const e of p.duplicateRules) {
      out.push({
        key: `${pi}|${e.side}|${e.rule}`,
        tableNo: p.tableNo ?? '—',
        side: e.side === 'left' ? '左' : '右',
        rule: e.rule,
        count: e.count
      })
    }
  })
  return out
})
```

2. 差异列表的 `<el-table>` 换成（「项目路径」「列」两列合并为「规则值」一列；去掉「人工」角标）：

```vue
    <el-table
      v-if="result"
      :data="diffRows"
      size="small"
      border
      height="220"
      highlight-current-row
      @current-change="onDiffCurrentChange"
    >
      <el-table-column label="表号" prop="tableNo" width="70" />
      <el-table-column label="规则值" prop="diff.rule" min-width="360" show-overflow-tooltip />
      <el-table-column label="左值" prop="diff.leftText" width="110" show-overflow-tooltip />
      <el-table-column label="右值" prop="diff.rightText" width="110" show-overflow-tooltip />
      <el-table-column label="相对差" width="100">
        <template #default="{ row }">
          {{ row.diff.relDiff === null ? '—' : (row.diff.relDiff * 100).toFixed(4) + '%' }}
        </template>
      </el-table-column>
      <el-table-column label="类型" width="110">
        <template #default="{ row }">
          <el-tag v-if="row.diff.kind === 'diff'" type="danger" size="small">差额</el-tag>
          <el-tag v-else type="warning" size="small">单侧有值</el-tag>
        </template>
      </el-table-column>
    </el-table>
```

3. 「未配上」折叠区改为按规则值展示，并在其上方新增「规则值重复」折叠区：

```vue
    <el-collapse v-if="result && dupRows.length" class="only-collapse">
      <el-collapse-item :title="`规则值重复（${dupRows.length} 项，不参与比对）`" name="dup">
        <el-table :data="dupRows" size="small" border max-height="200">
          <el-table-column label="表号" prop="tableNo" width="70" />
          <el-table-column label="侧" prop="side" width="50" />
          <el-table-column label="规则值" prop="rule" min-width="320" show-overflow-tooltip />
          <el-table-column label="出现次数" prop="count" width="90" />
        </el-table>
      </el-collapse-item>
    </el-collapse>

    <el-collapse v-if="result && onlyRows.length" class="only-collapse">
      <el-collapse-item :title="`未配上（${onlyRows.length} 项）`" name="only">
        <div class="only-hint">
          两侧规则值一致才会比对。请到「对比规则」页把它们改成一致；不想比对就把该格清空。
        </div>
        <el-table :data="onlyRows" size="small" border max-height="260">
          <el-table-column label="表号" prop="tableNo" width="70" />
          <el-table-column label="侧" prop="side" width="50" />
          <el-table-column label="规则值" prop="rule" min-width="320" show-overflow-tooltip />
        </el-table>
      </el-collapse-item>
    </el-collapse>
```

（`.only-hint` 加到 `<style scoped>`：`font-size: 12px; color: var(--el-text-color-secondary); padding: 4px 0;`）

4. type import 里把 `TemplateDiff` 之外补上 `TemplateRuleEntry`（若不需要显式引用就不加——上面的 computed 只用了推导类型，通常不需要）。
4. 页面顶部加子标签页：

```vue
    <el-tabs v-model="subTab" class="template-subtabs">
      <el-tab-pane label="比对结果" name="result">
        <!-- 原有内容全部放进来 -->
      </el-tab-pane>
      <el-tab-pane label="对比规则" name="rules">
        <RulePanel v-if="result" />
        <el-empty v-else description="先完成一次核对" />
      </el-tab-pane>
    </el-tabs>
```

其中 `const subTab = ref('result')`，并 `import RulePanel from './RulePanel.vue'`。

5. 「未配上」的说明文案改成指向新入口：

```
未配上的两侧规则值，请到「对比规则」页把它们改成一致；不想比对就把该格清空。
```

- [ ] **步骤 5：类型检查与构建**

运行：`npm run typecheck && npm test && npm run build`
预期：typecheck 无错（此前任务的残留报错到此清零）、测试全绿、构建成功

- [ ] **步骤 6：Commit**

```bash
git add src/renderer/src/components/TemplatePanel.vue src/renderer/src/components/TemplateGrid.vue src/renderer/src/components/RuleTable.vue src/renderer/src/components/RulePanel.vue
git commit -m "feat(template): 规则表编辑器与「比对结果/对比规则」子标签页，删除旧人工配对与忽略入口"
```

---

## 任务 4：真实样例端到端验收与文档

**文件：**
- 修改：`src/main/file/__tests__/template-samples.spec.ts`
- 修改：`CLAUDE.md`

- [ ] **步骤 1：改写端到端测试**

把 `src/main/file/__tests__/template-samples.spec.ts` 整体替换为：

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { RuleTablePair, TemplateSheet, WorkbookData } from '@shared/types'
import { parseExcel } from '../excel'
import { checkTemplates, pairTemplateWorkbooks, parseWorkbook } from '@shared/core/template'

const DIR = resolve(__dirname, '../../../../samples/similarSample')
const FILES = ['R06.xls', 'NR06.xls', 'R31.xls', 'NR31.xls']

/** 真实样例缺失时整组跳过（samples/ 在 .gitignore 里，不保证每台机器都有） */
const hasSamples = FILES.every((f) => existsSync(resolve(DIR, f)))

/** 走生产解析路径，不用测试自造的对象 */
function load(name: string): WorkbookData {
  return parseExcel(readFileSync(resolve(DIR, name)), name, 'file')
}

/** 阈值 0.01%（与界面默认值一致） */
const T = 0.0001

const cellAt = (t: TemplateSheet, row: number, col: number) =>
  t.cells.find((c) => c.row === row && c.col === col)

describe.skipIf(!hasSamples)('表样核对 · 真实样例端到端', () => {
  const left = FILES.filter((f) => f.startsWith('R')).map(load)
  const right = FILES.filter((f) => f.startsWith('NR')).map(load)

  it('按表号自动配对出 2 对，无未配对文件', () => {
    const p = pairTemplateWorkbooks(left, right)
    expect(p.pairs.map((x) => [x.left.fileName, x.right.fileName])).toEqual([
      ['R06.xls', 'NR06.xls'],
      ['R31.xls', 'NR31.xls']
    ])
    expect(p.unmatchedLeft).toEqual([])
    expect(p.unmatchedRight).toEqual([])
  })

  it('真实文件能定位到锚点，种子即「行路径_列路径」', () => {
    const t = parseWorkbook(load('R06.xls'))
    expect(t.error).toBeUndefined()
    expect(t.degraded).toBe(false)
    expect(t.cells.length).toBeGreaterThan(0)
    const c = cellAt(t, 5, 3)
    expect(c?.rowPath).toBe('贴现/银行承兑汇票/3个月（含）以内')
    expect(c?.colPath).toBe('发生额')
    expect(c?.seed).toBe('贴现/银行承兑汇票/3个月（含）以内_发生额')
  })

  it('R06 ↔ NR06：种子等值配对，命中 2 处超阈值差异', () => {
    const res = checkTemplates(parseWorkbook(load('R06.xls')), parseWorkbook(load('NR06.xls')), {
      threshold: T
    })
    expect(res.left?.error).toBeUndefined()
    expect(res.right?.error).toBeUndefined()

    const hit = (rule: string, l: string, r: string): boolean =>
      res.diffs.some((d) => d.rule === rule && d.kind === 'diff' && d.leftText === l && d.rightText === r)
    // 跨行偏移（R06 r9 ↔ NR06 r10）也靠等值规则配对成功
    expect(hit('贴现/商业承兑汇票/3个月（含）以内_发生额', '1.2', '1')).toBe(true)
    expect(hit('转贴现/票据回购/6个月—1年（含）_发生额', '1.1', '1')).toBe(true)

    // NR06 有合计行而 R06 没有 → 其规则值只在右侧出现
    expect(res.onlyInRight.some((e) => e.rule.endsWith('/合计_发生额'))).toBe(true)
    expect(res.diffs.some((d) => d.rule.endsWith('/合计_发生额'))).toBe(false)
  })

  it('R31 ↔ NR31：种子状态下活期组两行配不上', () => {
    const res = checkTemplates(parseWorkbook(load('R31.xls')), parseWorkbook(load('NR31.xls')), {
      threshold: T
    })
    expect(res.left?.error).toBeUndefined()
    expect(res.right?.error).toBeUndefined()
    // R31 的 A6:B7 是空合并格，活期组只剩「单位存款」/「个人存款」，配不上 NR31 的「一、活期/…」
    expect(res.onlyInLeft.some((e) => e.rule.startsWith('单位存款_'))).toBe(true)
    expect(res.onlyInRight.some((e) => e.rule.startsWith('一、活期/单位存款_'))).toBe(true)
  })

  it('R31 ↔ NR31：规则表把活期组两行对齐后命中 3 处，含阈值下沿', () => {
    const l = parseWorkbook(load('R31.xls'))
    const r = parseWorkbook(load('NR31.xls'))
    // 把左侧第 5、6 行（0 起始）的规则值改成与右侧同位置一致
    const ruleTable: RuleTablePair = { left: {}, right: {} }
    for (const row of [5, 6]) {
      for (const c of l.cells.filter((x) => x.row === row)) {
        const rc = cellAt(r, c.row, c.col)
        if (rc) ruleTable.left[`${c.row},${c.col}`] = rc.seed
      }
    }
    const res = checkTemplates(l, r, { threshold: T, ruleTable })

    expect(res.totalCompared).toBeGreaterThan(0)
    // D=(-∞,-30) 1.1 vs 1（9.09%）、E=[-30,-10) 2.1 vs 2（4.76%）、N=合计 19.2001 vs 19（1.04%）
    expect(res.diffs.some((d) => d.leftText === '1.1' && d.rightText === '1')).toBe(true)
    expect(res.diffs.some((d) => d.leftText === '2.1' && d.rightText === '2')).toBe(true)
    expect(res.diffs.some((d) => d.leftText === '19.2001' && d.rightText === '19')).toBe(true)
    // 阈值下沿：2.0001 vs 2 = 0.005%，必须不标
    expect(res.diffs.some((d) => d.leftText === '2.0001')).toBe(false)
    // 对齐后这两行不再残留未配上
    expect(res.onlyInLeft.some((e) => e.rule.startsWith('单位存款_'))).toBe(false)
    expect(res.onlyInRight.some((e) => e.rule.startsWith('一、活期/单位存款_'))).toBe(false)
  })

  it('清空某格规则值即把它排除出比对', () => {
    const l = parseWorkbook(load('R06.xls'))
    const r = parseWorkbook(load('NR06.xls'))
    const target = checkTemplates(l, r, { threshold: T }).diffs.find((d) => d.leftText === '1.2')
    expect(target).toBeDefined()
    const ruleTable: RuleTablePair = { left: { [`${target!.leftRow},${target!.leftCol}`]: '' }, right: {} }
    const res = checkTemplates(l, r, { threshold: T, ruleTable })
    expect(res.diffs.some((d) => d.leftText === '1.2')).toBe(false)
  })
})
```

- [ ] **步骤 2：运行端到端测试**

运行：`npx vitest run src/main/file/__tests__/template-samples.spec.ts`
预期：6 passed / 0 skipped（本机样例存在，`describe.skipIf` 不应触发）

若某个断言与实测不符，**不要改断言去迁就实现**——停下来把「期望 vs 实测」原样带进报告，用 BLOCKED 状态汇报。

- [ ] **步骤 3：更新 `CLAUDE.md`**

在 `src/shared/` 那一行里把 `template.ts 表样核对` 改为 `template.ts 表样核对（规则表配对）`；在 `src/main/` 那一行把 `align.ts（表样核对人工规则持久化）` 改为 `align.ts（规则表持久化）`；在 `src/renderer/src/` 的组件列表末尾加上 `/RulePanel/RuleTable`。

在「## 测试」段落下把用例数改为实际数字，并在末尾追加一句：

```
`src/renderer/src/stores/__tests__/session.template.spec.ts` 用 `structuredClone` 桩模拟 IPC 边界——渲染进程传给 `window.api` 的载荷必须是纯对象（Pinia 响应式 Proxy 会抛 DataCloneError）。
```

- [ ] **步骤 4：全量验证**

运行：`npm run typecheck && npm test && npm run build`
预期：typecheck 无错、测试全绿（数字以实际为准）、构建成功

- [ ] **步骤 5：Commit**

```bash
git add src/main/file/__tests__/template-samples.spec.ts CLAUDE.md
git commit -m "test(template): 真实样例端到端验收规则表范式；更新 CLAUDE.md"
```

- [ ] **步骤 6（人类伙伴执行，不派子代理）：GUI 冒烟**

运行 `npm run dev`（bash 下先 `unset ELECTRON_RUN_AS_NODE`）：

1. 「表样核对」页左选 `samples/R系列.zip`、右选 `samples/NR系列.zip`，阈值 0.01，点「开始核对」
2. 「比对结果」页切表对 31 → 差异列表为空（预期：活期组两行配不上），「未配上」折叠区里能看到两侧规则值
3. 切「对比规则」页 → 左右两张网格出现，活期组那两行的规则值两侧不同、未标绿
4. 在左侧「单位存款」那两行用行首「批量」把规则值改成与右侧一致 → 格子标绿 → 点「保存规则」→ 回「比对结果」页 → 出现 3 处差异（1.1 vs 1、2.1 vs 2、19.2001 vs 19），`2.0001 vs 2` 不出现
5. 重启应用 → 规则表仍在，核对结果一致（验证持久化）
6. 在规则表里把某个格清空 → 该差异消失 → 保存 → 重启后依然不出现

任一步不符预期，把界面上的实际表现反馈回来。

---

## 规格覆盖度对照

| 规格章节 | 对应任务 |
|---|---|
| 一、规则值（等值配对、空串不比对） | 任务 1（`effectiveRule` / `indexByRule` / `checkTemplates`） |
| 二、种子与降级（`行路径_列路径` / `第N行_列字母` / 锚点缺失不再报错） | 任务 1（`parseTemplateSheet` / `degradedSheet` / `colLetter`） |
| 三、配对与比对（重复值上报、判据不变） | 任务 1（`duplicateRules` / `collect`） |
| 四、持久化与迁移（version 2、不做 v1 迁移） | 任务 2（`align.ts`） |
| 五、模块划分与类型定义 | 任务 1、2、3 |
| 六、界面（两个子标签页、可编辑网格、批量设置、保存/恢复） | 任务 3 |
| 七、要删除的既有代码 | 任务 1（`applyRules` 等）、任务 2（`setTemplateHeaderRange`）、任务 3（面板与网格入口） |
| 八、测试策略 | 任务 1、2、4 |
| 九、已知限制 | 无需实现，规格中已记录 |
