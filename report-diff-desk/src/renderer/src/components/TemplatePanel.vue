<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AlignConfig, AlignPairRule, CellRange, TemplateDiff } from '@shared/types'
import { templateKeyOf } from '@shared/core/template'
import { useSessionStore } from '../stores/session'
import TemplateGrid from './TemplateGrid.vue'

const session = useSessionStore()

/** 阈值输入用百分数（0.01 = 0.01%），与现有环比比对一致 */
const thresholdPct = ref(0.01)

/** 配对模式：已点选的源格及其所在侧（null = 非配对模式） */
const pickSource = ref<{ row: number; col: number; side: 'left' | 'right' } | null>(null)
/** 表样范围模式：已武装，等待点选 */
const rangeArmed = ref(false)
/** 表样范围模式：已点选的左上角 */
const rangeStart = ref<{ row: number; col: number } | null>(null)

onMounted(() => void session.reloadAlignConfig())

watch(thresholdPct, (v) => {
  session.templateThreshold = Math.max(0, v) / 100
})

const result = computed(() => session.templateResult)
const pair = computed(() => session.activeTemplatePair)

/** 当前表对两侧的表样键，人工规则按这对键读写 */
const keyL = computed(() => templateKeyOf(pair.value?.left?.fileName ?? ''))
const keyR = computed(() => templateKeyOf(pair.value?.right?.fileName ?? ''))

/** 差异拍平成一张表，带表对索引 */
const diffRows = computed(() => {
  const out: { key: string; tableNo: string; diff: TemplateDiff; pairIndex: number }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const d of p.diffs) {
      out.push({
        key: `${pi}|${d.leftRow},${d.leftCol}|${d.rowPath}|${d.colPath}`,
        tableNo: p.tableNo ?? '—',
        diff: d,
        pairIndex: pi
      })
    }
  })
  return out
})

const onlyRows = computed(() => {
  const out: { key: string; tableNo: string; side: string; path: string }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const e of p.onlyInLeft) {
      out.push({
        key: `${pi}|L|${e.row},${e.col}`,
        tableNo: p.tableNo ?? '—',
        side: '左',
        path: `${e.rowPath} / ${e.colPath}`
      })
    }
    for (const e of p.onlyInRight) {
      out.push({
        key: `${pi}|R|${e.row},${e.col}`,
        tableNo: p.tableNo ?? '—',
        side: '右',
        path: `${e.rowPath} / ${e.colPath}`
      })
    }
  })
  return out
})

const pairOptions = computed(() =>
  (result.value?.pairs ?? []).map((p, i) => ({
    index: i,
    label: `${p.tableNo ?? '?'}：${templateKeyOf(p.leftFile)} ↔ ${templateKeyOf(p.rightFile)}`
  }))
)

/** 解析失败的表提示（两侧任一侧有 error 就显示） */
const pairError = computed(() => pair.value?.left?.error ?? pair.value?.right?.error ?? '')

/** 当前处于哪种点选模式 */
const pickHint = computed(() => {
  if (pickSource.value) return '配对模式：请点击目标单元格'
  if (rangeArmed.value) {
    return rangeStart.value ? '表样范围：请点击右下角单元格' : '表样范围：请点击左上角单元格'
  }
  return ''
})

// —— 未配对的表：手动指定表对 ——

const manualLeftId = ref('')
const manualRightId = ref('')

const unmatchedLeftOptions = computed(() =>
  session.templateLeft.filter((w) => (result.value?.unmatchedLeft ?? []).includes(w.fileName))
)
const unmatchedRightOptions = computed(() =>
  session.templateRight.filter((w) => (result.value?.unmatchedRight ?? []).includes(w.fileName))
)

async function addManualPair(): Promise<void> {
  if (!manualLeftId.value || !manualRightId.value) return
  session.manualTablePairs = [
    ...session.manualTablePairs,
    { leftId: manualLeftId.value, rightId: manualRightId.value }
  ]
  manualLeftId.value = ''
  manualRightId.value = ''
  await session.runTemplateCheck()
}

