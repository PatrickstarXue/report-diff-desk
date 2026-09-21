<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { TemplateCellRef } from '@shared/types'

const props = defineProps<{
  title: string
  cells: TemplateCellRef[]
  /** 位置键 `"row,col"` → 规则值（含空串=不比对） */
  modelValue: Record<string, string>
  /** 对侧的规则值集合，用于标记哪些格子已配上 */
  peerValues: Set<string>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, string>): void
}>()

/** 有值的行/列（按出现顺序去重） */
const rowList = computed(() => [...new Set(props.cells.map((c) => c.row))])
const colList = computed(() => [...new Set(props.cells.map((c) => c.col))])

/** (row,col) → 该格的标签来源 */
const cellAt = computed(() => {
  const m = new Map<string, TemplateCellRef>()
  for (const c of props.cells) m.set(`${c.row},${c.col}`, c)
  return m
})

const seedOf = (row: number, col: number): string => cellAt.value.get(`${row},${col}`)?.seed ?? ''
const rowLabel = (row: number): string =>
  cellAt.value.get(`${row},${colList.value[0]}`)?.rowPath ?? ''
const colLabel = (col: number): string =>
  cellAt.value.get(`${rowList.value[0]},${col}`)?.colPath ?? ''

/** 生效规则值：草稿有该位置则以其为准（空串=不比对），否则用种子 */
function valueAt(row: number, col: number): string {
  const v = props.modelValue[`${row},${col}`]
  return v === undefined ? seedOf(row, col) : v
}

const rows = computed(() =>
  rowList.value.map((row) => ({
    row,
    label: rowLabel(row),
    cells: colList.value.map((col) => ({ col, exists: cellAt.value.has(`${row},${col}`) }))
  }))
)

// —— 单元格编辑：同时只存在一个输入框 ——

const editing = ref<{ row: number; col: number } | null>(null)
const editingText = ref('')
/** 用函数 ref 而不是 ref="inputRef"：输入框在 v-for 里，模板 ref 会被 Vue 收集成数组 */
let inputEl: { focus: () => void } | null = null
const setInputRef = (el: unknown): void => {
  inputEl = el as { focus: () => void } | null
}

async function startEdit(row: number, col: number): Promise<void> {
  if (!cellAt.value.has(`${row},${col}`)) return
  editing.value = { row, col }
  editingText.value = valueAt(row, col)
  await nextTick()
  inputEl?.focus()
}

/** 与种子相同的值不落草稿，保持草稿精简 */
function put(next: Record<string, string>, row: number, col: number, v: string): void {
  const key = `${row},${col}`
  if (v === seedOf(row, col)) delete next[key]
  else next[key] = v
}

function commitEdit(): void {
  const e = editing.value
  if (!e) return
  editing.value = null
  const next = { ...props.modelValue }
  put(next, e.row, e.col, editingText.value)
  emit('update:modelValue', next)
}

/** 整行 / 整列批量设置：把该范围内的规则值一次改成同一个 */
async function bulkSet(kind: 'row' | 'col', index: number): Promise<void> {
  const hint = kind === 'row' ? rowLabel(index) : colLabel(index)
  let v: string
  try {
    const r = await ElMessageBox.prompt(
      `${kind === 'row' ? '整行' : '整列'}「${hint}」的规则值统一设为：`,
      '批量设置',
      { inputValue: hint, inputPlaceholder: '规则值' }
    )
    v = r.value ?? ''
  } catch {
    return
  }
  const next = { ...props.modelValue }
  if (kind === 'row') {
    for (const col of colList.value) {
      if (cellAt.value.has(`${index},${col}`)) put(next, index, col, v)
    }
  } else {
    for (const row of rowList.value) {
      if (cellAt.value.has(`${row},${index}`)) put(next, row, index, v)
    }
  }
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="rule-table">
    <div class="rule-title">{{ title }}</div>
    <div class="rule-scroll">
      <table class="rule-grid">
        <thead>
          <tr>
            <th class="corner"></th>
            <th v-for="col in colList" :key="col" class="col-head">
              <span class="head-text">{{ colLabel(col) }}</span>
              <el-button link size="small" @click="bulkSet('col', col)">批量</el-button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.row">
            <th class="row-head">
              <span class="head-text">{{ r.label }}</span>
              <el-button link size="small" @click="bulkSet('row', r.row)">批量</el-button>
            </th>
            <td
              v-for="c in r.cells"
              :key="c.col"
              :class="{
                'not-exist': !c.exists,
                matched: c.exists && peerValues.has(valueAt(r.row, c.col).trim())
              }"
              @click="startEdit(r.row, c.col)"
            >
              <el-input
                v-if="editing && editing.row === r.row && editing.col === c.col"
                :ref="setInputRef"
                v-model="editingText"
                size="small"
                @blur="commitEdit"
                @keyup.enter="commitEdit"
              />
              <template v-else>{{ c.exists ? valueAt(r.row, c.col) : '' }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.rule-table {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.rule-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.rule-scroll {
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  max-height: 62vh;
}
.rule-grid {
  border-collapse: collapse;
  font-size: 12px;
  width: max-content;
}
.rule-grid th,
.rule-grid td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 2px 6px;
  white-space: nowrap;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rule-grid thead th {
  position: sticky;
  top: 0;
  background: #f5f7fa;
  z-index: 1;
}
.rule-grid .corner,
.rule-grid .row-head {
  position: sticky;
  left: 0;
  background: #f5f7fa;
  text-align: left;
  z-index: 2;
}
.rule-grid td {
  cursor: text;
  background: #fff;
}
.rule-grid td.not-exist {
  background: #fafafa;
  cursor: default;
}
.rule-grid td.matched {
  background: #e8f5e9;
}
.head-text {
  margin-right: 4px;
}
</style>
