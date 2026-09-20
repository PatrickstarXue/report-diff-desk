# 表样核对（跨表样同指标数值比对）设计

**日期：** 2026-09-20
**状态：** 待实现

## 背景

监管报送存在两套并行的报表体系：R 系列（旧）与 NR 系列（新）。两套表**同期同指标**应当一致，例如 R06 与 NR06 的「贴现-银行承兑汇票-3个月（含）以内-发生额」必须相等。

两套表表样相似但不等同：

- sheet 名不同（`NR06` vs `R06`）
- NR 系列有合计行、R 系列没有
- 空行数量不同，导致**后续区块行坐标整体错位**（NR31 的「四、定期整存整取」在 r17 起，R31 在 r13 起）
- NR31 有「五、保证金存款 / 六、定活两便 / 七、结构性存款」，R31 没有
- R31 的「活期」组丢了父级标签（`A6:B7` 是空合并格）

因此**不能按行列坐标硬比对**。设计目标：默认按「行标签路径 + 列标签路径」自动配对，配不上的由人工指定配对并保存复用。

## 目标

加载两侧各一个 zip（内含 R 系列、NR 系列各 19 张表），自动按表号配对，逐表比对同标签路径的单元格数值，把**相对差 > 0.01%** 的项标记出来；提供差异列表与网格定位；误匹配可人工修正并持久化。

## 范围

**做：**

- 两侧各一个 zip，自动提取表号并配对
- 锚点法解析表样 → 行/列标签路径 → 按路径配对 → 比值
- 差异列表 + 单侧网格定位（粉色标差异、紫色标当前跳转格）
- 仅单侧存在的项单独折叠清单
- 人工兜底：指定表样区域（对应原方案 C）、重新指定配对、忽略误报，全部持久化

**不做：**

- 不导出核对结果（后续按需追加）
- 不支持三套以上报表互比
- 不做表头语义智能识别（如模糊匹配「发生额」与「发生金额」），只按文本路径精确匹配
- 不改动现有「环比比对」「口径查询」任何逻辑

## 核心概念

| 概念 | 定义 | 示例 |
|---|---|---|
| 表样键 | zip 条目名去扩展名 | `R06` |
| 表号 | 表样键中「字母+数字」的数字部分，去前导零（提取规则见 4.1） | `6` |
| 行路径 | 该行标签列各段文本拼接 | `转贴现/票据买断/3个月（含）以内` |
| 列路径 | 该列表头行各段文本拼接 | `最高利率/发生额` |
| 配对键 | `(行路径, 列路径)` | — |

## 一、表样解析

### 1.1 锚点定位

扫描单元格，找文本匹配 `/^项\s*目$/` 的格（归一化后），取第一个作为锚点。

- **找到**：锚点格的**合并范围**直接定义表头区与标签列。样例中四个文件的锚点都是 `A4:C5`（0 起始 `r3-r4, c0-c2`），即表头行 = 第 4~5 行、标签列 = A~C 列、数据区从第 6 行 D 列起。
- **无合并**：表头行 = 锚点行，标签列 = 锚点列，数据列从锚点列右侧一列起。
- **找不到**：该表标记 `error = '未找到「项 目」锚点，请手动指定表样范围'`，进入人工兜底流程。

### 1.2 文本归一化

所有标签文本统一 `trim()` + 内部连续空白压缩为单个空格。表头中存在大量排版空格（`存        款        基        准...`、`合  计`），两侧文件排版一致，归一化后即可精确匹配。

### 1.3 路径提取

构造「合并填充矩阵」`M`：对每个合并区域，把主格文本填入范围内所有格；未被合并覆盖的格取自身文本。**仅标签列与表头行使用该矩阵**，数据格一律读原始 `cells`（见 1.4）。

- **行路径** = `M[r][0..labelEnd]` 各段文本，跳过空段，**相邻重复段合并**，`/` 连接
- **列路径** = `M[headerStart..headerEnd][c]` 各段文本，同样处理

