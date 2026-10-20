import { T } from '../../shared/constants'

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 玩家控制的绿色捕获条。
 * 按住 = 向上加速度；松开 = 重力下落；有限速制造惯性（易冲过头）；
 * 触底反弹（Lead Bobber 可关闭，v1 恒开）。
 */
export class CatchBar {
  /** 条顶端位置（轨道单位） */
  pos = 0
  vel = 0

  constructor(public size: number) {
    this.pos = (T.BAR_BOTTOM - this.size) / 2
  }

  update(dt: number, held: boolean): void {
    if (held) this.vel -= T.BAR_ACCEL_UP * dt
    else this.vel += T.BAR_GRAVITY * dt
    this.vel = clamp(this.vel, -T.BAR_SPEED_MAX, T.BAR_SPEED_MAX)
    this.pos += this.vel * dt

    const maxPos = T.BAR_BOTTOM - this.size
    if (this.pos > maxPos) {
      this.pos = maxPos
      this.vel = -T.BAR_BOUNCE
    }
    if (this.pos < 0) {
      this.pos = 0
      this.vel = 0
    }
  }

  /** 鱼中心是否在条内（含鱼半高容差） */
  contains(fishCenter: number, fishHalf: number): boolean {
    return fishCenter >= this.pos - fishHalf && fishCenter <= this.pos + this.size + fishHalf
  }
}
