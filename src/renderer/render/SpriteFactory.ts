import { PixelCanvas, mixHex } from './PixelCanvas'
import { PAL } from './Palette'
import type { CharacterSkin, FishBodyShape, FishDef } from '../shared/types'

export interface SpriteSet {
  /** 待机 2 帧 */
  playerIdle: HTMLCanvasElement[]
  /** 抛竿 3 帧 */
  playerCast: HTMLCanvasElement[]
  /** 收杆 1 帧 */
  playerReel: HTMLCanvasElement
  /** 举鱼展示 1 帧 */
  playerShow: HTMLCanvasElement
  bobber: HTMLCanvasElement
  /** 落水水花 3 帧 */
  splash: HTMLCanvasElement[]
  /** fishId -> [朝下, 朝上] */
  fish: Record<string, HTMLCanvasElement[]>
  /** 垃圾图标 [报纸, 海草, 破靴] */
  trash: HTMLCanvasElement[]
  chest: HTMLCanvasElement
  crown: HTMLCanvasElement
  exclaim: HTMLCanvasElement
  star: HTMLCanvasElement
  /** 通用鱼竿图标（结算「解锁新竿」提示用） */
  rod: HTMLCanvasElement
  clouds: HTMLCanvasElement[]
}

export type PlayerPose = 'idle0' | 'idle1' | 'cast0' | 'cast1' | 'cast2' | 'reel' | 'show'

const INK = '#241a12'
/** 人物统一暗描边，保证在任意桌面背景上都清晰可见 */
const OUT = '#241a12'

/** 每帧钓竿尖端相对精灵左上角的偏移（钓线起点）；人物面朝左，竿尖在左侧 */
export const ROD_TIP_FARMER: Record<PlayerPose, [number, number]> = {
  idle0: [4, 4],
  idle1: [4, 4],
  cast0: [4, 10],
  cast1: [4, 6],
  cast2: [3, 3],
  reel: [4, 9],
  show: [20, 18]
}

/** 猫将形象钓竿尖端偏移：猫双手持竿，竿尖更偏左上 */
export const ROD_TIP_CAT: Record<PlayerPose, [number, number]> = {
  idle0: [3, 3],
  idle1: [3, 3],
  cast0: [2, 18],
  cast1: [3, 10],
  cast2: [4, 3],
  reel: [4, 12],
  show: [20, 17]
}

/** 按形象取 rod tip 映射表 */
export const ROD_TIPS: Record<CharacterSkin, Record<PlayerPose, [number, number]>> = {
  farmer: ROD_TIP_FARMER,
  cat: ROD_TIP_CAT
}

/** 兼容旧导入：默认指向农夫 */
export const ROD_TIP = ROD_TIP_FARMER

// 星露谷默认农夫配色：棕发、绿衫、蓝裤
const SKIN = PAL.skin
const SKIN_D = PAL.skinShade
const HAIR = PAL.hair
const HAIR_L = PAL.hairLight
const SHIRT = '#57a64b'
const SHIRT_D = '#3f7d38'
const SHIRT_L = '#6fbf56'
const PANTS = '#3a4a6b'
const PANTS_D = '#2c3852'
const BOOT = PAL.boot

/** 带 1px 暗描边的实心块（透明背景可见） */
function blk(pc: PixelCanvas, x: number, y: number, w: number, h: number, fill: string): void {
  pc.rect(x - 1, y - 1, w + 2, h + 2, OUT)
  pc.rect(x, y, w, h, fill)
}

