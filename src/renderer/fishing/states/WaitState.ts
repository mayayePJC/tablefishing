import { T } from '../../shared/constants'
import type { FishingState } from '../FishingMachine'
import type { FishingContext } from '../FishingContext'

type Transition = (name: 'hook' | 'idle') => void

/** 等待咬钩：0.6~30s 随机；可提前收竿（空手作废） */
export class WaitState implements FishingState {
  readonly name = 'wait' as const

  constructor(private transition: Transition) {}

  update(ctx: FishingContext, dt: number): void {
    ctx.biteTimerMs -= dt * 1000
    if (ctx.biteTimerMs <= 0) {
      ctx.reactionLeftMs = T.REACTION_WINDOW_MS
      this.transition('hook')
    }
  }

  /** 过早点击 = 收竿，本次作废 */
  onPress(ctx: FishingContext): void {
    ctx.audio.reelIn()
    ctx.roll = null
    ctx.result = null
    this.transition('idle')
  }
}
