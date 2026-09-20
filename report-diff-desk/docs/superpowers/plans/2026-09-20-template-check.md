# 表样核对（跨表样同指标数值比对）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 加载 R 系列与 NR 系列两套报表（各一个 zip），按「行标签路径 + 列标签路径」自动配对，把同一指标数值相对差 > 0.01% 的项标记出来，并支持人工修正配对关系后持久化复用。

**架构：** 新增一个与现有「环比比对」完全并列的纯逻辑模块 `src/shared/core/template.ts`（锚点法解析表样 → 路径配对 → 比值），主进程新增 3 个 IPC channel，renderer 新增「表样核对」标签页（差异列表 + 单侧网格）。现有比对与口径查询逻辑一行不动。

**技术栈：** TypeScript、Vue 3 + Element Plus、Pinia、Electron IPC、vitest、SheetJS（仅在测试里用来造 fixture）。

**规格：** `docs/superpowers/specs/2026-09-20-template-check-design.md`

**与规格的两处有意偏离（实现细节，已确认不影响行为）：**

1. 规格写 `src/renderer/src/utils/sheet-view.ts`，改为 `src/shared/core/sheet-view.ts`。它是纯函数、零依赖，放 shared 才能被 vitest 覆盖（项目 vitest 只扫 `src/shared` + `src/main/file` + `src/main/export`）。
2. 规格写持久化逻辑放 `src/main/store.ts`，改为新建 `src/main/align.ts`。`store.ts` 只有工作簿内存缓存，而 `recent.json` / `doc-library.json` 的读写都在 `ipc.ts` 里；配置读写独立成文件比塞进 `ipc.ts` 更清晰。

**补充字段：** `TemplatePairResult` 增加 `manualPairs: number`（已套用的人工配对**行对数**，同一对行被多条规则指到只计一次），供界面显示「已应用 N 条人工配对」。规格里没有，但人工配对后若两侧值相等不产生条目，用户会无法确认规则是否生效。

---

## 文件结构

**新增：**

| 文件 | 职责 |
|---|---|
| `src/shared/core/template.ts` | 表号/表样键提取、表样解析、表对配对、逐表比对、人工规则套用。纯函数，零 Node 依赖 |
| `src/shared/core/sheet-view.ts` | `colLetters` / `dataCol` / `makeSpanMethod`。从 SheetGrid、MappingPanel 抽取的重复代码 |
| `src/shared/core/__tests__/template.spec.ts` | template.ts 全部单测 |
| `src/shared/core/__tests__/sheet-view.spec.ts` | sheet-view.ts 单测 |
| `src/main/align.ts` | `userData/template-align.json` 读写 |
| `src/renderer/src/components/TemplatePanel.vue` | 表样核对标签页：文件选择、配对栏、差异列表、单侧清单 |
| `src/renderer/src/components/TemplateGrid.vue` | 单侧网格：差异高亮、跳转定位、右键人工规则 |

**修改：**

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | 追加类型定义 |
| `src/shared/ipc.ts` | 追加 3 个 channel 常量 |
| `src/shared/api.ts` | 追加 3 个方法签名 |
| `src/preload/index.ts` | 追加 3 个 invoke 包装 |
| `src/main/ipc.ts` | 追加 3 个 handler |
| `src/renderer/src/stores/session.ts` | 追加表样核对状态与 action |
| `src/renderer/src/App.vue` | 追加标签页 |
| `src/renderer/src/components/SheetGrid.vue` | 删除本地 `colLetters`/`dataCol`/`spanMethod`，改 import |
| `src/renderer/src/components/MappingPanel.vue` | 同上 |
| `CLAUDE.md` | 架构章节补一句 |

---

## 任务 1：类型定义与表号提取

**文件：**
- 修改：`src/shared/types.ts`（文件末尾追加）
- 创建：`src/shared/core/template.ts`
- 测试：`src/shared/core/__tests__/template.spec.ts`

- [ ] **步骤 1：在 `src/shared/types.ts` 末尾追加类型定义**

```ts
// —— 表样核对 ——

/** 单元格矩形范围（0 起始，含端点） */
export interface CellRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** 表样中的一个「数据格」及其行/列标签路径 */
export interface TemplateCellRef {
  /** 0 起始行号 */
  row: number
  /** 0 起始列号 */
  col: number
  rowPath: string
  colPath: string
  text: string
  num: number | null
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
  headerRange: CellRange
  /** 标签列最大列号 */
  labelEnd: number
  dataStartRow: number
  dataStartCol: number
  /** 仅含「有值行」的全部数据格 */
  cells: TemplateCellRef[]
  /** 表头范围来自人工指定而非锚点推断 */
  manualHeader: boolean
  error?: string
}

export type TemplateDiffKind = 'diff' | 'left-only-value' | 'right-only-value'

export interface TemplateDiff {
  rowPath: string
  colPath: string
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
  /** 该条目由人工配对产生 */
  manual?: boolean
}

/** 只在单侧存在的项（整行或整列在另一侧没有） */
export interface TemplateOnlyEntry {
  side: 'left' | 'right'
  rowPath: string
  colPath: string
  row: number
  col: number
  text: string
}

export interface TemplatePairResult {
  tableNo: string | null
  pairLabel: string
  leftFile: string
  rightFile: string
  left: TemplateSheet | null
  right: TemplateSheet | null
  diffs: TemplateDiff[]
  onlyInLeft: TemplateOnlyEntry[]
  onlyInRight: TemplateOnlyEntry[]
  totalCompared: number
  /** 已套用的人工配对行对数（同一对行被多条规则指到只计一次） */
  manualPairs: number
}

export interface TemplateCheckResult {
  pairs: TemplatePairResult[]
  unmatchedLeft: string[]
  unmatchedRight: string[]
  threshold: number
  totalDiffs: number
  generatedAt: string
}

/** 人工配对 / 忽略规则（坐标 0 起始，from* 指左侧、to* 指右侧） */
export interface AlignPairRule {
  left: string
  right: string
  fromRow: number
  fromCol: number
  toRow?: number
  toCol?: number
  ignored?: boolean
}

export interface AlignConfig {
  version: 1
  templates: Record<string, { headerRange?: CellRange }>
  pairs: AlignPairRule[]
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
  manualPairs?: TemplateTablePair[]
  threshold: number
}
```

- [ ] **步骤 2：编写失败的测试**

创建 `src/shared/core/__tests__/template.spec.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { tableNoOf, templateKeyOf } from '../template'

describe('templateKeyOf', () => {
  it('取 zip 条目名最后一段并去扩展名', () => {
    expect(templateKeyOf('R06.xls')).toBe('R06')
    expect(templateKeyOf('上期包.zip/R06.xlsx')).toBe('R06')
    expect(templateKeyOf('zip/R06.xls')).toBe('R06')
  })

  it('大小写扩展名都能去', () => {
    expect(templateKeyOf('NR31.XLS')).toBe('NR31')
  })
})

describe('tableNoOf', () => {
  it('整段匹配 字母+数字', () => {
    expect(tableNoOf('R06.xls')).toBe('6')
    expect(tableNoOf('NR06.xls')).toBe('6')
    expect(tableNoOf('上期包.zip/NR31.xls')).toBe('31')
  })

  it('整段匹配失败时取名字开头的 字母+数字', () => {
    expect(tableNoOf('R06-人民币贴现利率水平表.xls')).toBe('6')
  })

  it('纯数字或中文开头返回 null', () => {
    expect(tableNoOf('06.xls')).toBeNull()
    expect(tableNoOf('附件2：新口径19张NR表上报逻辑 V1.0.2.xls')).toBeNull()
  })

  it('去前导零', () => {
    expect(tableNoOf('R006.xls')).toBe('6')
  })
})
```

- [ ] **步骤 3：运行测试验证失败**

运行：`npx vitest run src/shared/core/__tests__/template.spec.ts`
预期：FAIL，报错 `Failed to resolve import "../template"`

- [ ] **步骤 4：创建 `src/shared/core/template.ts`**

```ts
import type { AlignConfig, WorkbookData, TemplateSheet, CellRange, SheetData } from '../types'
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
```

（后续任务会继续往这个文件追加函数。）

- [ ] **步骤 5：运行测试验证通过**

运行：`npx vitest run src/shared/core/__tests__/template.spec.ts`
预期：PASS，5 个用例通过

- [ ] **步骤 6：Commit**

```bash
git add src/shared/types.ts src/shared/core/template.ts src/shared/core/__tests__/template.spec.ts
git commit -m "feat(template): 表样核对类型定义与表号提取"
```

---

## 任务 2：表样解析 parseTemplateSheet

**文件：**
- 修改：`src/shared/core/template.ts`（追加）
- 测试：`src/shared/core/__tests__/template.spec.ts`（追加）

规则见规格第 1 节。要点：锚点「项 目」的合并范围定义表头行与标签列；路径拼接时相邻重复段合并；只有「有值行」（至少一个数据格可数值化）才产出 cells。

- [ ] **步骤 1：编写失败的测试**

在 `src/shared/core/__tests__/template.spec.ts` 追加：