function rodLine(pc: PixelCanvas, x1: number, y1: number, x2: number, y2: number, color?: string): void {
  const c = color ?? PAL.woodDark
  const hi = color ? mixHex(color, '#ffffff', 0.4) : PAL.woodLight
  let x = x1
  let y = y1
  const dx = Math.abs(x2 - x1)
  const dy = Math.abs(y2 - y1)
  const sx = x1 < x2 ? 1 : -1
  const sy = y1 < y2 ? 1 : -1
  let err = dx - dy
  for (let i = 0; i < 60; i++) {
    pc.px(x, y, c)
    if (x === x2 && y === y2) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
  pc.px(x2, y2, hi)
}

/** 程序化生成「星露谷默认农夫」：站立人形、右手持竿，全程暗描边 */
function drawPlayer(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const isShow = pose === 'show'

  // —— 腿 / 靴（身体后方）——
  blk(pc, 7, 28, 4, 9, PANTS)
  blk(pc, 13, 28, 4, 9, PANTS)
  pc.rect(7, 36, 4, 1, PANTS_D)
  pc.rect(13, 36, 4, 1, PANTS_D)
  blk(pc, 7, 37, 4, 3, BOOT)
  blk(pc, 13, 37, 4, 3, BOOT)

  // —— 躯干（绿衫）——
  blk(pc, 7, 16, 10, 12, SHIRT)
  pc.rect(7, 16, 10, 1, SHIRT_L)
  pc.rect(7, 26, 10, 1, SHIRT_D)
  pc.rect(7, 27, 10, 1, PANTS_D) // 腰带

  // —— 头（脸 + 头发）——
  blk(pc, 8, 7, 8, 8, SKIN)
  pc.rect(8, 14, 8, 1, SKIN_D)
  if (pose === 'idle1') {
    pc.rect(10, 10, 1, 1, SKIN_D) // 闭眼
    pc.rect(13, 10, 1, 1, SKIN_D)
  } else {
    pc.px(10, 10, OUT) // 睁眼
    pc.px(13, 10, OUT)
  }
  pc.rect(11, 12, 2, 1, OUT) // 嘴
  blk(pc, 7, 3, 10, 5, HAIR)
  pc.rect(7, 3, 10, 1, HAIR_L)
  pc.rect(7, 7, 2, 4, HAIR) // 左鬓
  pc.rect(15, 7, 2, 4, HAIR) // 右鬓

  // —— 手臂 + 钓竿（画在身体之上）；人物面朝左：持竿臂在画面左侧 ——
  if (isShow) {
    // 双手举鱼展示
    blk(pc, 7, 9, 2, 8, SHIRT)
    pc.rect(7, 8, 2, 2, SKIN)
    blk(pc, 15, 9, 2, 8, SHIRT)
    pc.rect(15, 8, 2, 2, SKIN)
    // 手中鱼儿
    pc.ellipse(11, 7, 3.4, 2, '#6fb0d0')
    pc.ellipse(11, 7, 2.2, 1.3, '#bfe6f2')
    pc.triangle(14, 7, 11, 5.5, 11, 8.5, '#4a93b0')
    pc.px(9, 6, INK)
    // 钓竿斜靠身侧（右侧）
    rodLine(pc, 18, 30, 20, 18)
  } else {
    // 右臂（画面右侧）自然下垂
    blk(pc, 16, 17, 3, 9, SHIRT)
    pc.rect(16, 25, 3, 2, SKIN)
    // 左臂（画面左侧）举起持竿，竿伸向左上（朝向池塘）
    blk(pc, 4, 12, 2, 6, SHIRT)
    pc.rect(4, 11, 2, 2, SKIN) // 握竿手
    const tip = ROD_TIP[pose]
    rodLine(pc, 5, 12, tip[0], tip[1])
  }

  return pc.bake()
}

// 猫将形象配色：白猫 + 绿甲 + 青铜描边（透明背景可见）
const FUR = '#f2f2f2'
const FUR_D = '#c9c9c9'
const FUR_L = '#ffffff'
const CAT_ARMOR = '#4a7c3e'
const CAT_ARMOR_D = '#2e4f2a'
const CAT_ARMOR_L = '#6aa85a'
const CAT_TRIM = '#8a6a30'
const CAT_TRIM_L = '#a88a50'
const CAT_EYE = '#3a5a3a'
const CAT_NOSE = '#d68a8a'

/** 程序化生成「猫将」：白猫穿绿甲、双手持竿，星露谷风格像素人形 */
function drawCatCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const isShow = pose === 'show'
  const blink = pose === 'idle1'

  // —— 尾巴（右侧身后，蓬松弯曲）—— 先画，在身体后面
  pc.ellipse(20, 20, 3, 12, FUR_D)
  pc.ellipse(21, 22, 2, 10, FUR)
  pc.ellipse(22, 24, 1, 8, FUR_L)
  pc.px(19, 14, OUT)
  pc.px(23, 32, OUT)

  // —— 腿 / 靴（白毛 + 绿甲护胫 + 白爪）——
  blk(pc, 7, 29, 4, 8, FUR)
  blk(pc, 13, 29, 4, 8, FUR)
  pc.rect(7, 33, 4, 3, CAT_ARMOR)
  pc.rect(13, 33, 4, 3, CAT_ARMOR)
  pc.rect(7, 33, 4, 1, CAT_ARMOR_L)
  pc.rect(13, 33, 4, 1, CAT_ARMOR_L)
  pc.rect(7, 36, 4, 1, CAT_TRIM)
  pc.rect(13, 36, 4, 1, CAT_TRIM)
  pc.rect(7, 37, 4, 2, FUR_L)
  pc.rect(13, 37, 4, 2, FUR_L)

  // —— 躯干（白毛主体 + 中央绿甲胸板）——
  blk(pc, 6, 15, 12, 14, FUR)
  pc.rect(8, 16, 8, 10, CAT_ARMOR)
  pc.rect(8, 16, 8, 1, CAT_ARMOR_L)
  pc.rect(8, 25, 8, 1, CAT_ARMOR_D)
  pc.rect(8, 26, 8, 1, CAT_TRIM)
  // 甲片横纹
  pc.rect(9, 18, 6, 1, CAT_ARMOR_D)
  pc.rect(9, 21, 6, 1, CAT_ARMOR_D)
  pc.rect(9, 24, 6, 1, CAT_ARMOR_D)

  // —— 头（大白猫脸 + 绿盔/额带 + 尖耳朵）——
  blk(pc, 7, 5, 10, 9, FUR)
  // 耳朵
  pc.triangle(7, 6, 8, 1, 9, 6, FUR)
  pc.triangle(8, 6, 8, 2, 9, 6, FUR_D)
  pc.triangle(15, 6, 16, 1, 17, 6, FUR)
  pc.triangle(15, 6, 16, 2, 17, 6, FUR_D)
  pc.px(8, 1, OUT)
  pc.px(16, 1, OUT)
  // 额带/小盔
  pc.rect(7, 5, 10, 2, CAT_ARMOR)
  pc.rect(7, 5, 10, 1, CAT_ARMOR_L)
  pc.px(12, 3, CAT_TRIM)
  // 脸
  if (blink) {
    pc.rect(9, 9, 1, 1, CAT_EYE)
    pc.rect(15, 9, 1, 1, CAT_EYE)
  } else {
    pc.px(9, 9, CAT_EYE)
    pc.px(15, 9, CAT_EYE)
  }
  // 瞳孔高光
  pc.px(10, 8, FUR_L)
  pc.px(16, 8, FUR_L)
  pc.px(12, 12, CAT_NOSE)
  pc.px(12, 13, OUT)
  pc.rect(11, 14, 2, 1, FUR_D)
  // 胡须
  pc.px(6, 12, OUT)
  pc.px(5, 12, OUT)
  pc.px(17, 12, OUT)
  pc.px(18, 12, OUT)

  // —— 手臂 + 钓竿（画在身体之上）——
  if (isShow) {
    // 举鱼展示：左手高举鱼，右手斜握竿
    blk(pc, 4, 13, 2, 8, FUR)
    pc.rect(4, 13, 2, 2, CAT_ARMOR)
    blk(pc, 18, 13, 2, 8, FUR)
    pc.rect(18, 13, 2, 2, CAT_ARMOR)
    // 小鱼
    pc.ellipse(12, 5, 3.5, 2, '#6fb0d0')
    pc.ellipse(12, 5, 2.2, 1.3, '#bfe6f2')
    pc.triangle(15, 5, 12, 3.5, 12, 6.5, '#4a93b0')
    pc.px(10, 4, INK)
    // 竿斜靠右侧
    rodLine(pc, 18, 30, 20, 16)
  } else {
    // 胸前双手合握持竿
    blk(pc, 4, 16, 2, 5, FUR)
    pc.rect(4, 16, 2, 2, CAT_ARMOR)
    blk(pc, 18, 16, 2, 5, FUR)
    pc.rect(18, 16, 2, 2, CAT_ARMOR)
    // 爪子合握
    pc.rect(9, 16, 6, 3, FUR_L)
    pc.rect(9, 16, 6, 1, FUR_D)
    // 钓竿
    const tip = ROD_TIP_CAT[pose]
    rodLine(pc, 12, 17, tip[0], tip[1])
  }

  return pc.bake()
}

