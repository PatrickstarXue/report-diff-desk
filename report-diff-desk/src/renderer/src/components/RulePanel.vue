<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSessionStore } from '../stores/session'
import RuleTable from './RuleTable.vue'

const session = useSessionStore()

const pair = computed(() => session.activeTemplatePair)
const draft = computed(() => session.activeRuleDraft)

/** 可编辑视图只在核对出结果后有；否则退回「已保存规则表」的只读预览 */
const editable = computed(() => !!pair.value && !!draft.value)

/** 已保存过规则表的表对键（用于没上传报表时的只读预览） */
const savedKeys = computed(() => Object.keys(session.alignConfig?.ruleTables ?? {}))

/** 只读预览当前选中的表对键 */
const previewKey = ref('')
watch(
  savedKeys,
  (keys) => {
    if (!keys.includes(previewKey.value)) previewKey.value = keys[0] ?? ''
  },
  { immediate: true }
)
const preview = computed(() => session.alignConfig?.ruleTables?.[previewKey.value] ?? null)

/** 只读预览时的「对侧已有值」集合 */
const rulesToSet = (t?: Record<string, string>): Set<string> =>
  new Set(Object.values(t ?? {}).map((s) => s.trim()).filter(Boolean))
const previewPeerRight = computed(() => rulesToSet(preview.value?.right))
const previewPeerLeft = computed(() => rulesToSet(preview.value?.left))

/** 某一侧的全部生效规则值（非空），用于把对侧已配上的格子标绿 */
function valuesOf(side: 'left' | 'right'): Set<string> {
  const d = draft.value
  const t = side === 'left' ? pair.value?.left : pair.value?.right
  const out = new Set<string>()
  if (!d || !t) return out
  for (const c of t.cells) {
    const v = d[side][`${c.row},${c.col}`]
    const rule = (v === undefined ? c.seed : v).trim()
    if (rule) out.add(rule)
  }
  return out
}

const peerOfLeft = computed(() => valuesOf('right'))
const peerOfRight = computed(() => valuesOf('left'))

/**
 * 初始化当前表对的规则表草稿：该表对有存档就直接用（缺席的位置用种子补齐）。
 * 不弹框问「恢复还是重新填充」——想按锚点重来，上方有「以锚点自动填充」按钮。
 */
function ensureDraft(): void {
  const key = session.activeRuleKey
  if (!key || session.ruleDrafts[key]) return
  session.initRuleDraft()
}

// 核对结果或表对变化后初始化草稿。用 watch 而非 onMounted：el-tab-pane 默认全部预渲染，
// 组件挂载时往往还没核对过，只靠 onMounted 会永远停在空态
watch(
  () => [session.activeRuleKey, session.templateResult, session.alignConfig] as const,
  () => ensureDraft(),
  { immediate: true }
)

function onEdit(key: 'left' | 'right', v: Record<string, string>): void {
  const d = draft.value
  if (!d) return
  session.ruleDrafts[session.activeRuleKey] = { ...d, [key]: v }
  session.ruleDirty = true
}

async function save(): Promise<void> {
  try {
    await session.saveRuleTable()
    ElMessage.success('规则已保存')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

/**
 * 以锚点自动填充：先用**当前填写的锚点词**重新解析两侧报表，再按新解析出的标签重建规则表。
 * 不重新解析的话，刚改的锚点词（还没点「开始核对」）根本不会生效。
 */
async function reseed(): Promise<void> {
  const words = session.effectiveAnchors.join('、')
  try {
    await ElMessageBox.confirm(
      `将按当前锚点词「${words}」重新解析两侧报表，并按解析出的标签重新生成规则表（丢弃人工修改与存档值）。继续？`,
      '确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await session.runTemplateCheck()
    session.reseedRuleTable()
    ElMessage.success('已按当前锚点词重新解析并填充')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

/** 把盘上存档的规则表调出来（覆盖草稿，写盘仍要点「保存规则」） */
async function restoreSaved(): Promise<void> {
  if (session.ruleDirty) {
    try {
      await ElMessageBox.confirm('当前有未保存的修改，恢复存档会丢弃它们。继续？', '确认', {
        type: 'warning'
      })
    } catch {
      return
    }
  }
  if (!session.restoreSavedRuleTable()) {
    ElMessage.info('本表对还没有保存过规则表')
    return
  }
  ElMessage.success('已恢复存档的规则表')
}
</script>

<template>
  <div class="rule-panel">
    <!-- 已核对：可编辑规则表 -->
    <template v-if="editable">
      <div class="rule-toolbar">
        <span class="hint">
          两侧规则值<strong>相同</strong>才参与比对；清空某格 = 该格不比对。规则值形如
          <strong>行规则值_列规则值</strong>，行首/列首的「批量」只改各自那一半。改动即时生效，点「保存规则」持久化。
        </span>
        <span v-if="session.ruleDirty" class="dirty">有未保存的修改</span>
        <el-button size="small" type="primary" @click="save">保存规则</el-button>
        <el-button size="small" plain @click="reseed">以锚点自动填充</el-button>
        <el-button size="small" plain @click="restoreSaved">恢复存档规则</el-button>
      </div>
      <div class="rule-tables">
        <RuleTable
          title="左侧（R 系列）"
          :cells="pair?.left?.cells ?? []"
          :model-value="draft!.left"
          :peer-values="peerOfLeft"
          @update:model-value="(v) => onEdit('left', v)"
        />
        <RuleTable
          title="右侧（NR 系列）"
          :cells="pair?.right?.cells ?? []"
          :model-value="draft!.right"
          :peer-values="peerOfRight"
          @update:model-value="(v) => onEdit('right', v)"
        />
      </div>
    </template>

    <!-- 未核对：只读预览已保存的规则表，方便确认规则确实存住了 -->
    <template v-else-if="savedKeys.length">
      <div class="rule-toolbar">
        <span class="hint">
          以下是<strong>已保存</strong>的规则表（只读）。上传两侧报表并核对后即可编辑。
        </span>
        <el-select v-model="previewKey" size="small" class="preview-select">
          <el-option v-for="k in savedKeys" :key="k" :label="k" :value="k" />
        </el-select>
      </div>
      <div v-if="preview" class="rule-tables">
        <RuleTable
          :title="`左侧（${previewKey.split('|')[0]}）`"
          :cells="[]"
          :model-value="preview.left"
          :peer-values="previewPeerRight"
          readonly
        />
        <RuleTable
          :title="`右侧（${previewKey.split('|')[1]}）`"
          :cells="[]"
          :model-value="preview.right"
          :peer-values="previewPeerLeft"
          readonly
        />
      </div>
    </template>

    <el-empty
      v-else
      description="还没有保存过任何规则表。上传两侧报表、核对后到本页维护并保存。"
    />
  </div>
</template>

<style scoped>
.rule-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 4px;
}
.rule-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.dirty {
  font-size: 12px;
  color: #d6336c;
  font-weight: 600;
}
.preview-select {
  width: 200px;
}
.rule-tables {
  display: flex;
  gap: 10px;
  min-width: 0;
}
</style>
