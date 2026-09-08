// 生成演示样例：samples/上期.xlsx 与 samples/本期.xlsx
// 覆盖：增长、下降、恰好 ±50%、从零新增、移除行、新增行、文本、公式、日期、新增列
// 运行：npm run make:samples
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'samples')
mkdirSync(outDir, { recursive: true })

const base = XLSX.utils.book_new()
const curr = XLSX.utils.book_new()

// 行 9 移除指标（本期同坐标为空 → removed）；行 10 新增指标（上期同坐标为空 → new）
const baseSheet1 = XLSX.utils.aoa_to_sheet([
  ['指标', '金额'],
  ['营收', 100],
  ['成本', 60],
  ['费用', 0],
  ['利润', 40],
  ['恰好50%', 80],
  ['恰好-50%', 200],
  ['文本说明', '固定文本'],
  ['移除指标', 10],
  ['新增指标', null],
  ['公式合计', null],
  ['千分位文本', '1,000']
])
baseSheet1['B11'] = { t: 'n', f: 'SUM(B2:B10)', v: 490 }
const currSheet1 = XLSX.utils.aoa_to_sheet([
  ['指标', '金额'],
  ['营收', 200], // 增长 100%
  ['成本', 30], // 下降 -50%（恰好，不标记）
  ['费用', 50], // 从零新增（zero-base）
  ['利润', 40], // 不变
  ['恰好50%', 120], // 恰好 +50%（不标记）
  ['恰好-50%', 100], // 恰好 -50%（不标记）
  ['文本说明', '固定文本'], // 文本不参与
  ['移除指标', null], // 本期空 → removed
  ['新增指标', 5], // 上期空 → new
  ['公式合计', null],
  ['千分位文本', '2,000'] // 增长 100%
])
currSheet1['B11'] = { t: 'n', f: 'SUM(B2:B10)', v: 545 }
XLSX.utils.book_append_sheet(base, baseSheet1, '经营数据')
XLSX.utils.book_append_sheet(curr, currSheet1, '经营数据')

// 日期 sheet：不参与环比
const baseSheet2 = XLSX.utils.aoa_to_sheet([['报表日期'], ['2026-07-31']])
const currSheet2 = XLSX.utils.aoa_to_sheet([['报表日期'], ['2026-08-31']])
XLSX.utils.book_append_sheet(base, baseSheet2, '报表信息')
XLSX.utils.book_append_sheet(curr, currSheet2, '报表信息')

// 本期多一列：C2 数值 → new（C1 表头文本不参与）
const baseSheet3 = XLSX.utils.aoa_to_sheet([
  ['A', 'B'],
  [1, 2]
])
const currSheet3 = XLSX.utils.aoa_to_sheet([
  ['A', 'B', 'C（新增列）'],
  [1, 2, 3]
])
XLSX.utils.book_append_sheet(base, baseSheet3, '多一列')
XLSX.utils.book_append_sheet(curr, currSheet3, '多一列')

// SheetJS ESM 版无 fs 集成，write 成 buffer 后手动写盘
writeFileSync(join(outDir, '上期.xlsx'), XLSX.write(base, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(join(outDir, '本期.xlsx'), XLSX.write(curr, { type: 'buffer', bookType: 'xlsx' }))
console.log('样例已生成：')
console.log(' ', join(outDir, '上期.xlsx'))
console.log(' ', join(outDir, '本期.xlsx'))
console.log('预期比对结果：6 处变动（营收增长、费用从零、移除指标、新增指标、千分位增长、多一列新增）')
