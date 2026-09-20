import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AlignConfig } from '@shared/types'

/** 表样人工规则配置（按表样键索引），落盘到 userData */
function alignPath(): string {
  return join(app.getPath('userData'), 'template-align.json')
}

/**
 * 读取人工规则。
 * - 文件不存在（ENOENT）→ 返回空配置（首次运行，正常）
 * - 其余读取错误 / JSON 解析失败 → 抛错，绝不静默退化为空配置：
 *   调用方若拿空配置做基准合并保存，会把盘上已有规则整体覆盖。
 */
export async function loadAlignConfig(): Promise<AlignConfig> {
  let text: string
  try {
    text = await readFile(alignPath(), 'utf-8')
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'ENOENT') {
      return { version: 1, templates: {}, pairs: [] }
    }
    throw new Error(`人工规则配置读取失败：${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const raw = JSON.parse(text)
    return {
      version: 1,
      templates: raw?.templates && typeof raw.templates === 'object' ? raw.templates : {},
      pairs: Array.isArray(raw?.pairs) ? raw.pairs : []
    }
  } catch {
    throw new Error('人工规则配置解析失败：文件内容不是合法 JSON')
  }
}

export async function saveAlignConfig(cfg: AlignConfig): Promise<void> {
  await writeFile(alignPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}
