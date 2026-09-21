<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useSessionStore } from '../stores/session'
import { buildMergeSpans } from '@shared/core/merge'
import { colLetters, dataCol, makeSpanMethod } from '@shared/core/sheet-view'
import { useDragPan } from '../utils/dragPan'
import { useGridZoom } from '../utils/zoom'
import ZoomBadge from './ZoomBadge.vue'

const session = useSessionStore()

const gridRef = ref<{
  $el: HTMLElement
  scrollTo: (o: { top: number }) => void
  doLayout: () => void
} | null>(null)
const tableHeight = 420

// Ctrl+滚轮缩放；el-table 高度按档位折算，脚下这块地盘大小保持不变
const {
  pct: zoomPct,
  zoom: zoomScale,
  onWheel: onZoomWheel,
  reset: resetZoom
} = useGridZoom({ onChange: () => nextTick(() => gridRef.value?.doLayout()) })

/** 当前侧的工作表（本项目报表均为单 sheet，取第一个） */
const sheetData = computed(() => {
  const wb = session.activeTemplateWorkbook
  const name = wb?.sheetNames[0]
  return name ? (wb?.sheets[name] ?? null) : null
})

const rowCount = computed(() => sheetData.value?.rowCount ?? 0)
const colCount = computed(() => sheetData.value?.colCount ?? 0)

const spans = computed(() =>
  sheetData.value ? buildMergeSpans(sheetData.value.merges, rowCount.value, colCount.value) : null
)
const spanMethod = makeSpanMethod(() => spans.value)

const rows = computed(() =>
  (sheetData.value?.cells ?? []).map((row, i) => ({ _rowIndex: i, cells: row }))
)

function cellText(rowIdx: number, colIdx: number): string {
  const cell = sheetData.value?.cells[rowIdx]?.[colIdx]
  return cell && cell.v !== null ? String(cell.v) : ''
}

function cellClass({ rowIndex, columnIndex }: { rowIndex: number; columnIndex: number }): string {
  const c = dataCol(columnIndex)
  if (c < 0) return ''
  const classes: string[] = []
  const s = spans.value?.[rowIndex]?.[c]
  if (s && s.rowspan > 0) classes.push('merge-master')
  // 差异跳转聚焦格：紫色标记（优先于命中标记）
  const f = session.templateFocus
  if (f && f.row === rowIndex && f.col === c) classes.push('cell-focused')
  if (session.templateHitSet.has(`${rowIndex},${c}`)) classes.push('diff-hit')
  return classes.join(' ')
}

// —— 左键拖拽平移（Ctrl+左键保留原生文本选择），与 SheetGrid 一致 ——

const { onMouseDown: startPan } = useDragPan(
  () =>
    gridRef.value?.$el.querySelector<HTMLElement>('.el-table__body-wrapper .el-scrollbar__wrap') ??
    null
)

/** 仅表体触发平移：表头留给原生交互 */
function onGridMouseDown(e: MouseEvent): void {
  if (!(e.target as HTMLElement | null)?.closest('.el-table__body-wrapper')) return
  startPan(e)
}

// 差异列表点击跳转：估算滚动到目标行
watch(
  () => session.templateFocus,
  (f) => {
    if (!f) return
    setTimeout(() => gridRef.value?.scrollTo({ top: Math.max(0, f.row - 3) * 40 }), 100)
  }
)
</script>

<template>
  <div class="template-grid" @wheel="onZoomWheel">
    <el-table
      v-if="sheetData"
      ref="gridRef"
      :data="rows"
      size="small"
      border
      :height="Math.round(tableHeight / zoomScale)"
      :style="{ zoom: zoomScale }"
      :cell-class-name="cellClass"
      :span-method="spanMethod"
      @mousedown="onGridMouseDown"
    >
      <el-table-column
        type="index"
        label=""
        width="56"
        align="right"
        fixed="left"
        class-name="row-number-col"
      />
      <el-table-column
        v-for="c in colCount"
        :key="c"
        :prop="'c' + (c - 1)"
        :label="colLetters(colCount)[c - 1]"
        :min-width="120"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ cellText(row._rowIndex, c - 1) }}</template>
      </el-table-column>
    </el-table>
    <ZoomBadge :pct="zoomPct" @reset="resetZoom" />
  </div>
</template>

<style scoped>
.template-grid {
  position: relative;
}
</style>

<style>
.template-grid .el-table .row-number-col {
  background: #f5f7fa;
  color: #909399;
  font-weight: 400;
}
/* 顺序有意：cell-focused 在后，同时命中时紫压粉（与 SheetGrid 一致） */
.template-grid .el-table .diff-hit {
  background: #ffd6e8 !important;
  font-weight: 600;
  color: #d6336c;
}
.template-grid .el-table .cell-focused {
  background: #e6d0f5 !important;
  color: #6d28d9 !important;
  font-weight: 700;
}
.template-grid .el-table .merge-master {
  text-align: center;
  font-weight: 600;
  vertical-align: middle;
}
</style>
