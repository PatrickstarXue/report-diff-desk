import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { RuleTablePair, TemplateSheet, WorkbookData } from '@shared/types'
import { parseExcel } from '../excel'
import { checkTemplates, pairTemplateWorkbooks, parseWorkbook } from '@shared/core/template'

const DIR = resolve(__dirname, '../../../../samples/similarSample')
const FILES = ['R06.xls', 'NR06.xls', 'R31.xls', 'NR31.xls']

/** 真实样例缺失时整组跳过（samples/ 在 .gitignore 里，不保证每台机器都有） */
const hasSamples = FILES.every((f) => existsSync(resolve(DIR, f)))

/** 走生产解析路径，不用测试自造的对象 */
function load(name: string): WorkbookData {
  return parseExcel(readFileSync(resolve(DIR, name)), name, 'file')
}

/** 阈值 0.01%（与界面默认值一致） */
const T = 0.0001

const cellAt = (t: TemplateSheet, row: number, col: number) =>
  t.cells.find((c) => c.row === row && c.col === col)

describe.skipIf(!hasSamples)('表样核对 · 真实样例端到端', () => {
  const left = FILES.filter((f) => f.startsWith('R')).map(load)
  const right = FILES.filter((f) => f.startsWith('NR')).map(load)

  it('按表号自动配对出 2 对，无未配对文件', () => {
    const p = pairTemplateWorkbooks(left, right)
    expect(p.pairs.map((x) => [x.left.fileName, x.right.fileName])).toEqual([
      ['R06.xls', 'NR06.xls'],
      ['R31.xls', 'NR31.xls']
    ])
    expect(p.unmatchedLeft).toEqual([])
    expect(p.unmatchedRight).toEqual([])
  })

  it('真实文件能定位到锚点，种子即「行路径_列路径」', () => {
    const t = parseWorkbook(load('R06.xls'))
    expect(t.error).toBeUndefined()
    expect(t.degraded).toBe(false)
    expect(t.cells.length).toBeGreaterThan(0)
    const c = cellAt(t, 5, 3)
    expect(c?.rowPath).toBe('贴现/银行承兑汇票/3个月（含）以内')
    expect(c?.colPath).toBe('发生额')
    expect(c?.seed).toBe('贴现/银行承兑汇票/3个月（含）以内_发生额')
  })

  it('R06 ↔ NR06：种子等值配对，命中 2 处超阈值差异', () => {
    const res = checkTemplates(parseWorkbook(load('R06.xls')), parseWorkbook(load('NR06.xls')), {
      threshold: T
    })
    expect(res.left?.error).toBeUndefined()
    expect(res.right?.error).toBeUndefined()

    const hit = (rule: string, l: string, r: string): boolean =>
      res.diffs.some(
        (d) => d.rule === rule && d.kind === 'diff' && d.leftText === l && d.rightText === r
      )
    // 跨行偏移（R06 r9 ↔ NR06 r10）也靠等值规则配对成功
    expect(hit('贴现/商业承兑汇票/3个月（含）以内_发生额', '1.2', '1')).toBe(true)
    expect(hit('转贴现/票据回购/6个月—1年（含）_发生额', '1.1', '1')).toBe(true)

    // NR06 有合计行而 R06 没有 → 其规则值只在右侧出现
    expect(res.onlyInRight.some((e) => e.rule.endsWith('/合计_发生额'))).toBe(true)
    expect(res.diffs.some((d) => d.rule.endsWith('/合计_发生额'))).toBe(false)
  })

  it('R31 ↔ NR31：命中 3 处超阈值差异，含阈值下沿', () => {
    const res = checkTemplates(parseWorkbook(load('R31.xls')), parseWorkbook(load('NR31.xls')), {
      threshold: T
    })
    expect(res.left?.error).toBeUndefined()
    expect(res.right?.error).toBeUndefined()
    expect(res.totalCompared).toBeGreaterThan(0)
    // D=(-∞,-30) 1.1 vs 1（9.09%）、E=[-30,-10) 2.1 vs 2（4.76%）、N=合计 19.2001 vs 19（1.04%）
    expect(res.diffs.some((d) => d.leftText === '1.1' && d.rightText === '1')).toBe(true)
    expect(res.diffs.some((d) => d.leftText === '2.1' && d.rightText === '2')).toBe(true)
    expect(res.diffs.some((d) => d.leftText === '19.2001' && d.rightText === '19')).toBe(true)
    // 阈值下沿：2.0001 vs 2 = 0.005%，必须不标
    expect(res.diffs.some((d) => d.leftText === '2.0001')).toBe(false)
  })

  it('R31 ↔ NR31：走规则表路径仍命中同样 3 处', () => {
    const l = parseWorkbook(load('R31.xls'))
    const r = parseWorkbook(load('NR31.xls'))
    // 把左侧第 5、6 行（0 起始）的规则值改成与右侧同位置一致。
    // 两侧本来就一致时这是一次空操作；不一致（缺父级标签）时正是人工对齐的路径。
    const ruleTable: RuleTablePair = { left: {}, right: {} }
    for (const row of [5, 6]) {
      for (const c of l.cells.filter((x) => x.row === row)) {
        const rc = cellAt(r, c.row, c.col)
        if (rc) ruleTable.left[`${c.row},${c.col}`] = rc.seed
      }
    }
    const res = checkTemplates(l, r, { threshold: T, ruleTable })

    expect(res.totalCompared).toBeGreaterThan(0)
    expect(res.diffs.some((d) => d.leftText === '1.1' && d.rightText === '1')).toBe(true)
    expect(res.diffs.some((d) => d.leftText === '2.1' && d.rightText === '2')).toBe(true)
    expect(res.diffs.some((d) => d.leftText === '19.2001' && d.rightText === '19')).toBe(true)
    expect(res.diffs.some((d) => d.leftText === '2.0001')).toBe(false)
  })

  it('清空某格规则值即把它排除出比对', () => {
    const l = parseWorkbook(load('R06.xls'))
    const r = parseWorkbook(load('NR06.xls'))
    const target = checkTemplates(l, r, { threshold: T }).diffs.find((d) => d.leftText === '1.2')
    expect(target).toBeDefined()
    const ruleTable: RuleTablePair = {
      left: { [`${target!.leftRow},${target!.leftCol}`]: '' },
      right: {}
    }
    const res = checkTemplates(l, r, { threshold: T, ruleTable })
    expect(res.diffs.some((d) => d.leftText === '1.2')).toBe(false)
  })
})
