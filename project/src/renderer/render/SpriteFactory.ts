import { PixelCanvas, mixHex } from './PixelCanvas'
import { PAL } from './Palette'
import type { CharacterSkin, FishBodyShape, FishDef, FishFeature } from '../shared/types'

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
  /** 开启的宝箱（结算 TREASURE 行） */
  chestOpen: HTMLCanvasElement
  crown: HTMLCanvasElement
  exclaim: HTMLCanvasElement
  star: HTMLCanvasElement
  /** 金币图标（售价行） */
  coin: HTMLCanvasElement
  /** 未发现鱼类的「鱼影？」图标（图鉴锁定卡） */
  fishQuest: HTMLCanvasElement
  /** 通用鱼竿图标（结算「解锁新竿」提示用） */
  rod: HTMLCanvasElement
  clouds: HTMLCanvasElement[]
}

export type PlayerPose = 'idle0' | 'idle1' | 'cast0' | 'cast1' | 'cast2' | 'reel' | 'show'

const INK = '#241a12'
/** 人物统一暗描边，保证在任意桌面背景上都清晰可见 */
const OUT = '#241a12'

/**
 * 农夫每帧钓竿尖端相对精灵左上角的偏移（钓线起点；规范 §2.2/§2.4）。
 * 面朝左、塘在左：idle 胸前斜持左上 → cast0 引（竿后扬右上）→ cast1 送（回正顶点）→
 * cast2 指（竿向左下、尖最低，钓线从此出发）→ reel 屈肘（尖略低于 cast2）→ show 竿靠身右。
 */
export const ROD_TIP_FARMER: Record<PlayerPose, [number, number]> = {
  idle0: [1, 10],
  idle1: [1, 10],
  cast0: [20, 4],
  cast1: [6, 2],
  cast2: [0, 26],
  reel: [0, 28],
  show: [20, 18]
}

/** 猫将形象钓竿尖端偏移：双爪持竿，弧线同农夫（引—送—指），cast2/reel 尖最低 */
export const ROD_TIP_CAT: Record<PlayerPose, [number, number]> = {
  idle0: [2, 10],
  idle1: [2, 10],
  cast0: [20, 4],
  cast1: [5, 3],
  cast2: [0, 26],
  reel: [0, 28],
  show: [21, 20]
}

/** 蛙渔夫钓竿尖端偏移：左蹼握竿，弧线同农夫 */
export const ROD_TIP_FROG: Record<PlayerPose, [number, number]> = {
  idle0: [1, 7],
  idle1: [1, 7],
  cast0: [22, 5],
  cast1: [11, 2],
  cast2: [0, 26],
  reel: [0, 28],
  show: [22, 22]
}

/** 企鹅钓手钓竿尖端偏移：左鳍握竿，弧线同农夫 */
export const ROD_TIP_PENGUIN: Record<PlayerPose, [number, number]> = {
  idle0: [1, 5],
  idle1: [1, 5],
  cast0: [22, 5],
  cast1: [5, 2],
  cast2: [0, 26],
  reel: [0, 28],
  show: [22, 21]
}

/** 星纹小巫师钓竿尖端偏移：左袖握竿，弧线同农夫（绕开尖帽/帽檐） */
export const ROD_TIP_WIZARD: Record<PlayerPose, [number, number]> = {
  idle0: [1, 4],
  idle1: [1, 4],
  cast0: [21, 5],
  cast1: [4, 1],
  cast2: [0, 26],
  reel: [0, 28],
  show: [21, 20]
}

/** 五位经典角色各自保留完整映射；待机竿身放在脸部下方，保留标志面部。 */
export const ROD_TIP_SHINCHAN: Record<PlayerPose, [number, number]> = {
  ...ROD_TIP_FARMER, idle0: [0, 21], idle1: [0, 21], cast2: [0, 29], reel: [0, 31], show: [22, 21]
}
export const ROD_TIP_MARUKO: Record<PlayerPose, [number, number]> = {
  ...ROD_TIP_FARMER, idle0: [0, 19], idle1: [0, 19], cast2: [0, 28], reel: [0, 30], show: [22, 20]
}
export const ROD_TIP_PIKACHU: Record<PlayerPose, [number, number]> = {
  ...ROD_TIP_FARMER, idle0: [0, 21], idle1: [0, 21], cast2: [0, 29], reel: [0, 31], show: [22, 21]
}
export const ROD_TIP_RUKAWA: Record<PlayerPose, [number, number]> = {
  ...ROD_TIP_FARMER, idle0: [1, 14], idle1: [1, 14], show: [22, 20]
}
export const ROD_TIP_DORAEMON: Record<PlayerPose, [number, number]> = {
  ...ROD_TIP_FARMER, idle0: [0, 24], idle1: [0, 24], cast2: [0, 31], reel: [0, 33], show: [22, 22]
}

/** 按形象取 rod tip 映射表 */
export const ROD_TIPS: Record<CharacterSkin, Record<PlayerPose, [number, number]>> = {
  farmer: ROD_TIP_FARMER,
  cat: ROD_TIP_CAT,
  frog: ROD_TIP_FROG,
  penguin: ROD_TIP_PENGUIN,
  wizard: ROD_TIP_WIZARD,
  shinchan: ROD_TIP_SHINCHAN,
  maruko: ROD_TIP_MARUKO,
  pikachu: ROD_TIP_PIKACHU,
  rukawa: ROD_TIP_RUKAWA,
  doraemon: ROD_TIP_DORAEMON
}

/** 兼容旧导入：默认指向农夫 */
export const ROD_TIP = ROD_TIP_FARMER

/* =========================================================================
 *  精灵编译器
 *  -----------------------------------------------------------------------
 *  旧版直接往画布糊矩形，出来是"平色方块 + 1px 边线"，这是"粗糙感"的根因。
 *  现在分两步：
 *    1) Sil —— 用椭圆 / 锥形肢体 / 三角形 / 自定义 SDF 拼出剪影，并给每个
 *       像素打上材质 id（皮肤 / 头发 / 上衣 …）。
 *    2) paintSil —— 一次成型：距离场求体积法线做上左受光，材质交界压暗，
 *       最后统一补 1px 外描边。这样每个部件都有圆润剪影 + 立体明暗，
 *       而不是一块块硬边矩形。
 * ========================================================================= */

/** 三阶色（基色 / 受光色 / 暗部色） */
type Tone = readonly [base: string, light: string, dark: string]

/** 从基色推导三阶色；delta 越大对比越强 */
function tone(base: string, l = 0.24, d = 0.22): Tone {
  return [base, mixHex(base, '#ffffff', l), mixHex(base, '#000000', d)] as const
}

/** 剪影蒙版：0 = 空，1..255 = 材质 id */
class Sil {
  readonly w: number
  readonly h: number
  readonly m: Uint8Array

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.m = new Uint8Array(w * h)
  }

  set(x: number, y: number, id: number): void {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return
    this.m[yi * this.w + xi] = id
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0
    return this.m[y * this.w + x]
  }

  rect(x: number, y: number, w: number, h: number, id: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, id)
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, id: number): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx
        const dy = (y - cy) / ry
        if (dx * dx + dy * dy <= 1) this.set(x, y, id)
      }
    }
  }

  tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, id: number): void {
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
        if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0) this.set(x, y, id)
      }
    }
  }

  /** 锥形肢体：沿线段撒半径渐变的圆（比矩形手臂自然得多） */
  limb(x1: number, y1: number, x2: number, y2: number, r1: number, r2: number, id: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1)
    const steps = Math.max(1, Math.ceil(len * 2))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const r = r1 + (r2 - r1) * t
      this.ellipse(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r, r, id)
    }
  }

  /** 自定义 SDF 填充（<= 0 为实心），用于长袍下摆这类异形剪影 */
  sdfFill(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    fn: (x: number, y: number) => number,
    id: number
  ): void {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        if (fn(x, y) <= 0) this.set(x, y, id)
      }
    }
  }
}

/**
 * 距离变换：内部像素 -> 到边界（最近外部像素）的近似欧氏距离；外部像素 = 0。
 * 两遍 chamfer（3-4-3 权重近似欧氏），对 24×40 级精灵足够稳定且便宜。
 */
function distanceField(m: Uint8Array, w: number, h: number): Float64Array {
  const N = w * h
  const d = new Float64Array(N)
  for (let i = 0; i < N; i++) d[i] = m[i] === 0 ? 0 : 1e9
  const S = Math.SQRT2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 1)
      if (y > 0) v = Math.min(v, d[i - w] + 1)
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + S)
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + S)
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1)
      if (y < h - 1) v = Math.min(v, d[i + w] + 1)
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + S)
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + S)
      d[i] = v
    }
  }
  return d
}

/**
 * 把剪影一次性烘成带体积的像素图：
 * - 距离场梯度 → 外法线 → 上左受光（亮）/ 下右背光（暗），最外一圈做 AO 收圆；
 * - 相邻不同材质压暗，形成干净的内部轮廓（衣袖、领口、肚皮）；
 * - 剪影外围补 1px 暗描边，保证透明桌面上永远可见。
 */
