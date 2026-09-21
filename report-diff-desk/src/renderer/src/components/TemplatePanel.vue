<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { TemplateDiff, TemplateSheet } from '@shared/types'
import { templateKeyOf } from '@shared/core/template'
import { colLetter } from '@shared/core/sheet-view'
import { useSessionStore } from '../stores/session'
import TemplateGrid from './TemplateGrid.vue'
import RulePanel from './RulePanel.vue'

const session = useSessionStore()

/** 阈值输入用百分数（0.01 = 0.01%），与现有环比比对一致 */
const thresholdPct = ref(0.01)

/** 子标签页：比对结果 | 对比规则 */
const subTab = ref('result')

/** 差异列表默认展开；只想看下方网格标色时收起它 */
const openPanels = ref<string[]>(['diffs'])

onMounted(() => {
  session.reloadAlignConfig().catch(() => {
    ElMessage.error('规则表配置读取失败，本次会话请勿保存规则以免覆盖')
  })
})

watch(thresholdPct, (v) => {
  session.templateThreshold = Math.max(0, v) / 100
})

const result = computed(() => session.templateResult)
const pair = computed(() => session.activeTemplatePair)

/** 差异拍平成一张表，带表对索引 */
const diffRows = computed(() => {
  const out: { key: string; tableNo: string; diff: TemplateDiff; pairIndex: number }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const d of p.diffs) {
      out.push({
        key: `${pi}|${d.leftRow},${d.leftCol}|${d.rule}`,
        tableNo: p.tableNo ?? '—',
        diff: d,
        pairIndex: pi
      })
    }
  })
  return out
})

/** 未配上的规则值（到「对比规则」页把两侧改成一致，或清空该格） */
const onlyRows = computed(() => {
  const out: { key: string; tableNo: string; side: string; rule: string }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const e of p.onlyInLeft) {
      out.push({
        key: `${pi}|L|${e.cell.row},${e.cell.col}`,
        tableNo: p.tableNo ?? '—',
        side: '左',
        rule: e.rule
      })
    }
    for (const e of p.onlyInRight) {
      out.push({
        key: `${pi}|R|${e.cell.row},${e.cell.col}`,
        tableNo: p.tableNo ?? '—',
        side: '右',
        rule: e.rule
      })
    }
  })
  return out
})

