<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import {
  DataAnalysis,
  Document,
  Expand,
  Fold,
  Grid,
  HomeFilled,
  Notebook,
  Search,
  Switch,
  TrendCharts
} from '@element-plus/icons-vue'
import { useSessionStore } from './stores/session'
import logoUrl from './assets/menulogo.png'
import FilePanel from './components/FilePanel.vue'
import SheetGrid from './components/SheetGrid.vue'
import MappingPanel from './components/MappingPanel.vue'
import DocViewer from './components/DocViewer.vue'
import ResultPanel from './components/ResultPanel.vue'
import TemplatePanel from './components/TemplatePanel.vue'
import WelcomePanel from './components/WelcomePanel.vue'

const session = useSessionStore()
const appVersion = ref('')

/** 分组 index 必须与任何子项 index 都不同：Element Plus 用祖先链逐个 open，撞名会让分组莫名展开 */
const GROUP_OF: Record<string, string> = {
  result: 'group-report',
  grid: 'group-report',
  mapping: 'group-mapping',
  doc: 'group-mapping'
}

const menuRef = ref<{ open: (index: string) => void } | null>(null)

/** 菜单收起：只显图标，子菜单改为右侧悬停弹窗 */
const collapsed = ref(false)

/**
 * default-active 变更只更新高亮，不会展开折叠的分组（展开只在挂载时的 initMenu 里做）。
 * 所以程序化跳转（明细点行 → grid、点单元格查口径 → mapping）必须手动把所在分组打开，
 * 否则高亮的是折叠组里看不见的子项，看着像点击没生效。
 *
 * 收起状态下不能调 open()——那时 isMenuPopup 为真，opened 会把右侧弹窗钉死在那儿。
 */
watch(
  () => session.uiTab,
  (tab) => {
    if (collapsed.value) return
    const group = GROUP_OF[tab]
    if (group) menuRef.value?.open(group) // 未知 index 会抛异常，所以只传确定存在的分组
  }
)

// 启动时恢复持久化口径文档库
onMounted(() => {
  void session.initDocLibrary()
  void window.api.getVersion().then((v) => (appVersion.value = v))
})

/**
 * 每次比对结果换新就 +1，作为 ResultPanel 的 key —— 重挂载即可让筛选/页码/排序/子标签
 * 一起归零，不必在子组件里再写一堆 watch。
 */
const resultRun = ref(0)
watch(
  () => session.compareResult,
  () => resultRun.value++
)
</script>

