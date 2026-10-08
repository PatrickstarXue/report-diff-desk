/** 新旧表比对网格的两种标记配色；与 Element Plus 的默认主色无关，可直接被用户覆盖 */
export const DEFAULT_TEMPLATE_COLORS = {
  diff: '#ffd6e8',
  compared: '#fff3cd'
}

const DARK_TEXT = '#1f2937'
const LIGHT_TEXT = '#ffffff'

/** `#rgb` / `#rrggbb` → RGB；其它格式（含 el-color-picker 不开透明通道时不会产出的 rgb()）一律返回 null */
function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  const h = m[1]
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}

/** sRGB 分量线性化（WCAG 2.x 定义） */
function linearize(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * 按背景色明度挑可读的文字色，用户把标记背景调成深色时不会看不清。
 * 阈值 0.179 是黑/白文字对比度相等的分界点；解析不出颜色时按浅色背景处理。
 */
export function readableTextOn(bg: string): string {
  const rgb = parseHex(bg)
  if (!rgb) return DARK_TEXT
  const l = 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2])
  return l > 0.179 ? DARK_TEXT : LIGHT_TEXT
}
