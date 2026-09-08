import { defineStore } from 'pinia'
import type { BatchCompareResult, DocContent, FilePairResult, WorkbookData } from '@shared/types'
import { buildIndex, type MappingIndex } from '@shared/core/mapping'

interface SessionState {
  baseWorkbooks: WorkbookData[]
  currWorkbooks: WorkbookData[]
  basePath: string
  currPath: string
  compareResult: BatchCompareResult | null
  /** 当前选中的文件对索引（网格/明细按此过滤） */
  activePairIndex: number
  loading: boolean
  mappingIndex: MappingIndex | null
  mappingCount: number
  /** 点选单元格（文本/位置），驱动口径查询 */
  selectedCell: { text: string; sheet: string; ref: string } | null
  /** DiffList 点击行 → 网格跳转目标 */
  gridFocus: { pairIndex: number; sheet: string; row: number } | null
  /** 当前加载的口径文档 */
  docContent: DocContent | null
  /** 右侧标签页：result | grid | mapping | doc */
  uiTab: string
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    baseWorkbooks: [],
    currWorkbooks: [],
    basePath: '',
    currPath: '',
    compareResult: null,
    activePairIndex: 0,
    loading: false,
    mappingIndex: null,
    mappingCount: 0,
    selectedCell: null,
    gridFocus: null,
    docContent: null,
    uiTab: 'result'
  }),

  getters: {
    activePair: (s): FilePairResult | null => s.compareResult?.pairs[s.activePairIndex] ?? null,
    /** 顺序配对：pair 索引即两侧工作簿数组索引 */
    activeBase: (s): WorkbookData | null => s.baseWorkbooks[s.activePairIndex] ?? null,
    activeCurr: (s): WorkbookData | null => s.currWorkbooks[s.activePairIndex] ?? null
  },

  actions: {
    /** 加载上期/本期报表文件（单 Excel 或 zip 包）；zip 内全部工作簿自动参与顺序配对 */
    async loadPair(role: 'base' | 'curr', path: string): Promise<void> {
      this.loading = true
      try {
        const res = await window.api.loadReport(path)
        if (res.error) throw new Error(res.error)
        if (res.workbooks.length === 0) throw new Error('文件中没有可解析的 Excel')
        if (role === 'base') {
          this.baseWorkbooks = res.workbooks
          this.basePath = path
        } else {
          this.currWorkbooks = res.workbooks
          this.currPath = path
        }
      } finally {
        this.loading = false
      }
    },

    async runCompare(threshold: number): Promise<void> {
      if (!this.baseWorkbooks.length || !this.currWorkbooks.length) return
      this.loading = true
      try {
        this.compareResult = await window.api.compare({
          baseIds: this.baseWorkbooks.map((w) => w.id),
          currIds: this.currWorkbooks.map((w) => w.id),
          threshold: threshold / 100
        })
        this.activePairIndex = 0
        const recent = await window.api.getRecent()
        await window.api.setRecent(
          [
            { basePath: this.basePath, currPath: this.currPath, at: new Date().toISOString() },
            ...recent.filter((r) => !(r.basePath === this.basePath && r.currPath === this.currPath))
          ].slice(0, 10)
        )
      } finally {
        this.loading = false
      }
    },

    async loadMappingFile(path: string): Promise<void> {
      const res = await window.api.loadMapping(path)
      this.mappingIndex = buildIndex(res.rows)
      this.mappingCount = this.mappingIndex.size
    },

    /** 点选网格单元格：记录文本并切到口径页 */
    selectCell(text: string, sheet: string, ref: string): void {
      this.selectedCell = { text, sheet, ref }
      this.uiTab = 'mapping'
    },

    /** DiffList 行点击：切到网格并跳转对应文件对/sheet/行 */
    focusCell(pairIndex: number, sheet: string, row: number): void {
      this.gridFocus = { pairIndex, sheet, row }
      this.uiTab = 'grid'
    }
  }
})
