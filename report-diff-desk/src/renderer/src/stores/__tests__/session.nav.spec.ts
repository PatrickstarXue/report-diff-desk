import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../session'

/**
 * 导航目标的回归护栏。
 *
 * 左侧菜单改成可折叠分组后，「高亮显示」(grid) 与「Mapping口径」(mapping) 都藏进了
 * 折叠的子菜单里。两处程序化跳转仍然写这两个字面量，一旦有人顺手把 index 改名，
 * 跳转就会静默失效——所以在这里钉住。
 */
describe('会话导航目标', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('默认落在首页', () => {
    expect(useSessionStore().uiTab).toBe('welcome')
  })

  it('点击明细行跳到高亮显示（grid）', () => {
    const s = useSessionStore()
    s.focusCell(0, '数据', 3, 2)
    expect(s.uiTab).toBe('grid')
    expect(s.gridFocus).toEqual({ pairIndex: 0, sheet: '数据', row: 3, col: 2 })
  })

  it('点选单元格跳到 Mapping口径（mapping）', () => {
    const s = useSessionStore()
    s.selectCell('100', '数据', 'B3', 3, 2, 'NR01_月_20260731.xlsx')
    expect(s.uiTab).toBe('mapping')
  })
})
