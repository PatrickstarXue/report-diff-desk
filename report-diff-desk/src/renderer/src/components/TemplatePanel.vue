<script setup lang="ts">
import { computed, onMounted, ref, watch, type WritableComputedRef } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { HeaderRange, TemplateDiff, TemplateSheet } from '@shared/types'
import { templateKeyOf } from '@shared/core/template'
import { colLetter } from '@shared/core/sheet-view'
import { useSessionStore } from '../stores/session'
import { DEFAULT_TEMPLATE_COLORS } from '../utils/templateColors'
import TemplateGrid from './TemplateGrid.vue'
import RulePanel from './RulePanel.vue'

const session = useSessionStore()

/** 阈值输入用百分数（0.01 = 0.01%），与现有环比比对一致 */
const thresholdPct = ref(0.01)

/** 标记配色：清空时 el-color-picker 会 emit 空值，兜回默认色，避免网格背景失效 */
function colorProxy(key: 'diff' | 'compared'): WritableComputedRef<string> {
  return computed({
    get: () => session.templateColors[key],
    set: (v) => {
      session.templateColors[key] = v || DEFAULT_TEMPLATE_COLORS[key]
    }
  })
}
const diffColor = colorProxy('diff')
const comparedColor = colorProxy('compared')

/** 改色只重绘，不重新核对 */
async function onColorsChange(): Promise<void> {
  try {
    await session.saveTemplateSettings()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

/** 子标签页：比对结果 | 对比规则 */
const subTab = ref('result')

/** 差异列表默认展开；只想看下方网格标色时收起它 */
const openPanels = ref<string[]>(['diffs'])

/** 面板滚到非顶部时给吸顶条加分隔与投影，未滚动则保持无缝 */
const panelRef = ref<HTMLElement | null>(null)
const stuck = ref(false)
function onPanelScroll(): void {
  stuck.value = (panelRef.value?.scrollTop ?? 0) > 0
}

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
  (result.value?.pairs ?? []).map((p, i) => {
    // 规则表存档键与 session.activeRuleKey 的拼法保持一致，删除时才能对上
    const key = `${templateKeyOf(p.leftFile)}|${templateKeyOf(p.rightFile)}`
    return {
      index: i,
      key,
      hasSavedRule: !!session.alignConfig?.ruleTables?.[key],
      label: `${p.tableNo ?? '?'}：${templateKeyOf(p.leftFile)} ↔ ${templateKeyOf(p.rightFile)}`
    }
  })
)

/**
 * 删除某个表对已存档的规则表（下拉框里的垃圾桶）。
 * 只删存档与内存草稿，不动报表文件本身；删完重新核对，该表对回到解析种子。
 */
async function onDeleteSavedRule(o: { key: string; label: string }): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `将删除表对「${o.label}」已保存的规则表（人工对齐与存档值一并丢弃），删除后按当前解析结果重新生成。继续？`,
      '删除存档规则',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    if (!(await session.deleteRuleTable(o.key))) {
      ElMessage.info('该表对没有存档规则')
      return
    }
    ElMessage.success('已删除该表对的存档规则')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

/** 解析失败的表提示（两侧任一侧有 error 就显示） */
const pairError = computed(() => pair.value?.left?.error ?? pair.value?.right?.error ?? '')

/** 锚点未识别、已按行列位置降级解析：种子是「第N行_列字母」，需人工在规则表里对齐 */
const degradedHint = computed(() =>
  pair.value?.left?.degraded || pair.value?.right?.degraded
    ? `该表对有一侧没能识别到锚点词「${session.effectiveAnchors.join('、')}」——可用网格上方「设置表头范围」直接框选表头块；或把该报表标签区最右那列表头用的词（如「机构类别」）加到上方「锚点词」里再核对一次；否则已按行列位置降级解析（规则值形如「第6行_D」），到「对比规则」页人工对齐。`
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

/** 锚点词改动落盘（失焦 / 回车触发）；配置没读进来时 saveTemplateSettings 静默跳过 */
async function onAnchorChange(): Promise<void> {
  try {
    await session.saveTemplateSettings()
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
  pickMode.value = false
}

function onSideChange(v: string | number | boolean | undefined): void {
  if (v !== 'left' && v !== 'right') return
  session.templateSide = v
  session.templateFocus = null
  pickMode.value = false
}

// —— 表头范围（作用于当前侧） ——

const pickMode = ref(false)
const pickedRange = ref<HeaderRange | null>(null)

const activeSheet = computed(() =>
  session.templateSide === 'left' ? pair.value?.left : pair.value?.right
)
const savedHeaderRange = computed(() => session.activeHeaderRange)
const headerSourceLabel = computed(() => {
  const s = activeSheet.value?.headerSource
  return s === 'manual' ? '已手动设置' : s === 'auto' ? '自动识别' : s === 'degraded' ? '未识别（降级）' : '—'
})
const headerSourceType = computed(() => {
  const s = activeSheet.value?.headerSource
  return s === 'manual' ? 'success' : s === 'degraded' ? 'warning' : 'info'
})

/** 进入框选：有存档用存档，否则预填当前自动解析出的范围 */
function openPick(): void {
  pickedRange.value = savedHeaderRange.value ?? activeSheet.value?.headerRange ?? null
  pickMode.value = true
}
function cancelPick(): void {
  pickMode.value = false
}
function onSelectRange(r: HeaderRange): void {
  pickedRange.value = r
}
async function applyRange(): Promise<void> {
  if (!pickedRange.value) return
  try {
    await session.saveHeaderRange({ ...pickedRange.value })
    pickMode.value = false
    ElMessage.success('表头范围已保存')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
async function resetRange(): Promise<void> {
  try {
    await session.saveHeaderRange(null)
    pickMode.value = false
    ElMessage.success('已恢复为自动识别')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
</script>

<template>
  <div ref="panelRef" class="template-panel" @scroll.passive="onPanelScroll">
    <!-- 顶部工具条整块吸顶：面板内容另有一层滚动，滚动时这些操作保持可见 -->
    <div class="template-head" :class="{ 'is-stuck': stuck }">
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
        <span class="hint">标记颜色</span>
        <span class="hint">超阈值</span>
        <el-color-picker
          v-model="diffColor"
          size="small"
          :clearable="false"
          @change="onColorsChange"
        />
        <span class="hint">参与比对</span>
        <el-color-picker
          v-model="comparedColor"
          size="small"
          :clearable="false"
          @change="onColorsChange"
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
          锚点词 = 表格<strong>标签区最右那一列表头</strong>的文字（常见「项目」，有的报表是「机构类别」）。工具以这格所在<strong>合并范围</strong>定标签列右界，并向上扩展到表头块顶行；锚点词都没命中时按行列位置降级解析，此时可用网格上方「设置表头范围」直接框选表头块。
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
          <el-option v-for="o in pairOptions" :key="o.index" :label="o.label" :value="o.index">
            <span class="pair-option">
              <span class="pair-option-label">{{ o.label }}</span>
              <!-- 该表对存过规则表才出现垃圾桶；stop 掉点击，避免顺带选中这一项 -->
              <span
                v-if="o.hasSavedRule"
                class="pair-option-del"
                title="删除该表对的存档规则"
                @click.stop.prevent="onDeleteSavedRule(o)"
                @mousedown.stop.prevent
              >
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path
                    d="M2.5 4.5h11M6 4.5V3.2c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7v1.3M4 4.5l.6 8.6c0 .4.4.7.8.7h5.2c.4 0 .8-.3.8-.7l.6-8.6M6.5 7v4.5M9.5 7v4.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
            </span>
          </el-option>
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
        <!-- 未配对指定表对：与「表对」同一行，靠右 -->
        <span class="pair-unmatched">
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
        </span>
      </div>

      <!-- 视图切换跟着顶部一起吸顶，内容滚动时不受影响 -->
      <div class="panel-toolbar">
        <span class="hint">视图</span>
        <el-radio-group v-model="subTab" size="small">
          <el-radio-button value="result">比对结果</el-radio-button>
          <el-radio-button value="rules">对比规则</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <div v-show="subTab === 'result'">
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
          说明锚点左边的标签列取少了——引擎把锚点右边那一列当成了数据列（锚点格的合并范围没盖到最后一个标签列）。请把上方「锚点词」改成该报表<b>标签区最右那一列表头</b>的文字，再点「开始核对」。
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

      <div v-if="result" class="panel-toolbar">
        <span class="hint">表头范围（当前侧）</span>
        <el-tag size="small" :type="headerSourceType">{{ headerSourceLabel }}</el-tag>
        <template v-if="!pickMode">
          <el-button size="small" @click="openPick">设置表头范围</el-button>
          <el-button v-if="savedHeaderRange" size="small" plain @click="resetRange">
            重置为自动
          </el-button>
        </template>
        <template v-else>
          <span class="hint">在网格上拖拽框选表头块（行头列 + 表头行），松手即预览</span>
          <el-button size="small" type="primary" :disabled="!pickedRange" @click="applyRange">
            应用
          </el-button>
          <el-button size="small" plain @click="cancelPick">取消</el-button>
        </template>
      </div>

      <TemplateGrid
        v-if="result"
        :selecting="pickMode"
        :prefill="pickedRange"
        @select-range="onSelectRange"
      />

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
    </div>

    <div v-show="subTab === 'rules'">
      <RulePanel />
    </div>
  </div>
</template>

<style scoped>
.template-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  overflow: auto;
  /* 顶部不留内边距：吸顶条底色直达面板顶端，滚动时上方不会漏出内容形成第二条缝 */
  padding: 0 4px 4px;
}
/* 整块顶部工具条吸顶：面板自身是滚动容器，内容滚动时这些操作保持可见。
   必须给不透明背景，否则滚到底下会被内容透出。 */
.template-head {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
  background: var(--el-bg-color, #fff);
  transition: box-shadow 0.18s ease;
}
/* 滚到非顶部才浮起来：1px 发丝线用 box-shadow 画（不占位，避免 1px 跳动）+ 一层柔影 */
.template-head.is-stuck {
  box-shadow:
    0 1px 0 var(--el-border-color-lighter),
    0 6px 8px -6px rgb(0 0 0 / 18%);
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
/* 表对下拉项：标签占满左侧，存档规则存在时右侧给一个垃圾桶 */
.pair-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.pair-option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pair-option-del {
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--el-text-color-placeholder);
  cursor: pointer;
}
.pair-option-del:hover {
  color: var(--el-color-danger);
}
/* 未配对指定表对：贴住「表对」那一行的右端 */
.pair-unmatched {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
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