function paintSil(
  pc: PixelCanvas,
  sil: Sil,
  tones: Record<number, Tone>,
  opt: { rim?: number; edgeMix?: number; litT?: number; darkT?: number } = {}
): void {
  const { w, h, m } = sil
  const rim = opt.rim ?? 1.42
  const edgeMix = opt.edgeMix ?? 0.34

  const dist = distanceField(m, w, h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const id = m[i]
      if (!id) continue
      const t = tones[id] ?? (['#ffffff', '#ffffff', '#ffffff'] as Tone)
      const base = t[0]
      const dd = dist[i]

      // 法线 = -∇dist；光源来自上左，故 gx+gy>0 即朝光（亮）
      const xr = x < w - 1 ? i + 1 : i
      const xl = x > 0 ? i - 1 : i
      const yd = y < h - 1 ? i + w : i
      const yu = y > 0 ? i - w : i
      const gx = dist[xr] - dist[xl]
      const gy = dist[yd] - dist[yu]
      let k = (gx + gy) / 3.5
      if (k > 1) k = 1
      if (k < -0.8) k = -0.8

      let col: string
      if (k >= 0) col = mixHex(base, t[1], k * 0.9)
      else col = mixHex(base, t[2], -k * 0.9)

      // 边缘环境光遮蔽：越靠轮廓越暗，做出圆润体积
      if (dd < rim) col = mixHex(col, t[2], ((rim - dd) / rim) * 0.4)

      // 材质交界压暗（衣袖 / 颈 / 肚分界）
      const nb = [x > 0 ? m[i - 1] : 0, x < w - 1 ? m[i + 1] : 0, y > 0 ? m[i - w] : 0, y < h - 1 ? m[i + w] : 0]
      let edge = false
      for (const n of nb) {
        if (n !== 0 && n !== id) { edge = true; break }
      }
      if (edge) col = mixHex(col, t[2], edgeMix)

      pc.px(x, y, col)
    }
  }

  // 外描边：外部相邻实心像素处补 1px 暗线
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (m[i] !== 0) continue
      const nb = [x > 0 ? m[i - 1] : 0, x < w - 1 ? m[i + 1] : 0, y > 0 ? m[i - w] : 0, y < h - 1 ? m[i + w] : 0]
      if (nb.some((v) => v !== 0)) pc.px(x, y, OUT)
    }
  }
}

/* =========================================================================
 *  钓竿 / 手 / 手臂 等小工具
 * ========================================================================= */

/** 钓竿身：同一路径先描暗边再填色，浅色桌面上也能辨认竿身。 */
function rodLine(pc: PixelCanvas, x1: number, y1: number, x2: number, y2: number, color = '#caa46a'): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2))
  const pixels: Array<[number, number]> = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    pixels.push([Math.round(x1 + dx * t), Math.round(y1 + dy * t)])
  }
  for (const [x, y] of pixels) pc.rect(x - 1, y - 1, 3, 4, OUT)
  for (const [x, y] of pixels) {
    pc.px(x, y, color)
    pc.px(x, y + 1, color)
  }
}

/** 完整钓竿：竿身 + 竿梢高光 + 暗棕握把 + 银灰卷线器 */
function rodShaft(pc: PixelCanvas, gx: number, gy: number, tx: number, ty: number): void {
  rodLine(pc, gx, gy, tx, ty, '#caa46a')
  pc.px(Math.round(tx), Math.round(ty), '#f0d89a')
  pc.rect(Math.round(gx) - 1, Math.round(gy), 2, 2, '#5d3d22')
  const mx = Math.round((gx + tx) / 2)
  const my = Math.round((gy + ty) / 2)
  pc.rect(mx - 1, my - 1, 2, 2, '#9aa3ad')
  pc.px(mx, my, '#cfd6dd')
}

/** 握竿的手 / 爪：盖在握把处的一小块肤色 */
function handOver(pc: PixelCanvas, gx: number, gy: number, color: string): void {
  const x = Math.round(gx)
  const y = Math.round(gy)
  pc.ellipse(x, y, 1.7, 1.7, color)
  pc.px(x, y, color)
}

/** 锥形手臂：肩 -> 肘（袖）-> 手（肤），比矩形手臂自然 */
function addArm(sil: Sil, sx: number, sy: number, hand: [number, number], sleeveId: number, skinId: number): void {
  const mx = (sx + hand[0]) / 2
  const my = (sy + hand[1]) / 2
  sil.limb(sx, sy, mx, my, 2.2, 1.5, sleeveId)
  sil.limb(mx, my, hand[0], hand[1], 1.5, 1.2, skinId)
}

/** 展示姿态举着的小鱼 */
function drawHeldFish(pc: PixelCanvas, cx: number, cy: number): void {
  const x = Math.round(cx)
  const y = Math.round(cy)
  pc.ellipse(x, y, 3.6, 2.2, OUT) // 暗描边底
  pc.ellipse(x, y, 3.0, 1.8, '#8ec5e0') // 鱼身
  pc.triangle(x - 3, y, x - 5, y - 2, x - 5, y + 2, OUT)
  pc.triangle(x - 3, y, x - 5, y - 1, x - 5, y + 1, '#8ec5e0')
  pc.px(x + 2, y, INK) // 眼
}

/** 角色姿态规格（所有形象共用） */
interface PoseSpec {
  lean: number
  stance: number
  handF: [number, number]
  handB: [number, number]
  grip: [number, number]
  tip: [number, number]
  show?: boolean
}

/* =========================================================================
 *  农夫：棕发、绿衫、蓝裤、右手持竿（默认形象）
 * ========================================================================= */

const FM = { skin: 1, hair: 2, shirt: 3, pants: 4, boot: 5 } as const

const FARMER_TONES: Record<number, Tone> = {
  [FM.skin]: tone('#f0c8a0', 0.16, 0.16),
  [FM.hair]: tone('#7a4a22', 0.2, 0.2),
  [FM.shirt]: tone('#3f7d38', 0.2, 0.2),
  [FM.pants]: tone('#3a5a8c', 0.2, 0.22),
  [FM.boot]: tone('#5d3d22', 0.2, 0.22)
}

const FARMER_POSES: Record<PlayerPose, PoseSpec> = {
  idle0: { lean: 0, stance: 0, handF: [8.6, 21.0], handB: [11.0, 20.4], grip: [9.8, 20.7], tip: [1, 10] },
  idle1: { lean: 0, stance: 0, handF: [8.6, 21.0], handB: [11.0, 20.4], grip: [9.8, 20.7], tip: [1, 10] },
  cast0: { lean: 1.4, stance: 1.8, handF: [13.8, 18.4], handB: [15.0, 17.2], grip: [14.4, 17.8], tip: [20, 4] },
  cast1: { lean: 0.2, stance: 1, handF: [8.0, 16.4], handB: [10.8, 15.7], grip: [9.4, 16.0], tip: [6, 2] },
  cast2: { lean: -1.4, stance: 1.4, handF: [6.8, 20.8], handB: [9.2, 20.0], grip: [7.8, 20.4], tip: [0, 26] },
  reel: { lean: -0.8, stance: 1.8, handF: [6.6, 20.4], handB: [9.2, 19.6], grip: [7.7, 20.0], tip: [0, 28] },
  show: { lean: 0, stance: 0, handF: [8.2, 7.6], handB: [13.8, 7.6], grip: [17.8, 31], tip: [20, 18], show: true }
}

/** 程序化生成「农夫」：棕发绿衫蓝裤，右手持竿面朝左 */
function drawPlayer(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const sil = new Sil(24, 40)
  const P = FARMER_POSES[pose]
  const blink = pose === 'idle1'

  // —— 靴 ——
  const lfx = 8.4 - P.stance * 0.4
  const rfx = 13.8 + P.stance * 0.4
  sil.ellipse(lfx, 37.3, 2.6, 1.9, FM.boot)
  sil.ellipse(rfx, 37.3, 2.6, 1.9, FM.boot)

  // —— 腿（蓝裤）——
  sil.limb(10.2, 29.0, lfx, 35.6, 2.0, 2.1, FM.pants)
  sil.limb(13.0, 29.0, rfx, 35.6, 2.0, 2.1, FM.pants)

  // —— 躯干（绿衫）——
  const tx = 11 + P.lean * 0.4
  sil.ellipse(tx, 22.8, 5.4, 6.8, FM.shirt)

  // —— 手臂（绿衫袖 + 肤色手）——
  addArm(sil, 15.6 + P.lean * 0.3, 17.8, P.handB, FM.shirt, FM.skin)
  addArm(sil, 6.4 + P.lean * 0.3, 17.8, P.handF, FM.shirt, FM.skin)

  // —— 头（肤色）+ 头发 ——
  const hx = 11 + P.lean * 0.85
  sil.ellipse(hx, 10.8, 4.9, 4.7, FM.skin)
  sil.ellipse(hx, 6.6, 5.4, 3.3, FM.hair) // 发顶
  sil.ellipse(hx - 4.4, 10.6, 1.35, 2.7, FM.hair) // 左鬓
  sil.ellipse(hx + 4.4, 10.6, 1.35, 2.7, FM.hair) // 右鬓
  // 蓬松碎发（顶缘三个小包，破掉"方块头"的呆板）
  sil.ellipse(hx - 3.1, 4.5, 1.55, 1.75, FM.hair)
  sil.ellipse(hx + 0.3, 3.9, 1.75, 1.95, FM.hair)
  sil.ellipse(hx + 3.3, 4.7, 1.55, 1.7, FM.hair)

  paintSil(pc, sil, FARMER_TONES)

  // —— 面部细节（直接落像素，保持清晰）——
  const ex1 = Math.round(hx - 3.3)
  const ex2 = Math.round(hx + 1.3)
  pc.rect(ex1, 10, 2, 1, '#4a2c17') // 眉
  pc.rect(ex2, 10, 2, 1, '#4a2c17')
  if (blink) {
    pc.rect(ex1, 11, 2, 1, OUT)
    pc.rect(ex2, 11, 2, 1, OUT)
  } else {
    pc.rect(ex1, 11, 2, 2, '#2a1a10')
    pc.rect(ex2, 11, 2, 2, '#2a1a10')
    pc.px(ex1, 11, '#ffffff')
    pc.px(ex2, 11, '#ffffff')
  }
  pc.rect(Math.round(hx - 0.5), 13.4, 2, 1, '#b9774e') // 嘴

  // —— 钓竿 + 握竿手 ——
  if (!P.show) {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    handOver(pc, P.grip[0], P.grip[1], '#f0c8a0')
  } else {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    drawHeldFish(pc, 11, 4.7)
  }

  return pc.bake()
}

