<script setup lang="ts">
defineProps<{ pct: number }>()
defineEmits<{ (e: 'reset'): void }>()
</script>

<template>
  <!-- 只在非 100% 时出现：既是当前档位，也是回 100% 的入口 -->
  <div
    v-if="pct !== 100"
    class="zoom-badge"
    title="点击回到 100%（Ctrl+滚轮缩放）"
    @click="$emit('reset')"
  >
    {{ pct }}%
  </div>
</template>

<style scoped>
.zoom-badge {
  position: absolute;
  top: 4px;
  right: 6px;
  z-index: 3;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 18px;
  color: #fff;
  background: rgba(64, 158, 255, 0.85);
  cursor: pointer;
  user-select: none;
}
.zoom-badge:hover {
  background: #409eff;
}
</style>
