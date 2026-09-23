<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { useSessionStore } from '../stores/session'

const props = defineProps<{ format: 'excel' | 'html' }>()

const session = useSessionStore()

async function run(): Promise<void> {
  const r = session.compareResult
  if (!r) return
  try {
    // Pinia 响应式 Proxy 无法被 IPC 结构化克隆，先深拷贝为纯对象
    const res = await window.api.export({
      format: props.format,
      compare: JSON.parse(JSON.stringify(r)),
      basePath: session.basePath,
      currPath: session.currPath
    })
    if (!res.canceled && res.path) {
      ElMessage.success(`已导出：${res.path}`)
      // 源里有 .xls 时 main 会带回一条说明（字体/居中/边框无法保留）
      if (res.note) ElMessage.warning({ message: res.note, duration: 10000 })
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
</script>

<template>
  <el-button
    size="small"
    type="primary"
    plain
    :disabled="!session.compareResult"
    :title="format === 'excel' ? '导出高亮显示 zip（Excel 原格式 + 变动格紫色标记）' : '导出整体概览 HTML 报告'"
    @click="run"
  >
    导出结果
  </el-button>
</template>
