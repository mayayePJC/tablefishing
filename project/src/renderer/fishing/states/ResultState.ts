import type { FishingState } from '../FishingMachine'
import type { FishingContext } from '../FishingContext'

type Transition = (name: 'idle') => void

/** 结果展示：收杆动画 + 结算弹窗，就绪后点击回到待机 */
export class ResultState implements FishingState {
  readonly name = 'result' as const
  private timer = 0
  private ready = false

  constructor(private transition: Transition) {}

  enter(ctx: FishingContext): void {
    this.timer = 0.9
    this.ready = false
    // 统一结算入口：所有结果（鱼/垃圾/逃脱）都经由此处应用到存档
    if (ctx.result) ctx.onResult(ctx.result)
  }

  update(_ctx: FishingContext, dt: number): void {
    this.timer -= dt
    if (this.timer <= 0) this.ready = true
  }

  onPress(ctx: FishingContext): void {
    if (!this.ready) return
    ctx.audio.uiClick()
    ctx.result = null
    ctx.fish = null
    this.transition('idle')
  }
}
