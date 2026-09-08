import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseExcel } from '../excel'
import type { GridCell } from '@shared/types'

/** 运行时生成 fixture：3 个 sheet，含公式格、日期格、文本/数字 */
function makeWorkbookBuffer(): Buffer {
  const wb = XLSX.utils.book_new()

  const ws1 = XLSX.utils.aoa_to_sheet([
    ['指标', '金额'],
    ['营收', 100],
    ['成本', 60],
    ['利润', '1,234'] // 千分位文本
  ])
  ws1['B3'] = { t: 'n', f: 'B2*2', v: 120 } // 公式格（带缓存值，模拟 Excel 保存）
  ws1['A5'] = { t: 'd', v: new Date(2026, 0, 15), z: 'yyyy-mm-dd' } // 日期格
  // 手动添加单元格后必须同步 range，否则写入被忽略
  ws1['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 4, c: 1 } })
  XLSX.utils.book_append_sheet(wb, ws1, '经营数据')

  const ws2 = XLSX.utils.aoa_to_sheet([['说明'], ['第二张表']])
  XLSX.utils.book_append_sheet(wb, ws2, '附注')

  const ws3 = XLSX.utils.aoa_to_sheet([['x'], ['y']])
  XLSX.utils.book_append_sheet(wb, ws3, 'Sheet3')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('parseExcel (xlsx)', () => {
  it('解析 sheet 名与数量', () => {
    const wb = parseExcel(makeWorkbookBuffer(), 'test.xlsx', 'file')
    expect(wb.sheetNames).toEqual(['经营数据', '附注', 'Sheet3'])
    expect(wb.fileName).toBe('test.xlsx')
    expect(wb.source).toBe('file')
    expect(wb.id).toBeTruthy()
  })

  it('解析单元格值与行列数', () => {
    const wb = parseExcel(makeWorkbookBuffer(), 'test.xlsx', 'file')
    const s = wb.sheets['经营数据']
    expect(s.rowCount).toBe(5)
    expect(s.colCount).toBe(2)
    const cell = (r: number, c: number): GridCell | null => s.cells[r - 1]?.[c - 1] ?? null
    expect(cell(1, 1)?.v).toBe('指标')
    expect(cell(2, 2)?.v).toBe(100)
    expect(cell(4, 2)?.v).toBe('1,234')
    expect(cell(5, 2)).toBeNull() // 缺省格
  })

  it('公式格保留 f 与缓存值', () => {
    const wb = parseExcel(makeWorkbookBuffer(), 'test.xlsx', 'file')
    const cell = wb.sheets['经营数据'].cells[2][1] // B3
    expect(cell?.f).toBe('B2*2')
    expect(cell?.v).toBe(120)
  })

  it('日期格转为本地日期字符串并标记 isDate', () => {
    const wb = parseExcel(makeWorkbookBuffer(), 'test.xlsx', 'file')
    const cell = wb.sheets['经营数据'].cells[4][0] // A5
    expect(cell?.isDate).toBe(true)
    expect(cell?.v).toBe('2026-01-15')
  })

  it('空 sheet 边界不报错', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), '空表')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const parsed = parseExcel(buf, 'empty.xlsx', 'file')
    expect(parsed.sheets['空表'].rowCount).toBe(0)
    expect(parsed.sheets['空表'].colCount).toBe(0)
  })

  it('透传合并区域 merges', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['报表标题', null, null], ['指标', '金额'], ['营收', 100]])
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }] // A1:C1 合并标题
    XLSX.utils.book_append_sheet(wb, ws, '数据')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const parsed = parseExcel(buf, 'merged.xlsx', 'file')
    expect(parsed.sheets['数据'].merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 2 }])
    expect(parsed.sheets['数据'].cells[0][0]?.v).toBe('报表标题')
  })

  it('无合并区域时不带 merges 字段', () => {
    const wb = parseExcel(makeWorkbookBuffer(), 'test.xlsx', 'file')
    expect(wb.sheets['经营数据'].merges).toBeUndefined()
  })

  it('支持 .xls 老格式 (biff8)', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['老格式', 42]]), '数据')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
    const parsed = parseExcel(buf, 'old.xls', 'file')
    expect(parsed.sheetNames).toEqual(['数据'])
    expect(parsed.sheets['数据'].cells[0][1]?.v).toBe(42)
  })
})
