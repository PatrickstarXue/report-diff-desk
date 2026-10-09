<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useSessionStore } from '../stores/session'
import { buildMergeSpans } from '@shared/core/merge'
import { colLetters, dataCol, makeSpanMethod } from '@shared/core/sheet-view'
import { useDragPan } from '../utils/dragPan'
import { useGridZoom } from '../utils/zoom'
import { readableTextOn } from '../utils/templateColors'
import type { HeaderRange } from '@shared/types'
import ZoomBadge from './ZoomBadge.vue'

const props = withDefaults(
  defineProps<{
    /** 表头范围框选模式：左键拖拽改为框选（暂停平移） */
    selecting?: boolean
    /** 进入框选时的预填范围（无存档时由父组件传自动探测结果） */
    prefill?: HeaderRange | null
  }>(),
  { selecting: false, prefill: null }
)
const emit = defineEmits<{ 'select-range': [range: HeaderRange] }>()

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

// 选区（框选模式下的表头块）。labelEnd 取拖拽两列的较大者——行头列固定从第 0 列起
const sel = ref<HeaderRange | null>(null)
let dragFrom: { row: number; col: number } | null = null

watch(
  () => props.selecting,
  (on) => {
    sel.value = on && props.prefill ? { ...props.prefill } : null
    dragFrom = null
  },
  { immediate: true }
)

// 让 rows 依赖 sel：cell-class-name 在 el-table 自身渲染中调用，不会因本组件 ref 变化重跑，
// 故靠 rows 身份变化触发表格重绘（报表只有几十行，代价可接受）
const rows = computed(() => {
  void sel.value
  return (sheetData.value?.cells ?? []).map((row, i) => ({ _rowIndex: i, cells: row }))
})

const hover = ref<{ row: number; col: number } | null>(null)

/** el-table 的列属性 `"c3"` → 数据列号 3；序号列无 property 返回 -1 */
function colIndexOf(column: { property?: string }): number {
  const m = /^c(\d+)$/.exec(column.property ?? '')
  return m ? Number(m[1]) : -1
}

function applySel(a: { row: number; col: number }, b: { row: number; col: number }): void {
  sel.value = {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    labelEnd: Math.max(a.col, b.col)
  }
}

function onCellEnter(row: { _rowIndex: number }, column: { property?: string }): void {
  const col = colIndexOf(column)
  if (col < 0) return
  hover.value = { row: row._rowIndex, col }
  if (dragFrom) applySel(dragFrom, hover.value)
}

function onDocMouseUp(): void {
  if (dragFrom && sel.value) emit('select-range', { ...sel.value })
  dragFrom = null
  document.removeEventListener('mouseup', onDocMouseUp)
}

onBeforeUnmount(() => document.removeEventListener('mouseup', onDocMouseUp))

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
  const pos = `${rowIndex},${c}`
  // 框选模式下先铺表头块底色，再叠比对标记
  const s2 = sel.value
  if (s2 && rowIndex >= s2.top && rowIndex <= s2.bottom && c <= s2.labelEnd) {
    classes.push('header-pick')
  }
  // 参与比对是底色，被后两类标记叠在上面
  if (session.templateComparedSet.has(pos)) classes.push('compared')
  // 差异跳转聚焦格：紫色标记（优先于命中标记）
  const f = session.templateFocus
  if (f && f.row === rowIndex && f.col === c) classes.push('cell-focused')
  if (session.templateHitSet.has(pos)) classes.push('diff-hit')
  return classes.join(' ')
}

/** 标记配色交给用户，以 CSS 变量下发；文字色按背景明度自动取可读色 */
const markerVars = computed(() => {
  const { diff, compared } = session.templateColors
  return {
    '--tpl-diff-bg': diff,
    '--tpl-diff-fg': readableTextOn(diff),
    '--tpl-cmp-bg': compared,
    '--tpl-cmp-fg': readableTextOn(compared)
  }
})

// —— 左键拖拽平移（Ctrl+左键保留原生文本选择），与 SheetGrid 一致 ——

const { onMouseDown: startPan } = useDragPan(
  () =>
    gridRef.value?.$el.querySelector<HTMLElement>('.el-table__body-wrapper .el-scrollbar__wrap') ??
    null
)

/** 仅表体触发平移：表头留给原生交互 */
function onGridMouseDown(e: MouseEvent): void {
  if (!(e.target as HTMLElement | null)?.closest('.el-table__body-wrapper')) return
  if (props.selecting) {
    // 框选模式：左键改为框选起点，暂停平移
    if (!hover.value) return
    e.preventDefault()
    dragFrom = { ...hover.value }
    applySel(dragFrom, hover.value)
    document.addEventListener('mouseup', onDocMouseUp)
    return
  }
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
  <div
    class="template-grid"
    :class="{ selecting }"
    :style="markerVars"
    @wheel="onZoomWheel"
  >
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
      @cell-mouse-enter="onCellEnter"
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
.template-grid.selecting .el-table__body-wrapper {
  cursor: crosshair;
}
</style>

<style>
.template-grid .el-table .row-number-col {
  background: #f5f7fa;
  color: #909399;
  font-weight: 400;
}
/* 顺序有意：表头框选底色最前，其余比对标记叠在其上。
   !important 不能省：el-table 的 hover 行规则特异性高于这几条。 */
.template-grid .el-table .header-pick {
  background: #ede9fe !important;
}
.template-grid .el-table .compared {
  background: var(--tpl-cmp-bg, #fff3cd) !important;
  color: var(--tpl-cmp-fg, #1f2937);
}
.template-grid .el-table .diff-hit {
  background: var(--tpl-diff-bg, #ffd6e8) !important;
  font-weight: 600;
  color: var(--tpl-diff-fg, #1f2937);
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
