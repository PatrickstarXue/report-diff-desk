import { readFile } from 'fs/promises'
import { extname } from 'path'
import type { DocContent, WorkbookData } from '@shared/types'
import { parseExcel } from './excel'
import { parseZip } from './zip'
import { parseDocx } from './docx'
import { parsePdf } from './pdf'
import { parseTxt } from './txt'
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

/** 按扩展名分发解析口径文档（Word/PDF/TXT/Excel 报表） */
export async function loadDocFile(path: string): Promise<DocContent> {
  const buf = await readFile(path)
  const ext = extname(path).toLowerCase()
  const name = path.split(/[\\/]/).pop() ?? path

  if (ext === '.docx') return { kind: 'docx', name, html: await parseDocx(buf) }
  if (ext === '.pdf') return { kind: 'pdf', name, pages: await parsePdf(buf) }
  if (ext === '.txt') return { kind: 'txt', name, pages: await parseTxt(buf) }
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = parseExcel(buf, name, 'file')
    return { kind: ext === '.xlsx' ? 'xlsx' : 'xls', name, workbooks: wb.sheetNames.map((n) => wb.sheets[n]) }
  }
  throw new Error(`暂不支持的口径文档格式：${ext || '(无扩展名)'}（旧版 .doc 请另存为 .docx）`)
}
