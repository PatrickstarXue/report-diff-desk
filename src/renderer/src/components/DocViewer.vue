<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSessionStore } from '../stores/session'
import PdfViewer from './PdfViewer.vue'

const session = useSessionStore()

/** PDF 文档列表（仅 kind=pdf，口径查询页管理 xlsx/xls） */
const pdfDocs = computed(() =>
  session.docList.map((d, i) => ({ i, d })).filter(({ d }) => d.kind === 'pdf')
)

const activePdfIndex = ref<number | null>(null)

const doc = computed(() => {
  if (activePdfIndex.value === null) return null
  return session.docList[activePdfIndex.value] ?? null
})

// 同步当前 PDF 到文档库 activeDocIndex（不影响口径查询页）
watch(
  () => session.activeDocIndex,
  (idx) => {
    const d = session.docList[idx]
    if (d?.kind === 'pdf') activePdfIndex.value = idx
  },
  { immediate: true }
)

// 文档列表变化后若选中失效则选第一个 PDF
watch(pdfDocs, (docs) => {
  if (activePdfIndex.value === null || !docs.some((x) => x.i === activePdfIndex.value)) {
    activePdfIndex.value = docs[0]?.i ?? null
  }
})

async function importPdf(): Promise<void> {
  const res = await window.api.openFile({ kind: 'doc', title: '选择口径文档（PDF）' })
  if (res.canceled || !res.path) return
  try {
    await session.addDoc(res.path)
    activePdfIndex.value = session.activeDocIndex
    ElMessage.success(`已加载：${doc.value?.name ?? res.path}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function removeCurrent(): Promise<void> {
  const idx = activePdfIndex.value
  if (idx === null) return
  const name = doc.value?.name ?? ''
  try {
    await ElMessageBox.confirm(`确定删除「${name}」？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  session.removeDoc(idx)
  ElMessage.success('已删除')
}

onUnmounted(() => {
  // 无额外清理：PdfViewer 自行释放 pdfjs 资源
})
</script>

<template>
  <div class="doc-viewer">
    <div class="doc-toolbar">
      <el-button size="small" type="primary" plain @click="importPdf">打开 PDF</el-button>
      <el-select
        v-if="pdfDocs.length"
        :model-value="activePdfIndex"
        size="small"
        class="doc-select"
        placeholder="选择文档"
        @update:model-value="(i: number) => (activePdfIndex = i)"
      >
        <el-option v-for="p in pdfDocs" :key="p.i" :label="p.d.name" :value="p.i" />
      </el-select>
      <el-button v-if="activePdfIndex !== null" size="small" type="danger" plain @click="removeCurrent">
        删除
      </el-button>
    </div>

    <PdfViewer v-if="doc?.kind === 'pdf'" :pdf-base64="doc.pdfBase64" />
    <el-empty
      v-else
      :description="pdfDocs.length ? '选择一份 PDF 文档' : '打开口径 PDF，重启后仍会保留'"
    />
  </div>
</template>

<style scoped>
.doc-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.doc-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.doc-select {
  width: 260px;
}
</style>