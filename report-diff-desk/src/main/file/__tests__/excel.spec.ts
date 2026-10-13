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

describe('parseExcel 幽灵选区防护 (S3)', () => {
  it('!ref 被残留格式撑大时按实际数据收缩，不全量展开', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['a', 'b'], ['c', 100]])
    // 模拟幽灵选区：残留格式把 !ref 撑到 5001 行 × 101 列，实际只有 4 个格
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 5000, c: 100 } })
    XLSX.utils.book_append_sheet(wb, ws, '幽灵')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const s = parseExcel(buf, 'ghost.xlsx', 'file').sheets['幽灵']
    expect(s.rowCount).toBe(2)
    expect(s.colCount).toBe(2)
    expect(s.cells[1][1]?.v).toBe(100)
    expect(s.truncated).toBeUndefined() // 收缩自实际数据，不算截断
  })

  it('收缩起点保持 !ref 首行：行号基准不乱（diff/规则表坐标不受影响）', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      [null, null],
      [null, null],
      ['第3行', 30] // 真实数据从第 3 行起
    ])
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 9999, c: 50 } })
    XLSX.utils.book_append_sheet(wb, ws, '偏移')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const s = parseExcel(buf, 'offset.xlsx', 'file').sheets['偏移']
    expect(s.rowCount).toBe(3) // 起点未动，行号仍对齐 Excel
    expect(s.cells[2][0]?.v).toBe('第3行')
  })

  it('越界合并区（幽灵残留）被丢弃，不进 IPC', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([[1], [2]])
    ws['!merges'] = [{ s: { r: 5000, c: 0 }, e: { r: 5000, c: 1 } }] // 引用幽灵区域的合并
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 9999, c: 9 } })
    XLSX.utils.book_append_sheet(wb, ws, '越界合并')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const s = parseExcel(buf, 'badmerge.xlsx', 'file').sheets['越界合并']
    expect(s.merges).toBeUndefined()
  })

  it('列数超上限截断并标记 truncated', () => {
    const wb = XLSX.utils.book_new()
    const row = Array.from({ length: 2001 }, (_, c) => c) // 2001 列 > MAX_COLS 2000
    const ws = XLSX.utils.aoa_to_sheet([row])
    XLSX.utils.book_append_sheet(wb, ws, '超宽')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const s = parseExcel(buf, 'wide.xlsx', 'file').sheets['超宽']
    expect(s.colCount).toBe(2000)
    expect(s.truncated).toBe(true)
    expect(s.cells[0][1999]?.v).toBe(1999) // 保留的前 2000 列数据完好
  })

  it('行数超上限截断并标记 truncated', () => {
    const wb = XLSX.utils.book_new()
    // 100001 行 > MAX_ROWS 100000，每行一个行号值
    const rows = Array.from({ length: 100001 }, (_, r) => [r])
    const ws = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, '超高')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const s = parseExcel(buf, 'tall.xlsx', 'file').sheets['超高']
    expect(s.rowCount).toBe(100000)
    expect(s.truncated).toBe(true)
    expect(s.cells[99999][0]?.v).toBe(99999) // 前 10 万行完好
  })

  it('只有 !ref 没有数据格时按空表处理', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['x']])
    delete ws['A1'] // 删掉唯一数据格，!ref 仍在
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 99, c: 9 } })
    XLSX.utils.book_append_sheet(wb, ws, '空壳')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const s = parseExcel(buf, 'hollow.xlsx', 'file').sheets['空壳']
    expect(s.rowCount).toBe(0)
    expect(s.colCount).toBe(0)
  })
})