function drawBobber(): HTMLCanvasElement {
  const pc = new PixelCanvas(6, 6)
  pc.px(3, 0, '#8a8f98')
  pc.rect(2, 1, 2, 2, '#d64545')
  pc.px(2, 1, '#f07b7b')
  pc.rect(2, 3, 2, 2, '#f2f5f7')
  pc.rect(2, 5, 2, 1, '#b9c2cb')
  return pc.bake()
}

function drawSplash(): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = []
  const droplets = [
    [[6, 1], [4, 2], [8, 2]],
    [[6, 0], [3, 1], [9, 1], [5, 3], [7, 3]],
    [[5, 0], [8, 0], [2, 2], [10, 2], [4, 4], [7, 4]]
  ]
  for (let f = 0; f < 3; f++) {
    const pc = new PixelCanvas(14, 10)
    const rx = 2.2 + f * 1.6
    const ry = 1.0 + f * 0.6
    pc.ellipse(7, 6, rx + 1, ry + 1, OUT, 0.9) // 暗描边
    pc.ellipse(7, 6, rx, ry, PAL.waterLight, 0.95) // 水体
    pc.ellipse(7, 6, rx - 1, ry - 0.5, PAL.waterFoam, 0.75) // 高光
    for (const [x, y] of droplets[f]) {
      pc.rect(x - 1, y - 1, 2, 2, OUT) // 暗底
      pc.px(x - 1, y - 1, PAL.waterFoam) // 亮芯
    }
    frames.push(pc.bake())
  }
  return frames
}

