import { describe, it, expect } from 'vitest'
import {
  checkTemplates,
  effectiveRule,
  pairTemplateWorkbooks,
  parseTemplateSheet,
  parseWorkbook,
  tableNoOf,
  templateKeyOf
} from '../template'
import { toNumeric } from '../numeric'
import type {
  MergedRange,
  RuleTablePair,
  SheetData,
  TemplateSheet,
  WorkbookData
} from '@shared/types'

// ——— 造表工具 ———

/** 造 SheetData：cells 用 [row, col, value] 三元组描述，其余为空格 */
function sheetOf(
  rowCount: number,
  colCount: number,
  entries: [number, number, string | number | null][],
  merges: MergedRange[] = []
): SheetData {
  const cells = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => null as { v: string | number | null } | null)
  )
  for (const [r, c, v] of entries) cells[r][c] = { v }
  return { name: 'S', rowCount, colCount, cells, merges }
}

/** 标准锚点表：锚点在第 3 行 A 列，表头区 A4:C5，数据从 D 列第 6 行起 */
function anchoredSheet(
  entries: [number, number, string | number | null][],
  rowCount = 12
): SheetData {
  return sheetOf(
    rowCount,
    8,
    [
      [3, 0, '项    目'],
      [3, 3, '发生额'],
      [5, 0, '贴现'],
      [5, 1, '银承'],
      [5, 2, '3个月'],
      ...entries
    ],
    [
      { r1: 3, c1: 0, r2: 4, c2: 2 },
      { r1: 3, c1: 3, r2: 4, c2: 3 }
    ]
  )
}

const parse = (s: SheetData, fileName = 'R06.xls'): TemplateSheet =>
  parseTemplateSheet({ sheet: s, fileName, workbookId: 'w1' })

/** 直接造 TemplateSheet，跳过解析，专测配对与比对 */
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
    degraded: false,
    cells: cells.map(([row, col, rowPath, colPath, v]) => ({
      row,
      col,
      rowPath,
      colPath,
      text: v === null ? '' : String(v),
      num: toNumeric(v === null ? null : { v }),
      seed: `${rowPath}_${colPath}`
    }))
  }
}

const check = (
  l: TemplateSheet,
  r: TemplateSheet,
  threshold = 0.0001,
  ruleTable?: RuleTablePair
): ReturnType<typeof checkTemplates> => checkTemplates(l, r, { threshold, ruleTable })

// ——— 表号与表样键 ———

describe('templateKeyOf', () => {
  it('取 zip 条目名最后一段并去扩展名', () => {
    expect(templateKeyOf('R06.xls')).toBe('R06')
    expect(templateKeyOf('上期包.zip/R06.xlsx')).toBe('R06')
    expect(templateKeyOf('zip/R06.xls')).toBe('R06')
  })

  it('大小写扩展名都能去', () => {
    expect(templateKeyOf('R06.XLS')).toBe('R06')
    expect(templateKeyOf('R06.Xlsx')).toBe('R06')
  })
})

describe('tableNoOf', () => {
  it('整段匹配 字母+数字', () => {
    expect(tableNoOf('R06.xls')).toBe('6')
    expect(tableNoOf('NR31.xls')).toBe('31')
  })

  it('整段匹配失败时取名字开头的 字母+数字', () => {
    expect(tableNoOf('R06-人民币贴现利率水平表.xls')).toBe('6')
  })

  it('纯数字或中文开头返回 null', () => {
    expect(tableNoOf('附件2.xls')).toBeNull()
    expect(tableNoOf('报表.xls')).toBeNull()
  })

  it('去前导零', () => {
    expect(tableNoOf('R006.xls')).toBe('6')
  })
})

// ——— 解析与种子 ———