**相邻重复段合并是必需的**，两个真实场景：

- `一、活期` 横跨 `A6:B8` 两列合并 → 填充后 A、B 两列都是「一、活期」，不去重会拼成 `一、活期/一、活期/单位存款`
- 表头 `发生额` 纵向合并 `D3:D4` → 不去重会拼成 `发生额/发生额`

数据列范围 = 表头行中列路径非空的列，且位于标签列右侧。

### 1.4 有值行判据

**每侧独立地**筛出「有值行」：行路径非空，且该行在数据列范围内存在原始值（`cells[r][c]` 非 null 且可数值化）。

- **注释行/表尾行被自然排除**：NR06 的注释是 `A24:I24` 横向合并，数据列区全是合并覆盖格、没有原始值
- **两侧都为空的行不产生条目**（本就无差异）

数据列范围内的**合并覆盖格跳过，只取主格值**，避免同一数值重复计数。

后续配对只在两侧的「有值行」之间进行：

- 行路径在两侧都出现 → 逐列比对
- 行路径只在一侧出现 → 该行所有列项记入「仅单侧存在」

**注意区分两个层级**：「行是否存在」决定进比对还是进单侧清单；「某个单元格是否为空」是行配对之后才判断的，见 2.3。

### 1.5 实测结果

用 `samples/similarSample` 四个文件验证，规则零例外：

| 行路径 | NR06 | R06 |
|---|---|---|
| `贴现/银行承兑汇票/3个月（含）以内` | r6 | r6 |
| `转贴现/票据买断/3个月（含）以内` | **r15** | **r12** |

| 行路径 | NR31 | R31 |
|---|---|---|
| `四、定期整存整取/3个月/单位存款` | **r17** | **r13** |
| `一、活期/单位存款` | r6 | 配不上（R31 该行路径只剩 `单位存款`）→ 人工兜底 |

列路径两侧完全一致（NR06/R06 六列；NR31/R31 的 12 个区间列 + 合计 + 加权平均利率）。

## 二、配对与比对

### 2.1 配对

按 `(行路径, 列路径)` 在两侧建索引取交集。

- 两侧都有 → 比数值
- 只有一侧有 → 记入该表的「仅单侧存在」清单（即 1.4 中行路径只在一侧出现，或该列在一侧不是数据列的情形）
- **同一表内配对键重复** → 追加序号 `#2`、`#3` 并标记，避免静默错配

### 2.2 数值化

复用 `src/shared/core/numeric.ts` 的 `toNumeric`：数字原值；字符串 trim、去千分位、`%` 结尾先除 100 再 parseFloat；日期返回 null。

### 2.3 判据

设左右数值为 `a`、`b`，阈值 `T`（小数）。

**阈值单位与现有环比比对保持一致**：界面用 `el-input-number` 输入百分数（默认 `0.01`，`:step="0.01"`，`:min="0"`），调用 IPC 前 `/100`；引擎内部 `T = 0.0001`。

| 情况 | 处理 |
|---|---|
| 两侧均无数值（该单元格都空/非数值） | 跳过 |
| `max(\|a\|,\|b\|) === 0`（双 0） | 跳过 |
| 一侧该格有值、另一侧该格为空 | 记 `kind: 'left-only-value'` / `'right-only-value'`，`relDiff = null` |
| 两侧都有值 | `relDiff = \|a-b\| / max(\|a\|,\|b\|)`；`relDiff > T` 记 `kind: 'diff'` |

严格大于：`relDiff` 恰好等于阈值**不标记**。

**单侧有值单独成类**：指**行在两侧都存在、但某一列在一侧为空**。它不算差额，但通常比差额更值得看（漏报指标），因此在结果中与 `diff` 并列展示，用不同颜色区分。它与「仅单侧存在」的区别是：后者整行/整列在另一侧根本没有。

