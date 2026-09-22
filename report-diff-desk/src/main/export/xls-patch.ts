import { CFB } from 'xlsx'

/**
 * 就地给 .xls（BIFF8）打标记：只改两处，**不改任何长度**，所以原表的一切（字体、居中、
 * 边框、列宽、行高、合并、公式）原样保留，输出仍是 .xls。
 *
 *  1. 命中格的 ixfe（样式索引，每个单元格记录里 2 字节）→ 指向新样式位
 *  2. 若干**空闲样式位**（没被任何单元格/行/列/STYLE 引用）→ 克隆该格原样式后只改填充
 *
 * 为什么必须这么绕：exceljs 读不了 biff8、写不出 .xls，开源 SheetJS 社区版也不导出样式。
 * 而 BIFF8 里新增/移动记录会牵动一堆绝对偏移，所以这里只做等长改写。
 *
 * 已知取舍：
 * - BIFF8 的填充色是**调色板索引**（0–63），不是 RGB，所以紫色只能取最接近的一项（默认调色板下
 *   是 0x17 = CCCCFF）。工作簿自带 PALETTE 记录时按它重算最近色。
 * - 空闲样式位不够时抛错，由调用方退回到「重建 xlsx」那条路。
 */

/** 目标紫（与 xlsx 路径的填充一致），实际写入时取调色板里最接近的索引 */
const TARGET_PURPLE = { r: 0xe6, g: 0xe0, b: 0xf8 }

/** SheetJS 默认调色板（索引 8 起；0–7 是内置黑/白/红/绿/蓝/黄/品红/青，不可改） */
const DEFAULT_PALETTE: number[] = [
  0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0x800000,
  0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xc0c0c0, 0x808080, 0x9999ff, 0x993366,
  0xffffcc, 0xccffff, 0x660066, 0xff8080, 0x0066cc, 0xccccff, 0x000080, 0xff00ff, 0xffff00,
  0x00ffff, 0x800080, 0x800000, 0x008080, 0x0000ff, 0x00ccff, 0xccffff, 0xccffcc, 0xffff99,
  0x99ccff, 0xff99cc, 0xcc99ff, 0xffcc99, 0x3366ff, 0x33cccc, 0x99cc00, 0xffcc00, 0xff9900,
  0xff6600, 0x666699, 0x969696, 0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366,
  0x333399, 0x333333
]

/** 命中的格（0 起始行列 + 工作表名） */
export interface XlsHit {
  sheet: string
  row: number
  col: number
}

/** 单元格记录：[记录类型, ixfe 在负载内的偏移, 是否 MUL 型（含多列）] */
const CELL_RECORDS: Record<number, { ixfeAt: number; multi?: 'rk' | 'blank' }> = {
  0x00fd: { ixfeAt: 4 }, // LABELSST
  0x0203: { ixfeAt: 4 }, // NUMBER
  0x027e: { ixfeAt: 4 }, // RK
  0x0006: { ixfeAt: 4 }, // FORMULA
  0x0205: { ixfeAt: 4 }, // BOOLERR
  0x0204: { ixfeAt: 4 }, // LABEL
  0x0201: { ixfeAt: 4 }, // BLANK
  0x00bd: { ixfeAt: 4, multi: 'rk' }, // MULRK
  0x00be: { ixfeAt: 4, multi: 'blank' } // MULBLANK
}

const REC = {
  bof: 0x0809,
  boundSheet: 0x0085,
  xf: 0x00e0,
  style: 0x0293,
  row: 0x0208,
  colInfo: 0x007d,
  palette: 0x0092,
  eof: 0x000a
}

interface CellRef {
  sheetIndex: number
  row: number
  col: number
  /** ixfe 字段在整条流里的绝对偏移 */
  ixfeOffset: number
  ixfe: number
}

interface StreamIndex {
  /** BOUNDSHEET 给出的工作表 BOF 绝对偏移 → 名字（已 trim） */
  sheets: { offset: number; name: string }[]
  refs: CellRef[]
  /** XF 记录在流里的绝对偏移，下标即 XF 索引 */
  xfOffsets: number[]
  /** 已被引用的 XF 索引（单元格 / STYLE / 行 / 列） */
  usedXf: Set<number>
  palette: number[] | null
}

/** 读 BIFF8 的 Unicode 短字符串（1 字节长度 + 1 字节标志，可选压缩） */
function readWideString(buf: Buffer, at: number): { text: string; next: number } {
  const cch = buf[at]
  const flags = buf[at + 1]
  const start = at + 2
  if (flags & 0x01) {
    const text = buf.toString('utf16le', start, start + cch * 2)
    return { text, next: start + cch * 2 }
  }
  return { text: buf.toString('latin1', start, start + cch), next: start + cch }
}

