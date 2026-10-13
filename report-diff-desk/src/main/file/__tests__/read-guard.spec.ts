import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileWithLimit, MAX_FILE_BYTES } from '../read-guard'

const tmpDirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rdd-guard-'))
  tmpDirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })))
})

describe('readFileWithLimit (S2 读路径护栏)', () => {
  it('正常读取文件内容', async () => {
    const dir = await makeTmpDir()
    const p = join(dir, 'ok.txt')
    await writeFile(p, 'hello')
    const buf = await readFileWithLimit(p)
    expect(buf.toString()).toBe('hello')
  })

  it('超过上限直接抛错（先 stat 后读，不打爆内存）', async () => {
    const dir = await makeTmpDir()
    const p = join(dir, 'big.bin')
    await writeFile(p, Buffer.alloc(2048, 7))
    await expect(readFileWithLimit(p, 1024)).rejects.toThrow('文件过大')
  })

  it('目录路径抛错', async () => {
    const dir = await makeTmpDir()
    await expect(readFileWithLimit(dir)).rejects.toThrow('不是有效的文件')
  })

  it('不存在的文件抛错', async () => {
    const dir = await makeTmpDir()
    await expect(readFileWithLimit(join(dir, 'nope.xlsx'))).rejects.toThrow()
  })

  it('默认上限 200MB', () => {
    expect(MAX_FILE_BYTES).toBe(200 * 1024 * 1024)
  })
})
