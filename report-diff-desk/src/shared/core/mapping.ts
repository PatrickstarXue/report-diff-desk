/** 口径映射索引：指标名 → 说明。仅存在于 renderer 内存，不过 IPC。 */
export type MappingIndex = Map<string, string>

/**
 * 两列映射数据建索引。首行若为表头（第一列含「指标」且第二列含「口径」）跳过；
 * 指标名 trim；同名后者覆盖；空指标名与缺说明的行忽略。
 */
export function buildIndex(rows: string[][]): MappingIndex {
  const index: MappingIndex = new Map()
  rows.forEach((row, i) => {
    const name = String(row[0] ?? '').trim()
    const desc = String(row[1] ?? '').trim()
    if (!name || !desc) return
    if (i === 0 && name.includes('指标') && desc.includes('口径')) return
    index.set(name, desc)
  })
  return index
}

export function lookup(index: MappingIndex, name: string): string | null {
  return index.get(name.trim()) ?? null
}
