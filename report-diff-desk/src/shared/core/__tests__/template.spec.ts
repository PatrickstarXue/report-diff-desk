import { describe, it, expect } from 'vitest'
import { parseTemplateSheet, tableNoOf, templateKeyOf } from '../template'
import type { AlignConfig, MergedRange, SheetData } from '@shared/types'

describe('templateKeyOf', () => {
  it('取 zip 条目名最后一段并去扩展名', () => {
    expect(templateKeyOf('R06.xls')).toBe('R06')
    expect(templateKeyOf('上期包.zip/R06.xlsx')).toBe('R06')
    expect(templateKeyOf('zip/R06.xls')).toBe('R06')
  })

  it('大小写扩展名都能去', () => {
    expect(templateKeyOf('NR31.XLS')).toBe('NR31')
  })
})

describe('tableNoOf', () => {
  it('整段匹配 字母+数字', () => {
    expect(tableNoOf('R06.xls')).toBe('6')
    expect(tableNoOf('NR06.xls')).toBe('6')
    expect(tableNoOf('上期包.zip/NR31.xls')).toBe('31')
  })

  it('整段匹配失败时取名字开头的 字母+数字', () => {
    expect(tableNoOf('R06-人民币贴现利率水平表.xls')).toBe('6')
  })

  it('纯数字或中文开头返回 null', () => {
    expect(tableNoOf('06.xls')).toBeNull()
    expect(tableNoOf('附件2：新口径19张NR表上报逻辑 V1.0.2.xls')).toBeNull()
  })

  it('去前导零', () => {
    expect(tableNoOf('R006.xls')).toBe('6')
  })
})

/** 造 SheetData：数字串转 number，其余转 string，'.' 与 '' 视为空 */
function sheetOf(name: string, rows: string[][], merges?: MergedRange[]): SheetData {
  const cells = rows.map((row) =>
    row.map((v) => {
      if (v === '' || v === '.') return null
      return /^-?\d+(\.\d+)?$/.test(v) ? { v: Number(v) } : { v }
    })
  )
  return {
    name,
    rowCount: rows.length,
    colCount: Math.max(0, ...rows.map((r) => r.length)),
    cells,
    merges
  }
}

const input = (sheet: SheetData, fileName = 'R06.xls') => ({
  sheet,
  fileName,
  workbookId: 'wb1'
})

/**
 * 基准表样（0 起始）：
 *   r0  表名
 *   r1  [项  目][-][-][发生额][W]      ← 锚点在 A2，合并 A2:C3
 *   r2  [-][-][-][发生额][.]
 *   r3  [贴现][银承][3个月][1.5][2.5]  ← 合并 A4:A5、B4:B5
 *   r4  [-][-][6个月][1.6][2.6]
 */
const baseSheet = (): SheetData =>
  sheetOf(
    'R06',
    [
      ['表名', '', '', '', ''],
      ['项  目', '', '', '发生额', 'W'],
      ['', '', '', '', ''],
      ['贴现', '银承', '3个月', '1.5', '2.5'],
      ['', '', '6个月', '1.6', '2.6']
    ],
    [
      { r1: 1, c1: 0, r2: 2, c2: 2 },
      { r1: 3, c1: 0, r2: 4, c2: 0 },
      { r1: 3, c1: 1, r2: 4, c2: 1 }
    ]
  )

