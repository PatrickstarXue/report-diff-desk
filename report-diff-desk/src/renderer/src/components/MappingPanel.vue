<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { lookup } from '@shared/core/mapping'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const manualQuery = ref('')

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
</script>

<template>
  <div class="mapping-panel">
    <div class="mapping-toolbar">
      <el-button size="small" @click="importMapping">导入映射表</el-button>
      <span v-if="session.mappingCount" class="mapping-count">
        已收录 {{ session.mappingCount }} 条口径
      </span>
      <el-input
        v-model="manualQuery"
        size="small"
        class="manual-input"
        placeholder="手动输入指标名查询"
        clearable
      />
    </div>

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
  padding: 4px;
}
.mapping-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mapping-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.manual-input {
  width: 260px;
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
</style>
