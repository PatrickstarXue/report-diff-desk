import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import type { BatchCompareResult, CompareResult } from '@shared/types'
import { buildExcelBuffer } from '../excel'
import { buildHtmlReport } from '../html'

function makeResult(): CompareResult {
  return {
    baseId: 'b',
    currId: 'c',
    baseLabel: '上期.xlsx',
    currLabel: '本期.xlsx',
    threshold: 0.5,
    sheetsMatched: ['数据'],
    sheetsOnlyInBase: [],
    sheetsOnlyInCurr: [],
    totalCellsCompared: 100,
    generatedAt: '2026-09-08T10:00:00.000Z',
    diffs: [
      { sheet: '数据', ref: 'B2', row: 2, col: 2, prevValue: 100, currValue: 200, prevNum: 100, currNum: 200, changeRate: 1, kind: 'increase' },
      { sheet: '数据', ref: 'B3', row: 3, col: 2, prevValue: 100, currValue: 40, prevNum: 100, currNum: 40, changeRate: -0.6, kind: 'decrease' },
      { sheet: '数据', ref: 'B4', row: 4, col: 2, prevValue: 0, currValue: 50, prevNum: 0, currNum: 50, changeRate: 1, kind: 'zero-base' }
    ]
  }
}

function makeBatch(): BatchCompareResult {
  return {
    pairs: [
      {
        pairLabel: 'NR01_月_本外币_20260731.xlsx → NR01_1910_月_本外币_20260831.xlsx',
        baseFileName: 'NR01_月_本外币_20260731.xlsx',
        currFileName: 'NR01_1910_月_本外币_20260831.xlsx',
        compare: makeResult()
      }
    ],
    unmatchedBase: ['多余的上期.xlsx'],
    unmatchedCurr: [],
    totalDiffs: 3
  }
}

describe('buildExcelBuffer', () => {
  it('按文件对分 sheet：表头/数据/填充色/百分比格式', async () => {
    const buf = await buildExcelBuffer(makeBatch())
    const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true })

    // sheet 名 = 上期文件名去扩展名
    const ws = wb.Sheets['NR01_月_本外币_20260731']
    expect(ws).toBeTruthy()

    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: null })
    expect(rows[0]).toEqual(['工作表', '坐标', '上期值', '本期值', '变动率', '类型'])
    expect(rows).toHaveLength(4)
    expect(rows[1][1]).toBe('B2')
    expect(rows[1][4]).toBeCloseTo(1)
    expect(rows[1][5]).toBe('增长')

    // 行填充色按 kind：increase 浅红 / decrease 浅绿 / zero-base 浅橙
    // （SheetJS 回读剥离 alpha 前缀，比对 6 位 RGB）
    const fillOf = (cell: string): string | undefined => ws[cell]?.s?.fgColor?.rgb
    expect(fillOf('A2')).toBe('FDE2E2')
    expect(fillOf('A3')).toBe('E1F3D8')
    expect(fillOf('A4')).toBe('FDF6EC')

    // 变动率列百分比格式
    expect(ws['E2']?.z).toContain('0.0%')
  })

  it('多文件对生成多个 sheet', async () => {
    const batch = makeBatch()
    batch.pairs.push({
      pairLabel: 'B.xlsx → B2.xlsx',
      baseFileName: 'B.xlsx',
      currFileName: 'B2.xlsx',
      compare: makeResult()
    })
    const buf = await buildExcelBuffer(batch)
    const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true })
    expect(wb.SheetNames).toEqual(['NR01_月_本外币_20260731', 'B'])
  })
})

describe('buildHtmlReport', () => {
  it('自包含：按文件对分节、unmatched 提示、无外链', () => {
    const html = buildHtmlReport(makeBatch())
    expect(html).toContain('NR01_月_本外币_20260731.xlsx → NR01_1910_月_本外币_20260831.xlsx')
    expect(html).toContain('多余的上期.xlsx')
    expect(html).toContain('B2')
    expect(html).toContain('200')
    expect(html).toContain('<style>')
    expect(html).toContain('100.0%')
    expect(html).toContain('3 处变动')
    // 无外链资源
    expect(html).not.toMatch(/src="http/)
    expect(html).not.toMatch(/href="http/)
  })
})
