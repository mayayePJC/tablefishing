/**
 * 逐像素绘制工具：所有程序化精灵都在这里生成，
 * 生成后 bake() 冻结为可 drawImage 的离屏 canvas。
 */

const hexCache = new Map<string, [number, number, number]>()

/** '#rgb' / '#rrggbb' -> [r,g,b] */
export function hexToRgb(hex: string): [number, number, number] {
  const cached = hexCache.get(hex)
  if (cached) return cached
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  const rgb: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  hexCache.set(hex, rgb)
  return rgb
}

/** 线性插值两个 hex 颜色 */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const bl = Math.round(b1 + (b2 - b1) * t)
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`
}

export class PixelCanvas {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private data: Uint8ClampedArray

  constructor(
    readonly w: number,
    readonly h: number
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = w
    this.canvas.height = h
    this.ctx = this.canvas.getContext('2d')!
    this.data = this.ctx.createImageData(w, h).data
  }

  px(x: number, y: number, color: string, alpha = 1): void {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const [r, g, b] = hexToRgb(color)
    const i = (y * this.w + x) * 4
    this.data[i] = r
    this.data[i + 1] = g
    this.data[i + 2] = b
    this.data[i + 3] = Math.round(255 * alpha)
  }

  /** 读取某像素颜色（未 bake 时读 data，bake 后仍可用） */
  getPx(x: number, y: number): string {
    const i = (Math.round(y) * this.w + Math.round(x)) * 4
    const [r, g, b] = [this.data[i], this.data[i + 1], this.data[i + 2]]
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
  }

  fill(color: string, alpha = 1): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.px(x, y, color, alpha)
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color, alpha)
  }

  /** 空心矩形描边 */
  strokeRect(x: number, y: number, w: number, h: number, color: string): void {
    for (let i = 0; i < w; i++) {
      this.px(x + i, y, color)
      this.px(x + i, y + h - 1, color)
    }
    for (let j = 0; j < h; j++) {
      this.px(x, y + j, color)
      this.px(x + w - 1, y + j, color)
    }
  }

  /** 实心椭圆 */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: string, alpha = 1): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx
        const dy = (y - cy) / ry
        if (dx * dx + dy * dy <= 1) this.px(x, y, color, alpha)
      }
    }
  }

  /** 三角形（重心坐标法，实心） */
  triangle(
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    color: string
  ): void {
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
        const l3 = 1 - l1 - l2
        if (l1 >= 0 && l2 >= 0 && l3 >= 0) this.px(x, y, color)
      }
    }
  }

  /** 可播种噪点：以 prob 概率把像素换成 colors 中的随机一色 */
  noise(seed: number, prob: number, colors: string[]): void {
    let s = seed >>> 0
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 4294967296
    }
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (rand() < prob) this.px(x, y, colors[Math.floor(rand() * colors.length)])
      }
    }
  }

  /** 水平翻转（生成面向另一侧的精灵） */
  flipped(): PixelCanvas {
    const out = new PixelCanvas(this.w, this.h)
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        out.px(this.w - 1 - x, y, this.getPx(x, y))
      }
    }
    return out
  }

  /** 冻结 ImageData 到 canvas，返回可绘制对象 */
  bake(): HTMLCanvasElement {
    const img = this.ctx.createImageData(this.w, this.h)
    img.data.set(this.data)
    this.ctx.putImageData(img, 0, 0)
    return this.canvas
  }
}
