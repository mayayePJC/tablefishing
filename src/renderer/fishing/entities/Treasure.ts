import { T } from '../../shared/constants'
import type { Rng } from '../../core/Rng'

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 宝箱（官方：小游戏开始 1~3s 后、15% 概率出现，独立进度条）。
 * 绿条覆盖宝箱则填充其进度；鱼逃跑则宝箱一并丢失。
 */
export class Treasure {
  active = false
  /** 出现倒计时（ms），<=0 且已激活表示可见 */
  delayMs = 0
  pos = 0
  progress = 0
  caught = false

  private rng: Rng

  constructor(rng: Rng) {
    this.rng = rng
  }

  /** 小游戏开始时抽签（bonus = MAX 抛竿等额外加成） */
  maybeSpawn(bonus = 0): void {
    this.active = false
    this.caught = false
    this.progress = 0
    this.delayMs = 0
    if (this.rng.chance(T.TREASURE_CHANCE + bonus)) {
      this.active = true
      this.delayMs = this.rng.range(T.TREASURE_DELAY_MIN, T.TREASURE_DELAY_MAX)
    }
  }

  /** 是否已出现在轨道中 */
  get visible(): boolean {
    return this.active && !this.caught && this.delayMs <= 0
  }

  update(dt: number, barCovers: boolean): void {
    if (!this.active || this.caught) return
    if (this.delayMs > 0) {
      this.delayMs -= dt * 1000
      if (this.delayMs <= 0) {
        this.pos = this.rng.range(T.TRACK_H * 0.2, T.TRACK_H * 0.8)
      }
      return
    }
    this.progress += (barCovers ? T.TREASURE_GAIN : -T.TREASURE_DRAIN) * dt
    this.progress = clamp(this.progress, 0, 1)
    if (this.progress >= 1) this.caught = true
  }
}