/* =========================================================================
 *  橘猫 HARRY：橙黄虎斑 + 奶油肚皮，圆脸尖耳、卷尾
 * ========================================================================= */

const CM = { fur: 1, furDark: 2, belly: 3, earPink: 4, nose: 5 } as const

const CAT_TONES: Record<number, Tone> = {
  [CM.fur]: tone('#e8963c', 0.22, 0.2),
  [CM.furDark]: tone('#b86a20', 0.18, 0.2),
  [CM.belly]: tone('#f8e4b8', 0.16, 0.14),
  [CM.earPink]: tone('#e8a0a0', 0.16, 0.16),
  [CM.nose]: tone('#c96a6a', 0.12, 0.16)
}

const CAT_POSES: Record<PlayerPose, PoseSpec> = {
  idle0: { lean: 0, stance: 0, handF: [8.6, 21.2], handB: [10.9, 20.6], grip: [9.8, 20.9], tip: [2, 10] },
  idle1: { lean: 0, stance: 0, handF: [8.6, 21.2], handB: [10.9, 20.6], grip: [9.8, 20.9], tip: [2, 10] },
  cast0: { lean: 1.4, stance: 2, handF: [13.6, 19.0], handB: [14.7, 17.6], grip: [14.1, 18.3], tip: [20, 4] },
  cast1: { lean: 0.2, stance: 1, handF: [8.8, 16.8], handB: [10.6, 16.1], grip: [9.6, 16.4], tip: [5, 3] },
  cast2: { lean: -1.4, stance: 1.4, handF: [6.6, 21.0], handB: [9.0, 20.2], grip: [7.6, 20.6], tip: [0, 26] },
  reel: { lean: -0.8, stance: 1.8, handF: [6.4, 20.6], handB: [9.0, 19.8], grip: [7.6, 20.2], tip: [0, 28] },
  show: { lean: 0, stance: 0, handF: [8.2, 7.6], handB: [13.8, 7.6], grip: [17.8, 31], tip: [21, 20], show: true }
}

/** 程序化生成「橘猫 HARRY」：圆脸尖耳、奶油肚、虎斑环尾，双爪持竿面朝左 */
function drawCatCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const sil = new Sil(24, 40)
  const P = CAT_POSES[pose]
  const blink = pose === 'idle1'

  // —— 卷尾（右侧贝塞尔，交替深浅做出环纹）——
  const tail: Array<[number, number]> = []
  const bp: Array<[number, number]> = [[16.4, 31.5], [22.2, 31.0], [22.6, 23.5], [20.4, 16.8]]
  for (let i = 0; i <= 9; i++) {
    const t = i / 9
    const mt = 1 - t
    const x = mt * mt * mt * bp[0][0] + 3 * mt * mt * t * bp[1][0] + 3 * mt * t * t * bp[2][0] + t * t * t * bp[3][0]
    const y = mt * mt * mt * bp[0][1] + 3 * mt * mt * t * bp[1][1] + 3 * mt * t * t * bp[2][1] + t * t * t * bp[3][1]
    tail.push([x, y])
  }
  for (let i = 0; i < tail.length - 1; i++) {
    sil.limb(tail[i][0], tail[i][1], tail[i + 1][0], tail[i + 1][1], 1.7, 1.35, i % 2 ? CM.furDark : CM.fur)
  }

  // —— 腿 / 脚掌 ——
  const lfx = 8.9 - P.stance * 0.5
  const rfx = 14.1 + P.stance * 0.5
  sil.limb(9.8, 29.0, lfx, 35.6, 1.9, 2.0, CM.fur)
  sil.limb(13.2, 29.0, rfx, 35.6, 1.9, 2.0, CM.fur)
  sil.ellipse(lfx - 0.2, 37.0, 2.6, 1.9, CM.fur)
  sil.ellipse(rfx + 0.2, 37.0, 2.6, 1.9, CM.fur)
  sil.ellipse(lfx - 0.5, 37.4, 1.5, 1.1, CM.belly) // 奶油爪
  sil.ellipse(rfx + 0.5, 37.4, 1.5, 1.1, CM.belly)

  // —— 躯干 + 奶油肚 ——
  const tx = 11 + P.lean * 0.45
  sil.ellipse(tx, 22.6, 5.6, 7.0, CM.fur)
  sil.ellipse(tx - 0.4, 23.6, 3.4, 5.0, CM.belly)

  // —— 双臂 ——
  addArm(sil, 15.4 + P.lean * 0.3, 18.6, P.handB, CM.fur, CM.fur)
  addArm(sil, 6.6 + P.lean * 0.3, 18.6, P.handF, CM.fur, CM.fur)

  // —— 头 + 尖耳 ——
  const hx = 11 + P.lean * 0.85
  sil.tri(hx - 4.6, 8.4, hx - 3.9, 2.2, hx - 1.5, 6.6, CM.fur) // 左耳
  sil.tri(hx + 1.5, 6.6, hx + 3.9, 2.2, hx + 4.6, 8.4, CM.fur) // 右耳
  sil.tri(hx - 4.0, 7.8, hx - 3.6, 3.6, hx - 2.2, 6.7, CM.earPink)
  sil.tri(hx + 2.2, 6.7, hx + 3.6, 3.6, hx + 4.0, 7.8, CM.earPink)
  sil.ellipse(hx, 10.8, 5.3, 4.9, CM.fur)
  sil.ellipse(hx - 4.4, 12.2, 1.5, 1.8, CM.fur) // 腮帮绒毛
  sil.ellipse(hx + 4.4, 12.2, 1.5, 1.8, CM.fur)
  sil.ellipse(hx - 0.4, 13.0, 2.9, 1.9, CM.belly) // 奶油口鼻

  paintSil(pc, sil, CAT_TONES)

  // —— 虎斑纹（额头 M + 身侧横纹），实心落笔保持锐利 ——
  const furD = '#b86a20'
  pc.rect(Math.round(hx - 2.4), 7, 1, 2, furD)
  pc.rect(Math.round(hx - 0.4), 6, 1, 2, furD)
  pc.rect(Math.round(hx + 1.6), 7, 1, 2, furD)
  for (let i = 0; i < 3; i++) {
    const yy = Math.round(19 + i * 3)
    pc.rect(Math.round(tx - 5.2), yy, 2, 1, furD)
    pc.rect(Math.round(tx + 3.4), yy, 2, 1, furD)
  }

  // —— 面部 ——
  const ex1 = Math.round(hx - 3.2)
  const ex2 = Math.round(hx + 1.2)
  if (blink) {
    pc.rect(ex1, 11, 2, 1, '#2a1a10')
    pc.rect(ex2, 11, 2, 1, '#2a1a10')
  } else {
    pc.rect(ex1, 10, 2, 3, '#2a1a10')
    pc.rect(ex2, 10, 2, 3, '#2a1a10')
    pc.px(ex1, 10, '#ffffff')
    pc.px(ex2, 10, '#ffffff')
  }
  pc.px(Math.round(hx - 0.4), 12, '#c96a6a') // 鼻
  pc.rect(Math.round(hx - 0.9), 13, 2, 1, '#8a5a30') // 嘴
  // 胡须
  pc.px(Math.round(hx - 5.2), 12, '#8a5a30')
  pc.px(Math.round(hx - 6.0), 12, '#8a5a30')
  pc.px(Math.round(hx + 4.4), 12, '#8a5a30')
  pc.px(Math.round(hx + 5.2), 12, '#8a5a30')

  // —— 竿 + 爪 ——
  if (!P.show) {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    handOver(pc, P.grip[0], P.grip[1], '#f8e4b8')
  } else {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    drawHeldFish(pc, 11, 4.9)
  }

  return pc.bake()
}

/* =========================================================================
 *  蛙渔夫 威利：宽体无颈、头顶大眼、黄肚皮
 * ========================================================================= */

const GM = { frog: 1, frogDark: 2, belly: 3 } as const

const FROG_TONES: Record<number, Tone> = {
  [GM.frog]: tone('#57a64b', 0.24, 0.21),
  [GM.frogDark]: tone('#3f7d38', 0.18, 0.22),
  [GM.belly]: tone('#f2e4b8', 0.16, 0.14)
}

const FROG_POSES: Record<PlayerPose, PoseSpec> = {
  idle0: { lean: 0, stance: 0, handF: [8.4, 21.0], handB: [11.0, 20.4], grip: [9.7, 20.7], tip: [1, 7] },
  idle1: { lean: 0, stance: 0, handF: [8.4, 21.0], handB: [11.0, 20.4], grip: [9.7, 20.7], tip: [1, 7] },
  cast0: { lean: 1.4, stance: 1.6, handF: [13.8, 18.6], handB: [15.0, 17.4], grip: [14.4, 18.0], tip: [22, 5] },
  cast1: { lean: 0.2, stance: 1, handF: [9.2, 17.0], handB: [11.2, 16.3], grip: [10.2, 16.6], tip: [11, 2] },
  cast2: { lean: -1.2, stance: 1.2, handF: [6.8, 20.6], handB: [9.2, 19.8], grip: [8.0, 20.2], tip: [0, 26] },
  reel: { lean: -0.8, stance: 1.4, handF: [6.6, 20.2], handB: [9.2, 19.4], grip: [7.9, 19.8], tip: [0, 28] },
  show: { lean: 0, stance: 0, handF: [8.0, 8.2], handB: [14.0, 8.2], grip: [18.0, 31], tip: [22, 22], show: true }
}

