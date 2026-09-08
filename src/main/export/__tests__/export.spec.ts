import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import type { CompareResult } from '@shared/types'
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

describe('buildExcelBuffer', () => {
  it('明细表结构：6 列表头 + 数据行 + 填充色 + 百分比格式', async () => {
    const buf = await buildExcelBuffer(makeResult())
    // 序列化后回读，验证样式真正写入文件
    const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true })
    const ws = wb.Sheets['变动明细']

    // 回读校验表头与数据
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: null })
    expect(rows[0]).toEqual(['工作表', '坐标', '上期值', '本期值', '变动率', '类型'])
    expect(rows).toHaveLength(4)
    expect(rows[1][0]).toBe('数据')
    expect(rows[1][1]).toBe('B2')
    expect(rows[1][2]).toBe(100)
    expect(rows[1][3]).toBe(200)
    expect(rows[1][4]).toBeCloseTo(1)
    expect(rows[1][5]).toBe('增长')
    expect(rows[3][5]).toBe('从零新增')

    // 行填充色按 kind：increase 浅红 / decrease 浅绿 / zero-base 浅橙
    // （SheetJS 回读剥离 alpha 前缀，比对 6 位 RGB）
    const fillOf = (cell: string): string | undefined => ws[cell]?.s?.fgColor?.rgb
    expect(fillOf('A2')).toBe('FDE2E2')
    expect(fillOf('A3')).toBe('E1F3D8')
    expect(fillOf('A4')).toBe('FDF6EC')

    // 变动率列百分比格式
    expect(ws['E2']?.z).toContain('0.0%')
  })
})

describe('buildHtmlReport', () => {
  it('自包含：内嵌样式与数据、按 sheet 分组、无外链', () => {
    const html = buildHtmlReport(makeResult())
    expect(html).toContain('上期.xlsx')
    expect(html).toContain('本期.xlsx')
    expect(html).toContain('B2')
    expect(html).toContain('200')
    expect(html).toContain('<style>')
    expect(html).toContain('阈值：50%')
    expect(html).toContain('100.0%')
    expect(html).toContain('数据')
    // 无外链资源
    expect(html).not.toMatch(/src="http/)
    expect(html).not.toMatch(/href="http/)
  })
})
