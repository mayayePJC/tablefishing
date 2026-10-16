import type { FishingState } from '../FishingMachine'
import type { FishingContext } from '../FishingContext'
import { computeCatchResult } from '../catchMath'

type Transition = (name: 'result' | 'idle') => void

/**
 * 小游戏核心：绿条物理 + 鱼 AI + 进度条 + 宝箱。
 * 进度满 = 捕获；空 = 逃脱。
 */
export class MinigameState implements FishingState {
  readonly name = 'minigame' as const

  constructor(private transition: Transition) {}

  update(ctx: FishingContext, dt: number): void {
    const fish = ctx.fish
    if (!fish) {
      this.transition('idle')
      return
    }

    // 1) 鱼 AI
    fish.update(dt)

    // 2) 绿条物理（按住上加速 / 松开重力）
    ctx.bar.update(dt, ctx.held)

    // 3) 覆盖判定
    const inBar = ctx.bar.contains(fish.pos, 4)
    const treasureCovers = ctx.treasure.visible && ctx.bar.contains(ctx.treasure.pos, 6)
    ctx.treasure.update(dt, treasureCovers)

    // 4) 完美判定：鱼从未离开绿条
    if (!inBar) {
      ctx.outMs += dt * 1000
      ctx.perfect = false
    }

    // 5) 进度条（流失速率随"本局有效难度"变化）
    ctx.progress.update(dt, inBar, fish.diff)
    ctx.audio.reelUpdate(ctx.progress.value)

    // 6) 胜负
    if (ctx.progress.full) {
      ctx.result = computeCatchResult(ctx)
      // 传说鱼用更隆重的捕获小调
      ctx.audio.fanfare(!!fish.def.legendary)
      if (ctx.result.treasure) ctx.audio.treasure()
      this.transition('result')
    } else if (ctx.progress.empty) {
      ctx.result = { kind: 'escaped' }
      ctx.audio.escape()
      this.transition('result')
    }
  }
}
