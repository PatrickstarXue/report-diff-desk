# 网格高亮首位与默认本期实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让应用启动时默认显示网格高亮，并让网格默认显示本期报表。

**架构：** 只修改 renderer 的标签声明和两个本地 UI 状态默认值，不改变共享类型、IPC、比对引擎或持久化数据。标签顺序由 `App.vue` 的 `el-tab-pane` 声明顺序决定，网格侧别由 `SheetGrid.vue` 的本地 `side` ref 决定，应用初始标签由 Pinia session store 的 `uiTab` 状态决定。

**技术栈：** Vue 3.5、Element Plus、Pinia 4、TypeScript、Vitest、vue-tsc、electron-vite。

---

## 文件清单与职责

- 修改：`src/renderer/src/App.vue` — 调整顶部标签的声明顺序，使网格高亮位于首位。
- 修改：`src/renderer/src/stores/session.ts` — 将应用启动时的 `uiTab` 默认值设为 `grid`。
- 修改：`src/renderer/src/components/SheetGrid.vue` — 将网格侧别默认值设为 `curr`，并将单选按钮显示顺序改为本期、上期。
- 验证：现有 `src/**/__tests__/**/*.spec.ts` 测试、typecheck、production build；项目目前没有 renderer 组件测试基础设施，因此不新增测试框架或组件挂载依赖。

### 任务 1：调整 renderer 默认 UI 状态和显示顺序

**文件：**
- 修改：`src/renderer/src/App.vue:75-87`
- 修改：`src/renderer/src/stores/session.ts:40`
- 修改：`src/renderer/src/components/SheetGrid.vue:10,151-154`

- [ ] **步骤 1：修改标签顺序**

在 `App.vue` 的 `<el-tabs>` 内，将两个现有 pane 的顺序从“比对结果、网格高亮”改为“网格高亮、比对结果”；`mapping` 和 `doc` 保持原顺序与内容不变：

```vue
<el-tab-pane label="网格高亮" name="grid">
  <SheetGrid />
</el-tab-pane>
<el-tab-pane label="比对结果" name="result">
  <DiffList v-if="session.compareResult" />
  <el-empty v-else description="选择上期与本期报表后点击「开始比对」" />
</el-tab-pane>
```

- [ ] **步骤 2：修改应用默认标签**

在 session store 初始 state 中仅将：

```ts
uiTab: 'result'
```

改为：

```ts
uiTab: 'grid'
```

不要改变 `selectCell`、`focusCell` 或任何 action，因为它们已经分别负责切换到 `mapping` 和 `grid`。

- [ ] **步骤 3：修改网格默认侧别和按钮顺序**

在 `SheetGrid.vue` 中将：

```ts
const side = ref<'base' | 'curr'>('base')
```

改为：

```ts
const side = ref<'base' | 'curr'>('curr')
```

并将 toolbar 内两个现有单选按钮排列为：

```vue
<el-radio-button value="curr">本期</el-radio-button>
<el-radio-button value="base">上期</el-radio-button>
```

保留 `workbook` computed 对 `side` 的现有映射，因此默认本期会加载 `session.currWorkbooks`，用户手动切换后仍能查看上期。

- [ ] **步骤 4：运行现有测试**

运行：

```bash
npm test
```

预期：退出码为 `0`；现有测试全部通过，缺失 samples 的集成测试仍按项目当前状态跳过，不因本次 UI 改动新增失败。

- [ ] **步骤 5：运行类型检查**

运行：

```bash
npm run typecheck
```

预期：node 与 web 两个 `vue-tsc --noEmit` 检查均通过，退出码为 `0`。

- [ ] **步骤 6：运行 production build**

运行：

```bash
npm run build
```

预期：electron-vite 的 main、preload、renderer 三部分均构建成功，退出码为 `0`。

- [ ] **步骤 7：检查变更范围**

运行：

```bash
git diff --check
git diff -- src/renderer/src/App.vue src/renderer/src/stores/session.ts src/renderer/src/components/SheetGrid.vue
```

预期：没有空白错误；diff 只包含标签顺序、`uiTab` 默认值、`side` 默认值和单选按钮顺序这四类变更，不包含无关重构。

- [ ] **步骤 8：Commit**

确认验证通过后运行：

```bash
git add src/renderer/src/App.vue src/renderer/src/stores/session.ts src/renderer/src/components/SheetGrid.vue
git commit -m "feat: 默认显示本期网格高亮"
```

提交不包含设计规格或计划文件以外的其他文件；如果当前工作区已有用户改动，先按路径核对后再提交，避免带入无关变更。