### 2.4 输出

差异按 `表号 → 行路径 → 列路径` 排序。

## 三、人工兜底

### 3.1 指定表样区域（原方案 C）

- **触发**：锚点未找到，或自动推断的表头行/标签列不正确
- **交互**：工具栏「手动指定表样范围」→ 进入选区模式 → 在网格上依次点击表头区**左上角格**与**右下角格** → 确定
- **效果**：以两点构成的矩形替代锚点推断结果，重跑解析
- **存储**：按表样键保存 `headerRange`

### 3.2 重新指定配对（行级）/ 忽略（格级）

**配对是行级的。** 配不上的成因是**整行**丢了父级标签——R31 的 `A6:B7` 是空合并格，该行路径只剩 `单位存款`，而 NR31 是 `一、活期/单位存款`。逐格配一遍要点几十次，且漏掉没点到的列（漏掉的那列若恰好有差异，就永远查不出来）。所以一次配对建立的是**一对「行」的对应关系**。

- **触发**：某行路径配错或配不上
- **交互**：差异列表或网格右键 → 「指定配对…」进入配对模式，在两侧各点一个格完成；或右键「忽略此项」排除误报
- **效果**：以两次点击各自所在的行建立**行对** `fromRow ↔ toRow`。此后这两行**不再看行路径**，改按**列路径**逐列对齐比对——列路径相同的格才配对，列路径在一侧不存在的格仍留在「仅单侧存在」清单。原自动配对结果中涉及这两行的条目（差异与单侧存在）被清除后重新产出，新条目一律标 `manual: true`。
- **忽略是格级的**：`ignored: true` 的规则只移除该格的结果，不建立行对、不影响其他列。
- **存储**：按「表样对 + 左侧坐标」保存。`fromCol` / `toCol` 仅记录用户点的是哪一格（供展示与去重），**行级对齐以列路径为准，不使用列坐标偏移**。

### 3.3 应用顺序

```
解析（锚点 或 人工 headerRange）
  → 自动配对
  → 套用人工配对（按行覆盖该两行的自动结果）
  → 套用忽略名单（按格移除）
```

人工配对条目在 `kind` 上标记 `manual: true`，界面加「人工」角标。

### 3.4 配置存储

落盘 `userData/template-align.json`：

```json
{
  "version": 1,
  "templates": {
    "R06": { "headerRange": { "r1": 3, "c1": 0, "r2": 4, "c2": 2 } }
  },
  "pairs": [
    { "left": "R06", "right": "NR06", "fromRow": 5, "fromCol": 3, "toRow": 5, "toCol": 3 },
    { "left": "R06", "right": "NR06", "fromRow": 9, "fromCol": 3, "ignored": true }
  ]
}
```

坐标均为 **0 起始**（与 `SheetData.cells` 一致）；仅界面展示时转 1 起始。

套用人工配对时校验 `left`/`right` 表样键与当前表对一致，不一致则忽略该条（换了一套报表后旧规则自然失效，不误套）。

## 四、文件配对

### 4.1 表号提取

zip 条目名取最后一段（`上期包.zip/R06.xls` → `R06.xls`）→ 去扩展名，然后两级匹配：

1. 整段匹配 `^([A-Za-z]+)(\d+)$`（`R06`、`NR06`）
2. 失败则匹配开头 `^([A-Za-z]+)(\d+)`（`R06-人民币贴现利率水平表`）

取捕获的数字去前导零作为表号。两级都失败返回 `null`，交给人工配对。

`NR06.xls` → `6`，`R06.xls` → `6` → 配对。`06.xls`、`附件2：....xls` → `null`。

### 4.2 配对规则

两侧表号相同即自动配对。以下情况状态标「冲突」，由界面的配对栏下拉手动指定：

- 提不出表号
- 同一表号在任一侧出现多个候选
- 两侧数量不等，剩余项无法配对

