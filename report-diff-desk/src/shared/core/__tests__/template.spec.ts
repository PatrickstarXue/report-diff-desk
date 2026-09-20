import { describe, it, expect } from 'vitest'
import { checkTemplates, pairTemplateWorkbooks, parseTemplateSheet, tableNoOf, templateKeyOf } from '../template'
import { toNumeric } from '../numeric'
import type { AlignConfig, MergedRange, SheetData, TemplateSheet, WorkbookData } from '@shared/types'

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

/** 直接造 TemplateSheet，跳过表格解析，专测配对与比对 */
function tsheet(
  key: string,
  cells: [number, number, string, string, string | number | null][]
): TemplateSheet {
  return {
    key,
    tableNo: key.replace(/^[A-Za-z]+/, ''),
    fileName: `${key}.xls`,
    workbookId: key,
    sheetName: key,
    headerRange: { r1: 0, c1: 0, r2: 0, c2: 0 },
    labelEnd: 0,
    dataStartRow: 1,
    dataStartCol: 1,
    cells: cells.map(([row, col, rowPath, colPath, v]) => ({
      row,
      col,
      rowPath,
      colPath,
      text: v === null ? '' : String(v),
      // 与 parseTemplateSheet 一致地走 toNumeric，字符串 '1,200' / '-200' 也能数值化
      num: toNumeric(v === null ? null : { v })
    })),
    manualHeader: false
  }
}

const check = (
  l: TemplateSheet,
  r: TemplateSheet,
  threshold = 0.0001,
  config?: AlignConfig
): ReturnType<typeof checkTemplates> => checkTemplates(l, r, { threshold, config })

describe('checkTemplates', () => {
  it('跨行偏移的同行路径正确配对', () => {
    const l = tsheet('R06', [[5, 3, '转贴现/买断/3个月', '发生额', 1.5]])
    const r = tsheet('NR06', [[8, 3, '转贴现/买断/3个月', '发生额', 1.5]])
    const res = check(l, r)
    expect(res.totalCompared).toBe(1)
    expect(res.diffs).toHaveLength(0) // 值相同，无差异
    expect(res.onlyInLeft).toHaveLength(0)
    expect(res.onlyInRight).toHaveLength(0)
  })

  it('相对差超过阈值标记 diff', () => {
    const l = tsheet('R06', [[5, 3, 'A', '发生额', 1.2]])
    const r = tsheet('NR06', [[5, 3, 'A', '发生额', 1]])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].kind).toBe('diff')
    expect(res.diffs[0].relDiff).toBeCloseTo(0.2 / 1.2, 10)
  })

  it('相对差恰好等于阈值不标记（严格大于）', () => {
    // |2.0001-2| / 2.0001 = 0.0000499975...；阈值设为该值本身
    const rd = Math.abs(2.0001 - 2) / 2.0001
    const l = tsheet('R31', [[5, 12, 'A', '（75,+∞）', 2.0001]])
    const r = tsheet('NR31', [[5, 12, 'A', '（75,+∞）', 2]])
    expect(check(l, r, rd).diffs).toHaveLength(0)
    expect(check(l, r, rd * 0.5).diffs).toHaveLength(1)
  })

  it('双 0 跳过、两侧都无数值跳过', () => {
    const l = tsheet('R06', [
      [5, 3, 'A', '发生额', 0],
      [6, 3, 'B', '发生额', null]
    ])
    const r = tsheet('NR06', [
      [5, 3, 'A', '发生额', 0],
      [6, 3, 'B', '发生额', null]
    ])
    expect(check(l, r).diffs).toHaveLength(0)
  })

  it('一侧有值一侧为空记单侧有值', () => {
    const l = tsheet('R06', [[5, 3, 'A', '发生额', 1.5]])
    const r = tsheet('NR06', [[5, 3, 'A', '发生额', null]])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].kind).toBe('left-only-value')
    expect(res.diffs[0].relDiff).toBeNull()
  })

  it('只在单侧出现的行进 onlyIn，不进 diffs', () => {
    const l = tsheet('R06', [
      [5, 3, 'A', '发生额', 1],
      [6, 3, '贴现/银承/合计', '发生额', 3.3]
    ])
    const r = tsheet('NR06', [[5, 3, 'A', '发生额', 1]])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(0)
    expect(res.onlyInLeft).toHaveLength(1)
    expect(res.onlyInLeft[0].rowPath).toBe('贴现/银承/合计')
  })

  it('同表内配对键重复时按出现顺序分别配对，不静默错配', () => {
    const l = tsheet('R06', [
      [5, 3, 'A', '发生额', 1],
      [9, 3, 'A', '发生额', 5]
    ])
    const r = tsheet('NR06', [
      [5, 3, 'A', '发生额', 1.5],
      [9, 3, 'A', '发生额', 5]
    ])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].leftRow).toBe(5)
    expect(res.diffs[0].rightRow).toBe(5)
  })

  it('负值与千分位、百分号文本贯通数值化', () => {
    const l = tsheet('R06', [
      [5, 3, 'A', '发生额', -100],
      [6, 3, 'B', '发生额', 1000]
    ])
    const r = tsheet('NR06', [
      [5, 3, 'A', '发生额', '-200'],
      [6, 3, 'B', '发生额', '1,200']
    ])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(2)
    expect(res.diffs[0].kind).toBe('diff')
  })

  it('解析失败的表返回空结果', () => {
    const l = tsheet('R06', [[5, 3, 'A', '发生额', 1]])
    const bad: TemplateSheet = { ...tsheet('NR06', []), error: '未找到「项 目」锚点，请手动指定表样范围' }
    const res = check(l, bad)
    expect(res.diffs).toHaveLength(0)
    expect(res.totalCompared).toBe(0)
  })

  it('人工配对覆盖自动结果并标 manual', () => {
    // 左侧 R31 的「单位存款」路径配不上 NR31 的「一、活期/单位存款」
    const l = tsheet('R31', [[5, 3, '单位存款', '发生额', 1.1]])
    const r = tsheet('NR31', [[5, 3, '一、活期/单位存款', '发生额', 1]])
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [{ left: 'R31', right: 'NR31', fromRow: 5, fromCol: 3, toRow: 5, toCol: 3 }]
    }
    const auto = check(l, r)
    expect(auto.diffs).toHaveLength(0)
    expect(auto.onlyInLeft).toHaveLength(1)

    const res = check(l, r, 0.0001, cfg)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].manual).toBe(true)
    expect(res.diffs[0].kind).toBe('diff')
    expect(res.onlyInLeft).toHaveLength(0)
    expect(res.manualPairs).toBe(1)
  })

  it('忽略名单移除条目', () => {
    const l = tsheet('R31', [[5, 3, '单位存款', '发生额', 1.1]])
    const r = tsheet('NR31', [[5, 3, '一、活期/单位存款', '发生额', 1]])
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [{ left: 'R31', right: 'NR31', fromRow: 5, fromCol: 3, ignored: true }]
    }
    const res = check(l, r, 0.0001, cfg)
    expect(res.diffs).toHaveLength(0)
    expect(res.onlyInLeft).toHaveLength(0)
  })

  it('表样键不匹配时人工规则不套用', () => {
    const l = tsheet('R31', [[5, 3, '单位存款', '发生额', 1.1]])
    const r = tsheet('NR31', [[5, 3, '一、活期/单位存款', '发生额', 1]])
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [{ left: 'R06', right: 'NR06', fromRow: 5, fromCol: 3, toRow: 5, toCol: 3 }]
    }
    expect(check(l, r, 0.0001, cfg).diffs).toHaveLength(0)
    expect(check(l, r, 0.0001, cfg).onlyInLeft).toHaveLength(1)
  })
})

