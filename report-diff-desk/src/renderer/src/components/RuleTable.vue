<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { colLetter } from '@shared/core/sheet-view'
import { ruleValueOf, splitRuleValue } from '@shared/core/template'
import type { TemplateCellRef } from '@shared/types'

const props = defineProps<{
  title: string
  /** 解析出的数据格；只读预览已保存规则表时为空，此时行列与标签从 modelValue 推导 */
  cells: TemplateCellRef[]
  /** 位置键 `"row,col"` → 规则值（含空串=不比对） */
  modelValue: Record<string, string>
  /** 对侧的规则值集合，用于标记哪些格子已配上 */
  peerValues: Set<string>
  /** 只读：没有上传报表时仅展示已保存的规则表 */
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, string>): void
}>()

const hasCells = computed(() => props.cells.length > 0)

const positions = computed(() => {
  const rows = new Set<number>()
  const cols = new Set<number>()
  for (const k of Object.keys(props.modelValue)) {
    const [r, c] = k.split(',')
    const rn = Number(r)
    const cn = Number(c)
    if (!Number.isNaN(rn)) rows.add(rn)
    if (!Number.isNaN(cn)) cols.add(cn)
  }
  return {
    rows: [...rows].sort((a, b) => a - b),
    cols: [...cols].sort((a, b) => a - b)
  }
})

/**
 * 行/列 = 当前解析出的格 ∪ 草稿里的位置。
 * 存档可能含当前解析产不出的格（锚点词不对时解析会降级，只剩有数值的格），
 * 只按解析结果排行列的话，这些存档格就整片看不见——「恢复存档规则」看着像没生效。
 */
const rowList = computed(() => {
  const rows = new Set(props.cells.map((c) => c.row))
  for (const r of positions.value.rows) rows.add(r)
  return [...rows].sort((a, b) => a - b)
})
const colList = computed(() => {
  const cols = new Set(props.cells.map((c) => c.col))
  for (const c of positions.value.cols) cols.add(c)
  return [...cols].sort((a, b) => a - b)
})

/** (row,col) → 该格的标签来源 */
const cellAt = computed(() => {
  const m = new Map<string, TemplateCellRef>()
  for (const c of props.cells) m.set(`${c.row},${c.col}`, c)
  return m
})

/** 行/列标签取该行/该列任意一个解析出的格（按列号/行号最小的），别绑死第一列/第一行 */
const repByRow = computed(() => {
  const m = new Map<number, TemplateCellRef>()
  for (const c of props.cells) {
    const cur = m.get(c.row)
    if (!cur || c.col < cur.col) m.set(c.row, c)
  }
  return m
})
const repByCol = computed(() => {
  const m = new Map<number, TemplateCellRef>()
  for (const c of props.cells) {
    const cur = m.get(c.col)
    if (!cur || c.row < cur.row) m.set(c.col, c)
  }
  return m
})

/**
 * 行/列标签优先取草稿里的规则值（规则值的两半就是行/列规则），
 * 其次才用解析出的路径——锚点词不对时解析降级成「第N行」，而存档里的行规则是对的。
 */
function rowLabel(row: number): string {
  for (const col of colList.value) {
    const v = props.modelValue[`${row},${col}`]?.trim()
    const part = v ? splitRuleValue(v).row : ''
    if (part) return part
  }
  return repByRow.value.get(row)?.rowPath ?? `第${row + 1}行`
}
function colLabel(col: number): string {
  for (const row of rowList.value) {
    const v = props.modelValue[`${row},${col}`]?.trim()
    const part = v ? splitRuleValue(v).col : ''
    if (part) return part
  }
  return repByCol.value.get(col)?.colPath ?? colLetter(col)
}

/** 该位置是否有数据格（可编辑视图）；只读预览时以已保存的键为准 */
function exists(row: number, col: number): boolean {
  const key = `${row},${col}`
  return hasCells.value ? cellAt.value.has(key) : props.modelValue[key] !== undefined
}

const seedOf = (row: number, col: number): string => cellAt.value.get(`${row},${col}`)?.seed ?? ''

/** 生效规则值：草稿有该位置则以其为准（空串=不比对），否则用种子 */
function valueAt(row: number, col: number): string {
  const v = props.modelValue[`${row},${col}`]
  if (v !== undefined) return v
  return hasCells.value ? seedOf(row, col) : ''
}

const rows = computed(() =>
  rowList.value.map((row) => ({
    row,
    label: rowLabel(row),
    cells: colList.value.map((col) => ({ col, exists: exists(row, col) }))
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
  if (props.readonly || !exists(row, col)) return
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

/**
 * 整行 / 整列批量设置。
 * 规则值形如 `行规则值_列规则值`，行头只改行那一半、列头只改列那一半，另一半原样保留
 * （某格缺另一半时用该格自己的行/列标签补上）。
 * 已清空的格子（空串 = 不比对）保持不动，批量操作不该把排除掉的格子又拉回比对。
 */
async function bulkSet(kind: 'row' | 'col', index: number): Promise<void> {
  if (props.readonly) return
  const isRow = kind === 'row'
  const half = isRow ? '行规则值' : '列规则值'
  const other = isRow ? '列规则值' : '行规则值'
  const hint = isRow ? rowLabel(index) : colLabel(index)
  let v: string
  try {
    const r = await ElMessageBox.prompt(
      `整${isRow ? '行' : '列'}「${hint}」的${half}统一设为（${other}保持不变，已清空的格子不动）：`,
      '批量设置',
      { inputValue: hint, inputPlaceholder: half }
    )
    v = r.value ?? ''
  } catch {
    return
  }
  const next = { ...props.modelValue }
  const apply = (row: number, col: number): void => {
    if (!exists(row, col)) return
    const old = valueAt(row, col)
    if (!old.trim()) return
    const parts = splitRuleValue(old)
    const merged = isRow
      ? ruleValueOf(v, parts.col || colLabel(col))
      : ruleValueOf(parts.row || rowLabel(row), v)
    put(next, row, col, merged)
  }
  if (isRow) {
    for (const col of colList.value) apply(index, col)
  } else {
    for (const row of rowList.value) apply(row, index)
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
              <el-button
                v-if="!readonly"
                link
                size="small"
                title="把本列各格的列规则值统一改成一个"
                @click="bulkSet('col', col)"
              >
                批量
              </el-button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.row">
            <th class="row-head">
              <span class="head-text">{{ r.label }}</span>
              <el-button
                v-if="!readonly"
                link
                size="small"
                title="把本行各格的行规则值统一改成一个"
                @click="bulkSet('row', r.row)"
              >
                批量
              </el-button>
            </th>
            <td
              v-for="c in r.cells"
              :key="c.col"
              :class="{
                'not-exist': !c.exists,
                matched: c.exists && peerValues.has(valueAt(r.row, c.col).trim())
              }"
              :title="c.exists ? undefined : '当前报表没解析到这一格（灰底、不可编辑）'"
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
              <!-- 解析没产出的格也照显示草稿值（存档可能还留着），空串就还是空的 -->
              <template v-else>{{ valueAt(r.row, c.col) }}</template>
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
