# 表样核对 v2：规则表范式设计

**日期：** 2026-09-21
**状态：** 待实现
**取代：** `2026-09-20-template-check-design.md` 的第三章「人工兜底」、第四章「文件配对」中的手工指定部分，以及所有基于坐标的人工配对 / 忽略规则

## 背景

v1 的配对方式是「按 `(行路径, 列路径)` 自动配对，配不上的由人工用坐标兜底」。实测暴露两个问题：

1. **坐标兜底不人性化。** 「手动指定表头区」要求用户点中 `项 目` 那个合并格的包围盒——`headerRange` 同时决定数据区起点（`dataStartRow = r2+1`、`dataStartCol = c2+1`），所以范围一放宽数据区就被推到表外，而且**不报错**（实测 `A4:N5` → 无错误但 0 格）。用户框数据区则报「表头区未识别到数据列」。两条路都通不到结果。
2. **配错无从表达。** R31 的活期组整行丢了父级标签（`A6:B7` 是空合并格），R31 解析出 `单位存款`、NR31 解析出 `一、活期/单位存款`，路径天生对不上。v1 靠「网格右键 → 指定配对 → 另一侧点一格」补救，操作晦涩且不可见。

**新范式：规则表。** 把报表的数值清空，得到一张与报表同形的网格，格子里填**规则值**。两侧规则值相同才参与比对，不同则不比对。规则表可保存复用。

## 目标

- 用「规则表」取代 v1 的三个人工机制（手动指定表头区 / 网格右键指定配对 / 忽略此项）
- 自动配对的结果自动填入规则表作为初始值，用户只需修改配不上的那些
- 规则表按表样对持久化，下次遇到同一对报表直接复用

## 范围

**做：**

- 左右各一张与报表同形的可编辑规则表
- 规则值 = 两侧配对键；等值配对，不等值不比对
- 种子自动生成（正常报表用标签路径，解析降级时用行列位置）
- 整行 / 整列批量改规则值
- 规则表按表样对持久化（配置格式升到 v2）
- 「表样核对」模块内分两个子标签页：比对结果 / 对比规则

**不做：**

- 不做旧配置的迁移（v1 文件直接忽略，用户重新维护）
- 不保留任何按坐标的人工配对或忽略规则
- 不改比对判据、不改文件配对（表号提取与表对配对）

---

## 一、规则值

**规则值**是一个自由字符串。判定规则只有一条：

> 左侧某格与右侧某格的规则值**相等**（`trim()` 后逐字相等，区分大小写）→ 这两格参与比对；否则不比对，也不报错。

规则值可以是任意字符串，工具不解析它的内部结构。约定俗成的形态是 `行路径_列路径`（例：`贴现/银行承兑汇票/3个月（含）以内_发生额`），但那是**种子**生成的，不是格式要求。

**空字符串 `""` 表示「不比对」**，是显式的排除手段——v1 的「忽略此项」由它取代。

## 二、种子与降级

规则值不需要用户从零填，工具按解析结果自动生成种子：

| 情况 | 种子值 | 例 |
|---|---|---|
| 锚点词识别成功 | `行路径_列路径` | `贴现/银承/3个月（含）以内_发生额` |
| 锚点识别失败（降级） | `第{行号}行_{列字母}` | `第6行_D` |

行号用 1 起始（与界面一致），列用 Excel 字母。

**锚点词可配（2026-09-21 追加）**：锚点词默认「项目」，界面上是一排可增删的标签（`el-input-tag`）。候选按顺序尝试、每词左上优先；比较前两端都去掉全部空白，所以「项 目」也能命中「项目」。候选存进 `AlignConfig.anchors`（`userData/template-align.json` 的可选字段，旧文件缺席即用默认）。

**每份报表各取自己命中的那个词，互不影响**：一份列表可以同时列出多个报表族的锚点（如 `项目` + `机构类别`），R06 认「项目」、R21 认「机构类别」同时成立；只有「一份报表里同时出现两个候选词」时才由列表顺序决定。解析结果里带 `TemplateSheet.anchor = { row, col, word }`，界面据此显示「锚点命中位置：左侧「项目」(A4)，右侧「机构类别」(C4)」。某个词在这份报表里一个都命中不了时，该侧照常走下面的降级解析。

**锚点必须落在最后一个标签列**：引擎按「锚点列及其左边所有列 = 标签列、锚点右边一列起 = 数据列」推断。R21 的表头行是 `期限(c0-c1) | 机构类别(c2) | 金额(c3) | …`，锚点只能是「机构类别」；选「期限」会把「机构类别」误判成数据列，规则值退化成 `活期_金额` 且同值重复（实测 109 格 / 70 项重复 / 只配上 4 项）。解析结果里带 `TemplateSheet.anchor`（0 起始坐标），界面在出现「规则值重复」时据此提示用户改锚点。

