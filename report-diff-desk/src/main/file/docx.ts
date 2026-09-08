import mammoth from 'mammoth'

/** .docx → 语义化 HTML（保留标题/表格/段落），供 renderer iframe 展示 */
export async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer })
  return result.value
}
