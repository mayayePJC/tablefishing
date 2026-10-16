import { T } from '../../shared/constants'

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 捕获进度条：鱼在绿条内上涨、条外下跌。
 * 下跌速率随难度上升（官方未公布公式，设计值 0.6+0.8×d/110）。
 */
export class ProgressBar {
  value: number = T.PROGRESS_INITIAL

  reset(): void {
    this.value = T.PROGRESS_INITIAL
  }

  update(dt: number, inBar: boolean, difficulty: number): void {
    if (inBar) {
      this.value += T.PROGRESS_GAIN * dt
    } else {
      this.value -= T.PROGRESS_DRAIN_BASE * (0.55 + (0.85 * difficulty) / 110) * dt
    }
    this.value = clamp(this.value, 0, 1)
  }

  get full(): boolean {
    return this.value >= 1
  }

  get empty(): boolean {
    return this.value <= 0
  }
}
