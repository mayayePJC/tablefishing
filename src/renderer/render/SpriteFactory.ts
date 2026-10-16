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

/** 蛙渔夫钓竿尖端偏移：左蹼握竿，竿尖偏左上 */
export const ROD_TIP_FROG: Record<PlayerPose, [number, number]> = {
  idle0: [2, 5],
  idle1: [2, 5],
  cast0: [4, 11],
  cast1: [4, 7],
  cast2: [2, 4],
  reel: [4, 10],
  show: [22, 17]
}

/** 企鹅钓手钓竿尖端偏移：左鳍握竿，竿尖偏左上 */
export const ROD_TIP_PENGUIN: Record<PlayerPose, [number, number]> = {
  idle0: [3, 5],
  idle1: [3, 5],
  cast0: [4, 12],
  cast1: [4, 8],
  cast2: [3, 4],
  reel: [4, 11],
  show: [20, 16]
}

/** 星纹小巫师钓竿尖端偏移：左袖握竿，竿尖偏左上 */
export const ROD_TIP_WIZARD: Record<PlayerPose, [number, number]> = {
  idle0: [3, 6],
  idle1: [3, 6],
  cast0: [4, 14],
  cast1: [4, 10],
  cast2: [3, 5],
  reel: [4, 13],
  show: [21, 15]
}

/** 按形象取 rod tip 映射表 */
export const ROD_TIPS: Record<CharacterSkin, Record<PlayerPose, [number, number]>> = {
  farmer: ROD_TIP_FARMER,
  cat: ROD_TIP_CAT,
  frog: ROD_TIP_FROG,
  penguin: ROD_TIP_PENGUIN,
  wizard: ROD_TIP_WIZARD
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

// 蛙渔夫配色：绿皮 + 护目镜 + 棕马甲 + 小木桶
const FROG = '#57a64b'
const FROG_D = '#3f7d38'
const FROG_L = '#6fbf56'
const FROG_BELLY = '#f2e4b8'
const GOGGLE = '#b88848'
const GOGGLE_LENS = '#e8a04a'
const VEST = '#a8763e'
const VEST_D = '#7d5228'
const BUCKET = '#7a5230'
const BUCKET_L = '#96683f'

/** 程序化生成「蛙渔夫」：宽体无颈、护目镜鼓眼、背小木桶，左蹼握竿面朝左 */
function drawFrogCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const isShow = pose === 'show'
  const blink = pose === 'idle1'

  // —— 宽蹼脚（身体最后方）——
  blk(pc, 4, 34, 6, 5, FROG)
  blk(pc, 14, 34, 6, 5, FROG)
  pc.rect(4, 38, 6, 1, FROG_D)
  pc.rect(14, 38, 6, 1, FROG_D)
  // 蹼趾分隔
  pc.rect(6, 36, 1, 2, FROG_D)
  pc.rect(8, 36, 1, 2, FROG_D)
  pc.rect(16, 36, 1, 2, FROG_D)
  pc.rect(18, 36, 1, 2, FROG_D)

  // —— 背后小木桶（右肩后）——
  blk(pc, 20, 15, 3, 6, BUCKET)
  pc.rect(20, 15, 3, 1, BUCKET_L) // 桶口沿
  pc.rect(20, 20, 3, 1, BUCKET_L) // 桶底沿
  pc.px(19, 14, BUCKET) // 提手
  pc.px(23, 14, BUCKET)

  // —— 躯干（宽体，与头连成一片）——
  blk(pc, 4, 18, 16, 14, FROG)
  pc.rect(5, 18, 14, 1, FROG_L) // 背高光
  pc.rect(4, 30, 16, 1, FROG_D) // 底部阴影
  // 米色肚皮
  pc.rect(8, 21, 8, 8, FROG_BELLY)
  // 棕色马甲（两侧 + 口袋）
  pc.rect(5, 19, 2, 10, VEST)
  pc.rect(17, 19, 2, 10, VEST)
  pc.rect(5, 19, 2, 1, VEST_D)
  pc.rect(17, 19, 2, 1, VEST_D)
  pc.rect(5, 23, 2, 2, VEST_D)
  pc.rect(17, 23, 2, 2, VEST_D)

  // —— 头（宽头，护目镜双眼鼓出）——
  blk(pc, 4, 9, 16, 10, FROG)
  pc.rect(5, 9, 14, 1, FROG_L)
  blk(pc, 4, 7, 5, 5, GOGGLE)
  blk(pc, 15, 7, 5, 5, GOGGLE)
  pc.ellipse(6.5, 9.5, 1.7, 1.7, GOGGLE_LENS)
  pc.ellipse(17.5, 9.5, 1.7, 1.7, GOGGLE_LENS)
  pc.px(5, 8, '#f4d8a0') // 镜片高光
  pc.px(16, 8, '#f4d8a0')
  if (blink) {
    pc.rect(5, 9, 3, 1, OUT)
    pc.rect(16, 9, 3, 1, OUT)
  } else {
    pc.px(6, 9, OUT) // 瞳孔（朝左看水）
    pc.px(17, 9, OUT)
  }
  // 微笑
  pc.rect(9, 15, 6, 1, FROG_D)
  pc.px(8, 14, FROG_D)
  pc.px(15, 14, FROG_D)

  // —— 手臂 + 钓竿（画在身体之上）——
  if (isShow) {
    // 双蹼举起展示鱼
    blk(pc, 3, 6, 2, 7, FROG)
    blk(pc, 19, 6, 2, 7, FROG)
    pc.rect(3, 12, 2, 2, FROG_L)
    pc.rect(19, 12, 2, 2, FROG_L)
    // 手中鱼儿
    pc.ellipse(12, 4, 3.4, 2, '#6fb0d0')
    pc.ellipse(12, 4, 2.2, 1.3, '#bfe6f2')
    pc.triangle(15, 4, 12, 2.5, 12, 5.5, '#4a93b0')
    pc.px(10, 3, INK)
    // 竿斜靠身侧
    rodLine(pc, 22, 33, 21, 22)
  } else {
    // 右蹼自然下垂
    blk(pc, 21, 22, 2, 5, FROG)
    pc.rect(21, 26, 2, 2, FROG_L)
    // 左蹼举起握竿
    blk(pc, 2, 13, 2, 6, FROG)
    pc.rect(2, 12, 2, 2, FROG_L)
    const tip = ROD_TIP_FROG[pose]
    rodLine(pc, 3, 13, tip[0], tip[1])
  }

  return pc.bake()
}