因为两侧同一指标的种子值天然相同，**自动配对的结果就是初始规则表**——等值配对自己还原了路径自动配对，无需第二套逻辑。配不上的（R31 活期组）两侧种子值不同，用户在表里改成一致即可。

**降级解析**：锚点找不到时不再报错中止，而是产出一张 `degraded: true` 的表样——只取每个非空数值格的位置、文本与数值，`seed` 退回位置形式。这使得非标准表头的报表也能用规则表人工维护。这是 v1「手动指定表头区」的替代。

**行判据（v1 的「有值行」判据已废）**：只要**行路径非空且有数据格**，该行就保留——**不要求格里有数值**。v1 要求「至少一个数据格可数值化」，这会让「一侧整行为空、另一侧有值」的行在空的那侧被整行丢弃，两格配不上，本该判据表里的「单侧有值」退化成「未配上」。注释行与表尾行仍被自然排除：它们的数据区被整行合并覆盖（没有数据格），或标签列为空（行路径为空）。

## 三、配对与比对

**配对**：每侧按规则值建 `规则值 → 格子` 索引，两侧取交集。

- 某个规则值在一侧出现**多于一次** → 该值不参与配对，作为「规则值重复」上报，由用户修
- 只在单侧出现的规则值 → 进该侧的「未配上」清单（界面上与差异列表并列展示，供用户对照修改）

**比对判据完全沿用 v1**：设左右数值为 `a`、`b`，阈值 `T`（小数）。

| 情况 | 处理 |
|---|---|
| 两侧均无数值 | 跳过 |
| `max(\|a\|,\|b\|) === 0`（双 0） | 跳过 |
| 一侧有值、另一侧为空 | 记 `kind: 'left-only-value'` / `'right-only-value'`，`relDiff = null` |
| 两侧都有值 | `relDiff = \|a-b\| / max(\|a\|,\|b\|)`；`relDiff > T` 记 `kind: 'diff'` |

严格大于：`relDiff` 恰好等于阈值**不标记**。阈值单位与界面换算与 v1 一致（界面百分数，调用 IPC 前 `/100`，引擎内部 `T = 0.0001`）。

差异按 `规则值` 排序。

## 四、持久化与迁移

`userData/template-align.json` 升到 `version: 2`：

```json
{
  "version": 2,
  "ruleTables": {
    "R31|NR31": {
      "left":  { "5,3": "一、活期/单位存款_(-∞,-30)", "5,4": "" },
      "right": { "5,3": "一、活期/单位存款_(-∞,-30)" }
    }
  }
}
```

- 键是 `左表样键|右表样键`（表样键仍由 `templateKeyOf` 从文件名取）
- 位置键是 `"row,col"`（**0 起始**，与 `SheetData.cells` 一致）
- 存**整张网格**而非增量：加载即还原，不依赖种子可复现
- 空串照存（表示「不比对」），所以「格子缺席」与「格子为空」语义不同——缺席时回退到种子

**迁移策略：不做迁移。** 读到 `version` 不是 2（或解析失败）时按空配置处理，用户重新维护规则表。理由：v1 的规则是坐标配对，与规则值语义没有对应关系，强行转换会产出用户不认识的规则。

## 五、模块划分与类型定义

### `src/shared/types.ts`

```ts
/** 规则表：位置键 "row,col"（0 起始）→ 规则值；空串表示不比对 */
export type RuleTable = Record<string, string>

/** 一对表的规则表 */
export interface RuleTablePair {
  left: RuleTable
  right: RuleTable
}

export interface AlignConfig {
  version: 2
  /** 键：`左表样键|右表样键` */
  ruleTables: Record<string, RuleTablePair>
}

export interface TemplateCellRef {
  row: number
  col: number
  text: string
  num: number | null
  /** 行标签：正常为行路径（`贴现/银承/3个月（含）以内`），降级为 `第6行` */
  rowPath: string
  /** 列标签：正常为列路径（`发生额`），降级为列字母（`D`） */
  colPath: string
  /** 种子规则值 = `${rowPath}_${colPath}` */
  seed: string
}

export interface TemplateSheet {
  key: string
  tableNo: string | null
  fileName: string
  workbookId: string
  sheetName: string
  cells: TemplateCellRef[]
  /** 锚点未识别：seed 已退化为位置形式 */
  degraded: boolean
}

/** 未配上 / 重复的条目：格子 + 其**生效**规则值（规则表覆盖 > 种子），供界面显示要改什么 */
export interface TemplateRuleEntry {
  cell: TemplateCellRef
  rule: string
}

export interface TemplatePairResult {
  tableNo: string | null
  leftFile: string
  rightFile: string
  left: TemplateSheet | null
  right: TemplateSheet | null
  diffs: TemplateDiff[]
  /** 同一个规则值在一侧出现多次 → 不参与配对 */
  duplicateRules: { side: 'left' | 'right'; rule: string; count: number }[]
  /** 规则值只在左侧出现 */
  onlyInLeft: TemplateRuleEntry[]
  /** 规则值只在右侧出现 */
  onlyInRight: TemplateRuleEntry[]
  totalCompared: number
}

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
  relDiff: number | null
  kind: TemplateDiffKind
}

export interface TemplateCheckRequest {
  leftIds: string[]
  rightIds: string[]
  /** 人工指定的表对（表号提不出或冲突时用），仅本次生效；与已删除的 TemplatePairResult.manualPairs 计数无关 */
  manualTablePairs?: TemplateTablePair[]
  /** 当前表样对的规则表；缺席时全部用种子 */
  ruleTables?: Record<string, RuleTablePair>
  threshold: number
}
```

