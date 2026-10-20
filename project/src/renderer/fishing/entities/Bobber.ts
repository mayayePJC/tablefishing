function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 世界坐标浮标：抛竿飞行（带弧线）→ 落水起伏 → 咬钩抖动。
 */
export class Bobber {
  x = 0
  y = 0
  private startX = 0
  private startY = 0
  private targetX = 0
  private targetY = 0
  private t = 0
  private duration = 0.5
  /** 飞行弧线高度（launch 时按距离计算） */
  private arcH = 70
  flying = false
  /** 咬钩抖动剩余时间（s） */
  shake = 0

  launch(sx: number, sy: number, tx: number, ty: number): void {
    this.startX = sx
    this.startY = sy
    this.targetX = tx
    this.targetY = ty
    this.x = sx
    this.y = sy
    this.t = 0
    this.flying = true
    // 弧线高度按飞行距离缩放：近抛（轻抛）弧线低，远抛（满力）弧线高，避免近抛飞出屏幕
    this.arcH = Math.min(70, Math.hypot(tx - sx, ty - sy) * 0.4)
  }

  update(dt: number, time: number): void {
    if (this.flying) {
      this.t += dt
      const k = Math.min(1, this.t / this.duration)
      this.x = lerp(this.startX, this.targetX, k)
      this.y = lerp(this.startY, this.targetY, k) - Math.sin(k * Math.PI) * this.arcH
      if (k >= 1) {
        this.flying = false
        this.x = this.targetX
        this.y = this.targetY
      }
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt)
    void time
  }

  /** 落水后浮动（渲染层叠加正弦，这里只标记 landed） */
  get landed(): boolean {
    return !this.flying
  }
}
