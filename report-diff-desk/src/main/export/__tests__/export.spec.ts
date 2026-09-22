import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import type { BatchCompareResult } from '@shared/types'
import { loadReportFile } from '../../../main/file/loader'
import { matchWorkbookPairs } from '@shared/core/pairing'
import { buildExcelZipBuffer, PURPLE_FILL_ARG } from '../excel'
import { buildHtmlReport } from '../html'

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'export-'))
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeXlsxBuf(rows: unknown[][], merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[]): Buffer {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  if (merges) ws['!merges'] = merges
  XLSX.utils.book_append_sheet(wb, ws, '数据')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

async function makeZipFile(path: string, entries: { name: string; buf: Buffer }[]): Promise<void> {
  const zip = new JSZip()
  for (const e of entries) zip.file(e.name, e.buf)
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }))
}

/** 真实链路：生成 base/curr 源文件 → 解析 → 比对 → 导出 zip → 返回导出的 zip buffer */
async function exportZipOf(
  basePath: string,
  currPath: string
): Promise<{ batch: BatchCompareResult; out: Buffer; note?: string }> {
  const base = await loadReportFile(basePath)
  const curr = await loadReportFile(currPath)
  const batch = matchWorkbookPairs(base, curr, 0.5)
  const built = await buildExcelZipBuffer(batch, basePath, currPath)
  return { batch, out: built.buffer, note: built.note }
}

/** zip 条目 → exceljs load 的形参类型（exceljs d.ts 的局部 Buffer 声明遮蔽全局 Node Buffer） */
async function entryBuf(zip: JSZip, name: string): Promise<Parameters<ExcelJS.Workbook['xlsx']['load']>[0]> {
  return Buffer.from(await zip.file(name)!.async('uint8array')) as unknown as Parameters<
    ExcelJS.Workbook['xlsx']['load']
  >[0]
}

/** 单元格填充色 ARGB（仅 pattern fill 有 fgColor） */
function fillArgOf(cell: ExcelJS.Cell): string | undefined {
  const fill = cell.fill as { fgColor?: { argb?: string } } | undefined
  return fill?.fgColor?.argb
}

/** NR 场景行数据：首行合并标题，营收 100→200、费用 0→50、利润不变 */
const MERGE = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
const BASE_ROWS = [['NR01 境内汇总数据', null], ['指标', '金额'], ['营收', 100], ['费用', 0], ['利润', 40]]
const CURR_ROWS = [['NR01 境内汇总数据', null], ['指标', '金额'], ['营收', 200], ['费用', 50], ['利润', 40]]

