# 项目进度报告

> 最后更新：2026-09-17

## 项目概述

**报表比对桌面工具（report-diff-desk）**：本地桌面工具，读取两份 Excel 报表（单文件或 zip 压缩包内多个 Excel），按结构对齐做环比比对，标记变动超阈值单元格；支持口径映射表检索、口径文档翻阅（PDF 在线渲染+关键字搜索）；网格高亮展示、导出比对结果。全本机运算，不上传云端。

**技术栈**：Electron 44 + electron-vite 5（vite 7）+ Vue 3.5 + Element Plus 2.14 + Pinia 4 + electron-builder 26（nsis + portable）

**解析/导出**：
- SheetJS 0.20.3（官方 CDN 版）解析 .xlsx / .xls(biff8)
- exceljs 4.4 仅用于写入导出（SheetJS CE 写 fill 会丢失）
- jszip 内存解压（GBK 文件名 fallback）
- pdfjs-dist 4.10：main 端提取文本 + renderer 端 canvas 渲染 PDF（含搜索高亮）
- mammoth .docx→HTML；TXT UTF-8/GBK 编码嗅探

**架构**：三进程（main 负责 IO/解析/导出，preload 只暴露 window.api，renderer 纯 UI）；核心逻辑在 `src/shared/`（零 Node 依赖，vitest 直测）

## 已完成功能

### M0-M7 里程碑（全部完成）
1. 脚手架 + 安全配置（contextIsolation/sandbox/CSP）+ 类型体系
2. Excel/zip 解析（公式缓存值、日期格、.xls 老格式、GBK 文件名兜底）
3. 比对引擎（|(新-旧)/旧|>50% 严格大于；旧 0 新非 0 = 100% zero-base；双 0 跳过；新增/移除语义；sheet 名 trim 匹配 + 坐标对比）
4. IPC 主链路 + UI（文件选择、阈值、DiffList 红涨绿跌橙）
5. 网格高亮（变动格粉色高亮 + 右键菜单查看口径；行号列灰底固定左侧）+ 口径映射表检索
6. 口径文档：PDF 在线 canvas 渲染 + 关键字搜索高亮 + 缩放 + 多文档切换/删除/持久化
7. 导出：zip 压缩包（每个文件对一个 xlsx，上期/本期两 sheet，原表格式 + 变动格紫色标记）+ HTML 明细报告

### 二期：zip 批量比对
- 按压缩包内文件顺序逐项配对（索引对索引），多余文件列出「未参与比对」提示
- 网格/明细/导出全面适配

### 三期：概览卡
- 比对结果页顶部：全局指标条（配对数/变动合计/未参与）+ 每对文件横版大卡
- 点击卡片联动明细列表，再次点击恢复全部

### 四期：口径查询多文档 + PDF 查看
- 口径查询页：报表文档整体/局部浏览（合并单元格渲染）、点到点规则匹配（前缀精准匹配）
- 文档库持久化（重启后自动恢复）
- PDF：pdfjs-dist canvas 渲染 + 逐页文本搜索高亮（黄色/橙色）+ 缩放

### UI/体验优化
- 网格行号列（灰底固定左侧，不参与合并）
- DiffList 列排序（降序→升序→默认三态）
- 右键菜单查看口径（防止左键误触跳转）
- 文件选择对话框默认上次目录
- 布局滚动隔离（各区域独立滚动互不影响）
- 内容区拖拽调高度（ResizeBar 组件）
- 版本号 v1.1.0 + 应用图标更换为 logo1.0

## 当前状态

**验证**：68 passed / 2 skipped（samples 集成测试，依赖用户文件），typecheck clean，build clean。

**最近 commits**：
```
051a2b2 fix: CLAUDE.md 测试数修正为 70；compression 由 maximum 改为 normal
824376d fix: 撤回 node_modules 排除（main 进程 externalizeDepsPlugin 需要运行时依赖）
8ba8b7f chore: 移除技能与内部规格文档，补充 .gitignore 排除项
b676af2 fix: 网格高亮无选项时显示「请上传报表后比对」提示
4fec73e fix: 拖拽调高——ResizeBar 起点+delta模式修复大幅度跳动
cda4b53 feat: 网格高亮与口径查询内容区支持上下拖拽调整高度（ResizeBar）
e322b22 feat: 口径文档 PDF 支持在线查看与关键字搜索
b239b63 feat: 应用图标更换为 logo1.0（打包与窗口图标统一）
c96c5f9 feat: 版本号定为 1.0.0，左下角展示版本号与开发者信息
bb87869 feat: 口径查询页优化——移除单元格/手动查询，整体展示全量行并支持合并单元格，新增删除口径资料
2539486 feat: 口径查询页支持报表文档整体/局部浏览，文档库持久化
```

## 已知限制

1. 旧 `.doc` 不支持（选择框过滤）
2. 公式格依赖 Excel 写盘时自带的缓存值；第三方工具生成的无缓存值文件该格视为空
3. `.xls` 老格式导出无法保留原字体/边框装饰样式（exceljs 不支持读 biff8），降级为值+合并+紫色重建
4. **打包体积**：asar 77MB（main 进程 `externalizeDepsPlugin()` 要求 node_modules 运行时可用，无法排除），exe 129MB；未来优化方向：将部分依赖改为 vite 打包而非 externalize，或只排除确认无运行时引用的包
5. PDF worker 通过 vite `?worker` 打包（CSP `worker-src 'self' blob:`）

## 待办

- [ ] 可选：M8 Playwright E2E 冒烟（IPC 串接的单测盲区）
- [ ] 可选：打包体积深度优化（分析 node_modules 依赖树，将可捆绑依赖改为 vite 打包）
- [ ] 可选：HTML 导出适配 PDF 在线搜索（目前 HTML 为明细列表，PDF 为独立渲染器）
