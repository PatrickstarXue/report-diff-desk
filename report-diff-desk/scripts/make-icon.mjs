// 生成 resources/icon.ico：256×256 蓝渐变 + 中央白色对勾（纯代码，无图像库依赖）
// 运行：node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = join(__dirname, '..', 'resources', 'icon.ico')
mkdirSync(dirname(out), { recursive: true })

const size = 256
// 32bpp DIB（BITMAPINFOHEADER + BGRA 像素，自底向上）
const dib = Buffer.alloc(40 + size * size * 4)
dib.writeUInt32LE(40, 0)
dib.writeInt32LE(size, 4)
dib.writeInt32LE(size * 2, 8) // 高度双倍（XOR + AND 掩码）
dib.writeUInt16LE(1, 12)
dib.writeUInt16LE(32, 14)
dib.writeUInt32LE(0, 16) // BI_RGB
dib.writeUInt32LE(size * size * 4, 20)

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    // 蓝→深蓝垂直渐变
    const t = y / size
    let r = Math.round(66 - t * 46)
    let g = Math.round(133 - t * 60)
    let b = Math.round(244 - t * 100)
    // 中央画白色「√」：两条粗线段
    const cy = size - y // DIB 自底向上
    const onLine1 = Math.abs(cy - (x - 64) * 0.8 - 80) < 26 && x > 56 && x < 122
    const onLine2 = Math.abs(cy + (x - 122) * 1.1 - 200) < 26 && x > 114 && x < 208
    if (onLine1 || onLine2) {
      r = 255
      g = 255
      b = 255
    }
    const i = 40 + (y * size + x) * 4
    dib[i] = b
    dib[i + 1] = g
    dib[i + 2] = r
    dib[i + 3] = 255
  }
}

// ICO 容器：ICONDIR(6) + ICONDIRENTRY(16) + DIB
const icondir = Buffer.alloc(22)
icondir.writeUInt16LE(0, 0)
icondir.writeUInt16LE(1, 2)
icondir.writeUInt16LE(1, 4)
icondir[6] = 0 // 宽度 256 → 0
icondir[7] = 0
icondir[8] = 0
icondir[9] = 0
icondir.writeUInt16LE(1, 10)
icondir.writeUInt16LE(32, 12)
icondir.writeUInt32LE(dib.length, 14)
icondir.writeUInt32LE(22, 18)

writeFileSync(out, Buffer.concat([icondir, dib]))
console.log('图标已生成：', out)
