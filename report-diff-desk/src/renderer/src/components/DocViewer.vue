<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { DocContent } from '@shared/types'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const keyword = ref('')
const docFontSize = ref(14)

/** 非报表口径文档（Word/PDF/TXT）；报表走口径查询页 */
const textDocs = computed(() =>
  session.docList
    .map((d, i) => ({ i, d }))
    .filter(({ d }) => d.kind === 'docx' || d.kind === 'pdf' || d.kind === 'txt')
)

/** 当前显示文档的 docList 索引 */
const activeTextIndex = ref<number | null>(null)

const doc = computed<DocContent | null>(() => {
  if (activeTextIndex.value === null) return null
  return session.docList[activeTextIndex.value] ?? null
})

const visiblePages = computed<{ index: number; text: string }[]>(() => {
  const pages = doc.value?.pages ?? []
  const kw = keyword.value.trim()
  return pages.map((text, index) => ({ index, text })).filter((p) => !kw || p.text.includes(kw))
})

/** 用户在任一页选中文档时，若为非报表文档则跟随显示 */
watch(
  () => session.activeDocIndex,
  (idx) => {
    const d = session.docList[idx]
    if (d && (d.kind === 'docx' || d.kind === 'pdf' || d.kind === 'txt')) {
      activeTextIndex.value = idx
    }
  },
  { immediate: true }
)

// 文档列表变化后，若当前选择已失效则回退到第一个非报表文档
watch(textDocs, (docs) => {
  if (activeTextIndex.value === null || !docs.some((x) => x.i === activeTextIndex.value)) {
    activeTextIndex.value = docs[0]?.i ?? null
  }
})

async function importDoc(): Promise<void> {
  const res = await window.api.openFile({ kind: 'doc', title: '选择口径文档（Word / PDF / TXT）' })
  if (res.canceled || !res.path) return
  try {
    await session.addDoc(res.path)
    keyword.value = ''
    const d = session.docList[session.activeDocIndex]
    if (d && (d.kind === 'docx' || d.kind === 'pdf' || d.kind === 'txt')) {
      activeTextIndex.value = session.activeDocIndex
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
</script>

<template>
  <div class="doc-viewer">
    <div class="doc-toolbar">
      <el-button size="small" @click="importDoc">打开文档</el-button>
      <el-select
        v-if="textDocs.length"
        :model-value="activeTextIndex"
        size="small"
        class="doc-select"
        placeholder="选择文档"
        @update:model-value="(i: number) => (activeTextIndex = i)"
      >
        <el-option v-for="t in textDocs" :key="t.i" :label="t.d.name" :value="t.i" />
      </el-select>
      <template v-if="doc">
        <el-input v-model="keyword" size="small" class="doc-keyword" placeholder="页内关键字过滤" clearable />
        <span class="doc-font-label">字号</span>
        <el-input-number v-model="docFontSize" :min="10" :max="28" size="small" />
      </template>
    </div>

    <div v-if="doc" class="doc-content" :style="{ fontSize: docFontSize + 'px' }">
      <!-- docx：iframe sandbox 隔离文档 HTML -->
      <iframe v-if="doc.kind === 'docx'" class="doc-frame" sandbox="" :srcdoc="doc.html" />
      <!-- pdf / txt：分页文本 -->
      <div v-else-if="visiblePages.length" class="doc-pages">
        <div v-for="p in visiblePages" :key="p.index" class="doc-page">
          <div class="doc-page-no">第 {{ p.index + 1 }} 页</div>
          <pre class="doc-page-text">{{ p.text }}</pre>
        </div>
      </div>
      <el-empty v-else description="没有匹配关键字的内容" />
    </div>
    <el-empty v-else description="打开口径文档（Word / PDF / TXT），重启后仍会保留" />
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
.doc-keyword {
  width: 200px;
}
.doc-font-label {
  font-size: 13px;
}
.doc-content {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 12px;
}
.doc-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}
.doc-page {
  margin-bottom: 16px;
}
.doc-page-no {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  border-bottom: 1px dashed var(--el-border-color);
  margin-bottom: 8px;
  padding-bottom: 4px;
}
.doc-page-text {
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.7;
  margin: 0;
}
</style>