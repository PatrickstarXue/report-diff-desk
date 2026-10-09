# 表头范围由用户框选设计规格

> 日期：2026-10-09
> 状态：已实现（2026-10-09）

## 背景

新旧表比对的解析把「表头块范围」等同于**锚点格（默认认「项目」）的合并范围**（[template.ts](../../../src/shared/core/template.ts)）：

```js
const headerRange = mg ? { r1: mg.r1, c1: mg.c1, r2: mg.r2, c2: mg.c2 } : ...
```

这个等式只在报表把「项目」格向上合并到表头顶行时成立。R01/NR01 的锚点合并格是 `A5:B5`（仅 1 行），而真实表头是 2 行（企业类型行 + 发生额/利率行），于是列标签只剩「发生额/利率」，同一行内多列塌陷成相同规则值 → 全部被判「规则值重复」→ 比对结果为空。

另有真实报表 R21/NR21 的表头标签列是「期限/机构类别」，**不含「项目」**，锚点词直接失效，现在靠降级解析在跑。

结论：靠某个词去**猜**「行头与列头的交接处」这个几何事实不可靠。改为：**交接范围由用户在网格上框选确定**，自动识别仅作预填。

## 目标

1. 用户可在原始工作表网格上**拖选表头块矩形**，明确表头的上边界与交接角格。
2. 自动识别（锚点词 + 表头块上扩）作为**预填**，让绝大多数报表无需手动干预。
3. 手动范围持久化，按**单表样键**复用；已保存的规则表不受影响。

## 概念定义

**表头块**：一块矩形，覆盖「行头列」（标签列）与「表头行」（列标签行）的交集区域。用户拖选的矩形即该块：

```
      labelEnd(角格列)
        │
  top ─ ┌─────────┐
        │ 行头｜列头 │   ← 表头行（列标签）
bottom ─│ 区 ｜交接格│   ← 角格所在行
        └─────────┘
          数据自 bottom+1 行、labelEnd+1 列起
```

- `top`：表头首行
- `bottom`：表头末行（角格所在行）
- `labelEnd`：角格列 = 行头列最右列

行路径固定取 `0..labelEnd` 列（与现状一致，行标签总在最左），故不需要 `left`。

## 数据结构

[types.ts](../../../src/shared/types.ts)：

```ts
/** 表头块范围（0 起始、含端点） */
export interface HeaderRange {
  top: number
  bottom: number
  labelEnd: number
}

export interface AlignConfig {
  version: 2
  ruleTables: Record<string, RuleTablePair>
  anchors?: string[]
  colors?: { diff: string; compared: string }
  /** 表头范围，键 = 单表样键（文件名去扩展名）；缺席的表走自动探测 */
  headerRanges?: Record<string, HeaderRange>
}

export interface TemplateCheckRequest {
  // ...
  headerRanges?: Record<string, HeaderRange>
}
```

`TemplateSheet` 增加解析来源，供界面提示：

```ts
/** 表头范围来源：manual=用户存档 / auto=自动探测 / degraded=降级为位置解析 */
headerSource: 'manual' | 'auto' | 'degraded'
headerRange?: HeaderRange
```

## 解析优先级

[parseTemplateSheet](../../../src/shared/core/template.ts) 新增入参 `headerRange?: HeaderRange`：

1. **有存档 `headerRange`** → 直接采用（完全不看锚点），`headerSource: 'manual'`。
2. **无存档** → 自动探测：
   - 现有锚点词命中 → 取锚点合并范围；
   - **新增上扩**：从锚点合并顶行向上，只要该行在标签列 `0..labelEnd` 内（合并填充后）全为空就继续上扩，遇首个非空行停止。此为 `top`。
   - 成功 → `headerSource: 'auto'`。
3. **自动探测也失败**（无锚点 / 表头区无数据列）→ 维持现状降级为位置解析，`headerSource: 'degraded'`，界面提示可框选表头块。

上扩规则的实测（脚本验证，非回归）：R01/NR01 重复规则值 480/500 → 0；R06/NR06/R07/NR07/R21/R31 行范围与结果不变。R07 不误扩，是因为停止判据用的是**整个标签区**列的原始文本是否为空（R07 标签区含列 0，其第 2 行有「填报单位：…」）。

## 交互

在「新旧表比对」页网格上方新增「表头范围」工具区，作用于**当前显示的那一侧**：

- 显示当前来源：`自动识别` / `已手动设置` / `未识别（降级）`。
- 按钮「设置表头范围」进入框选模式：
  - 网格进入选择态：**左键拖拽改为框选**（暂停原有的左键拖拽平移）。
  - 拖拽过程实时高亮矩形；松手即按该范围**即时预览**解析结果（行头列与表头行分别着色）。
  - 进入模式时若无存档，预填自动探测结果并高亮，用户可直接「应用」或拖动修正。
- 按钮「应用」→ 写入存档（键 = 当前侧表样键）并重新核对。
- 按钮「重置为自动」→ 删除该表样键的存档，回到自动探测。
- 按钮「取消」→ 丢弃本次框选。

## 与规则表的关系

- 规则表按绝对 `行,列` 存档，表头范围变化**不影响**既有存档；生效规则仍为 `存档 ?? 种子`。
- 改范围后重新核对，种子按新范围重新生成。

## 兼容

- `AlignConfig` 维持 `version: 2`，`headerRanges` 为可选新字段（与 `anchors`/`colors` 同策略，读回时显式回填）。
- `anchors` 字段保留，语义降级为「自动探测的来源」。
- 现有 `ruleTables` 不改动、不迁移。

## 实现边界

- [src/shared/types.ts](../../../src/shared/types.ts)：新增 `HeaderRange`；`AlignConfig`/`TemplateCheckRequest` 增 `headerRanges`；`TemplateSheet` 增 `headerSource`/`headerRange`。
- [src/shared/core/template.ts](../../../src/shared/core/template.ts)：`parseTemplateSheet` 接受 `headerRange`；抽出表头范围解析（手动优先 / 自动 + 上扩）；`parseWorkbook` 透传。
- [src/main/ipc.ts](../../../src/main/ipc.ts)：从请求读 `headerRanges`，按单表样键分派给两侧 `parseWorkbook`。
- [src/main/align.ts](../../../src/main/align.ts)：读写 `headerRanges`。
- [src/renderer/src/stores/session.ts](../../../src/renderer/src/stores/session.ts)：`headerRanges` 存取、随请求下发、`setHeaderRange`/`resetHeaderRange`。
- [src/renderer/src/components/TemplateGrid.vue](../../../src/renderer/src/components/TemplateGrid.vue)：选择态下的框选（暂停 dragPan）、矩形高亮、向父组件 emit 范围。
- [src/renderer/src/components/TemplatePanel.vue](../../../src/renderer/src/components/TemplatePanel.vue)：工具区（来源提示 + 设置/应用/重置/取消）。
- 不新增独立视图；复用现有原始工作表网格。

## 验证标准

- R01/NR01：自动探测（上扩）后即产出结果；框选手动范围后同样产出结果。
- R06/R07/R21/R31 及 NR 侧：自动探测结果与改动前一致（不回归）。
- 手动范围优先于自动探测；「重置为自动」后回到自动结果。
- `headerRanges` 落盘后可读回。
- `npm run typecheck`、`npm test`、`npm run build` 通过。