describe('buildExcelZipBuffer', () => {
  it('zip 对 zip：每个文件对一个 xlsx，含「上期」「本期」两 sheet，变动格紫色标记', async () => {
    const baseZip = join(tmpDir, 'base.zip')
    const currZip = join(tmpDir, 'curr.zip')
    await makeZipFile(baseZip, [
      { name: 'NR01_月_20260731.xlsx', buf: makeXlsxBuf(BASE_ROWS, MERGE) },
      { name: 'NR02_月_20260731.xlsx', buf: makeXlsxBuf([['指标', '金额'], ['存量', 1000]]) }
    ])
    await makeZipFile(currZip, [
      { name: 'NR01_1910_月_20260831.xlsx', buf: makeXlsxBuf(CURR_ROWS, MERGE) },
      { name: 'NR02_1910_月_20260831.xlsx', buf: makeXlsxBuf([['指标', '金额'], ['存量', 1000]]) }
    ])

    const { batch, out } = await exportZipOf(baseZip, currZip)
    expect(batch.totalDiffs).toBe(2)

    // zip 内条目名 = 上期原文件名（去掉 zip 前缀），每对一个条目
    const zip = await JSZip.loadAsync(out)
    const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name)
    expect(names).toEqual(['NR01_月_20260731.xlsx', 'NR02_月_20260731.xlsx'])

    // 回读第一个条目：两个 sheet + 紫色 + 合并保留
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await entryBuf(zip, 'NR01_月_20260731.xlsx'))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['上期', '本期'])

    const baseWs = wb.worksheets[0]
    const currWs = wb.worksheets[1]
    // 营收 B3：两侧都标紫（增长）
    expect(baseWs.getCell('B3').value).toBe(100)
    expect(fillArgOf(baseWs.getCell('B3'))).toBe(PURPLE_FILL_ARG)
    expect(currWs.getCell('B3').value).toBe(200)
    expect(fillArgOf(currWs.getCell('B3'))).toBe(PURPLE_FILL_ARG)
    // 费用 B4：从零新增，两侧都标紫
    expect(fillArgOf(baseWs.getCell('B4'))).toBe(PURPLE_FILL_ARG)
    expect(fillArgOf(currWs.getCell('B4'))).toBe(PURPLE_FILL_ARG)
    // 未变动的利润 B5 不标
    expect(baseWs.getCell('B5').fill).toBeUndefined()
    // 原表合并区域 A1:B1 保留
    expect(baseWs.model.merges).toContain('A1:B1')
    expect(currWs.model.merges).toContain('A1:B1')
  })

  it('单文件 xlsx 输入同样可导出（非 zip 路径）', async () => {
    const basePath = join(tmpDir, 'base.xlsx')
    const currPath = join(tmpDir, 'curr.xlsx')
    writeFileSync(basePath, makeXlsxBuf(BASE_ROWS, MERGE))
    writeFileSync(currPath, makeXlsxBuf(CURR_ROWS, MERGE))

    const { out } = await exportZipOf(basePath, currPath)
    const zip = await JSZip.loadAsync(out)
    const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name)
    expect(names).toEqual(['base.xlsx'])

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await entryBuf(zip, 'base.xlsx'))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['上期', '本期'])
    expect(fillArgOf(wb.worksheets[0].getCell('B3'))).toBe(PURPLE_FILL_ARG)
  })

  it('多 sheet 文件：sheet 名加「上期_/本期_」前缀', async () => {
    const mk = (label: string): Buffer => {
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['指标', '金额'], ['营收', 100]]), '数据')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['说明'], [label]]), '附注')
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    }
    const basePath = join(tmpDir, 'multi-base.xlsx')
    const currPath = join(tmpDir, 'multi-curr.xlsx')
    writeFileSync(basePath, mk('上期备注'))
    writeFileSync(currPath, mk('本期备注'))

    const { out } = await exportZipOf(basePath, currPath)
    const zip = await JSZip.loadAsync(out)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await entryBuf(zip, 'multi-base.xlsx'))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['上期_数据', '上期_附注', '本期_数据', '本期_附注'])
  })

  it('.xls 老格式：导出为一个 xlsx，含「上期」「本期」两 sheet，变动格紫色标记', async () => {
    const makeXls = (rows: unknown[][]): Buffer => {
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '数据')
      return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
    }
    const basePath = join(tmpDir, 'base.xls')
    const currPath = join(tmpDir, 'curr.xls')
    writeFileSync(basePath, makeXls(BASE_ROWS))
    writeFileSync(currPath, makeXls(CURR_ROWS))

    const { out, note } = await exportZipOf(basePath, currPath)
    const zip = await JSZip.loadAsync(out)
    const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name)
    expect(names).toEqual(['base.xlsx']) // 一个文件，扩展名与内容一致
    expect(note).toContain('.xls')

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await entryBuf(zip, 'base.xlsx'))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['上期', '本期'])
    expect(wb.worksheets[0].getCell('B3').value).toBe(100)
    expect(fillArgOf(wb.worksheets[0].getCell('B3'))).toBe(PURPLE_FILL_ARG)
  })

  it('exceljs load 不抛错但 0 sheet（真实 biff8 行为）：走降级不产出空工作簿', async () => {
    // 空工作簿 xlsx：exceljs 能"成功"load 且 worksheets 为空——与真实 .xls 行为一致
    const makeEmptyXlsx = async (): Promise<Buffer> => {
      const wb = new ExcelJS.Workbook()
      return Buffer.from(await wb.xlsx.writeBuffer())
    }
    const basePath = join(tmpDir, 'empty.xls')
    const currPath = join(tmpDir, 'empty2.xls')
    writeFileSync(basePath, await makeEmptyXlsx())
    writeFileSync(currPath, await makeEmptyXlsx())

    const { out } = await exportZipOf(basePath, currPath)
    const zip = await JSZip.loadAsync(out)
    const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name)
    expect(names).toEqual(['empty.xlsx'])
  })
})

