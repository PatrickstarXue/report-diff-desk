import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { loadReportFile } from '../../../main/file/loader'
import { compareWorkbooks } from '../engine'

// 验证 make-samples.mjs 生成的样例与引擎输出一致（先运行 npm run make:samples）
const BASE = join(process.cwd(), 'samples', '上期.xlsx')
const CURR = join(process.cwd(), 'samples', '本期.xlsx')

describe.skipIf(!existsSync(BASE) || !existsSync(CURR))('样例集成', () => {
  it('样例比对结果与设计值一致：6 处变动', async () => {
    const [base] = await loadReportFile(BASE)
    const [curr] = await loadReportFile(CURR)
    const r = compareWorkbooks(base, curr, 0.5)

    expect(r.sheetsMatched).toEqual(['经营数据', '报表信息', '多一列'])
    expect(r.diffs).toHaveLength(6)

    const byKey = new Map(r.diffs.map((d) => [`${d.sheet}:${d.ref}`, d]))
    expect(byKey.get('经营数据:B2')).toMatchObject({ kind: 'increase', changeRate: 1 }) // 营收 100→200
    expect(byKey.get('经营数据:B4')).toMatchObject({ kind: 'zero-base' }) // 费用 0→50
    expect(byKey.get('经营数据:B9')).toMatchObject({ kind: 'removed' }) // 移除指标 10→空
    expect(byKey.get('经营数据:B10')).toMatchObject({ kind: 'new' }) // 新增指标 空→5
    expect(byKey.get('经营数据:B12')).toMatchObject({ kind: 'increase', prevNum: 1000 }) // 千分位 1,000→2,000
    expect(byKey.get('多一列:C2')).toMatchObject({ kind: 'new' }) // 本期新增列（数值）
    // 恰好 ±50% 与日期、文本、公式（11% 变动）不标记
    expect(r.diffs.some((d) => ['B6', 'B7', 'B11'].includes(d.ref))).toBe(false)
  })
})