/** 扫一遍 BIFF 记录，建出定位所需的索引 */
function indexStream(buf: Buffer): StreamIndex {
  const sheets: { offset: number; name: string }[] = []
  const refs: CellRef[] = []
  const xfOffsets: number[] = []
  const usedXf = new Set<number>()
  let palette: number[] | null = null

  // 先收集工作表 BOF（globals 之外），再给每个单元格记录归属
  const bofOffsets: number[] = []
  const boundSheets: { offset: number; name: string }[] = []

  let i = 0
  while (i + 4 <= buf.length) {
    const type = buf.readUInt16LE(i)
    const len = buf.readUInt16LE(i + 2)
    if (len < 0 || i + 4 + len > buf.length) break
    const p = i + 4
    switch (type) {
      case REC.bof:
        bofOffsets.push(i)
        break
      case REC.boundSheet: {
        const offset = buf.readUInt32LE(p)
        const { text } = readWideString(buf, p + 6)
        boundSheets.push({ offset, name: text.trim() })
        break
      }
      case REC.xf:
        xfOffsets.push(i)
        break
      case REC.style:
        usedXf.add(buf.readUInt16LE(p))
        break
      case REC.row:
        usedXf.add(buf.readUInt16LE(p + 12))
        break
      case REC.colInfo:
        usedXf.add(buf.readUInt16LE(p + 6))
        break
      case REC.palette: {
        const n = buf.readUInt16LE(p)
        const colors: number[] = [...DEFAULT_PALETTE]
        for (let k = 0; k < n && k < 56; k++) {
          const rgb = buf.readUInt32LE(p + 2 + k * 4) & 0xffffff
          colors[8 + k] = rgb
        }
        palette = colors
        break
      }
      default: {
        const spec = CELL_RECORDS[type]
        if (spec) {
          const row = buf.readUInt16LE(p)
          const col = buf.readUInt16LE(p + 2)
          if (spec.multi === 'rk') {
            const count = (len - 6) / 6
            for (let k = 0; k < count; k++) {
              refs.push({
                sheetIndex: -1,
                row,
                col: col + k,
                ixfeOffset: p + 4 + k * 6,
                ixfe: buf.readUInt16LE(p + 4 + k * 6)
              })
            }
          } else if (spec.multi === 'blank') {
            const count = (len - 6) / 2
            for (let k = 0; k < count; k++) {
              refs.push({
                sheetIndex: -1,
                row,
                col: col + k,
                ixfeOffset: p + 4 + k * 2,
                ixfe: buf.readUInt16LE(p + 4 + k * 2)
              })
            }
          } else {
            refs.push({ sheetIndex: -1, row, col, ixfeOffset: p + spec.ixfeAt, ixfe: buf.readUInt16LE(p + spec.ixfeAt) })
          }
        }
      }
    }
    i += 4 + len
  }

  // 工作表 BOF：globals 之后的那些（第一个 BOF 是 globals）
  const sheetBofs = bofOffsets.slice(1)
  for (const ref of refs) {
    // 归属：偏移不大于它的最后一个工作表 BOF
    let idx = 0
    for (let k = 0; k < sheetBofs.length; k++) if (sheetBofs[k] <= ref.ixfeOffset) idx = k
    ref.sheetIndex = idx
  }
  // BOUNDSHEET 的 lbPlyPos 就是工作表 BOF 的绝对偏移，用它换成名字
  for (const bs of boundSheets) {
    const idx = sheetBofs.indexOf(bs.offset)
    if (idx >= 0) sheets[idx] = { offset: bs.offset, name: bs.name }
  }
  for (const ref of refs) usedXf.add(ref.ixfe)
  return { sheets, refs, xfOffsets, usedXf, palette }
}

/** palette 里最接近目标紫的索引 */
function nearestPurpleIndex(palette: number[]): number {
  let best = 8
  let bestDist = Infinity
  for (let k = 8; k < palette.length; k++) {
    const c = palette[k]
    const dr = ((c >> 16) & 0xff) - TARGET_PURPLE.r
    const dg = ((c >> 8) & 0xff) - TARGET_PURPLE.g
    const db = (c & 0xff) - TARGET_PURPLE.b
    const dist = dr * dr + dg * dg + db * db
    if (dist < bestDist) {
      bestDist = dist
      best = k
    }
  }
  return best
}

/**
 * XF 记录里只改填充：图案设为 solid（c >> 26），前景/背景色设为调色板索引（d 字段）。
 * 布局取自 SheetJS 的 parse_CellStyleXF：4 字节对齐 + 4 字节边框 + 4 字节（含图案）+ 2 字节颜色。
 */
function setSolidFill(buf: Buffer, xfOffset: number, colorIndex: number): void {
  const p = xfOffset + 4
  const c = (buf.readUInt32LE(p + 8) & 0x03ffffff) | (1 << 26) // 图案索引 1 = solid
  buf.writeUInt32LE(c >>> 0, p + 8)
  const d = (colorIndex & 0x7f) | ((colorIndex & 0x7f) << 7) // icvFore | icvBack
  buf.writeUInt16LE(d, p + 12)
}

