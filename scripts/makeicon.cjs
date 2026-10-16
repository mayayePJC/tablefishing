/**
 * 生成钓鱼桌宠的应用图标：32×32 像素网格「鱼 + 钓钩」徽章（星露谷像素风），
 * 主体元素邻接检测自动补 1px 暗描边，最近邻缩放到多尺寸组装 .ico，另出 512px logo.png。
 * 依赖 @napi-rs/canvas（仓库已装）。运行：node scripts/makeicon.cjs
 */
const fs = require('fs')
const path = require('path')
const { createCanvas } = require('@napi-rs/canvas')

const GRID = 32
const SIZES = [256, 128, 64, 48, 32, 16]

// —— 色板（与桌宠暗描边风格一致）——
const BG = '#1d5c7a' // 深青底
const BG_L = '#22709a' // 顶部受光带
const WATER = '#2a6f8c' // 水波
const WATER_D = '#1f5a75' // 水波暗部
const WATER_L = '#5aa8c4' // 浪线高光
const FISH_C = '#f4e4b8' // 鱼身奶油
const FISH_D = '#e0c88f' // 鱼腹
const FIN = '#e8c53a' // 鱼鳍金
const HOOK = '#cfd6dd' // 钓钩银
const BUBBLE = '#bfe6f2' // 气泡
const OUT = '#0d2430' // 暗描边
const ACCENT = '#8fc4d4' // 内圈高光

/** 在 32×32 网格上作画，返回颜色二维数组（null = 透明） */
function drawGrid() {
  const g = Array.from({ length: GRID }, () => Array(GRID).fill(null))
  const px = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < GRID && y < GRID) g[y][x] = c
  }
  const rect = (x, y, w, h, c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c)
  }
  const ell = (cx, cy, rx, ry, c) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx
        const dy = (y - cy) / ry
        if (dx * dx + dy * dy <= 1) px(x, y, c)
      }
    }
  }
  const tri = (x1, y1, x2, y2, x3, y3, c) => {
    const minX = Math.floor(Math.min(x1, x2, x3))
    const maxX = Math.ceil(Math.max(x1, x2, x3))
    const minY = Math.floor(Math.min(y1, y2, y3))
    const maxY = Math.ceil(Math.max(y1, y2, y3))
    const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    if (d === 0) return
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d
        const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) px(x, y, c)
      }
    }
  }

  // —— 背景：深青 + 顶部受光带 + 1px 暗框 + 四角切角 ——
  rect(0, 0, GRID, GRID, BG)
  rect(1, 1, GRID - 2, 3, BG_L)
  rect(0, 0, GRID, 1, OUT)
  rect(0, GRID - 1, GRID, 1, OUT)
  rect(0, 0, 1, GRID, OUT)
  rect(GRID - 1, 0, 1, GRID, OUT)
  px(0, 0, null)
  px(GRID - 1, 0, null)
  px(0, GRID - 1, null)
  px(GRID - 1, GRID - 1, null)
  // 左上内高光
  px(2, 2, ACCENT)
  px(3, 2, ACCENT)
  px(2, 3, ACCENT)

  // —— 底部水波（4px 阶梯浪 + 浪线高光 + 底部暗部）——
  for (let x = 0; x < GRID; x++) {
    const top = 26 + (((x >> 2) & 1))
    for (let y = top; y < GRID - 1; y++) px(x, y, y >= 29 ? WATER_D : WATER)
    px(x, top, WATER_L)
  }

  // —— 主体：鱼（朝右）+  J 形钓钩 + 钓线 + 气泡 ——
  // 尾鳍（左）
  tri(7, 13, 1, 8, 1, 18, FIN)
  // 背鳍
  tri(12, 9, 9, 4, 16, 9, FIN)
  // 身体 + 肚腹
  ell(13, 13, 7, 4, FISH_C)
  ell(13, 14.5, 5, 2, FISH_D)
  // 眼睛（2px，缩到 16px 仍可见）
  px(17, 11, OUT)
  px(18, 11, OUT)
  // 钓线（自顶边垂下）+ J 钩（钩尖朝上，正对鱼嘴）
  for (let y = 0; y <= 14; y++) px(24, y, HOOK)
  px(23, 14, HOOK)
  px(22, 14, HOOK)
  px(22, 13, HOOK)
  // 气泡（钩下方升起）
  ell(26, 18, 1.2, 1.2, BUBBLE)
  ell(24, 21, 1, 1, BUBBLE)
  ell(27, 12, 1, 1, BUBBLE)

  // —— 自动描边：主元素旁的背景像素补 1px OUT（透明/已描边处跳过）——
  const MAIN = new Set([FISH_C, FISH_D, FIN, HOOK, BUBBLE])
  const ring = []
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!MAIN.has(g[y][x])) continue
      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1]
      ]
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue
        const c = g[ny][nx]
        if (c !== null && !MAIN.has(c) && c !== OUT) ring.push([nx, ny])
      }
    }
  }
  for (const [x, y] of ring) g[y][x] = OUT

  return g
}

/** 网格 -> 指定尺寸的画布（最近邻缩放） */
function gridToCanvas(g, size) {
  const cv = createCanvas(size, size)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const scale = size / GRID
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = g[Math.floor(y / scale)][Math.floor(x / scale)]
      if (!c) continue
      ctx.fillStyle = c
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return cv
}

const grid = drawGrid()

// —— 组装 ICO（PNG-in-ICO，支持 256）——
const pngs = SIZES.map((s) => ({ size: s, buf: gridToCanvas(grid, s).toBuffer('image/png') }))
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

// —— 512px 大图 logo（16x 最近邻，锐利像素边）——
const big = gridToCanvas(grid, 512)
const logoDest = path.join(__dirname, '..', 'build', 'logo.png')
fs.writeFileSync(logoDest, big.toBuffer('image/png'))
console.log('wrote', logoDest, '512x512')