**相对 v1 的类型变化：** 删 `TemplateSheet.headerRange` / `labelEnd` / `dataStartRow` / `dataStartCol` / `manualHeader`、`TemplateDiff.rowPath` / `colPath` / `manual`（移到 `TemplateCellRef` 与 `rule`）、`AlignPairRule`、`TemplateOnlyEntry`、`TemplatePairResult.manualPairs`。

**`CellRange` 保留**：`clampRange` 仍在用它把锚点合并区夹到表内，它只是不再是 `TemplateSheet` / `AlignConfig` 的字段。

### `src/shared/core/template.ts`

| 函数 | 职责 |
|---|---|
| `normLabel` | 不变 |
| `templateKeyOf` / `tableNoOf` | 不变 |
| `findAnchor` / `mergedLabelMatrix` / `joinPath` | 不变（锚点识别仍用于生成种子） |
| `parseTemplateSheet` | 改：锚点找不到时不再返回错误，改为降级产出（`degraded: true`，seed 用位置形式） |
| `parseWorkbook` | 不变（签名与职责） |
| `seedOf(cell)` | 新增：按是否有路径返回种子值 |
| `effectiveRule(ruleTable, cell)` | 新增：`ruleTable[key] ?? cell.seed` |
| `indexByRule(cells, ruleTable)` | 新增：建 `规则值 → 格子[]` 索引 |
| `pairTemplateWorkbooks` | 不变（表号配对与人工指定表对） |
| `checkTemplates` | 改：入参加 `ruleTables`，改为按等值规则配对 |
| `applyRules` | **删除**（坐标人工规则被规则表取代） |

### `src/main/align.ts` / `src/main/ipc.ts` / `src/preload/index.ts` / `src/shared/api.ts`

- `src/main/align.ts`：机制不变（读 / 写 `userData/template-align.json`，ENOENT 返回空配置，其余错误抛出），只换配置形状为 v2
- IPC 三个 channel 名不变，载荷形状随类型更新

### `src/renderer/src/`

- `stores/session.ts`：`alignConfig` 类型随 v2；新增规则表的编辑态（当前表对的左侧表 / 右侧表）、`ruleTableDirty` 标记、`saveRuleTable()` / `reseedRuleTable()`（恢复自动填充）；所有 IPC 载荷继续深拷贝
- `components/TemplatePanel.vue`：内部加 `<el-tabs>`，两个子标签页
- `components/RuleTable.vue`：**新增**，单侧规则表网格（可编辑，支持整行 / 整列批量改）
- `components/TemplateGrid.vue`：保留（差异高亮与定位），删掉右键菜单与 `pick-pair` emit

## 六、界面

「表样核对」标签页内部再分两个子标签页：

### 子标签页一：比对结果（维持 v1 展示内容）

- 工具栏：选左右 zip、阈值、开始核对、表对下拉、左右侧切换
- 差异列表：表号 | 规则值 | 左值 | 右值 | 相对差 | 类型
- 下方单侧网格（`TemplateGrid`）：粉色标差异格、紫色标当前跳转格、点击差异行定位
- 「未配上」（原「仅单侧存在」）与「规则值重复」各一个可折叠区
- **本页不再有任何人工配对 / 忽略入口**

### 子标签页二：对比规则（左/右两侧并排）

左右并排两张 `RuleTable`，每张 = 一个可编辑网格：

- **行**：报表的数据行，行首显示种子生成的 `行路径`（降级时显示 `第N行`）
- **列**：报表的数据列，列首显示 `列路径`（降级时显示列字母）
- **格子**：显示规则值；**点击某格才切换成输入框**（同时只存在一个输入框——1350 个常驻输入框会卡）
- **行首 / 列首各有一个批量入口**：把整行（或整列）的规则值一次设为同一个值
- 顶部按钮：「保存规则」、「恢复自动填充」（丢弃人工修改，按种子重置）
- 未保存时离开或切换表对需提示

