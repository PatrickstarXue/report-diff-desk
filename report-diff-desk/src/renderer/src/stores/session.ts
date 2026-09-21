import { defineStore } from 'pinia'
import type {
  AlignConfig,
  BatchCompareResult,
  DocContent,
  FilePairResult,
  RuleTable,
  RuleTablePair,
  TemplateCheckResult,
  TemplatePairResult,
  TemplateSheet,
  TemplateTablePair,
  WorkbookData
} from '@shared/types'
import { buildIndex, type MappingIndex } from '@shared/core/mapping'
import { DEFAULT_ANCHORS, templateKeyOf } from '@shared/core/template'

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
  selectedCell: { text: string; sheet: string; ref: string; row: number; col: number } | null
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
  /** 表样核对：左侧（R 系列）与右侧（NR 系列）报表 */
  templateLeft: WorkbookData[]
  templateRight: WorkbookData[]
  templateLeftPath: string
  templateRightPath: string
  templateResult: TemplateCheckResult | null
  /** 表样核对的相对差阈值（小数，0.0001 = 0.01%） */
  templateThreshold: number
  /**
   * 锚点词列表（界面里是一排可删的标签）。
   * 每个报表各自取「自己表里第一个命中的词」，所以多个报表族的锚点互不影响。
   */
  anchors: string[]
  /** 当前查看的表对索引 */
  templatePairIndex: number
  /** 网格当前显示哪一侧 */
  templateSide: 'left' | 'right'
  /** 差异列表点击 → 网格跳转目标 */
  templateFocus: { row: number; col: number } | null
  /** 人工指定的表对（表号冲突时用），仅本次生效 */
  manualTablePairs: TemplateTablePair[]
  alignConfig: AlignConfig | null
  /** 规则表草稿，键 `左表样键|右表样键`；与已保存配置合并后参与核对（草稿优先） */
  ruleDrafts: Record<string, RuleTablePair>
  /** 草稿有未保存修改 */
  ruleDirty: boolean
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
    uiTab: 'grid',
    templateLeft: [],
    templateRight: [],
    templateLeftPath: '',
    templateRightPath: '',
    templateResult: null,
    templateThreshold: 0.0001,
    anchors: [...DEFAULT_ANCHORS],
    templatePairIndex: 0,
    templateSide: 'left',
    templateFocus: null,
    manualTablePairs: [],
    alignConfig: null,
    ruleDrafts: {},
    ruleDirty: false
  }),

  getters: {
    activePair: (s): FilePairResult | null => s.compareResult?.pairs[s.activePairIndex] ?? null,
    /** 顺序配对：pair 索引即两侧工作簿数组索引 */
    activeBase: (s): WorkbookData | null => s.baseWorkbooks[s.activePairIndex] ?? null,
    activeCurr: (s): WorkbookData | null => s.currWorkbooks[s.activePairIndex] ?? null,
    /** 当前表对；无结果时为 null */
    activeTemplatePair: (s): TemplatePairResult | null =>
      s.templateResult?.pairs[s.templatePairIndex] ?? null,
    /** 当前表对中、当前侧对应的工作簿（按表样解析结果里的 workbookId 精确匹配） */
    activeTemplateWorkbook: (s): WorkbookData | null => {
      const p = s.templateResult?.pairs[s.templatePairIndex]
      const ts = s.templateSide === 'left' ? p?.left : p?.right
      if (!ts) return null
      const list = s.templateSide === 'left' ? s.templateLeft : s.templateRight
      return list.find((w) => w.id === ts.workbookId) ?? null
    },
    /** 当前表对中，落在当前侧的差异格集合（"row,col"，0 起始） */
    templateHitSet: (s): Set<string> => {
      const p = s.templateResult?.pairs[s.templatePairIndex]
      const set = new Set<string>()
      if (!p) return set
      for (const d of p.diffs) {
        set.add(
          s.templateSide === 'left' ? `${d.leftRow},${d.leftCol}` : `${d.rightRow},${d.rightCol}`
        )
      }
      return set
    },
    /** 当前表对的配置键 `左表样键|右表样键`；无表对时为空串 */
    activeRuleKey: (s): string => {
      const p = s.templateResult?.pairs[s.templatePairIndex]
      if (!p) return ''
      return `${templateKeyOf(p.leftFile)}|${templateKeyOf(p.rightFile)}`
    },
    /** 当前表对的规则表草稿；尚未初始化时为 null */
    activeRuleDraft(): RuleTablePair | null {
      return this.ruleDrafts[this.activeRuleKey] ?? null
    },

    /** 生效的锚点词：按顺序尝试，每个报表取自己命中的那个；全为空时用默认「项目」 */
    effectiveAnchors(): string[] {
      // el-input-tag 的「清空」会把值 emit 成 undefined，这里一并兜住
      const list = (this.anchors ?? []).map((s) => s.trim()).filter(Boolean)
      return list.length > 0 ? list : [...DEFAULT_ANCHORS]
    }
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

    /** 点选网格单元格：记录坐标，点到点规则匹配（前缀精准匹配规则文档 sheet），切到口径查询页 */
    selectCell(text: string, sheet: string, ref: string, row: number, col: number, reportFileName: string): void {
      this.selectedCell = { text, sheet, ref, row, col }

      // 点到点匹配：取报表文件名第一个下划线前内容（前缀），与规则文档 sheet 名前缀精准配对
      const fileNameBase = reportFileName.split('/').pop() ?? reportFileName
      const prefix = fileNameBase.split('_')[0]

      if (prefix) {
        for (const doc of this.docList) {
          if (doc.kind !== 'xlsx' && doc.kind !== 'xls') continue
          for (const ws of doc.workbooks ?? []) {
            if (ws.name.split('_')[0] === prefix) {
              this.activeDocIndex = this.docList.indexOf(doc)
              this.activeDocSheet = ws.name
              const cell = ws.cells[row - 1]?.[col - 1]
              this.selectedDocCell = {
                sheet: ws.name,
                row,
                col,
                value: cell && cell.v !== null ? String(cell.v) : ''
              }
              this.uiTab = 'mapping'
              return
            }
          }
        }
      }

      // 未匹配：清空局部详情，仍切到口径查询页
      this.selectedDocCell = null
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
    },

    /** 加载表样核对某一侧的 zip */
    async loadTemplateSide(side: 'left' | 'right', path: string): Promise<void> {
      this.loading = true
      try {
        const res = await window.api.loadReport(path)
        if (res.error) throw new Error(res.error)
        if (res.workbooks.length === 0) throw new Error('文件中没有可解析的 Excel')
        if (side === 'left') {
          this.templateLeft = res.workbooks
          this.templateLeftPath = path
        } else {
          this.templateRight = res.workbooks
          this.templateRightPath = path
        }
        this.templateResult = null
      } finally {
        this.loading = false
      }
    },

    /**
     * 重新核对（改阈值/锚点词/保存规则后都会走这里）。
     * 核对完停在原来那张表对上：改个设置就被弹回第 1 对，等于白切一次。
     */
    async runTemplateCheck(): Promise<void> {
      if (!this.templateLeft.length || !this.templateRight.length) return
      // 核对前记住当前停在哪个表对（按标识而不是下标，表对顺序变了也不会跳）
      const prevKey = this.activeRuleKey
      const prevIndex = this.templatePairIndex
      this.loading = true
      try {
        // 规则表草稿优先于已保存配置：编辑后立即点核对就能看到效果
        const merged: Record<string, RuleTablePair> = {
          ...(this.alignConfig?.ruleTables ?? {}),
          ...this.ruleDrafts
        }
        const req = {
          leftIds: this.templateLeft.map((w) => w.id),
          rightIds: this.templateRight.map((w) => w.id),
          manualTablePairs: this.manualTablePairs,
          ruleTables: merged,
          anchors: this.effectiveAnchors,
          threshold: this.templateThreshold
        }
        // Pinia 响应式 Proxy 无法被 IPC 结构化克隆，先深拷贝为纯对象
        this.templateResult = await window.api.checkTemplate(JSON.parse(JSON.stringify(req)))
        const pairs = this.templateResult?.pairs ?? []
        const same = pairs.findIndex(
          (p) => `${templateKeyOf(p.leftFile)}|${templateKeyOf(p.rightFile)}` === prevKey
        )
        // 表对还在原处就停回原处；换了报表文件（标识找不到）则按下标夹回合法范围
        this.templatePairIndex = same >= 0 ? same : Math.min(prevIndex, Math.max(0, pairs.length - 1))
        this.templateFocus = null
      } finally {
        this.loading = false
      }
    },

    /** 读取规则表配置；失败时如实抛出（alignConfig 保持 null），由调用方提示用户，避免空基准覆盖盘上规则 */
    async reloadAlignConfig(): Promise<void> {
      this.alignConfig = await window.api.getAlignConfig()
      this.anchors = this.alignConfig.anchors?.length ? [...this.alignConfig.anchors] : [...DEFAULT_ANCHORS]
    },

    /** 保存锚点词到配置（与规则表同一份文件）。配置没读进来时不写，避免覆盖盘上内容 */
    async saveAnchors(): Promise<void> {
      const base = this.alignConfig
      if (!base) return
      const cfg: AlignConfig = {
        version: 2,
        // Pinia 响应式 Proxy 无法被 IPC 结构化克隆，先深拷贝为纯对象
        ruleTables: JSON.parse(JSON.stringify(base.ruleTables)) as Record<string, RuleTablePair>,
        anchors: [...this.effectiveAnchors]
      }
      await window.api.setAlignConfig(cfg)
      this.alignConfig = cfg
    },

    /** 初始化当前表对的规则表草稿：已保存的值优先，缺席的位置用种子补齐 */
    initRuleDraft(): void {
      const p = this.templateResult?.pairs[this.templatePairIndex]
      const key = this.activeRuleKey
      if (!p || !key || this.ruleDrafts[key]) return
      const saved = this.alignConfig?.ruleTables[key]
      const build = (t: TemplateSheet | null, side: 'left' | 'right'): RuleTable => {
        const out: RuleTable = { ...(saved?.[side] ?? {}) }
        for (const c of t?.cells ?? []) {
          const pos = `${c.row},${c.col}`
          if (out[pos] === undefined) out[pos] = c.seed
        }
        return out
      }
      this.ruleDrafts = {
        ...this.ruleDrafts,
        [key]: { left: build(p.left, 'left'), right: build(p.right, 'right') }
      }
      this.ruleDirty = false
    },

    /**
     * 用盘上存档的规则表覆盖当前草稿（把已持久化的规则调出来看/接着改）。
     * @returns 本表对没有存档时返回 false，调用方据此提示用户
     */
    restoreSavedRuleTable(): boolean {
      const key = this.activeRuleKey
      const saved = key ? this.alignConfig?.ruleTables[key] : undefined
      if (!saved) return false
      // 深拷贝：草稿改起来不能连带改到 alignConfig（下次保存的基准）
      const copy = JSON.parse(JSON.stringify(saved)) as RuleTablePair
      this.ruleDrafts = { ...this.ruleDrafts, [key]: copy }
      this.ruleDirty = false
      return true
    },

    /**
     * 丢弃人工修改与盘上存档，按**当前解析结果**的种子重建当前表对的草稿。
     * 只用种子（不吃 alignConfig 里的存档）：想吃存档是「恢复存档规则」那件事，
     * 两个按钮要互不重叠，否则「重新自动填充」填出来的还是旧规则。
     */
    reseedRuleTable(): void {
      const key = this.activeRuleKey
      const p = this.templateResult?.pairs[this.templatePairIndex]
      if (!key || !p) return
      const build = (t: TemplateSheet | null): RuleTable => {
        const out: RuleTable = {}
        for (const c of t?.cells ?? []) out[`${c.row},${c.col}`] = c.seed
        return out
      }
      this.ruleDrafts = { ...this.ruleDrafts, [key]: { left: build(p.left), right: build(p.right) } }
      this.ruleDirty = false
    },

    /** 保存当前表对的规则表并重新核对（保留当前表对，避免保存后跳回第 1 对） */
    async saveRuleTable(): Promise<void> {
      const key = this.activeRuleKey
      const draft = this.ruleDrafts[key]
      if (!draft) return
      const base = this.alignConfig
      if (!base) throw new Error('配置未就绪，已放弃保存以避免覆盖已有规则')
      const cfg: AlignConfig = {
        version: 2,
        // Pinia 响应式 Proxy 无法被 IPC 结构化克隆，先深拷贝为纯对象
        ruleTables: JSON.parse(
          JSON.stringify({ ...base.ruleTables, [key]: draft })
        ) as Record<string, RuleTablePair>,
        anchors: [...this.effectiveAnchors]
      }
      await window.api.setAlignConfig(cfg)
      this.alignConfig = cfg
      this.ruleDirty = false
      await this.runTemplateCheck()
    },

    /** 差异列表行点击 → 切到对应侧并跳转 */
    focusTemplateCell(pairIndex: number, side: 'left' | 'right', row: number, col: number): void {
      this.templatePairIndex = pairIndex
      this.templateSide = side
      this.templateFocus = { row, col }
    }
  }
})
