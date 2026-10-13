# zip 批量比对（顺序配对）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 支持一次上传含多个 Excel 的 zip 压缩包，按压缩包内文件顺序自动配对批量比对。

**架构：** 复用现有 `compareWorkbooks` 单对引擎，新增纯函数 `matchWorkbookPairs` 按数组索引配对产生 `BatchCompareResult`；IPC `compare:run` 改批量入参；UI 全部适配多文件对（文件对筛选、网格按对展示、导出按对分 sheet/分节）。

**技术栈：** 现有 Vue3 + Element Plus + Electron + vitest，无新增依赖。

---

### 任务 1：批量类型与配对引擎（TDD）

**文件：**
- 修改：`src/shared/types.ts`（增加 FilePairResult/BatchCompareResult，CompareRequest 改批量）
- 创建：`src/shared/core/pairing.ts`
- 测试：`src/shared/core/__tests__/pairing.spec.ts`

- [ ] **步骤 1：types.ts 增加批量类型**（CompareRequest 的 baseId/currId 改为数组）

```ts
export interface FilePairResult {
  pairLabel: string
  baseFileName: string
  currFileName: string
  compare: CompareResult
}
export interface BatchCompareResult {
  pairs: FilePairResult[]
  unmatchedBase: string[]
  unmatchedCurr: string[]
  totalDiffs: number
}
export interface CompareRequest {
  baseIds: string[]
  currIds: string[]
  threshold: number
}
```

- [ ] **步骤 2：编写失败测试** `pairing.spec.ts`（构造 WorkbookData 复用 engine.spec 的 makeWorkbook 写法）

```ts
import { describe, it, expect } from 'vitest'
import { matchWorkbookPairs } from '../pairing'

// 两个 1 行 1 列的工作簿构造辅助
function wb(id: string): WorkbookData {
  const cells = [[{ v: 100 }]]
  return {
    id, fileName: id, source: 'file', sheetNames: ['数据'],
    sheets: { 数据: { name: '数据', rowCount: 1, colCount: 1, cells } }
  }
}

describe('matchWorkbookPairs', () => {
  it('按顺序配对 2 vs 2', () => {
    const r = matchWorkbookPairs([wb('A.xlsx'), wb('B.xlsx')], [wb('A2.xlsx'), wb('B2.xlsx')], 0.5)
    expect(r.pairs).toHaveLength(2)
    expect(r.pairs[0].pairLabel).toBe('A.xlsx → A2.xlsx')
    expect(r.pairs[1].pairLabel).toBe('B.xlsx → B2.xlsx')
    expect(r.unmatchedBase).toEqual([])
    expect(r.unmatchedCurr).toEqual([])
  })

  it('数量不等：多出的记入 unmatched', () => {
    const r = matchWorkbookPairs([wb('A.xlsx'), wb('B.xlsx')], [wb('A2.xlsx')], 0.5)
    expect(r.pairs).toHaveLength(1)
    expect(r.unmatchedBase).toEqual(['B.xlsx'])
    expect(r.unmatchedCurr).toEqual([])
  })

  it('空数组不报错', () => {
    const r = matchWorkbookPairs([], [], 0.5)
    expect(r.pairs).toEqual([])
    expect(r.totalDiffs).toBe(0)
  })

  it('单文件 vs 单文件（老场景兼容）且 totalDiffs 汇总', () => {
    const base = wb('上期.xlsx')
    const curr = wb('本期.xlsx')
    curr.sheets['数据'].cells[0][0] = { v: 300 }
    const r = matchWorkbookPairs([base], [curr], 0.5)
    expect(r.pairs).toHaveLength(1)
    expect(r.totalDiffs).toBe(1)
  })
})
```

- [ ] **步骤 3：运行确认失败**

运行：`npx vitest run src/shared/core/__tests__/pairing.spec.ts`
预期：FAIL，`Cannot find module '../pairing'`

- [ ] **步骤 4：实现 pairing.ts**

```ts
import type { BatchCompareResult, WorkbookData } from '@shared/types'
import { compareWorkbooks } from './engine'

/** 按数组顺序（zip 解析顺序）逐位配对，每对复用单对引擎；余量记入 unmatched */
export function matchWorkbookPairs(
  base: WorkbookData[],
  curr: WorkbookData[],
  threshold: number
): BatchCompareResult {
  const n = Math.min(base.length, curr.length)
  const pairs = []
  for (let i = 0; i < n; i++) {
    pairs.push({
      pairLabel: `${base[i].fileName} → ${curr[i].fileName}`,
      baseFileName: base[i].fileName,
      currFileName: curr[i].fileName,
      compare: compareWorkbooks(base[i], curr[i], threshold)
    })
  }
  return {
    pairs,
    unmatchedBase: base.slice(n).map((w) => w.fileName),
    unmatchedCurr: curr.slice(n).map((w) => w.fileName),
    totalDiffs: pairs.reduce((s, p) => s + p.compare.diffs.length, 0)
  }
}
```

