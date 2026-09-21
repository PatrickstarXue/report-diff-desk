<script setup lang="ts">
import { computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSessionStore } from '../stores/session'
import RuleTable from './RuleTable.vue'

const session = useSessionStore()

const pair = computed(() => session.activeTemplatePair)
const draft = computed(() => session.activeRuleDraft)

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

// 核对结果或表对变化后初始化草稿。用 watch 而非 onMounted：el-tab-pane 默认全部预渲染，
// 组件挂载时往往还没核对过，只靠 onMounted 会永远停在空态
watch(
  () => [session.activeRuleKey, session.templateResult] as const,
  () => session.initRuleDraft(),
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

async function reseed(): Promise<void> {
  try {
    await ElMessageBox.confirm('丢弃对规则表的人工修改，按解析结果重新生成？', '确认', {
      type: 'warning'
    })
  } catch {
    return
  }
  session.reseedRuleTable()
  ElMessage.success('已恢复自动填充')
}
</script>

<template>
  <div class="rule-panel">
    <div v-if="!draft || !pair" class="rule-empty">
      <el-empty description="先选两套报表并核对，再在此维护规则表" />
    </div>
    <template v-else>
      <div class="rule-toolbar">
        <span class="hint">
          两侧规则值<strong>相同</strong>才参与比对；清空某格 = 该格不比对。改动即时生效，点「保存规则」持久化。
        </span>
        <span v-if="session.ruleDirty" class="dirty">有未保存的修改</span>
        <el-button size="small" type="primary" @click="save">保存规则</el-button>
        <el-button size="small" plain @click="reseed">恢复自动填充</el-button>
      </div>
      <div class="rule-tables">
        <RuleTable
          title="左侧（R 系列）"
          :cells="pair.left?.cells ?? []"
          :model-value="draft.left"
          :peer-values="peerOfLeft"
          @update:model-value="(v) => onEdit('left', v)"
        />
        <RuleTable
          title="右侧（NR 系列）"
          :cells="pair.right?.cells ?? []"
          :model-value="draft.right"
          :peer-values="peerOfRight"
          @update:model-value="(v) => onEdit('right', v)"
        />
      </div>
    </template>
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
.rule-tables {
  display: flex;
  gap: 10px;
  min-width: 0;
}
</style>
