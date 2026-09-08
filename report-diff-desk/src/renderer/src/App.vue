<script setup lang="ts">
// 布局占位：M3 起左侧文件面板 + 右侧结果标签页
</script>

<template>
  <el-container class="app-root">
    <el-header class="app-header">
      <span class="app-title">报表比对工具</span>
    </el-header>
    <el-main>
      <el-empty description="功能开发中" />
    </el-main>
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
  border-bottom: 1px solid var(--el-border-color);
}
.app-title {
  font-size: 16px;
  font-weight: 600;
}
</style>