describe('parseTemplateSheet', () => {
  it('锚点合并范围决定表头行与标签列', () => {
    const t = parseTemplateSheet(input(baseSheet()))
    expect(t.error).toBeUndefined()
    expect(t.headerRange).toEqual({ r1: 1, c1: 0, r2: 2, c2: 2 })
    expect(t.labelEnd).toBe(2)
    expect(t.dataStartRow).toBe(3)
    expect(t.dataStartCol).toBe(3)
    expect(t.manualHeader).toBe(false)
  })

  it('行路径由标签列各段拼接，合并格向下填充', () => {
    const t = parseTemplateSheet(input(baseSheet()))
    expect(t.cells.map((c) => c.rowPath)).toContain('贴现/银承/3个月')
    expect(t.cells.map((c) => c.rowPath)).toContain('贴现/银承/6个月')
  })

  it('列路径由表头行各段拼接，相邻重复段合并', () => {
    const t = parseTemplateSheet(input(baseSheet()))
    const paths = t.cells.map((c) => c.colPath)
    expect(new Set(paths)).toEqual(new Set(['发生额', 'W']))
  })

  it('横跨两列合并的标签不重复拼接', () => {
    // 「一、活期」合并 A2:B2，填充后 A、B 两列都是同一文本
    const s = sheetOf(
      'X',
      [
        ['项  目', '', 'V'],
        ['一、活期', '', '1']
      ],
      [
        { r1: 0, c1: 0, r2: 0, c2: 1 },
        { r1: 1, c1: 0, r2: 1, c2: 1 }
      ]
    )
    const t = parseTemplateSheet(input(s, 'R01.xls'))
    expect(t.cells[0].rowPath).toBe('一、活期')
  })

  it('数据列全空的行不产出 cells（两侧都空即无差异）', () => {
    const s = baseSheet()
    s.cells.push([{ v: '合计' }, { v: '' }, { v: '' }, null, null])
    s.rowCount = 6
    const t = parseTemplateSheet(input(s))
    expect(t.cells.some((c) => c.rowPath === '合计')).toBe(false)
  })

  it('横向合并跨过数据列的注释行被排除', () => {
    // 注释行 A6:E6 合并：数据列区全是合并覆盖格，没有原始值
    const s = baseSheet()
    s.cells.push([{ v: '注：本表只统计境内业务数据。' }])
    s.rowCount = 6
    s.merges = [...(s.merges ?? []), { r1: 5, c1: 0, r2: 5, c2: 4 }]
    const t = parseTemplateSheet(input(s))
    expect(t.cells.some((c) => c.rowPath.startsWith('注：'))).toBe(false)
  })

  it('数据区合并覆盖格跳过，只取主格值', () => {
    // D5:E5 合并（数据行 r3）：E 变成覆盖格，该行只剩主格 col 3
    const s = baseSheet()
    s.merges = [...(s.merges ?? []), { r1: 3, c1: 3, r2: 3, c2: 4 }]
    const t = parseTemplateSheet(input(s))
    const r3 = t.cells.filter((c) => c.row === 3)
    expect(r3.map((c) => c.col)).toEqual([3])
    expect(r3[0].num).toBe(1.5)
    // 未合并的行不受影响，两列都在
    expect(t.cells.filter((c) => c.row === 4).map((c) => c.col)).toEqual([3, 4])
  })

  it('找不到锚点时报错', () => {
    const s = sheetOf('X', [['表名', '', ''], ['甲', '乙', '1']])
    const t = parseTemplateSheet(input(s, 'R01.xls'))
    expect(t.error).toBe('未找到「项 目」锚点，请手动指定表样范围')
    expect(t.cells).toEqual([])
  })

  it('人工 headerRange 覆盖锚点推断并标记 manualHeader', () => {
    const s = sheetOf('X', [['项  目', '', 'V'], ['甲', '乙', '1']])
    const cfg: AlignConfig = {
      version: 1,
      templates: { R01: { headerRange: { r1: 0, c1: 0, r2: 0, c2: 1 } } },
      pairs: []
    }
    const t = parseTemplateSheet(input(s, 'R01.xls'), cfg)
    expect(t.error).toBeUndefined()
    expect(t.manualHeader).toBe(true)
    expect(t.labelEnd).toBe(1)
    expect(t.dataStartRow).toBe(1)
    expect(t.dataStartCol).toBe(2)
  })

  it('表样键不匹配时人工范围不套用', () => {
    const s = sheetOf('X', [['表名', '', ''], ['甲', '乙', '1']])
    const cfg: AlignConfig = {
      version: 1,
      templates: { R99: { headerRange: { r1: 0, c1: 0, r2: 0, c2: 1 } } },
      pairs: []
    }
    expect(parseTemplateSheet(input(s, 'R01.xls'), cfg).error).toBe(
      '未找到「项 目」锚点，请手动指定表样范围'
    )
  })
})
