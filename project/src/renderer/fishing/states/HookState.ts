import { T, barSizeForLevel } from '../../shared/constants'
import type { FishingState } from '../FishingMachine'
import type { FishingContext } from '../FishingContext'
import { Fish } from '../entities/Fish'
import { CatchBar } from '../entities/CatchBar'

type Transition = (name: 'result' | 'minigame' | 'idle') => void

/**
 * 感叹号反应窗口（官方论坛：约半秒，v1 取 600ms 可调）。
 * 过早点击不会到这里（Wait 已拦截）；过晚 = 鱼逃走。
 */
export class HookState implements FishingState {
  readonly name = 'hook' as const

  constructor(private transition: Transition) {}

  enter(ctx: FishingContext): void {
    ctx.audio.plop()
  }

  update(ctx: FishingContext, dt: number): void {
    ctx.reactionLeftMs -= dt * 1000
    if (ctx.reactionLeftMs <= 0) {
      // 过晚：鱼逃走
      ctx.audio.escape()
      ctx.result = { kind: 'escaped' }
      this.transition('result')
    }
  }

  onPress(ctx: FishingContext): void {
    const roll = ctx.roll
    if (!roll) {
      this.transition('idle')
      return
    }
    if (roll.kind === 'trash') {
      // 1.5+ 行为：垃圾不触发小游戏，直接拉起，固定 3 XP
      ctx.result = { kind: 'trash', xp: 3 }
      ctx.audio.reelIn()
      this.transition('result')
      return
    }
    // 进入小游戏：构造鱼与绿条（绿条随等级小幅增大 + 鱼竿加成，封顶；鱼难度随等级上升）
    const barSize = barSizeForLevel(ctx.level, ctx.rod.barBonus)
    ctx.fish = new Fish(roll.def, ctx.rng, ctx.level)
    ctx.bar = new CatchBar(barSize)
    // 开局让鱼正好落在绿条中心：避免"鱼一上来就在绿条外、进度瞬间狂掉"
    const barMax = T.BAR_BOTTOM - barSize
    ctx.bar.pos = Math.max(0, Math.min(barMax, ctx.fish.pos - barSize / 2))
    ctx.progress.reset()
    ctx.outMs = 0
    ctx.perfect = true
    const treasureBonus = (ctx.maxCast ? T.MAX_CAST_TREASURE_BONUS : 0) + ctx.rod.treasureBonus
    ctx.treasure.maybeSpawn(treasureBonus)
    ctx.audio.reelStart()
    this.transition('minigame')
  }
}
