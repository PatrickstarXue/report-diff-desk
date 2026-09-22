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
import { buildWpsParams, buildWpsScript, detectWps } from '../wps'

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
  currPath: string,
  opts?: { useWps?: boolean }
): Promise<{ batch: BatchCompareResult; out: Buffer; note?: string }> {
  const base = await loadReportFile(basePath)
  const curr = await loadReportFile(currPath)
  const batch = matchWorkbookPairs(base, curr, 0.5)
  const built = await buildExcelZipBuffer(batch, basePath, currPath, opts)
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

  it('多格共用同一样式时只标命中格（回归：曾把整块同风格区域一起染紫）', async () => {
    const mk = async (hot: number): Promise<Buffer> => {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('数据')
      ws.getCell('A1').value = '指标'
      ws.getCell('B1').value = '金额'
      const rows: [string, number][] = [
        ['甲', 100],
        ['乙', 100],
        ['丙', hot]
      ]
      rows.forEach((r, i) => {
        for (const c of [1, 2]) {
          const cell = ws.getRow(i + 2).getCell(c)
          cell.value = c === 1 ? r[0] : r[1]
          // 所有格套同一份样式——exceljs 写盘会去重，读回来这些格会指向同一个 style 对象
          cell.font = { name: '宋体', size: 10 }
          cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } }
        }
      })
      return Buffer.from(await wb.xlsx.writeBuffer())
    }
    const basePath = join(tmpDir, 'shared-base.xlsx')
    const currPath = join(tmpDir, 'shared-curr.xlsx')
    writeFileSync(basePath, await mk(100))
    writeFileSync(currPath, await mk(300)) // 只有「丙」的金额变了

    const { batch, out } = await exportZipOf(basePath, currPath)
    expect(batch.totalDiffs).toBe(1)

    const zip = await JSZip.loadAsync(out)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await entryBuf(zip, 'shared-base.xlsx'))
    const ws = wb.getWorksheet('上期')!

    // 前提检查：未命中的两行仍共用同一个 style 对象，说明这份导出里确实存在样式共享，
    // 这个用例才守得住东西（否则它什么也没测到）
    expect(ws.getCell('B2').style).toBe(ws.getCell('B3').style)
    expect(fillArgOf(ws.getCell('B4'))).toBe(PURPLE_FILL_ARG)
    expect(fillArgOf(ws.getCell('B2'))).toBeUndefined()
    expect(fillArgOf(ws.getCell('B3'))).toBeUndefined()
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

    // useWps:false 强制走内置重建路径——这组用例断言的就是没有 WPS 时的降级行为
    const { out, note } = await exportZipOf(basePath, currPath, { useWps: false })
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

    const { out } = await exportZipOf(basePath, currPath, { useWps: false })
    const zip = await JSZip.loadAsync(out)
    const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name)
    expect(names).toEqual(['empty.xlsx'])
  })
})

describe('wps 参数与脚本生成', () => {
  it('buildWpsParams 序列化 jobs，路径原样保留', () => {
    const jobs = [
      { inFile: 'C:\\tmp\\a\\in-0.xls', outFile: 'C:\\tmp\\a\\out-0.xlsx' },
      { inFile: 'C:\\tmp\\a\\in-1.xls', outFile: 'C:\\tmp\\a\\out-1.xlsx' }
    ]
    expect(JSON.parse(buildWpsParams(jobs))).toEqual({ jobs })
  })

  it('buildWpsScript 路径走单引号字面量并转义，正文保持 ASCII-only', () => {
    const script = buildWpsScript('C:\\tmp\\a\\jobs.json', 'C:\\tmp\\a\\error.txt')
    expect(script).toContain("$paramsPath = 'C:\\tmp\\a\\jobs.json'")
    expect(script).toContain("$errorFile = 'C:\\tmp\\a\\error.txt'")

    // 路径里的单引号按 PowerShell 规则翻倍，不会提前闭合字符串形成注入
    const injected = buildWpsScript("C:\\a'b\\jobs.json", 'C:\\err.txt')
    expect(injected).toContain("$paramsPath = 'C:\\a''b\\jobs.json'")

    // 中文（sheet 名等）一律走参数 JSON，脚本正文不能出现非 ASCII
    expect(/^[\x00-\x7F]*$/.test(script)).toBe(true)
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
const hasWps = hasXlsSamples && (await detectWps())

describe.skipIf(!hasXlsSamples)('buildExcelZipBuffer · .xls 源降级重建（真实样例）', () => {
  it('一个 xlsx 两个 sheet，数值格式（0.0000_）带得过去', async () => {
    const { out, note } = await exportZipOf(XLS_BASE, XLS_CURR, { useWps: false })
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
    let aligned = 0
    ws?.eachRow((row) =>
      row.eachCell((cell) => {
        if (typeof cell.value === 'number' && cell.numFmt?.trim() === '0.0000_') withFmt++
        if (cell.alignment?.horizontal || cell.alignment?.vertical) aligned++
      })
    )
    expect(withFmt).toBeGreaterThan(0)
    // 重建路径不写对齐——这正是 no 与 WPS 保真路径的差别，也是下面那组用例的对照组
    expect(aligned).toBe(0)
  })
})

describe.skipIf(!hasWps)('buildExcelZipBuffer · .xls 源 WPS 保真转换（真实样例）', () => {
  it('字体与紫标一并保住，且不再提示降级', async () => {
    const { batch, out, note } = await exportZipOf(XLS_BASE, XLS_CURR, { useWps: true })
    expect(note).toBeUndefined()

    // 取第一对有实际差异的文件对，坐标由真实结果推导，不写死
    const idx = batch.pairs.findIndex((p) => p.compare.diffs.length > 0)
    expect(idx).toBeGreaterThanOrEqual(0)
    const entry = (batch.pairs[idx].baseFileName.split('/').pop() ?? '').replace(/\.xls$/i, '.xlsx')

    const zip = await JSZip.loadAsync(out)
    expect(Object.keys(zip.files)).toContain(entry)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await entryBuf(zip, entry))
    expect(wb.worksheets.map((w) => w.name).sort()).toEqual(['上期', '本期'])

    // 三条互相独立的判据。降级重建只写值/列宽/行高/数值格式，读回来每格都是 exceljs 默认体
    // （Calibri）、alignment 为 undefined、border 为 {}——所以这三条都能把两条路径区分开。
    const currWs = wb.getWorksheet('本期')!
    let aligned = 0
    let bordered = 0
    let song = 0
    currWs.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.alignment?.horizontal || cell.alignment?.vertical) aligned++
        const b = cell.border
        if (b?.left?.style || b?.right?.style || b?.top?.style || b?.bottom?.style) bordered++
        if (cell.font?.name === '宋体') song++
      })
    )
    expect(aligned).toBeGreaterThan(0)
    expect(bordered).toBeGreaterThan(0)
    expect(song).toBeGreaterThan(0)

    // 真实表样式共享严重（701 个非空格只有 27 个 style 对象），标紫范围必须精确落在命中格上。
    // 上面已断言本工作簿只有「上期/本期」两个 sheet，说明源是单 sheet，故 diff 全落在本期这一张上。
    let purple = 0
    currWs.eachRow((row) =>
      row.eachCell((cell) => {
        if (fillArgOf(cell) === PURPLE_FILL_ARG) purple++
      })
    )
    expect(purple).toBe(batch.pairs[idx].compare.diffs.filter((d) => d.currValue !== null).length)

    const d = batch.pairs[idx].compare.diffs[0]
    expect(fillArgOf(currWs.getCell(d.row, d.col))).toBe(PURPLE_FILL_ARG)
  })
})
