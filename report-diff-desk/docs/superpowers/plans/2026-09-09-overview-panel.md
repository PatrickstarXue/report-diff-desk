# 对比结果概览卡实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在「比对结果」页顶部新增全局指标条 + 每对文件卡片（A 横版大卡），点击联动明细列表与网格高亮。

**架构：** 新增 `src/shared/core/summary.ts` 纯函数计算每对汇总数据；新增 `OverviewPanel.vue` 渲染概览卡；DiffList 的 `pairFilter` 改为外部可控 prop；App.vue 在比对结果页 DiffList 上方放置概览卡并管理 `overviewFilter` 状态。

**技术栈：** Vue 3.5 composition api（ref/computed/emit）、Element Plus（el-button）、vitest（summary 纯函数单测）

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/shared/core/summary.ts` | 新增 | 纯函数：`buildPairSummary`（单对汇总）+ `buildOverview`（全局指标） |
| `src/shared/core/__tests__/summary.spec.ts` | 新增 | 单测：五类计数、0 变动、未参与列表、峰值标签 |
| `src/renderer/src/components/OverviewPanel.vue` | 新增 | 概览面板：全局指标条 + 文件对卡 + emit selectPair |
| `src/renderer/src/components/DiffList.vue` | 修改 | `pairFilter` 从本地 ref 改为外部 prop（`v-model:pair-filter`） |
| `src/renderer/src/App.vue` | 修改 | 比对结果页内放置 OverviewPanel；移除旧 summary 文字；管理 overviewFilter 状态 |

---

### 任务 1：`summary.ts` 纯函数与单测

**文件：**
- 创建：`src/shared/core/summary.ts`
- 创建：`src/shared/core/__tests__/summary.spec.ts`

- [ ] **步骤 1：编写失败的测试（`summary.spec.ts`）**

```ts
import { describe, it, expect } from 'vitest'
import { buildPairSummary, buildOverview } from '../summary'
import type { BatchCompareResult, CompareResult } from '@shared/types'

function makePair(overrides: Partial<CompareResult> = {}): CompareResult {
  return {
    baseId: 'b', currId: 'c', baseLabel: 'base.xlsx', currLabel: 'curr.xlsx',
    threshold: 0.5, sheetsMatched: ['数据', '附注'], sheetsOnlyInBase: [], sheetsOnlyInCurr: [],
    totalCellsCompared: 200, generatedAt: '2026-09-09T00:00:00Z', diffs: [], ...overrides
  }
}

describe('buildPairSummary', () => {
  it('五类计数、匹配数、峰值标签', () => {
    const r = makePair({
      diffs: [
        { sheet: '数据', ref: 'B2', row: 2, col: 2, prevValue: 100, currValue: 200, prevNum: 100, currNum: 200, changeRate: 1, kind: 'increase' },
        { sheet: '数据', ref: 'B3', row: 3, col: 2, prevValue: 100, currValue: 30, prevNum: 100, currNum: 30, changeRate: -0.7, kind: 'decrease' },
        { sheet: '数据', ref: 'B4', row: 4, col: 2, prevValue: 0, currValue: 50, prevNum: 0, currNum: 50, changeRate: 1, kind: 'zero-base' },
        { sheet: '数据', ref: 'C2', row: 2, col: 3, prevValue: null, currValue: 10, prevNum: null, currNum: 10, changeRate: 1, kind: 'new' },
        { sheet: '数据', ref: 'D2', row: 2, col: 4, prevValue: 80, currValue: null, prevNum: 80, currNum: null, changeRate: -1, kind: 'removed' }
      ]
    })
    const s = buildPairSummary(0, r)
    expect(s.totalDiffs).toBe(5)
    expect(s.counts).toEqual({ increase: 1, decrease: 1, 'zero-base': 1, new: 1, removed: 1 })
    expect(s.matchedSheets).toBe(2)
    expect(s.peakChangeLabel).toBe('±70%')
  })

  it('0 变动返回 null 峰值标签、五类全 0', () => {
    const s = buildPairSummary(0, makePair({ diffs: [] }))
    expect(s.totalDiffs).toBe(0)
    expect(s.peakChangeLabel).toBeNull()
    expect(Object.values(s.counts).every((n) => n === 0)).toBe(true)
  })
})

