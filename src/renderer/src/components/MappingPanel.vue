<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { GridCell } from '@shared/types'
import { buildMergeSpans } from '@shared/core/merge'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()

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

/** el-table 列序号 → 数据列索引（第 0 列是行号列） */
function dataCol(columnIndex: number): number {
  return columnIndex - 1
}

function spanMethod({
  rowIndex,
  columnIndex
}: {
  rowIndex: number
  columnIndex: number
}): [number, number] {
  const c = dataCol(columnIndex)
  if (c < 0) return [1, 1]
  const s = spans.value?.[rowIndex]?.[c]
  if (!s) return [1, 1]
  return [s.rowspan, s.colspan]
}

function colLetters(colCount: number): string[] {
  const out: string[] = []
  for (let c = 1; c <= colCount; c++) {
    let n = c
    let letters = ''
    while (n > 0) {
      const rem = (n - 1) % 26
      letters = String.fromCharCode(65 + rem) + letters
      n = Math.floor((n - 1) / 26)
    }
    out.push(letters)
  }
  return out
}

function cellText(cell: GridCell | null): string {
  if (!cell || cell.v === null) return ''
  return String(cell.v)
}

function cellBrief(cell: GridCell | null): string {
  const t = cellText(cell).replace(/\s+/g, ' ')
  return t.length > 60 ? t.slice(0, 57) + '…' : t
}

function onCellClick(row: { _row: number }, column: { property?: string }): void {
  // 列 prop 形如 "c0"（数据列索引）；不使用内部 _columnIndex，规避合并列偏移
  const prop = column?.property
  if (typeof prop !== 'string' || !prop.startsWith('c')) return
  const c = Number(prop.slice(1))
  if (Number.isNaN(c)) return
  const raw = activeSheet.value?.cells[row._row - 1]?.[c] ?? null
  const value = cellText(raw)
  if (!value) return
  session.selectDocCell(row._row, c + 1, value)
}

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
      <div class="doc-overview">
        <el-table
          :data="gridRows"
          size="small"
          border
          :cell-class-name="cellClass"
          :span-method="spanMethod"
          @cell-click="onCellClick"
        >
          <el-table-column type="index" label="" width="56" align="right" class-name="row-number-col" />
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
      </div>

      <div class="doc-detail">
        <div v-if="session.selectedDocCell" class="cell-full">
          <div class="cell-full-meta">
            {{ session.selectedDocCell.sheet }} 第 {{ session.selectedDocCell.row }} 行 / 第
            {{ session.selectedDocCell.col }} 列
          </div>
          <pre class="cell-full-body">{{ session.selectedDocCell.value }}</pre>
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
  height: 50vh;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: #fff;
}
.doc-detail {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin-top: 8px;
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