/** 程序化生成「蛙渔夫 威利」：宽体大眼、米色肚皮、蹼足，左蹼握竿面朝左 */
function drawFrogCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const sil = new Sil(24, 40)
  const P = FROG_POSES[pose]
  const blink = pose === 'idle1'

  // —— 蹼足 ——
  const lfx = 7.6 - P.stance * 0.4
  const rfx = 15.0 + P.stance * 0.4
  sil.ellipse(lfx, 36.8, 3.4, 2.3, GM.frog)
  sil.ellipse(rfx, 36.8, 3.4, 2.3, GM.frog)

  // 短后腿连接腹部和蹼足，避免脚与身体之间出现三行透明断层。
  const tx = 11 + P.lean * 0.4
  sil.limb(tx - 2.4, 28.0, lfx, 35.8, 2.5, 1.8, GM.frog)
  sil.limb(tx + 2.4, 28.0, rfx, 35.8, 2.5, 1.8, GM.frog)

  // —— 宽体 + 头（连成一片的圆滚剪影）——
  sil.ellipse(tx, 23.4, 6.8, 6.4, GM.frog)
  sil.ellipse(tx - 0.2, 14.6, 7.0, 6.2, GM.frog)
  sil.ellipse(tx - 0.4, 23.8, 3.9, 4.4, GM.belly)

  // —— 手臂 ——
  addArm(sil, 5.4 + P.lean * 0.3, 18.4, P.handF, GM.frog, GM.frog)
  addArm(sil, 16.8 + P.lean * 0.3, 18.4, P.handB, GM.frog, GM.frog)

  paintSil(pc, sil, FROG_TONES)

  // —— 头顶大眼（凸出剪影外，独立描边）——
  const eyeY = 7.4
  for (const exx of [tx - 4.2, tx + 4.2]) {
    pc.ellipse(exx, eyeY, 2.9, 2.9, OUT)
    pc.ellipse(exx, eyeY, 2.15, 2.15, '#f8f8f0')
    if (blink) {
      pc.rect(Math.round(exx - 2), Math.round(eyeY), 4, 1, OUT)
    } else {
      pc.ellipse(exx - 0.8, eyeY, 1.15, 1.45, '#2a1a10')
      pc.px(Math.round(exx - 0.8), Math.round(eyeY - 0.6), '#ffffff')
    }
  }

  // —— 鼻孔 / 微笑 / 蹼趾 ——
  pc.px(Math.round(tx - 1.8), 13.2, '#3f7d38')
  pc.px(Math.round(tx + 1.4), 13.2, '#3f7d38')
  for (let i = 0; i < 5; i++) {
    const xx = Math.round(tx - 5.4 + i * 2.6)
    pc.px(xx, 15.6 + (i === 0 || i === 4 ? 1 : 0), '#3f7d38')
  }
  pc.rect(Math.round(lfx - 1.4), 37.8, 1, 1, '#3f7d38')
  pc.rect(Math.round(lfx + 0.8), 37.8, 1, 1, '#3f7d38')
  pc.rect(Math.round(rfx - 1.4), 37.8, 1, 1, '#3f7d38')
  pc.rect(Math.round(rfx + 0.8), 37.8, 1, 1, '#3f7d38')

  // —— 竿 + 蹼手 ——
  if (!P.show) {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    handOver(pc, P.grip[0], P.grip[1], '#6fbf56')
  } else {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    drawHeldFish(pc, 11, 5.2)
  }

  return pc.bake()
}

/* =========================================================================
 *  企鹅钓手 柯罗拉：圆滚滚、白脸盘、橙喙橙脚、红围巾
 * ========================================================================= */

const PM = { back: 1, belly: 2, beak: 3, scarf: 4, foot: 5, face: 6 } as const

const PENGUIN_TONES: Record<number, Tone> = {
  [PM.back]: tone('#2b2f3a', 0.2, 0.24),
  [PM.belly]: tone('#f5f5f0', 0.1, 0.16),
  [PM.beak]: tone('#e8a04a', 0.18, 0.2),
  [PM.scarf]: tone('#c0453a', 0.2, 0.2),
  [PM.foot]: tone('#e8a04a', 0.18, 0.2),
  [PM.face]: tone('#f5f5f0', 0.1, 0.16)
}

const PENGUIN_POSES: Record<PlayerPose, PoseSpec> = {
  idle0: { lean: 0, stance: 0, handF: [7.4, 21.0], handB: [11.0, 20.4], grip: [9.0, 20.7], tip: [1, 5] },
  idle1: { lean: 0, stance: 0, handF: [7.4, 21.0], handB: [11.0, 20.4], grip: [9.0, 20.7], tip: [1, 5] },
  cast0: { lean: 1.2, stance: 1.2, handF: [13.4, 18.4], handB: [15.0, 17.2], grip: [14.2, 17.8], tip: [22, 5] },
  cast1: { lean: 0.2, stance: 0.8, handF: [8.6, 16.6], handB: [10.8, 15.9], grip: [9.7, 16.2], tip: [5, 2] },
  cast2: { lean: -1.2, stance: 1.0, handF: [6.4, 20.4], handB: [9.2, 19.6], grip: [7.8, 20.0], tip: [0, 26] },
  reel: { lean: -0.8, stance: 1.2, handF: [6.2, 20.0], handB: [9.2, 19.2], grip: [7.7, 19.6], tip: [0, 28] },
  show: { lean: 0, stance: 0, handF: [7.6, 8.0], handB: [14.4, 8.0], grip: [18.2, 31], tip: [22, 21], show: true }
}

/** 程序化生成「企鹅钓手 柯罗拉」：蛋形身体、白脸盘、红围巾，左鳍握竿面朝左 */
function drawPenguinCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const sil = new Sil(24, 40)
  const P = PENGUIN_POSES[pose]
  const blink = pose === 'idle1'

  // —— 橙脚 ——
  const lfx = 8.4 - P.stance * 0.4
  const rfx = 13.8 + P.stance * 0.4
  sil.ellipse(lfx, 37.3, 2.9, 2.0, PM.foot)
  sil.ellipse(rfx, 37.3, 2.9, 2.0, PM.foot)

  // 短腿收在羽毛下，连接脚掌；保留原本的圆滚身体和脚底基线。
  const tx = 11 + P.lean * 0.4
  sil.limb(tx - 2.1, 30.2, lfx, 36.2, 2.0, 1.2, PM.back)
  sil.limb(tx + 2.1, 30.2, rfx, 36.2, 2.0, 1.2, PM.back)

  // —— 蛋形身体 + 头（无颈，连成一体）——
  sil.ellipse(tx, 24.6, 6.2, 10.0, PM.back)
  sil.ellipse(tx - 0.1, 10.6, 5.0, 5.2, PM.back)
  sil.ellipse(tx - 0.2, 25.3, 4.4, 6.9, PM.belly)
  sil.ellipse(tx - 0.2, 11.0, 3.9, 4.2, PM.face)

  // —— 橙喙 ——
  sil.tri(tx - 1.7, 11.6, tx + 1.5, 11.6, tx - 0.1, 14.2, PM.beak)

  // —— 红围巾（带状 + 左侧垂尾）——
  sil.ellipse(tx, 15.8, 6.0, 1.4, PM.scarf)
  sil.rect(tx - 6.6, 16.2, 2.6, 2.2, PM.scarf)

  // —— 鳍臂 ——
  addArm(sil, 16.4 + P.lean * 0.3, 18.0, P.handB, PM.back, PM.back)
  addArm(sil, 5.6 + P.lean * 0.3, 18.0, P.handF, PM.back, PM.back)

  paintSil(pc, sil, PENGUIN_TONES)

  // —— 面部 ——
  const ex1 = Math.round(tx - 2.4)
  const ex2 = Math.round(tx + 1.4)
  if (blink) {
    pc.rect(ex1, 10, 2, 1, OUT)
    pc.rect(ex2, 10, 2, 1, OUT)
  } else {
    pc.rect(ex1, 9, 2, 2, OUT)
    pc.rect(ex2, 9, 2, 2, OUT)
    pc.px(ex1, 9, '#ffffff')
    pc.px(ex2, 9, '#ffffff')
  }
  // 喙高光
  pc.px(Math.round(tx - 0.2), 12, '#f4c882')

  // —— 竿 + 鳍手 ——
  if (!P.show) {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    handOver(pc, P.grip[0], P.grip[1], '#3d4250')
  } else {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    drawHeldFish(pc, 11, 5.0)
  }

  return pc.bake()
}

/* =========================================================================
 *  星纹小巫师：紫长袍、金饰、尖帽、白胡
 * ========================================================================= */

const WM = { robe: 1, robeDark: 2, gold: 3, skin: 4, beard: 5, hat: 6, boot: 7 } as const

