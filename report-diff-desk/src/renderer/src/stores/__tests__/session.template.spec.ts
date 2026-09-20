import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  AlignConfig,
  CellRange,
  TemplateCheckResult,
  TemplatePairResult,
  TemplateSheet,
  WorkbookData
} from '@shared/types'
import { useSessionStore } from '../session'

/**
 * 还原 Electron IPC 边界：ipcRenderer.invoke 的入参在送达主进程前会被结构化克隆，
 * Vue 响应式 Proxy 过不去，会抛 DataCloneError（"An object could not be cloned."）。
 * 每个桩方法在处理入参时先 clone 一次，从而真实复现该故障。
 */
function cloneThroughIpc<T>(arg: T): T {
  return structuredClone(arg)
}

const EMPTY_RESULT: TemplateCheckResult = {
  pairs: [],
  unmatchedLeft: [],
  unmatchedRight: [],
  threshold: 0,
  totalDiffs: 0,
  generatedAt: ''
}

const plainWorkbook = (id: string): WorkbookData => ({
  id,
  fileName: `${id}.xlsx`,
  source: 'zip',
  sheetNames: [],
  sheets: {}
})

/** 盘上已有的规则（getAlignConfig 返回的普通对象） */
const STORED_CONFIG: AlignConfig = {
  version: 1,
  templates: { R06: { headerRange: { r1: 0, c1: 0, r2: 0, c2: 0 } } },
  pairs: [{ left: 'R06', right: 'NR06', fromRow: 0, fromCol: 0, ignored: true }]
}

// —— 核对结果构造器（TemplateSheet 字段较多，集中一处） ——

function templateSheet(key: string, error?: string): TemplateSheet {
  return {
    key,
    tableNo: key.replace(/^[A-Za-z]+/, '') || null,
    fileName: `${key}.xlsx`,
    workbookId: key,
    sheetName: 'Sheet1',
    headerRange: { r1: 3, c1: 0, r2: 4, c2: 2 },
    labelEnd: 2,
    dataStartRow: 5,
    dataStartCol: 3,
    cells: [],
    manualHeader: true,
    ...(error ? { error } : {})
  }
}

function pairResult(left: TemplateSheet, right: TemplateSheet): TemplatePairResult {
  return {
    tableNo: left.tableNo ?? right.tableNo,
    pairLabel: `${left.fileName} ↔ ${right.fileName}`,
    leftFile: left.fileName,
    rightFile: right.fileName,
    left,
    right,
    diffs: [],
    onlyInLeft: [],
    onlyInRight: [],
    totalCompared: 1,
    manualPairs: 0
  }
}

function checkResult(pairs: TemplatePairResult[]): TemplateCheckResult {
  return {
    pairs,
    unmatchedLeft: [],
    unmatchedRight: [],
    threshold: 0,
    totalDiffs: 0,
    generatedAt: ''
  }
}

/** 手动指定的坏范围（把整个数据区框进去） */
const BAD_RANGE: CellRange = { r1: 5, c1: 3, r2: 23, c2: 14 }
/** 样例报表的正确表头区 */
const GOOD_RANGE: CellRange = { r1: 3, c1: 0, r2: 4, c2: 2 }

interface Stub {
  checkTemplate: ReturnType<typeof vi.fn>
  getAlignConfig: ReturnType<typeof vi.fn>
  setAlignConfig: ReturnType<typeof vi.fn>
}

let api: Stub
/** 盘上配置（setAlignConfig 写入、getAlignConfig/checkTemplate 读取） */
let stored: AlignConfig
/** 核对桩：按「盘上配置」返回结果，默认为空结果 */
let checkImpl: (cfg: AlignConfig) => TemplateCheckResult

beforeEach(() => {
  setActivePinia(createPinia())
  stored = structuredClone(STORED_CONFIG)
  checkImpl = () => EMPTY_RESULT
  api = {
    checkTemplate: vi.fn((req: unknown) => {
      cloneThroughIpc(req)
      return Promise.resolve(checkImpl(stored))
    }),
    getAlignConfig: vi.fn(() => Promise.resolve(structuredClone(stored))),
    setAlignConfig: vi.fn((cfg: unknown) => {
      cloneThroughIpc(cfg)
      stored = structuredClone(cfg as AlignConfig)
      return Promise.resolve()
    })
  }
  vi.stubGlobal('window', { api })
})

describe('runTemplateCheck 的 IPC 载荷', () => {
  it('非空 manualTablePairs 经 IPC 边界可结构化克隆', async () => {
    const store = useSessionStore()
    store.templateLeft = [plainWorkbook('R06')]
    store.templateRight = [plainWorkbook('NR06')]
    store.manualTablePairs = [{ leftId: 'R06', rightId: 'NR06' }]

    await expect(store.runTemplateCheck()).resolves.toBeUndefined()
    expect(api.checkTemplate).toHaveBeenCalledTimes(1)
  })

  it('空 manualTablePairs（首次点「开始核对」）经 IPC 边界可结构化克隆', async () => {
    const store = useSessionStore()
    store.templateLeft = [plainWorkbook('R06')]
    store.templateRight = [plainWorkbook('NR06')]

    await expect(store.runTemplateCheck()).resolves.toBeUndefined()
    expect(api.checkTemplate).toHaveBeenCalledTimes(1)
  })
})

