# zip 批量比对（顺序配对）— 设计规格

> 2026-09-08 定稿。需求与配对规则经用户确认。

## 背景

现状：UI 选择入口未开放 zip（filters 只有 xlsx/xls），且 zip 加载后需手动下拉单选一个工作簿参与比对。用户需要：一次上传含多个 Excel 的 zip 压缩包，自动批量比对。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 比对方式 | zip 对 zip 自动批量比对（单文件 vs 单文件自然兼容为 1 对） |
| 配对规则 | **按压缩包内文件顺序（解析顺序）逐位配对**，不按文件名匹配；数量不一致时多出的文件不参与比对并提示 |
| 配对展示 | pairLabel 显示实际配对关系，供用户核对顺序 |

## 设计

### 数据模型（src/shared/types.ts）

```ts
interface FilePairResult {
  pairLabel: string
  baseFileName: string
  currFileName: string
  compare: CompareResult   // 复用现有单对比对结果
}
interface BatchCompareResult {
  pairs: FilePairResult[]
  unmatchedBase: string[]
  unmatchedCurr: string[]
  totalDiffs: number
}
```

### 配对引擎（新增 src/shared/core/pairing.ts，纯函数）

`matchWorkbookPairs(base: WorkbookData[], curr: WorkbookData[], threshold) → BatchCompareResult`：
- 按数组索引逐位配对（zip 解析顺序即数组顺序，单文件为 1 元素数组）
- 每对调用现有 `compareWorkbooks`（引擎零改动）
- `min(len)` 对参与；余量记入 unmatched 列表
- 单测覆盖：顺序配对、数量不等、空数组、单文件兼容

### IPC（src/main/ipc.ts）

`compare:run` 入参改 `{ baseIds: string[], currIds: string[], threshold }`（数组顺序 = 配对顺序）。main 从缓存按 id 取 WorkbookData 数组，调配对引擎。旧单 id 入参废弃。

### UI

- **FilePanel**：选择按钮 filters 增加 zip；加载后自动全量配对，删除下拉单选逻辑
- **DiffList**：顶部增加「文件对」下拉（默认全部，行内显示所属文件对）；筛选作用于当前文件对集合
- **SheetGrid**：增加文件对选择，高亮按所选对结果；跳转需携带文件对信息
- **header 摘要**：总变动数 + 配对/未参与文件数

### 导出

- Excel：按文件对分 sheet（sheet 名 = 文件名去扩展名，截断 31 字符、去非法字符）
- HTML：按文件对分节（h2 标题 + 各自统计）

### 测试

- pairing.spec.ts：顺序配对、数量不等、单文件兼容
- make-samples 增加上期包.zip / 本期包.zip（各含 2 个 Excel，其中 1 个含预期变动）
- samples 集成测试增加 zip 场景

## 不变部分

比对引擎 compareWorkbooks、数值化、解析层（excel/zip）、口径映射、文档翻阅、HTML/Excel 导出格式细节全部复用。