- [ ] **步骤 5：运行确认通过 + 全量测试**

运行：`npx vitest run`
预期：全绿（新增 4 用例）

- [ ] **步骤 6：Commit**

```bash
git add src/shared/types.ts src/shared/core/pairing.ts src/shared/core/__tests__/pairing.spec.ts
git commit -m "feat: 批量比对类型与顺序配对引擎"
```

### 任务 2：IPC compare:run 批量化

**文件：**
- 修改：`src/main/ipc.ts`（compareRun handler）

- [ ] **步骤 1：改 handler**

```ts
ipcMain.handle(IPC.compareRun, async (_e, req: CompareRequest): Promise<BatchCompareResult> => {
  if (!Array.isArray(req?.baseIds) || !Array.isArray(req?.currIds)) throw new Error('无效的比对请求')
  const base = req.baseIds.map((id) => getWorkbook(id)).filter((w) => w !== undefined)
  const curr = req.currIds.map((id) => getWorkbook(id)).filter((w) => w !== undefined)
  if (base.length !== req.baseIds.length || curr.length !== req.currIds.length) {
    throw new Error('部分工作簿不存在或已被释放')
  }
  if (base.length === 0 || curr.length === 0) throw new Error('请先选择两份报表')
  return matchWorkbookPairs(base, curr, typeof req.threshold === 'number' ? req.threshold : 0.5)
})
```

同时更新 import：`matchWorkbookPairs` 与 `BatchCompareResult` 类型。

- [ ] **步骤 2：验证**

运行：`npm run typecheck && npx vitest run`
预期：PASS（CompareRequest 变更会暴露所有需适配的调用点，见任务 3-5）

- [ ] **步骤 3：Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: IPC 比对请求支持批量工作簿"
```

### 任务 3：session store 与 FilePanel 适配

**文件：**
- 修改：`src/renderer/src/stores/session.ts`
- 修改：`src/main/ipc.ts`（FILE_FILTERS.report 增加 zip）
- 修改：`src/renderer/src/components/FilePanel.vue`（去掉下拉单选）

- [ ] **步骤 1：FILE_FILTERS.report 增加 zip**

```ts
report: [{ name: 'Excel 报表 / Zip 压缩包', extensions: ['xlsx', 'xls', 'zip'] }],
```

- [ ] **步骤 2：session store 改造**

```ts
// state：baseId/currId 删除；compareResult 类型改 BatchCompareResult | null；新增：
activePairIndex: 0,
// getter：删除 baseWorkbook/currWorkbook，新增：
activePair: (s) => s.compareResult?.pairs[s.activePairIndex] ?? null,
activeBase: (s) => s.baseWorkbooks[s.activePairIndex] ?? null,
activeCurr: (s) => s.currWorkbooks[s.activePairIndex] ?? null,
// runCompare 改：
async runCompare(threshold: number): Promise<void> {
  if (!this.baseWorkbooks.length || !this.currWorkbooks.length) return
  this.loading = true
  try {
    this.compareResult = await window.api.compare({
      baseIds: this.baseWorkbooks.map((w) => w.id),
      currIds: this.currWorkbooks.map((w) => w.id),
      threshold: threshold / 100
    })
    this.activePairIndex = 0
    // recent 记录不变
  } finally { this.loading = false }
}
// focusCell 增加 pairIndex：
focusCell(pairIndex: number, sheet: string, row: number): void {
  this.gridFocus = { pairIndex, sheet, row }
  this.uiTab = 'grid'
}
```

gridFocus 类型 `{ sheet: string; row: number } | null` → `{ pairIndex: number; sheet: string; row: number } | null`。

- [ ] **步骤 3：FilePanel 去下拉**

删除两个 `el-select`（baseWorkbooks.length > 1 时的下拉块）与 `session.baseId/currId` 引用；比对按钮 disabled 条件改 `!session.baseWorkbooks.length || !session.currWorkbooks.length`；加载后提示「已加载 N 个 Excel」：

```ts
ElMessage.success(`已加载 ${res.workbooks.length} 个 Excel`)
```

- [ ] **步骤 4：验证**

运行：`npm run typecheck`
预期：PASS；`npx vitest run` 全绿

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/src/stores/session.ts src/renderer/src/components/FilePanel.vue src/main/ipc.ts
git commit -m "feat: FilePanel 支持 zip 批量加载与自动配对"
```