```ts
import { parseTemplateSheet } from '../template'
import type { MergedRange, SheetData } from '@shared/types'

/** 造 SheetData：数字串转 number，其余转 string，'.' 与 '' 视为空 */
function sheetOf(name: string, rows: string[][], merges?: MergedRange[]): SheetData {
  const cells = rows.map((row) =>
    row.map((v) => {
      if (v === '' || v === '.') return null
      return /^-?\d+(\.\d+)?$/.test(v) ? { v: Number(v) } : { v }
    })
  )
  return {
    name,
    rowCount: rows.length,
    colCount: Math.max(0, ...rows.map((r) => r.length)),
    cells,
    merges
  }
}

const input = (sheet: SheetData, fileName = 'R06.xls') => ({
  sheet,
  fileName,
  workbookId: 'wb1'
})

/**
 * 基准表样（0 起始）：
 *   r0  表名
 *   r1  [项  目][-][-][发生额][W]      ← 锚点在 A2，合并 A2:C3
 *   r2  [-][-][-][发生额][.]
 *   r3  [贴现][银承][3个月][1.5][2.5]  ← 合并 A4:B5
 *   r4  [-][-][6个月][1.6][2.6]
 */
const baseSheet = (): SheetData =>
  sheetOf(
    'R06',
    [
      ['表名', '', '', '', ''],
      ['项  目', '', '', '发生额', 'W'],
      ['', '', '', '', ''],
      ['贴现', '银承', '3个月', '1.5', '2.5'],
      ['', '', '6个月', '1.6', '2.6']
    ],
    [
      { r1: 1, c1: 0, r2: 2, c2: 2 },
      { r1: 3, c1: 0, r2: 4, c2: 1 }
    ]
  )

describe('parseTemplateSheet', () => {
  it('锚点合并范围决定表头行与标签列', () => {
    const t = parseTemplateSheet(input(baseSheet()))
    expect(t.error).toBeUndefined()
    expect(t.headerRange).toEqual({ r1: 1, c1: 0, r2: 2, c2: 2 })
    expect(t.labelEnd).toBe(2)
    expect(t.dataStartRow).toBe(3)
    expect(t.dataStartCol).toBe(3)
    expect(t.manualHeader).toBe(false)
  })

  it('行路径由标签列各段拼接，合并格向下填充', () => {
    const t = parseTemplateSheet(input(baseSheet()))
    expect(t.cells.map((c) => c.rowPath)).toContain('贴现/银承/3个月')
    expect(t.cells.map((c) => c.rowPath)).toContain('贴现/银承/6个月')
  })

  it('列路径由表头行各段拼接，相邻重复段合并', () => {
    const t = parseTemplateSheet(input(baseSheet()))
    const paths = t.cells.map((c) => c.colPath)
    expect(new Set(paths)).toEqual(new Set(['发生额', 'W']))
  })

  it('横跨两列合并的标签不重复拼接', () => {
    // 「一、活期」合并 A2:B2，填充后 A、B 两列都是同一文本
    const s = sheetOf(
      'X',
      [
        ['项  目', '', 'V'],
        ['一、活期', '', '1']
      ],
      [
        { r1: 0, c1: 0, r2: 0, c2: 1 },
        { r1: 1, c1: 0, r2: 1, c2: 1 }
      ]
    )
    const t = parseTemplateSheet(input(s, 'R01.xls'))
    expect(t.cells[0].rowPath).toBe('一、活期')
  })

  it('数据列全空的行不产出 cells（两侧都空即无差异）', () => {
    const s = baseSheet()
    s.cells.push([{ v: '合计' }, { v: '' }, { v: '' }, null, null])
    s.rowCount = 6
    const t = parseTemplateSheet(input(s))
    expect(t.cells.some((c) => c.rowPath === '合计')).toBe(false)
  })

  it('横向合并跨过数据列的注释行被排除', () => {
    // 注释行 A6:E6 合并：数据列区全是合并覆盖格，没有原始值
    const s = baseSheet()
    s.cells.push([{ v: '注：本表只统计境内业务数据。' }])
    s.rowCount = 6
    s.merges = [...(s.merges ?? []), { r1: 5, c1: 0, r2: 5, c2: 4 }]
    const t = parseTemplateSheet(input(s))
    expect(t.cells.some((c) => c.rowPath.startsWith('注：'))).toBe(false)
  })

  it('数据区合并覆盖格跳过，只取主格值', () => {
    // D5:E5 合并（数据行 r3）：E 变成覆盖格，该行只剩主格 col 3
    const s = baseSheet()
    s.merges = [...(s.merges ?? []), { r1: 3, c1: 3, r2: 3, c2: 4 }]
    const t = parseTemplateSheet(input(s))
    const r3 = t.cells.filter((c) => c.row === 3)
    expect(r3.map((c) => c.col)).toEqual([3])
    expect(r3[0].num).toBe(1.5)
    // 未合并的行不受影响，两列都在
    expect(t.cells.filter((c) => c.row === 4).map((c) => c.col)).toEqual([3, 4])
  })

  it('找不到锚点时报错', () => {
    const s = sheetOf('X', [['表名', '', ''], ['甲', '乙', '1']])
    const t = parseTemplateSheet(input(s, 'R01.xls'))
    expect(t.error).toBe('未找到「项 目」锚点，请手动指定表样范围')
    expect(t.cells).toEqual([])
  })

  it('人工 headerRange 覆盖锚点推断并标记 manualHeader', () => {
    const s = sheetOf('X', [['表名', '', ''], ['甲', '乙', '1']])
    const cfg: AlignConfig = {
      version: 1,
      templates: { R01: { headerRange: { r1: 0, c1: 0, r2: 0, c2: 1 } } },
      pairs: []
    }
    const t = parseTemplateSheet(input(s, 'R01.xls'), cfg)
    expect(t.error).toBeUndefined()
    expect(t.manualHeader).toBe(true)
    expect(t.labelEnd).toBe(1)
    expect(t.dataStartRow).toBe(1)
    expect(t.dataStartCol).toBe(2)
  })

  it('表样键不匹配时人工范围不套用', () => {
    const s = sheetOf('X', [['表名', '', ''], ['甲', '乙', '1']])
    const cfg: AlignConfig = {
      version: 1,
      templates: { R99: { headerRange: { r1: 0, c1: 0, r2: 0, c2: 1 } } },
      pairs: []
    }
    expect(parseTemplateSheet(input(s, 'R01.xls'), cfg).error).toBe(
      '未找到「项 目」锚点，请手动指定表样范围'
    )
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/shared/core/__tests__/template.spec.ts`
预期：FAIL，报错 `parseTemplateSheet is not a function`

- [ ] **步骤 3：在 `src/shared/core/template.ts` 追加实现**

```ts
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
```

同时把 `TemplateCellRef` 加进文件顶部的 type import。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/shared/core/__tests__/template.spec.ts`
预期：PASS，全部用例通过

- [ ] **步骤 5：Commit**

```bash
git add src/shared/core/template.ts src/shared/core/__tests__/template.spec.ts
git commit -m "feat(template): 锚点法表样解析（行/列标签路径提取）"
```

---

## 任务 3：表对配对与逐表比对

**文件：**
- 修改：`src/shared/core/template.ts`（追加）
- 测试：`src/shared/core/__tests__/template.spec.ts`（追加）

- [ ] **步骤 1：编写失败的测试**

在 `src/shared/core/__tests__/template.spec.ts` 追加：

```ts
import { checkTemplates, pairTemplateWorkbooks } from '../template'
import { toNumeric } from '../numeric'
import type { AlignConfig, AlignPairRule, TemplateSheet, WorkbookData } from '@shared/types'

/** 直接造 TemplateSheet，跳过表格解析，专测配对与比对 */
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
    headerRange: { r1: 0, c1: 0, r2: 0, c2: 0 },
    labelEnd: 0,
    dataStartRow: 1,
    dataStartCol: 1,
    cells: cells.map(([row, col, rowPath, colPath, v]) => ({
      row,
      col,
      rowPath,
      colPath,
      text: v === null ? '' : String(v),
      // 与 parseTemplateSheet 一致地走 toNumeric，字符串 '1,200' / '-200' 也能数值化
      num: toNumeric(v === null ? null : { v })
    })),
    manualHeader: false
  }
}

const check = (
  l: TemplateSheet,
  r: TemplateSheet,
  threshold = 0.0001,
  config?: AlignConfig
): ReturnType<typeof checkTemplates> => checkTemplates(l, r, { threshold, config })

