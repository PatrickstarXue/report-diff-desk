<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { GridCell } from '@shared/types'
import { buildMergeSpans } from '@shared/core/merge'
import { colLetters, dataCol, makeSpanMethod } from '@shared/core/sheet-view'
import { useSessionStore } from '../stores/session'
import { useDragPan } from '../utils/dragPan'
import { useGridZoom } from '../utils/zoom'
import ResizeBar from './ResizeBar.vue'
import ZoomBadge from './ZoomBadge.vue'

const session = useSessionStore()
/**
 * 整体浏览区：el-table 固定高度，横竖滚动都由表体内部的 el-scrollbar 承担。
 * 外层 div 横向不可能溢出（el-table 是 width:100% + overflow:hidden），
 * 拿它当滚动容器会让横向彻底滚不动，横向滚动条也会被顶到整张表的最底部。
 */
const gridRef = ref<{ $el: HTMLElement; doLayout: () => void } | null>(null)

// —— 左键拖拽平移（Ctrl+左键保留原生文本选择） ——
const { dragging, onMouseDown: startPan } = useDragPan(
  () =>
    gridRef.value?.$el.querySelector<HTMLElement>('.el-table__body-wrapper .el-scrollbar__wrap') ??
    null
)

/** 仅表体触发平移：表头留给列宽拖拽等原生交互 */
function onGridMouseDown(e: MouseEvent): void {
  if (!(e.target as HTMLElement | null)?.closest('.el-table__body-wrapper')) return
  startPan(e)
}

// Ctrl+滚轮缩放。表高按档位折算，表格外框尺寸不变，只有内容放大
const {
  pct: zoomPct,
  zoom: zoomScale,
  onWheel: onZoomWheel,
  reset: resetZoom
} = useGridZoom({ onChange: () => nextTick(() => gridRef.value?.doLayout()) })

const overviewHeight = ref(Math.floor(window.innerHeight * 0.5))
let resizeStartH = Math.floor(window.innerHeight * 0.5)

function onOverviewResizeStart(): void {
  resizeStartH = overviewHeight.value
}
function onOverviewResize(deltaY: number): void {
  overviewHeight.value = Math.max(120, resizeStartH + deltaY)
  nextTick(() => gridRef.value?.doLayout())
}

/** 本次选中是否由页内点击产生：是的话格子本就在眼前，不该再动滚动条 */
let pickedLocally = false

/**
 * 跳转定位：直接让选中格滚进视野。
 * 不用 el-table 的 scrollTo / 自己算行偏移——切标签页时表格刚从隐藏变可见，
 * 滚动容器的高度还没重新量过，按坐标算出来的落点不可靠。
 */
