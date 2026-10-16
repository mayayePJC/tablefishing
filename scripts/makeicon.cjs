/**
 * 生成钓鱼桌宠的应用图标：星露谷风「鱼 + 水」圆角方牌，多尺寸 PNG 组装成 .ico。
 * 依赖 @napi-rs/canvas（仓库已装）。运行：node scripts/makeicon.cjs
 */
const fs = require('fs')
const path = require('path')
const { createCanvas } = require('@napi-rs/canvas')

const SIZES = [256, 128, 64, 48, 32, 16]

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawIcon(size) {
  const cv = createCanvas(size, size)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = true

  // —— 圆角方牌背景（深青渐变）——
  const r = Math.round(size * 0.22)
  roundRect(ctx, 0, 0, size, size, r)
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0, '#2f7d96')
  g.addColorStop(1, '#16485b')
  ctx.fillStyle = g
  ctx.fill()

  // 内圈高光描边
  const lw = Math.max(1, size * 0.045)
  ctx.lineWidth = lw
  ctx.strokeStyle = 'rgba(190,235,245,0.40)'
  roundRect(ctx, lw / 2, lw / 2, size - lw, size - lw, r * 0.85)
  ctx.stroke()

  // —— 底部水波 ——
  ctx.fillStyle = 'rgba(125,210,235,0.30)'
  ctx.beginPath()
  ctx.ellipse(size / 2, size * 0.74, size * 0.34, size * 0.20, 0, 0, Math.PI * 2)
  ctx.fill()

  // —— 鱼（奶油黄，朝右）——
  const cx = size * 0.5
  const cy = size * 0.45
  const bodyRx = size * 0.26
  const bodyRy = size * 0.165

  // 尾鳍（左侧）
  ctx.fillStyle = '#f4e4b8'
  ctx.beginPath()
  ctx.moveTo(cx - bodyRx, cy)
  ctx.lineTo(cx - bodyRx - size * 0.13, cy - size * 0.13)
  ctx.lineTo(cx - bodyRx - size * 0.13, cy + size * 0.13)
  ctx.closePath()
  ctx.fill()

  // 身体
  ctx.beginPath()
  ctx.ellipse(cx, cy, bodyRx, bodyRy, 0, 0, Math.PI * 2)
  ctx.fill()

  // 背鳍
  ctx.beginPath()
  ctx.moveTo(cx, cy - bodyRy)
  ctx.lineTo(cx + size * 0.07, cy - bodyRy - size * 0.11)
  ctx.lineTo(cx + size * 0.15, cy - bodyRy)
  ctx.closePath()
  ctx.fill()

  // 腹部阴影
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.beginPath()
  ctx.ellipse(cx, cy + bodyRy * 0.5, bodyRx * 0.82, bodyRy * 0.45, 0, 0, Math.PI * 2)
  ctx.fill()

  // 眼睛
  ctx.fillStyle = '#1c2b33'
  ctx.beginPath()
  ctx.arc(cx + bodyRx * 0.58, cy - bodyRy * 0.18, Math.max(1.2, size * 0.032), 0, Math.PI * 2)
  ctx.fill()

  // 嘴边水花
  ctx.fillStyle = 'rgba(225,248,252,0.92)'
  ctx.beginPath()
  ctx.arc(cx + bodyRx + size * 0.03, cy - bodyRy * 0.35, size * 0.055, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + bodyRx + size * 0.10, cy - bodyRy * 0.05, size * 0.035, 0, Math.PI * 2)
  ctx.fill()

  return cv.toBuffer('image/png')
}

// —— 组装 ICO（PNG-in-ICO，支持 256）——
const pngs = SIZES.map((s) => ({ size: s, buf: drawIcon(s) }))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type = icon
header.writeUInt16LE(pngs.length, 4)

let offset = 6 + 16 * pngs.length
const entries = []
for (const p of pngs) {
  const e = Buffer.alloc(16)
  e.writeUInt8(p.size >= 256 ? 0 : p.size, 0) // width (0 => 256)
  e.writeUInt8(p.size >= 256 ? 0 : p.size, 1) // height
  e.writeUInt8(0, 2) // colors
  e.writeUInt8(0, 3) // reserved
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bit count
  e.writeUInt32LE(p.buf.length, 8) // bytes
  e.writeUInt32LE(offset, 12) // offset
  entries.push(e)
  offset += p.buf.length
}

const out = Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)])
const dest = path.join(__dirname, '..', 'build', 'icon.ico')
fs.writeFileSync(dest, out)
console.log('wrote', dest, out.length, 'bytes; sizes', SIZES.join(','))