/** 规则值重复（同值在一侧出现多次 → 该值整体不配对） */
const dupRows = computed(() => {
  const out: { key: string; tableNo: string; side: string; rule: string; count: number }[] = []
  ;(result.value?.pairs ?? []).forEach((p, pi) => {
    for (const e of p.duplicateRules) {
      out.push({
        key: `${pi}|${e.side}|${e.rule}`,
        tableNo: p.tableNo ?? '—',
        side: e.side === 'left' ? '左' : '右',
        rule: e.rule,
        count: e.count
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

/** 锚点未识别、已按行列位置降级解析：种子是「第N行_列字母」，需人工在规则表里对齐 */
const degradedHint = computed(() =>
  pair.value?.left?.degraded || pair.value?.right?.degraded
    ? `该表对有一侧没能识别到锚点词「${session.effectiveAnchors.join('、')}」——若这份报表的标签区右下角用的是别的词（如「机构类别」），把它加到上方「锚点词」里再核对一次；否则已按行列位置降级解析（规则值形如「第6行_D」），到「对比规则」页人工对齐。`
    : ''
)

/** 两侧锚点命中的位置（Excel 记法，如 C4）；降级侧标注未识别到 */
const anchorPos = computed(() => {
  const p = pair.value
  if (!p) return ''
  if (!p.left?.anchor && !p.right?.anchor) return ''
  const at = (t: TemplateSheet | null | undefined, name: string): string => {
    const a = t?.anchor
    return a ? `${name}「${a.word}」(${colLetter(a.col)}${a.row + 1})` : `${name} 未识别到`
  }
  return `锚点命中位置：${at(p.left, '左侧')}，${at(p.right, '右侧')}`
})

/** 锚点词改动落盘（失焦 / 回车触发）；配置没读进来时 saveAnchors 静默跳过 */
async function onAnchorChange(): Promise<void> {
  try {
    await session.saveAnchors()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

/** 该表对一格都没配上，需要到规则表里把两侧规则值改一致 */
const noAutoPairHint = computed(() => {
  const p = pair.value
  if (!p) return false
  return p.totalCompared === 0 && (p.onlyInLeft.length > 0 || p.onlyInRight.length > 0)
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

/** 核对入口统一兜底：配置损坏时 loadAlignConfig 会抛错，不 catch 会让按钮看起来毫无反应 */
async function runCheck(): Promise<void> {
  try {
    await session.runTemplateCheck()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ElMessage.error(
      // 仅配置读取/解析失败需要告诉用户如何恢复；其它核对错误（未选报表等）原样提示
      msg.includes('人工规则配置')
        ? `${msg}；可删除 userData/template-align.json 后重试`
        : msg
    )
  }
}

async function addManualPair(): Promise<void> {
  if (!manualLeftId.value || !manualRightId.value) return
  session.manualTablePairs = [
    ...session.manualTablePairs,
    { leftId: manualLeftId.value, rightId: manualRightId.value }
  ]
  manualLeftId.value = ''
  manualRightId.value = ''
  await runCheck()
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
        class="run-check"
        size="small"
        type="primary"
        :loading="session.loading"
        :disabled="!session.templateLeft.length || !session.templateRight.length"
        @click="runCheck"
      >
        开始核对
      </el-button>
    </div>

    <div class="panel-toolbar">
      <span class="hint">锚点词</span>
      <el-input-tag
        v-model="session.anchors"
        size="small"
        class="anchor-input"
        placeholder="项目"
        @change="onAnchorChange"
      />
      <span class="hint anchor-hint">
        锚点 = 报表标签区<strong>右下角</strong>那一格的文字（如「项目」「机构类别」）。可加多个，每份报表各取自己命中的那个；一个都没命中就按行列位置降级解析，到「对比规则」页人工对齐。
      </span>
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
      <el-radio-group
        :model-value="session.templateSide"
        size="small"
        @update:model-value="onSideChange"
      >
        <el-radio-button value="left">左侧</el-radio-button>
        <el-radio-button value="right">右侧</el-radio-button>
      </el-radio-group>
      <span v-if="pairError" class="err-hint">{{ pairError }}</span>
    </div>

    <el-tabs v-model="subTab" class="template-subtabs">
      <el-tab-pane label="比对结果" name="result">
        <div v-if="result" class="panel-toolbar">
          <span class="hint">未配对：</span>
          <el-select v-model="manualLeftId" size="small" class="mini-select" placeholder="左侧文件">
            <el-option
              v-for="w in unmatchedLeftOptions"
              :key="w.id"
              :label="w.fileName"
              :value="w.id"
            />
          </el-select>
          <el-select v-model="manualRightId" size="small" class="mini-select" placeholder="右侧文件">
            <el-option
              v-for="w in unmatchedRightOptions"
              :key="w.id"
              :label="w.fileName"
              :value="w.id"
            />
          </el-select>
          <el-button size="small" :disabled="!manualLeftId || !manualRightId" @click="addManualPair">
            指定为表对
          </el-button>
        </div>

        <el-alert
          v-if="noAutoPairHint"
          type="warning"
          show-icon
          :closable="false"
          title="本表对没有任何单元格配对成功"
        >
          <template #default>
            两侧的规则值没有任何一对是相同的（通常是某几行缺少父级标签）。
            请切到「对比规则」页，把要比较的两侧规则值改成一致；配一次整行即可生效。
          </template>
        </el-alert>

        <el-alert
          v-if="degradedHint"
          type="info"
          show-icon
          :closable="false"
          :title="degradedHint"
        />

        <el-alert
          v-if="dupRows.length"
          type="warning"
          show-icon
          :closable="false"
          :title="`规则值重复 ${dupRows.length} 项，可能是锚点没落在最后一个标签列`"
        >
          <template #default>
            同一个规则值在一侧出现多次时，该值整体不参与比对。若某个标签维度被挤掉了（比如同一期限下几家机构算成了同一个值），
            说明锚点左边的标签列取少了——引擎把锚点右边那一列当成了数据列。请把上方「锚点词」改成该报表标签区<b>右下角</b>那一格的文字，再点「开始核对」。
            <div v-if="anchorPos" class="anchor-pos">{{ anchorPos }}</div>
          </template>
        </el-alert>

        <el-collapse v-if="result" v-model="openPanels" class="only-collapse">
          <el-collapse-item :title="`差异（共 ${result.totalDiffs} 处）`" name="diffs">
            <el-table
              :data="diffRows"
              size="small"
              border
              height="220"
              highlight-current-row
              @current-change="onDiffCurrentChange"
            >
              <el-table-column label="表号" prop="tableNo" width="70" />
              <el-table-column
                label="规则值"
                prop="diff.rule"
                min-width="360"
                show-overflow-tooltip
              />
              <el-table-column label="左值" prop="diff.leftText" width="110" show-overflow-tooltip />
              <el-table-column
                label="右值"
                prop="diff.rightText"
                width="110"
                show-overflow-tooltip
              />
              <el-table-column label="相对差" width="100">
                <template #default="{ row }">
                  {{ row.diff.relDiff === null ? '—' : (row.diff.relDiff * 100).toFixed(4) + '%' }}
                </template>
              </el-table-column>
              <el-table-column label="类型" width="110">
                <template #default="{ row }">
                  <el-tag v-if="row.diff.kind === 'diff'" type="danger" size="small">差额</el-tag>
                  <el-tag v-else type="warning" size="small">单侧有值</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>

        <TemplateGrid v-if="result" />

        <el-collapse v-if="result && dupRows.length" class="only-collapse">
          <el-collapse-item :title="`规则值重复（${dupRows.length} 项，不参与比对）`" name="dup">
            <div class="only-hint">
              同一个规则值在一侧出现多次时该值整体不参与比对，请把它们改成各自唯一的值。
            </div>
            <el-table :data="dupRows" size="small" border max-height="200">
              <el-table-column label="表号" prop="tableNo" width="70" />
              <el-table-column label="侧" prop="side" width="50" />
              <el-table-column label="规则值" prop="rule" min-width="320" show-overflow-tooltip />
              <el-table-column label="出现次数" prop="count" width="90" />
            </el-table>
          </el-collapse-item>
        </el-collapse>

        <el-collapse v-if="result && onlyRows.length" class="only-collapse">
          <el-collapse-item :title="`未配上（${onlyRows.length} 项）`" name="only">
            <div class="only-hint">
              两侧规则值一致才会比对。请到「对比规则」页把它们改成一致；不想比对就把该格清空。
            </div>
            <el-table :data="onlyRows" size="small" border max-height="260">
              <el-table-column label="表号" prop="tableNo" width="70" />
              <el-table-column label="侧" prop="side" width="50" />
              <el-table-column label="规则值" prop="rule" min-width="320" show-overflow-tooltip />
            </el-table>
          </el-collapse-item>
        </el-collapse>

        <el-empty v-if="!result" description="选择两套报表（zip）后点击「开始核对」" />
      </el-tab-pane>

      <el-tab-pane label="对比规则" name="rules">
        <RulePanel />
      </el-tab-pane>
    </el-tabs>
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
.anchor-input {
  width: 260px;
}
/* 开始核对固定在第一行最右 */
.run-check {
  margin-left: auto;
}
/* 锚点说明：跟着输入框排，窄窗口下自然换行 */
.anchor-hint {
  flex: 1;
  min-width: 240px;
  line-height: 1.6;
}
.only-collapse {
  margin-top: 4px;
}
.only-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 4px 0;
}
.anchor-pos {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
</style>