/** 水平朝向鱼身 12×8，之后旋转得到上/下朝向 */
function drawFishBody(body: FishBodyShape, c1: string, c2: string): PixelCanvas {
  const pc = new PixelCanvas(12, 8)
  const belly = mixHex(c1, '#ffffff', 0.35)
  const dark = mixHex(c1, '#000000', 0.35)

  switch (body) {
    case 'spindle':
      pc.ellipse(6, 4, 5, 2.6, c1)
      pc.rect(4, 6, 5, 1, belly)
      pc.triangle(1, 4, 4, 2, 4, 6, c2)
      pc.triangle(6, 1, 8, 1, 7, 0, c2)
      pc.px(9, 3, INK)
      pc.px(10, 3, INK)
      pc.rect(2, 3, 2, 1, dark, 0.5)
      break
    case 'long':
      pc.ellipse(6, 4, 4.5, 1.7, c1)
      pc.rect(4, 5, 5, 1, belly)
      pc.triangle(1, 4, 4, 2, 4, 6, c2)
      pc.triangle(11, 4, 10, 2, 10, 6, c2)
      pc.px(9, 3, INK)
      pc.rect(3, 3, 2, 1, dark, 0.4)
      break
    case 'round':
      pc.ellipse(6, 4, 3.5, 3, c1)
      pc.rect(4, 6, 4, 1, belly)
      pc.triangle(2, 4, 4, 3, 4, 5, c2)
      // 河豚小刺
      pc.px(9, 1, c2)
      pc.px(3, 1, c2)
      pc.px(9, 7, c2)
      pc.px(3, 7, c2)
      pc.px(9, 4, INK)
      pc.rect(4, 3, 2, 1, dark, 0.4)
      break
    case 'flat':
      pc.ellipse(6, 4, 3.2, 3.2, c1)
      pc.rect(4, 6, 4, 1, belly)
      pc.triangle(2, 4, 4, 2, 4, 6, c2)
      pc.px(8, 3, INK)
      pc.rect(4, 2, 2, 1, dark, 0.4)
      break
  }
  return pc
}

