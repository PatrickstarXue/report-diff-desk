import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../session'
import type {
  AlignConfig,
  TemplateCellRef,
  TemplateCheckResult,
  TemplatePairResult,
  TemplateSheet,
  WorkbookData
} from '@shared/types'

/** 桩：IPC 边界就是结构化克隆，入参进桩先 clone——忠实模拟 Electron 的接收行为 */
const cloneThroughIpc = structuredClone

const seedCell = (): TemplateCellRef => ({
  row: 5,
  col: 3,
  rowPath: '甲',
  colPath: '乙',
  text: '1',
  num: 1,
  seed: '甲_乙'
})

const seedSheet = (key: string, fileName: string, workbookId: string): TemplateSheet => ({
  key,
  tableNo: key.replace(/^[A-Za-z]+/, ''),
  fileName,
  workbookId,
  sheetName: key,
  degraded: false,
  cells: [seedCell()]
})

/** 造一个表对结果；桩固定返回两对（R06/NR06 与 R31/NR31），好让「保留表对索引」可被区分 */
const pairResult = (tableNo: string, leftKey: string, rightKey: string): TemplatePairResult => ({
  tableNo,
  leftFile: `${leftKey}.xls`,
  rightFile: `${rightKey}.xls`,
  left: seedSheet(leftKey, `${leftKey}.xls`, 'L'),
  right: seedSheet(rightKey, `${rightKey}.xls`, 'R'),
  diffs: [],
  duplicateRules: [],
  onlyInLeft: [],
  onlyInRight: [],
  totalCompared: 1
})

let storedConfig: AlignConfig
let setCalls: AlignConfig[]
let lastRequest: Record<string, unknown>

function installApi(): void {
  storedConfig = { version: 2, ruleTables: {} }
  setCalls = []
  lastRequest = {}
  const result: TemplateCheckResult = {
    pairs: [pairResult('6', 'R06', 'NR06'), pairResult('31', 'R31', 'NR31')],
    unmatchedLeft: [],
    unmatchedRight: [],
    threshold: 0.0001,
    totalDiffs: 0,
    generatedAt: '2026-09-21T00:00:00.000Z'
  }
  vi.stubGlobal('window', {
    api: {
      getAlignConfig: () => Promise.resolve(cloneThroughIpc(storedConfig)),
      setAlignConfig: (cfg: AlignConfig) => {
        const plain = cloneThroughIpc(cfg)
        setCalls.push(plain)
        storedConfig = plain
        return Promise.resolve()
      },
      checkTemplate: (req: Record<string, unknown>) => {
        lastRequest = cloneThroughIpc(req)
        return Promise.resolve(cloneThroughIpc(result))
      }
    }
  })
}

const wb = (id: string, fileName: string): WorkbookData => ({
  id,
  fileName,
  source: 'file',
  sheetNames: [],
  sheets: {}
})

beforeEach(() => {
  setActivePinia(createPinia())
  installApi()
})

describe('runTemplateCheck', () => {
  it('请求载荷可被结构化克隆（Pinia Proxy 不得直传）', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.manualTablePairs = [{ leftId: 'L', rightId: 'R' }]
    await expect(s.runTemplateCheck()).resolves.toBeUndefined()
  })

  it('规则表草稿并入请求载荷', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.ruleDrafts = { 'R06|NR06': { left: { '5,3': '甲_乙' }, right: {} } }
    await s.runTemplateCheck()
    expect(lastRequest.ruleTables).toEqual({ 'R06|NR06': { left: { '5,3': '甲_乙' }, right: {} } })
  })

  it('保存触发的核对保留表对索引；主动核对回到第 1 对', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    expect(s.templatePairIndex).toBe(0)

    s.templatePairIndex = 1 // 切到第 2 对（R31|NR31）
    s.ruleDrafts['R31|NR31'] = { left: {}, right: {} }
    await s.saveRuleTable()
    expect(s.templatePairIndex).toBe(1) // 保存不该把用户弹回第 1 对

    await s.runTemplateCheck()
    expect(s.templatePairIndex).toBe(0) // 主动核对才回到第 1 对
  })
})

describe('规则表草稿', () => {
  const seedPair = (): void => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
  }

  it('initRuleDraft 用种子补齐缺席位置，已保存的值优先', async () => {
    storedConfig = {
      version: 2,
      ruleTables: { 'R06|NR06': { left: { '5,3': '人工值' }, right: {} } }
    }
    const s = useSessionStore()
    seedPair()
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    s.initRuleDraft()
    const d = s.activeRuleDraft
    expect(d?.left['5,3']).toBe('人工值')
    expect(d?.right['5,3']).toBe('甲_乙')
  })

  it('reseedRuleTable 丢弃人工修改', async () => {
    const s = useSessionStore()
    seedPair()
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    s.initRuleDraft()
    s.ruleDrafts['R06|NR06'].left['5,3'] = '改过的'
    s.reseedRuleTable()
    expect(s.activeRuleDraft?.left['5,3']).toBe('甲_乙')
    expect(s.ruleDirty).toBe(false)
  })

  it('saveRuleTable 深拷贝后写盘并清除脏标记', async () => {
    const s = useSessionStore()
    seedPair()
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    s.initRuleDraft()
    s.ruleDrafts['R06|NR06'].left['5,3'] = '甲_乙（改）'
    s.ruleDirty = true
    await s.saveRuleTable()
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0].ruleTables['R06|NR06'].left['5,3']).toBe('甲_乙（改）')
    expect(s.ruleDirty).toBe(false)
    expect(s.alignConfig?.ruleTables['R06|NR06'].left['5,3']).toBe('甲_乙（改）')
  })

  it('配置未就绪时拒绝保存，避免以空基准覆盖盘上规则', async () => {
    const s = useSessionStore()
    seedPair()
    await s.runTemplateCheck()
    s.initRuleDraft()
    s.alignConfig = null
    await expect(s.saveRuleTable()).rejects.toThrow('配置未就绪')
    expect(setCalls).toHaveLength(0)
  })
})

describe('锚点词', () => {
  it('按顿号/逗号切分多个候选；空输入回落到默认「项目」', () => {
    const s = useSessionStore()
    expect(s.anchorList).toEqual(['项目'])
    s.anchorText = '期限、科目'
    expect(s.anchorList).toEqual(['期限', '科目'])
    s.anchorText = '   '
    expect(s.anchorList).toEqual(['项目'])
  })

  it('核对请求带上锚点词候选', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.anchorText = '期限'
    await s.runTemplateCheck()
    expect(lastRequest.anchors).toEqual(['期限'])
  })

  it('reloadAlignConfig 回填输入框；saveAnchors 写盘且不动已有规则表', async () => {
    storedConfig = {
      version: 2,
      ruleTables: { 'R06|NR06': { left: { '5,3': '甲_乙' }, right: {} } },
      anchors: ['期限']
    }
    const s = useSessionStore()
    await s.reloadAlignConfig()
    expect(s.anchorText).toBe('期限')
    s.anchorText = '期限、科目'
    await s.saveAnchors()
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0].anchors).toEqual(['期限', '科目'])
    expect(setCalls[0].ruleTables['R06|NR06'].left['5,3']).toBe('甲_乙')
  })

  it('保存规则表时不丢锚点词', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.alignConfig = await window.api.getAlignConfig()
    s.anchorText = '期限'
    await s.runTemplateCheck()
    s.initRuleDraft()
    await s.saveRuleTable()
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0].anchors).toEqual(['期限'])
  })
})