const WIZARD_TONES: Record<number, Tone> = {
  [WM.robe]: tone('#5a4a8a', 0.22, 0.22),
  [WM.robeDark]: tone('#453a6e', 0.18, 0.2),
  [WM.gold]: tone('#e8c53a', 0.24, 0.2),
  [WM.skin]: tone('#f0c8a0', 0.16, 0.16),
  [WM.beard]: tone('#e8e8e8', 0.12, 0.14),
  [WM.hat]: tone('#3d3a6e', 0.22, 0.22),
  [WM.boot]: tone('#5d3d22', 0.2, 0.22)
}

const WIZARD_POSES: Record<PlayerPose, PoseSpec> = {
  idle0: { lean: 0, stance: 0, handF: [7.6, 21.0], handB: [11.0, 20.4], grip: [9.2, 20.7], tip: [1, 4] },
  idle1: { lean: 0, stance: 0, handF: [7.6, 21.0], handB: [11.0, 20.4], grip: [9.2, 20.7], tip: [1, 4] },
  cast0: { lean: 1.2, stance: 1.2, handF: [13.6, 18.2], handB: [15.0, 17.0], grip: [14.3, 17.6], tip: [21, 5] },
  cast1: { lean: 0.2, stance: 0.8, handF: [8.8, 16.4], handB: [10.8, 15.7], grip: [9.8, 16.0], tip: [4, 1] },
  cast2: { lean: -1.2, stance: 1.0, handF: [6.6, 20.2], handB: [9.2, 19.4], grip: [7.9, 19.8], tip: [0, 26] },
  reel: { lean: -0.8, stance: 1.2, handF: [6.4, 19.8], handB: [9.2, 19.0], grip: [7.8, 19.4], tip: [0, 28] },
  show: { lean: 0, stance: 0, handF: [7.8, 7.8], handB: [14.2, 7.8], grip: [18.0, 31], tip: [21, 20], show: true }
}

/** 程序化生成「星纹小巫师」：下摆外扩长袍、尖帽、白胡、金框眼镜，左袖握竿面朝左 */
function drawWizardCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40)
  const sil = new Sil(24, 40)
  const P = WIZARD_POSES[pose]
  const blink = pose === 'idle1'

  const tx = 11 + P.lean * 0.4

  // —— 靴尖 ——
  sil.ellipse(tx - 2.6, 37.3, 2.3, 1.9, WM.boot)
  sil.ellipse(tx + 2.6, 37.3, 2.3, 1.9, WM.boot)

  // —— 外扩长袍（自定义 SDF：上窄下宽）——
  sil.sdfFill(2, 14, 21, 37, (x, y) => {
    const top = 15.4
    const bot = 35.6
    if (y < top) return 2
    if (y > bot) return y - bot
    const t = (y - top) / (bot - top)
    const hw = 4.2 + t * 2.4
    return Math.abs(x - tx) - hw
  }, WM.robe)

  // —— 金色前襟 ——
  sil.rect(tx - 0.2, 16, 1.4, 18, WM.gold)

  // —— 头 / 白胡 ——
  sil.ellipse(tx - 0.1, 10.6, 4.6, 4.4, WM.skin)
  sil.ellipse(tx - 0.1, 14.0, 3.7, 3.4, WM.beard)

  // —— 尖帽 ——
  sil.ellipse(tx, 7.2, 5.9, 1.7, WM.hat) // 帽檐
  sil.tri(tx, 1.6, tx - 4.6, 7.8, tx + 4.6, 7.8, WM.hat) // 锥身
  sil.ellipse(tx - 0.6, 2.6, 1.5, 1.5, WM.hat) // 帽尖微弯

  // —— 袖子 ——
  addArm(sil, 16.4 + P.lean * 0.3, 17.6, P.handB, WM.robe, WM.skin)
  addArm(sil, 5.6 + P.lean * 0.3, 17.6, P.handF, WM.robe, WM.skin)

  paintSil(pc, sil, WIZARD_TONES)

  // —— 袍上星纹（金色 plus）——
  const star = (sx: number, sy: number): void => {
    pc.px(sx, sy, '#f4e4b8')
    pc.px(sx, sy - 1, '#f4e4b8')
    pc.px(sx, sy + 1, '#f4e4b8')
    pc.px(sx - 1, sy, '#f4e4b8')
    pc.px(sx + 1, sy, '#f4e4b8')
  }
  star(Math.round(tx - 3.4), 24)
  star(Math.round(tx + 3.2), 30)
  star(Math.round(tx - 2.6), 32)

  // —— 金框眼镜 + 眼 ——
  const lens = (lx: number): void => {
    pc.rect(lx, 10, 3, 1, '#e8c53a')
    pc.rect(lx, 12, 3, 1, '#e8c53a')
    pc.px(lx, 11, '#e8c53a')
    pc.px(lx + 2, 11, '#e8c53a')
  }
  lens(Math.round(tx - 3.4))
  lens(Math.round(tx + 0.8))
  pc.rect(Math.round(tx - 0.6), 11, 2, 1, '#e8c53a') // 鼻梁
  if (blink) {
    pc.rect(Math.round(tx - 3.2), 11, 2, 1, OUT)
    pc.rect(Math.round(tx + 1.0), 11, 2, 1, OUT)
  } else {
    pc.rect(Math.round(tx - 3.2), 11, 2, 2, OUT)
    pc.rect(Math.round(tx + 1.0), 11, 2, 2, OUT)
    pc.px(Math.round(tx - 3.2), 11, '#dff0f6')
    pc.px(Math.round(tx + 1.0), 11, '#dff0f6')
  }

  // —— 竿 + 手 ——
  if (!P.show) {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    handOver(pc, P.grip[0], P.grip[1], '#f0c8a0')
  } else {
    rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
    drawHeldFish(pc, 11, 5.0)
  }

  return pc.bake()
}

/* =========================================================================
 *  经典角色：蜡笔小新 / 樱桃小丸子 / 皮卡丘 / 流川枫 / 哆啦A梦
 *  固定三阶私有色板，头身比例与剪影分别绘制，脸部不被待机鱼竿遮住。
 * ========================================================================= */

const NM = { body: 1, dark: 2, cream: 3, accent: 4, detail: 5 } as const
const SHINCHAN_TONES: Record<number, Tone> = {
  [NM.body]: tone('#ecc49c', 0.20, 0.23),
  [NM.dark]: tone('#3d302a', 0.17, 0.23),
  [NM.cream]: tone('#f5ead1', 0.18, 0.23),
  [NM.accent]: tone('#c9564e', 0.22, 0.26),
  [NM.detail]: tone('#e5bd64', 0.22, 0.26)
}
const MARUKO_TONES: Record<number, Tone> = {
  [NM.body]: tone('#edc6a3', 0.20, 0.23),
  [NM.dark]: tone('#3e302b', 0.18, 0.24),
  [NM.cream]: tone('#f6ead4', 0.18, 0.23),
  [NM.accent]: tone('#bc5048', 0.22, 0.26),
  [NM.detail]: tone('#ce8e79', 0.22, 0.26)
}
const PIKACHU_TONES: Record<number, Tone> = {
  [NM.body]: tone('#e5c455', 0.22, 0.26),
  [NM.dark]: tone('#4b3c2d', 0.18, 0.24),
  [NM.cream]: tone('#f6e9b8', 0.18, 0.23),
  [NM.accent]: tone('#ca6052', 0.22, 0.26),
  [NM.detail]: tone('#9b7045', 0.22, 0.26)
}
const RUKAWA_TONES: Record<number, Tone> = {
  [NM.body]: tone('#dfb899', 0.20, 0.23),
  [NM.dark]: tone('#352f2d', 0.18, 0.24),
  [NM.cream]: tone('#eee7d6', 0.18, 0.23),
  [NM.accent]: tone('#bd4e49', 0.22, 0.26),
  [NM.detail]: tone('#8b3e39', 0.22, 0.26)
}
const DORAEMON_TONES: Record<number, Tone> = {
  [NM.body]: tone('#498eaf', 0.22, 0.26),
  [NM.dark]: tone('#4b4541', 0.18, 0.24),
  [NM.cream]: tone('#f4ead6', 0.18, 0.23),
  [NM.accent]: tone('#c65a50', 0.22, 0.26),
  [NM.detail]: tone('#dfbd57', 0.22, 0.26)
}

/** 将体积法线量化为三档；每材质仅三色，避免 24×40 小精灵中出现细碎色点。 */
function paintCompanion(pc: PixelCanvas, sil: Sil, tones: Record<number, Tone>): void {
  const { w, h, m } = sil
  const dist = distanceField(m, w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const id = m[i]
      const left = sil.get(x - 1, y), right = sil.get(x + 1, y)
      const top = sil.get(x, y - 1), bottom = sil.get(x, y + 1)
      if (!id) {
        if (left || right || top || bottom) pc.px(x, y, OUT)
        continue
      }
      const light = (dist[x < w - 1 ? i + 1 : i] - dist[x > 0 ? i - 1 : i])
        + (dist[y < h - 1 ? i + w : i] - dist[y > 0 ? i - w : i])
      const seam = (right && right !== id) || (bottom && bottom !== id)
      // A one-pixel ambient-occlusion rim keeps the small faces, collars and
      // sleeves readable after the 2x UI upscale.  Keep the palette quantised
      // to the three authored tones so the sprites stay crisp and cheap.
      const rim = dist[i] < 1.28
      pc.px(x, y, tones[id][seam || rim || light < -0.35 ? 2 : light > 0.35 ? 1 : 0])
    }
  }
}

