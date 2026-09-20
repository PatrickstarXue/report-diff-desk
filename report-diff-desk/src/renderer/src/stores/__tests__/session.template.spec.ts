import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AlignConfig, TemplateCheckResult, WorkbookData } from '@shared/types'
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

interface Stub {
  checkTemplate: ReturnType<typeof vi.fn>
  getAlignConfig: ReturnType<typeof vi.fn>
  setAlignConfig: ReturnType<typeof vi.fn>
}

let api: Stub

beforeEach(() => {
  setActivePinia(createPinia())
  api = {
    checkTemplate: vi.fn((req: unknown) => {
      cloneThroughIpc(req)
      return Promise.resolve(EMPTY_RESULT)
    }),
    getAlignConfig: vi.fn(() => Promise.resolve(structuredClone(STORED_CONFIG))),
    setAlignConfig: vi.fn((cfg: unknown) => {
      cloneThroughIpc(cfg)
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