/** 顺时针旋转 90°：水平鱼身（头朝右）-> 头朝上(cw=false) / 头朝下(cw=true) */
function rotate90(src: PixelCanvas, cw: boolean): PixelCanvas {
  const out = new PixelCanvas(src.h, src.w)
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const nx = cw ? src.h - 1 - y : y
      const ny = cw ? x : src.w - 1 - x
      out.px(nx, ny, src.getPx(x, y))
    }
  }
  return out
}

function drawTrash(): HTMLCanvasElement[] {
  // 湿报纸
  const paper = new PixelCanvas(12, 8)
  paper.rect(1, 1, 10, 6, '#d8dde2')
  paper.rect(1, 1, 10, 1, '#eef2f5')
  paper.rect(2, 3, 8, 1, '#9aa4ad')
  paper.rect(2, 5, 6, 1, '#9aa4ad')
  paper.rect(1, 7, 10, 1, '#8a939b')
  paper.px(0, 2, '#b9c2cb')
  paper.px(11, 5, '#b9c2cb')

  // 海草
  const weed = new PixelCanvas(12, 8)
  for (let i = 0; i < 3; i++) {
    const bx = 2 + i * 4
    for (let y = 7; y >= 1; y--) {
      const wob = Math.round(Math.sin((7 - y) * 0.7 + i) * 1.6)
      weed.px(bx + wob, y, i === 1 ? '#3f8a3f' : '#2e6b34')
      if (y < 6) weed.px(bx + wob + 1, y, '#57a54b')
    }
  }

  // 破靴
  const boot = new PixelCanvas(12, 8)
  boot.rect(2, 1, 4, 5, '#5d3d22')
  boot.rect(2, 1, 4, 1, '#7a5230')
  boot.rect(6, 4, 4, 2, '#5d3d22')
  boot.rect(2, 6, 8, 1, '#2a2118')
  boot.rect(3, 3, 1, 1, '#3a2e22')
  boot.rect(5, 2, 1, 1, '#3a2e22')

  return [paper.bake(), weed.bake(), boot.bake()]
}

function drawChest(): HTMLCanvasElement {
  const pc = new PixelCanvas(14, 11)
  pc.rect(0, 3, 14, 8, PAL.chest)
  pc.rect(0, 0, 14, 4, PAL.chestDark)
  pc.rect(0, 3, 14, 1, '#3a2812')
  pc.rect(0, 0, 14, 1, '#9c6d40')
  // 金箍
  pc.rect(5, 0, 2, 11, PAL.chestGold)
  pc.rect(0, 4, 14, 2, PAL.chestGold)
  // 锁
  pc.rect(6, 5, 2, 3, '#f0d060')
  pc.px(7, 6, '#8a6a10')
  // 描边
  pc.strokeRect(0, 0, 14, 11, '#2a1c0c')
  return pc.bake()
}

function drawCrown(): HTMLCanvasElement {
  const pc = new PixelCanvas(11, 8)
  pc.rect(1, 4, 9, 3, PAL.crown)
  pc.rect(0, 2, 2, 2, PAL.crown)
  pc.rect(4, 1, 2, 3, PAL.crown)
  pc.rect(8, 2, 2, 2, PAL.crown)
  pc.rect(1, 4, 9, 1, '#ffd97a')
  pc.px(2, 5, '#d64545')
  pc.px(5, 5, '#d64545')
  pc.px(8, 5, '#d64545')
  pc.px(1, 3, '#d64545')
  pc.px(9, 3, '#d64545')
  return pc.bake()
}

function drawExclaim(): HTMLCanvasElement {
  const pc = new PixelCanvas(7, 11)
  pc.rect(2, 0, 3, 7, PAL.exclaim)
  pc.rect(2, 0, 1, 7, '#ffe98a')
  pc.rect(2, 0, 3, 1, '#fff3b0')
  pc.rect(2, 8, 3, 3, PAL.exclaim)
  pc.rect(2, 8, 1, 3, '#ffe98a')
  pc.strokeRect(1, 0, 5, 11, PAL.exclaimDark)
  return pc.bake()
}