/** 压低待机/出线时双手，粗脸/圆头角色可完整露出面部；引竿与送竿保持大动作。 */
function companionPose(pose: PlayerPose, tips: Record<PlayerPose, [number, number]>, holdLower = 0): PoseSpec {
  const source = FARMER_POSES[pose]
  const lower = pose === 'idle0' || pose === 'idle1' || pose === 'cast2' || pose === 'reel' ? holdLower : 0
  const shift = ([x, y]: [number, number]): [number, number] => [x, y + lower]
  return {
    ...source, tip: tips[pose], handF: source.show ? [5.5, 5.5] : shift(source.handF),
    handB: source.show ? [16, 5.5] : shift(source.handB),
    grip: source.show ? [19, 32] : shift(source.grip)
  }
}

/** 眼睛在同一实心脸部内眨动；idle0/idle1 只改变眼部 RGB，alpha 完全一致。 */
function companionEyes(pc: PixelCanvas, hx: number, y: number, blink: boolean, highlight: string): void {
  for (const x of [Math.round(hx - 3), Math.round(hx + 1)]) {
    pc.rect(x, y + 1, 2, 1, OUT)
    if (!blink) {
      pc.rect(x, y, 2, 1, OUT)
      pc.px(x, y, highlight)
    }
  }
}

function finishCompanion(pc: PixelCanvas, P: PoseSpec, hand: string, fishX = 10, fishY = 2): HTMLCanvasElement {
  rodShaft(pc, P.grip[0], P.grip[1], P.tip[0], P.tip[1])
  if (P.show) drawHeldFish(pc, fishX, fishY)
  else handOver(pc, P.grip[0], P.grip[1], hand)
  return pc.bake()
}

/** 小新：大圆脸朝左鼓出，平头短发、两道粗眉、红上衣、黄短裤和短腿。 */
function drawShinchanCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40), sil = new Sil(24, 40)
  const P = companionPose(pose, ROD_TIP_SHINCHAN, 5)
  const tx = 11 + P.lean * 0.4, hx = Math.round(11.5 + P.lean * 0.6)
  for (const [x, side] of [[8, -1], [14, 1]]) {
    const fx = x + side * P.stance * 0.5
    sil.limb(x, 31, fx, 36.5, 1.7, 1.5, NM.body)
    sil.rect(fx - 1.2, 35.5, 2.6, 2, NM.cream)
    sil.ellipse(fx - 0.7, 37.6, 2.7, 1.4, NM.detail)
  }
  sil.rect(tx - 5, 28, 10, 5, NM.detail)
  sil.ellipse(tx, 24.2, 5.7, 5.4, NM.accent)
  addArm(sil, tx + 5, 22, P.handB, NM.accent, NM.body)
  addArm(sil, tx - 5, 22, P.handF, NM.accent, NM.body)
  sil.ellipse(hx + 6.2, 12.8, 1.9, 2.5, NM.body)
  sil.ellipse(hx, 11, 7.1, 7.0, NM.body)
  sil.ellipse(hx - 4.8, 15.0, 4.0, 4.6, NM.body)
  sil.ellipse(hx - 0.3, 4.7, 7.1, 2.5, NM.dark)
  sil.rect(hx - 6.2, 6, 12.5, 2, NM.dark)
  paintCompanion(pc, sil, SHINCHAN_TONES)
  // 标志性的海苔粗眉向脸左侧下压，和小丸子细眉/圆点眼区分。
  pc.rect(hx - 6, 9, 4, 2, SHINCHAN_TONES[NM.dark][0])
  pc.px(hx - 7, 10, SHINCHAN_TONES[NM.dark][0])
  pc.rect(hx, 8, 4, 2, SHINCHAN_TONES[NM.dark][0])
  pc.px(hx + 4, 9, SHINCHAN_TONES[NM.dark][0])
  companionEyes(pc, hx - 1, 12, pose === 'idle1', SHINCHAN_TONES[NM.body][1])
  pc.px(hx - 7, 14, SHINCHAN_TONES[NM.body][2])
  pc.rect(hx - 5, 17, 2, 1, OUT)
  pc.px(hx - 3, 16, OUT)
  pc.px(Math.round(tx), 31, SHINCHAN_TONES[NM.detail][2])
  return finishCompanion(pc, P, SHINCHAN_TONES[NM.body][0])
}

/** 小丸子：圆润短发、锯齿刘海、白衬衣红背带裙，细腿白袜小红鞋。 */
function drawMarukoCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40), sil = new Sil(24, 40)
  const P = companionPose(pose, ROD_TIP_MARUKO, 3.5)
  const tx = Math.round(11 + P.lean * 0.4), hx = Math.round(11 + P.lean * 0.6)
  for (const [x, side] of [[8, -1], [14, 1]]) {
    const fx = x + side * P.stance * 0.4
    sil.limb(x, 32, fx, 37, 1.25, 1.1, NM.body)
    sil.rect(fx - 1.2, 35.5, 2.5, 2.5, NM.cream)
    sil.ellipse(fx - 0.4, 38, 2.2, 1.0, NM.accent)
  }
  sil.ellipse(tx, 23, 4.7, 5.5, NM.cream)
  sil.sdfFill(tx - 6, 23, tx + 6, 34, (x, y) => {
    if (y < 23 || y > 33) return 2
    return Math.abs(x - tx) - (3.5 + (y - 23) * 0.2)
  }, NM.accent)
  sil.rect(tx - 3, 20, 1, 6, NM.accent)
  sil.rect(tx + 2, 20, 1, 6, NM.accent)
  addArm(sil, tx + 4.2, 21, P.handB, NM.cream, NM.body)
  addArm(sil, tx - 4.2, 21, P.handF, NM.cream, NM.body)
  sil.ellipse(hx, 10, 7.1, 7.8, NM.dark)
  sil.rect(hx - 7, 10, 3, 8, NM.dark)
  sil.rect(hx + 4, 10, 3, 8, NM.dark)
  sil.ellipse(hx - 0.2, 12.7, 5.5, 5.5, NM.body)
  sil.rect(hx - 5, 7, 10, 2, NM.dark)
  for (const x of [-4, -1, 2]) sil.tri(hx + x - 1, 8, hx + x + 1, 8, hx + x, 10, NM.dark)
  paintCompanion(pc, sil, MARUKO_TONES)
  companionEyes(pc, hx, 12, pose === 'idle1', MARUKO_TONES[NM.body][1])
  pc.px(hx - 4, 10, MARUKO_TONES[NM.dark][0])
  pc.px(hx + 1, 10, MARUKO_TONES[NM.dark][0])
  pc.px(hx - 4, 15, MARUKO_TONES[NM.detail][0])
  pc.px(hx + 3, 15, MARUKO_TONES[NM.detail][0])
  pc.rect(hx - 1, 16, 2, 1, OUT)
  pc.rect(tx - 2, 29, 4, 1, MARUKO_TONES[NM.accent][2])
  return finishCompanion(pc, P, MARUKO_TONES[NM.body][0])
}

/** 皮卡丘：黑尖长耳、红脸颊、短爪胖身；闪电尾在身后完整露出。 */
function drawPikachuCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40), sil = new Sil(24, 40)
  const P = companionPose(pose, ROD_TIP_PIKACHU, 5)
  const tx = 10 + P.lean * 0.4, hx = Math.round(10 + P.lean * 0.6)
  // 后尾是折线多边形，不能用兔尾/狐尾式圆团替代。
  sil.tri(15, 32, 19, 29, 18, 34, NM.detail)
  sil.tri(18, 31, 22, 27, 20, 25, NM.body)
  sil.tri(18, 31, 18, 27, 20, 25, NM.body)
  sil.tri(18, 27, 22, 22, 22, 17, NM.body)
  sil.tri(18, 27, 19, 22, 22, 17, NM.body)
  for (const [x, side] of [[7, -1], [13, 1]]) {
    const fx = x + side * P.stance * 0.4
    sil.limb(x, 32, fx, 37, 1.9, 1.4, NM.body)
    sil.ellipse(fx - 0.7, 37.5, 3, 1.5, NM.body)
  }
  sil.ellipse(tx, 28, 5.6, 8.1, NM.body)
  sil.rect(tx + 3, 25, 2, 2, NM.detail)
  sil.rect(tx + 3, 30, 2, 2, NM.detail)
  addArm(sil, tx + 4.7, 25, P.handB, NM.body, NM.body)
  addArm(sil, tx - 4.7, 25, P.handF, NM.body, NM.body)
  sil.tri(hx - 5, 14, hx - 7, 2, hx - 1, 12, NM.body)
  sil.tri(hx - 6.2, 6, hx - 7, 2, hx - 4, 6, NM.dark)
  sil.tri(hx + 1, 12, hx + 6, 2, hx + 6, 14, NM.body)
  sil.tri(hx + 4, 6, hx + 6, 2, hx + 6, 7, NM.dark)
  sil.ellipse(hx, 17, 6.1, 5.6, NM.body)
  sil.ellipse(hx - 4.5, 19, 1.3, 1.6, NM.accent)
  sil.ellipse(hx + 4.5, 19, 1.3, 1.6, NM.accent)
  paintCompanion(pc, sil, PIKACHU_TONES)
  companionEyes(pc, hx, 16, pose === 'idle1', PIKACHU_TONES[NM.cream][1])
  pc.px(hx - 1, 19, OUT)
  pc.px(hx - 2, 21, OUT)
  pc.px(hx, 21, OUT)
  pc.px(hx - 1, 22, OUT)
  return finishCompanion(pc, P, PIKACHU_TONES[NM.body][0], 8, 5)
}