### 任务 4：DiffList 文件对筛选

**文件：**
- 修改：`src/renderer/src/components/DiffList.vue`

- [ ] **步骤 1：改造脚本与模板**

```ts
// 文件对筛选：null = 全部
const pairFilter = ref<number | null>(null)
// pairOptions computed: [{index, label}]
const pairOptions = computed(() =>
  (session.compareResult?.pairs ?? []).map((p, i) => ({ index: i, label: p.pairLabel }))
)
// 当前显示的 pair 集合（全部或单个）
const visiblePairs = computed(() => {
  const pairs = session.compareResult?.pairs ?? []
  return pairFilter.value === null ? pairs : [pairs[pairFilter.value]].filter(Boolean)
})
const showFileCol = computed(() => pairFilter.value === null && visiblePairs.value.length > 1)
// 汇总 diffs：map 到 {pairIndex, pairLabel, diff}
const rows = computed(() =>
  visiblePairs.value.flatMap((p, vi) => p.compare.diffs.map((d) => ({
    pairLabel: p.pairLabel,
    pairIndex: pairFilter.value ?? vi,  // 注意：全部模式下需要真实索引
    diff: d
  })))
)
```

真实索引处理：用 `pairOfRow` 数组而不是 computed index。实现时以实际代码为准（要点：每行携带 pairIndex + pairLabel + diff 三字段）。

模板：工具栏加「文件对」el-select（placeholder「全部文件」、options 为 pairOptions、v-model pairFilter、clearable）；表格加「文件」列（v-if=showFileCol，prop pairLabel，show-overflow-tooltip）；原有 sheet 筛选不变；行点击 `onRowClick(row)` → `session.focusCell(row.pairIndex, row.diff.sheet, row.diff.row)`；计数文案 `共 {totalDiffs} 处变动`。

- [ ] **步骤 2：验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/renderer/src/components/DiffList.vue
git commit -m "feat: DiffList 按文件对筛选与展示"
```

### 任务 5：SheetGrid 文件对选择

**文件：**
- 修改：`src/renderer/src/components/SheetGrid.vue`

- [ ] **步骤 1：改造数据源与高亮**

```ts
// side 单选保留；新增 pairIndex ref（0）
const pairIndex = ref(0)
// workbook 改按 pair 取：session.baseWorkbooks[pairIndex] / currWorkbooks[pairIndex]
const workbook = computed(() =>
  (side.value === 'base' ? session.baseWorkbooks : session.currWorkbooks)[pairIndex.value] ?? null
)
// hitSet 改为当前 pair 的 diffs
const hitSet = computed(() => {
  const s = new Set<string>()
  const pair = session.compareResult?.pairs[pairIndex.value]
  for (const d of pair?.compare.diffs ?? []) s.add(`${d.sheet}|${d.row}|${d.col}`)
  return s
})
// 工具栏加文件对 el-select（pairs 的 pairLabel，v-model pairIndex）；watch pairIndex 重新 loadSheet
// gridFocus 跳转：watch 里先 pairIndex.value = focus.pairIndex 再切 sheet
```

注意 `watch([side, () => workbook.value?.id], ...)` 已能响应 pairIndex 变化（workbook.id 变），无需加 watch 项；pair 切换时 sheetName 需重置为该 pair 的 sheetNames——在 watch 回调已有 `sheetName.value = sheetOptions.value[0]`。

- [ ] **步骤 2：验证**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/renderer/src/components/SheetGrid.vue
git commit -m "feat: SheetGrid 支持文件对选择与高亮"
```

### 任务 6：导出适配批量结果（TDD）

**文件：**
- 修改：`src/shared/types.ts`（ExportRequest.compare 类型改 BatchCompareResult）
- 修改：`src/main/export/excel.ts`、`src/main/export/html.ts`
- 修改：`src/main/ipc.ts`（exportRun 调用点）
- 测试：`src/main/export/__tests__/export.spec.ts`

- [ ] **步骤 1：更新失败测试**（export.spec 的 fixture 改为 BatchCompareResult 包装：单 pair + 1 个 unmatched；断言改为批量断言）

```ts
function makeBatch(): BatchCompareResult {
  return { pairs: [{ pairLabel: 'A.xlsx → B.xlsx', baseFileName: 'A.xlsx', currFileName: 'B.xlsx', compare: makeResult() }], unmatchedBase: ['多余.xlsx'], unmatchedCurr: [], totalDiffs: 3 }
}
// excel：断言 workbook 含 sheet「A」；再构造双 pair 断言 2 个 sheet
// html：断言含 pairLabel、unmatched 提示、分节标题
```

