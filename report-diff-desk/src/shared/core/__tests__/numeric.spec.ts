import { describe, it, expect } from 'vitest'
import { toNumeric } from '../numeric'
import type { GridCell } from '@shared/types'

const num = (v: GridCell['v']): GridCell => ({ v })

describe('toNumeric', () => {
  it('数字原值返回', () => {
    expect(toNumeric(num(100))).toBe(100)
    expect(toNumeric(num(-50))).toBe(-50)
    expect(toNumeric(num(1.5))).toBe(1.5)
    expect(toNumeric(num(0))).toBe(0)
  })

  it('千分位文本', () => {
    expect(toNumeric(num('1,234'))).toBe(1234)
    expect(toNumeric(num(' 1,234,567 '))).toBe(1234567)
  })

  it('百分比文本先除 100', () => {
    expect(toNumeric(num('12%'))).toBeCloseTo(0.12)
    expect(toNumeric(num(' 100% '))).toBe(1)
  })

  it('科学计数法', () => {
    expect(toNumeric(num('1.5e3'))).toBe(1500)
    expect(toNumeric(num(1.5e3))).toBe(1500)
  })

  it('非法文本返回 null', () => {
    expect(toNumeric(num('abc'))).toBeNull()
    expect(toNumeric(num(''))).toBeNull()
    expect(toNumeric(num('   '))).toBeNull()
    expect(toNumeric(num('12%x'))).toBeNull()
  })

  it('null/undefined/布尔返回 null', () => {
    expect(toNumeric(null)).toBeNull()
    expect(toNumeric(num(null))).toBeNull()
    expect(toNumeric(num(true))).toBeNull()
    expect(toNumeric(num(false))).toBeNull()
  })

  it('日期格返回 null（防止 "2026-01-15" 被 parseFloat 成 2026）', () => {
    expect(toNumeric({ v: '2026-01-15', isDate: true })).toBeNull()
  })
})