describe('checkTemplates', () => {
  it('跨行偏移的同行路径正确配对', () => {
    const l = tsheet('R06', [[5, 3, '转贴现/买断/3个月', '发生额', 1.5]])
    const r = tsheet('NR06', [[8, 3, '转贴现/买断/3个月', '发生额', 1.5]])
    const res = check(l, r)
    expect(res.totalCompared).toBe(1)
    expect(res.diffs).toHaveLength(0) // 值相同，无差异
    expect(res.onlyInLeft).toHaveLength(0)
    expect(res.onlyInRight).toHaveLength(0)
  })

  it('相对差超过阈值标记 diff', () => {
    const l = tsheet('R06', [[5, 3, 'A', '发生额', 1.2]])
    const r = tsheet('NR06', [[5, 3, 'A', '发生额', 1]])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].kind).toBe('diff')
    expect(res.diffs[0].relDiff).toBeCloseTo(0.2 / 1.2, 10)
  })

  it('相对差恰好等于阈值不标记（严格大于）', () => {
    // |2.0001-2| / 2.0001 = 0.0000499975...；阈值设为该值本身
    const rd = Math.abs(2.0001 - 2) / 2.0001
    const l = tsheet('R31', [[5, 12, 'A', '（75,+∞）', 2.0001]])
    const r = tsheet('NR31', [[5, 12, 'A', '（75,+∞）', 2]])
    expect(check(l, r, rd).diffs).toHaveLength(0)
    expect(check(l, r, rd * 0.5).diffs).toHaveLength(1)
  })

  it('双 0 跳过、两侧都无数值跳过', () => {
    const l = tsheet('R06', [
      [5, 3, 'A', '发生额', 0],
      [6, 3, 'B', '发生额', null]
    ])
    const r = tsheet('NR06', [
      [5, 3, 'A', '发生额', 0],
      [6, 3, 'B', '发生额', null]
    ])
    expect(check(l, r).diffs).toHaveLength(0)
  })

  it('一侧有值一侧为空记单侧有值', () => {
    const l = tsheet('R06', [[5, 3, 'A', '发生额', 1.5]])
    const r = tsheet('NR06', [[5, 3, 'A', '发生额', null]])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].kind).toBe('left-only-value')
    expect(res.diffs[0].relDiff).toBeNull()
  })

  it('只在单侧出现的行进 onlyIn，不进 diffs', () => {
    const l = tsheet('R06', [
      [5, 3, 'A', '发生额', 1],
      [6, 3, '贴现/银承/合计', '发生额', 3.3]
    ])
    const r = tsheet('NR06', [[5, 3, 'A', '发生额', 1]])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(0)
    expect(res.onlyInLeft).toHaveLength(1)
    expect(res.onlyInLeft[0].rowPath).toBe('贴现/银承/合计')
  })

  it('同表内配对键重复时按出现顺序分别配对，不静默错配', () => {
    const l = tsheet('R06', [
      [5, 3, 'A', '发生额', 1],
      [9, 3, 'A', '发生额', 5]
    ])
    const r = tsheet('NR06', [
      [5, 3, 'A', '发生额', 1.5],
      [9, 3, 'A', '发生额', 5]
    ])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].leftRow).toBe(5)
    expect(res.diffs[0].rightRow).toBe(5)
  })

  it('负值与千分位、百分号文本贯通数值化', () => {
    const l = tsheet('R06', [
      [5, 3, 'A', '发生额', -100],
      [6, 3, 'B', '发生额', 1000]
    ])
    const r = tsheet('NR06', [
      [5, 3, 'A', '发生额', '-200'],
      [6, 3, 'B', '发生额', '1,200']
    ])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(2)
    expect(res.diffs[0].kind).toBe('diff')
  })

  it('解析失败的表返回空结果', () => {
    const l = tsheet('R06', [[5, 3, 'A', '发生额', 1]])
    const bad: TemplateSheet = { ...tsheet('NR06', []), error: '未找到「项 目」锚点，请手动指定表样范围' }
    const res = check(l, bad)
    expect(res.diffs).toHaveLength(0)
    expect(res.totalCompared).toBe(0)
  })

  it('人工配对是行级的：只配一列，整行按列路径重新对齐', () => {
    // 左侧 R31 的「单位存款」路径配不上 NR31 的「一、活期/单位存款」，两侧列路径相同
    const l = tsheet('R31', [
      [5, 3, '单位存款', 'D', 1.1],
      [5, 4, '单位存款', 'E', 2.1],
      [5, 5, '单位存款', 'F', 2]
    ])
    const r = tsheet('NR31', [
      [5, 3, '一、活期/单位存款', 'D', 1],
      [5, 4, '一、活期/单位存款', 'E', 2],
      [5, 5, '一、活期/单位存款', 'F', 2]
    ])
    const auto = check(l, r)
    expect(auto.diffs).toHaveLength(0)
    expect(auto.onlyInLeft).toHaveLength(3)

    // 只配 D 列一格，整行归位：D、E 各出一条差异，F 两侧相等不出条目
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [{ left: 'R31', right: 'NR31', fromRow: 5, fromCol: 3, toRow: 5, toCol: 3 }]
    }
    const res = check(l, r, 0.0001, cfg)
    expect(res.onlyInLeft).toHaveLength(0)
    expect(res.onlyInRight).toHaveLength(0)
    expect(res.diffs.map((d) => d.colPath)).toEqual(['D', 'E'])
    expect(res.diffs.every((d) => d.manual)).toBe(true)
    expect(res.manualPairs).toBe(1)
  })

  it('行级配对：多条规则指同一对行只比对一次', () => {
    const l = tsheet('R31', [
      [5, 3, '单位存款', 'D', 1.1],
      [5, 4, '单位存款', 'E', 2.1]
    ])
    const r = tsheet('NR31', [
      [5, 3, '一、活期/单位存款', 'D', 1],
      [5, 4, '一、活期/单位存款', 'E', 2]
    ])
    const pair = (fromCol: number, toCol: number): AlignPairRule => ({
      left: 'R31',
      right: 'NR31',
      fromRow: 5,
      fromCol,
      toRow: 5,
      toCol
    })
    const res = check(l, r, 0.0001, {
      version: 1,
      templates: {},
      pairs: [pair(3, 3), pair(4, 4)]
    })
    expect(res.diffs.map((d) => d.colPath)).toEqual(['D', 'E']) // 不是 D、E、D、E
    expect(res.manualPairs).toBe(1)
  })

  it('行级配对：列路径在一侧缺失的格仍记仅单侧存在', () => {
    const l = tsheet('R31', [
      [5, 3, '单位存款', 'D', 1.1],
      [5, 4, '单位存款', '仅左侧有', 5]
    ])
    const r = tsheet('NR31', [
      [5, 3, '一、活期/单位存款', 'D', 1],
      [5, 5, '一、活期/单位存款', '仅右侧有', 6]
    ])
    const res = check(l, r, 0.0001, {
      version: 1,
      templates: {},
      pairs: [{ left: 'R31', right: 'NR31', fromRow: 5, fromCol: 3, toRow: 5, toCol: 3 }]
    })
    expect(res.diffs.map((d) => d.colPath)).toEqual(['D'])
    expect(res.onlyInLeft.map((e) => e.colPath)).toEqual(['仅左侧有'])
    expect(res.onlyInRight.map((e) => e.colPath)).toEqual(['仅右侧有'])
  })

  it('忽略名单移除条目', () => {
    const l = tsheet('R31', [[5, 3, '单位存款', '发生额', 1.1]])
    const r = tsheet('NR31', [[5, 3, '一、活期/单位存款', '发生额', 1]])
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [{ left: 'R31', right: 'NR31', fromRow: 5, fromCol: 3, ignored: true }]
    }
    const res = check(l, r, 0.0001, cfg)
    expect(res.diffs).toHaveLength(0)
    expect(res.onlyInLeft).toHaveLength(0)
  })

  it('表样键不匹配时人工规则不套用', () => {
    const l = tsheet('R31', [[5, 3, '单位存款', '发生额', 1.1]])
    const r = tsheet('NR31', [[5, 3, '一、活期/单位存款', '发生额', 1]])
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [{ left: 'R06', right: 'NR06', fromRow: 5, fromCol: 3, toRow: 5, toCol: 3 }]
    }
    expect(check(l, r, 0.0001, cfg).diffs).toHaveLength(0)
    expect(check(l, r, 0.0001, cfg).onlyInLeft).toHaveLength(1)
  })
})