describe('pairTemplateWorkbooks', () => {
  const wb = (fileName: string, id = fileName): WorkbookData => ({
    id,
    fileName,
    source: 'zip',
    sheetNames: [],
    sheets: {}
  })

  it('按表号自动配对', () => {
    const res = pairTemplateWorkbooks(
      [wb('R06.xls'), wb('R31.xls')],
      [wb('NR06.xls'), wb('NR31.xls')]
    )
    expect(res.pairs.map((p) => [p.left.fileName, p.right.fileName])).toEqual([
      ['R06.xls', 'NR06.xls'],
      ['R31.xls', 'NR31.xls']
    ])
    expect(res.unmatchedLeft).toEqual([])
    expect(res.unmatchedRight).toEqual([])
  })

  it('表号提不出的进 unmatched', () => {
    const res = pairTemplateWorkbooks([wb('R06.xls'), wb('附件2.xls')], [wb('NR06.xls')])
    expect(res.pairs).toHaveLength(1)
    expect(res.unmatchedLeft).toEqual(['附件2.xls'])
  })

  it('同号多候选时不自动配对（交给人工）', () => {
    const res = pairTemplateWorkbooks([wb('R06.xls')], [wb('NR06.xls'), wb('NR06-副本.xls', 'b')])
    expect(res.pairs).toHaveLength(0)
    expect(res.unmatchedLeft).toEqual(['R06.xls'])
    expect(res.unmatchedRight).toHaveLength(2)
  })

  it('manualPairs 优先并占用名额', () => {
    const res = pairTemplateWorkbooks(
      [wb('R06.xls')],
      [wb('NR06.xls'), wb('NR06-副本.xls', 'b')],
      [{ leftId: 'R06.xls', rightId: 'b' }]
    )
    expect(res.pairs).toHaveLength(1)
    expect(res.pairs[0].right.fileName).toBe('NR06-副本.xls')
    expect(res.unmatchedRight).toEqual(['NR06.xls'])
  })
})
