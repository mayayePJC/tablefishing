/** 一次性脚本：导出风格参考图（图标 + 两个形象的待机帧裁剪放大），供新形象/logo 设计作锚点。用完即删。 */
const fs = require('fs')
const path = require('path')
const { createCanvas, loadImage } = require('@napi-rs/canvas')

async function main() {
  // 1) 从 icon.ico 取出最大尺寸 PNG
  const ico = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico'))
  const n = ico.readUInt16LE(4)
  let best = null
  for (let i = 0; i < n; i++) {
    const off = 6 + 16 * i
    const w = ico.readUInt8(off) || 256
    const bytes = ico.readUInt32LE(off + 8)
    const offset = ico.readUInt32LE(off + 12)
    if (!best || w > best.w) best = { w, bytes, offset }
  }
  fs.writeFileSync(path.join(__dirname, 'icon_ref.png'), ico.subarray(best.offset, best.offset + best.bytes))
  console.log('icon_ref.png', best.w + 'x' + best.w, best.bytes + 'B')

  // 2) 裁剪两个形象的待机帧并 4x 最近邻放大
  //    人物锚点：PLAYER_X=238（中心）、FOOT_Y=342、缩放2.6 → 角色约 62×104
  //    避开右上角 lev 徽章（约 x≥278）：右缘取 274
  const box = { x: 190, y: 230, w: 76, h: 120 }
  const S = 4
  for (const skin of ['farmer', 'cat']) {
    const img = await loadImage(path.join(__dirname, `shot_idle_${skin}.png`))
    const cv = createCanvas(box.w * S, box.h * S)
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w * S, box.h * S)
    const out = path.join(__dirname, `ref_${skin}.png`)
    fs.writeFileSync(out, cv.toBuffer('image/png'))
    console.log(`ref_${skin}.png`, box.w * S + 'x' + box.h * S)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
