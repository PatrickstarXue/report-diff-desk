import { defineStore } from 'pinia'
import type { CompareResult, WorkbookData } from '@shared/types'

interface SessionState {
  baseWorkbooks: WorkbookData[]
  currWorkbooks: WorkbookData[]
  baseId: string | null
  currId: string | null
  basePath: string
  currPath: string
  compareResult: CompareResult | null
  loading: boolean
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    baseWorkbooks: [],
    currWorkbooks: [],
    baseId: null,
    currId: null,
    basePath: '',
    currPath: '',
    compareResult: null,
    loading: false
  }),

  getters: {
    baseWorkbook: (s): WorkbookData | null =>
      s.baseWorkbooks.find((w) => w.id === s.baseId) ?? null,
    currWorkbook: (s): WorkbookData | null =>
      s.currWorkbooks.find((w) => w.id === s.currId) ?? null
  },

  actions: {
    /** 加载上期/本期报表文件；zip 多工作簿时清空原选择由用户下拉指定 */
    async loadPair(role: 'base' | 'curr', path: string): Promise<void> {
      this.loading = true
      try {
        const res = await window.api.loadReport(path)
        if (res.error) throw new Error(res.error)
        if (role === 'base') {
          this.baseWorkbooks = res.workbooks
          this.basePath = path
          this.baseId = res.workbooks[0]?.id ?? null
        } else {
          this.currWorkbooks = res.workbooks
          this.currPath = path
          this.currId = res.workbooks[0]?.id ?? null
        }
        if (res.workbooks.length === 0) throw new Error('文件中没有可解析的 Excel')
      } finally {
        this.loading = false
      }
    },

    async runCompare(threshold: number): Promise<void> {
      if (!this.baseId || !this.currId) return
      this.loading = true
      try {
        this.compareResult = await window.api.compare({
          baseId: this.baseId,
          currId: this.currId,
          threshold: threshold / 100
        })
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
    }
  }
})
