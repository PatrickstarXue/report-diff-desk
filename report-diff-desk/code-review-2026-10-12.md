# report-diff-desk 代码审查报告（性能 + 安全）

- 审查日期：2026-10-12
- 审查范围：`src/` 全部 74 个源文件（main 20 / preload 1 / renderer 38 / shared 15）+ 构建配置
- 验证基线：`npm run typecheck` 通过；`npm test` 195 passed / 2 skipped；`npm audit` 20 项（3 high / 2 critical，全部位于 devDependencies）

---

## 一、安全隐患（按严重度排序）

### S1【中】`setWindowOpenHandler` 不校验 URL 协议
`src/main/index.ts:27-30`

```ts
win.webContents.setWindowOpenHandler(({ url }) => {
  shell.openExternal(url)   // 任意 scheme：file://、ms-msbt:、自定义协议…
  return { action: 'deny' }
})
```

Electron 官方安全清单明确要求只放行 `http:`/`https:`。渲染进程一旦被 XSS 或恶意依赖污染，`window.open('file:///C:/…')` 就能借本进程打开本地文件/触发系统协议。本渲染层虽然不加载远程内容（无 XSS 现成入口），但这是标准纵深防御缺失。

**修复**：加协议白名单，其余直接 deny；同时补 `will-navigate`（非本地导航一律 deny）。

### S2【中】IPC 读面过宽且无大小护栏
- `reportLoad` / `mappingLoad` / `docLoad` 接受任意绝对路径并全量 `readFile`，无文件大小上限——一个超大/损坏的 zip 即可让主进程 OOM。
- `exportRun` 的 `req.targetPath` 由渲染层提供时会跳过保存对话框直接写任意路径（当前 UI 未使用该参数，属潜伏 API 面）。

**修复**：读取前 `statSync` 校验大小（建议 ≤ 512MB）与 `isFile()`；`exportRun` 忽略渲染层 `targetPath`，一律走 `dialog.showSaveDialog`。

### S3【中】`parseExcel` 密集矩阵展开会放大「幽灵选区」
`src/main/file/excel.ts:47-55`

按 `ws['!ref']` 全范围构建 `(GridCell | null)[][]`。Excel 文件极常见残留格式把 used range 撑到 1048576 行——SheetJS 本身是稀疏存储，我们的展开会把千万级 null 格装进内存，随后比对、IPC、网格渲染全部被拖垮（这也是 README「已知限制 3」的根因之一）。

**修复**：先扫描出实际有值的最大行列再建矩阵；或给 rowCount/colCount 设上限护栏并提示用户。

### S4【低-中】工作簿缓存只进不出
`src/main/store.ts`

`cache` 无淘汰、无释放 API，每次解析都发新 UUID。反复加载文件 / 新旧表比对多次加载后，内存单调增长直到重启。

**修复**：加 `releaseWorkbook(id)`；切换比对时释放旧 id；或按 `fileName + mtime + size` 去重复用。

### S5【低-中】PDF 走 base64 全量 IPC + 全页一次性渲染
- `loader.ts:30`：整个 PDF base64 后过结构化克隆，100MB 文件 → 133MB 字符串，主/渲染进程双份驻留。
- `PdfViewer.vue:103-154`：打开即渲染**全部**页（300 页 × ~1.2MB canvas ≈ 400MB+），无懒加载；`onScroll` 每个滚动事件遍历全部 wraps 调 `getBoundingClientRect`（无 rAF 节流，布局抖动）；`runSearch` 每次击键对每一页 `JSON.parse` 重解 dataset。

**修复**：IntersectionObserver 只渲染可见区 ±2 页；滚动处理 rAF 节流；搜索 300ms 防抖 + 解析结果缓存为对象。

### S6【低】生产 CSP 携带 `script-src 'unsafe-inline'`
`src/renderer/index.html:8`

dev 需要（Vite HMR），但生产构建原样带走。生产产物中外链脚本即可满足，`style-src 'unsafe-inline'` 因 Element Plus 运行时注入样式需保留。

**修复**：构建时用环境区分 CSP，生产版去掉 script-src 的 `'unsafe-inline'`。

### S7【低】`recentSet` / `docLibrarySet` 入参不校验
`src/main/ipc.ts:152-158, 216-222`

写盘前不校验 `paths`/`items` 是数组，非数组值也会被 `JSON.stringify` 落盘（读回侧有过滤，影响有限）；recent 无条数硬上限（目前靠 UI 层 slice(0,10) 兜底）。

**修复**：落盘前 `Array.isArray` + 条数 clamp。

### S8【低】mammoth 是死代码生产依赖
`docx.ts` / `txt.ts` 仅被测试引用，`loader.ts` 已移除 docx/txt 分发，但 `mammoth` 仍留在 `dependencies`，会被打进安装包，并引入 `argparse → sprintf-js` DoS 通告链。

