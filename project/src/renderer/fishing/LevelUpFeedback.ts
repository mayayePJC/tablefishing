import type { LevelUpViewState } from '../shared/types'

/** A single result starts one celebration; reading/rendering the scene never replays it. */
export class LevelUpFeedback {
  private active: LevelUpViewState | null = null

  trigger(gained: number, level: number): void {
    if (gained <= 0) return
    this.active = { gained, level, elapsed: 0, duration: 2.8 }
  }

  update(dt: number): void {
    if (!this.active) return
    this.active.elapsed += Math.max(0, dt)
    if (this.active.elapsed >= this.active.duration) this.active = null
  }

  snapshot(): LevelUpViewState | null {
    return this.active ? { ...this.active } : null
  }
}