/** 流川枫：黑碎发、瘦长运动员体形，红色湘北无袖球衣和清楚的 11 号。 */
function drawRukawaCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40), sil = new Sil(24, 40)
  const P = companionPose(pose, ROD_TIP_RUKAWA)
  const tx = Math.round(11 + P.lean * 0.4), hx = Math.round(11 + P.lean * 0.7)
  for (const [x, side] of [[8, -1], [14, 1]]) {
    const fx = x + side * P.stance * 0.5
    sil.limb(x, 27, fx, 36, 1.5, 1.2, NM.body)
    sil.rect(fx - 1.3, 34.5, 2.7, 3, NM.cream)
    sil.ellipse(fx - 0.5, 38, 2.4, 1.1, NM.cream)
  }
  sil.rect(tx - 4, 25, 9, 5, NM.accent)
  sil.rect(tx - 4, 28, 9, 1, NM.cream)
  sil.ellipse(tx, 20, 4.3, 6.8, NM.accent)
  sil.rect(tx - 2, 12, 4, 4, NM.body)
  addArm(sil, tx + 4.1, 16.5, P.handB, NM.body, NM.body)
  addArm(sil, tx - 4.1, 16.5, P.handF, NM.body, NM.body)
  sil.ellipse(hx, 8.1, 4.7, 5.4, NM.body)
  sil.ellipse(hx, 4.3, 5.1, 3.1, NM.dark)
  sil.tri(hx - 5, 5, hx - 2, 1, hx - 1, 7, NM.dark)
  sil.tri(hx - 1, 5, hx + 1, 0.9, hx + 3, 6, NM.dark)
  sil.tri(hx + 1, 4, hx + 5, 2, hx + 4, 9, NM.dark)
  sil.tri(hx - 5, 5, hx - 1, 5, hx - 4, 9, NM.dark)
  sil.tri(hx - 1, 5, hx + 2, 5, hx, 10, NM.dark)
  paintCompanion(pc, sil, RUKAWA_TONES)
  // 冷淡的细长眼只占一行；不画下眼框，避免在小尺寸下读成眼镜。
  for (const x of [hx - 3, hx + 1]) {
    pc.rect(x, 10, 2, 1, OUT)
    if (pose !== 'idle1') pc.px(x, 10, RUKAWA_TONES[NM.cream][0])
  }
  pc.rect(hx - 4, 9, 2, 1, RUKAWA_TONES[NM.dark][0])
  pc.rect(hx + 1, 9, 2, 1, RUKAWA_TONES[NM.dark][0])
  pc.rect(hx - 1, 13, 2, 1, RUKAWA_TONES[NM.body][2])
  // V 领和袖口；11 号使用两个独立的 2×5 像素字，非纹理噪点。
  pc.px(tx - 2, 16, RUKAWA_TONES[NM.cream][0])
  pc.px(tx - 1, 17, RUKAWA_TONES[NM.cream][0])
  pc.px(tx, 18, RUKAWA_TONES[NM.cream][0])
  pc.px(tx + 1, 17, RUKAWA_TONES[NM.cream][0])
  pc.px(tx + 2, 16, RUKAWA_TONES[NM.cream][0])
  for (const x of [tx - 2, tx + 1]) {
    pc.rect(x, 21, 1, 5, RUKAWA_TONES[NM.cream][0])
    pc.px(x - 1, 22, RUKAWA_TONES[NM.cream][0])
    pc.rect(x - 1, 25, 3, 1, RUKAWA_TONES[NM.cream][0])
  }
  return finishCompanion(pc, P, RUKAWA_TONES[NM.body][0])
}

/** 哆啦A梦：无耳大圆头、白脸红鼻三道胡须，红项圈铃铛和半圆四维口袋。 */
function drawDoraemonCharacter(pose: PlayerPose): HTMLCanvasElement {
  const pc = new PixelCanvas(24, 40), sil = new Sil(24, 40)
  const P = companionPose(pose, ROD_TIP_DORAEMON, 8)
  const tx = 11 + P.lean * 0.4, hx = Math.round(11 + P.lean * 0.65)
  for (const [x, side] of [[7.5, -1], [14, 1]]) {
    const fx = x + side * P.stance * 0.3
    sil.limb(x, 32, fx, 37, 2.1, 1.9, NM.body)
    sil.ellipse(fx - 0.6, 37.7, 3.2, 1.4, NM.cream)
  }
  sil.ellipse(tx, 29.7, 6.6, 7.7, NM.body)
  sil.ellipse(tx - 0.6, 29.5, 4.6, 5.7, NM.cream)
  addArm(sil, tx + 5.7, 27, P.handB, NM.body, NM.cream)
  addArm(sil, tx - 5.7, 27, P.handF, NM.body, NM.cream)
  sil.ellipse(hx, 13, 8.6, 9.1, NM.body)
  sil.ellipse(hx - 0.8, 15.2, 7.2, 6.8, NM.cream)
  sil.ellipse(hx - 2.5, 9.6, 1.6, 3.0, NM.cream)
  sil.ellipse(hx + 0.7, 9.6, 1.6, 3.0, NM.cream)
  sil.ellipse(tx, 23.4, 6, 1.2, NM.accent)
  sil.ellipse(tx - 0.5, 25, 1.6, 1.6, NM.detail)
  paintCompanion(pc, sil, DORAEMON_TONES)
  // 并列的大椭圆眼框是哆啦A梦的辨识特征；眨眼只替换框内瞳孔。
  for (const eyeX of [hx - 2, hx + 1.5]) {
    pc.ellipse(eyeX, 9.5, 1.8, 3.2, OUT)
    pc.ellipse(eyeX, 9.5, 1.1, 2.5, DORAEMON_TONES[NM.cream][0])
  }
  companionEyes(pc, hx, 10, pose === 'idle1', DORAEMON_TONES[NM.cream][1])
  // 双眼间线、圆鼻、鼻下竖线和上弯微笑。
  pc.rect(hx, 7, 1, 3, OUT)
  pc.ellipse(hx - 1, 14, 1.8, 1.8, OUT)
  pc.ellipse(hx - 1, 14, 1.2, 1.2, DORAEMON_TONES[NM.accent][0])
  pc.px(hx - 1, 13, DORAEMON_TONES[NM.accent][1])
  pc.rect(hx - 1, 16, 1, 4, OUT)
  for (const [x, y] of [[-5, 18], [-4, 19], [-3, 20], [-2, 20], [-1, 20], [0, 20], [1, 20], [2, 19], [3, 18]]) pc.px(hx + x, y, OUT)
  for (const side of [-1, 1]) {
    const near = side === -1 ? -3 : 1
    const far = side === -1 ? -6 : 4
    pc.px(hx + far, 14, OUT); pc.px(hx + far - side, 15, OUT); pc.px(hx + near, 15, OUT)
    pc.rect(hx + (side === -1 ? -6 : 2), 17, 3, 1, OUT)
    pc.px(hx + far, 20, OUT); pc.px(hx + far - side, 19, OUT); pc.px(hx + near, 19, OUT)
  }
  const px = Math.round(tx - 1)
  pc.rect(px - 3, 29, 7, 1, OUT)
  pc.px(px - 3, 30, OUT); pc.px(px + 3, 30, OUT)
  pc.px(px - 2, 31, OUT); pc.px(px + 2, 31, OUT)
  pc.rect(px - 1, 32, 3, 1, OUT)
  pc.rect(px, 25, 2, 1, DORAEMON_TONES[NM.detail][2])
  pc.px(px, 26, OUT)
  return finishCompanion(pc, P, DORAEMON_TONES[NM.cream][0])
}

/* =========================================================================
 *  道具 / 鱼 / UI 图标
 * ========================================================================= */

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

