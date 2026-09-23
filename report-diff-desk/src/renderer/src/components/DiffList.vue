<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CellDiff, DiffKind } from '@shared/types'
import { KIND_LABEL } from '@shared/core/engine'
import { useSessionStore } from '../stores/session'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, paginate } from '../utils/pagination'

const props = defineProps<{ pairFilter?: number | null }>()
const emit = defineEmits<{ 'update:pairFilter': [val: number | null] }>()

const session = useSessionStore()
/** null = 全部文件对；由父级（OverviewPanel 联动）外部控制 */
const pairFilter = computed<number | null>({
  get: () => props.pairFilter ?? null,
  set: (val) => emit('update:pairFilter', val)
})

type SortOrder = 'descending' | 'ascending' | null
/** 当前列排序：prop 为空或 order 为 null 表示默认（引擎输出顺序） */
const sortState = ref<{ prop: string; order: SortOrder }>({ prop: '', order: null })

interface DiffRow {
  pairIndex: number
  pairLabel: string
  diff: CellDiff
}

/** 当前显示的文件对列表（真实索引） */
const visiblePairs = computed(() =>
  session.compareResult?.pairs
    .map((p, index) => ({ p, index }))
    .filter(({ index }) => pairFilter.value === null || index === pairFilter.value) ?? []
)

const showFileCol = computed(() => pairFilter.value === null && visiblePairs.value.length > 1)

/** 行排序取值：数字列取数值，其余转字符串；空值排最后 */
function rowValue(row: DiffRow, prop: string): number | string | null {
  const d = row.diff
  switch (prop) {
    case 'pairLabel':
      return row.pairLabel
    case 'sheet':
      return d.sheet
    case 'ref':
      return d.ref
    case 'prevValue':
      return d.prevNum ?? (d.prevValue === null ? null : String(d.prevValue))
    case 'currValue':
      return d.currNum ?? (d.currValue === null ? null : String(d.currValue))
    case 'changeRate':
      return d.changeRate ?? 0
    case 'kind':
      return KIND_LABEL[d.kind as DiffKind]
    default:
      return null
  }
}

function compareRows(a: DiffRow, b: DiffRow, prop: string): number {
  const av = rowValue(a, prop)
  const bv = rowValue(b, prop)
  const aEmpty = av === null || av === ''
  const bEmpty = bv === null || bv === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(av).localeCompare(String(bv), 'zh-CN')
}

const rows = computed<DiffRow[]>(() => {
  const list = visiblePairs.value.flatMap(({ p, index }) =>
    p.compare.diffs.map((diff) => ({ pairIndex: index, pairLabel: p.pairLabel, diff }))
  )
  const { prop, order } = sortState.value
  if (!prop || !order) return list // 默认顺序：按引擎输出（sheet → row → col）
  const dir = order === 'ascending' ? 1 : -1
  return [...list].sort((a, b) => dir * compareRows(a, b, prop))
})

function onSortChange({ prop, order }: { prop: string; order: SortOrder }): void {
  sortState.value = { prop, order }
  page.value = 1 // 换排序后原页码没有意义
}

// —— 分页：先排序再切片（rows 已是排好序的），切完再排只会排到当前页 ——
const page = ref(1)
const pageSize = ref(DEFAULT_PAGE_SIZE)
const paged = computed(() => paginate(rows.value, page.value, pageSize.value))

// 换筛选后条数变化，原页码多半越界
watch(
  () => props.pairFilter,
  () => {
    page.value = 1
  }
)

/** 当前生效的筛选（用于工具栏提示；筛选态下表格会隐藏「文件」列，没有提示会让人以为数据丢了） */
const filterLabel = computed(() => {
  const i = pairFilter.value
  return i === null ? '' : (session.compareResult?.pairs[i]?.pairLabel ?? '')
})

function clearFilter(): void {
  pairFilter.value = null
}

function rateText(d: CellDiff): string {
  if (d.changeRate === null) return '-'
  return `${(d.changeRate * 100).toFixed(1)}%`
}

function rowClass({ row }: { row: DiffRow }): string {
  return `diff-${row.diff.kind}`
}

function valueText(v: CellDiff['prevValue']): string {
  return v === null || v === '' ? '0' : String(v)
}

function onRowClick(row: DiffRow): void {
  session.focusCell(row.pairIndex, row.diff.sheet, row.diff.row, row.diff.col)
}
</script>

<template>
  <div class="diff-list">
    <div class="diff-toolbar">
      <!-- 计数用筛选后的条数，跟分页器的 total 保持一致；用全局总数会和分页器打架 -->
      <span class="diff-count">共 {{ rows.length }} 处变动</span>
      <span v-if="filterLabel" class="diff-filter">
        当前筛选：{{ filterLabel }}
        <el-button link type="primary" size="small" @click="clearFilter">清除</el-button>
      </span>
    </div>
    <!-- 不要给这层 overflow：外层套滚动容器会让 el-table 表体的横向滚动失效 -->
    <div class="detail-table">
      <el-table
        :data="paged.slice"
        size="small"
        height="100%"
        :row-class-name="rowClass"
        :sort-orders="['descending', 'ascending', null]"
        border
        @sort-change="onSortChange"
        @row-click="onRowClick"
      >
        <el-table-column
          v-if="showFileCol"
          prop="pairLabel"
          label="文件"
          width="220"
          show-overflow-tooltip
          sortable="custom"
        />
        <el-table-column prop="sheet" label="工作表" width="130" show-overflow-tooltip sortable="custom">
          <template #default="{ row }">{{ row.diff.sheet }}</template>
        </el-table-column>
        <el-table-column prop="ref" label="坐标" width="80" sortable="custom">
          <template #default="{ row }">{{ row.diff.ref }}</template>
        </el-table-column>
        <el-table-column prop="prevValue" label="上期值" min-width="110" sortable="custom">
          <template #default="{ row }">{{ valueText(row.diff.prevValue) }}</template>
        </el-table-column>
        <el-table-column prop="currValue" label="本期值" min-width="110" sortable="custom">
          <template #default="{ row }">{{ valueText(row.diff.currValue) }}</template>
        </el-table-column>
        <el-table-column prop="changeRate" label="变动率" width="100" align="right" sortable="custom">
          <template #default="{ row }">{{ rateText(row.diff) }}</template>
        </el-table-column>
        <el-table-column prop="kind" label="类型" width="100" sortable="custom">
          <template #default="{ row }">{{ KIND_LABEL[row.diff.kind as DiffKind] }}</template>
        </el-table-column>
      </el-table>
    </div>
    <el-pagination
      class="diff-pager"
      layout="total, sizes, prev, pager, next, jumper"
      :page-sizes="PAGE_SIZE_OPTIONS"
      :current-page="paged.page"
      :page-size="pageSize"
      :total="paged.total"
      @current-change="(p: number) => (page = p)"
      @size-change="(s: number) => { pageSize = s; page = 1 }"
    />
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
  gap: 12px;
  padding: 8px 0;
}
.diff-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.diff-filter {
  font-size: 13px;
  color: var(--el-color-primary);
}
/* min-height:0 必须——否则表格的 auto 最小尺寸会把分页器顶出可视区 */
.detail-table {
  flex: 1;
  min-height: 0;
}
.diff-pager {
  padding-top: 8px;
  justify-content: flex-end;
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
