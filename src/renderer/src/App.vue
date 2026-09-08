<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStore } from './stores/session'
import FilePanel from './components/FilePanel.vue'
import DiffList from './components/DiffList.vue'

const session = useSessionStore()

const summary = computed(() => {
  const r = session.compareResult
  if (!r) return ''
  const extra =
    r.sheetsOnlyInBase.length || r.sheetsOnlyInCurr.length
      ? `；仅上期 ${r.sheetsOnlyInBase.length} 张、仅本期 ${r.sheetsOnlyInCurr.length} 张未参与比对`
      : ''
  return `${r.baseLabel} → ${r.currLabel}：${r.diffs.length} 处变动 / 共比对 ${r.totalCellsCompared} 格${extra}`
})
</script>

<template>
  <el-container class="app-root">
    <el-header class="app-header" height="48px">
      <span class="app-title">报表比对工具</span>
      <span class="app-summary">{{ summary }}</span>
    </el-header>
    <el-container>
      <el-aside width="260px" class="app-aside">
        <FilePanel />
      </el-aside>
      <el-main class="app-main">
        <DiffList v-if="session.compareResult" />
        <el-empty v-else description="选择上期与本期报表后点击「开始比对」" />
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
}
.app-aside {
  border-right: 1px solid var(--el-border-color);
}
.app-main {
  padding: 12px;
  overflow: hidden;
}
</style>
