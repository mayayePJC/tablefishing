import { T } from '../../shared/constants'
import type { FishingState } from '../FishingMachine'
import type { FishingContext } from '../FishingContext'

type Transition = (name: 'cast') => void

/** 蓄力：按住上涨，松开抛出（星露谷为单向涨满） */
export class ChargeState implements FishingState {
  readonly name = 'charge' as const

  constructor(private transition: Transition) {}

  enter(ctx: FishingContext): void {
    ctx.castPower = 0
    ctx.maxCast = false
  }

  update(ctx: FishingContext, dt: number): void {
    ctx.castPower = Math.min(1, ctx.castPower + dt / T.CHARGE_TIME)
    // 刚蓄满的瞬间：MAX 达成提示音（只触发一次）
    if (ctx.castPower >= T.MAX_CAST_THRESHOLD && !ctx.maxCast) {
      ctx.maxCast = true
      ctx.audio.maxCast()
    }
  }

  onRelease(ctx: FishingContext): void {
    const p = ctx.castPower
    ctx.maxCast = p >= T.MAX_CAST_THRESHOLD
    // 蓄力越满 → 落点越往左(CAST_X_MIN)且略高(CAST_Y_MIN) = 越远；
    // 不蓄力 → 落点靠右偏低(CAST_X_MAX / CAST_Y_MAX) = 越近。
    // 钓鱼竿的 rangeMult 让好竿在相同蓄力下抛得更远（落点更左、线更长、品质更高）。
    const rp = Math.min(1, p * ctx.rod.rangeMult)
    ctx.targetX = T.CAST_X_MAX - (T.CAST_X_MAX - T.CAST_X_MIN) * rp
    ctx.targetY = T.CAST_Y_MAX - (T.CAST_Y_MAX - T.CAST_Y_MIN) * rp
    ctx.distanceTiles = rp * T.CAST_MAX_TILES
    this.transition('cast')
  }
}
