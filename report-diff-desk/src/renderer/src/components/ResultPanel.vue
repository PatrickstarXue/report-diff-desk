<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessionStore } from '../stores/session'
import OverviewPanel from './OverviewPanel.vue'
import DiffList from './DiffList.vue'
import ExportResultButton from './ExportResultButton.vue'

const session = useSessionStore()

const subTab = ref<'overview' | 'detail'>('overview')
/** null = 全部文件对；点总览卡片设置 */
const pairFilter = ref<number | null>(null)

/**
 * 卡片选中：非 null 直接切到明细看筛选结果（原来卡片下方就是明细表，筛选结果本来就该看得见）；
 * 取消选中（点已高亮的卡片）只清筛选，留在总览——点"取消"却跳走会很突兀。
 */
function onSelectCard(index: number | null): void {
  pairFilter.value = index
  if (index !== null) subTab.value = 'detail'
}

const result = computed(() => session.compareResult)
</script>

<template>
  <div v-if="result" class="result-panel">
    <!-- 叠在子标签栏右侧：只两个子标签且左对齐，不会打架，也不额外占一行高度 -->
    <ExportResultButton format="html" class="result-export" />
    <el-tabs v-model="subTab" class="result-subtabs">
      <el-tab-pane label="总览" name="overview">
        <!-- 卡片网格高度不限，必须由它自己滚 -->
        <div class="subtab-scroll">
          <OverviewPanel
            :compare-result="result"
            :active-index="pairFilter"
            @select="onSelectCard"
          />
        </div>
      </el-tab-pane>
      <el-tab-pane label="明细" name="detail">
        <!-- 只给高度：Flex 列布局由 DiffList 自己的根元素承担 -->
        <div class="subtab-fill">
          <DiffList v-model:pair-filter="pairFilter" />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.result-panel {
  position: relative; /* 导出按钮的定位基准 */
  display: flex;
  flex-direction: column;
  height: 100%;
}
/* top:8px = 子标签栏 40px 减去 small 按钮 24px 后居中 */
.result-export {
  position: absolute;
  top: 8px;
  right: 0;
  z-index: 1;
}
/*
 * 高度链路：不要用 calc(100% - var(--el-tabs-header-height))——.el-tabs__header 还带
 * margin-bottom:15px，那样会少算 15px，只是被 flex 收缩掩盖了。这里由 .result-panel
 * 自己显式接管 flex、构成完整的高度链路，不依赖外层容器给百分比。
 */
.result-panel :deep(.el-tabs) {
  flex: 1 1 0;
  min-height: 0;
}
.result-panel :deep(.el-tabs__content) {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
}
.result-panel :deep(.el-tab-pane) {
  height: 100%;
}
.subtab-scroll {
  height: 100%;
  overflow: auto;
}
.subtab-fill {
  height: 100%;
}
</style>
