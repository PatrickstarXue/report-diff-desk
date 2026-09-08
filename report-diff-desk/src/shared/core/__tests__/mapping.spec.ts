import { describe, it, expect } from 'vitest'
import { buildIndex, lookup } from '../mapping'

describe('口径映射索引', () => {
  it('两列数据建索引：指标名 → 说明', () => {
    const index = buildIndex([
      ['营收', '营业收入，不含税'],
      ['成本', '营业成本']
    ])
    expect(lookup(index, '营收')).toBe('营业收入，不含税')
    expect(lookup(index, '成本')).toBe('营业成本')
  })

  it('首行表头（含「指标」「口径」字样）跳过', () => {
    const index = buildIndex([
      ['指标名', '口径说明'],
      ['营收', '营业收入']
    ])
    expect(lookup(index, '指标名')).toBeNull()
    expect(lookup(index, '营收')).toBe('营业收入')
  })

  it('指标名 trim 后匹配', () => {
    const index = buildIndex([[' 营收 ', '营业收入']])
    expect(lookup(index, '营收')).toBe('营业收入')
  })

  it('同名指标后者覆盖', () => {
    const index = buildIndex([
      ['营收', '旧口径'],
      ['营收', '新口径']
    ])
    expect(lookup(index, '营收')).toBe('新口径')
  })

  it('空行与缺列行跳过，未命中返回 null', () => {
    const index = buildIndex([
      ['', ''],
      ['只有名'],
      ['', '只有说明']
    ])
    expect(lookup(index, '')).toBeNull()
    expect(lookup(index, '只有名')).toBeNull()
    expect(index.size).toBe(0)
  })
})