/** 水平朝向鱼身（头朝右），带 1px 暗描边 + 体积受光 + 物种识别特征 */
function drawFishBody(
  body: FishBodyShape,
  c1: string,
  c2: string,
  feat: FishFeature = 'none',
  legendary = false
): PixelCanvas {
  const wide = feat === 'whiskers' || feat === 'duckBill'
  const W = wide ? 14 : 12
  const H = 8
  const sil = new Sil(W, H)
  const M = { body: 1, fin: 2, belly: 3 } as const
  const finC = legendary ? '#4ea8b8' : c2
  const tones: Record<number, Tone> = {
    [M.body]: tone(c1, 0.24, 0.2),
    [M.fin]: tone(finC, 0.2, 0.2),
    [M.belly]: tone(mixHex(c1, '#ffffff', 0.4), 0.14, 0.12)
  }
  const cx = wide ? 7.6 : 6.2

  // —— 体型 ——
  switch (body) {
    case 'spindle':
      sil.ellipse(cx, 4, 4.2, 2.4, M.body)
      break
    case 'long':
      sil.ellipse(cx, 4, 4.2, 1.9, M.body)
      break
    case 'round':
      sil.ellipse(cx, 4, 3.3, 2.7, M.body)
      break
    case 'flat':
      sil.ellipse(cx, 4, 3.2, 2.9, M.body)
      break
  }

  // —— 尾鳍 ——
  const tailX = cx - (body === 'round' || body === 'flat' ? 3.2 : 4.1)
  if (feat === 'forkTail') {
    sil.tri(tailX + 0.4, 4, tailX - 1.6, 0.8, tailX + 0.6, 2.4, M.fin)
    sil.tri(tailX + 0.4, 4, tailX - 1.6, 7.2, tailX + 0.6, 5.6, M.fin)
  } else {
    sil.tri(tailX + 0.5, 4, tailX - 1.6, 1.4, tailX - 1.6, 6.6, M.fin)
  }

  // —— 背鳍 ——
  sil.tri(cx - 1.8, 1.7, cx + 1.2, 1.7, cx - 0.6, 0.2, M.fin)

  // —— 腹部 ——
  sil.ellipse(cx - 0.4, 5.4, 2.8, 0.8, M.belly)

  // —— 识别性特征 ——
  if (feat === 'duckBill') {
    sil.ellipse(cx + 3.6, 3.9, 1.9, 0.85, M.body)
  }
  if (feat === 'tentacles') {
    for (let i = 0; i < 4; i++) {
      const txx = cx - 2.2 + i * 1.5
      sil.limb(txx, 6.0, txx - 0.4, 7.2, 0.55, 0.45, M.fin)
    }
  }
  if (feat === 'spikes') {
    for (const [sx, sy] of [[cx, 0.3], [cx - 2.4, 1.2], [cx + 2.4, 1.2], [cx - 3.2, 4], [cx + 3.2, 4]] as Array<[number, number]>) {
      sil.tri(sx - 0.5, sy + 0.7, sx + 0.5, sy + 0.7, sx, sy, M.fin)
    }
  }

  const pc = new PixelCanvas(W, H)
  paintSil(pc, sil, tones, { rim: 1.05, edgeMix: 0.3 })

  // —— 眼睛 / 嘴 / 纹样（直接落笔，保持锐利）——
  const hx = cx + (wide ? 2.6 : 1.9)
  if (feat === 'bigEye') {
    pc.ellipse(hx, 3.2, 1.5, 1.5, OUT)
    pc.ellipse(hx, 3.2, 1.0, 1.0, '#f8f8f0')
    pc.px(hx, 3.2, INK)
  } else {
    pc.px(hx, 3, INK)
    pc.px(hx + 0.4, 3.4, INK)
  }
  if (feat === 'bigMouth') {
    pc.rect(Math.round(hx - 2.6), 4, 4, 1, INK)
  }
  if (feat === 'whiskers') {
    pc.px(hx - 0.4, 5.2, INK)
    pc.px(hx - 1.4, 6.0, INK)
    pc.px(hx + 0.6, 5.6, INK)
  }
  if (feat === 'duckBill') {
    pc.rect(Math.round(cx + 3.4), 4, 2, 1, INK)
  }
  if (feat === 'segments') {
    for (let i = 0; i < 3; i++) {
      pc.rect(Math.round(cx - 3.2), 2 + i * 2, 6, 1, mixHex(c1, '#000000', 0.42))
    }
  }
  if (legendary) {
    pc.rect(Math.round(cx - 3), 5, 6, 1, '#f0a030')
    pc.triangle(cx - 2, 1, cx, 1, cx - 1, -0.4, '#f0a030')
  }
  return pc
}

/** 顺时针旋转 90°：水平鱼身（头朝右）-> 头朝上(cw=false) / 头朝下(cw=true) */
function rotate90(src: PixelCanvas, cw: boolean): PixelCanvas {
  const out = new PixelCanvas(src.h, src.w)
  // getPx 只返回 RGB；必须连同 alpha 一起旋转，否则透明区域会变成黑色矩形。
  const rgba = src.bake().getContext('2d')!.getImageData(0, 0, src.w, src.h).data
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const nx = cw ? src.h - 1 - y : y
      const ny = cw ? x : src.w - 1 - x
      const alpha = rgba[(y * src.w + x) * 4 + 3] / 255
      out.px(nx, ny, src.getPx(x, y), alpha)
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

/** 开启的宝箱：盖向后仰、箱内金光（结算 TREASURE 行） */
function drawOpenChest(): HTMLCanvasElement {
  const pc = new PixelCanvas(14, 11)
  // 箱体
  pc.rect(0, 6, 14, 5, PAL.chest)
  pc.rect(0, 6, 14, 1, PAL.chestDark)
  // 后仰的盖
  pc.rect(1, 3, 12, 3, PAL.chestDark)
  pc.rect(1, 3, 12, 1, '#9c6d40')
  // 箱内金光
  pc.rect(2, 5, 10, 2, '#f4d85a')
  pc.px(3, 5, '#fff0b8')
  pc.px(9, 5, '#fff0b8')
  // 金箍 + 锁
  pc.rect(5, 3, 2, 8, PAL.chestGold)
  pc.rect(6, 7, 2, 3, '#f0d060')
  pc.px(7, 8, '#8a6a10')
  // 描边
  pc.strokeRect(0, 3, 14, 8, '#2a1c0c')
  return pc.bake()
}

/** 金币图标（售价行）：暗描边圆 + 金面 + 高光 */
function drawCoin(): HTMLCanvasElement {
  const pc = new PixelCanvas(9, 9)
  pc.ellipse(4, 4, 4.2, 4.2, '#8a6a10')
  pc.ellipse(4, 4, 3.4, 3.4, '#e8c53a')
  pc.ellipse(4, 4, 2.4, 2.4, '#f4d85a')
  pc.px(3, 3, '#fff0b8')
  pc.rect(3, 6, 3, 1, '#c89a20')
  return pc.bake()
}

/** 未发现鱼类的「鱼影？」图标（图鉴锁定卡）：深色鱼剪影 + 白色问号 */
function drawFishQuest(): HTMLCanvasElement {
  const pc = new PixelCanvas(12, 8)
  // 深色鱼剪影（头朝右）
  pc.ellipse(6, 4, 4.6, 2.4, '#3a4a55')
  pc.triangle(1, 4, 4, 2, 4, 6, '#3a4a55')
  pc.px(10, 3, '#dfe8f0')
  // 问号（3×5 像素字）
  const q = [
    [1, 1, 1],
    [0, 0, 1],
    [0, 1, 0],
    [0, 0, 0],
    [0, 1, 0]
  ]
  q.forEach((row, j) => row.forEach((v, i) => {
    if (v) pc.px(5 + i, 2 + j, '#e8f6f9')
  }))
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

/** 钓鱼竿图鉴图标：按竿 id 分型绘制（竹竿绑带/纤维卷线器/秘银星闪/传奇金宝石），用于图鉴卡片 */
export function buildRodIcon(color: string, id = ''): HTMLCanvasElement {
  const pc = new PixelCanvas(14, 14)
  const dark = mixHex(color, '#000000', 0.42)
  const light = mixHex(color, '#ffffff', 0.35)
  // 竿身（左下 -> 右上斜向，按竿主色着色）
  rodLine(pc, 1, 12, 12, 2, color)
  pc.px(12, 2, light)
  pc.px(11, 3, light)
  if (id === 'bamboo') {
    // 竹竿：两道竹节绑带 + 竿梢绳结，无卷线器
    pc.rect(4, 9, 3, 1, dark)
    pc.rect(7, 6, 3, 1, dark)
    pc.px(13, 1, '#8a6a30')
    pc.px(13, 0, '#8a6a30')
  } else if (id === 'legend') {
    // 传说之竿：金握把 + 红宝石 + 雕花卷线器
    pc.rect(0, 11, 3, 3, '#8a5c2e')
    pc.rect(0, 11, 3, 1, '#f4d85a')
    pc.px(1, 12, '#d64545') // 红宝石
    pc.px(2, 12, '#d64545')
    pc.rect(2, 8, 3, 3, '#e8c53a') // 金卷线器
    pc.px(3, 9, '#fff0b8')
    pc.px(4, 8, '#f4d85a')
    pc.px(4, 10, '#c89a20')
  } else {
    // 纤维杆 / 秘银杆：银灰卷线器 + 深色握把
    pc.rect(2, 9, 3, 3, '#9aa3ad')
    pc.rect(3, 10, 1, 1, '#cfd6dd')
    pc.rect(0, 11, 3, 2, dark)
    if (id === 'iridium') {
      // 秘银星闪
      pc.px(10, 5, '#fff0b8')
      pc.px(9, 5, '#f4d85a')
      pc.px(11, 5, '#f4d85a')
      pc.px(10, 4, '#f4d85a')
      pc.px(10, 6, '#f4d85a')
    }
  }
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
      const horizontal = drawFishBody(def.body, def.color, def.color2, def.feat ?? 'none', !!def.legendary)
      fish[def.id] = [rotate90(horizontal, false).bake(), rotate90(horizontal, true).bake()]
    }
    return fish
  }

  /** 图鉴使用同一鱼身的水平原图，避免把小游戏竖向帧挤进 12×8 预览格。 */
  static buildFishIcon(def: FishDef): HTMLCanvasElement {
    return drawFishBody(def.body, def.color, def.color2, def.feat ?? 'none', !!def.legendary).bake()
  }

  static build(fishDefs: FishDef[], skin: CharacterSkin = 'farmer'): SpriteSet {
    const drawChar =
      skin === 'cat' ? drawCatCharacter :
      skin === 'frog' ? drawFrogCharacter :
      skin === 'penguin' ? drawPenguinCharacter :
      skin === 'wizard' ? drawWizardCharacter :
      skin === 'shinchan' ? drawShinchanCharacter :
      skin === 'maruko' ? drawMarukoCharacter :
      skin === 'pikachu' ? drawPikachuCharacter :
      skin === 'rukawa' ? drawRukawaCharacter :
      skin === 'doraemon' ? drawDoraemonCharacter :
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
      chestOpen: drawOpenChest(),
      crown: drawCrown(),
      exclaim: drawExclaim(),
      star: drawStar(),
      coin: drawCoin(),
      fishQuest: drawFishQuest(),
      rod: drawRod(),
      clouds: [drawCloud(11), drawCloud(29), drawCloud(47)]
    }
  }
}
