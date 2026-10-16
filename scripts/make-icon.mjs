// 生成 build/icon.ico：含 32x32(BMP) + 256x256(PNG) 两帧的合法 Windows 图标
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

// ---------- 32x32 橘猫脸图案（像素风，供两张帧复用） ----------
const S32 = 32
const buf32 = new Int32Array(S32 * S32) // ABGR
function put32(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S32 || y >= S32) return
  buf32[y * S32 + x] = ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)
}
const FUR = [232, 148, 58]
const FUR_D = [196, 116, 38]
const INK = [38, 28, 22]
const PINK = [232, 120, 120]
for (let y = 0; y < S32; y++) {
  for (let x = 0; x < S32; x++) {
    const dx = x - 16
    const dy = y - 19
    const inFace = (dx * dx) / (11 * 11) + (dy * dy) / (10 * 10) <= 1
    const inEarL = x >= 6 && x <= 12 && y >= 3 && y <= 13 && x - 6 >= (y - 3) * 0.55
    const inEarR = x >= 20 && x <= 26 && y >= 3 && y <= 13 && 26 - x >= (y - 3) * 0.55
    if (inFace || inEarL || inEarR) {
      const edge = inFace && (dx * dx) / (10.2 * 10.2) + (dy * dy) / (9.2 * 9.2) > 1
      const c = edge ? FUR_D : FUR
      put32(x, y, c[0], c[1], c[2], 255)
    }
  }
}
put32(9, 8, PINK[0], PINK[1], PINK[2], 255)
put32(10, 9, PINK[0], PINK[1], PINK[2], 255)
put32(23, 8, PINK[0], PINK[1], PINK[2], 255)
put32(22, 9, PINK[0], PINK[1], PINK[2], 255)
for (const ex of [11, 21]) {
  put32(ex, 17, INK[0], INK[1], INK[2], 255)
  put32(ex, 18, INK[0], INK[1], INK[2], 255)
}
put32(16, 21, INK[0], INK[1], INK[2], 255)
put32(15, 21, INK[0], INK[1], INK[2], 255)
put32(17, 21, INK[0], INK[1], INK[2], 255)
for (const wy of [20, 22]) {
  for (let wx = 4; wx <= 11; wx++) put32(wx, wy, 255, 255, 255, 180)
  for (let wx = 21; wx <= 28; wx++) put32(wx, wy, 255, 255, 255, 180)
}

// ---------- 256x256 PNG 帧（32 图案 8x 最近邻放大） ----------
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0)
  return Buffer.concat([len, t, data, crc])
}
function makePng256() {
  const S = 256
  const raw = Buffer.alloc((S * 4 + 1) * S)
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0
    for (let x = 0; x < S; x++) {
      const sx = Math.min(S32 - 1, Math.floor(x / 8))
      const sy = Math.min(S32 - 1, Math.floor(y / 8))
      const v = buf32[sy * S32 + sx]
      const o = y * (S * 4 + 1) + 1 + x * 4
      raw[o] = v & 255
      raw[o + 1] = (v >>> 8) & 255
      raw[o + 2] = (v >>> 16) & 255
      raw[o + 3] = (v >>> 24) & 255
    }
  }
  const idat = zlib.deflateSync(raw)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0)
  ihdr.writeUInt32BE(S, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

// ---------- 32x32 BMP 帧 ----------
function makeBmp32() {
  const S = S32
  const bih = Buffer.alloc(40)
  bih.writeUInt32LE(40, 0)
  bih.writeInt32LE(S, 4)
  bih.writeInt32LE(S * 2, 8) // ico 高度含 AND mask = 2x
  bih.writeUInt16LE(1, 12)
  bih.writeUInt16LE(32, 14)
  bih.writeUInt32LE(0, 16)
  bih.writeUInt32LE(S * S * 4, 20)
  const xor = Buffer.alloc(S * S * 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = buf32[(S - 1 - y) * S + x] // bottom-up
      const o = (y * S + x) * 4
      xor[o] = v & 255
      xor[o + 1] = (v >>> 8) & 255
      xor[o + 2] = (v >>> 16) & 255
      xor[o + 3] = (v >>> 24) & 255
    }
  }
  const andSize = Math.ceil(S / 32) * 4 * S
  const and = Buffer.alloc(andSize, 0)
  return { bih, xor, andSize }
}

// ---------- 组装 ICO（count=2：32 BMP + 256 PNG） ----------
const png = makePng256()
const { bih, xor, andSize } = makeBmp32()
const bmp32Size = bih.length + xor.length + andSize
const ico = Buffer.alloc(6 + 16 * 2 + bmp32Size + png.length)
let p = 0
ico.writeUInt16LE(0, p); p += 2 // reserved
ico.writeUInt16LE(1, p); p += 2 // type
ico.writeUInt16LE(2, p); p += 2 // count

// entry 32
ico.writeUInt8(S32, p); p++ // width
ico.writeUInt8(S32, p); p++ // height
ico.writeUInt8(0, p); p++ // colors
ico.writeUInt8(0, p); p++ // reserved
ico.writeUInt16LE(1, p); p += 2 // planes
ico.writeUInt16LE(32, p); p += 2 // bitcount
ico.writeUInt32LE(bmp32Size, p); p += 4 // bytesInRes
ico.writeUInt32LE(22, p); p += 4 // imageOffset

// entry 256 (PNG)：width/height=0 表示 256
ico.writeUInt8(0, p); p++
ico.writeUInt8(0, p); p++
ico.writeUInt8(0, p); p++
ico.writeUInt8(0, p); p++
ico.writeUInt16LE(1, p); p += 2
ico.writeUInt16LE(32, p); p += 2
ico.writeUInt32LE(png.length, p); p += 4
ico.writeUInt32LE(22 + 16 + bmp32Size, p); p += 4

bih.copy(ico, p); p += bih.length
xor.copy(ico, p); p += xor.length
Buffer.alloc(andSize, 0).copy(ico, p); p += andSize
png.copy(ico, p); p += png.length

const outDir = path.resolve('build')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
console.log('icon.ico written:', ico.length, 'bytes (32 BMP + 256 PNG)')
