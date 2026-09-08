import JSZip from 'jszip'
import type { WorkbookData } from '@shared/types'
import { parseExcel } from './excel'

/**
 * 解压 zip（内存中，不落盘），过滤 .xlsx/.xls 条目逐个解析。
 * 文件名编码：优先 UTF-8，出现替换符（U+FFFD）时按 GBK 重解。
 */
export async function parseZip(buffer: Buffer, zipFileName: string): Promise<WorkbookData[]> {
  let zip = await JSZip.loadAsync(buffer)
  if (zipContainsReplacementChar(zip)) {
    zip = await JSZip.loadAsync(buffer, {
      decodeFileName: (bytes) => new TextDecoder('gbk').decode(bytes as Uint8Array)
    })
  }

  const results: WorkbookData[] = []
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(xlsx|xls)$/i.test(entry.name)) continue
    const data = Buffer.from(await entry.async('uint8array'))
    results.push(parseExcel(data, `${zipFileName}/${entry.name}`, 'zip'))
  }
  return results
}

function zipContainsReplacementChar(zip: JSZip): boolean {
  return Object.values(zip.files).some((f) => f.name.includes('�'))
}
