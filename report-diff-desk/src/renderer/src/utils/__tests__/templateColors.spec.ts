import { describe, it, expect } from 'vitest'
import { DEFAULT_TEMPLATE_COLORS, readableTextOn } from '../templateColors'

describe('readableTextOn', () => {
  it('浅色背景配深色文字', () => {
    expect(readableTextOn('#ffffff')).toBe('#1f2937')
    expect(readableTextOn('#ffd6e8')).toBe('#1f2937')
    expect(readableTextOn('#fff3cd')).toBe('#1f2937')
  })

  it('深色背景配白色文字', () => {
    expect(readableTextOn('#000000')).toBe('#ffffff')
    expect(readableTextOn('#333333')).toBe('#ffffff')
    expect(readableTextOn('#880000')).toBe('#ffffff')
  })

  it('三位简写与六位等价', () => {
    expect(readableTextOn('#fff')).toBe(readableTextOn('#ffffff'))
    expect(readableTextOn('#000')).toBe(readableTextOn('#000000'))
    expect(readableTextOn('#f0f')).toBe(readableTextOn('#ff00ff'))
  })

  it('大小写与首尾空白不影响结果', () => {
    expect(readableTextOn('  #FFFFFF  ')).toBe('#1f2937')
  })

  it('解析不出的颜色按浅色背景兜底', () => {
    expect(readableTextOn('')).toBe('#1f2937')
    expect(readableTextOn('rgb(0, 0, 0)')).toBe('#1f2937')
    expect(readableTextOn('#xyz')).toBe('#1f2937')
  })

  it('默认配色都能得到深色文字（浅底）', () => {
    expect(readableTextOn(DEFAULT_TEMPLATE_COLORS.diff)).toBe('#1f2937')
    expect(readableTextOn(DEFAULT_TEMPLATE_COLORS.compared)).toBe('#1f2937')
  })
})