// 企鹅钓手配色：深灰背 + 白肚 + 橙喙 + 红围巾 + 斜挎包
const PENG_B = '#2b2f3a'
const PENG_BL = '#3d4250'
const PENG_W = '#f5f5f0'
const PENG_WD = '#d8d8d0'
const BEAK = '#e8a04a'
const BEAK_D = '#c07828'
const SCARF = '#c0453a'
const SCARF_D = '#8f2e26'
const BAG = '#7a5230'
const BAG_D = '#5d3d22'

/** 程序化生成「企鹅钓手」：圆滚滚身材、红围巾、斜挎包，左鳍握竿面朝左 */
function drawPenguinCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const isShow = pose === 'show'
  const blink = pose === 'idle1'

  // —— 蹼脚 + 短腿（身体最后方）——
  blk(pc, 7, 36, 4, 3, PENG_B)
  blk(pc, 13, 36, 4, 3, PENG_B)
  pc.rect(7, 38, 4, 1, '#1c1f26')
  pc.rect(13, 38, 4, 1, '#1c1f26')
  pc.rect(8, 33, 3, 3, PENG_B)
  pc.rect(13, 33, 3, 3, PENG_B)

  // —— 躯干（圆滚滚）——
  blk(pc, 6, 15, 12, 18, PENG_B)
  pc.rect(7, 15, 10, 1, PENG_BL) // 背高光
  pc.rect(6, 31, 12, 1, '#1c1f26') // 底部阴影
  // 白肚
  pc.rect(9, 19, 6, 12, PENG_W)
  pc.rect(9, 30, 6, 1, PENG_WD)

  // —— 斜挎包（带 + 包身）——
  const strap = [[7, 17], [8, 18], [9, 19], [10, 20], [11, 21], [12, 22], [13, 23], [14, 24]]
  for (const [sx, sy] of strap) pc.px(sx, sy, BAG_D)
  blk(pc, 14, 24, 4, 4, BAG)
  pc.rect(14, 24, 4, 1, BUCKET_L) // 包盖
  pc.px(16, 25, GOLD) // 搭扣

  // —— 头（圆脸 + 白脸盘）——
  blk(pc, 8, 6, 8, 10, PENG_B)
  pc.rect(9, 6, 6, 1, PENG_BL)
  pc.rect(9, 9, 6, 6, PENG_W)
  if (blink) {
    pc.rect(9, 10, 2, 1, OUT)
    pc.rect(13, 10, 2, 1, OUT)
  } else {
    pc.px(10, 10, OUT)
    pc.px(13, 10, OUT)
  }
  // 橙喙
  pc.triangle(10, 11, 14, 11, 12, 14, BEAK)
  pc.px(12, 13, BEAK_D)

  // —— 红围巾（头身 junction）——
  pc.rect(6, 15, 12, 2, SCARF)
  pc.rect(6, 15, 12, 1, '#d65a4a') // 围巾高光
  pc.px(5, 16, SCARF_D) // 结

  // —— 鳍臂 + 钓竿（画在身体之上）——
  if (isShow) {
    // 双鳍举起展示鱼
    blk(pc, 3, 6, 2, 7, PENG_B)
    blk(pc, 19, 6, 2, 7, PENG_B)
    pc.rect(3, 12, 2, 2, PENG_BL)
    pc.rect(19, 12, 2, 2, PENG_BL)
    // 围巾飘带
    pc.rect(1, 13, 4, 2, SCARF)
    pc.rect(1, 14, 2, 1, SCARF_D)
    // 手中鱼儿
    pc.ellipse(12, 3, 3.4, 2, '#6fb0d0')
    pc.ellipse(12, 3, 2.2, 1.3, '#bfe6f2')
    pc.triangle(15, 3, 12, 1.5, 12, 4.5, '#4a93b0')
    pc.px(10, 2, INK)
    // 竿斜靠身侧
    rodLine(pc, 21, 33, 22, 21)
  } else {
    // 右鳍自然下垂
    blk(pc, 19, 18, 2, 8, PENG_B)
    pc.rect(19, 24, 2, 2, PENG_BL)
    // 左鳍举起握竿
    blk(pc, 2, 12, 2, 7, PENG_B)
    pc.rect(2, 11, 2, 2, PENG_BL)
    // 围巾飘带（画在鳍臂之前，避免被鳍挡住）
    pc.rect(1, 13, 4, 2, SCARF)
    pc.rect(1, 14, 2, 1, SCARF_D)
    const tip = ROD_TIP_PENGUIN[pose]
    rodLine(pc, 3, 13, tip[0], tip[1])
  }

  return pc.bake()
}

