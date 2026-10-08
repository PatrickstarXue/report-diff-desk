import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AlignConfig } from '@shared/types'

/** 规则表配置（按 `左表样键|右表样键` 索引），落盘到 userData */
function alignPath(): string {
  return join(app.getPath('userData'), 'template-align.json')
}

/** 配色值是否可用：非空字符串即可（具体格式由渲染层解析，解析不了会兜底） */
function isColor(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * 读取规则表配置。
 * - 文件不存在（ENOENT）→ 返回空配置（首次运行，正常）
 * - 其余读取错误 / JSON 解析失败 → 抛错，绝不静默退化为空配置：
 *   调用方若拿空配置做基准保存，会把盘上已有规则整体覆盖。
 * - version 不是 2 → 按空配置（v1 的坐标规则与规则值语义没有对应关系，不做迁移）
 */
export async function loadAlignConfig(): Promise<AlignConfig> {
  let text: string
  try {
    text = await readFile(alignPath(), 'utf-8')
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'ENOENT') {
      return { version: 2, ruleTables: {} }
    }
    throw new Error(`人工规则配置读取失败：${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const raw = JSON.parse(text)
    const tables = raw?.ruleTables
    if (raw?.version !== 2 || typeof tables !== 'object' || tables === null) {
      return { version: 2, ruleTables: {} }
    }
    // anchors 是 v2 内新增的可选字段，旧文件没有就继续用默认锚点
    const anchors: string[] = Array.isArray(raw.anchors)
      ? raw.anchors.filter((s: unknown): s is string => typeof s === 'string' && s.trim() !== '')
      : []
    // colors 同为可选字段。读回时是重建对象，必须显式回填，否则落盘再读就丢了
    const cfg: AlignConfig = { version: 2, ruleTables: tables }
    if (anchors.length > 0) cfg.anchors = anchors
    const diff = raw?.colors?.diff
    const compared = raw?.colors?.compared
    if (isColor(diff) && isColor(compared)) cfg.colors = { diff, compared }
    return cfg
  } catch {
    throw new Error('人工规则配置解析失败：文件内容不是合法 JSON')
  }
}

export async function saveAlignConfig(cfg: AlignConfig): Promise<void> {
  await writeFile(alignPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}
