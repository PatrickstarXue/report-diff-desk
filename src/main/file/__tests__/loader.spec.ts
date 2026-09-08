import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { loadReportFile } from '../loader'

const tmpDirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rdd-test-'))
  tmpDirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })))
})

describe('loadReportFile', () => {
  it('分发 .xlsx 单文件', async () => {
    const dir = await makeTmpDir()
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A'], [1]]), '数据')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const p = join(dir, '报表.xlsx')
    await writeFile(p, buf)

    const wbs = await loadReportFile(p)
    expect(wbs).toHaveLength(1)
    expect(wbs[0].fileName).toBe('报表.xlsx')
    expect(wbs[0].sheets['数据'].cells[1][0]?.v).toBe(1)
  })

  it('分发 .zip 包（含 2 个 Excel）', async () => {
    const dir = await makeTmpDir()
    const makeBuf = (v: number): Buffer => {
      const w = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([[v]]), '数据')
      return XLSX.write(w, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    }
    const zip = new JSZip()
    zip.file('a.xlsx', makeBuf(1))
    zip.file('b.xlsx', makeBuf(2))
    const p = join(dir, '包.zip')
    await writeFile(p, await zip.generateAsync({ type: 'nodebuffer' }))

    const wbs = await loadReportFile(p)
    expect(wbs).toHaveLength(2)
    expect(wbs.every((w) => w.source === 'zip')).toBe(true)
  })

  it('不支持的扩展名抛错', async () => {
    const dir = await makeTmpDir()
    const p = join(dir, '数据.csv')
    await writeFile(p, 'a,b')
    await expect(loadReportFile(p)).rejects.toThrow('暂不支持的报表格式')
  })
})