describe('parseTemplateSheet', () => {
  it('锚点合并范围决定表头区，数据格带种子规则值', () => {
    const t = parse(anchoredSheet([[5, 3, 1.1]]))
    expect(t.error).toBeUndefined()
    expect(t.degraded).toBe(false)
    expect(t.cells).toHaveLength(1)
    expect(t.cells[0].rowPath).toBe('贴现/银承/3个月')
    expect(t.cells[0].colPath).toBe('发生额')
    expect(t.cells[0].seed).toBe('贴现/银承/3个月_发生额')
  })

  it('行路径由标签列各段拼接，合并格向下填充', () => {
    const s = anchoredSheet([
      [5, 3, 1],
      [6, 3, 2]
    ])
    // sheetOf 总会给 merges 一个数组，断言只为满足可选字段的类型
    s.merges!.push(
      { r1: 5, c1: 0, r2: 6, c2: 0 },
      { r1: 5, c1: 1, r2: 6, c2: 1 },
      { r1: 5, c1: 2, r2: 6, c2: 2 }
    )
    const t = parse(s)
    expect(t.cells.map((c) => c.rowPath)).toEqual(['贴现/银承/3个月', '贴现/银承/3个月'])
  })

  it('找不到锚点时降级：行列标签退化为位置，锚点缺失不再报错', () => {
    const t = parse(
      sheetOf(3, 3, [
        [0, 0, '随便'],
        [1, 1, 5]
      ])
    )
    expect(t.error).toBeUndefined()
    expect(t.degraded).toBe(true)
    expect(t.cells).toHaveLength(1)
    expect(t.cells[0].rowPath).toBe('第2行')
    expect(t.cells[0].colPath).toBe('B')
    expect(t.cells[0].seed).toBe('第2行_B')
  })

  it('表头区找不到数据列时同样降级', () => {
    // 锚点在 A4，但数据列范围内没有任何列标签
    const s = sheetOf(8, 4, [[3, 0, '项    目'], [5, 2, 9]], [{ r1: 3, c1: 0, r2: 4, c2: 2 }])
    const t = parse(s)
    expect(t.error).toBeUndefined()
    expect(t.degraded).toBe(true)
    expect(t.cells).toHaveLength(1)
    expect(t.cells[0].num).toBe(9)
  })

  it('数据列全空的行不产出 cells（两侧都空即无差异）', () => {
    const t = parse(anchoredSheet([[5, 3, null]]))
    expect(t.cells).toHaveLength(0)
  })

  it('数据区合并覆盖格跳过，只取主格值', () => {
    const s = sheetOf(
      8,
      6,
      [
        [3, 0, '项    目'],
        [3, 3, '发生额'],
        [5, 0, '贴现'],
        [5, 3, 7]
      ],
      [
        { r1: 3, c1: 0, r2: 4, c2: 2 },
        // 表头横跨两列 → 两列列路径都是「发生额」
        { r1: 3, c1: 3, r2: 4, c2: 4 },
        // 数据区合并覆盖 (5,4)，该格不得产出
        { r1: 5, c1: 3, r2: 5, c2: 4 }
      ]
    )
    const t = parse(s)
    expect(t.cells.map((c) => c.col)).toEqual([3])
    expect(t.cells[0].num).toBe(7)
  })

  it('工作簿中没有工作表时报错', () => {
    const wb: WorkbookData = {
      id: 'w1',
      fileName: 'R06.xls',
      source: 'file',
      sheetNames: [],
      sheets: {}
    }
    expect(parseWorkbook(wb).error).toBe('工作簿中没有工作表')
  })
})

// ——— 规则值与生效值 ———

describe('effectiveRule', () => {
  const cell = tsheet('R06', [[5, 3, '甲', '乙', 1]]).cells[0]

  it('规则表缺席时用种子', () => {
    expect(effectiveRule(undefined, cell)).toBe('甲_乙')
  })

  it('规则表有该位置时以其为准', () => {
    expect(effectiveRule({ '5,3': '自定义' }, cell)).toBe('自定义')
  })

  it('空串表示不比对，且不会被种子顶替', () => {
    expect(effectiveRule({ '5,3': '' }, cell)).toBe('')
  })

  it('比较前 trim', () => {
    expect(effectiveRule({ '5,3': '  甲_乙  ' }, cell)).toBe('甲_乙')
  })
})

// ——— 等值配对与比对判据 ———

