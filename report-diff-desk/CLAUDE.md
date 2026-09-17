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

- **`src/shared/`**：纯逻辑，零 Node/Electron 依赖，vitest 直接测试（node 环境）。核心在 `core/`（engine.ts 比对引擎、numeric.ts 数值解析、mapping.ts 口径映射、pairing.ts 顺序配对、merge.ts 合并单元格 span 矩阵、summary.ts 概览汇总）
- **`src/main/`**：main 进程。`file/`（excel.ts/zip.ts/docx.ts/pdf.ts/txt.ts/loader.ts 分格式解析）、`export/`（excel.ts zip 导出、html.ts 明细导出）、`ipc.ts`（全部 ipcMain.handle + 入参校验）、`store.ts`（会话缓存 + recent.json）
- **`src/renderer/src/`**：renderer 进程。`stores/session.ts`（Pinia 全局状态：比对/网格焦点/文档库）、`components/`（FilePanel/SheetGrid/DiffList/MappingPanel/DocViewer/PdfViewer/OverviewPanel/ResizeBar）、`App.vue`（布局 + 版本信息）
- **`src/shared/ipc.ts`**：IPC channel 名常量，main/preload/renderer 三端共用
- **`src/shared/api.ts`**：window.api 契约接口，preload 逐 channel 包装 ipcRenderer.invoke

## 关键依赖与用途

- **xlsx (SheetJS 0.20.3)**：仅用于**解析** .xlsx/.xls（从官方 CDN 安装，非 npm）
- **exceljs 4.4**：仅用于**写入**导出 xlsx（SheetJS CE 写 fill 样式会丢失）
- **pdfjs-dist 4.10**：main 端提取 PDF 文本 + renderer 端 canvas 渲染 PDF（pdf.worker.min.mjs 通过 vite `?worker` 打包）
- **jszip 3.10**：内存 zip 解压（GBK 文件名 fallback：检测 U+FFFD → TextDecoder('gbk')）

## 环境注意事项

- **ELECTRON_RUN_AS_NODE=1**：本机 shell 环境变量会干扰 Electron 启动（导致 "exits immediately"），运行 `npm run dev` 或 `build:win` 前需 `Remove-Item env:ELECTRON_RUN_AS_NODE`（PowerShell）或 `unset ELECTRON_RUN_AS_NODE`（bash）
- **npm 11 阻止 postinstall**：首次安装后需 `npm approve-scripts esbuild electron`
- **electron-builder node_modules**：main 进程用 `externalizeDepsPlugin()`，所有生产依赖运行时从 node_modules 读取——**不可**在 electron-builder.yml 的 files 里排除 `!node_modules/**`

## 测试

vitest 覆盖纯逻辑（src/shared + src/main/file + src/main/export），共 70 个用例（68 passed + 2 skipped）。测试 fixture 在运行时由 SheetJS/JSZip 生成（不放二进制文件到仓库）。samples/ 目录在 .gitignore 里（用户文件，不提交）。

## 类型注意

- exceljs 的 `Workbook['xlsx']['load']` 参数类型与全局 Node Buffer 泛型冲突（exceljs 内部声明了局部 `interface Buffer extends ArrayBuffer`），调用处需 `as unknown as Parameters<typeof wb.xlsx.load>[0]`
- el-table 的 cell-click 事件中 `column._columnIndex` 在合并列下不可靠，**统一使用** `column.property`（形如 `"c0"`）定位数据列
