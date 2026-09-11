<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSessionStore } from '../stores/session'

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

// blob URL 管理：Chromium 内置 PDF 查看器，比纯文本分页直观
const pdfBlobUrl = ref<string | null>(null)

watch(doc, (d) => {
  if (pdfBlobUrl.value) URL.revokeObjectURL(pdfBlobUrl.value)
  pdfBlobUrl.value = null
  if (d?.pdfBase64) {
    const bytes = Uint8Array.from(atob(d.pdfBase64), (c) => c.charCodeAt(0))
    pdfBlobUrl.value = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  }
})

onUnmounted(() => {
  if (pdfBlobUrl.value) URL.revokeObjectURL(pdfBlobUrl.value)
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
  if (pdfBlobUrl.value) URL.revokeObjectURL(pdfBlobUrl.value)
  pdfBlobUrl.value = null
  session.removeDoc(idx)
  ElMessage.success('已删除')
}
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

    <!-- PDF：Chromium 内置查看器，支持翻页/缩放/搜索，最直观 -->
    <div v-if="pdfBlobUrl" class="doc-frame-wrap">
      <iframe class="doc-pdf-frame" :src="pdfBlobUrl" />
    </div>
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
.doc-frame-wrap {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  overflow: hidden;
}
.doc-pdf-frame {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
