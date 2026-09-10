<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { SheetData } from '@shared/types'
import { buildMergeSpans } from '@shared/core/merge'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()

const side = ref<'base' | 'curr'>('curr')
const sheetName = ref('')
const sheetData = ref<SheetData | null>(null)
const gridRef = ref<{ scrollTo: (o: { top: number }) => void } | null>(null)

const pairOptions = computed(() =>
  (session.compareResult?.pairs ?? []).map((p, i) => ({ index: i, label: p.pairLabel }))
)

/** 当前文件对的两侧工作簿（顺序配对：pair 索引即数组索引） */
const workbook = computed(() =>
  (side.value === 'base' ? session.baseWorkbooks : session.currWorkbooks)[
    session.activePairIndex
  ] ?? null
)

const sheetOptions = computed(() => workbook.value?.sheetNames ?? [])

/** 变动格命中集合：`sheet|row|col`（1 起始），按当前文件对的结果 */
const hitSet = computed(() => {
  const s = new Set<string>()
  const pair = session.compareResult?.pairs[session.activePairIndex]
  for (const d of pair?.compare.diffs ?? []) {
    s.add(`${d.sheet}|${d.row}|${d.col}`)
  }
  return s
})

/** 合并区域 span 矩阵（行 0 起始，与 data 行索引一致） */
const spans = computed(() =>
  sheetData.value ? buildMergeSpans(sheetData.value.merges, sheetData.value.rowCount, sheetData.value.colCount) : null
)

/** el-table span-method：主格展开，被覆盖格隐藏；第 0 列是行号列，不参与合并 */
function spanMethod({
  rowIndex,
  columnIndex
}: {
  rowIndex: number
  columnIndex: number
}): [number, number] {
  if (columnIndex === 0) return [1, 1]
  const s = spans.value?.[rowIndex]?.[columnIndex]
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

function cellText(rowIdx: number, colIdx: number): string {
  const cell = sheetData.value?.cells[rowIdx]?.[colIdx]
  return cell && cell.v !== null ? String(cell.v) : ''
}

function cellClass({ rowIndex, columnIndex }: { rowIndex: number; columnIndex: number }): string {
  // 第 0 列是行号列：不参与合并/命中/聚焦标记
  if (columnIndex === 0) return ''
  const name = sheetName.value
  const classes: string[] = []
  const s = spans.value?.[rowIndex]?.[columnIndex]
  if (s && s.rowspan > 0) classes.push('merge-master')
  // DiffList 跳转聚焦格：紫色标记（优先于 diff-hit）
  const f = session.gridFocus
  if (
    f &&
    f.pairIndex === session.activePairIndex &&
    f.sheet === name &&
    f.row === rowIndex + 1 &&
    f.col === columnIndex + 1
  ) {
    classes.push('cell-focused')
  }
  if (name && hitSet.value.has(`${name}|${rowIndex + 1}|${columnIndex + 1}`)) classes.push('diff-hit')
  return classes.join(' ')
}

function onCellClick(
  row: { _rowIndex: number },
  column: { _columnIndex: number }
): void {
  const r = row._rowIndex + 1
  const c = column._columnIndex + 1
  const text = cellText(row._rowIndex, column._columnIndex)
  session.selectCell(text, sheetName.value, `${colLetters(sheetData.value?.colCount ?? 0)[c - 1] ?? ''}${r}`)
}

async function loadSheet(): Promise<void> {
  const wb = workbook.value
  if (!wb || !sheetName.value) {
    sheetData.value = null
    return
  }
  try {
    sheetData.value = await window.api.getSheet(wb.id, sheetName.value)
  } catch (err) {
    sheetData.value = null
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

// 离开网格标签页（组件销毁）时清除聚焦格紫色标记
onUnmounted(() => session.clearGridFocus())

// 切换工作簿（换文件对/换侧）时重置并加载第一个 sheet
watch(
  [side, () => workbook.value?.id],
  () => {
    sheetName.value = sheetOptions.value[0] ?? ''
    loadSheet()
  },
  { immediate: true }
)

watch(sheetName, loadSheet)

// DiffList 点击跳转：切文件对 + 切 sheet + 估算滚动到目标行
watch(
  () => session.gridFocus,
  (focus) => {
    if (!focus) return
    session.activePairIndex = focus.pairIndex
    const target = focus
    setTimeout(() => {
      if (sheetOptions.value.includes(target.sheet) && sheetName.value !== target.sheet) {
        sheetName.value = target.sheet
      }
      if (sheetName.value === target.sheet) {
        gridRef.value?.scrollTo({ top: Math.max(0, target.row - 3) * 40 })
      }
    }, 100)
  }
)
</script>

<template>
  <div class="sheet-grid">
    <div class="grid-toolbar">
      <el-select
        v-model="session.activePairIndex"
        size="small"
        class="pair-select"
        placeholder="选择文件对"
      >
        <el-option v-for="o in pairOptions" :key="o.index" :label="o.label" :value="o.index" />
      </el-select>
      <el-radio-group v-model="side" size="small">
        <el-radio-button value="curr">本期</el-radio-button>
        <el-radio-button value="base">上期</el-radio-button>
      </el-radio-group>
      <el-select v-model="sheetName" size="small" class="sheet-select" placeholder="选择工作表">
        <el-option v-for="s in sheetOptions" :key="s" :label="s" :value="s" />
      </el-select>
      <span class="grid-hint">黄色高亮 = 变动 &gt; 阈值；点击单元格查看口径</span>
    </div>
    <el-table
      v-if="sheetData"
      ref="gridRef"
      :data="sheetData.cells.map((row, i) => ({ _rowIndex: i, cells: row }))"
      size="small"
      border
      height="100%"
      :cell-class-name="cellClass"
      :span-method="spanMethod"
      @cell-click="onCellClick"
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
        v-for="c in sheetData.colCount"
        :key="c"
        :label="colLetters(sheetData.colCount)[c - 1]"
        :min-width="120"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ cellText(row._rowIndex, c - 1) }}</template>
      </el-table-column>
    </el-table>
    <el-empty v-else-if="!session.compareResult" description="请先比对" />
    <el-empty v-else description="选择文件对查看网格" />
  </div>
</template>

<style scoped>
.sheet-grid {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.grid-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.pair-select {
  width: 280px;
}
.sheet-select {
  width: 180px;
}
.grid-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>

<style>
.sheet-grid .el-table .row-number-col {
  background: #f5f7fa;
  color: #909399;
  font-weight: 400;
}
.sheet-grid .el-table .diff-hit {
  background: #ffd6e8 !important;
  font-weight: 600;
  color: #d6336c;
}
.sheet-grid .el-table .cell-focused {
  background: #e6d0f5 !important;
  color: #6d28d9 !important;
  font-weight: 700;
}
.sheet-grid .el-table .merge-master {
  text-align: center;
  font-weight: 600;
  vertical-align: middle;
}
</style>
