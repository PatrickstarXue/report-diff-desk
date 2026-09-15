<script setup lang="ts">
const emit = defineEmits<{ start: []; drag: [deltaY: number] }>()

function onDrag(event: MouseEvent): void {
  event.preventDefault()
  emit('start')
  const startY = event.clientY
  const body = document.body
  const onMove = (e: MouseEvent) => emit('drag', e.clientY - startY)
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    body.style.cursor = ''
    body.style.userSelect = ''
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  body.style.cursor = 'row-resize'
  body.style.userSelect = 'none'
}
</script>

<template>
  <div class="resize-bar" @mousedown="onDrag" />
</template>

<style scoped>
.resize-bar {
  flex-shrink: 0;
  height: 5px;
  cursor: row-resize;
  background: var(--el-border-color-lighter);
  transition: background 0.15s;
}
.resize-bar:hover {
  background: var(--el-color-primary-light-3);
}
.resize-bar:active {
  background: var(--el-color-primary);
}
</style>
