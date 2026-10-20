import { T } from '../../shared/constants'
import type { FishingState } from '../FishingMachine'
import type { FishingContext } from '../FishingContext'
import type { FishDef } from '../../shared/types'

type Transition = (name: 'wait') => void

/** 抛竿飞行 -> 落水 -> 生成咬钩队列 -> 等待 */
export class CastState implements FishingState {
  readonly name = 'cast' as const
  private fired = false

  constructor(private transition: Transition) {}

  enter(): void {
    this.fired = false
  }

  /** 由控制器在浮标落水时调用 */
  onLanded(ctx: FishingContext): void {
    if (this.fired) return
    this.fired = true
    this.rollBite(ctx)
    this.transition('wait')
  }

  /** 生成本次咬钩对象：先判垃圾，再按权重选鱼 */
  private rollBite(ctx: FishingContext): void {
    let trashChance = Math.max(T.TRASH_MIN, T.TRASH_BASE - ctx.level * T.TRASH_LEVEL_FACTOR)
    // MAX 抛竿：垃圾更少
    if (ctx.maxCast) trashChance *= T.MAX_CAST_TRASH_MULT
    if (ctx.forcedFishId) {
      const forced = ctx.fishPool.find((f) => f.id === ctx.forcedFishId)
      ctx.forcedFishId = null
      if (forced) {
        ctx.roll = { kind: 'fish', def: forced }
        ctx.biteTimerMs = ctx.rng.range(400, 900)
        return
      }
    }
    if (ctx.rng.chance(trashChance)) {
      ctx.roll = { kind: 'trash' }
    } else {
      // 等级越高，鱼池权重越向高难鱼倾斜（方向 A：高等级面对更多更难鱼）
      const levelTilt = (f: FishDef) => 1 + ctx.level * T.LEVEL_POOL_K * (f.difficulty / 110)
      const def = ctx.maxCast
        ? // MAX 抛竿：叠加稀有度提升（难度越高加成越大，鱼王约 ×3）
          ctx.rng.pick(ctx.fishPool, (f) => f.weight * levelTilt(f) * (1 + T.MAX_CAST_RARITY_BOOST * (f.difficulty / 110)))
        : ctx.rng.pick(ctx.fishPool, (f) => f.weight * levelTilt(f))
      ctx.roll = { kind: 'fish', def }
    }
    this.rollBiteTime(ctx)
  }

  /** 咬钩时间 0.6~30s（官方）；每级最大 -0.25s；钓鱼竿越好咬钩越快；持竿首次 -25% */
  private rollBiteTime(ctx: FishingContext): void {
    let min = T.BITE_MIN_MS * ctx.rod.biteMult
    let max = (T.BITE_MAX_MS - ctx.level * T.BITE_LEVEL_FACTOR * 1000) * ctx.rod.biteMult
    if (ctx.isFirstCast) {
      min *= T.FIRST_BITE_FACTOR
      max *= T.FIRST_BITE_FACTOR
    }
    ctx.isFirstCast = false
    max = Math.max(min + 200, max)
    ctx.biteTimerMs = ctx.rng.range(min, max)
  }
}