describe('buildHtmlReport', () => {
  it('自包含：按文件对分节、unmatched 提示、无外链', () => {
    const batch: BatchCompareResult = {
      pairs: [
        {
          pairLabel: 'NR01_月_本外币_20260731.xlsx → NR01_1910_月_本外币_20260831.xlsx',
          baseFileName: 'NR01_月_本外币_20260731.xlsx',
          currFileName: 'NR01_1910_月_本外币_20260831.xlsx',
          compare: {
            baseId: 'b',
            currId: 'c',
            baseLabel: 'x',
            currLabel: 'y',
            threshold: 0.5,
            sheetsMatched: ['数据'],
            sheetsOnlyInBase: [],
            sheetsOnlyInCurr: [],
            totalCellsCompared: 100,
            generatedAt: '2026-09-08T10:00:00.000Z',
            diffs: [
              { sheet: '数据', ref: 'B2', row: 2, col: 2, prevValue: 100, currValue: 200, prevNum: 100, currNum: 200, changeRate: 1, kind: 'increase' }
            ]
          }
        }
      ],
      unmatchedBase: ['多余的上期.xlsx'],
      unmatchedCurr: [],
      totalDiffs: 1
    }
    const html = buildHtmlReport(batch)
    expect(html).toContain('NR01_月_本外币_20260731.xlsx → NR01_1910_月_本外币_20260831.xlsx')
    expect(html).toContain('多余的上期.xlsx')
    expect(html).toContain('B2')
    expect(html).toContain('200')
    expect(html).toContain('<style>')
    expect(html).toContain('100.0%')
    expect(html).toContain('1 处变动')
    expect(html).not.toMatch(/src="http/)
    expect(html).not.toMatch(/href="http/)
  })
})

/** 真实 .xls 样例（samples/ 在 .gitignore 里，不保证每台机器都有） */
const XLS_BASE = resolve(__dirname, '../../../../samples/上期包.zip')
const XLS_CURR = resolve(__dirname, '../../../../samples/本期包.zip')
const hasXlsSamples = existsSync(XLS_BASE) && existsSync(XLS_CURR)

describe.skipIf(!hasXlsSamples)('buildExcelZipBuffer · .xls 源（真实样例）', () => {
  it('真实 .xls 源：一个 xlsx 两个 sheet，数值格式（0.0000_）带得过去', async () => {
    const { out, note } = await exportZipOf(XLS_BASE, XLS_CURR)
    expect(note).toContain('.xls')

    const zip = await JSZip.loadAsync(out)
    const name = Object.keys(zip.files).find((n) => /NR01/i.test(n))
    expect(name).toBeTruthy()

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await entryBuf(zip, name as string))
    expect(wb.worksheets.map((w) => w.name).sort()).toEqual(['上期', '本期'])

    // 原始 .xls 里数值格是 0.0000_（尾部带空格），丢了格式就会显示成 0.106 而不是 0.1060
    const ws = wb.getWorksheet('本期')
    let withFmt = 0
    ws?.eachRow((row) =>
      row.eachCell((cell) => {
        if (typeof cell.value === 'number' && cell.numFmt?.trim() === '0.0000_') withFmt++
      })
    )
    expect(withFmt).toBeGreaterThan(0)
  })
})
