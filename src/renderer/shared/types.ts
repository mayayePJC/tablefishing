/** 鱼的小游戏行为类型（官方 Fish.xnb 第 2 字段） */
export type FishBehavior = 'mixed' | 'dart' | 'smooth' | 'sinker' | 'floater'

/** 鱼类品质 */
export type FishQuality = 'normal' | 'silver' | 'gold' | 'iridium'

/** 鱼的身形（决定图标轮廓） */
export type FishBodyShape = 'spindle' | 'long' | 'round' | 'flat'

export interface FishDef {
  id: string
  /** 中文名（展示用） */
  name: string
  nameEn: string
  /** 难度 15~110：官方说明 = 小游戏中突然变向的频率 */
  difficulty: number
  behavior: FishBehavior
  /** 尺寸区间（英寸） */
  minSize: number
  maxSize: number
  /** 图标配色 */
  color: string
  color2: string
  body: FishBodyShape
  /** 传说鱼：稀有彩蛋 + 王冠图标 + 经验 ×5 */
  legendary?: boolean
  /** 生成权重（越大越常见） */
  weight: number
}

/** 咬钩判定结果 */
export type BiteRoll =
  | { kind: 'fish'; def: FishDef }
  | { kind: 'trash' }

/** 一次钓鱼的最终结算 */
export interface CatchResult {
  kind: 'fish' | 'trash' | 'escaped'
  def?: FishDef
  /** 英寸 */
  size?: number
  quality?: FishQuality
  perfect?: boolean
  treasure?: boolean
  xp?: number
  /** 是否升级 */
  leveledUp?: number
  /** 本次结算顺带解锁的钓鱼竿 id（用于提示「新竿解锁」） */
  unlockedRod?: string
}

/** 可选人物形象：farmer/cat 为初始形象，frog/penguin/wizard 为新增 trio */
export type CharacterSkin = 'farmer' | 'cat' | 'frog' | 'penguin' | 'wizard'

/** 钓鱼竿持有与装备状态 */
export interface RodSave {
  /** 已拥有的竿 id 列表（含已解锁但未装备的） */
  owned: string[]
  /** 当前装备的竿 id */
  equipped: string
}

/** 存档结构 */
export interface SaveData {
  version: 1
  /** 累计总经验 */
  totalXp: number
  /** 当前人物形象：farmer = 星露农夫，cat = 猫将，frog/penguin/wizard = 新增 trio */
  character?: CharacterSkin
  /** 钓鱼竿持有/装备状态 */
  rods?: RodSave
  /** 隐身模式：隐藏人物与 lev 徽章，仅保留工具按钮 */
  stealth?: boolean
  /** 开机自动启动 */
  autostart?: boolean
  /** 图鉴：fishId -> { 钓到次数, 最佳尺寸, 最佳品质 } */
  collection: Record<string, { count: number; bestSize: number; bestQuality: FishQuality }>
  stats: {
    casts: number
    caught: number
    escaped: number
    trash: number
    perfect: number
    treasure: number
  }
}

// ---------- 视图层状态（Game 组装后交给 Renderer） ----------

export interface MinigameViewState {
  /** 鱼位置（轨道单位 0..TRACK_H） */
  fishPos: number
  fishVel: number
  /** 当前鱼图标（朝上/朝下） */
  fishIcon: HTMLCanvasElement
  /** 绿条位置与高度（轨道单位） */
  barPos: number
  barSize: number
  /** 捕获进度 0~1 */
  progress: number
  treasure: { pos: number; progress: number } | null
  legendary: boolean
}

export interface ResultViewState {
  kind: 'fish' | 'trash' | 'escaped'
  fishName?: string
  fishIcon?: HTMLCanvasElement
  trashIcon?: HTMLCanvasElement
  size?: number
  quality?: FishQuality
  perfect?: boolean
  treasure?: boolean
  /** 本次是否 MAX 抛竿（满力度抛出，好鱼概率更高） */
  maxCast?: boolean
  xp?: number
  leveledUp?: number
  /** 本次结算顺带解锁的钓鱼竿名（用于提示「新竿解锁」） */
  unlockedRod?: string
}

export interface HudState {
  level: number
  xp: number
  xpNeeded: number
  xpPct: number
  /** 底部提示文字 */
  hint: string
  /** 蓄力条 0..1（-1 = 隐藏） */
  charge: number
  exclaim: boolean
  exclaimX: number
  exclaimY: number
  casts: number
  caught: number
}

export interface SceneState {
  time: number
  /** 玩家姿态帧索引：idle 用 time 动画，cast 0..2 由控制器给 */
  playerPose: 'idle' | 'cast' | 'reel' | 'show'
  playerFrame: number
  playerX: number
  playerFootY: number
  /** 浮标（世界坐标；null = 不可见） */
  bobber: { x: number; y: number; shake: number } | null
  /** 落水水花（世界坐标 + 帧） */
  splash: { x: number; y: number; frame: number } | null
  /** 是否画钓线（竿尖 -> 浮标） */
  lineVisible: boolean
  minigame: MinigameViewState | null
  result: ResultViewState | null
  hud: HudState
}
