import { createRequire } from 'module'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)

/**
 * PDF → 逐页文本数组。仅提取文本（无渲染），legacy 构建兼容 Node 环境。
 * 中文 PDF 依赖 cmaps：传入 pdfjs-dist 内置 cmaps 目录路径。
 */
export async function parsePdf(buffer: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // cmaps 目录无入口文件，require.resolve 目录会失败；从 package.json 定位根再拼接
  const cMapUrl = join(dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps') + '/'
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl,
    cMapPacked: true,
    isEvalSupported: false
  }).promise

  const pages: string[] = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      // 文本项按阅读序拼接；含换行的项保留换行
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : '').replace(/\r\n/g, '\n'))
          .join('')
          .trim()
      )
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return pages
}
