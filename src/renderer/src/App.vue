<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useSessionStore } from './stores/session'
import FilePanel from './components/FilePanel.vue'
import DiffList from './components/DiffList.vue'
import SheetGrid from './components/SheetGrid.vue'
import MappingPanel from './components/MappingPanel.vue'
import DocViewer from './components/DocViewer.vue'

const session = useSessionStore()

const summary = computed(() => {
  const r = session.compareResult
  if (!r) return ''
  const extra =
    r.unmatchedBase.length || r.unmatchedCurr.length
      ? `；未参与比对：上期 ${r.unmatchedBase.length} 个、本期 ${r.unmatchedCurr.length} 个`
      : ''
  return `配对 ${r.pairs.length} 份文件：${r.totalDiffs} 处变动${extra}`
})

async function exportResult(format: 'excel' | 'html'): Promise<void> {
  const r = session.compareResult
  if (!r) return
  try {
    const res = await window.api.export({ format, compare: r })
    if (!res.canceled && res.path) {
      ElMessage.success(`已导出：${res.path}`)
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
</script>

<template>
  <el-container class="app-root">
    <el-header class="app-header" height="48px">
      <span class="app-title">报表比对工具</span>
      <span class="app-summary">{{ summary }}</span>
      <div class="app-export">
        <el-button
          size="small"
          type="primary"
          plain
          :disabled="!session.compareResult"
          @click="exportResult('excel')"
        >
          导出 Excel
        </el-button>
        <el-button
          size="small"
          type="primary"
          plain
          :disabled="!session.compareResult"
          @click="exportResult('html')"
        >
          导出 HTML
        </el-button>
      </div>
    </el-header>
    <el-container>
      <el-aside width="260px" class="app-aside">
        <FilePanel />
      </el-aside>
      <el-main class="app-main">
        <el-tabs v-model="session.uiTab" class="app-tabs">
          <el-tab-pane label="比对结果" name="result">
            <DiffList v-if="session.compareResult" />
            <el-empty v-else description="选择上期与本期报表后点击「开始比对」" />
          </el-tab-pane>
          <el-tab-pane label="网格高亮" name="grid">
            <SheetGrid />
          </el-tab-pane>
          <el-tab-pane label="口径查询" name="mapping">
            <MappingPanel />
          </el-tab-pane>
          <el-tab-pane label="口径文档" name="doc">
            <DocViewer />
          </el-tab-pane>
        </el-tabs>
      </el-main>
    </el-container>
  </el-container>
</template>

<style>
body {
  margin: 0;
}
.app-root {
  height: 100vh;
}
.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--el-border-color);
}
.app-title {
  font-size: 16px;
  font-weight: 600;
}
.app-summary {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.app-export {
  display: flex;
  gap: 8px;
}
.app-aside {
  border-right: 1px solid var(--el-border-color);
}
.app-main {
  padding: 12px;
  overflow: hidden;
}
.app-tabs {
  height: 100%;
}
.app-tabs .el-tabs__content {
  height: calc(100% - 40px);
}
.app-tabs .el-tab-pane {
  height: 100%;
}
</style>
