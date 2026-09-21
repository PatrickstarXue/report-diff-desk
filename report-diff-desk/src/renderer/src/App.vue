<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useSessionStore } from './stores/session'
import FilePanel from './components/FilePanel.vue'
import DiffList from './components/DiffList.vue'
import SheetGrid from './components/SheetGrid.vue'
import MappingPanel from './components/MappingPanel.vue'
import DocViewer from './components/DocViewer.vue'
import OverviewPanel from './components/OverviewPanel.vue'
import TemplatePanel from './components/TemplatePanel.vue'

const session = useSessionStore()
const appVersion = ref('')

// 启动时恢复持久化口径文档库
onMounted(() => {
  void session.initDocLibrary()
  void window.api.getVersion().then((v) => (appVersion.value = v))
})

/** 概览卡选中的文件对索引（null = 全部），联动 DiffList 筛选 */
const overviewFilter = ref<number | null>(null)

async function exportResult(format: 'excel' | 'html'): Promise<void> {
  const r = session.compareResult
  if (!r) return
  try {
    // Pinia 响应式 Proxy 无法被 IPC 结构化克隆，先深拷贝为纯对象
    const res = await window.api.export({
      format,
      compare: JSON.parse(JSON.stringify(r)),
      basePath: session.basePath,
      currPath: session.currPath
    })
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
      <div class="app-export">
        <el-button
          size="small"
          type="primary"
          plain
          :disabled="!session.compareResult"
          @click="exportResult('excel')"
        >
          导出报表环比zip（Excel 原格式 + 紫色标记）
        </el-button>
        <el-button
          size="small"
          type="primary"
          plain
          :disabled="!session.compareResult"
          @click="exportResult('html')"
        >
          导出环比结果HTML
        </el-button>
      </div>
    </el-header>
    <el-container class="app-body">
      <el-aside width="260px" class="app-aside">
        <div class="app-aside-body">
          <FilePanel />
        </div>
        <div class="app-footer">
          <div>报表比对工具 v{{ appVersion }}</div>
          <div>©2026 CRB@xuehaotao</div>
        </div>
      </el-aside>
      <el-main class="app-main">
        <el-tabs v-model="session.uiTab" class="app-tabs">
          <el-tab-pane label="报表环比" name="grid">
            <SheetGrid />
          </el-tab-pane>
          <el-tab-pane label="环比结果概览" name="result">
            <template v-if="session.compareResult">
              <OverviewPanel
                :compare-result="session.compareResult"
                :active-index="overviewFilter"
                @select="(i) => (overviewFilter = i)"
              />
              <DiffList v-model:pair-filter="overviewFilter" />
            </template>
            <el-empty v-else description="选择上期与本期报表后点击「开始比对」" />
          </el-tab-pane>
          <el-tab-pane label="口径查询" name="mapping">
            <MappingPanel />
          </el-tab-pane>
          <el-tab-pane label="口径文档" name="doc">
            <DocViewer />
          </el-tab-pane>
          <el-tab-pane label="新旧表数据比对" name="template">
            <TemplatePanel />
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
/* 拖拽平移进行中：全局抓手光标并禁止选中文本 */
body.is-panning,
body.is-panning * {
  cursor: grabbing !important;
  user-select: none !important;
}
.app-root {
  height: 100vh;
  overflow: hidden;
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
.app-export {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.app-aside {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color);
}
.app-aside-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.app-footer {
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  border-top: 1px solid var(--el-border-color);
  text-align: center;
}
.app-main {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 12px;
}
.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
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
