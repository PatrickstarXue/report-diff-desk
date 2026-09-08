import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { parseTxt } from '../txt'
import { parseDocx } from '../docx'
import { parsePdf } from '../pdf'

describe('parseTxt', () => {
  it('UTF-8 正常读取', async () => {
    const pages = await parseTxt(Buffer.from('营业收入口径说明', 'utf-8'))
    expect(pages).toEqual(['营业收入口径说明'])
  })

  it('GBK 编码兜底', async () => {
    // 「中国」的 GBK 字节：D6D0 B9FA（Node Buffer 不支持 gbk，手工构造）
    const gbk = Buffer.from('d6d0b9fa', 'hex')
    const pages = await parseTxt(gbk)
    expect(pages[0]).toBe('中国')
  })
})

describe('parseDocx', () => {
  it('解析最小 docx 包为 HTML', async () => {
    const zip = new JSZip()
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    )
    zip.file(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    )
    zip.file(
      'word/document.xml',
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>营业收入口径：报告期内销售商品收入</w:t></w:r></w:p></w:body></w:document>'
    )
    const buf = await zip.generateAsync({ type: 'nodebuffer' })

    const html = await parseDocx(buf)
    expect(html).toContain('营业收入口径')
    expect(html).toContain('<p>')
  })
})

// 手工构造的最小 PDF（Helvetica，英文文本），覆盖 parsePdf 的主链路
const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 100 700 Td (Hello PDF) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
trailer
<< /Root 1 0 R /Size 6 >>
%%EOF`

describe('parsePdf', () => {
  it('提取 PDF 文本（无 xref 由 pdfjs 自动恢复）', async () => {
    const pages = await parsePdf(Buffer.from(MINIMAL_PDF, 'latin1'))
    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain('Hello PDF')
  })
})
