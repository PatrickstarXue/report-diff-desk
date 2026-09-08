# report-diff-desk 报表比对桌面工具 — 设计规格

> 2026-09-08 设计定稿。决策均经用户逐项确认。

## 背景与目标

本地桌面工具：读取两份 Excel 报表（或 zip 包内多个 Excel），按结构对齐做环比比对，标记 |变动率|>50% 的单元格并定位；支持口径文档（Word/PDF/TXT）翻阅与预建映射表点选查询；双击运行、全本地运算不上云。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 桌面方案 | Electron（Vue3 + Element Plus + electron-vite） |
| 对齐方式 | 结构对齐：sheet 名 trim 后精确匹配 + 同单元格坐标对比，不做表头智能匹配 |
| 变动定义 | rate = (本期-上期)/上期；\|rate\|>50% 严格大于；上期为 0 且本期非 0 记 100%；双 0 不标记 |
| 口径检索 | 预建映射表：用户维护两列 Excel（指标名、口径说明）导入后按单元格文本精确命中；口径文档仅作可翻阅原文 |
| zip 内容 | 多个 Excel（.xlsx/.xls） |
| 导出 | Excel 明细（每行一个变动单元格，行填充色）+ 自包含 HTML 报告（内嵌 CSS/数据，无外链） |

## 技术选型

- 构建：electron-vite 5（vite 7 底层）+ electron 44 + electron-builder 26（win 目标 nsis + portable）
- Excel 解析：SheetJS 0.20.3（官方 CDN 安装）——唯一免费支持 .xls + 读公式缓存值；npm 0.18.5 停更带 CVE 不可用
- zip：jszip 3（内存解压，GBK 文件名 `TextDecoder('gbk')` 兜底）
- Word：mammoth（.docx → HTML；旧 .doc 不支持，选择框过滤）
- PDF：pdfjs-dist 4 legacy 构建，仅 `getTextContent()` 提文本
- TXT：原生 fs + UTF-8/GBK 编码嗅探
- UI：Element Plus 2 + Pinia；测试：vitest（node 环境）

不引入：数据库（最近记录仅 userData JSON）、自动更新、代码签名、云端。

## 进程架构

- **main**：文件 IO、解析分发、内存会话缓存（workbookId → WorkbookData）、比对引擎运行、导出写盘
- **preload**：contextBridge 暴露唯一 `window.api`，逐 channel 包装 invoke，不暴露 ipcRenderer 本体
- **renderer**：纯 UI（选文件、sheet 浏览、高亮网格、变动明细、口径面板、文档翻阅、导出）

安全：contextIsolation + sandbox + nodeIntegration: false + CSP；docx 内容以 `<iframe sandbox srcdoc>` 隔离；外部链接交系统浏览器。

### IPC 接口

| channel | 入参 → 出参 |
|---|---|
| `dialog:openFile` | `{kind: 'report'\|'zip'\|'mapping'\|'doc'}` → `{canceled, path?}` |
| `report:load` | `{path}` → `{workbooks: WorkbookData[]}`（main 按 id 缓存） |
| `report:getSheet` | `{workbookId, sheetName}` → `SheetData` |
| `compare:run` | `{baseId, currId, threshold}` → `CompareResult` |
| `mapping:load` | `{path}` → `{rows: string[][]}` |
| `doc:load` | `{path}` → `DocContent` |
| `export:run` | `{format, compare, baseLabel, currLabel, targetPath?}` → `{canceled, path?}` |
| `recent:get/set` | — |

## 目录结构

```
src/
├─ shared/          纯逻辑，零 Node/Electron 依赖，两端共用
│  ├─ types.ts      ipc.ts
│  └─ core/         numeric.ts（数值化）engine.ts（比对引擎）mapping.ts（映射索引）
├─ main/
│  ├─ index.ts（窗口/安全/单实例锁） ipc.ts（handler 注册+入参校验） store.ts（缓存+recent.json）
│  ├─ file/         loader.ts excel.ts zip.ts docx.ts pdf.ts txt.ts
│  └─ export/       excel.ts html.ts
├─ preload/index.ts
└─ renderer/src/
   ├─ App.vue（左文件面板+右标签页） api/ stores/session.ts utils/ref.ts（坐标互转）
   └─ components/   FilePanel SheetGrid DiffList MappingPanel DocViewer ExportBar
```

spec 与实现同目录（`__tests__/*.spec.ts`）；fixtures 运行时由 SheetJS/JSZip 生成，不入库。

## 数据流

```
选文件 → dialog:openFile → report:load（main 解析按 id 缓存）→ Pinia 持有
→ 点比对 → compare:run → 引擎 compareWorkbooks → CompareResult
→ DiffList 展示 + SheetGrid 按 Set<sheet|r|c> 高亮；点选单元格取文本 → 映射 lookup
→ 导出 → export:run → main 写盘 → 提示
```

## 比对引擎（src/shared/core/engine.ts）

`compareWorkbooks(base, curr, threshold)`：
1. sheet 名 trim 精确匹配，不匹配者记入 OnlyIn 列表不参与比对
2. `toNumeric`：number 原值；日期 null；字符串 trim、去千分位、% 结尾除 100 再 parseFloat；其余 null；公式格用缓存值
3. 每对 sheet 按 max(行)×max(列) 遍历，缺省格 null
4. 判定顺序：双 null/双 0 跳过 → new(1) / removed(-1) → 旧 0 新非 0 = zero-base(1) → 否则 rate=(新-旧)/旧，|rate|>threshold 标记
5. ref = "C12"（1 起始），diffs 按 sheet→row→col 排序

## 里程碑

- **M0** 脚手架与依赖（完成）
- **M1** Excel/zip 解析层（TDD）
- **M2** 比对引擎（TDD，~23 用例）
- **M3** IPC + 主链路 UI + make-samples 样例脚本
- **M4** 网格高亮 + 口径映射
- **M5** 口径文档翻阅
- **M6** 导出 Excel/HTML
- **M7** 打包（nsis + portable）与收尾
- **M8**（可选）Playwright _electron E2E 冒烟

## 已知限制

1. 旧 .doc 不支持（选择框过滤）
2. 公式格依赖 Excel 写盘时自带的缓存值；第三方工具生成的无缓存值文件该格视为空
3. el-table 超大表（>5 万行）渲染可能慢，实测慢再换 el-table-v2（改动局限于 SheetGrid.vue）
