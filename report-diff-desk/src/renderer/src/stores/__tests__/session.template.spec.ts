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
/** 桩每次核对返回的表对；个别用例会换成别的组合 */
let stubPairs: TemplatePairResult[]

function installApi(): void {
  storedConfig = { version: 2, ruleTables: {} }
  setCalls = []
  lastRequest = {}
  stubPairs = [pairResult('6', 'R06', 'NR06'), pairResult('31', 'R31', 'NR31')]
  const result = (): TemplateCheckResult => ({
    pairs: stubPairs,
    unmatchedLeft: [],
    unmatchedRight: [],
    threshold: 0.0001,
    totalDiffs: 0,
    generatedAt: '2026-09-21T00:00:00.000Z'
  })
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
        return Promise.resolve(cloneThroughIpc(result()))
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

  it('核对后停在原来那张表对上，不弹回第 1 对', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    expect(s.templatePairIndex).toBe(0)

    s.templatePairIndex = 1 // 切到第 2 对（R31|NR31）
    await s.runTemplateCheck() // 主动核对（改阈值/锚点词后的路径）
    expect(s.templatePairIndex).toBe(1)

    s.ruleDrafts['R31|NR31'] = { left: {}, right: {} }
    await s.saveRuleTable()
    expect(s.templatePairIndex).toBe(1)
  })

  it('表对顺序变了跟着标识走；整组换了则按下标夹回合法范围', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    await s.runTemplateCheck()
    s.templatePairIndex = 1 // R31|NR31

    stubPairs = [pairResult('31', 'R31', 'NR31'), pairResult('6', 'R06', 'NR06')]
    await s.runTemplateCheck()
    expect(s.templatePairIndex).toBe(0) // 跟着标识走，而不是死守下标 1

    stubPairs = [pairResult('6', 'R06', 'NR06')]
    await s.runTemplateCheck()
    expect(s.templatePairIndex).toBe(0) // 原表对不在了 → 夹回合法范围
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

  it('reseedRuleTable 只用种子重建：人工修改与存档值都丢掉', async () => {
    storedConfig = {
      version: 2,
      ruleTables: { 'R06|NR06': { left: { '5,3': '存档值' }, right: {} } }
    }
    const s = useSessionStore()
    seedPair()
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    s.initRuleDraft()
    expect(s.activeRuleDraft?.left['5,3']).toBe('存档值') // 初次进入草稿吃存档

    s.ruleDrafts['R06|NR06'].left['5,3'] = '改过的'
    s.reseedRuleTable()
    expect(s.activeRuleDraft?.left['5,3']).toBe('甲_乙') // 重新填充只吃种子
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

  it('restoreSavedRuleTable 用存档覆盖草稿，且草稿与配置互不影响', async () => {
    storedConfig = {
      version: 2,
      ruleTables: { 'R06|NR06': { left: { '5,3': '存档值' }, right: {} } }
    }
    const s = useSessionStore()
    seedPair()
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    s.initRuleDraft()
    s.ruleDrafts['R06|NR06'].left['5,3'] = '草稿改动'

    expect(s.restoreSavedRuleTable()).toBe(true)
    expect(s.activeRuleDraft?.left['5,3']).toBe('存档值')
    expect(s.ruleDirty).toBe(false)
    // 深拷贝：接着改草稿不能连带改到配置基准
    s.ruleDrafts['R06|NR06'].left['5,3'] = '再改'
    expect(s.alignConfig?.ruleTables['R06|NR06'].left['5,3']).toBe('存档值')
  })

  it('本表对没有存档时 restoreSavedRuleTable 返回 false 且不动草稿', async () => {
    const s = useSessionStore()
    seedPair()
    s.alignConfig = await window.api.getAlignConfig()
    await s.runTemplateCheck()
    s.initRuleDraft()
    s.ruleDrafts['R06|NR06'].left['5,3'] = '草稿'

    expect(s.restoreSavedRuleTable()).toBe(false)
    expect(s.activeRuleDraft?.left['5,3']).toBe('草稿')
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
  it('默认「项目」；清空后生效值回落到默认', () => {
    const s = useSessionStore()
    expect(s.anchors).toEqual(['项目'])
    expect(s.effectiveAnchors).toEqual(['项目'])
    s.anchors = []
    expect(s.effectiveAnchors).toEqual(['项目'])
    // el-input-tag 的「清空」emit 的是 undefined
    s.anchors = undefined as unknown as string[]
    expect(s.effectiveAnchors).toEqual(['项目'])
  })

  it('列表里的多个词随核对请求一起发出（各报表自取命中项）', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.anchors = ['项目', '机构类别']
    await s.runTemplateCheck()
    expect(lastRequest.anchors).toEqual(['项目', '机构类别'])
  })

  it('reloadAlignConfig 回填列表（盘上没有就用默认）；saveAnchors 写盘且不动已有规则表', async () => {
    storedConfig = {
      version: 2,
      ruleTables: { 'R06|NR06': { left: { '5,3': '甲_乙' }, right: {} } },
      anchors: ['机构类别']
    }
    const s = useSessionStore()
    await s.reloadAlignConfig()
    expect(s.anchors).toEqual(['机构类别'])
    s.anchors = ['项目', '机构类别']
    await s.saveAnchors()
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0].anchors).toEqual(['项目', '机构类别'])
    expect(setCalls[0].ruleTables['R06|NR06'].left['5,3']).toBe('甲_乙')
  })

  it('保存规则表时不丢锚点词', async () => {
    const s = useSessionStore()
    s.templateLeft = [wb('L', 'R06.xls')]
    s.templateRight = [wb('R', 'NR06.xls')]
    s.alignConfig = await window.api.getAlignConfig()
    s.anchors = ['项目', '机构类别']
    await s.runTemplateCheck()
    s.initRuleDraft()
    await s.saveRuleTable()
    expect(setCalls).toHaveLength(1)
    expect(setCalls[0].anchors).toEqual(['项目', '机构类别'])
  })
})
