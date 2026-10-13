import JSZip from 'jszip'
import type { WorkbookData } from '@shared/types'
import { parseExcel } from './excel'

/** 防 zip 炸弹/损坏包：条目数与解压总大小上限 */
const MAX_ZIP_ENTRIES = 500
const MAX_ZIP_TOTAL_BYTES = 500 * 1024 * 1024 // 500MB

/** 上限可注入（测试用小限额验证拦截逻辑，不真造 500MB） */
export interface ZipLimits {
  maxEntries?: number
  maxTotalBytes?: number
}

/**
 * 解压 zip（内存中，不落盘），过滤 .xlsx/.xls 条目逐个解析。
 * 文件名编码：优先 UTF-8，出现替换符（U+FFFD）时按 GBK 重解。
 */
export async function parseZip(
  buffer: Buffer,
  zipFileName: string,
  limits: ZipLimits = {}
): Promise<WorkbookData[]> {
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES
  const maxTotalBytes = limits.maxTotalBytes ?? MAX_ZIP_TOTAL_BYTES

  let zip = await JSZip.loadAsync(buffer)
  if (zipContainsReplacementChar(zip)) {
    zip = await JSZip.loadAsync(buffer, {
      decodeFileName: (bytes) => new TextDecoder('gbk').decode(bytes as Uint8Array)
    })
  }

  const entries = Object.values(zip.files)
  if (entries.length > maxEntries) {
    throw new Error(
      `压缩包条目过多（${entries.length} 个，上限 ${maxEntries} 个），可能已损坏或不是报表批量包`
    )
  }

  const results: WorkbookData[] = []
  let totalBytes = 0
  for (const entry of entries) {
    if (entry.dir || !/\.(xlsx|xls)$/i.test(entry.name)) continue
    // 先用中央目录声明的解压大小前置拦截（JSZip 内部字段，缺失则靠解压后累计兜底）
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize
    if (typeof declared === 'number' && totalBytes + declared > maxTotalBytes) {
      throw new Error(`压缩包解压后总大小超过上限（${(maxTotalBytes / 1024 / 1024).toFixed(0)}MB），已中止解析`)
    }
    const data = Buffer.from(await entry.async('uint8array'))
    totalBytes += data.length
    if (totalBytes > maxTotalBytes) {
      throw new Error(`压缩包解压后总大小超过上限（${(maxTotalBytes / 1024 / 1024).toFixed(0)}MB），已中止解析`)
    }
    results.push(parseExcel(data, `${zipFileName}/${entry.name}`, 'zip'))
  }
  return results
}

function zipContainsReplacementChar(zip: JSZip): boolean {
  return Object.values(zip.files).some((f) => f.name.includes('�'))
}