function revealSelectedCell(): void {
  gridRef.value?.$el
    .querySelector<HTMLElement>('td.doc-cell-selected')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

// 从报表环比页跳转命中规则文档后：滚动整体区到目标行，突出显示选中格
watch(
  () => session.selectedDocCell,
  (sel) => {
    if (!sel) return
    if (pickedLocally) {
      pickedLocally = false
      return
    }
    setTimeout(() => {
      // 切标签页时表格刚从隐藏变可见，表体高度可能还没重新量过，先强制重排
      gridRef.value?.doLayout()
      revealSelectedCell()
    }, 100)
  }
)

// —— 口径资料（整体 / 局部） ——

/** 文档库中的报表类文档（xlsx/xls） */
const reportDocs = computed<{ index: number; doc: (typeof session.docList)[number] }[]>(() =>
  session.docList
    .map((doc, index) => ({ index, doc }))
    .filter(({ doc }) => doc.kind === 'xlsx' || doc.kind === 'xls')
)

const activeReportIndex = computed<number | null>(() => {
  const active = session.activeDocIndex
  return reportDocs.value.find((r) => r.index === active)?.index ?? null
})

const activeSheet = computed(() => {
  if (activeReportIndex.value === null) return null
  const doc = session.docList[activeReportIndex.value]
  if (!doc?.workbooks) return null
  return doc.workbooks.find((s) => s.name === session.activeDocSheet) ?? doc.workbooks[0] ?? null
})

/** 整体区表格：全量行（不再限制条数） */
const gridRows = computed(() => {
  const s = activeSheet.value
  if (!s) return []
  return s.cells.map((row, i) => ({ _row: i + 1, cells: row }))
})

const gridColCount = computed(() => activeSheet.value?.colCount ?? 0)

/** 合并区域 span 矩阵（数据列索引，与 cells 对齐） */
const spans = computed(() => {
  const s = activeSheet.value
  return s ? buildMergeSpans(s.merges, s.rowCount, s.colCount) : null
})

/** el-table span-method：主格展开，被覆盖格隐藏；行号列不参与合并 */
const spanMethod = makeSpanMethod(() => spans.value)

function cellText(cell: GridCell | null): string {
  if (!cell || cell.v === null) return ''
  return String(cell.v)
}

function cellBrief(cell: GridCell | null): string {
  const t = cellText(cell).replace(/\s+/g, ' ')
  return t.length > 60 ? t.slice(0, 57) + '…' : t
}

function onCellClick(row: { _row: number }, column: { property?: string }): void {
  if (dragging.value) return // 拖拽平移结束的这次点击不应选中单元格
  // 列 prop 形如 "c0"（数据列索引）；不使用内部 _columnIndex，规避合并列偏移
  const prop = column?.property
  if (typeof prop !== 'string' || !prop.startsWith('c')) return
  const c = Number(prop.slice(1))
  if (Number.isNaN(c)) return
  const raw = activeSheet.value?.cells[row._row - 1]?.[c] ?? null
  const value = cellText(raw)
  if (!value) return
  pickedLocally = true // 抑制跳转滚动：格子在页内本来就看得见
  session.selectDocCell(row._row, c + 1, value)
}

// —— 右键菜单：复制该单元格数值 ——

const ctxMenu = ref<{ row: number; col: number; x: number; y: number } | null>(null)

function closeCtxMenu(): void {
  ctxMenu.value = null
}

function onCellContextMenu(
  row: { _row: number },
  column: { property?: string },
  _cell: unknown,
  event: MouseEvent
): void {
  const prop = column?.property
  if (typeof prop !== 'string' || !prop.startsWith('c')) return
  const c = Number(prop.slice(1))
  if (Number.isNaN(c)) return
  event.preventDefault()
  ctxMenu.value = { row: row._row, col: c + 1, x: event.clientX, y: event.clientY }
}

async function copyFromMenu(): Promise<void> {
  const m = ctxMenu.value
  if (!m) return
  closeCtxMenu()
  const text = cellText(activeSheet.value?.cells[m.row - 1]?.[m.col - 1] ?? null)
  if (!text) {
    ElMessage.warning('该单元格为空')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制单元格数值')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

onMounted(() => document.addEventListener('click', closeCtxMenu))
onUnmounted(() => document.removeEventListener('click', closeCtxMenu))

function cellClass({ rowIndex, columnIndex }: { rowIndex: number; columnIndex: number }): string {
  const c = dataCol(columnIndex)
  if (c < 0) return ''
  const classes: string[] = []
  const s = spans.value?.[rowIndex]?.[c]
  if (s && s.rowspan > 0) classes.push('merge-master')
  const sel = session.selectedDocCell
  if (sel && sel.row === rowIndex + 1 && sel.col === c + 1) classes.push('doc-cell-selected')
  return classes.join(' ')
}

async function addDoc(): Promise<void> {
  const res = await window.api.openFile({
    kind: 'doc',
    title: '选择口径资料（Excel 报表 / Word / PDF / TXT）'
  })
  if (res.canceled || !res.path) return
  try {
    await session.addDoc(res.path)
    ElMessage.success(`已加载：${session.docList[session.activeDocIndex]?.name ?? res.path}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function removeCurrentDoc(): Promise<void> {
  const idx = activeReportIndex.value
  if (idx === null) return
  const name = session.docList[idx]?.name ?? ''
  try {
    await ElMessageBox.confirm(`确定删除口径资料「${name}」？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  session.removeDoc(idx)
  ElMessage.success('已删除')
}
</script>

<template>
  <div class="mapping-panel">
    <div class="mapping-toolbar">
      <el-button size="small" type="primary" plain @click="addDoc">打开口径资料</el-button>
      <el-select
        v-if="reportDocs.length"
        :model-value="activeReportIndex"
        size="small"
        class="doc-select"
        placeholder="选择报表文档"
        @update:model-value="(i: number) => session.selectDoc(i)"
      >
        <el-option v-for="r in reportDocs" :key="r.index" :label="r.doc.name" :value="r.index" />
      </el-select>
      <el-select
        v-if="activeSheet"
        v-model="session.activeDocSheet"
        size="small"
        class="sheet-select"
        placeholder="选择工作表"
      >
        <el-option
          v-for="s in activeReportIndex !== null ? session.docList[activeReportIndex].workbooks ?? [] : []"
          :key="s.name"
          :label="s.name"
          :value="s.name"
        />
      </el-select>
      <el-button v-if="activeReportIndex !== null" size="small" type="danger" plain @click="removeCurrentDoc">
        删除当前资料
      </el-button>
    </div>

    <div v-if="activeSheet" class="doc-browser">
      <div
        class="doc-overview"
        :style="{ height: overviewHeight + 'px' }"
        @wheel="onZoomWheel"
      >
        <el-table
          ref="gridRef"
          :data="gridRows"
          :height="Math.round(overviewHeight / zoomScale)"
          :style="{ zoom: zoomScale }"
          size="small"
          border
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
            v-for="c in gridColCount"
            :key="c"
            :prop="'c' + (c - 1)"
            :label="colLetters(gridColCount)[c - 1]"
            :min-width="140"
          >
            <template #default="{ row }">{{ cellBrief(row.cells[c - 1]) }}</template>
          </el-table-column>
        </el-table>
        <ZoomBadge :pct="zoomPct" @reset="resetZoom" />
      </div>

      <ResizeBar @start="onOverviewResizeStart" @drag="onOverviewResize" />

      <div class="doc-detail">
        <div v-if="session.selectedDocCell" class="cell-full">
          <div class="cell-full-meta">
            {{ session.selectedDocCell.sheet }} 第 {{ session.selectedDocCell.row }} 行 / 第
            {{ session.selectedDocCell.col }} 列
          </div>
          <pre v-if="session.selectedDocCell.value" class="cell-full-body">{{
            session.selectedDocCell.value
          }}</pre>
          <el-alert
            v-else
            type="info"
            :closable="false"
            title="该单元格在规则文档中无内容"
          />
        </div>
        <el-alert
          v-else
          type="info"
          :closable="false"
          title="点击上方整体区中的单元格，查看完整内容"
        />
      </div>
    </div>

    <el-empty
      v-else
      :description="reportDocs.length ? '选择一份报表文档查看' : '打开口径资料（Excel 报表 / Word / PDF / TXT）'"
    />
    <!-- 右键菜单 -->
    <div
      v-if="ctxMenu"
      class="mapping-ctx-menu"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
    >
      <div class="ctx-item" @click="copyFromMenu">复制单元格数值</div>
    </div>
  </div>
</template>

<style scoped>
.mapping-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 4px;
}
.mapping-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.doc-select {
  width: 240px;
}
.sheet-select {
  width: 150px;
}
.doc-browser {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.doc-overview {
  position: relative; /* 缩放档位角标定位基准 */
  overflow: hidden; /* 滚动交给表体内部的 el-scrollbar */
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: #fff;
}
/* 左键拖拽平移：表体显示抓手光标 */
.doc-overview :deep(.el-table__body-wrapper .el-scrollbar__wrap) {
  cursor: grab;
}
.doc-detail {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.cell-full {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 10px;
  background: #fafafa;
}
.cell-full-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}
.cell-full-body {
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
.mapping-ctx-menu {
  position: fixed;
  z-index: 3000;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  min-width: 160px;
}
.mapping-ctx-menu .ctx-item {
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.mapping-ctx-menu .ctx-item:hover {
  background: #f5f7fa;
  color: #409eff;
}
</style>

<style>
.mapping-panel .el-table .row-number-col {
  background: #f5f7fa;
  color: #909399;
}
.mapping-panel .el-table .merge-master {
  text-align: center;
  font-weight: 600;
  vertical-align: middle;
}
.mapping-panel .el-table .doc-cell-selected {
  background: #d6e4ff !important;
  color: #1d39c4 !important;
  font-weight: 600;
}
</style>