// —— 选文件 ——

async function openSide(side: 'left' | 'right'): Promise<void> {
  const res = await window.api.openFile({
    kind: 'report',
    title: side === 'left' ? '选择左侧报表（R 系列）' : '选择右侧报表（NR 系列）'
  })
  if (res.canceled || !res.path) return
  try {
    await session.loadTemplateSide(side, res.path)
    ElMessage.success(`已加载：${templateKeyOf(res.path)}`)
    await session.runTemplateCheck()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

/** 差异行选中 → 网格切到左侧并定位（用 current-change 而非 cell-click，键盘也能用） */
function onDiffCurrentChange(row: { diff: TemplateDiff; pairIndex: number } | null): void {
  if (!row) return
  session.focusTemplateCell(row.pairIndex, 'left', row.diff.leftRow, row.diff.leftCol)
}

// —— 表对 / 侧切换（模板焦点不带表对与侧的身份，切换即清除，防止旧高亮落到新视图同坐标格上） ——

function onPairIndexChange(v: number): void {
  session.templatePairIndex = v
  session.templateFocus = null
}

function onSideChange(v: string | number | boolean | undefined): void {
  if (v !== 'left' && v !== 'right') return
  session.templateSide = v
  session.templateFocus = null
}

// —— 人工规则读写 ——

/** 合并写入：同表样对、同源格的旧规则被替换，其余规则原样保留；写盘失败提示并返回 false */
async function saveRules(
  newRules: AlignPairRule[],
  headerKey?: string,
  headerRange?: CellRange
): Promise<boolean> {
  const base: AlignConfig = session.alignConfig ?? { version: 1, templates: {}, pairs: [] }
  const templates =
    headerKey && headerRange ? { ...base.templates, [headerKey]: { headerRange } } : base.templates
  const keys = new Set(newRules.map((r) => `${r.left}|${r.right}|${r.fromRow}|${r.fromCol}`))
  const kept = base.pairs.filter((p) => !keys.has(`${p.left}|${p.right}|${p.fromRow}|${p.fromCol}`))
  try {
    await session.saveAlignConfig({ version: 1, templates, pairs: [...kept, ...newRules] })
    return true
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
    return false
  }
}

/** 忽略规则恒以左侧坐标为键 */
async function ignoreDiff(d: TemplateDiff): Promise<void> {
  const ok = await saveRules([
    { left: keyL.value, right: keyR.value, fromRow: d.leftRow, fromCol: d.leftCol, ignored: true }
  ])
  if (ok) ElMessage.success('已忽略，下次核对自动跳过')
}

/** 网格右键「忽略此项」：由当前侧坐标反查差异条目 */
async function ignoreAt(row: number, col: number): Promise<void> {
  const p = pair.value
  if (!p) return
  const isLeft = session.templateSide === 'left'
  const d = p.diffs.find((x) =>
    isLeft ? x.leftRow === row && x.leftCol === col : x.rightRow === row && x.rightCol === col
  )
  if (!d) {
    ElMessage.warning('该单元格不在差异列表中，无需忽略')
    return
  }
  await ignoreDiff(d)
}

async function clearTableRules(): Promise<void> {
  const base: AlignConfig = session.alignConfig ?? { version: 1, templates: {}, pairs: [] }
  try {
    await ElMessageBox.confirm(
      `清除 ${keyL.value} ↔ ${keyR.value} 的全部人工配对与忽略规则？`,
      '确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await session.saveAlignConfig({
      version: 1,
      templates: base.templates,
      pairs: base.pairs.filter((p) => !(p.left === keyL.value && p.right === keyR.value))
    })
    ElMessage.success('已清除')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

// —— 网格点选：配对与表样范围两种模式共用同一次 cell-click 上报 ——

function onPickPair(row: number, col: number): void {
  rangeArmed.value = false
  rangeStart.value = null
  pickSource.value = { row, col, side: session.templateSide }
  ElMessage.info('请切换到另一侧，点击要配对的目标单元格')
}

function startRangePick(): void {
  pickSource.value = null
  rangeStart.value = null
  rangeArmed.value = true
  ElMessage.info(`请点击 ${templateKeyOf(session.activeTemplateWorkbook?.fileName ?? '')} 表样区域的左上角单元格`)
}

async function onCellClick(row: number, col: number): Promise<void> {
  if (pickSource.value) {
    await finishPair(row, col)
    return
  }
  if (rangeArmed.value) await finishRange(row, col)
}

async function finishPair(row: number, col: number): Promise<void> {
  const src = pickSource.value
  pickSource.value = null
  if (!src) return
  // 目标格必须在对侧：同侧点击不写规则，退出配对模式
  if (session.templateSide === src.side) {
    ElMessage.warning('请切换到另一侧，点击要配对的目标单元格')
    return
  }
  // 规则恒为 {left: R 系列键, right: NR 系列键}，from 指左侧格、to 指右侧格
  const rule: AlignPairRule =
    src.side === 'left'
      ? {
          left: keyL.value,
          right: keyR.value,
          fromRow: src.row,
          fromCol: src.col,
          toRow: row,
          toCol: col
        }
      : {
          left: keyL.value,
          right: keyR.value,
          fromRow: row,
          fromCol: col,
          toRow: src.row,
          toCol: src.col
        }
  const ok = await saveRules([rule])
  if (ok) ElMessage.success('已保存配对，下次核对自动生效')
}

async function finishRange(row: number, col: number): Promise<void> {
  if (!rangeStart.value) {
    // 第一次点击：记左上角，继续等右下角
    rangeStart.value = { row, col }
    ElMessage.info('已选左上角，请点击右下角单元格')
    return
  }
  const start = rangeStart.value
  rangeStart.value = null
  rangeArmed.value = false
  const key = templateKeyOf(session.activeTemplateWorkbook?.fileName ?? '')
  if (!key) return
  const ok = await saveRules([], key, {
    r1: Math.min(start.row, row),
    c1: Math.min(start.col, col),
    r2: Math.max(start.row, row),
    c2: Math.max(start.col, col)
  })
  if (ok) ElMessage.success(`已保存 ${key} 的表样范围`)
}
</script>

<template>
  <div class="template-panel">
    <div class="panel-toolbar">
      <el-button size="small" type="primary" plain @click="openSide('left')">
        左侧报表（R 系列）
      </el-button>
      <span class="file-label">{{ templateKeyOf(session.templateLeftPath) || '未选择' }}</span>
      <el-button size="small" type="primary" plain @click="openSide('right')">
        右侧报表（NR 系列）
      </el-button>
      <span class="file-label">{{ templateKeyOf(session.templateRightPath) || '未选择' }}</span>
      <span class="hint">相对差阈值（%）</span>
      <el-input-number
        v-model="thresholdPct"
        :min="0"
        :max="100"
        :step="0.01"
        :precision="4"
        size="small"
      />
      <el-button
        size="small"
        type="primary"
        :loading="session.loading"
        :disabled="!session.templateLeft.length || !session.templateRight.length"
        @click="session.runTemplateCheck()"
      >
        开始核对
      </el-button>
    </div>

    <div v-if="result" class="panel-toolbar">
      <span class="hint">表对</span>
      <el-select
        :model-value="session.templatePairIndex"
        size="small"
        class="pair-select"
        @update:model-value="onPairIndexChange"
      >
        <el-option v-for="o in pairOptions" :key="o.index" :label="o.label" :value="o.index" />
      </el-select>
      <el-radio-group :model-value="session.templateSide" size="small" @update:model-value="onSideChange">
        <el-radio-button value="left">左侧</el-radio-button>
        <el-radio-button value="right">右侧</el-radio-button>
      </el-radio-group>
      <el-button size="small" plain @click="startRangePick">手动指定表样范围</el-button>
      <el-button size="small" plain @click="clearTableRules">清除本表对人工规则</el-button>
      <span v-if="pair?.manualPairs" class="hint">已应用 {{ pair.manualPairs }} 条人工配对</span>
      <span v-if="pickHint" class="pick-hint">{{ pickHint }}</span>
      <span v-if="pairError" class="err-hint">{{ pairError }}</span>
    </div>

    <div v-if="result" class="panel-toolbar">
      <span class="hint">共 {{ result.totalDiffs }} 处差异</span>
      <span class="hint">未配对：</span>
      <el-select v-model="manualLeftId" size="small" class="mini-select" placeholder="左侧文件">
        <el-option v-for="w in unmatchedLeftOptions" :key="w.id" :label="w.fileName" :value="w.id" />
      </el-select>
      <el-select v-model="manualRightId" size="small" class="mini-select" placeholder="右侧文件">
        <el-option v-for="w in unmatchedRightOptions" :key="w.id" :label="w.fileName" :value="w.id" />
      </el-select>
      <el-button size="small" :disabled="!manualLeftId || !manualRightId" @click="addManualPair">
        指定为表对
      </el-button>
    </div>

    <el-table
      v-if="result"
      :data="diffRows"
      size="small"
      border
      height="220"
      highlight-current-row
      @current-change="onDiffCurrentChange"
    >
      <el-table-column label="表号" prop="tableNo" width="70" />
      <el-table-column label="项目路径" prop="diff.rowPath" min-width="220" show-overflow-tooltip />
      <el-table-column label="列" prop="diff.colPath" min-width="140" show-overflow-tooltip />
      <el-table-column label="左值" prop="diff.leftText" width="110" show-overflow-tooltip />
      <el-table-column label="右值" prop="diff.rightText" width="110" show-overflow-tooltip />
      <el-table-column label="相对差" width="100">
        <template #default="{ row }">
          {{ row.diff.relDiff === null ? '—' : (row.diff.relDiff * 100).toFixed(4) + '%' }}
        </template>
      </el-table-column>
      <el-table-column label="类型" width="140">
        <template #default="{ row }">
          <el-tag v-if="row.diff.kind === 'diff'" type="danger" size="small">差额</el-tag>
          <el-tag v-else type="warning" size="small">单侧有值</el-tag>
          <el-tag v-if="row.diff.manual" size="small" class="manual-tag">人工</el-tag>
        </template>
      </el-table-column>
      <el-table-column width="80">
        <template #default="{ row }">
          <el-button link size="small" type="danger" @click.stop="ignoreDiff(row.diff)">忽略</el-button>
        </template>
      </el-table-column>
    </el-table>

    <TemplateGrid
      v-if="result"
      @pick-pair="onPickPair"
      @ignore="ignoreAt"
      @cell-click="onCellClick"
    />

    <el-collapse v-if="result && onlyRows.length" class="only-collapse">
      <el-collapse-item :title="`仅单侧存在（${onlyRows.length} 项）`" name="only">
        <el-table :data="onlyRows" size="small" border max-height="260">
          <el-table-column label="表号" prop="tableNo" width="70" />
          <el-table-column label="侧" prop="side" width="50" />
          <el-table-column label="项目路径 / 列" prop="path" min-width="320" show-overflow-tooltip />
        </el-table>
      </el-collapse-item>
    </el-collapse>

    <el-empty v-if="!result" description="选择两套报表（zip）后点击「开始核对」" />
  </div>
</template>

<style scoped>
.template-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  overflow: auto;
  padding: 4px;
}
.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.file-label,
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pick-hint {
  font-size: 12px;
  color: #d6336c;
  font-weight: 600;
}
.err-hint {
  font-size: 12px;
  color: var(--el-color-danger);
}
.pair-select {
  width: 340px;
}
.mini-select {
  width: 200px;
}
.manual-tag {
  margin-left: 4px;
}
.only-collapse {
  margin-top: 4px;
}
</style>
