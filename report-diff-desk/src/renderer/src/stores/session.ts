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
  /** DiffList 点击行 → 网格跳转目标（含列，用于紫色标记聚焦格） */
  gridFocus: { pairIndex: number; sheet: string; row: number; col: number } | null
  /** 已加载的口径文档列表（多文档存留） */
  docList: DocContent[]
  /** 当前显示的文档索引 */
  activeDocIndex: number
  /** 当前报表文档（xlsx/xls）内选中的 sheet 名 */
  activeDocSheet: string
  /** 点击整体区单元格选中的内容（报表文档） */
  selectedDocCell: { sheet: string; row: number; col: number; value: string } | null
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
    docList: [],
    activeDocIndex: 0,
    activeDocSheet: '',
    selectedDocCell: null,
    uiTab: 'grid'
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

    /** 加载口径文档并入文档列表（可多次加载并存），并持久化文档库 */
    async addDoc(path: string): Promise<void> {
      const doc = await window.api.loadDoc(path)
      this.docList.push(doc)
      this.activeDocIndex = this.docList.length - 1
      this.activeDocSheet = doc.workbooks?.[0]?.name ?? ''
      this.selectedDocCell = null
      await this._persistDocLibrary()
    },

    /** 启动时恢复持久化文档库：逐个重新加载（文件被移动的跳过） */
    async initDocLibrary(): Promise<void> {
      const paths = await window.api.getDocLibrary()
      for (const p of paths) {
        try {
          const doc = await window.api.loadDoc(p)
          if (!this.docList.some((d) => d.path === p)) this.docList.push(doc)
        } catch {
          // 文件已被移动/删除：跳过该文档
        }
      }
      if (this.docList.length > 0) {
        this.activeDocIndex = 0
        this.activeDocSheet = this.docList[0]?.workbooks?.[0]?.name ?? ''
      }
    },

    /** 删除已打开的口径资料（文档库持久化同步更新） */
    removeDoc(index: number): void {
      if (index < 0 || index >= this.docList.length) return
      this.docList.splice(index, 1)
      if (this.activeDocIndex >= this.docList.length) {
        this.activeDocIndex = Math.max(0, this.docList.length - 1)
      }
      const d = this.docList[this.activeDocIndex]
      this.activeDocSheet = d?.workbooks?.[0]?.name ?? ''
      this.selectedDocCell = null
      void this._persistDocLibrary()
    },

    async _persistDocLibrary(): Promise<void> {
      await window.api.setDocLibrary(this.docList.map((d) => d.path))
    },

    /** 切换当前显示文档（不同文档清除已选单元格） */
    selectDoc(index: number): void {
      if (index < 0 || index >= this.docList.length) return
      this.activeDocIndex = index
      const doc = this.docList[index]
      this.activeDocSheet = doc.workbooks?.[0]?.name ?? ''
      this.selectedDocCell = null
    },

    /** 点击整体区单元格：记录完整内容供局部区展示 */
    selectDocCell(row: number, col: number, value: string): void {
      this.selectedDocCell = { sheet: this.activeDocSheet, row, col, value }
    },

    /** DiffList 行点击：切到网格并跳转对应文件对/sheet/单元格 */
    focusCell(pairIndex: number, sheet: string, row: number, col: number): void {
      this.gridFocus = { pairIndex, sheet, row, col }
      this.uiTab = 'grid'
    },

    /** 离开网格时清除聚焦格标记 */
    clearGridFocus(): void {
      this.gridFocus = null
    }
  }
})