未配对的项记入 `unmatchedLeft` / `unmatchedRight`。

## 五、模块划分

### 新增（纯逻辑，vitest 直接测）

| 文件 | 职责 |
|---|---|
| `src/shared/core/template.ts` | `parseTemplateSheet({ sheet, fileName, workbookId }, cfg)` 表样解析；`checkTemplates(left, right, opts)` 配对 + 比对；`tableNoOf(fileName)` 表号提取 |
| `src/renderer/src/utils/sheet-view.ts` | 抽取 `colLetters` / `makeSpanMethod` / `dataCol` |

`colLetters` 与 `spanMethod` 目前在 `SheetGrid.vue`、`MappingPanel.vue` 各有一份**完全相同**的副本，新增网格会成为第三份。抽取为纯函数，三处 import。

### 新增（UI）

| 文件 | 职责 |
|---|---|
| `src/renderer/src/components/TemplatePanel.vue` | 表样核对标签页：文件选择、配对栏、差异列表、单侧清单 |
| `src/renderer/src/components/TemplateGrid.vue` | 单侧网格，支持差异高亮、跳转定位、右键人工规则 |

### 改动

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | 追加本节「类型定义」所列类型 |
| `src/shared/ipc.ts` | 追加 `template:check`、`template:align:get`、`template:align:set` channel 常量 |
| `src/main/ipc.ts` | 对应 handler；加载 zip 复用现有 `loadReportFile` 与 `IPC.reportLoad`，不新增解析路径 |
| `src/main/store.ts` | `template-align.json` 读写 |
| `src/renderer/src/stores/session.ts` | 表样核对状态 |
| `src/renderer/src/App.vue` | 追加标签页 |
| `SheetGrid.vue` / `MappingPanel.vue` | 仅删除重复的 `colLetters`/`spanMethod`/`dataCol`，改为 import |

### 数据流

```
TemplatePanel「开始核对」
  → IPC template:check { leftIds, rightIds, threshold }
      main：从 store 取 WorkbookData
          → tableNoOf 提取表号、配对（提不出/冲突的记入 unmatched，由界面手动指定）
          → 读取 AlignConfig，对每对：parseTemplateSheet(left) / parseTemplateSheet(right)
          → checkTemplates(leftSheet, rightSheet, { threshold, rules })
      → 返回 TemplateCheckResult
  → TemplatePanel 渲染差异列表 / 单侧清单 / 网格

人工规则改动（指定表样范围 / 指定配对 / 忽略）
  → IPC template:align:set 写入 userData/template-align.json
  → 重新触发 template:check
```

表号冲突或未配对的表，界面配对栏用左右两个下拉手动指定，结果作为一次性的表对关系传入 `template:check`（不落盘）。

### 类型定义

```ts
export interface CellRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

export interface TemplateCellRef {
  row: number // 0 起始
  col: number
  rowPath: string
  colPath: string
  text: string
  num: number | null
}

export interface TemplateSheet {
  key: string // 表样键，如 "R06"
  tableNo: string | null
  fileName: string
  workbookId: string
  sheetName: string
  headerRange: CellRange
  labelEnd: number
  dataStartRow: number
  dataStartCol: number
  cells: TemplateCellRef[]
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
  relDiff: number | null
  kind: TemplateDiffKind
  manual?: boolean
}

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
}

export interface TemplateCheckResult {
  pairs: TemplatePairResult[]
  unmatchedLeft: string[]
  unmatchedRight: string[]
  threshold: number
  totalDiffs: number
  generatedAt: string
}

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

/** 手动指定的表对关系（提不出表号或冲突时用），仅本次生效，不落盘 */
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

## 六、界面

```
[左侧 zip] [右侧 zip] [阈值 0.01%] [开始核对]
────────────────────────────────────────────
表对配对栏   表号: R06 ↔ NR06  [自动]        ← 冲突/未匹配的在此下拉指定
────────────────────────────────────────────
工具栏       [手动指定表样范围] [清除本表人工规则]    网格: (左)(右)
────────────────────────────────────────────
差异列表     表号 | 项目路径 | 列 | 左值 | 右值 | 相对差 | 类型
             ↑ 点击行 → 网格跳转到对应格并标紫
