import { readFile, stat } from 'fs/promises'

/** 读入内存前的文件大小护栏：超出上限直接拒绝，防超大/损坏文件打爆主进程内存 */
export const MAX_FILE_BYTES = 200 * 1024 * 1024 // 200MB

/**
 * 读文件前先 stat 校验：非文件/超上限直接抛错，杜绝「先 readFile 再发现太大」的 OOM 面。
 * 所有 IPC 读路径（报表 / 映射表 / 口径文档）统一走这里。
 */
export async function readFileWithLimit(
  path: string,
  maxBytes: number = MAX_FILE_BYTES
): Promise<Buffer> {
  const st = await stat(path)
  if (!st.isFile()) throw new Error(`不是有效的文件：${path}`)
  if (st.size > maxBytes) {
    const mb = (n: number): string => (n / 1024 / 1024).toFixed(1)
    throw new Error(`文件过大（${mb(st.size)}MB，上限 ${mb(maxBytes)}MB）：${path}`)
  }
  return readFile(path)
}
