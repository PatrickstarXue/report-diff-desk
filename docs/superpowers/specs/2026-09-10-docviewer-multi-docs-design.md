# 口径文档页多文档 + 整体/局部视图设计规格

> 日期：2026-09-10
> 状态：已获用户批准

## 背景与问题

1. 用户上传 `NR01口径.xlsx` 到映射表无反应：该文件是完整报表（A 列项目、B 列期限、C 列多行口径 SQL），不是映射表两列格式。映射表解析（buildIndex）只认「指标名/口径说明」两列，导入后查不到内容。
2. 用户需要「多文档存留 + 整体/局部浏览」：多份口径资料并存，上方整体缩略展示，点击单元格在下方详情展示完整内容。

## 目标

升级「口径文档」页（DocViewer）：支持 xlsx/xls 报表作为文档浏览，多文档并存切换，上方整体（首屏缩略）+ 下方局部（单元格完整内容）。映射表页（MappingPanel）保持现状不动。

## 范围

- 修改：types.ts、main/file/loader.ts、session.ts、DocViewer.vue
- 不动：MappingPanel、比对/导出/网格、其余页面

## 数据层

**types.ts**
```ts
export type DocKind = 'docx' | 'pdf' | 'txt' | 'xlsx' | 'xls'

export interface DocContent {
  kind: DocKind
  name: string
  html?: string            // docx：mammoth HTML
  pages?: string[]         // pdf 逐页文本 / txt 单元素
  workbooks?: SheetData[]  // xlsx/xls：全表数据（含 merges）
}
```

**session.ts**：`docContent` 单文档 → `docList: DocContent[]` + `activeDocIndex`；新增 `activeDocSheet`、`selectedDocCell`。

**loader.ts**：`loadDocFile(path)` 按扩展名分发——xlsx/xls 调 `parseExcel` 返回 `{ kind, name, workbooks }`；docx/pdf/txt 行为不变。

## UI（DocViewer.vue 重写）

```
工具栏：[打开文档] [文档下拉] [sheet 下拉(仅报表)] [搜索] [字号]
────────────────────────────────────
整体区（上方，height 200px，横向滚动，border）
  报表：el-table 前 20 行，单元格截断，可点击选中
  docx：iframe（高度 200px）
  pdf/txt：第 1 页文本（pre-wrap，省略）
────────────────────────────────────
局部区（下方，flex 1，滚动）
  报表：选中单元格完整内容（sheet + 坐标 + pre-wrap）；未选中提示
  docx/pdf/txt：完整内容（现有行为）
```

关键行为：
- 打开文档可多次加载 → 多文档并存，最新自动选中；过滤 xlsx/xls/docx/pdf/txt
- 文档下拉切换 activeDocIndex；报表显示 sheet 下拉切换 activeDocSheet
- 整体区表格行限前 20 行（多行文本单元格截断为单行），点击单元格 → selectedDocCell，蓝色边框
- 局部区：报表显示选中单元格完整内容（含换行），docx/pdf/txt 保持完整展示
- 搜索：报表搜索整表前 20 行；docx/pdf/txt 保持现状
- 字号调节保持

## 验证标准

- 手动：加载 NR01口径.xlsx → 整体区出现前 20 行、点击 C 列单元格 → 下方完整显示多行 SQL；再加载附件2.xls 并存切换；docx/pdf/txt 行为不回归
- 单测：无新增纯逻辑（解析复用 parseExcel）
- typecheck + build 通过

## 已知限制

- 报表整体区仅展示前 20 行（缩略），非完整浏览；完整内容通过点击单元格查看
- 大文件报表（> 5 万行）el-table 前 20 行无性能问题
