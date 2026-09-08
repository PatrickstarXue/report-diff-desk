/** TXT → 单元素文本数组。UTF-8 优先，出现替换符时按 GBK 重解。 */
export async function parseTxt(buffer: Buffer): Promise<string[]> {
  let text = buffer.toString('utf-8')
  if (text.includes('�')) {
    text = new TextDecoder('gbk').decode(buffer)
  }
  return [text]
}
