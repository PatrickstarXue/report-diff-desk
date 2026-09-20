import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AlignConfig } from '@shared/types'

/** 表样人工规则配置（按表样键索引），落盘到 userData */
function alignPath(): string {
  return join(app.getPath('userData'), 'template-align.json')
}

/** 读取人工规则；文件不存在或损坏时返回空配置（不抛错，核对流程照常跑） */
export async function loadAlignConfig(): Promise<AlignConfig> {
  try {
    const raw = JSON.parse(await readFile(alignPath(), 'utf-8'))
    return {
      version: 1,
      templates: raw?.templates && typeof raw.templates === 'object' ? raw.templates : {},
      pairs: Array.isArray(raw?.pairs) ? raw.pairs : []
    }
  } catch {
    return { version: 1, templates: {}, pairs: [] }
  }
}

export async function saveAlignConfig(cfg: AlignConfig): Promise<void> {
  await writeFile(alignPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}