<template>
  <el-container class="app-root">
    <el-aside :width="collapsed ? '64px' : '220px'" class="app-aside">
        <div class="app-aside-top">
          <img v-show="!collapsed" class="app-logo" :src="logoUrl" alt="ReportDiffDesk" />
          <el-button
            link
            class="collapse-btn"
            :title="collapsed ? '展开菜单' : '收起菜单'"
            @click="collapsed = !collapsed"
          >
            <el-icon :size="18"><Expand v-if="collapsed" /><Fold v-else /></el-icon>
          </el-button>
        </div>
        <div class="app-aside-body">
          <!-- default-openeds 在 setup 时被读成一份拷贝，绑响应式没用，给静态初始值即可；
               default-active 是响应式的，程序化改 uiTab 会跟着高亮（分组展开见上面的 watch）。
               折叠后子菜单自动变成右侧悬停弹窗（isMenuPopup = vertical && collapse）。
               条目一律用 #title 插槽：折叠时 el-menu-item 把它当悬停提示、el-sub-menu 用它做弹窗触发区 -->
          <el-menu
            ref="menuRef"
            :default-active="session.uiTab"
            :default-openeds="['group-report', 'group-mapping']"
            :collapse="collapsed"
            :collapse-transition="false"
            class="app-menu"
            @select="(i: string) => { session.uiTab = i }"
          >
            <el-menu-item index="welcome">
              <el-icon><HomeFilled /></el-icon>
              <template #title>首页</template>
            </el-menu-item>

            <el-sub-menu index="group-report">
              <template #title>
                <el-icon><TrendCharts /></el-icon>
                <span>报表环比</span>
              </template>
              <el-menu-item index="result">
                <el-icon><DataAnalysis /></el-icon>
                <template #title>整体概览</template>
              </el-menu-item>
              <el-menu-item index="grid">
                <el-icon><Grid /></el-icon>
                <template #title>高亮显示</template>
              </el-menu-item>
            </el-sub-menu>

            <el-sub-menu index="group-mapping">
              <template #title>
                <el-icon><Search /></el-icon>
                <span>口径查询</span>
              </template>
              <el-menu-item index="mapping">
                <el-icon><Notebook /></el-icon>
                <template #title>Mapping口径</template>
              </el-menu-item>
              <el-menu-item index="doc">
                <el-icon><Document /></el-icon>
                <template #title>官方文档</template>
              </el-menu-item>
            </el-sub-menu>

            <el-menu-item index="template">
              <el-icon><Switch /></el-icon>
              <template #title>新旧表比对</template>
            </el-menu-item>
          </el-menu>
        </div>
        <!-- 收起后 64px 放不下两行文字，且版本号在首页 Hero 里也有 -->
        <div v-show="!collapsed" class="app-footer">
          <div>报表比对工具 v{{ appVersion }}</div>
          <div>©2026 CRB@xuehaotao</div>
        </div>
      </el-aside>
      <el-main class="app-main">
        <div class="app-content">
          <!-- 报表选择属于「报表环比」这一组，做成组内两个子页共用的横向条。
               只挂一份实例：threshold 是 FilePanel 的组件局部 state，两实例会各持一个阈值 -->
          <FilePanel v-show="session.uiTab === 'result' || session.uiTab === 'grid'" />
          <div class="app-panes">
            <div v-show="session.uiTab === 'welcome'" class="app-pane">
              <WelcomePanel :version="appVersion" />
            </div>
            <div v-show="session.uiTab === 'result'" class="app-pane">
              <!-- key 绑比对轮次：重比对时整块重挂载，筛选/页码/排序/子标签一起归零 -->
              <ResultPanel v-if="session.compareResult" :key="resultRun" />
              <el-empty v-else description="选择上期与本期报表后点击「开始比对」" />
            </div>
            <div v-show="session.uiTab === 'grid'" class="app-pane">
              <SheetGrid />
            </div>
            <div v-show="session.uiTab === 'template'" class="app-pane">
              <TemplatePanel />
            </div>
            <div v-show="session.uiTab === 'mapping'" class="app-pane">
              <MappingPanel />
            </div>
            <div v-show="session.uiTab === 'doc'" class="app-pane">
              <DocViewer />
            </div>
          </div>
        </div>
      </el-main>
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
.app-aside {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color);
  /* 收起/展开时宽度跟着动，给个过渡免得跳 */
  transition: width 0.2s;
}
.app-aside-top {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
/* 原图白底，和侧栏同色；按原始比例（约 4.45:1）定高自适应宽。
   max-width 给右侧按钮留位——不设的话两者会贴到一起 */
.app-logo {
  display: block;
  height: 28px;
  width: auto;
  max-width: calc(100% - 76px);
  object-fit: contain;
}
/* 绝对定位到右侧，就不会把居中的 logo 挤偏 */
.collapse-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
}
/* 收起后 logo 隐藏、只剩按钮，回到常规流里居中 */
.app-aside:has(.el-menu--collapse) .collapse-btn {
  position: static;
  transform: none;
}
.app-aside-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.app-menu {
  /* aside 自身已有 border-right，菜单默认那条会变成双线 */
  border-right: none;
}
/* 这个 style 块是**非 scoped** 的（因为要写 body 的全局规则），所以这里不能用 :deep()——
   它只在 scoped CSS 里会被编译，此处会原样输出成无效选择器，整条规则被浏览器丢弃。用普通选择器即可。 */
/* .el-sub-menu__title 复用同一套 menu-item mixin，默认也是 56px，原有的 .el-menu-item 规则管不到它 */
.app-menu .el-menu-item,
.app-menu .el-sub-menu__title {
  height: 46px;
  line-height: 46px;
}
/* 纵向模式下 Element Plus 只给 active 改字色、不给背景，hover 反而比选中更显眼——自己补上 */
.app-menu .el-menu-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
/* 纵向模式下分组标题没有激活态样式（源码里只改 border-bottom-color，竖向看不见） */
.app-menu .el-sub-menu.is-active > .el-sub-menu__title {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
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
.app-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}
/* 高度全靠 flex 传递，不依赖百分比解析；面板自身根元素都是 height:100% 的 flex 列 */
.app-panes {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.app-pane {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