配对可视化：两侧规则值相同的格子用同色底纹标记，便于一眼看出哪些已配上、哪些还差。

## 七、要删除的既有代码

| 位置 | 删除内容 |
|---|---|
| `types.ts` | `AlignPairRule`、`TemplateOnlyEntry`、`TemplateSheet.headerRange/labelEnd/dataStartRow/dataStartCol/manualHeader`、`TemplateDiff.rowPath/colPath/manual`、`TemplatePairResult.manualPairs`（`CellRange` **保留**，见上） |
| `core/template.ts` | `applyRules`（**仅删这一个**）。`clampRange` 保留——锚点法仍要用它把合并区夹到表内（`template.ts:140`）；`sortResult` 保留但改为按 `rule` 排序 |
| `core/sheet-view.ts` | `colLetters` 保留（降级种子与列标题要用） |
| `renderer/TemplatePanel.vue` | `pickSource` / `rangeArmed` / `rangeStart` / `startRangePick` / `finishPair` / `finishRange` / `pickHint` / `saveRules` / `ignoreDiff` / `ignoreAt` / `clearTableRules` / `setTemplateHeaderRange`（store）及相关按钮与提示 |
| `stores/session.ts` | `setTemplateHeaderRange`、`templateRangeError` |
| `TemplateGrid.vue` | 右键菜单、`pick-pair` emit |
| `main/align.ts` | 无（只换形状） |

**注意：** 「忽略某个格」的替代做法是把该格一侧的规则值清空——两侧不等，自然不比对。UI 上要给出这个提示，否则用户会找不到原来的「忽略」按钮。

## 八、测试策略

**纯逻辑（`src/shared/core/__tests__/template.spec.ts`，改写）：**

- 种子生成：有路径 → `行路径_列路径`；降级 → `第N行_列字母`
- 等值配对：两侧同值配对成功；不等值各自进 `onlyInLeft` / `onlyInRight`
- 规则值重复：同值在一侧出现两次 → 进 `duplicateRules`，不参与配对
- 空串规则值 → 不比对（两侧都空也不报错）
- 规则表覆盖种子：`ruleTable` 有该位置 → 用规则表的值；缺席 → 用种子
- 判据不变：双 0 跳过、双空跳过、单侧有值归类、阈值严格大于与下沿
- 降级解析：锚点缺失的 sheet 产出 `degraded: true` 且 cells 有位置与数值

**真实样例端到端（`src/main/file/__tests__/template-samples.spec.ts`，改写）：**

- `R06 ↔ NR06`：种子即配对，命中 2 处差异（`贴现/商业承兑汇票/3个月（含）以内_发生额` 1.2 vs 1；`转贴现/票据回购/6个月—1年（含）_发生额` 1.1 vs 1）
- `R31 ↔ NR31`：R31/NR31 的锚点都能识别，种子是路径形式。活期组两行的种子两侧不同（左 `单位存款_*`、右 `一、活期/单位存款_*`）→ 未配上；把左侧那两行的规则值改成与右侧一致 → 命中 3 处（`(-∞,-30)` 1.1 vs 1 = 9.09%、`[-30,-10)` 2.1 vs 2 = 4.76%、`合计` 19.2001 vs 19 = 1.04%），且 `(-∞,-30)` 里的 `2.0001 vs 2`（0.005%）不标
- 规则表持久化到配置后重新加载，结果一致

**store（`src/renderer/src/stores/__tests__/session.template.spec.ts`，扩充）：**

- 规则表写入 / 读取走 IPC 深拷贝（桩内 `structuredClone`）
- 脏标记：编辑后置位，保存后清除
- 切换表对时保留各自表对的规则表草稿

**不为 renderer 组件写单测**（既有约定，node 环境跑不了组件）。

## 九、已知限制

1. **规则值重复无法配对**：同一个规则值在一侧出现多次时该值整体不参与比对，需要用户改成唯一值
2. **降级种子里含行号**：锚点识别失败的报表，种子是 `第N行_列字母`，报表插入/删除行后旧规则会错位，需「恢复自动填充」重新生成
3. **规则表按整体存储**：不做增量，报表行数变化后需要重新「恢复自动填充」；单表数百格规模下配置体积可接受（数十 KB）
4. **不做 v1 配置迁移**：旧规则直接丢弃，用户重新维护
5. 与 v1 相同的限制保留：表样键取自文件名（改名即失效）、单表数十行规模无性能顾虑
