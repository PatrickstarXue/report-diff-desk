# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # 开发模式（electron-vite）
npm test                 # vitest 运行全部单测
npx vitest run src/path/to/file.spec.ts   # 单文件测试
npm run typecheck        # vue-tsc 类型检查（main + renderer）
npm run build            # electron-vite 构建（不打包）
npm run build:win        # 构建 + 打包（需先 unset ELECTRON_RUN_AS_NODE）
npm run make:samples     # 生成演示样例（samples/ 目录）
```

## 架构

三进程 Electron 应用：main（IO/解析/IPC/导出）、preload（contextBridge 唯一 window.api）、renderer（Vue3 + Element Plus）。所有数据 JSON 序列化通过 IPC。

- **`src/shared/`**：纯逻辑，零 Node/Electron 依赖，vitest 直接测试（node 环境）。核心在 `core/`（engine.ts 环比比对引擎、numeric.ts 数值解析、mapping.ts 口径映射、pairing.ts 顺序配对、merge.ts 合并单元格 span 矩阵、summary.ts 概览汇总、template.ts 新旧表比对（规则表配对）、sheet-view.ts 网格渲染纯函数）
- **`src/main/`**：main 进程。`file/`（excel.ts/zip.ts/docx.ts/pdf.ts/txt.ts/loader.ts 分格式解析）、`export/`（excel.ts zip 导出、html.ts 明细导出、wps.ts 借本机 WPS/Excel 的 COM 把 .xls 转 .xlsx）、`ipc.ts`（全部 ipcMain.handle + 入参校验）、`store.ts`（工作簿会话缓存）、`align.ts`（规则表持久化）
- **`src/renderer/src/`**：renderer 进程。`stores/session.ts`（Pinia 全局状态：比对/网格焦点/文档库/规则表草稿）、`components/`（WelcomePanel 落地首页/FilePanel/SheetGrid/DiffList/ExportResultButton/MappingPanel/DocViewer/PdfViewer/ResultPanel/OverviewPanel/ResizeBar/TemplatePanel/TemplateGrid/RulePanel/RuleTable/ZoomBadge）、`utils/`（dragPan 左键拖拽平移、zoom Ctrl+滚轮缩放、reveal 跳转定位、pagination 明细分页）、`App.vue`（布局 + 版本信息；左侧菜单 = 首页 + 分组「报表环比」（整体概览/高亮显示）+ 分组「口径查询」（Mapping口径/官方文档）+ 独立项「新旧表比对」居末；报表选择条由首页与「报表环比」两个子页共用）
- **`src/shared/ipc.ts`**：IPC channel 名常量，main/preload/renderer 三端共用
- **`src/shared/api.ts`**：window.api 契约接口，preload 逐 channel 包装 ipcRenderer.invoke

## 关键依赖与用途

- **xlsx (SheetJS 0.20.3)**：仅用于**解析** .xlsx/.xls（从官方 CDN 安装，非 npm）
- **exceljs 4.4**：仅用于**写入**导出 xlsx（SheetJS CE 写 fill 样式会丢失）
- **pdfjs-dist 4.10**：main 端提取 PDF 文本 + renderer 端 canvas 渲染 PDF（pdf.worker.min.mjs 通过 vite `?worker` 打包）
- **jszip 3.10**：内存 zip 解压（GBK 文件名 fallback：检测 U+FFFD → TextDecoder('gbk')）
- **@element-plus/icons-vue 2.3**：左侧菜单与首页卡片的图标，仅在 renderer 用，放 devDependencies（renderer 依赖由 electron-vite 内联进 bundle）。**未在 main.ts 全局注册**，按需 import；用在 `el-menu` 里时必须包 `<el-icon>`，否则裸 svg 拿不到菜单的样式钩子

## 环境注意事项

- **ELECTRON_RUN_AS_NODE=1**：本机 shell 环境变量会干扰 Electron 启动（导致 "exits immediately"），运行 `npm run dev` 或 `build:win` 前需 `Remove-Item env:ELECTRON_RUN_AS_NODE`（PowerShell）或 `unset ELECTRON_RUN_AS_NODE`（bash）
- **npm 11 阻止 postinstall**：首次安装后需 `npm approve-scripts esbuild electron`
- **electron-builder node_modules**：main 进程用 `externalizeDepsPlugin()`，所有生产依赖运行时从 node_modules 读取——**不可**在 electron-builder.yml 的 files 里排除 `!node_modules/**`
- **导出 .xls 保真依赖 WPS/Excel**：`src/main/export/wps.ts` 是 main 进程目前唯一用 `child_process` 的地方，经 PowerShell（`-EncodedCommand`，不落 .ps1 到磁盘以免触发 Defender ASR）驱动 `Excel.Application` COM——WPS 也注册这个 ProgID。只做 .xls → .xlsx 转换，染色与双 sheet 组装仍是 exceljs 的活；仅 win32 生效，探测不到就退回内置重建。改这块前先读该文件顶部注释，里面有 COM 会话的生命周期约束（绝不设 `Visible`、附着到用户实例时不能 `Quit`）

## 测试

vitest 覆盖纯逻辑（src/shared + src/main/file + src/main/export + renderer store/utils），共 176 个用例（174 passed + 2 skipped）。测试 fixture 在运行时由 SheetJS/JSZip 生成（不放二进制文件到仓库）。samples/ 目录在 .gitignore 里（用户文件，不提交）；`src/main/file/__tests__/template-samples.spec.ts` 用 samples/similarSample/ 的真实 xls 走生产解析链路，样例缺失时整组跳过。

`src/main/export/__tests__/export.spec.ts` 里断言 .xls **降级**行为的用例一律显式传 `{ useWps: false }`——否则在装了 WPS 的机器上会走保真转换、note 断言静默失效。真实样例组按 `existsSync(samples/...)`、WPS 保真组再叠一层顶层 `await detectWps()` 做 `describe.skipIf` 门禁，所以用例总数随机器而变。

`src/renderer/src/stores/__tests__/session.template.spec.ts` 用 `structuredClone` 桩模拟 IPC 边界——渲染进程传给 `window.api` 的载荷必须是纯对象（Pinia 响应式 Proxy 会抛 `DataCloneError: An object could not be cloned.`），新增 IPC 调用时照 `session.ts` 里 `JSON.parse(JSON.stringify(...))` 的既有写法深拷贝。

## 类型注意

- exceljs 的 `Workbook['xlsx']['load']` 参数类型与全局 Node Buffer 泛型冲突（exceljs 内部声明了局部 `interface Buffer extends ArrayBuffer`），调用处需 `as unknown as Parameters<typeof wb.xlsx.load>[0]`
- el-table 的 cell-click 事件中 `column._columnIndex` 在合并列下不可靠，**统一使用** `column.property`（形如 `"c0"`）定位数据列
