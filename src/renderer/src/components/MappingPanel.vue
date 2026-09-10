<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { DocContent, GridCell } from '@shared/types'
import { lookup } from '@shared/core/mapping'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const manualQuery = ref('')

// —— 映射查询（保留现有） ——

const hitResult = computed<{ text: string; desc: string | null } | null>(() => {
  const cell = session.selectedCell
  const query = cell?.text ?? ''
  if (!query || !session.mappingIndex) return null
  return { text: query, desc: lookup(session.mappingIndex, query) }
})

const manualResult = computed<string | null>(() => {
  if (!manualQuery.value || !session.mappingIndex) return null
  return lookup(session.mappingIndex, manualQuery.value)
})

async function importMapping(): Promise<void> {
  const res = await window.api.openFile({ kind: 'mapping', title: '选择口径映射表（两列：指标名、口径说明）' })
  if (res.canceled || !res.path) return
  try {
    await session.loadMappingFile(res.path)
    ElMessage.success(`已导入 ${session.mappingCount} 条口径`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

// —— 口径文档浏览（整体/局部，仅报表 xlsx/xls） ——

/** 文档库中的报表类文档（按全局 docList 索引关联） */
const reportDocs = computed<{ index: number; doc: DocContent }[]>(() =>
  session.docList
    .map((doc, index) => ({ index, doc }))
    .filter(({ doc }) => doc.workbooks && doc.kind !== undefined)
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

const gridRows = computed(() => {
  const s = activeSheet.value
  if (!s) return []
  return s.cells.slice(0, 20).map((row, i) => ({ _row: i + 1, cells: row }))
})

const gridColCount = computed(() => activeSheet.value?.colCount ?? 0)

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

function onCellClick(row: { _row: number }, column: { _columnIndex: number }): void {
  const raw = activeSheet.value?.cells[row._row - 1]?.[column._columnIndex] ?? null
  const value = cellText(raw)
  if (!value) return
  session.selectDocCell(row._row, column._columnIndex + 1, value)
}

function cellClass({ rowIndex, columnIndex }: { rowIndex: number; columnIndex: number }): string {
  const sel = session.selectedDocCell
  if (sel && sel.row === rowIndex + 1 && sel.col === columnIndex + 1) return 'doc-cell-selected'
  return ''
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
      <el-button size="small" @click="importMapping">导入映射表</el-button>
      <span v-if="session.mappingCount" class="mapping-count">
        已收录 {{ session.mappingCount }} 条口径
      </span>
    </div>

    <template v-if="reportDocs.length">
      <el-divider content-position="left">口径资料（整体 / 局部）</el-divider>
      <div v-if="gridRows.length" class="doc-overview">
        <el-table
          :data="gridRows"
          size="small"
          border
          height="220px"
          :cell-class-name="cellClass"
          @cell-click="onCellClick"
        >
          <el-table-column type="index" label="" width="56" align="right" class-name="row-number-col" />
          <el-table-column
            v-for="c in gridColCount"
            :key="c"
            :label="colLetters(gridColCount)[c - 1]"
            :min-width="140"
          >
            <template #default="{ row }">{{ cellBrief(row.cells[c - 1]) }}</template>
          </el-table-column>
        </el-table>
      </div>
      <div v-else class="doc-overview">
        <el-empty description="该工作表没有内容" />
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
    </template>

    <el-divider content-position="left">单元格查询</el-divider>
    <div v-if="session.selectedCell" class="cell-query">
      <div class="cell-info">
        来源：{{ session.selectedCell.sheet }} {{ session.selectedCell.ref }}，文本「{{ session.selectedCell.text || '（空）' }}」
      </div>
      <div v-if="hitResult?.desc" class="hit-desc">
        <div class="hit-name">{{ hitResult.text }}</div>
        <div class="hit-body">{{ hitResult.desc }}</div>
      </div>
      <el-alert
        v-else-if="hitResult"
        type="info"
        :closable="false"
        title="该单元格文本未在映射表中收录"
      />
      <el-alert
        v-else
        type="info"
        :closable="false"
        title="点击网格中的单元格，或先导入映射表"
      />
    </div>

    <el-divider content-position="left">手动查询</el-divider>
    <div class="manual-row">
      <el-input
        v-model="manualQuery"
        size="small"
        class="manual-input"
        placeholder="手动输入指标名查询"
        clearable
      />
    </div>
    <div v-if="manualResult" class="hit-desc">
      <div class="hit-name">{{ manualQuery }}</div>
      <div class="hit-body">{{ manualResult }}</div>
    </div>
    <el-alert
      v-else-if="manualQuery && session.mappingIndex"
      type="info"
      :closable="false"
      title="未命中，请检查指标名写法"
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
}
.doc-select {
  width: 240px;
}
.sheet-select {
  width: 150px;
}
.mapping-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.doc-overview {
  margin-bottom: 8px;
}
.doc-detail {
  flex: 1;
  overflow: auto;
  min-height: 80px;
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
.cell-query {
  margin-bottom: 8px;
}
.cell-info {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}
.hit-desc {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 10px;
}
.hit-name {
  font-weight: 600;
  margin-bottom: 6px;
}
.hit-body {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.manual-row {
  margin-bottom: 8px;
}
.manual-input {
  width: 260px;
}
</style>

<style>
.mapping-panel .el-table .row-number-col {
  background: #f5f7fa;
  color: #909399;
}
.mapping-panel .el-table .doc-cell-selected {
  background: #d6e4ff !important;
  color: #1d39c4 !important;
  font-weight: 600;
}
</style>
