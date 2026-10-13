# 网格高亮首位与默认本期设计规格

> 日期：2026-09-09
> 状态：已获用户确认

## 目标

让用户打开应用后优先看到网格高亮，并默认查看本期报表，减少进入工具后还需要手动切换标签和报表侧别的操作。

## 范围

仅调整 renderer 的初始 UI 状态和显示顺序，不改变比对、网格渲染、跳转、高亮计算、导出或数据结构。

## 需求

1. 顶部标签顺序改为：
   - 网格高亮（`grid`）
   - 比对结果（`result`）
   - 口径查询（`mapping`）
   - 口径文档（`doc`）
2. 应用启动时默认激活网格高亮标签（`uiTab` 初始值为 `grid`）。
3. 网格高亮的报表侧别单选顺序改为：本期、上期。
4. 网格高亮初始化时默认选择本期（`side` 初始值为 `curr`）。
5. 用户主动切换侧别、文件对、工作表，以及 DiffList 点击跳转的现有行为保持不变。

## 实现边界

- [src/renderer/src/App.vue](../../../src/renderer/src/App.vue)：调整 `el-tab-pane` 的顺序。
- [src/renderer/src/stores/session.ts](../../../src/renderer/src/stores/session.ts)：将 `uiTab` 默认值从 `result` 改为 `grid`。
- [src/renderer/src/components/SheetGrid.vue](../../../src/renderer/src/components/SheetGrid.vue)：将 `side` 默认值从 `base` 改为 `curr`，并调整单选按钮顺序。
- 不新增持久化设置；每次应用启动都按上述默认值初始化。

## 验证标准

- 静态检查确认标签顺序、`uiTab` 默认值、`side` 默认值和单选按钮顺序正确。
- 运行现有测试套件，确保核心逻辑无回归。
- 运行 typecheck 和 production build，确保 renderer 编译通过。
