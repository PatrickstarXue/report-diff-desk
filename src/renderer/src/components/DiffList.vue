<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CellDiff, DiffKind } from '@shared/types'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const sheetFilter = ref('')

const KIND_LABEL: Record<DiffKind, string> = {
  increase: '增长',
  decrease: '下降',
  'zero-base': '从零新增',
  new: '新增',
  removed: '移除'
}

const sheetOptions = computed(() => session.compareResult?.sheetsMatched ?? [])

const diffs = computed<CellDiff[]>(() => {
  const all = session.compareResult?.diffs ?? []
  if (!sheetFilter.value) return all
  return all.filter((d) => d.sheet === sheetFilter.value)
})

function rateText(d: CellDiff): string {
  if (d.changeRate === null) return '-'
  return `${(d.changeRate * 100).toFixed(1)}%`
}

function rowClass({ row }: { row: CellDiff }): string {
  return `diff-${row.kind}`
}

function valueText(v: CellDiff['prevValue']): string {
  return v === null || v === '' ? '（空）' : String(v)
}

function onRowClick(row: CellDiff): void {
  session.focusCell(row.sheet, row.row)
}
</script>

<template>
  <div class="diff-list">
    <div class="diff-toolbar">
      <el-select v-model="sheetFilter" size="small" placeholder="全部工作表" clearable>
        <el-option v-for="s in sheetOptions" :key="s" :label="s" :value="s" />
      </el-select>
      <span class="diff-count">共 {{ session.compareResult?.diffs.length ?? 0 }} 处变动</span>
    </div>
    <el-table
      :data="diffs"
      size="small"
      height="100%"
      :row-class-name="rowClass"
      border
      @row-click="onRowClick"
    >
      <el-table-column prop="sheet" label="工作表" width="140" show-overflow-tooltip />
      <el-table-column prop="ref" label="坐标" width="80" />
      <el-table-column label="上期值" min-width="110">
        <template #default="{ row }">{{ valueText(row.prevValue) }}</template>
      </el-table-column>
      <el-table-column label="本期值" min-width="110">
        <template #default="{ row }">{{ valueText(row.currValue) }}</template>
      </el-table-column>
      <el-table-column label="变动率" width="100" align="right">
        <template #default="{ row }">{{ rateText(row) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="100">
        <template #default="{ row }">{{ KIND_LABEL[row.kind as DiffKind] }}</template>
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