/** 通用鱼竿图标：斜竿身 + 卷线器 + 竿梢，木棕色系，用于结算「解锁新竿」提示 */
function drawRod(): HTMLCanvasElement {
  const pc = new PixelCanvas(12, 12)
  // 竿身（左下 -> 右上斜向）
  rodLine(pc, 1, 11, 10, 2)
  // 卷线器（靠近握把处的小轮）
  pc.rect(2, 8, 3, 3, '#9aa3ad')
  pc.rect(3, 9, 1, 1, '#cfd6dd')
  // 握把
  pc.rect(0, 10, 3, 2, PAL.woodDark)
  // 竿梢高光
  pc.px(10, 2, '#ffe9b0')
  return pc.bake()
}

/** 钓鱼竿图鉴图标：按竿主色绘制的斜竿，用于图鉴卡片 */
export function buildRodIcon(color: string): HTMLCanvasElement {
  const pc = new PixelCanvas(12, 12)
  const dark = mixHex(color, '#000000', 0.42)
  // 竿身（左下 -> 右上斜向，按竿主色着色）
  rodLine(pc, 1, 11, 10, 2, color)
  // 竿梢高光
  pc.px(10, 2, mixHex(color, '#ffffff', 0.4))
  pc.px(9, 3, mixHex(color, '#ffffff', 0.4))
  // 卷线器
  pc.rect(2, 8, 3, 3, '#9aa3ad')
  pc.rect(3, 9, 1, 1, '#cfd6dd')
  // 握把
  pc.rect(0, 10, 3, 2, dark)
  return pc.bake()
}

function drawStar(): HTMLCanvasElement {
  const pc = new PixelCanvas(7, 7)
  pc.rect(3, 0, 1, 2, '#ffffff')
  pc.rect(1, 1, 5, 1, '#ffffff')
  pc.rect(0, 2, 7, 2, '#ffffff')
  pc.rect(1, 4, 5, 1, '#ffffff')
  pc.rect(2, 5, 3, 1, '#ffffff')
  pc.px(3, 6, '#ffffff')
  return pc.bake()
}

function drawCloud(seed: number): HTMLCanvasElement {
  const pc = new PixelCanvas(46, 15)
  let s = seed >>> 0
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const blobs = 3 + Math.floor(rand() * 3)
  let x = 4
  for (let i = 0; i < blobs; i++) {
    const rx = 6 + rand() * 8
    const ry = 3 + rand() * 3
    const cy = 9 - ry + rand() * 2
    pc.ellipse(x + rx, cy, rx, ry, PAL.cloud)
    x += rx * 1.3
    if (x > 36) break
  }
  // 底部阴影
  const shaded = new PixelCanvas(46, 15)
  for (let y = 0; y < 15; y++) {
    for (let xi = 0; xi < 46; xi++) {
      const c = pc.getPx(xi, y)
      if (c !== '#000000') {
        shaded.px(xi, y, y > 8 && pc.getPx(xi, y - 1) !== '#000000' ? PAL.cloudShade : c)
      }
    }
  }
  return shaded.bake()
}

export class SpriteFactory {
  /** fishId -> [朝上, 朝下] */
  static buildFish(defs: FishDef[]): Record<string, HTMLCanvasElement[]> {
    const fish: Record<string, HTMLCanvasElement[]> = {}
    for (const def of defs) {
      const horizontal = drawFishBody(def.body, def.color, def.color2)
      fish[def.id] = [rotate90(horizontal, false).bake(), rotate90(horizontal, true).bake()]
    }
    return fish
  }

  static build(fishDefs: FishDef[], skin: CharacterSkin = 'farmer'): SpriteSet {
    const drawChar = skin === 'cat' ? drawCatCharacter : drawPlayer
    return {
      playerIdle: [drawChar('idle0'), drawChar('idle1')],
      playerCast: [drawChar('cast0'), drawChar('cast1'), drawChar('cast2')],
      playerReel: drawChar('reel'),
      playerShow: drawChar('show'),
      bobber: drawBobber(),
      splash: drawSplash(),
      fish: SpriteFactory.buildFish(fishDefs),
      trash: drawTrash(),
      chest: drawChest(),
      crown: drawCrown(),
      exclaim: drawExclaim(),
      star: drawStar(),
      rod: drawRod(),
      clouds: [drawCloud(11), drawCloud(29), drawCloud(47)]
    }
  }
}
