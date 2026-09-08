import ExcelJS from 'exceljs'
import type { CompareResult, DiffKind } from '@shared/types'
import { KIND_LABEL } from '@shared/core/engine'

/** 行填充色（中国习惯：红涨绿跌橙新增），ARGB 格式 */
const FILL: Record<DiffKind, string> = {
  increase: 'FFFDE2E2',
  decrease: 'FFE1F3D8',
  'zero-base': 'FFFDF6EC',
  new: 'FFFDF6EC',
  removed: 'FFFDF6EC'
}

/**
 * 变动明细 xlsx（每行一个变动单元格，行填充色 + 变动率百分比格式）。
 * 用 exceljs 而非 SheetJS 写入：SheetJS 社区版 xlsx 写 fill 样式会丢失。
 */
export async function buildExcelBuffer(result: CompareResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('变动明细')
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

  return Buffer.from(await wb.xlsx.writeBuffer())
}
