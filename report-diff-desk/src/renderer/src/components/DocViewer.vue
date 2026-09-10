<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { DocContent, GridCell } from '@shared/types'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const keyword = ref('')
const docFontSize = ref(14)

const doc = computed<DocContent | null>(() => session.docList[session.activeDocIndex] ?? null)

/** 当前报表文档选中的 sheet 数据 */
const activeSheet = computed(() => {
  const d = doc.value
  if (!d?.workbooks) return null
  return d.workbooks.find((s) => s.name === session.activeDocSheet) ?? d.workbooks[0] ?? null
})

/** 整体区（报表）表格数据：前 20 行 + 坐标字段 */
const gridRows = computed(() => {
  const s = activeSheet.value
  if (!s) return []
  return s.cells.slice(0, 20).map((row, i) => ({
    _row: i + 1,
    cells: row
  }))
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

/** 整体区单元格显示：截断为单行 */
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

/** 整体区（报表）可见文本 = 前 20 行文本，供搜索 */
const searchableSheetText = computed(() =>
  gridRows.value
    .flatMap((r) => r.cells.map(cellText))
    .filter(Boolean)
    .join('\n')
)

const visiblePages = computed<{ index: number; text: string }[]>(() => {
  const pages = doc.value?.pages ?? []
  const kw = keyword.value.trim()
  return pages.map((text, index) => ({ index, text })).filter((p) => !kw || p.text.includes(kw))
})

const sheetFiltered = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return true
  return searchableSheetText.value.includes(kw)
})

async function importDoc(): Promise<void> {
  const res = await window.api.openFile({
    kind: 'doc',
    title: '选择口径文档（Excel 报表 / Word / PDF / TXT）'
  })
  if (res.canceled || !res.path) return
  try {
    await session.addDoc(res.path)
    keyword.value = ''
    ElMessage.success(`已加载：${doc.value?.name ?? res.path}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

watch(
  () => session.activeDocIndex,
  () => {
    const d = session.docList[session.activeDocIndex]
    session.activeDocSheet = d?.workbooks?.[0]?.name ?? ''
    session.selectedDocCell = null
  }
)
</script>

<template>
  <div class="doc-viewer">
    <div class="doc-toolbar">
      <el-button size="small" @click="importDoc">打开文档</el-button>
      <el-select
        v-if="session.docList.length"
        v-model="session.activeDocIndex"
        size="small"
        class="doc-select"
        placeholder="选择文档"
      >
        <el-option v-for="(d, i) in session.docList" :key="i" :label="d.name" :value="i" />
      </el-select>
      <el-select
        v-if="doc?.workbooks?.length"
        v-model="session.activeDocSheet"
        size="small"
        class="sheet-select"
        placeholder="选择工作表"
      >
        <el-option v-for="s in doc.workbooks" :key="s.name" :label="s.name" :value="s.name" />
      </el-select>
      <template v-if="doc">
        <el-input v-model="keyword" size="small" class="doc-keyword" placeholder="关键字过滤" clearable />
        <span class="doc-font-label">字号</span>
        <el-input-number v-model="docFontSize" :min="10" :max="28" size="small" />
      </template>
    </div>

    <template v-if="doc">
      <el-divider content-position="left">整体</el-divider>
      <!-- 整体区：报表前 20 行缩略 -->
      <div v-if="doc.workbooks" class="doc-overview">
        <el-table
          v-if="gridRows.length"
          :data="gridRows"
          size="small"
          border
          height="200px"
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
        <el-empty v-else-if="!sheetFiltered" description="没有匹配关键字的内容" />
        <el-empty v-else description="该工作表没有内容" />
      </div>
      <!-- 整体区：docx iframe / pdf txt 第一页 -->
      <div v-else class="doc-overview">
        <iframe v-if="doc.kind === 'docx'" class="doc-frame-overview" sandbox="" :srcdoc="doc.html" />
        <pre v-else class="doc-overview-text">{{ (doc.pages?.[0] ?? '').slice(0, 2000) }}</pre>
      </div>

      <el-divider content-position="left">局部</el-divider>
      <!-- 局部区：报表选中单元格完整内容 -->
      <div v-if="doc.workbooks" class="doc-detail">
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
      <!-- 局部区：docx / pdf / txt 完整内容 -->
      <div v-else class="doc-content" :style="{ fontSize: docFontSize + 'px' }">
        <iframe v-if="doc.kind === 'docx'" class="doc-frame" sandbox="" :srcdoc="doc.html" />
        <div v-else-if="visiblePages.length" class="doc-pages">
          <div v-for="p in visiblePages" :key="p.index" class="doc-page">
            <div class="doc-page-no">第 {{ p.index + 1 }} 页</div>
            <pre class="doc-page-text">{{ p.text }}</pre>
          </div>
        </div>
        <el-empty v-else description="没有匹配关键字的内容" />
      </div>
    </template>
    <el-empty v-else description="打开口径文档（Excel 报表 / Word / PDF / TXT），可同时加载多份" />
  </div>
</template>

<style scoped>
.doc-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.doc-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.doc-select {
  width: 260px;
}
.sheet-select {
  width: 160px;
}
.doc-keyword {
  width: 180px;
}
.doc-font-label {
  font-size: 13px;
}
.doc-overview {
  margin-bottom: 8px;
}
.doc-overview-text {
  font-family: inherit;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 8px;
  max-height: 200px;
  overflow: auto;
  background: #fafafa;
}
.doc-frame-overview {
  width: 100%;
  height: 200px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: #fff;
}
.doc-detail {
  flex: 1;
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
.doc-content {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 12px;
}
.doc-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}
.doc-page {
  margin-bottom: 16px;
}
.doc-page-no {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  border-bottom: 1px dashed var(--el-border-color);
  margin-bottom: 8px;
  padding-bottom: 4px;
}
.doc-page-text {
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.7;
  margin: 0;
}
</style>

<style>
.doc-viewer .el-table .row-number-col {
  background: #f5f7fa;
  color: #909399;
}
.doc-viewer .el-table .doc-cell-selected {
  background: #d6e4ff !important;
  color: #1d39c4 !important;
  font-weight: 600;
}
</style>