/** 把命中的格标成实心紫（就地改写，字节数不变） */
export function patchXlsHits(buffer: Buffer, hits: XlsHit[]): Buffer {
  const cfb = CFB.read(buffer, { type: 'buffer' }) as {
    FullPaths: string[]
    FileIndex: { content: Buffer }[]
  }
  const wi = cfb.FullPaths.findIndex((p) => /Workbook|Book$/i.test(p))
  if (wi < 0) throw new Error('.xls 结构异常：找不到 Workbook 流')
  const stream = Buffer.from(cfb.FileIndex[wi].content)
  const idx = indexStream(stream)

  const purple = nearestPurpleIndex(idx.palette ?? DEFAULT_PALETTE)
  // 命中格按工作表名分组（两边名字都 trim 后比，避开尾部空格差异）
  const want = new Map<string, Map<string, XlsHit>>()
  for (const h of hits) {
    const key = h.sheet.trim()
    const m = want.get(key) ?? new Map<string, XlsHit>()
    m.set(`${h.row},${h.col}`, h)
    want.set(key, m)
  }

  // 每个「原样式位」映射到一个新样式位：可能需要多个空闲位，先算还差多少
  const bySheet = new Map<number, Map<string, XlsHit>>()
  for (const [sheetName, m] of want) {
    const sheetIdx = idx.sheets.findIndex((s) => s.name === sheetName)
    if (sheetIdx < 0) continue // 表名对不上（不该发生），跳过
    bySheet.set(sheetIdx, m)
  }

  const target: { ref: CellRef; original: number }[] = []
  for (const ref of idx.refs) {
    const m = bySheet.get(ref.sheetIndex)
    if (m?.has(`${ref.row},${ref.col}`)) target.push({ ref, original: ref.ixfe })
  }
  if (target.length === 0) return Buffer.from(CFB.write(cfb, { type: 'buffer' }) as Buffer)

  // 空闲样式位。优先挑「看着就是默认样式」的（无填充、默认字体与格式），
  // 以防有我们没扫到的引用（如条件格式的格式位）——别把那种位刷成紫。
  const looksDefault = (k: number): boolean => {
    const p = idx.xfOffsets[k] + 4
    return (
      stream.readUInt32LE(p + 8) >>> 26 === 0 && // 无填充图案
      stream.readUInt16LE(p) === 0 && // 默认字体
      stream.readUInt16LE(p + 2) === 0 // 默认格式
    )
  }
  const free: number[] = []
  const spare: number[] = []
  for (let k = 0; k < idx.xfOffsets.length; k++) {
    if (idx.usedXf.has(k)) continue
    ;(looksDefault(k) ? free : spare).push(k)
  }
  free.push(...spare)

  const remap = new Map<number, number>() // 原样式位 → 新样式位
  for (const t of target) {
    if (remap.has(t.original)) continue
    const reuse = free.shift()
    if (reuse === undefined) {
      throw new Error('.xls 空闲样式位不够，无法在原格式上加标记')
    }
    // 克隆原样式的全部字段，仅把填充改成实心紫
    stream.copy(stream, idx.xfOffsets[reuse] + 4, idx.xfOffsets[t.original] + 4, idx.xfOffsets[t.original] + 24)
    setSolidFill(stream, idx.xfOffsets[reuse], purple)
    remap.set(t.original, reuse)
  }
  for (const t of target) {
    stream.writeUInt16LE(remap.get(t.original) as number, t.ref.ixfeOffset)
  }

  cfb.FileIndex[wi].content = stream
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }) as Buffer)
}

/** 读回每个格的填充（测试与排查用）：`"sheet|row,col"` → 图案与前景色索引 */
export function readXlsFills(buffer: Buffer): Map<string, { pattern: number; fore: number }> {
  const cfb = CFB.read(buffer, { type: 'buffer' }) as { FullPaths: string[]; FileIndex: { content: Buffer }[] }
  const wi = cfb.FullPaths.findIndex((p) => /Workbook|Book$/i.test(p))
  const stream = Buffer.from(cfb.FileIndex[wi].content)
  const idx = indexStream(stream)
  const out = new Map<string, { pattern: number; fore: number }>()
  for (const ref of idx.refs) {
    const off = idx.xfOffsets[ref.ixfe]
    if (off === undefined) continue
    const c = stream.readUInt32LE(off + 4 + 8)
    const d = stream.readUInt16LE(off + 4 + 12)
    out.set(`${idx.sheets[ref.sheetIndex]?.name ?? ref.sheetIndex}|${ref.row},${ref.col}`, {
      pattern: c >>> 26,
      fore: d & 0x7f
    })
  }
  return out
}