// 星纹小巫师配色：紫长袍 + 金饰 + 深青尖帽 + 星纹
const ROBE = '#5a4a8a'
const ROBE_D = '#453a6e'
const ROBE_L = '#6f5aa3'
const HAT = '#3d3a6e'
const HAT_L = '#524a8a'
const STAR_C = '#f4e4b8'
const WBOOT = '#5d3d22'
const WBOOT_D = '#3f2a18'
const GOLD = '#e8c53a'

/** 程序化生成「星纹小巫师」：三段堆叠长袍、星纹尖帽、金框眼镜，左袖握竿面朝左 */
function drawWizardCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const isShow = pose === 'show'
  const blink = pose === 'idle1'

  // —— 靴尖（袍摆下方）——
  blk(pc, 7, 35, 4, 4, WBOOT)
  blk(pc, 13, 35, 4, 4, WBOOT)
  pc.rect(7, 38, 4, 1, WBOOT_D)
  pc.rect(13, 38, 4, 1, WBOOT_D)
  pc.px(6, 38, WBOOT) // 左脚尖外挑
  pc.px(17, 38, WBOOT) // 右脚尖外挑

  // —— 三段堆叠长袍（下摆 -> 中段 -> 肩）——
  blk(pc, 5, 26, 14, 8, ROBE)
  pc.rect(6, 26, 12, 1, ROBE_L) // 褶皱高光
  pc.rect(5, 33, 14, 1, ROBE_D) // 下摆阴影
  blk(pc, 6, 21, 12, 6, ROBE)
  pc.rect(7, 26, 10, 1, ROBE_D)
  blk(pc, 8, 16, 8, 6, ROBE)
  pc.rect(9, 16, 6, 1, ROBE_L) // 肩高光
  // 金色前襟
  pc.rect(11, 16, 2, 18, GOLD)
  // 袍上星纹（plus 小星）
  const robeStar = (sx: number, sy: number): void => {
    pc.px(sx, sy, STAR_C)
    pc.px(sx, sy - 1, STAR_C)
    pc.px(sx, sy + 1, STAR_C)
    pc.px(sx - 1, sy, STAR_C)
    pc.px(sx + 1, sy, STAR_C)
  }
  robeStar(7, 23)
  robeStar(16, 29)

  // —— 头（皮肤 + 金框眼镜 + 白胡）——
  blk(pc, 8, 7, 8, 8, PAL.skin)
  pc.rect(8, 7, 8, 1, PAL.skinShade)
  // 金框圆眼镜（3×3 环 ×2 + 鼻梁）
  const lens = (lx: number): void => {
    pc.rect(lx, 10, 3, 1, GOLD)
    pc.rect(lx, 12, 3, 1, GOLD)
    pc.px(lx, 11, GOLD)
    pc.px(lx + 2, 11, GOLD)
  }
  lens(8)
  lens(13)
  pc.rect(11, 11, 2, 1, GOLD) // 鼻梁
  if (blink) {
    pc.rect(8, 11, 3, 1, GOLD)
    pc.rect(13, 11, 3, 1, GOLD)
  } else {
    pc.px(9, 11, '#dff0f6') // 镜片
    pc.px(14, 11, '#dff0f6')
    pc.px(9, 11, OUT) // 瞳孔
    pc.px(14, 11, OUT)
  }
  // 白胡
  pc.rect(9, 13, 6, 2, '#e8e8e8')
  pc.rect(9, 14, 6, 1, '#c8c8c8')
  // 领口（画在头之后，避开帽檐遮挡）
  pc.rect(9, 15, 6, 2, GOLD)

  // —— 星纹尖帽（帽檐 + 锥身 + 尖端星）——
  blk(pc, 5, 7, 14, 3, HAT)
  pc.rect(5, 7, 14, 1, HAT_L) // 帽檐高光
  pc.triangle(11, 0, 6, 9, 17, 9, OUT) // 暗描边锥
  pc.triangle(11, 1, 7, 9, 16, 9, HAT) // 帽身
  pc.px(11, 0, STAR_C) // 尖端星
  pc.px(10, 0, STAR_C)
  pc.px(10, 4, STAR_C) // 帽身星
  pc.px(12, 6, STAR_C)
  pc.rect(7, 8, 10, 1, GOLD) // 金环带

  // —— 袖臂 + 钓竿（画在身体之上）——
  if (isShow) {
    // 双袖举起展示鱼（鱼在脸前方，避开尖帽）
    blk(pc, 6, 7, 2, 6, ROBE)
    blk(pc, 16, 7, 2, 6, ROBE)
    pc.rect(6, 5, 2, 2, PAL.skin)
    pc.rect(16, 5, 2, 2, PAL.skin)
    // 手中鱼儿
    pc.ellipse(11, 3, 4.2, 2.1, '#6fb0d0')
    pc.ellipse(11, 3, 2.8, 1.3, '#bfe6f2')
    pc.triangle(15, 3, 11, 1.4, 11, 4.6, '#4a93b0')
    pc.px(9, 2, INK)
    // 竿斜靠身侧
    rodLine(pc, 20, 33, 21, 20)
  } else {
    // 右袖自然下垂
    blk(pc, 17, 14, 2, 7, ROBE)
    pc.rect(17, 18, 2, 2, GOLD) // 袖口金环
    pc.rect(17, 20, 2, 2, PAL.skin) // 手
    // 左袖举起握竿
    blk(pc, 5, 14, 2, 7, ROBE)
    pc.rect(5, 18, 2, 2, GOLD)
    pc.rect(5, 12, 2, 2, PAL.skin) // 握竿手
    const tip = ROD_TIP_WIZARD[pose]
    rodLine(pc, 6, 13, tip[0], tip[1])
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
    const drawChar =
      skin === 'cat' ? drawCatCharacter :
      skin === 'frog' ? drawFrogCharacter :
      skin === 'penguin' ? drawPenguinCharacter :
      skin === 'wizard' ? drawWizardCharacter :
      drawPlayer
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