**修复**：从 dependencies 移除 mammoth，删除两个死文件及其测试。

### S9【信息】npm audit：20 项全部在 devDependencies，生产依赖仅 1 项
- critical：`tinypool` 原型污染 RCE（vitest 5 传递链）、`vitest` 的 `@vitest/mocker` 路径遍历 —— 仅测试期，不进包。
- high：`brace-expansion`、`http-cache-semantics`、`source-map-js` —— 均为 electron-builder/vitest 传递依赖。
- **生产依赖唯一命中**：`exceljs → uuid <11.1.1`（moderate，buffer bounds check）。
- ✅ `xlsx@0.20.3`（CDN tarball + integrity 锁定）已含 CVE-2023-30533（原型污染）与 CVE-2024-22363（ReDoS）修复，选型正确，保持。

**修复**：升级 vitest ^5、electron-builder ≥26.5 清理 dev 侧；exceljs 的 uuid 问题等上游发版或加 `overrides`。

### S10【信息】进程与打包层
单实例锁、`contextIsolation + sandbox + nodeIntegration:false`、逐 channel invoke 的 preload 设计均正确；WPS 转换用 `-EncodedCommand` 不落 .ps1、COM 串行队列、只缓存正结果，思路稳妥。遗留小项：未代码签名（README 已知）、Electron 44 落后最新稳定约 1-2 个 minor，建议跟进安全补丁；`mkdtemp` 落盘的 `in-*.xls` 含报表原文（目录 0700，多用户机器上泄露面低，可接受）。

---

## 二、性能问题

### P1【中】el-table 全量 DOM 渲染大表
`SheetGrid.vue:237-268`、`TemplateGrid.vue:183-214`、`MappingPanel.vue:257-287`

el-table 无行虚拟化，5 万行 × 30 列 ≈ 150 万单元格 DOM，直接卡死（README 已知限制 3）。另 `sheetData.cells.map(...)` 每次数据变化重建包装对象数组。

**修复**：超阈值行数切虚拟滚动（el-table-v2 / vue3-virtual-scroller），或至少给出「仅渲染前 N 行 + 提示」的降级路径。

### P2【中】PDF 全页渲染与滚动/搜索无节流
同 S5。

### P3【低】SheetGrid 双 watcher 重复拉取
`SheetGrid.vue:180-189`：切换文件对时 `[side, workbook.id]` watcher 重置 sheetName 会连带触发 `watch(sheetName)`，同一 sheet 发两次 `getSheet` IPC。

**修复**：合并为一个 watcher，或在 `loadSheet` 加同参去重。

### P4【低】引擎全格遍历
`engine.ts:54-61` 对 `maxR × maxC` 逐格对比，在 S3 的幽灵选区场景下被成倍放大。修掉 S3 后自动缓解。

### P5【信息】启动期文档库串行恢复
`session.ts:270-284`：`initDocLibrary` 逐个 `loadDoc`（每个 PDF 全量 base64），文档多时启动慢。可并发限流（如 p-limit 3）+ 懒加载。

---

## 三、做得好的地方（保持）

1. 主进程安全基线扎实：contextIsolation + sandbox + nodeIntegration:false + 单实例锁 + preload 逐 channel 包装，不暴露 `ipcRenderer` 本体。
2. HTML 导出有完整转义（`& < > "` 全覆盖，无 `v-html`/`innerHTML` 注入点，全文仅 2 处 `innerHTML = ''` 清空）。
3. xlsx 选型正确：CDN tarball 锁 0.20.3 + integrity，两个 CVE 均已修复；npm 公开源拿不到修复版这个问题处理得很到位。
4. WPS COM 转换的工程细节（EncodedCommand 绕 Defender、串行化、只缓存正结果、kill 兜底注释）说明踩过坑。
5. 配置读写防「空基准覆盖」：`loadAlignConfig` 读取失败绝不静默返回空配置；`buildAlignConfig` 未就绪时放弃保存。
6. 测试与类型检查全绿，fixture 运行时生成，纯逻辑（shared/core）零框架依赖可直测。

---

## 四、修复优先级建议

| 优先级 | 项 | 预期收益 |
|---|---|---|
| 1 | S3 幽灵选区护栏 | 消除最常见的卡死/OOM 场景 |
| 2 | P1/P2 大表与 PDF 懒渲染 | 大文件可用性质变 |
| 3 | S1 协议白名单 + S2 大小/路径护栏 | 补齐 Electron 标准纵深防御 |
| 4 | S4 缓存淘汰 | 长会话内存可控 |
| 5 | S9 dev 依赖升级、S8 死依赖清理 | 缩小包体与攻击面 |
| 6 | S5/S6/S7/P3/P5 | 细节打磨 |
