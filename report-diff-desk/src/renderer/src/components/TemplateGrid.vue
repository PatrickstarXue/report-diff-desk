<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSessionStore } from '../stores/session'
import { buildMergeSpans } from '@shared/core/merge'
import { colLetters, dataCol, makeSpanMethod } from '@shared/core/sheet-view'
import { useDragPan } from '../utils/dragPan'

const session = useSessionStore()

const emit = defineEmits<{
  (e: 'pick-pair', row: number, col: number): void
  (e: 'ignore', row: number, col: number): void
  (e: 'cell-click', row: number, col: number): void
}>()

const gridRef = ref<{
  $el: HTMLElement
  scrollTo: (o: { top: number }) => void
} | null>(null)
const tableHeight = 420

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

/** 点格统一上报给 TemplatePanel，由它决定当前是配对模式、表样范围模式还是普通点击 */
function onCellClick(row: { _rowIndex: number }, column: { property?: string }): void {
  if (dragging.value) return // 拖拽平移结束的这次点击不应当作选格
  const prop = column?.property
  if (typeof prop !== 'string' || !prop.startsWith('c')) return
  const c = Number(prop.slice(1))
  if (Number.isNaN(c)) return
  emit('cell-click', row._rowIndex, c)
}

// —— 右键菜单：指定配对 / 忽略 ——

const ctxMenu = ref<{ row: number; col: number; x: number; y: number } | null>(null)

function closeCtxMenu(): void {
  ctxMenu.value = null
}

function onCellContextMenu(
  row: { _rowIndex: number },
  column: { property?: string },
  _cell: unknown,
  event: MouseEvent
): void {
  const prop = column?.property
  if (typeof prop !== 'string' || !prop.startsWith('c')) return
  const c = Number(prop.slice(1))
  if (Number.isNaN(c)) return
  event.preventDefault()
  ctxMenu.value = { row: row._rowIndex, col: c, x: event.clientX, y: event.clientY }
}

function startPick(): void {
  const m = ctxMenu.value
  closeCtxMenu()
  if (m) emit('pick-pair', m.row, m.col)
}

function ignoreCell(): void {
  const m = ctxMenu.value
  closeCtxMenu()
  if (m) emit('ignore', m.row, m.col)
}

// 全局单击任意位置关闭右键菜单
onMounted(() => document.addEventListener('click', closeCtxMenu))
onUnmounted(() => document.removeEventListener('click', closeCtxMenu))

// —— 左键拖拽平移（Ctrl+左键保留原生文本选择），与 SheetGrid 一致 ——

const { dragging, onMouseDown: startPan } = useDragPan(
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
  <div class="template-grid">
    <el-table
      v-if="sheetData"
      ref="gridRef"
      :data="rows"
      size="small"
      border
      :height="tableHeight"
      :cell-class-name="cellClass"
      :span-method="spanMethod"
      @mousedown="onGridMouseDown"
      @cell-click="onCellClick"
      @cell-contextmenu="onCellContextMenu"
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
    <div
      v-if="ctxMenu"
      class="template-ctx-menu"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
    >
      <div class="ctx-item" @click="startPick">指定配对…</div>
      <div class="ctx-item" @click="ignoreCell">忽略此项</div>
    </div>
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
.template-ctx-menu {
  position: fixed;
  z-index: 3000;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  min-width: 160px;
}
.template-ctx-menu .ctx-item {
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.template-ctx-menu .ctx-item:hover {
  background: #f5f7fa;
  color: #409eff;
}
</style>
