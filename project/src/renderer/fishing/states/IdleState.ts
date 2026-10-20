import type { FishingState } from '../FishingMachine'
import type { FishingContext } from '../FishingContext'

type Transition = (name: 'charge') => void

/** 待机：持竿站在栈桥上，等待抛竿 */
export class IdleState implements FishingState {
  readonly name = 'idle' as const

  constructor(private transition: Transition) {}

  enter(ctx: FishingContext): void {
    ctx.result = null
    ctx.castPower = 0
  }

  onPress(): void {
    this.transition('charge')
  }
}
