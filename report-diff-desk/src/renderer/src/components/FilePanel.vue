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
    // 这条只是确认收到文件，挡在上方会妨碍紧接着选另一侧；1s 后自动消失，也可手动关掉
    ElMessage.success({
      message: `已加载 ${count} 个 Excel，将按压缩包内顺序自动配对比对`,
      duration: 1000,
      showClose: true
    })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function compare(): Promise<void> {
  try {
    await session.runCompare(threshold.value)
    const r = session.compareResult
    if (r && r.pairs.length > 0 && r.pairs.every((p) => p.compare.sheetsMatched.length === 0)) {
      ElMessage.warning('配对文件中没有名称匹配的工作表，请确认文件版本一致')
    }
    // 从首页发起比对时停在这儿会让人以为没反应；从高亮显示页发起的留在原地
    if (session.uiTab === 'welcome' && r) session.uiTab = 'result'
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
</script>

<template>
  <div class="file-panel">
    <div class="pick-row">
      <el-button size="small" @click="pickReport('base')">选择上期报表</el-button>
      <span class="pick-info" :title="session.basePath">{{ session.basePath || '未选择' }}</span>
      <span v-if="session.baseWorkbooks.length" class="pick-count">
        含 {{ session.baseWorkbooks.length }} 个 Excel
      </span>
    </div>

    <div class="pick-row">
      <el-button size="small" @click="pickReport('curr')">选择本期报表</el-button>
      <span class="pick-info" :title="session.currPath">{{ session.currPath || '未选择' }}</span>
      <span v-if="session.currWorkbooks.length" class="pick-count">
        含 {{ session.currWorkbooks.length }} 个 Excel
      </span>
    </div>

    <div class="threshold-row">
      <span class="threshold-label">变动阈值</span>
      <el-input-number v-model="threshold" :min="0" :max="1000" :step="5" size="small" />
      <span class="threshold-label">%</span>
    </div>

    <el-button
      type="primary"
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
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--el-border-color);
}
.pick-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 340px;
  /* min-width:0 必须逐级给到省略号那一层，否则长路径会撑爆整行 */
  min-width: 0;
}
.file-panel :deep(.pick-row .el-button),
.file-panel :deep(.threshold-row .el-input-number),
.file-panel > .el-button {
  flex: none;
}
.pick-info {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pick-count {
  flex: none;
  font-size: 12px;
  color: var(--el-color-primary);
  white-space: nowrap;
}
.threshold-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.threshold-label {
  font-size: 13px;
  white-space: nowrap;
}
</style>