- [ ] **步骤 2：运行确认失败**（签名不匹配编译错/断言错）

- [ ] **步骤 3：实现 excel.ts 批量**

```ts
function sheetNameOf(fileName: string, used: Set<string>): string {
  // 去扩展名、去 Excel 非法字符 [\\/?*\[\]:]、截 31 字符、重名加序号
}

export async function buildExcelBuffer(batch: BatchCompareResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const used = new Set<string>()
  for (const p of batch.pairs) {
    const ws = wb.addWorksheet(sheetNameOf(p.baseFileName, used))
    // 列同原实现；行数据加一列「文件对」？不——sheet 已按文件对分，行内不必重复
    // 行填充色/百分比格式逻辑与现有循环相同
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
```

- [ ] **步骤 4：实现 html.ts 批量**

```ts
export function buildHtmlReport(batch: BatchCompareResult): string {
  // header 统计：总变动数 = batch.totalDiffs、配对 n 份、unmatched 提示
  // body：每 pair 一节 <h2>pairLabel + 统计</h2> + 现有单结果表格（复用现有分组渲染逻辑，提取内部函数 renderResultTable(compare)）
}
```

- [ ] **步骤 5：exportRun handler 传 batch**（`buildExcelBuffer(req.compare)` 不变，类型已变）

- [ ] **步骤 6：验证**

运行：`npx vitest run src/main/export/__tests__/export.spec.ts && npm run typecheck && npx vitest run`
预期：全绿

- [ ] **步骤 7：Commit**

```bash
git add src/shared/types.ts src/main/export/ src/main/ipc.ts
git commit -m "feat: 导出适配批量比对（Excel 多 sheet / HTML 分节）"
```

### 任务 7：样例 zip 与集成测试

**文件：**
- 修改：`scripts/make-samples.mjs`（生成 上期包.zip / 本期包.zip）
- 修改：`src/shared/core/__tests__/samples.integration.spec.ts`

- [ ] **步骤 1：make-samples 增加 zip 生成**（import JSZip；用现有经营数据 sheet 构造，写入两个文件再打包）

```js
import JSZip from 'jszip'
// NR01/NR02 各含「经营数据」sheet（复用上文构造逻辑的最小版）
const zipBase = new JSZip()
zipBase.file('NR01_月_本外币_境内汇总数据_20260731.xlsx', XLSX.write(base01, { type: 'buffer', bookType: 'xlsx' }))
zipBase.file('NR02_月_本外币_境内汇总数据_20260731.xlsx', XLSX.write(base02, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(join(outDir, '上期包.zip'), await zipBase.generateAsync({ type: 'nodebuffer' }))
// 本期包.zip 同理（NR01_1910_..._20260831 / NR02_1910_..._20260831，NR01 含 >50% 变动、NR02 无变动）
```

- [ ] **步骤 2：集成测试增加 zip 场景**

```ts
it('zip 顺序配对批量比对', async () => {
  const base = await loadReportFile(join(process.cwd(), 'samples', '上期包.zip'))
  const curr = await loadReportFile(join(process.cwd(), 'samples', '本期包.zip'))
  expect(base).toHaveLength(2)
  const r = matchWorkbookPairs(base, curr, 0.5)
  expect(r.pairs).toHaveLength(2)
  expect(r.pairs[0].pairLabel).toContain('NR01')
  expect(r.unmatchedBase).toEqual([])
  // NR01 对含预期变动数（与样例构造一致），NR02 对 0 变动
  expect(r.pairs[0].compare.diffs.length).toBeGreaterThan(0)
  expect(r.pairs[1].compare.diffs).toHaveLength(0)
  expect(r.totalDiffs).toBe(r.pairs[0].compare.diffs.length)
})
```

注意：现有 describe.skipIf 条件改为含 zip 文件存在。

- [ ] **步骤 3：验证**

运行：`npm run make:samples && npx vitest run`
预期：全绿

- [ ] **步骤 4：Commit**

```bash
git add scripts/make-samples.mjs src/shared/core/__tests__/samples.integration.spec.ts
git commit -m "feat: 样例 zip 包与批量比对集成测试"
```

---

## 终验清单

1. `npm run typecheck` PASS
2. `npx vitest run` 全绿（原 51 + 新增约 7）
3. `npm run build` 三端构建成功
4. 手动：`npm run dev`（unset ELECTRON_RUN_AS_NODE）→ 选 samples/上期包.zip 与 本期包.zip → 比对 → 文件对下拉切换 → 网格高亮 → 导出 Excel（多 sheet）/HTML（分节）
