<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
// @ts-ignore vite worker import
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfjsWorker()

const props = defineProps<{ pdfBase64: string | null | undefined }>()

const containerRef = ref<HTMLDivElement | null>(null)
const keyword = ref('')
const scale = ref(1.4)
const totalPages = ref(0)
const currentPage = ref(0)
const matchSummary = ref('')

interface PageBox {
  pageIndex: number
  x: number
  y: number
  w: number
  h: number
}

let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
let highlights: PageBox[] = []
let disposed = false

async function loadPdf(): Promise<void> {
  if (!containerRef.value) return
  pdfDoc?.destroy().catch(() => {})
  pdfDoc = null
  containerRef.value.innerHTML = ''
  highlights = []
  currentPage.value = 0
  totalPages.value = 0
  matchSummary.value = ''

  if (!props.pdfBase64) return
  const bytes = Uint8Array.from(atob(props.pdfBase64), (c) => c.charCodeAt(0))
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise
  if (disposed) {
    doc.destroy()
    return
  }
  pdfDoc = doc
  totalPages.value = doc.numPages

  for (let i = 1; i <= doc.numPages; i++) {
    if (disposed) break
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: scale.value })
    const wrap = document.createElement('div')
    wrap.className = 'pdf-page-wrap'
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    wrap.appendChild(canvas)
    containerRef.value.appendChild(wrap)

    const ctx = canvas.getContext('2d')
    if (ctx) {
      try {
        await page.render({ canvasContext: ctx, viewport }).promise
      } catch {
        // 渲染失败页留空，不影响整体
      }
    }
    const textContent = await page.getTextContent()
    const items = textContent.items
      .map((it: unknown) => it as { str: string; transform: number[]; width?: number; height?: number })
      .filter((it) => it.str && it.str.trim())

    // 渲染时记录文本项坐标（供搜索高亮），并把坐标转成相对容器像素
    wrap.dataset['pageItems'] = JSON.stringify(
      items.map((it) => {
        const [tx, ty] = [it.transform[4], it.transform[5]]
        const w = it.width ?? 0
        const h = it.height ?? 0
        const [x0, y0] = viewport.convertToViewportPoint(tx, ty + h)
        const [x1, y1] = viewport.convertToViewportPoint(tx + w, ty)
        return { str: it.str, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      })
    )
  }
  await runSearch()
}

async function runSearch(): Promise<void> {
  clearHighlights()
  if (!pdfDoc) return
  const kw = keyword.value.trim()
  if (!kw) {
    matchSummary.value = ''
    return
  }
  const found: PageBox[] = []
  const wraps = containerRef.value?.querySelectorAll<HTMLElement>('.pdf-page-wrap') ?? []
  wraps.forEach((wrap, pi) => {
    const items: { str: string; x: number; y: number; w: number; h: number }[] = JSON.parse(
      wrap.dataset['pageItems'] ?? '[]'
    )
    for (const it of items) {
      if (it.str.includes(kw)) {
        found.push({ pageIndex: pi, ...it })
      }
    }
  })
  highlights = found
  matchSummary.value = found.length ? `共 ${found.length} 处` : '未找到'
  drawHighlights()
  if (found.length > 0) jumpTo(found[0].pageIndex)
}

function drawHighlights(): void {
  const wraps = containerRef.value?.querySelectorAll<HTMLElement>('.pdf-page-wrap') ?? []
  for (const [pi, box] of highlights.entries()) {
    const wrap = wraps[box.pageIndex]
    if (!wrap) continue
    const el = document.createElement('div')
    el.className = 'pdf-hit'
    el.style.left = `${box.x}px`
    el.style.top = `${box.y}px`
    el.style.width = `${box.w}px`
    el.style.height = `${box.h}px`
    wrap.appendChild(el)
    if (pi === 0) el.classList.add('pdf-hit--first')
  }
}

function clearHighlights(): void {
  containerRef.value?.querySelectorAll('.pdf-hit').forEach((el) => el.remove())
}

function jumpTo(pageIndex: number): void {
  const wraps = containerRef.value?.querySelectorAll<HTMLElement>('.pdf-page-wrap') ?? []
  const wrap = wraps[pageIndex]
  if (wrap) {
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' })
    currentPage.value = pageIndex + 1
  }
}

function changeScale(delta: number): void {
  const next = Math.min(3, Math.max(0.6, scale.value + delta))
  if (next === scale.value) return
  scale.value = next
  void loadPdf()
}

function onScroll(): void {
  const wraps = containerRef.value?.querySelectorAll<HTMLElement>('.pdf-page-wrap') ?? []
  if (!wraps.length) return
  const mid = containerRef.value!.scrollTop + containerRef.value!.clientHeight / 2
  for (let i = 0; i < wraps.length; i++) {
    if (wraps[i].offsetTop <= mid && (i === wraps.length - 1 || wraps[i + 1].offsetTop > mid)) {
      currentPage.value = i + 1
      break
    }
  }
}

watch(() => props.pdfBase64, () => void loadPdf())
watch(keyword, () => void runSearch())

onMounted(() => void loadPdf())
onUnmounted(() => {
  disposed = true
  pdfDoc?.destroy().catch(() => {})
  pdfDoc = null
})
</script>

<template>
  <div class="pdf-viewer">
    <div class="pdf-toolbar">
      <el-input v-model="keyword" size="small" class="pdf-search" placeholder="搜索关键字" clearable />
      <span class="pdf-meta">{{ matchSummary }}</span>
      <span class="pdf-meta">第 {{ currentPage }} / {{ totalPages }} 页</span>
      <el-button-group size="small">
        <el-button :disabled="scale <= 0.6" @click="changeScale(-0.2)">-</el-button>
        <el-button :disabled="scale >= 3" @click="changeScale(0.2)">+</el-button>
      </el-button-group>
    </div>
    <div ref="containerRef" class="pdf-container" @scroll="onScroll" />
  </div>
</template>

<style scoped>
.pdf-viewer {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.pdf-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 8px;
}
.pdf-search {
  width: 220px;
}
.pdf-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pdf-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: #525659;
  padding: 16px;
}
</style>

<style>
.pdf-page-wrap {
  position: relative;
  margin: 0 auto 16px;
  width: fit-content;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
.pdf-hit {
  position: absolute;
  background: rgba(255, 235, 59, 0.55);
  pointer-events: none;
  z-index: 2;
}
.pdf-hit--first {
  background: rgba(255, 152, 0, 0.6);
}
</style>
