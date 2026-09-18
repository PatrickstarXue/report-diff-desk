<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
// @ts-ignore vite worker import
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'

/**
 * 每次加载都新建 worker port，不可跨文档共享：
 * pdf.js 的 PDFDocumentLoadingTask.destroy() 会连带 `terminate()` 掉
 * GlobalWorkerOptions.workerPort 指向的 worker。共享一个模块级 port 时，
 * 第一份文档 destroy 会杀死线程，第二份 getDocument() 永久挂起（无报错、不显示）。
 */
function newWorkerPort(): Worker {
  return new PdfjsWorker()
}

const props = defineProps<{ pdfBase64: string | null | undefined }>()

const containerRef = ref<HTMLDivElement | null>(null)
const keyword = ref('')
const scale = ref(1.4)
const totalPages = ref(0)
const currentPage = ref(0)
const matchSummary = ref('')
const matchCount = ref(0)
/** 当前定位到第几个命中（0 基） */
const matchIndex = ref(0)

interface PageBox {
  pageIndex: number
  x: number
  y: number
  w: number
  h: number
}

let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
let highlights: PageBox[] = []
/** 命中框 DOM，键为 highlights 下标，用于切换「当前命中」高亮 */
const hitEls = new Map<number, HTMLElement>()
let textLayers: pdfjsLib.TextLayer[] = []
let disposed = false
let renderToken = 0

/** 加载文档（仅首次或 pdfBase64 变化时调用），加载后渲染全部页 */
async function loadPdf(): Promise<void> {
  const container = containerRef.value
  if (!container) return
  pdfDoc?.destroy().catch(() => {})
  pdfDoc = null
  for (const tl of textLayers) tl.cancel()
  textLayers = []
  container.innerHTML = ''
  highlights = []
  currentPage.value = 0
  totalPages.value = 0
  matchSummary.value = ''
  matchCount.value = 0
  matchIndex.value = 0

  if (!props.pdfBase64) return
  pdfjsLib.GlobalWorkerOptions.workerPort = newWorkerPort()
  const bytes = Uint8Array.from(atob(props.pdfBase64), (c) => c.charCodeAt(0))
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise
  if (disposed) {
    doc.destroy()
    return
  }
  pdfDoc = doc
  totalPages.value = doc.numPages
  await renderAllPages()
}

/**
 * 用现有 pdfDoc 渲染/重绘全部页。缩放时保留 DOM 节点原地重绘（不重建、不闪空白）；
 * 仅页面数与已渲染不一致时才重建容器。
 */
async function renderAllPages(): Promise<void> {
  const container = containerRef.value
  if (!container || !pdfDoc) return
  const token = ++renderToken
  clearHighlights()
  highlights = []
  // 缩放重绘时废弃旧的文本层（在飞渲染已无意义）
  for (const tl of textLayers) tl.cancel()
  textLayers = []
  container.querySelectorAll('.pdf-text-layer').forEach((el) => el.remove())

  let wraps = Array.from(container.querySelectorAll<HTMLElement>('.pdf-page-wrap'))
  if (wraps.length !== pdfDoc.numPages) {
    container.innerHTML = ''
    wraps = []
    for (let i = 0; i < pdfDoc.numPages; i++) {
      const wrap = document.createElement('div')
      wrap.className = 'pdf-page-wrap'
      const canvas = document.createElement('canvas')
      wrap.appendChild(canvas)
      container.appendChild(wrap)
      wraps.push(wrap)
    }
  }

  for (let i = 0; i < pdfDoc.numPages; i++) {
    if (disposed || token !== renderToken) break
    const page = await pdfDoc.getPage(i + 1)
    const viewport = page.getViewport({ scale: scale.value })
    const wrap = wraps[i]
    const canvas = wrap.querySelector('canvas')!
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
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

    // 文本层：透明文字覆盖在 canvas 上，使内容可选中/复制
    // （构造时 container 即 rootContainer → 定位用百分比，与缩放无关）
    wrap.style.setProperty('--scale-factor', String(scale.value))
    const layerDiv = document.createElement('div')
    layerDiv.className = 'pdf-text-layer'
    wrap.appendChild(layerDiv)
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: layerDiv,
      viewport
    })
    textLayers.push(textLayer)
    try {
      await textLayer.render()
    } catch {
      // 文本层渲染失败不影响 canvas 显示
    }
  }
  await runSearch()
}

