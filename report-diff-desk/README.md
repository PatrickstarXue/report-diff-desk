# 报表比对工具（report-diff-desk）

本地桌面工具：读取两份 Excel 报表（或 zip 压缩包内多个 Excel），按结构对齐做环比比对，标记 |变动率|>50% 的单元格并定位；支持口径文档翻阅与预建映射表点选查询；全部运算在本机完成，不上传云端。

技术栈：Vue 3 + Element Plus + Electron。

## 使用

```bash
npm install
npm run dev          # 开发模式
npm test             # 单元测试（51 个）
npm run make:samples # 生成演示样例（samples/ 目录）
npm run build:win    # 打包：安装版 + 便携版（dist/ 目录）
```

便携版 `dist/报表比对工具-Portable-0.1.0.exe` 双击即用，免安装、无需 Node 环境。

## 功能

1. **报表读取**：上期/本期各选一个 .xlsx/.xls 文件，或一个 zip 包（内含多个 Excel，下拉选择工作簿）
2. **环比比对**：按「sheet 名 + 单元格坐标」结构对齐逐格对比；变动率 = (本期-上期)/上期，|变动率| > 阈值（默认 50%）的单元格标记，含从零新增、新增/移除行、恰好阈值边界等规则
3. **结果展示**：变动明细表（红涨绿跌橙新增）+ 网格高亮（黄底）+ 行点击跳转定位
4. **口径查询**：导入两列映射表（指标名、口径说明），点击任意单元格按文本精确命中显示口径
5. **口径文档**：打开 Word(.docx)/PDF/TXT 原文翻阅，支持关键字过滤、字号调节
6. **导出**：Excel 明细（带行填充色与百分比格式）+ 自包含 HTML 报告（内嵌样式，断网可开）

## 比对规则细节

- sheet 名 trim 后精确匹配；不匹配的表不参与比对并在结果中提示
- 变动率 |(本期-上期)/上期| > 阈值（严格大于）才标记
- 上期为 0 且本期非 0：记 100%（「从零新增」）；双 0 不标记
- 上期空 → 本期有值：新增；上期有值 → 本期空：移除
- 数字文本（千分位、百分号、科学计数法）参与比对；日期、纯文本不参与
- 公式单元格取 Excel 保存时自带的缓存计算值

## 已知限制

1. 旧版 .doc 不支持（文件选择框已过滤），请另存为 .docx
2. 第三方工具生成的 xlsx 若无公式缓存值，公式格视为空
3. 超大表（>5 万行）网格渲染可能偏慢
4. 默认无代码签名，Windows SmartScreen 可能提示，选择「仍要运行」即可

## 开发

- `src/shared/`：纯逻辑（比对引擎、数值化、映射索引），零 Node/Electron 依赖，可直接单测
- `src/main/`：文件 IO、解析、IPC handler、导出（文件运算全部在此进程）
- `src/preload/`：contextBridge 暴露 `window.api`（契约见 `src/shared/api.ts`）
- `src/renderer/`：Vue 3 UI，无 Node 能力（contextIsolation + sandbox）
- 测试：vitest，fixtures 运行时生成（不入库）；`scripts/make-samples.mjs` 生成手动验证样例