describe('buildOverview', () => {
  const base: BatchCompareResult = {
    pairs: [
      { pairLabel: 'NR01', baseFileName: 'NR01_20260731.xlsx', currFileName: 'NR01_20260831.xlsx', compare: makePair() },
      { pairLabel: 'NR02', baseFileName: 'NR02_20260731.xlsx', currFileName: 'NR02_20260831.xlsx', compare: makePair({ sheetsMatched: [] }) }
    ],
    unmatchedBase: ['NR03_20260731.xlsx'],
    unmatchedCurr: [],
    totalDiffs: 0
  }

  it('全局指标：文件对数、未参与列表、逐对汇总', () => {
    const o = buildOverview(base)
    expect(o.totalPairs).toBe(2)
    expect(o.unmatched).toEqual(['NR03_20260731.xlsx'])
    expect(o.pairSummaries).toHaveLength(2)
    expect(o.pairSummaries[1].matchedSheets).toBe(0)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/shared/core/__tests__/summary.spec.ts`
预期：FAIL，报错 `Cannot resolve '../summary'`

- [ ] **步骤 3：实现 `summary.ts`**

```ts
import type { BatchCompareResult, CompareResult, DiffKind } from '../types'

export interface PairSummary {
  index: number
  baseFileName: string
  currFileName: string
  totalDiffs: number
  counts: Record<DiffKind, number>
  matchedSheets: number
  /** 绝对值最大的变动率，格式如 "±70%"；0 变动时为 null */
  peakChangeLabel: string | null
}

export interface OverviewData {
  totalPairs: number
  totalDiffs: number
  unmatched: string[]
  pairSummaries: PairSummary[]
}

const EMPTY_COUNTS: Record<DiffKind, number> = {
  increase: 0, decrease: 0, 'zero-base': 0, new: 0, removed: 0
}

export function buildPairSummary(index: number, pair: CompareResult): PairSummary {
  const counts: Record<DiffKind, number> = { ...EMPTY_COUNTS }
  let peakAbs = 0
  for (const d of pair.diffs) {
    counts[d.kind]++
    const abs = Math.abs(d.changeRate ?? 0)
    if (abs > peakAbs) peakAbs = abs
  }
  return {
    index,
    baseFileName: pair.baseLabel,
    currFileName: pair.currLabel,
    totalDiffs: pair.diffs.length,
    counts,
    matchedSheets: pair.sheetsMatched.length,
    peakChangeLabel: pair.diffs.length === 0 ? null : `±${(peakAbs * 100).toFixed(0)}%`
  }
}

export function buildOverview(batch: BatchCompareResult): OverviewData {
  return {
    totalPairs: batch.pairs.length,
    totalDiffs: batch.totalDiffs,
    unmatched: [...batch.unmatchedBase],
    pairSummaries: batch.pairs.map((p, i) => buildPairSummary(i, p.compare))
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/shared/core/__tests__/summary.spec.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/shared/core/summary.ts src/shared/core/__tests__/summary.spec.ts
git commit -m "feat: 概览卡汇总纯函数（五类计数/匹配数/峰值标签）"
```

---

### 任务 2：`OverviewPanel.vue` 组件

**文件：**
- 创建：`src/renderer/src/components/OverviewPanel.vue`

- [ ] **步骤 1：创建组件**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { BatchCompareResult, DiffKind } from '@shared/types'
import { buildOverview } from '@shared/core/summary'

const props = defineProps<{
  compareResult: BatchCompareResult
  /** 当前选中的文件对索引（null = 未选中/显示全部） */
  activeIndex: number | null
}>()
const emit = defineEmits<{ select: [index: number | null] }>()

const overview = computed(() => buildOverview(props.compareResult))

const KIND_BAR_COLORS: Record<DiffKind, string> = {
  increase: '#f56c6c',
  decrease: '#67c23a',
  'zero-base': '#e6a23c',
  new: '#b695ce',
  removed: '#c0c4cc'
}

function barSegments(counts: Record<DiffKind, number>): { pct: number; color: string; kind: DiffKind }[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return []
  const kinds: DiffKind[] = ['increase', 'decrease', 'zero-base', 'new', 'removed']
  return kinds
    .map((k) => ({ pct: Math.round((counts[k] / total) * 100), color: KIND_BAR_COLORS[k], kind: k }))
    .filter((s) => s.pct > 0)
}

function truncate(name: string): string {
  return name.length > 40 ? name.slice(0, 37) + '…' : name
}
</script>

<template>
  <div v-if="overview.pairSummaries.length" class="overview-panel">
    <div class="overview-stats">
      <div class="stat-card">
        <div class="stat-num">{{ overview.totalPairs }}</div>
        <div class="stat-label">配对文件</div>
      </div>
      <div class="stat-card stat-diff">
        <div class="stat-num">{{ overview.totalDiffs }}</div>
        <div class="stat-label">变动合计</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ overview.unmatched.length }}</div>
        <div class="stat-label">未参与</div>
      </div>
    </div>
    <div v-if="overview.unmatched.length" class="overview-unmatched">
      未参与文件：{{ overview.unmatched.join('、') }}
    </div>
    <div class="overview-pairs">
      <div
        v-for="ps in overview.pairSummaries"
        :key="ps.index"
        class="pair-card"
        :class="{ 'pair-card--active': activeIndex === ps.index, 'pair-card--empty': ps.totalDiffs === 0 }"
        @click="emit('select', activeIndex === ps.index ? null : ps.index)"
      >
        <div class="pair-name" :title="ps.baseFileName + ' → ' + ps.currFileName">
          {{ truncate(ps.baseFileName) }} → {{ truncate(ps.currFileName) }}
        </div>
        <div class="pair-body">
          <span class="pair-num" :class="{ 'pair-num--zero': ps.totalDiffs === 0 }">
            {{ ps.totalDiffs }}
          </span>
          <span class="pair-unit">{{ ps.totalDiffs === 0 ? '无变动' : '处变动' }}</span>
          <div v-if="ps.totalDiffs > 0" class="pair-bar">
            <div
              v-for="(seg, i) in barSegments(ps.counts)"
              :key="i"
              class="bar-seg"
              :style="{ width: seg.pct + '%', background: seg.color }"
              :title="seg.kind + ' ' + ps.counts[seg.kind]"
            />
          </div>
        </div>
        <div class="pair-footer">
          匹配 {{ ps.matchedSheets }} 工作表
          <template v-if="ps.peakChangeLabel"> · 峰值 {{ ps.peakChangeLabel }}</template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview-panel { padding: 12px 0 4px; }
.overview-stats { display: flex; gap: 10px; margin-bottom: 8px; }
.stat-card {
  flex: 1; background: #f5f7fa; border-radius: 8px; padding: 10px 8px; text-align: center;
}
.stat-num { font-size: 20px; font-weight: 700; }
.stat-diff .stat-num { color: #d6336c; }
.stat-label { font-size: 12px; color: #909399; margin-top: 2px; }
.overview-unmatched {
  font-size: 12px; color: #e6a23c; margin: 4px 0 10px;
  background: #fdf6ec; border-radius: 6px; padding: 6px 10px;
}
.overview-pairs { display: flex; flex-wrap: wrap; gap: 10px; }
.pair-card {
  flex: 1 1 320px; border: 1px solid #dcdfe6; border-radius: 10px;
  padding: 10px 12px; cursor: pointer; transition: border-color .15s;
}
.pair-card:hover { border-color: #a0cfff; }
.pair-card--active { border: 2px solid #409eff; background: #f5f7fa; }
.pair-card--empty { opacity: 0.6; }
.pair-name {
  font-size: 12px; font-weight: 600; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px;
}
.pair-body { display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px; }
.pair-num { font-size: 22px; font-weight: 700; color: #d6336c; }
.pair-num--zero { color: #909399; }
.pair-unit { font-size: 12px; color: #909399; }
.pair-bar {
  flex: 1; display: flex; height: 8px; border-radius: 4px;
  overflow: hidden; margin-left: 8px;
}
.bar-seg { min-width: 2px; }
.pair-footer { font-size: 11px; color: #909399; }
</style>
```

- [ ] **步骤 2：运行 typecheck 确认编译通过**

运行：`npm run typecheck`
预期：PASS（组件新增，无新依赖问题）

- [ ] **步骤 3：Commit**

```bash
git add src/renderer/src/components/OverviewPanel.vue
git commit -m "feat: OverviewPanel 组件（全局指标条 + 横版大卡）"
```

---

### 任务 3：集成联动与 DiffList 改造

**文件：**
- 修改：`src/renderer/src/components/DiffList.vue`
- 修改：`src/renderer/src/App.vue`

- [ ] **步骤 1：DiffList 改造（pairFilter 可外部控制）**

在 `<script setup>` 顶部加：

```ts
const props = defineProps<{ modelValue?: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [val: number | null] }>()
const pairFilter = computed<number | null>({
  get: () => props.modelValue ?? null,
  set: (val) => emit('update:modelValue', val)
})
```

删掉原有的 `const pairFilter = ref<number | null>(null)`。

模板中 el-select 已 `v-model="pairFilter"`，无需改动。

- [ ] **步骤 2：App.vue 集成**

`<script setup>` 新增：

```ts
import { ref } from 'vue'
import OverviewPanel from './components/OverviewPanel.vue'
const overviewFilter = ref<number | null>(null)
```

`<template>` 比对结果 pane 内容改为：

```html
<el-tab-pane label="比对结果" name="result">
  <template v-if="session.compareResult">
    <OverviewPanel
      :compare-result="session.compareResult"
      :active-index="overviewFilter"
      @select="(i) => (overviewFilter = i)"
    />
    <DiffList v-model:pair-filter="overviewFilter" />
  </template>
  <el-empty v-else description="选择上期与本期报表后点击「开始比对」" />
</el-tab-pane>
```

移除 header 中的 summary 文字与对应 computed。

- [ ] **步骤 3：运行全量测试 + typecheck + build**

运行：`npx vitest run && npm run typecheck && npm run build`
预期：全量 PASS，build clean

- [ ] **步骤 4：Commit**

```bash
git add src/renderer/src/components/DiffList.vue src/renderer/src/App.vue
git commit -m "feat: 概览卡与 DiffList 联动（点击卡片筛选/再次点击恢复全部）"
```

---

### 任务 4：终验

- [ ] **运行全量验证**

```bash
npx vitest run && npm run typecheck && npm run build
```

预期：全量 PASS，typecheck clean，build clean

- [ ] **手动验证清单（npm run dev，加载 samples 真实 .xls 包）**

- 比对后「比对结果」页顶部显示：配对 2 / 变动 242 / 未参与 0；两张横版大卡（NR01、NR02），NR01 变动大、构成条颜色可辨；NR02 变动小。
- 点击 NR01 卡片：卡片蓝色描边，明细列表只显示 NR01 变动；点击 NR02 卡同理。
- 再次点击已选卡片：明细恢复全量。
- 网格文件对下拉与卡片选中一致。
- 0 变动卡灰调显示「无变动」。