async function runSearch(): Promise<void> {
  clearHighlights()
  highlights = []
  matchCount.value = 0
  matchIndex.value = 0
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
  matchCount.value = found.length
  matchSummary.value = found.length ? '' : '未找到'
  drawHighlights()
  if (found.length > 0) jumpToMatch(0)
}

/** 按顺序切换命中项，越界时循环（delta 为 +1 / -1） */
function goToMatch(delta: number): void {
  const n = highlights.length
  if (!n) return
  matchIndex.value = (matchIndex.value + delta + n) % n
  applyActiveHit()
  jumpToMatch(matchIndex.value)
}

function drawHighlights(): void {
  const wraps = containerRef.value?.querySelectorAll<HTMLElement>('.pdf-page-wrap') ?? []
  highlights.forEach((box, pi) => {
    const wrap = wraps[box.pageIndex]
    if (!wrap) return
    const el = document.createElement('div')
    el.className = 'pdf-hit'
    el.style.left = `${box.x}px`
    el.style.top = `${box.y}px`
    el.style.width = `${box.w}px`
    el.style.height = `${box.h}px`
    wrap.appendChild(el)
    hitEls.set(pi, el)
  })
  applyActiveHit()
}

function applyActiveHit(): void {
  hitEls.forEach((el, pi) => el.classList.toggle('pdf-hit--current', pi === matchIndex.value))
}

function clearHighlights(): void {
  containerRef.value?.querySelectorAll('.pdf-hit').forEach((el) => el.remove())
  hitEls.clear()
}

/** 滚动到第 index 个命中项（定位到该命中所在位置，而非页首） */
function jumpToMatch(index: number): void {
  const container = containerRef.value
  const box = highlights[index]
  if (!container || !box) return
  const wrap = container.querySelectorAll<HTMLElement>('.pdf-page-wrap')[box.pageIndex]
  if (!wrap) return
  const wrapTop =
    wrap.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
  container.scrollTo({
    top: Math.max(0, wrapTop + box.y - container.clientHeight / 3),
    behavior: 'smooth'
  })
  currentPage.value = box.pageIndex + 1
}

function onScroll(): void {
  const container = containerRef.value
  if (!container) return
  const wraps = container.querySelectorAll<HTMLElement>('.pdf-page-wrap')
  if (!wraps.length) return
  const cTop = container.getBoundingClientRect().top
  const mid = cTop + container.clientHeight / 2
  for (let i = 0; i < wraps.length; i++) {
    const top = wraps[i].getBoundingClientRect().top
    if (top <= mid && (i === wraps.length - 1 || wraps[i + 1].getBoundingClientRect().top > mid)) {
      currentPage.value = i + 1
      break
    }
  }
}

function changeScale(delta: number): void {
  const next = Math.min(3, Math.max(0.6, scale.value + delta))
  if (next === scale.value) return
  scale.value = next
}

// 缩放变化：复用已加载文档原地重绘（不再销毁重建，避免首帧空白）
watch(scale, () => {
  if (pdfDoc) void renderAllPages()
})

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
      <el-button-group size="small">
        <el-button :disabled="!matchCount" @click="goToMatch(-1)">上一个</el-button>
        <el-button :disabled="!matchCount" @click="goToMatch(1)">下一个</el-button>
      </el-button-group>
      <span v-if="matchCount" class="pdf-meta">第 {{ matchIndex + 1 }} / {{ matchCount }} 处</span>
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
  height: calc(100vh - 170px);
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
/* 文本层：透明文字覆盖在 canvas 上，使 PDF 内容可选中/复制。
   这些节点由 renderAllPages 命令式创建，不带 scoped 属性，样式必须放全局块 */
.pdf-text-layer {
  position: absolute;
  inset: 0;
  overflow: clip;
  line-height: 1;
  text-size-adjust: none;
  transform-origin: 0 0;
  z-index: 2;
}
.pdf-text-layer span,
.pdf-text-layer br {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}
.pdf-hit {
  position: absolute;
  background: rgba(255, 235, 59, 0.55);
  pointer-events: none;
  z-index: 1;
}
.pdf-hit--current {
  background: rgba(255, 152, 0, 0.6);
}
</style>
