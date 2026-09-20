import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { AlignConfig, WorkbookData } from '@shared/types'
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

  it('真实文件能定位到锚点并提取出行/列路径', () => {
    const t = parseWorkbook(load('R06.xls'))
    expect(t.error).toBeUndefined()
    // 项 目 锚点在 A4:C5，故表头行 3~4、标签列 A~C、数据从 D 列第 6 行起（0 起始）
    expect(t.headerRange).toEqual({ r1: 3, c1: 0, r2: 4, c2: 2 })
    expect(t.dataStartRow).toBe(5)
    expect(t.dataStartCol).toBe(3)
    expect(t.cells.length).toBeGreaterThan(0)
    expect(t.cells.every((c) => c.rowPath !== '')).toBe(true)
  })

  it('R06 ↔ NR06：跨行偏移仍能配对，命中 2 处超阈值差异', () => {
    const res = checkTemplates(parseWorkbook(load('R06.xls')), parseWorkbook(load('NR06.xls')), {
      threshold: T
    })
    expect(res.left?.error).toBeUndefined()
    expect(res.right?.error).toBeUndefined()

    const hit = (rowPath: string, l: string, r: string): boolean =>
      res.diffs.some(
        (d) => d.rowPath === rowPath && d.kind === 'diff' && d.leftText === l && d.rightText === r
      )
    // R06 第 9 行 ↔ NR06 第 10 行：1.2 vs 1（16.7%）
    expect(hit('贴现/商业承兑汇票/3个月（含）以内', '1.2', '1')).toBe(true)
    // R06 第 17 行 ↔ NR06 第 21 行：1.1 vs 1（9.09%）
    expect(hit('转贴现/票据回购/6个月—1年（含）', '1.1', '1')).toBe(true)

    // NR06 有合计行而 R06 没有 → 进「仅单侧存在」，不得混进差异列表
    expect(res.onlyInRight.some((e) => e.rowPath.endsWith('/合计'))).toBe(true)
    expect(res.diffs.some((d) => d.rowPath.endsWith('/合计'))).toBe(false)
  })

  it('R31 ↔ NR31：无人工规则时，丢了父标签的活期组只在右侧存在', () => {
    const res = checkTemplates(parseWorkbook(load('R31.xls')), parseWorkbook(load('NR31.xls')), {
      threshold: T
    })
    expect(res.left?.error).toBeUndefined()
    expect(res.right?.error).toBeUndefined()
    // R31 的 A6:B7 是空合并格，活期组只剩「单位存款」/「个人存款」，配不上 NR31 的「一、活期/…」
    expect(res.onlyInRight.some((e) => e.rowPath === '一、活期/单位存款')).toBe(true)
    expect(res.onlyInLeft.some((e) => e.rowPath === '单位存款')).toBe(true)
  })

  it('R31 ↔ NR31：人工配对（行级）后整行按列路径重比，含阈值下沿', () => {
    const l = parseWorkbook(load('R31.xls'))
    const r = parseWorkbook(load('NR31.xls'))
    // 三条规则指向同一对行（左 5 ↔ 右 5），行级语义下去重只算一次配对
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [3, 12, 13].map((col) => ({
        left: 'R31',
        right: 'NR31',
        fromRow: 5,
        fromCol: col,
        toRow: 5,
        toCol: col
      }))
    }
    const res = checkTemplates(l, r, { threshold: T, config: cfg })

    expect(res.manualPairs).toBe(1)
    // 行对齐后逐列重比，3 处超阈值：D=(-∞,-30) 9.09%、E=[-30,-10) 4.76%、N=合计 1.04%
    const manual = res.diffs.filter((d) => d.manual)
    expect(manual).toHaveLength(3)
    expect(manual.some((d) => d.leftText === '1.1' && d.rightText === '1')).toBe(true)
    expect(manual.some((d) => d.leftText === '2.1' && d.rightText === '2')).toBe(true)
    expect(manual.some((d) => d.leftText === '19.2001' && d.rightText === '19')).toBe(true)
    // 阈值下沿：2.0001 vs 2 = 0.005%，必须不标
    expect(manual.some((d) => d.leftText === '2.0001')).toBe(false)
    // 行级接管后，两行自动结果全清，不再残留「仅单侧存在」
    expect(res.onlyInLeft.some((e) => e.rowPath === '单位存款')).toBe(false)
    expect(res.onlyInRight.some((e) => e.rowPath === '一、活期/单位存款')).toBe(false)
  })

  it('忽略规则能压掉指定格', () => {
    const cfg: AlignConfig = {
      version: 1,
      templates: {},
      pairs: [{ left: 'R06', right: 'NR06', fromRow: 8, fromCol: 3, ignored: true }]
    }
    const res = checkTemplates(parseWorkbook(load('R06.xls')), parseWorkbook(load('NR06.xls')), {
      threshold: T,
      config: cfg
    })
    expect(res.diffs.some((d) => d.leftRow === 8 && d.leftCol === 3)).toBe(false)
  })
})