describe('pairTemplateWorkbooks', () => {
  const wb = (fileName: string, id = fileName): WorkbookData => ({
    id,
    fileName,
    source: 'zip',
    sheetNames: [],
    sheets: {}
  })

  it('按表号自动配对', () => {
    const res = pairTemplateWorkbooks(
      [wb('R06.xls'), wb('R31.xls')],
      [wb('NR06.xls'), wb('NR31.xls')]
    )
    expect(res.pairs.map((p) => [p.left.fileName, p.right.fileName])).toEqual([
      ['R06.xls', 'NR06.xls'],
      ['R31.xls', 'NR31.xls']
    ])
    expect(res.unmatchedLeft).toEqual([])
    expect(res.unmatchedRight).toEqual([])
  })

  it('表号提不出的进 unmatched', () => {
    const res = pairTemplateWorkbooks([wb('R06.xls'), wb('附件2.xls')], [wb('NR06.xls')])
    expect(res.pairs).toHaveLength(1)
    expect(res.unmatchedLeft).toEqual(['附件2.xls'])
  })

  it('同号多候选时不自动配对（交给人工）', () => {
    const res = pairTemplateWorkbooks([wb('R06.xls')], [wb('NR06.xls'), wb('NR06-副本.xls', 'b')])
    expect(res.pairs).toHaveLength(0)
    expect(res.unmatchedLeft).toEqual(['R06.xls'])
    expect(res.unmatchedRight).toHaveLength(2)
  })

  it('manualPairs 优先并占用名额', () => {
    const res = pairTemplateWorkbooks(
      [wb('R06.xls')],
      [wb('NR06.xls'), wb('NR06-副本.xls', 'b')],
      [{ leftId: 'R06.xls', rightId: 'b' }]
    )
    expect(res.pairs).toHaveLength(1)
    expect(res.pairs[0].right.fileName).toBe('NR06-副本.xls')
    expect(res.unmatchedRight).toEqual(['NR06.xls'])
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/shared/core/__tests__/template.spec.ts`
预期：FAIL，报错 `checkTemplates is not a function`

- [ ] **步骤 3：在 `src/shared/core/template.ts` 追加实现**

```ts
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
 * 套用人工配对与忽略名单。
 *
 * 配对是**行级**的：规则两端所在的行建立一对行对应关系，这两行不再看行路径，
 * 改按列路径逐列对齐重比，覆盖自动配对在这两行上的全部结果。成因是配不上时
 * 往往是整行丢了父级标签（R31 的 A6:B7 是空合并格 → 行路径只剩「单位存款」，
 * 而 NR31 是「一、活期/单位存款」），逐格配既费事又会漏掉没点到的列。
 *
 * 忽略是**格级**的：只移除该格结果，不建立行对。
 * 规则的表样键必须与当前表对一致，否则整条忽略（换了一套报表后旧规则自然失效，不误套）。
 */
function applyRules(res: TemplatePairResult, cfg: AlignConfig | undefined, threshold: number): void {
  const left = res.left
  const right = res.right
  if (!cfg || !left || !right || left.error || right.error) return
  const rules = cfg.pairs.filter((p) => p.left === left.key && p.right === right.key)
  if (rules.length === 0) return

  const rowPairs: [number, number][] = []
  for (const rule of rules) {
    if (rule.ignored) {
      res.diffs = res.diffs.filter((d) => !atLeft(d, rule.fromRow, rule.fromCol))
      res.onlyInLeft = res.onlyInLeft.filter(
        (e) => !(e.row === rule.fromRow && e.col === rule.fromCol)
      )
      continue
    }
    if (rule.toRow === undefined || rule.toCol === undefined) continue
    // 同一对行可能被多条规则（不同列）指到，去重以免整行被重复比对
    if (!rowPairs.some(([lr, rr]) => lr === rule.fromRow && rr === rule.toRow)) {
      rowPairs.push([rule.fromRow, rule.toRow])
    }
  }
  if (rowPairs.length === 0) return

  const leftRows = new Set(rowPairs.map(([lr]) => lr))
  const rightRows = new Set(rowPairs.map(([, rr]) => rr))
  res.diffs = res.diffs.filter((d) => !leftRows.has(d.leftRow) && !rightRows.has(d.rightRow))
  res.onlyInLeft = res.onlyInLeft.filter((e) => !leftRows.has(e.row))
  res.onlyInRight = res.onlyInRight.filter((e) => !rightRows.has(e.row))

  for (const [lr, rr] of rowPairs) {
    res.manualPairs++ // 计数的是行对（用户实际做的配对次数），不是配成的格数
    const byCol = new Map<string, TemplateCellRef>()
    for (const c of right.cells) if (c.row === rr) byCol.set(c.colPath, c)
    for (const l of left.cells) {
      if (l.row !== lr) continue
      const r = byCol.get(l.colPath)
      if (!r) {
        res.onlyInLeft.push(toOnly('left', l)) // 该列路径右侧没有，仍是仅单侧存在
        continue
      }
      byCol.delete(l.colPath)
      const before = res.diffs.length
      collect(res.diffs, l, r, threshold)
      if (res.diffs.length > before) res.diffs[res.diffs.length - 1].manual = true
    }
    for (const r of byCol.values()) res.onlyInRight.push(toOnly('right', r))
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
```

同时把 `TemplateCellRef`、`TemplateDiff`、`TemplateOnlyEntry`、`TemplatePairResult`、`TemplateTablePair` 加进顶部的 type import。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/shared/core/__tests__/template.spec.ts`
预期：PASS，全部用例通过

- [ ] **步骤 5：跑全量测试确认没有回归**

运行：`npm test`
预期：原 70 个用例 + 新增用例全绿

- [ ] **步骤 6：Commit**

```bash
git add src/shared/core/template.ts src/shared/core/__tests__/template.spec.ts
git commit -m "feat(template): 表对配对、逐表比对与人工规则套用"
```

---

## 任务 4：抽取 sheet-view 工具（纯重构）

`colLetters` / `dataCol` / `spanMethod` 目前在 `SheetGrid.vue` 与 `MappingPanel.vue` 各有一份完全相同的副本，新增网格会成为第三份。抽取为纯函数。

**文件：**
- 创建：`src/shared/core/sheet-view.ts`
- 创建：`src/shared/core/__tests__/sheet-view.spec.ts`
- 修改：`src/renderer/src/components/SheetGrid.vue:51-84`（删除 `dataCol`/`spanMethod`/`colLetters`，改 import）
- 修改：`src/renderer/src/components/MappingPanel.vue:74-105`（同上）

- [ ] **步骤 1：编写失败的测试**

创建 `src/shared/core/__tests__/sheet-view.spec.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { colLetters, dataCol, makeSpanMethod } from '../sheet-view'
import type { MergeSpan } from '../merge'

describe('colLetters', () => {
  it('1 → A、3 → C、26 → Z、27 → AA、28 → AB', () => {
    expect(colLetters(3)).toEqual(['A', 'B', 'C'])
    expect(colLetters(26)[25]).toBe('Z')
    expect(colLetters(27)[26]).toBe('AA')
    expect(colLetters(28)[27]).toBe('AB')
  })
})

describe('dataCol', () => {
  it('第 0 列是行号列，数据列索引从 0 开始', () => {
    expect(dataCol(0)).toBe(-1)
    expect(dataCol(1)).toBe(0)
  })
})

describe('makeSpanMethod', () => {
  const spans: (MergeSpan | null)[][] = [
    [{ rowspan: 2, colspan: 1 }, { rowspan: 0, colspan: 0 }],
    [null, { rowspan: 1, colspan: 1 }]
  ]

  it('主格展开、被覆盖格隐藏、无合并返回 [1,1]', () => {
    const m = makeSpanMethod(() => spans)
    expect(m({ rowIndex: 0, columnIndex: 1 })).toEqual([2, 1]) // 行号列偏移：columnIndex 1 = 数据列 0
    expect(m({ rowIndex: 0, columnIndex: 2 })).toEqual([0, 0])
    expect(m({ rowIndex: 1, columnIndex: 1 })).toEqual([1, 1])
  })

  it('行号列（columnIndex 0）不参与合并', () => {
    const m = makeSpanMethod(() => spans)
    expect(m({ rowIndex: 0, columnIndex: 0 })).toEqual([1, 1])
  })

  it('spans 为 null 时全部返回 [1,1]', () => {
    const m = makeSpanMethod(() => null)
    expect(m({ rowIndex: 0, columnIndex: 1 })).toEqual([1, 1])
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/shared/core/__tests__/sheet-view.spec.ts`
预期：FAIL，报错 `Failed to resolve import "../sheet-view"`

- [ ] **步骤 3：创建 `src/shared/core/sheet-view.ts`**

```ts
import type { MergeSpan } from './merge'

/** el-table 列序号 → 数据列索引（第 0 列是行号列，数据列从 1 开始） */
export function dataCol(columnIndex: number): number {
  return columnIndex - 1
}

/** 列序号 → Excel 列字母（1 → A、27 → AA） */
export function colLetters(colCount: number): string[] {
  const out: string[] = []
  for (let c = 1; c <= colCount; c++) {
    let n = c
    let letters = ''
    while (n > 0) {
      const rem = (n - 1) % 26
      letters = String.fromCharCode(65 + rem) + letters
      n = Math.floor((n - 1) / 26)
    }
    out.push(letters)
  }
  return out
}

/**
 * el-table span-method 工厂：主格展开，被覆盖格隐藏；行号列（第 0 列）不参与合并。
 * @param getSpans 返回 span 矩阵（行 0 起始，与 data 行索引一致）
 */
export function makeSpanMethod(
  getSpans: () => (MergeSpan | null)[][] | null
): (p: { rowIndex: number; columnIndex: number }) => [number, number] {
  return ({ rowIndex, columnIndex }) => {
    const c = dataCol(columnIndex)
    if (c < 0) return [1, 1]
    const s = getSpans()?.[rowIndex]?.[c]
    if (!s) return [1, 1]
    return [s.rowspan, s.colspan]
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/shared/core/__tests__/sheet-view.spec.ts`
预期：PASS

- [ ] **步骤 5：改 SheetGrid.vue 引用**

在 `src/renderer/src/components/SheetGrid.vue` 中：

1. 在 `import { buildMergeSpans } from '@shared/core/merge'` 之后加一行：
```ts
import { colLetters, dataCol, makeSpanMethod } from '@shared/core/sheet-view'
```
2. 删除 `SheetGrid.vue:51-69` 的 `dataCol` 与 `spanMethod` 两个函数定义，替换为：
```ts
/** el-table span-method：主格展开，被覆盖格隐藏；行号列不参与合并 */
const spanMethod = makeSpanMethod(() => spans.value)
```
3. 删除 `SheetGrid.vue:71-84` 的 `colLetters` 函数定义。
4. 确认 `cellClass` 与 `jumpFromMenu` 里对 `dataCol`、`colLetters` 的调用保持不变（现在来自 import）。

- [ ] **步骤 6：改 MappingPanel.vue 引用**

在 `src/renderer/src/components/MappingPanel.vue` 中做同样的四处改动（删除 `dataCol`/`spanMethod`/`colLetters`，改 import + `makeSpanMethod`）。`MappingPanel.vue` 的 `cellClass` 也用到 `dataCol`，保持调用不变。

- [ ] **步骤 7：类型检查与构建验证**

运行：`npm run typecheck && npm test && npm run build`
预期：typecheck 无错、测试全绿、构建成功

- [ ] **步骤 8：手动确认现有功能未受影响**

运行：`npm run dev`，加载 `samples/上期包.zip` 与 `samples/本期包.zip`，点击「开始比对」，确认：

- 网格高亮的合并单元格显示正常（行号列不参与合并）
- 表头列字母正确（A、B、C…）
- 口径查询页的表格合并与列字母同样正常

- [ ] **步骤 9：Commit**

```bash
git add src/shared/core/sheet-view.ts src/shared/core/__tests__/sheet-view.spec.ts src/renderer/src/components/SheetGrid.vue src/renderer/src/components/MappingPanel.vue
git commit -m "refactor: 抽取 colLetters/spanMethod 为共享纯函数"
```

---

## 任务 5：主进程接入

**文件：**
- 创建：`src/main/align.ts`
- 修改：`src/shared/ipc.ts`
- 修改：`src/shared/api.ts`
- 修改：`src/preload/index.ts`
- 修改：`src/main/ipc.ts`

- [ ] **步骤 1：创建 `src/main/align.ts`**

```ts
import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AlignConfig } from '@shared/types'

/** 表样人工规则配置（按表样键索引），落盘到 userData */
function alignPath(): string {
  return join(app.getPath('userData'), 'template-align.json')
}

/** 读取人工规则；文件不存在或损坏时返回空配置（不抛错，核对流程照常跑） */
export async function loadAlignConfig(): Promise<AlignConfig> {
  try {
    const raw = JSON.parse(await readFile(alignPath(), 'utf-8'))
    return {
      version: 1,
      templates: raw?.templates && typeof raw.templates === 'object' ? raw.templates : {},
      pairs: Array.isArray(raw?.pairs) ? raw.pairs : []
    }
  } catch {
    return { version: 1, templates: {}, pairs: [] }
  }
}

export async function saveAlignConfig(cfg: AlignConfig): Promise<void> {
  await writeFile(alignPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}
```

- [ ] **步骤 2：在 `src/shared/ipc.ts` 追加 channel**

在 `recentSet` 之后、`appVersion` 之前插入三行：

```ts
  templateCheck: 'template:check',
  templateAlignGet: 'template:align:get',
  templateAlignSet: 'template:align:set',
```

- [ ] **步骤 3：在 `src/shared/api.ts` 追加方法签名**

先在顶部 type import 中加入 `AlignConfig`、`TemplateCheckRequest`、`TemplateCheckResult`，然后在接口中追加：

```ts
  /** 表样核对：按表号配对两套报表并逐表比对 */
  checkTemplate(req: TemplateCheckRequest): Promise<TemplateCheckResult>
  /** 读取人工配对/表样范围配置 */
  getAlignConfig(): Promise<AlignConfig>
  setAlignConfig(cfg: AlignConfig): Promise<void>
```

- [ ] **步骤 4：在 `src/preload/index.ts` 追加包装**

在 type import 中加入 `AlignConfig`、`TemplateCheckRequest`，然后在 `api` 对象里 `getVersion` 之前追加：

```ts
  checkTemplate: (req: TemplateCheckRequest) => ipcRenderer.invoke(IPC.templateCheck, req),
  getAlignConfig: () => ipcRenderer.invoke(IPC.templateAlignGet),
  setAlignConfig: (cfg: AlignConfig) => ipcRenderer.invoke(IPC.templateAlignSet, { cfg }),
```

- [ ] **步骤 5：在 `src/main/ipc.ts` 追加 handler**

在 type import 中加入 `TemplateCheckRequest`、`TemplateCheckResult`、`AlignConfig`，并加：

```ts
import {
  checkTemplates,
  pairTemplateWorkbooks,
  parseWorkbook
} from '@shared/core/template'
import { loadAlignConfig, saveAlignConfig } from './align'
```

在 `registerIpc()` 内 `IPC.recentSet` handler 之后追加：

```ts
  ipcMain.handle(
    IPC.templateCheck,
    async (_e, req: TemplateCheckRequest): Promise<TemplateCheckResult> => {
      if (!Array.isArray(req?.leftIds) || !Array.isArray(req?.rightIds)) {
        throw new Error('无效的核对请求')
      }
      const left = req.leftIds.map((id) => getWorkbook(id))
      const right = req.rightIds.map((id) => getWorkbook(id))
      if (left.some((w) => !w) || right.some((w) => !w)) {
        throw new Error('部分工作簿不存在或已被释放')
      }
      if (left.length === 0 || right.length === 0) throw new Error('请先选择两套报表')

      const cfg = await loadAlignConfig()
      const threshold = typeof req.threshold === 'number' ? req.threshold : 0.0001
      const pairing = pairTemplateWorkbooks(
        left as WorkbookData[],
        right as WorkbookData[],
        req.manualPairs ?? []
      )
      const pairs = pairing.pairs.map((p) =>
        checkTemplates(parseWorkbook(p.left, cfg), parseWorkbook(p.right, cfg), {
          threshold,
          config: cfg
        })
      )
      pairs.sort((a, b) => (a.tableNo ?? '').localeCompare(b.tableNo ?? '', undefined, { numeric: true }))

      return {
        pairs,
        unmatchedLeft: pairing.unmatchedLeft,
        unmatchedRight: pairing.unmatchedRight,
        threshold,
        totalDiffs: pairs.reduce((s, p) => s + p.diffs.length, 0),
        generatedAt: new Date().toISOString()
      }
    }
  )

  ipcMain.handle(IPC.templateAlignGet, (): Promise<AlignConfig> => loadAlignConfig())

  ipcMain.handle(
    IPC.templateAlignSet,
    async (_e, req: { cfg: AlignConfig }): Promise<void> => {
      if (!req?.cfg || typeof req.cfg !== 'object') throw new Error('无效的人工规则配置')
      await saveAlignConfig(req.cfg)
    }
  )
```

同时把 `WorkbookData` 加进 `src/main/ipc.ts` 的 type import。

- [ ] **步骤 6：类型检查与构建验证**

运行：`npm run typecheck && npm run build`
预期：无类型错误，构建成功

- [ ] **步骤 7：Commit**

```bash
git add src/main/align.ts src/shared/ipc.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(template): 主进程接入表样核对 IPC 与人工规则持久化"
```

---

## 任务 6：session store 状态与 TemplateGrid

**文件：**
- 修改：`src/renderer/src/stores/session.ts`
- 创建：`src/renderer/src/components/TemplateGrid.vue`

- [ ] **步骤 1：在 session store 追加状态**

在 `SessionState` 接口中追加：

```ts
  /** 表样核对：左侧（R 系列）与右侧（NR 系列）报表 */
  templateLeft: WorkbookData[]
  templateRight: WorkbookData[]
  templateLeftPath: string
  templateRightPath: string
  templateResult: TemplateCheckResult | null
  /** 表样核对的相对差阈值（小数，0.0001 = 0.01%） */
  templateThreshold: number
  /** 当前查看的表对索引 */
  templatePairIndex: number
  /** 网格当前显示哪一侧 */
  templateSide: 'left' | 'right'
  /** 差异列表点击 → 网格跳转目标 */
  templateFocus: { row: number; col: number } | null
  /** 人工指定的表对（表号冲突时用），仅本次生效 */
  manualTablePairs: TemplateTablePair[]
  alignConfig: AlignConfig | null
```

在 `state()` 中追加对应初值：

```ts
    templateLeft: [],
    templateRight: [],
    templateLeftPath: '',
    templateRightPath: '',
    templateResult: null,
    templateThreshold: 0.0001,
    templatePairIndex: 0,
    templateSide: 'left',
    templateFocus: null,
    manualTablePairs: [],
    alignConfig: null,
```

在 `getters` 中追加：

```ts
    /** 当前表对；无结果时为 null */
    activeTemplatePair: (s): TemplatePairResult | null =>
      s.templateResult?.pairs[s.templatePairIndex] ?? null,
    /** 当前表对中、当前侧对应的工作簿（按表样解析结果里的 workbookId 精确匹配） */
    activeTemplateWorkbook: (s): WorkbookData | null => {
      const p = s.templateResult?.pairs[s.templatePairIndex]
      const ts = s.templateSide === 'left' ? p?.left : p?.right
      if (!ts) return null
      const list = s.templateSide === 'left' ? s.templateLeft : s.templateRight
      return list.find((w) => w.id === ts.workbookId) ?? null
    },
    /** 当前表对中，落在当前侧的差异格集合（"row,col"，0 起始） */
    templateHitSet: (s): Set<string> => {
      const p = s.templateResult?.pairs[s.templatePairIndex]
      const set = new Set<string>()
      if (!p) return set
      for (const d of p.diffs) {
        set.add(
          s.templateSide === 'left' ? `${d.leftRow},${d.leftCol}` : `${d.rightRow},${d.rightCol}`
        )
      }
      return set
    }
```

在 `actions` 中追加（`clearGridFocus` 之后）：

```ts
    /** 加载表样核对某一侧的 zip */
    async loadTemplateSide(side: 'left' | 'right', path: string): Promise<void> {
      this.loading = true
      try {
        const res = await window.api.loadReport(path)
        if (res.error) throw new Error(res.error)
        if (res.workbooks.length === 0) throw new Error('文件中没有可解析的 Excel')
        if (side === 'left') {
          this.templateLeft = res.workbooks
          this.templateLeftPath = path
        } else {
          this.templateRight = res.workbooks
          this.templateRightPath = path
        }
        this.templateResult = null
      } finally {
        this.loading = false
      }
    },

    async runTemplateCheck(): Promise<void> {
      if (!this.templateLeft.length || !this.templateRight.length) return
      this.loading = true
      try {
        this.templateResult = await window.api.checkTemplate({
          leftIds: this.templateLeft.map((w) => w.id),
          rightIds: this.templateRight.map((w) => w.id),
          manualPairs: this.manualTablePairs,
          threshold: this.templateThreshold
        })
        this.templatePairIndex = 0
        this.templateFocus = null
      } finally {
        this.loading = false
      }
    },

    async reloadAlignConfig(): Promise<void> {
      this.alignConfig = await window.api.getAlignConfig()
    },

    /** 写入人工规则并重新核对 */
    async saveAlignConfig(cfg: AlignConfig): Promise<void> {
      await window.api.setAlignConfig(cfg)
      this.alignConfig = cfg
      await this.runTemplateCheck()
    },

    /** 差异列表行点击 → 切到对应侧并跳转 */
    focusTemplateCell(pairIndex: number, side: 'left' | 'right', row: number, col: number): void {
      this.templatePairIndex = pairIndex
      this.templateSide = side
      this.templateFocus = { row, col }
    }
```

同时把这些类型加进 `src/renderer/src/stores/session.ts` 顶部的 import：
`AlignConfig`、`TemplateCheckResult`、`TemplatePairResult`、`TemplateTablePair`。

- [ ] **步骤 2：创建 `src/renderer/src/components/TemplateGrid.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSessionStore } from '../stores/session'
import { buildMergeSpans } from '@shared/core/merge'
import { colLetters, dataCol, makeSpanMethod } from '@shared/core/sheet-view'
import { useDragPan } from '../utils/dragPan'

const session = useSessionStore()

const emit = defineEmits<{
  (e: 'pick-pair', row: number, col: number): void
  (e: 'ignore', row: number, col: number): void
  (e: 'cell-click', row: number, col: number): void
}>()

const gridRef = ref<{
  $el: HTMLElement
  scrollTo: (o: { top: number }) => void
} | null>(null)
const tableHeight = 420

/** 当前侧的工作表（本项目报表均为单 sheet，取第一个） */
const sheetData = computed(() => {
  const wb = session.activeTemplateWorkbook
  const name = wb?.sheetNames[0]
  return name ? (wb?.sheets[name] ?? null) : null
})

const rowCount = computed(() => sheetData.value?.rowCount ?? 0)
const colCount = computed(() => sheetData.value?.colCount ?? 0)

const spans = computed(() =>
  sheetData.value ? buildMergeSpans(sheetData.value.merges, rowCount.value, colCount.value) : null
)
const spanMethod = makeSpanMethod(() => spans.value)

const rows = computed(() =>
  (sheetData.value?.cells ?? []).map((row, i) => ({ _rowIndex: i, cells: row }))
)

function cellText(rowIdx: number, colIdx: number): string {
  const cell = sheetData.value?.cells[rowIdx]?.[colIdx]
  return cell && cell.v !== null ? String(cell.v) : ''
}

function cellClass({ rowIndex, columnIndex }: { rowIndex: number; columnIndex: number }): string {
  const c = dataCol(columnIndex)
  if (c < 0) return ''
  const classes: string[] = []
  const s = spans.value?.[rowIndex]?.[c]
  if (s && s.rowspan > 0) classes.push('merge-master')
  // 差异跳转聚焦格：紫色标记（优先于命中标记）
  const f = session.templateFocus
  if (f && f.row === rowIndex && f.col === c) classes.push('cell-focused')
  if (session.templateHitSet.has(`${rowIndex},${c}`)) classes.push('diff-hit')
  return classes.join(' ')
}

/** 点格统一上报给 TemplatePanel，由它决定当前是配对模式、表样范围模式还是普通点击 */
function onCellClick(row: { _rowIndex: number }, column: { property?: string }): void {
  if (dragging.value) return // 拖拽平移结束的这次点击不应当作选格
  const prop = column?.property
  if (typeof prop !== 'string' || !prop.startsWith('c')) return
  const c = Number(prop.slice(1))
  if (Number.isNaN(c)) return
  emit('cell-click', row._rowIndex, c)
}

// —— 右键菜单：指定配对 / 忽略 ——

const ctxMenu = ref<{ row: number; col: number; x: number; y: number } | null>(null)

function closeCtxMenu(): void {
  ctxMenu.value = null
}

function onCellContextMenu(
  row: { _rowIndex: number },
  column: { property?: string },
  _cell: unknown,
  event: MouseEvent
): void {
  const prop = column?.property
  if (typeof prop !== 'string' || !prop.startsWith('c')) return
  const c = Number(prop.slice(1))
  if (Number.isNaN(c)) return
  event.preventDefault()
  ctxMenu.value = { row: row._rowIndex, col: c, x: event.clientX, y: event.clientY }
}

function startPick(): void {
  const m = ctxMenu.value
  closeCtxMenu()
  if (m) emit('pick-pair', m.row, m.col)
}

function ignoreCell(): void {
  const m = ctxMenu.value
  closeCtxMenu()
  if (m) emit('ignore', m.row, m.col)
}

// 全局单击任意位置关闭右键菜单
onMounted(() => document.addEventListener('click', closeCtxMenu))
onUnmounted(() => document.removeEventListener('click', closeCtxMenu))

// —— 左键拖拽平移（Ctrl+左键保留原生文本选择），与 SheetGrid 一致 ——

const { dragging, onMouseDown: startPan } = useDragPan(
  () =>
    gridRef.value?.$el.querySelector<HTMLElement>('.el-table__body-wrapper .el-scrollbar__wrap') ??
    null
)

/** 仅表体触发平移：表头留给原生交互 */
function onGridMouseDown(e: MouseEvent): void {
  if (!(e.target as HTMLElement | null)?.closest('.el-table__body-wrapper')) return
  startPan(e)
}

// 差异列表点击跳转：估算滚动到目标行
watch(
  () => session.templateFocus,
  (f) => {
    if (!f) return
    setTimeout(() => gridRef.value?.scrollTo({ top: Math.max(0, f.row - 3) * 40 }), 100)
  }
)
</script>

<template>
  <div class="template-grid">
    <el-table
      v-if="sheetData"
      ref="gridRef"
      :data="rows"
      size="small"
      border
      :height="tableHeight"
      :cell-class-name="cellClass"
      :span-method="spanMethod"
      @mousedown="onGridMouseDown"
      @cell-click="onCellClick"
      @cell-contextmenu="onCellContextMenu"
    >
      <el-table-column
        type="index"
        label=""
        width="56"
        align="right"
        fixed="left"
        class-name="row-number-col"
      />
      <el-table-column
        v-for="c in colCount"
        :key="c"
        :prop="'c' + (c - 1)"
        :label="colLetters(colCount)[c - 1]"
        :min-width="120"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ cellText(row._rowIndex, c - 1) }}</template>
      </el-table-column>
    </el-table>
    <div
      v-if="ctxMenu"
      class="template-ctx-menu"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
    >
      <div class="ctx-item" @click="startPick">指定配对…</div>
      <div class="ctx-item" @click="ignoreCell">忽略此项</div>
    </div>
  </div>
</template>

<style scoped>
.template-grid {
  position: relative;
}
</style>

<style>
.template-grid .el-table .row-number-col {
  background: #f5f7fa;
  color: #909399;
  font-weight: 400;
}
/* 顺序有意：cell-focused 在后，同时命中时紫压粉（与 SheetGrid 一致） */
.template-grid .el-table .diff-hit {
  background: #ffd6e8 !important;
  font-weight: 600;
  color: #d6336c;
}
.template-grid .el-table .cell-focused {
  background: #e6d0f5 !important;
  color: #6d28d9 !important;
  font-weight: 700;
}
.template-grid .el-table .merge-master {
  text-align: center;
  font-weight: 600;
  vertical-align: middle;
}
.template-ctx-menu {
  position: fixed;
  z-index: 3000;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  min-width: 160px;
}
.template-ctx-menu .ctx-item {
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.template-ctx-menu .ctx-item:hover {
  background: #f5f7fa;
  color: #409eff;
}
</style>
```

**设计说明**：组件不保存任何「配对模式」状态，点击一律通过 `cell-click` 上报，由 TemplatePanel 根据自身的 `pickSource` / `rangeStart` 决定这次点击意味着什么。这样模式状态只有一个来源，不会出现网格与面板对模式理解不一致的情况。

- [ ] **步骤 3：类型检查**

运行：`npm run typecheck`
预期：无类型错误

- [ ] **步骤 4：Commit**

```bash
git add src/renderer/src/stores/session.ts src/renderer/src/components/TemplateGrid.vue
git commit -m "feat(template): 表样核对状态与单侧网格组件"
```

---

## 任务 7：TemplatePanel 与标签页

**文件：**
- 创建：`src/renderer/src/components/TemplatePanel.vue`
- 修改：`src/renderer/src/App.vue`

- [ ] **步骤 1：创建 `src/renderer/src/components/TemplatePanel.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AlignConfig, AlignPairRule, CellRange, TemplateDiff } from '@shared/types'
import { templateKeyOf } from '@shared/core/template'
import { useSessionStore } from '../stores/session'
import TemplateGrid from './TemplateGrid.vue'

const session = useSessionStore()

/** 阈值输入用百分数（0.01 = 0.01%），与现有环比比对一致 */
const thresholdPct = ref(0.01)

/** 配对模式：已点选的源格（null = 非配对模式） */
const pickSource = ref<{ row: number; col: number } | null>(null)
/** 表样范围模式：已武装，等待点选 */
const rangeArmed = ref(false)
/** 表样范围模式：已点选的左上角 */
const rangeStart = ref<{ row: number; col: number } | null>(null)

onMounted(() => void session.reloadAlignConfig())

watch(thresholdPct, (v) => {
  session.templateThreshold = Math.max(0, v) / 100
})

const result = computed(() => session.templateResult)
const pair = computed(() => session.activeTemplatePair)

/** 当前表对两侧的表样键，人工规则按这对键读写 */
const keyL = computed(() => templateKeyOf(pair.value?.left?.fileName ?? ''))
const keyR = computed(() => templateKeyOf(pair.value?.right?.fileName ?? ''))

/** 差异拍平成一张表，带表对索引 */
const diffRows = computed(() => {
  const out: { key: string; tableNo: string; diff: TemplateDiff; pairIndex: number }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const d of p.diffs) {
      out.push({
        key: `${pi}|${d.leftRow},${d.leftCol}|${d.rowPath}|${d.colPath}`,
        tableNo: p.tableNo ?? '—',
        diff: d,
        pairIndex: pi
      })
    }
  })
  return out
})

const onlyRows = computed(() => {
  const out: { key: string; tableNo: string; side: string; path: string }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const e of p.onlyInLeft) {
      out.push({
        key: `${pi}|L|${e.row},${e.col}`,
        tableNo: p.tableNo ?? '—',
        side: '左',
        path: `${e.rowPath} / ${e.colPath}`
      })
    }
    for (const e of p.onlyInRight) {
      out.push({
        key: `${pi}|R|${e.row},${e.col}`,
        tableNo: p.tableNo ?? '—',
        side: '右',
        path: `${e.rowPath} / ${e.colPath}`
      })
    }
  })
  return out
})

const pairOptions = computed(() =>
  (result.value?.pairs ?? []).map((p, i) => ({
    index: i,
    label: `${p.tableNo ?? '?'}：${templateKeyOf(p.leftFile)} ↔ ${templateKeyOf(p.rightFile)}`
  }))
)

/** 解析失败的表提示（两侧任一侧有 error 就显示） */
const pairError = computed(() => pair.value?.left?.error ?? pair.value?.right?.error ?? '')

/** 当前处于哪种点选模式 */
const pickHint = computed(() => {
  if (pickSource.value) return '配对模式：请点击目标单元格'
  if (rangeArmed.value) {
    return rangeStart.value ? '表样范围：请点击右下角单元格' : '表样范围：请点击左上角单元格'
  }
  return ''
})

// —— 未配对的表：手动指定表对 ——

const manualLeftId = ref('')
const manualRightId = ref('')

const unmatchedLeftOptions = computed(() =>
  session.templateLeft.filter((w) => (result.value?.unmatchedLeft ?? []).includes(w.fileName))
)
const unmatchedRightOptions = computed(() =>
  session.templateRight.filter((w) => (result.value?.unmatchedRight ?? []).includes(w.fileName))
)

async function addManualPair(): Promise<void> {
  if (!manualLeftId.value || !manualRightId.value) return
  session.manualTablePairs = [
    ...session.manualTablePairs,
    { leftId: manualLeftId.value, rightId: manualRightId.value }
  ]
  manualLeftId.value = ''
  manualRightId.value = ''
  await session.runTemplateCheck()
}

// —— 选文件 ——

async function openSide(side: 'left' | 'right'): Promise<void> {
  const res = await window.api.openFile({
    kind: 'report',
    title: side === 'left' ? '选择左侧报表（R 系列）' : '选择右侧报表（NR 系列）'
  })
  if (res.canceled || !res.path) return
  try {
    await session.loadTemplateSide(side, res.path)
    ElMessage.success(`已加载：${templateKeyOf(res.path)}`)
    await session.runTemplateCheck()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

/** 差异行选中 → 网格切到左侧并定位（用 current-change 而非 cell-click，键盘也能用） */
function onDiffCurrentChange(row: { diff: TemplateDiff; pairIndex: number } | null): void {
  if (!row) return
  session.focusTemplateCell(row.pairIndex, 'left', row.diff.leftRow, row.diff.leftCol)
}

// —— 人工规则读写 ——

/** 合并写入：同表样对、同源格的旧规则被替换，其余规则原样保留 */
async function saveRules(
  newRules: AlignPairRule[],
  headerKey?: string,
  headerRange?: CellRange
): Promise<void> {
  const base: AlignConfig = session.alignConfig ?? { version: 1, templates: {}, pairs: [] }
  const templates =
    headerKey && headerRange ? { ...base.templates, [headerKey]: { headerRange } } : base.templates
  const keys = new Set(newRules.map((r) => `${r.left}|${r.right}|${r.fromRow}|${r.fromCol}`))
  const kept = base.pairs.filter((p) => !keys.has(`${p.left}|${p.right}|${p.fromRow}|${p.fromCol}`))
  await session.saveAlignConfig({ version: 1, templates, pairs: [...kept, ...newRules] })
}

/** 忽略规则恒以左侧坐标为键 */
async function ignoreDiff(d: TemplateDiff): Promise<void> {
  await saveRules([
    { left: keyL.value, right: keyR.value, fromRow: d.leftRow, fromCol: d.leftCol, ignored: true }
  ])
  ElMessage.success('已忽略，下次核对自动跳过')
}

/** 网格右键「忽略此项」：由当前侧坐标反查差异条目 */
async function ignoreAt(row: number, col: number): Promise<void> {
  const p = pair.value
  if (!p) return
  const isLeft = session.templateSide === 'left'
  const d = p.diffs.find((x) =>
    isLeft ? x.leftRow === row && x.leftCol === col : x.rightRow === row && x.rightCol === col
  )
  if (!d) {
    ElMessage.warning('该单元格不在差异列表中，无需忽略')
    return
  }
  await ignoreDiff(d)
}

async function clearTableRules(): Promise<void> {
  const base: AlignConfig = session.alignConfig ?? { version: 1, templates: {}, pairs: [] }
  try {
    await ElMessageBox.confirm(
      `清除 ${keyL.value} ↔ ${keyR.value} 的全部人工配对与忽略规则？`,
      '确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  await session.saveAlignConfig({
    version: 1,
    templates: base.templates,
    pairs: base.pairs.filter((p) => !(p.left === keyL.value && p.right === keyR.value))
  })
  ElMessage.success('已清除')
}

// —— 网格点选：配对与表样范围两种模式共用同一次 cell-click 上报 ——

function onPickPair(row: number, col: number): void {
  rangeArmed.value = false
  rangeStart.value = null
  pickSource.value = { row, col }
  ElMessage.info('请切换到另一侧，点击要配对的目标单元格')
}

function startRangePick(): void {
  pickSource.value = null
  rangeStart.value = null
  rangeArmed.value = true
  ElMessage.info(`请点击 ${templateKeyOf(session.activeTemplateWorkbook?.fileName ?? '')} 表样区域的左上角单元格`)
}

async function onCellClick(row: number, col: number): Promise<void> {
  if (pickSource.value) {
    await finishPair(row, col)
    return
  }
  if (rangeArmed.value) await finishRange(row, col)
}

async function finishPair(row: number, col: number): Promise<void> {
  const src = pickSource.value
  pickSource.value = null
  if (!src) return
  // 规则恒以左侧坐标为 from：源格在右侧时把方向翻过来
  const rule: AlignPairRule =
    session.templateSide === 'left'
      ? {
          left: keyL.value,
          right: keyR.value,
          fromRow: src.row,
          fromCol: src.col,
          toRow: row,
          toCol: col
        }
      : {
          left: keyR.value,
          right: keyL.value,
          fromRow: row,
          fromCol: col,
          toRow: src.row,
          toCol: src.col
        }
  await saveRules([rule])
  ElMessage.success('已保存配对，下次核对自动生效')
}

async function finishRange(row: number, col: number): Promise<void> {
  if (!rangeStart.value) {
    // 第一次点击：记左上角，继续等右下角
    rangeStart.value = { row, col }
    ElMessage.info('已选左上角，请点击右下角单元格')
    return
  }
  const start = rangeStart.value
  rangeStart.value = null
  rangeArmed.value = false
  const key = templateKeyOf(session.activeTemplateWorkbook?.fileName ?? '')
  if (!key) return
  await saveRules([], key, {
    r1: Math.min(start.row, row),
    c1: Math.min(start.col, col),
    r2: Math.max(start.row, row),
    c2: Math.max(start.col, col)
  })
  ElMessage.success(`已保存 ${key} 的表样范围`)
}
</script>

<template>
  <div class="template-panel">
    <div class="panel-toolbar">
      <el-button size="small" type="primary" plain @click="openSide('left')">
        左侧报表（R 系列）
      </el-button>
      <span class="file-label">{{ templateKeyOf(session.templateLeftPath) || '未选择' }}</span>
      <el-button size="small" type="primary" plain @click="openSide('right')">
        右侧报表（NR 系列）
      </el-button>
      <span class="file-label">{{ templateKeyOf(session.templateRightPath) || '未选择' }}</span>
      <span class="hint">相对差阈值（%）</span>
      <el-input-number
        v-model="thresholdPct"
        :min="0"
        :max="100"
        :step="0.01"
        :precision="4"
        size="small"
      />
      <el-button
        size="small"
        type="primary"
        :loading="session.loading"
        :disabled="!session.templateLeft.length || !session.templateRight.length"
        @click="session.runTemplateCheck()"
      >
        开始核对
      </el-button>
    </div>

    <div v-if="result" class="panel-toolbar">
      <span class="hint">表对</span>
      <el-select v-model="session.templatePairIndex" size="small" class="pair-select">
        <el-option v-for="o in pairOptions" :key="o.index" :label="o.label" :value="o.index" />
      </el-select>
      <el-radio-group v-model="session.templateSide" size="small">
        <el-radio-button value="left">左侧</el-radio-button>
        <el-radio-button value="right">右侧</el-radio-button>
      </el-radio-group>
      <el-button size="small" plain @click="startRangePick">手动指定表样范围</el-button>
      <el-button size="small" plain @click="clearTableRules">清除本表对人工规则</el-button>
      <span v-if="pair?.manualPairs" class="hint">已应用 {{ pair.manualPairs }} 条人工配对</span>
      <span v-if="pickHint" class="pick-hint">{{ pickHint }}</span>
      <span v-if="pairError" class="err-hint">{{ pairError }}</span>
    </div>

    <div v-if="result" class="panel-toolbar">
      <span class="hint">共 {{ result.totalDiffs }} 处差异</span>
      <span class="hint">未配对：</span>
      <el-select v-model="manualLeftId" size="small" class="mini-select" placeholder="左侧文件">
        <el-option v-for="w in unmatchedLeftOptions" :key="w.id" :label="w.fileName" :value="w.id" />
      </el-select>
      <el-select v-model="manualRightId" size="small" class="mini-select" placeholder="右侧文件">
        <el-option v-for="w in unmatchedRightOptions" :key="w.id" :label="w.fileName" :value="w.id" />
      </el-select>
      <el-button size="small" :disabled="!manualLeftId || !manualRightId" @click="addManualPair">
        指定为表对
      </el-button>
    </div>

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
      <el-table-column label="项目路径" prop="diff.rowPath" min-width="220" show-overflow-tooltip />
      <el-table-column label="列" prop="diff.colPath" min-width="140" show-overflow-tooltip />
      <el-table-column label="左值" prop="diff.leftText" width="110" show-overflow-tooltip />
      <el-table-column label="右值" prop="diff.rightText" width="110" show-overflow-tooltip />
      <el-table-column label="相对差" width="100">
        <template #default="{ row }">
          {{ row.diff.relDiff === null ? '—' : (row.diff.relDiff * 100).toFixed(4) + '%' }}
        </template>
      </el-table-column>
      <el-table-column label="类型" width="140">
        <template #default="{ row }">
          <el-tag v-if="row.diff.kind === 'diff'" type="danger" size="small">差额</el-tag>
          <el-tag v-else type="warning" size="small">单侧有值</el-tag>
          <el-tag v-if="row.diff.manual" size="small" class="manual-tag">人工</el-tag>
        </template>
      </el-table-column>
      <el-table-column width="80">
        <template #default="{ row }">
          <el-button link size="small" type="danger" @click.stop="ignoreDiff(row.diff)">忽略</el-button>
        </template>
      </el-table-column>
    </el-table>

    <TemplateGrid
      v-if="result"
      @pick-pair="onPickPair"
      @ignore="ignoreAt"
      @cell-click="onCellClick"
    />

    <el-collapse v-if="result && onlyRows.length" class="only-collapse">
      <el-collapse-item :title="`仅单侧存在（${onlyRows.length} 项）`" name="only">
        <el-table :data="onlyRows" size="small" border max-height="260">
          <el-table-column label="表号" prop="tableNo" width="70" />
          <el-table-column label="侧" prop="side" width="50" />
          <el-table-column label="项目路径 / 列" prop="path" min-width="320" show-overflow-tooltip />
        </el-table>
      </el-collapse-item>
    </el-collapse>

    <el-empty v-if="!result" description="选择两套报表（zip）后点击「开始核对」" />
  </div>
</template>

<style scoped>
.template-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  overflow: auto;
  padding: 4px;
}
.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.file-label,
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pick-hint {
  font-size: 12px;
  color: #d6336c;
  font-weight: 600;
}
.err-hint {
  font-size: 12px;
  color: var(--el-color-danger);
}
.pair-select {
  width: 340px;
}
.mini-select {
  width: 200px;
}
.manual-tag {
  margin-left: 4px;
}
.only-collapse {
  margin-top: 4px;
}
</style>
```

- [ ] **步骤 2：在 `src/renderer/src/App.vue` 加标签页**

1. 在组件 import 中加入：
```ts
import TemplatePanel from './components/TemplatePanel.vue'
```
2. 在「口径文档」标签页之后追加：
```html
          <el-tab-pane label="表样核对" name="template">
            <TemplatePanel />
          </el-tab-pane>
```

- [ ] **步骤 3：类型检查与构建验证**

运行：`npm run typecheck && npm test && npm run build`
预期：无类型错误、测试全绿、构建成功

- [ ] **步骤 4：Commit**

```bash
git add src/renderer/src/components/TemplatePanel.vue src/renderer/src/App.vue
git commit -m "feat(template): 表样核对标签页"
```

---

## 任务 8：真实样例端到端验收与文档

前置任务的单测用的是代码构造的 fixture。本任务用 `samples/similarSample/` 的**真实 xls** 走**生产解析路径**（`parseExcel`）跑一遍，验证真实文件里的合并单元格、空白字符、行偏移与假设一致。

**文件：**
- 创建：`src/main/file/__tests__/template-samples.spec.ts`
- 修改：`CLAUDE.md`

- [ ] **步骤 1：编写端到端测试**

创建 `src/main/file/__tests__/template-samples.spec.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { AlignConfig, WorkbookData } from '@shared/types'
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

  it('真实文件能定位到锚点并提取出行/列路径', () => {
    const t = parseWorkbook(load('R06.xls'))
    expect(t.error).toBeUndefined()
    // 项 目 锚点在 A4:C5，故表头行 3~4、标签列 A~C、数据从 D 列第 6 行起（0 起始）
    expect(t.headerRange).toEqual({ r1: 3, c1: 0, r2: 4, c2: 2 })
    expect(t.dataStartRow).toBe(5)
    expect(t.dataStartCol).toBe(3)
    expect(t.cells.length).toBeGreaterThan(0)
    expect(t.cells.every((c) => c.rowPath !== '')).toBe(true)
  })

  it('R06 ↔ NR06：跨行偏移仍能配对，命中 2 处超阈值差异', () => {
    const res = checkTemplates(parseWorkbook(load('R06.xls')), parseWorkbook(load('NR06.xls')), {
      threshold: T
    })
    expect(res.left?.error).toBeUndefined()
    expect(res.right?.error).toBeUndefined()

    const hit = (rowPath: string, l: string, r: string): boolean =>
      res.diffs.some(
        (d) => d.rowPath === rowPath && d.kind === 'diff' && d.leftText === l && d.rightText === r
      )
    // R06 第 9 行 ↔ NR06 第 10 行：1.2 vs 1（16.7%）
    expect(hit('贴现/商业承兑汇票/3个月（含）以内', '1.2', '1')).toBe(true)
    // R06 第 17 行 ↔ NR06 第 21 行：1.1 vs 1（9.09%）
    expect(hit('转贴现/票据回购/6个月—1年（含）', '1.1', '1')).toBe(true)

    // NR06 有合计行而 R06 没有 → 进「仅单侧存在」，不得混进差异列表
    expect(res.onlyInRight.some((e) => e.rowPath.endsWith('/合计'))).toBe(true)
    expect(res.diffs.some((d) => d.rowPath.endsWith('/合计'))).toBe(false)
  })

  it('R31 ↔ NR31：无人工规则时，丢了父标签的活期组只在右侧存在', () => {
    const res = checkTemplates(parseWorkbook(load('R31.xls')), parseWorkbook(load('NR31.xls')), {
      threshold: T
    })
    expect(res.left?.error).toBeUndefined()
    expect(res.right?.error).toBeUndefined()
    // R31 的 A6:B7 是空合并格，活期组只剩「单位存款」/「个人存款」，配不上 NR31 的「一、活期/…」
    expect(res.onlyInRight.some((e) => e.rowPath === '一、活期/单位存款')).toBe(true)
    expect(res.onlyInLeft.some((e) => e.rowPath === '单位存款')).toBe(true)
  })

  it('R31 ↔ NR31：人工配对（行级）后整行按列路径重比，含阈值下沿', () => {
    const l = parseWorkbook(load('R31.xls'))
    const r = parseWorkbook(load('NR31.xls'))
    // 配一对行即可（第 5 行 ↔ 第 5 行）；三条规则指同一对行，去重后只比对一次
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [3, 12, 13].map((col) => ({
        left: 'R31',
        right: 'NR31',
        fromRow: 5,
        fromCol: col,
        toRow: 5,
        toCol: col
      }))
    }
    const res = checkTemplates(l, r, { threshold: T, config: cfg })

    expect(res.manualPairs).toBe(1)
    // 行级接管：该行 D(1.1 vs 1)、E(2.1 vs 2)、N(19.2001 vs 19) 各出一条，均标 manual
    const manual = res.diffs.filter((d) => d.manual)
    expect(manual).toHaveLength(3)
    expect(manual.some((d) => d.leftText === '1.1' && d.rightText === '1')).toBe(true)
    expect(manual.some((d) => d.leftText === '2.1' && d.rightText === '2')).toBe(true)
    expect(manual.some((d) => d.leftText === '19.2001' && d.rightText === '19')).toBe(true)
    // 阈值下沿：M 列 2.0001 vs 2 = 0.005%，必须不标
    expect(manual.some((d) => d.leftText === '2.0001')).toBe(false)
    // 行级配对接管后，活期组两行都不再残留「仅单侧存在」
    expect(res.onlyInLeft.some((e) => e.rowPath === '单位存款')).toBe(false)
    expect(res.onlyInRight.some((e) => e.rowPath === '一、活期/单位存款')).toBe(false)
  })

  it('忽略规则能压掉指定格', () => {
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [{ left: 'R06', right: 'NR06', fromRow: 8, fromCol: 3, ignored: true }]
    }
    const res = checkTemplates(parseWorkbook(load('R06.xls')), parseWorkbook(load('NR06.xls')), {
      threshold: T,
      config: cfg
    })
    expect(res.diffs.some((d) => d.leftRow === 8 && d.leftCol === 3)).toBe(false)
  })
})
```

**注意**：`R06`/`NR06` 的 `A4:C5`、`R31` 的 `D6` 等坐标来自样例文件的实际结构。若断言失败，先打印 `parseWorkbook(...)` 的结果核对真实坐标，**不要**为了让它通过而改宽断言——断言失败本身就是发现。

- [ ] **步骤 2：运行测试验证通过**

运行：`npx vitest run src/main/file/__tests__/template-samples.spec.ts`
预期：PASS。若 `samples/similarSample/` 下四个 xls 不存在则显示 skipped（不算失败，但要确认文件确实在）。

- [ ] **步骤 3：更新 `CLAUDE.md`**

在「架构」章节的 `src/shared/` 条目中，把 core 列表从：

```
核心在 `core/`（engine.ts 比对引擎、numeric.ts 数值解析、mapping.ts 口径映射、pairing.ts 顺序配对、merge.ts 合并单元格 span 矩阵、summary.ts 概览汇总）
```

改为：

```
核心在 `core/`（engine.ts 环比比对引擎、numeric.ts 数值解析、mapping.ts 口径映射、pairing.ts 顺序配对、merge.ts 合并单元格 span 矩阵、summary.ts 概览汇总、template.ts 表样核对、sheet-view.ts 网格渲染纯函数）
```

在「`src/main/`」条目中，把 `store.ts（会话缓存 + recent.json）` 改为 `store.ts（工作簿会话缓存）、align.ts（表样核对人工规则持久化）`。

在「`src/renderer/src/`」条目中，把 `components/` 列表末尾补上 `TemplatePanel/TemplateGrid`。

在「测试」章节，把「共 70 个用例（68 passed + 2 skipped）」改为 `npm test` 实际输出的数字。

- [ ] **步骤 4：全量验证**

运行：`npm run typecheck && npm test && npm run build`
预期：全部通过

- [ ] **步骤 5：Commit**

```bash
git add src/main/file/__tests__/template-samples.spec.ts CLAUDE.md
git commit -m "test(template): 真实样例端到端验收；补充 CLAUDE.md 模块说明"
```

- [ ] **步骤 6（人类伙伴执行，不派子代理）：GUI 冒烟与人工配对**

运行 `npm run dev`（bash 下先 `unset ELECTRON_RUN_AS_NODE`）：

1. 在「表样核对」页，左/右各选一个 zip（把 `samples/similarSample/` 的 R06+R31、NR06+NR31 分别打包成 `R系列.zip` / `NR系列.zip`），阈值保持 `0.01`，点「开始核对」
2. 表对切到 31，网格切「左侧」，右键 R31 的 `D6` 格 → 「指定配对…」→ 切「右侧」→ 点 NR31 的 `D6` 格（**配一次即可，配对是行级的**）
3. 预期：提示「已保存配对」，头部显示「已应用 1 条人工配对」，差异列表出现该行 `D6`（1.1 vs 1，9.09%）、`E6`（2.1 vs 2，4.76%）、`N6`（19.2001 vs 19，1.04%）三条带「人工」角标的条目，`M6`（2.0001 vs 2，0.005%）**不出现**；「仅单侧存在」里 R31 的「单位存款」行消失
4. 重启应用再核对一次（无需重做配对），人工配对仍然生效 —— 验证 `userData/template-align.json` 持久化
5. 右键某个差异格 → 「忽略此项」→ 该行从列表消失，重启后仍不出现；再点「清除本表对人工规则」→ 恢复

任一步不符预期，把这步骤的结果反馈回来，作为新发现回到修复循环。

---

## 规格覆盖度对照

| 规格章节 | 对应任务 |
|---|---|
| 一、表样解析（锚点/归一化/路径/有值行判据） | 任务 2 |
| 二、配对与比对（配对键、数值化、判据、排序） | 任务 3 |
| 三、人工兜底（headerRange、配对、忽略、应用顺序、存储） | 任务 2（headerRange）、任务 3（规则套用）、任务 5（持久化）、任务 7（交互） |
| 四、文件配对（表号提取、配对规则） | 任务 1（提取）、任务 3（配对）、任务 7（手动指定表对 UI） |
| 五、模块划分与类型定义 | 任务 1、4、5、6、7 |
| 六、界面 | 任务 6、7 |
| 七、测试策略 | 任务 1、2、3、4 的单测；任务 8 的手动验收 |
| 八、已知限制 | 规格中已记录，无需实现 |
