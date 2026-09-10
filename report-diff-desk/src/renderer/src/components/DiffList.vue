<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CellDiff, DiffKind } from '@shared/types'
import { KIND_LABEL } from '@shared/core/engine'
import { useSessionStore } from '../stores/session'

const props = defineProps<{ pairFilter?: number | null }>()
const emit = defineEmits<{ 'update:pairFilter': [val: number | null] }>()

const session = useSessionStore()
const sheetFilter = ref('')
/** null = 全部文件对；由父级（OverviewPanel 联动）外部控制 */
const pairFilter = computed<number | null>({
  get: () => props.pairFilter ?? null,
  set: (val) => emit('update:pairFilter', val)
})

interface DiffRow {
  pairIndex: number
  pairLabel: string
  diff: CellDiff
}

const pairOptions = computed(() =>
  (session.compareResult?.pairs ?? []).map((p, i) => ({ index: i, label: p.pairLabel }))
)

const sheetOptions = computed(() => session.compareResult?.pairs[pairFilter.value ?? 0]?.compare.sheetsMatched ?? [])

/** 当前显示的文件对列表（真实索引） */
const visiblePairs = computed(() =>
  session.compareResult?.pairs
    .map((p, index) => ({ p, index }))
    .filter(({ index }) => pairFilter.value === null || index === pairFilter.value) ?? []
)

const showFileCol = computed(() => pairFilter.value === null && visiblePairs.value.length > 1)

const rows = computed<DiffRow[]>(() =>
  visiblePairs.value.flatMap(({ p, index }) =>
    p.compare.diffs
      .filter((d) => !sheetFilter.value || d.sheet === sheetFilter.value)
      .map((diff) => ({ pairIndex: index, pairLabel: p.pairLabel, diff }))
  )
)

function rateText(d: CellDiff): string {
  if (d.changeRate === null) return '-'
  return `${(d.changeRate * 100).toFixed(1)}%`
}

function rowClass({ row }: { row: DiffRow }): string {
  return `diff-${row.diff.kind}`
}

function valueText(v: CellDiff['prevValue']): string {
  return v === null || v === '' ? '（空）' : String(v)
}

function onRowClick(row: DiffRow): void {
  session.focusCell(row.pairIndex, row.diff.sheet, row.diff.row)
}
</script>

<template>
  <div class="diff-list">
    <div class="diff-toolbar">
      <el-select v-model="pairFilter" size="small" class="pair-select" placeholder="全部文件" clearable>
        <el-option v-for="o in pairOptions" :key="o.index" :label="o.label" :value="o.index" />
      </el-select>
      <el-select v-model="sheetFilter" size="small" class="sheet-select" placeholder="全部工作表" clearable>
        <el-option v-for="s in sheetOptions" :key="s" :label="s" :value="s" />
      </el-select>
      <span class="diff-count">共 {{ session.compareResult?.totalDiffs ?? 0 }} 处变动</span>
    </div>
    <el-table
      :data="rows"
      size="small"
      height="100%"
      :row-class-name="rowClass"
      border
      @row-click="onRowClick"
    >
      <el-table-column v-if="showFileCol" prop="pairLabel" label="文件" width="220" show-overflow-tooltip />
      <el-table-column label="工作表" width="130" show-overflow-tooltip>
        <template #default="{ row }">{{ row.diff.sheet }}</template>
      </el-table-column>
      <el-table-column label="坐标" width="80">
        <template #default="{ row }">{{ row.diff.ref }}</template>
      </el-table-column>
      <el-table-column label="上期值" min-width="110">
        <template #default="{ row }">{{ valueText(row.diff.prevValue) }}</template>
      </el-table-column>
      <el-table-column label="本期值" min-width="110">
        <template #default="{ row }">{{ valueText(row.diff.currValue) }}</template>
      </el-table-column>
      <el-table-column label="变动率" width="100" align="right">
        <template #default="{ row }">{{ rateText(row.diff) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="100">
        <template #default="{ row }">{{ KIND_LABEL[row.diff.kind as DiffKind] }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.diff-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.pair-select {
  width: 280px;
}
.sheet-select {
  width: 200px;
}
.diff-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>

<style>
/* 行着色：红涨绿跌橙新增（中国习惯） */
.diff-list .el-table .diff-increase td {
  background: #fde2e2;
}
.diff-list .el-table .diff-decrease td {
  background: #e1f3d8;
}
.diff-list .el-table .diff-zero-base td,
.diff-list .el-table .diff-new td,
.diff-list .el-table .diff-removed td {
  background: #fdf6ec;
}
</style>