describe('checkTemplates', () => {
  it('两侧规则值相同即配对（行坐标不同也能配上）', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 10]])
    const r = tsheet('NR06', [[9, 3, '甲', '乙', 10]])
    const res = check(l, r)
    expect(res.totalCompared).toBe(1)
    expect(res.diffs).toHaveLength(0)
  })

  it('规则值不同则不配对，各自进未配上清单', () => {
    const l = tsheet('R31', [[5, 3, '单位存款', '乙', 1.1]])
    const r = tsheet('NR31', [[5, 3, '一、活期/单位存款', '乙', 1]])
    const res = check(l, r)
    expect(res.totalCompared).toBe(0)
    expect(res.onlyInLeft.map((e) => e.rule)).toEqual(['单位存款_乙'])
    expect(res.onlyInRight.map((e) => e.rule)).toEqual(['一、活期/单位存款_乙'])
  })

  it('规则表把两侧规则值改成一致后即配对并比对', () => {
    const l = tsheet('R31', [[5, 3, '单位存款', '乙', 1.1]])
    const r = tsheet('NR31', [[5, 3, '一、活期/单位存款', '乙', 1]])
    const ruleTable: RuleTablePair = {
      left: { '5,3': '活期单位存款_乙' },
      right: { '5,3': '活期单位存款_乙' }
    }
    const res = check(l, r, 0.0001, ruleTable)
    expect(res.totalCompared).toBe(1)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].rule).toBe('活期单位存款_乙')
    expect(res.diffs[0].kind).toBe('diff')
  })

  it('清空一侧的规则值即把该格排除出比对；对侧同值格成为孤儿进未配上', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 1]])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', 2]])
    const ruleTable: RuleTablePair = { left: { '5,3': '' }, right: {} }
    const res = check(l, r, 0.0001, ruleTable)
    expect(res.totalCompared).toBe(0)
    expect(res.diffs).toHaveLength(0)
    expect(res.onlyInLeft).toHaveLength(0)
    // 清空只作用于该侧：对侧那个规则值没有对应，按规格进「未配上」清单
    expect(res.onlyInRight.map((e) => e.rule)).toEqual(['甲_乙'])
  })

  it('两侧都清空则两侧都不出现（彻底忽略）', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 1]])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', 2]])
    const ruleTable: RuleTablePair = { left: { '5,3': '' }, right: { '5,3': '' } }
    const res = check(l, r, 0.0001, ruleTable)
    expect(res.totalCompared).toBe(0)
    expect(res.diffs).toHaveLength(0)
    expect(res.onlyInLeft).toHaveLength(0)
    expect(res.onlyInRight).toHaveLength(0)
  })

  it('规则值在一侧重复时该值整体不配对，且进 duplicateRules', () => {
    const l = tsheet('R06', [
      [5, 3, '甲', '乙', 1],
      [6, 3, '甲', '乙', 2]
    ])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', 1]])
    const res = check(l, r)
    expect(res.totalCompared).toBe(0)
    expect(res.diffs).toHaveLength(0)
    expect(res.duplicateRules).toEqual([{ side: 'left', rule: '甲_乙', count: 2 }])
    expect(res.onlyInLeft).toHaveLength(0)
    expect(res.onlyInRight).toHaveLength(0)
  })

  it('相对差超过阈值标记 diff', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 1.2]])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', 1]])
    const res = check(l, r)
    expect(res.diffs[0].kind).toBe('diff')
    expect(res.diffs[0].relDiff).toBeCloseTo(1 / 6, 10)
  })

  it('相对差恰好等于阈值不标记（严格大于）', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 2]])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', 1]])
    // |2-1| / max(2,1) = 0.5，阈值取同一个算式算出的值，规避浮点误差
    const res = check(l, r, Math.abs(2 - 1) / Math.max(2, 1))
    expect(res.diffs).toHaveLength(0)
  })

  it('双 0 跳过、两侧都无数值跳过', () => {
    const l = tsheet('R06', [
      [5, 3, '甲', '乙', 0],
      [6, 3, '甲', '丙', null],
      [7, 3, '甲', '丁', '文本']
    ])
    const r = tsheet('NR06', [
      [5, 3, '甲', '乙', 0],
      [6, 3, '甲', '丙', null],
      [7, 3, '甲', '丁', '文本']
    ])
    expect(check(l, r).diffs).toHaveLength(0)
  })

  it('一侧有值一侧为空记单侧有值', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 1]])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', null]])
    const res = check(l, r)
    expect(res.diffs).toHaveLength(1)
    expect(res.diffs[0].kind).toBe('left-only-value')
    expect(res.diffs[0].relDiff).toBeNull()
  })

  it('负值与千分位文本贯通数值化', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', '-1,200']])
    const r = tsheet('NR06', [[5, 3, '甲', '乙', -600]])
    const res = check(l, r)
    expect(res.diffs[0].leftNum).toBe(-1200)
    expect(res.diffs[0].relDiff).toBeCloseTo(0.5, 10)
  })

  it('解析失败的表返回空结果', () => {
    const l = tsheet('R06', [[5, 3, '甲', '乙', 1]])
    const bad: TemplateSheet = { ...tsheet('NR06', []), error: '工作簿中没有工作表' }
    const res = check(l, bad)
    expect(res.diffs).toHaveLength(0)
    expect(res.totalCompared).toBe(0)
  })
})

// ——— 表对配对 ———

describe('pairTemplateWorkbooks', () => {
  const wb = (fileName: string, id = fileName): WorkbookData => ({
    id,
    fileName,
    source: 'file',
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
    expect(res.unmatchedLeft).toEqual(['附件2.xls'])
  })

  it('同号多候选时不自动配对（交给人工）', () => {
    const res = pairTemplateWorkbooks([wb('R06.xls')], [wb('NR06.xls'), wb('NR06-副本.xls')])
    expect(res.pairs).toHaveLength(0)
    expect(res.unmatchedLeft).toEqual(['R06.xls'])
  })

  it('manualTablePairs 优先并占用名额', () => {
    const res = pairTemplateWorkbooks([wb('R06.xls')], [wb('NR06.xls')], [
      { leftId: 'R06.xls', rightId: 'NR06.xls' }
    ])
    expect(res.pairs).toHaveLength(1)
    expect(res.unmatchedLeft).toEqual([])
    expect(res.unmatchedRight).toEqual([])
  })
})
