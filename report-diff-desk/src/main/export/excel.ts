import ExcelJS from 'exceljs'
import type { BatchCompareResult, CompareResult, DiffKind } from '@shared/types'
import { KIND_LABEL } from '@shared/core/engine'

/** 行填充色（中国习惯：红涨绿跌橙新增），ARGB 格式 */
const FILL: Record<DiffKind, string> = {
  increase: 'FFFDE2E2',
  decrease: 'FFE1F3D8',
  'zero-base': 'FFFDF6EC',
  new: 'FFFDF6EC',
  removed: 'FFFDF6EC'
}

/** sheet 名 = 文件名去扩展名，去 Excel 非法字符、截 31 字符、重名加序号 */
function sheetNameOf(fileName: string, used: Set<string>): string {
  let name = fileName.replace(/\.(xlsx|xls)$/i, '').replace(/[\\/?*[\]:]/g, '_').slice(0, 31)
  let candidate = name
  let i = 2
  while (used.has(candidate)) {
    candidate = `${name.slice(0, 27)}~${i++}`
  }
  used.add(candidate)
  return candidate
}

function appendResultSheet(wb: ExcelJS.Workbook, name: string, result: CompareResult): void {
  const ws = wb.addWorksheet(name)
  ws.columns = [
    { header: '工作表', key: 'sheet', width: 16 },
    { header: '坐标', key: 'ref', width: 10 },
    { header: '上期值', key: 'prev', width: 14 },
    { header: '本期值', key: 'curr', width: 14 },
    { header: '变动率', key: 'rate', width: 12 },
    { header: '类型', key: 'kind', width: 12 }
  ]

  for (const d of result.diffs) {
    const row = ws.addRow([d.sheet, d.ref, d.prevValue ?? '', d.currValue ?? '', d.changeRate, KIND_LABEL[d.kind]])
    const argb = FILL[d.kind]
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    })
    row.getCell(5).numFmt = '0.0%'
  }
}

/**
 * 批量变动明细 xlsx：每个文件对一个 sheet（sheet 名 = 上期文件名去扩展名）。
 * 用 exceljs 而非 SheetJS 写入：SheetJS 社区版 xlsx 写 fill 样式会丢失。
 */
export async function buildExcelBuffer(batch: BatchCompareResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const used = new Set<string>()
  for (const p of batch.pairs) {
    appendResultSheet(wb, sheetNameOf(p.baseFileName, used), p.compare)
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