────────────────────────────────────────────
网格         粉色=差异  紫色=当前跳转格
────────────────────────────────────────────
[▸ 仅单侧存在清单]   折叠，默认收起
```

- 类型列区分 `差额`（红）与 `单侧有值`（橙）
- 人工配对条目带「人工」角标
- 无锚点且无人工范围的表，在差异列表中显示错误行与「手动指定表样范围」快捷入口

## 七、测试策略

单测 `src/shared/core/__tests__/template.spec.ts`，fixture 由 SheetJS 在运行时构造（沿用现有做法，仓库不放二进制）：

**解析**
- 锚点：有合并 / 无合并 / 找不到
- 路径：相邻重复段合并（横跨两列合并、纵向合并）、空白归一化、合并填充
- 数据行判据：注释行（横向合并跨过数据列）被排除
- 数据区合并覆盖格跳过、只取主格值

**配对**
- 跨行偏移正确配对
- 仅单侧存在归类正确
- 同表内配对键重复追加序号

**比对**
- 阈值边界：`relDiff` 恰好等于阈值不标记（用样例中 M6 `2.0001` vs `2`，0.005% 不标记）
- 双 0 跳过、两侧都空跳过
- 单侧有值归类正确
- 负值、千分位、`%` 结尾

**人工规则**
- `headerRange` 覆盖锚点推断
- 人工配对按**行**覆盖自动结果：配对行的两侧「仅单侧存在」按列路径重新对齐，产出的 diff 标 `manual`
- 配对行的列路径在一侧缺失时，该格仍留在「仅单侧存在」
- 忽略名单按**格**移除条目，不影响该行其他列
- 表样键不匹配时规则不套用

**表号提取**
- `NR06.xls` / `R06.xls` → `6`；含路径的 zip 条目名；提不出编号返回 null

**验证命令**：`npm test` + `npm run typecheck` + `npm run build`

**手动验收**：用 `samples/similarSample` 的 4 个文件打成两个 zip（`{R06.xls, R31.xls}` 与 `{NR06.xls, NR31.xls}`），跑核对，断言：

- R06 ↔ NR06：`贴现/商业承兑汇票/3个月（含）以内` 的 `发生额` 标差（1.2 vs 1，16.7%）；`转贴现/票据回购/6个月—1年（含）` 标差（1.1 vs 1，9.09%）
- NR31 ↔ R31：`M6` 的 `（75,+∞）` 列**不标**（2.0001 vs 2，0.005%）；`D6` 的 `(-∞,-30)` 列标差（1.1 vs 1，9.09%）；`N6` 合计标差（19.2001 vs 19，1.04%）
- NR31 ↔ R31 的「活期」组两行（`单位存款` / `个人存款`）路径配不上，需人工配对到 `一、活期/单位存款` 与 `一、活期/个人存款` 后才能比对出上述差异 —— 这正是人工兜底路径的验收点
- 行级配对的额外收获：`E6`（`[-30,-10)` 列）R31 是 `2.1`、NR31 是 `2`，差 4.76% —— 该格不在上面点名之列，只有行级对齐才比得出来（逐格配对若不点这一格就会漏掉）。它是**预期内**的第三条差异，不是回归。

## 八、已知限制

1. 依赖「项 目」锚点，非标准表头的表需人工指定一次范围
2. 表样键取自文件名，同一张表改名后人工规则会失效（重新指定即可）
3. 人工规则按坐标存储，表样结构若变动（插入/删除行列）需要重新指定
4. 表格全部解析在内存中进行，单表 45 行规模下无性能顾虑；若未来出现万行级报表需要重新评估