describe('saveAlignConfig 的 IPC 载荷', () => {
  it('响应式 state 派生出的配置经 IPC 边界可结构化克隆，且以纯对象写入', async () => {
    const store = useSessionStore()
    store.alignConfig = await window.api.getAlignConfig()

    // 模拟 TemplatePanel.saveRules / clearTableRules：以 store（reactive）为基准合并出配置
    const cfg: AlignConfig = {
      version: 1,
      templates: store.alignConfig!.templates,
      pairs: [...store.alignConfig!.pairs]
    }

    await expect(store.saveAlignConfig(cfg)).resolves.toBeUndefined()

    expect(api.setAlignConfig).toHaveBeenCalledTimes(1)
    const received = api.setAlignConfig.mock.calls[0][0] as AlignConfig
    expect(() => cloneThroughIpc(received)).not.toThrow()
    expect(received).toEqual(STORED_CONFIG)
  })
})

describe('runTemplateCheck 的表对索引', () => {
  const twoPairs = (): TemplateCheckResult =>
    checkResult([
      pairResult(templateSheet('R06'), templateSheet('NR06')),
      pairResult(templateSheet('R31'), templateSheet('NR31'))
    ])

  function readyStore(): ReturnType<typeof useSessionStore> {
    const store = useSessionStore()
    store.templateLeft = [plainWorkbook('R06'), plainWorkbook('R31')]
    store.templateRight = [plainWorkbook('NR06'), plainWorkbook('NR31')]
    return store
  }

  it('保存规则触发的重新核对保留当前表对索引', async () => {
    const store = readyStore()
    checkImpl = twoPairs
    await store.runTemplateCheck()
    store.templatePairIndex = 1

    await store.saveAlignConfig({ version: 1, templates: {}, pairs: [] })

    expect(store.templatePairIndex).toBe(1)
  })

  it('重新核对后表对变少时索引被夹到合法范围', async () => {
    const store = readyStore()
    checkImpl = twoPairs
    await store.runTemplateCheck()
    store.templatePairIndex = 1

    checkImpl = () => checkResult([pairResult(templateSheet('R06'), templateSheet('NR06'))])
    await store.saveAlignConfig({ version: 1, templates: {}, pairs: [] })

    expect(store.templatePairIndex).toBe(0)
  })

  it('重新核对后表对为空时索引归 0', async () => {
    const store = readyStore()
    checkImpl = twoPairs
    await store.runTemplateCheck()
    store.templatePairIndex = 1

    checkImpl = () => checkResult([])
    await store.saveAlignConfig({ version: 1, templates: {}, pairs: [] })

    expect(store.templatePairIndex).toBe(0)
  })

  it('用户主动「开始核对」时回到第 1 对', async () => {
    const store = readyStore()
    checkImpl = twoPairs
    await store.runTemplateCheck()
    store.templatePairIndex = 1

    await store.runTemplateCheck()

    expect(store.templatePairIndex).toBe(0)
  })
})

describe('setTemplateHeaderRange 的范围校验与回滚', () => {
  /** 候选范围被写盘时返回该侧 error，模拟「坏范围把表弄坏」 */
  function badRangeImpl(cfg: AlignConfig): TemplateCheckResult {
    const r = cfg.templates.R06?.headerRange
    const bad = !!r && r.r1 === BAD_RANGE.r1 && r.c1 === BAD_RANGE.c1
    return checkResult([
      pairResult(
        templateSheet('R06', bad ? '表头区未识别到数据列，请手动指定表样范围' : undefined),
        templateSheet('NR06')
      )
    ])
  }

  async function readyStore(): Promise<ReturnType<typeof useSessionStore>> {
    const store = useSessionStore()
    store.templateLeft = [plainWorkbook('R06')]
    store.templateRight = [plainWorkbook('NR06')]
    store.templateSide = 'left'
    await store.reloadAlignConfig()
    await store.runTemplateCheck()
    return store
  }

  it('坏范围导致该侧解析失败时回滚到改动前的范围', async () => {
    checkImpl = badRangeImpl
    const store = await readyStore()

    const ok = await store.setTemplateHeaderRange(BAD_RANGE)

    expect(ok).toBe(false)
    expect(api.setAlignConfig).toHaveBeenCalledTimes(2)
    // 第二次写盘是回滚：等于改动前的配置
    expect(api.setAlignConfig.mock.calls[1][0]).toEqual(STORED_CONFIG)
    expect(store.alignConfig!.templates.R06?.headerRange).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 })
  })

  it('改动前不存在该表样条目时，回滚是删除条目而非写空对象', async () => {
    stored = { version: 1, templates: {}, pairs: [] }
    checkImpl = badRangeImpl
    const store = await readyStore()

    const ok = await store.setTemplateHeaderRange(BAD_RANGE)

    expect(ok).toBe(false)
    expect(api.setAlignConfig).toHaveBeenCalledTimes(2)
    expect(Object.prototype.hasOwnProperty.call(store.alignConfig!.templates, 'R06')).toBe(false)
  })

  it('好范围被接受：写盘一次、配置更新、返回 true', async () => {
    checkImpl = () => checkResult([pairResult(templateSheet('R06'), templateSheet('NR06'))])
    const store = await readyStore()

    const ok = await store.setTemplateHeaderRange(GOOD_RANGE)

    expect(ok).toBe(true)
    expect(api.setAlignConfig).toHaveBeenCalledTimes(1)
    expect(store.alignConfig!.templates.R06?.headerRange).toEqual(GOOD_RANGE)
  })

  it('写盘载荷经 IPC 边界可结构化克隆', async () => {
    checkImpl = badRangeImpl
    const store = await readyStore()

    await store.setTemplateHeaderRange(BAD_RANGE)

    for (const call of api.setAlignConfig.mock.calls) {
      expect(() => cloneThroughIpc(call[0])).not.toThrow()
    }
  })
})
