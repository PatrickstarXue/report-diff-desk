import { readFile } from 'fs/promises'
import { extname } from 'path'
import type { WorkbookData } from '@shared/types'
import { parseExcel } from './excel'
import { parseZip } from './zip'
import { putWorkbook } from '../store'

/** 按扩展名分发解析报表文件（单 Excel 或 zip 包），结果写入会话缓存 */
export async function loadReportFile(path: string): Promise<WorkbookData[]> {
  const buf = await readFile(path)
  const ext = extname(path).toLowerCase()
  const baseName = path.split(/[\\/]/).pop() ?? path

  if (ext === '.xlsx' || ext === '.xls') {
    return [putWorkbook(parseExcel(buf, baseName, 'file'))]
  }
  if (ext === '.zip') {
    return (await parseZip(buf, baseName)).map((wb) => putWorkbook(wb))
  }
  throw new Error(`暂不支持的报表格式：${ext || '(无扩展名)'}`)
}
