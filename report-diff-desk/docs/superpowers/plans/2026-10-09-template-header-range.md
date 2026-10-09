# 表头范围由用户框选实现计划

> 对应 spec：[2026-10-09-template-header-range-design.md](../specs/2026-10-09-template-header-range-design.md)
> 日期：2026-10-09

## 步骤

### 1. shared/types.ts —— 类型
- 新增 `HeaderRange { top; bottom; labelEnd }`。
- `AlignConfig` 增可选 `headerRanges?: Record<string, HeaderRange>`。
- `TemplateCheckRequest` 增可选 `headerRanges?: Record<string, HeaderRange>`。
- `TemplateSheet` 增 `headerSource: 'manual' | 'auto' | 'degraded'` 与可选 `headerRange?: HeaderRange`。

verify：`npm run typecheck`。

### 2. shared/core/template.ts —— 解析
- 抽出 `resolveHeaderRange(sheet, anchors, override)`，返回 `{ range, source }`：
  - `override` 有值 → 直接采用，`manual`。
  - 否则锚点命中 → 取锚点合并范围，再**上扩**：`r` 从 `mg.r1-1` 上溯，标签列 `0..labelEnd`（取自 `mergedLabelMatrix`）整行为空则 `top = r`，遇非空停止；`auto`。
  - 锚点失败 → `null`，走现有降级分支，`degraded`。
- `parseTemplateSheet` 增入参 `headerRange?: HeaderRange`，用它替代锚点分支；`colPaths`/`rowPath`/`dataStartRow` 计算不变，只是 `r1` 来源变更。
- `parseWorkbook` 透传 `headerRange`。
- `TemplateSheet.anchor` 保留（仅 `auto` 时有值）。

verify：`npx vitest run src/shared/core/__tests__/template.spec.ts`。

### 3. shared/core/__tests__/template.spec.ts —— 单测
- 造「锚点只合并 1 行、上一行是同宽空合并 + 数据区有分组标签」的表 → 断言上扩后 `colPath` 两级、seed 唯一。
- 造 R07 式（标签区含列 0 且上方行有文本）→ 断言**不**上扩。
- 传入 `headerRange` 覆盖 → 断言采用手动范围、`headerSource === 'manual'`。
- 无存档且无锚点 → `degraded`。

### 4. main/align.ts —— 持久化
- `loadAlignConfig` 读回 `headerRanges`（逐项校验 `top/bottom/labelEnd` 为非负整数，非法项丢弃）。
- `saveAlignConfig` 原样落盘。

### 5. main/ipc.ts —— 透传
- 从 `req.headerRanges` 取；每侧键 = `templateKeyOf(wb.fileName)`，分派给 `parseWorkbook`。

### 6. renderer/src/stores/session.ts
- `buildAlignConfig` 带上 `headerRanges`。
- `runTemplateCheck` 请求体带 `headerRanges`。
- 新增 `setHeaderRange(range)` / `resetHeaderRange()`：作用于当前侧表样键，写 `alignConfig` → `setAlignConfig` → 重新核对。

### 7. renderer/src/components/TemplateGrid.vue —— 框选
- 新增 prop `selecting: boolean`，emit `select-range(range)`。
- `selecting` 为真时：`onGridMouseDown` 不走 `startPan`；用 `cell-mouse-enter` 记录当前格（各列用 `column.property` 取列号，行用 `row._rowIndex`）；`mousedown` 记起点、`mouseup` 记终点并 emit；过程高亮矩形。
- 矩形高亮：给选区内的 td 加类（新增 `.header-pick`），与既有 compared/diff 类并列。

### 8. renderer/src/components/TemplatePanel.vue —— 工具区
- 网格上方加「表头范围」条：来源徽标（自动识别/已手动设置/未识别·降级）+ 按钮「设置表头范围 / 应用 / 重置为自动 / 取消」。
- 进入模式预填：有存档用存档，否则用当前解析出的 `headerRange`。
- 应用/重置调用 session 动作并提示；取消退出模式。

### 9. 验证
- `npm test`、`npm run typecheck`、`npm run build`。
- 手动：`samples/r01/` 两文件核对 → NR01 出结果；R31 等不回归。
- 回归用例：`src/main/file/__tests__/template-samples.spec.ts` 增一条用 `samples/r01/` 的用例（样例缺失则跳过），断言 NR01 表对 `totalCompared > 0`。

## 不做

- 不删除 `anchors` 机制（降级为自动预填来源）。
- 不改规则表的键与语义。
- 不新增独立视图。
