import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { parseZip } from '../zip'

function makeXlsxBuffer(sheetName: string, value: number): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['数值'], [value]]), sheetName)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function makeXlsBuffer(sheetName: string, value: number): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['数值'], [value]]), sheetName)
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
}

describe('parseZip', () => {
  it('解析 zip 内多个 xlsx 条目', async () => {
    const zip = new JSZip()
    zip.file('收入表.xlsx', makeXlsxBuffer('数据', 100))
    zip.file('子目录/成本表.xlsx', makeXlsxBuffer('数据', 60))
    const buf = await zip.generateAsync({ type: 'nodebuffer' })

    const wbs = await parseZip(buf, '报表包.zip')
    expect(wbs).toHaveLength(2)
    expect(wbs[0].source).toBe('zip')
    expect(wbs[0].fileName).toBe('报表包.zip/收入表.xlsx')
    expect(wbs[0].sheets['数据'].cells[1][0]?.v).toBe(100)
    expect(wbs[1].fileName).toBe('报表包.zip/子目录/成本表.xlsx')
    expect(wbs.every((w) => w.id && w.id !== '')).toBe(true)
  })

  it('zip 内 .xls 老格式条目可解析', async () => {
    const zip = new JSZip()
    zip.file('老数据.xls', makeXlsBuffer('数据', 42))
    const buf = await zip.generateAsync({ type: 'nodebuffer' })

    const wbs = await parseZip(buf, '老包.zip')
    expect(wbs).toHaveLength(1)
    expect(wbs[0].sheets['数据'].cells[1][0]?.v).toBe(42)
  })

  it('忽略非 Excel 条目与目录项', async () => {
    const zip = new JSZip()
    zip.file('说明.txt', 'readme')
    zip.file('子目录/', null, { dir: true })
    zip.file('数据.xlsx', makeXlsxBuffer('数据', 7))
    const buf = await zip.generateAsync({ type: 'nodebuffer' })

    const wbs = await parseZip(buf, '混合.zip')
    expect(wbs).toHaveLength(1)
    expect(wbs[0].fileName).toBe('混合.zip/数据.xlsx')
  })
})
