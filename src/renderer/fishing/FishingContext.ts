import type { Rng } from '../core/Rng'
import type { AudioBus } from '../core/AudioBus'
import type { BiteRoll, CatchResult, FishDef } from '../shared/types'
import type { RodDef } from '../shared/rods'
import type { Fish } from './entities/Fish'
import type { CatchBar } from './entities/CatchBar'
import type { ProgressBar } from './entities/ProgressBar'
import type { Treasure } from './entities/Treasure'

/** 钓鱼状态机共享上下文 */
export interface FishingContext {
  rng: Rng
  audio: AudioBus
  /** 当前钓鱼等级（影响绿条尺寸/咬钩时间/品质） */
  level: number
  /** 当前装备的钓鱼竿（影响绿条/咬钩/宝箱/抛竿距离） */
  rod: RodDef
  /** 本逻辑步输入按住状态 */
  held: boolean
  /** 竿尖世界坐标（控制器每步刷新） */
  rodTip: [number, number]

  // 蓄力与落点
  castPower: number
  targetX: number
  targetY: number
  /** 落点距陆地（格，0~5，影响品质） */
  distanceTiles: number
  /** 本次是否 MAX 抛竿（满力度）：影响抽鱼权重/垃圾率/宝箱率，结算展示徽章 */
  maxCast: boolean

  // 咬钩
  roll: BiteRoll | null
  biteTimerMs: number
  reactionLeftMs: number
  /** 持竿后第一次咬钩（官方：咬钩时间 -25%） */
  isFirstCast: boolean

  // 小游戏实体
  fish: Fish | null
  bar: CatchBar
  progress: ProgressBar
  treasure: Treasure
  /** 鱼出条累计 ms（尺寸收缩） */
  outMs: number
  perfect: boolean

  // 结果
  result: CatchResult | null

  /** 沙盒调试：强制下一条咬钩的鱼 */
  forcedFishId: string | null

  /** 结算回调（存档/图鉴在这里应用） */
  onResult: (r: CatchResult) => void

  /** 当前钓点鱼池 */
  fishPool: FishDef[]
}
