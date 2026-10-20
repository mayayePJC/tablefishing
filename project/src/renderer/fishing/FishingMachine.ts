import type { FishingContext } from './FishingContext'

export type FishingStateName = 'idle' | 'charge' | 'cast' | 'wait' | 'hook' | 'minigame' | 'result'

export interface FishingState {
  readonly name: FishingStateName
  enter?(ctx: FishingContext): void
  exit?(ctx: FishingContext): void
  update?(ctx: FishingContext, dt: number): void
  onPress?(ctx: FishingContext): void
  onRelease?(ctx: FishingContext): void
}

/** 钓鱼状态机宿主 */
export class FishingMachine {
  private states: Record<FishingStateName, FishingState>
  private current: FishingState

  constructor(
    private ctx: FishingContext,
    states: Record<FishingStateName, FishingState>
  ) {
    this.states = states
    this.current = states.idle
    this.current.enter?.(ctx)
  }

  get name(): FishingStateName {
    return this.current.name
  }

  transition(name: FishingStateName): void {
    if (this.current.name === name) return
    this.current.exit?.(this.ctx)
    this.current = this.states[name]
    this.current.enter?.(this.ctx)
  }

  update(dt: number): void {
    this.current.update?.(this.ctx, dt)
  }

  onPress(): void {
    this.current.onPress?.(this.ctx)
  }

  onRelease(): void {
    this.current.onRelease?.(this.ctx)
  }
}
