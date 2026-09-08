// 生成演示样例：samples/上期.xlsx 与 samples/本期.xlsx、上期包.zip 与 本期包.zip
// 覆盖：增长、下降、恰好 ±50%、从零新增、移除行、新增行、文本、公式、日期、新增列、zip 顺序配对
// 运行：npm run make:samples
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

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

// 口径映射表样例：两列（指标名、口径说明）
const mapping = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  mapping,
  XLSX.utils.aoa_to_sheet([
    ['指标名', '口径说明'],
    ['营收', '营业收入，指报告期内销售商品、提供劳务取得的收入（不含税）'],
    ['成本', '营业成本，与营业收入配比结转的直接成本'],
    ['费用', '期间费用合计，含销售费用、管理费用、财务费用'],
    ['利润', '营业利润，营业收入减去营业成本与期间费用后的余额']
  ]),
  '口径'
)

// zip 样例：模拟「NR 报表包」场景——按压缩包内顺序配对（NR01 对 NR01、NR02 对 NR02）
const zipBase = new JSZip()
const zipCurr = new JSZip()
function makeZipEntryBuf(rows, merges) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  if (merges) ws['!merges'] = merges
  XLSX.utils.book_append_sheet(wb, ws, '经营数据')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
// NR01：含 2 处变动（营收 100→200、费用 0→50）；首行 A1:B1 合并标题（验证网格合并渲染）
zipBase.file(
  'NR01_月_本外币_境内汇总数据_20260731.xlsx',
  makeZipEntryBuf(
    [['NR01 境内汇总数据', null], ['指标', '金额'], ['营收', 100], ['费用', 0], ['利润', 40]],
    [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  )
)
zipCurr.file(
  'NR01_1910_月_本外币_境内汇总数据_20260831.xlsx',
  makeZipEntryBuf(
    [['NR01 境内汇总数据', null], ['指标', '金额'], ['营收', 200], ['费用', 50], ['利润', 40]],
    [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  )
)
// NR02：无变动
zipBase.file(
  'NR02_月_本外币_境内汇总数据_20260731.xlsx',
  makeZipEntryBuf([['指标', '金额'], ['存量', 1000]])
)
zipCurr.file(
  'NR02_1910_月_本外币_境内汇总数据_20260831.xlsx',
  makeZipEntryBuf([['指标', '金额'], ['存量', 1000]])
)
// 上期包多一个文件：验证「未参与比对」提示
zipBase.file(
  'NR03_月_本外币_境内汇总数据_20260731.xlsx',
  makeZipEntryBuf([['指标', '金额'], ['备用', 1]])
)

// SheetJS ESM 版无 fs 集成，write 成 buffer 后手动写盘
writeFileSync(join(outDir, '上期.xlsx'), XLSX.write(base, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(join(outDir, '本期.xlsx'), XLSX.write(curr, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(join(outDir, '口径映射表.xlsx'), XLSX.write(mapping, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(join(outDir, '上期包.zip'), await zipBase.generateAsync({ type: 'nodebuffer' }))
writeFileSync(join(outDir, '本期包.zip'), await zipCurr.generateAsync({ type: 'nodebuffer' }))
console.log('样例已生成：')
console.log(' ', join(outDir, '上期.xlsx'))
console.log(' ', join(outDir, '本期.xlsx'))
console.log(' ', join(outDir, '口径映射表.xlsx'))
console.log(' ', join(outDir, '上期包.zip'))
console.log(' ', join(outDir, '本期包.zip'))
console.log('预期：单文件比对 6 处变动；zip 比对 2 对配对 + 上期 1 个未参与（NR03），NR01 对 2 处变动、NR02 对 0 处')
