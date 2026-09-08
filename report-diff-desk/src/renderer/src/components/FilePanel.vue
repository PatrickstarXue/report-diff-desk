<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const threshold = ref(50)

async function pickReport(role: 'base' | 'curr'): Promise<void> {
  const res = await window.api.openFile({ kind: 'report', title: role === 'base' ? '选择上期报表（Excel 或 zip 压缩包）' : '选择本期报表（Excel 或 zip 压缩包）' })
  if (res.canceled || !res.path) return
  try {
    await session.loadPair(role, res.path)
    const count = role === 'base' ? session.baseWorkbooks.length : session.currWorkbooks.length
    ElMessage.success(`已加载 ${count} 个 Excel，将按压缩包内顺序自动配对比对`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function compare(): Promise<void> {
  try {
    await session.runCompare(threshold.value)
    if (session.compareResult && session.compareResult.sheetsMatched.length === 0) {
      ElMessage.warning('两份报表没有名称匹配的工作表，请确认文件版本一致')
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
</script>

<template>
  <div class="file-panel">
    <div class="panel-title">报表选择</div>

    <div class="pick-row">
      <el-button size="small" @click="pickReport('base')">选择上期报表</el-button>
      <div class="pick-info" :title="session.basePath">{{ session.basePath || '未选择' }}</div>
      <div v-if="session.baseWorkbooks.length" class="pick-count">
        含 {{ session.baseWorkbooks.length }} 个 Excel
      </div>
    </div>

    <div class="pick-row">
      <el-button size="small" @click="pickReport('curr')">选择本期报表</el-button>
      <div class="pick-info" :title="session.currPath">{{ session.currPath || '未选择' }}</div>
      <div v-if="session.currWorkbooks.length" class="pick-count">
        含 {{ session.currWorkbooks.length }} 个 Excel
      </div>
    </div>

    <div class="threshold-row">
      <span class="threshold-label">变动阈值</span>
      <el-input-number v-model="threshold" :min="0" :max="1000" :step="5" size="small" />
      <span>%</span>
    </div>

    <el-button
      type="primary"
      class="compare-btn"
      :disabled="!session.baseWorkbooks.length || !session.currWorkbooks.length"
      :loading="session.loading"
      @click="compare"
    >
      开始比对
    </el-button>
  </div>
</template>

<style scoped>
.file-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}
.panel-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.pick-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pick-info {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pick-count {
  font-size: 12px;
  color: var(--el-color-primary);
}
.threshold-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.threshold-label {
  font-size: 13px;
}
.compare-btn {
  margin-top: 6px;
}
</style>
