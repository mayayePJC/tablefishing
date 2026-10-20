import { T } from '../../shared/constants'
import type { FishBehavior, FishDef } from '../../shared/types'
import type { Rng } from '../../core/Rng'

const HALF = 4 // 鱼图标半高（12×8 旋转后 8×12）

/**
 * 行为 -> 变向间隔系数（抽稀/加密）
 * v2026-10-19 重调（plan/数值重调方案.md）：让「难度数值」成为挑战主轴而非行为类型——
 * dart 抬高(0.65→0.8) 不再白给，sinker/floater 压低(1.15→0.95) 不再过苛。
 */
const BEHAVIOR_INTERVAL: Record<FishBehavior, number> = {
  mixed: 1.0,
  smooth: 1.35,
  sinker: 0.95,
  floater: 0.95,
  dart: 0.8
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 小游戏中的鱼 AI。
 * - 物种难度(鱼表) 决定「基准」难度，归一化到 0~1 后映射到游速/变向幅度/变向频率，
 *   使低难鱼慢而稳、高难鱼快而狂，物种之间区分明显。
 * - 每局「心情」(mood) 随机浮动游速与活跃度（±），让同种鱼每次出场时易时难，
 *   不再总是同一个难度水平。
 */
export class Fish {
  /** 鱼图标中心位置（轨道单位，0 = 顶端） */
  pos: number
  vel = 0
  private target = 0
  private dartTimer = 0
  /** 本局有效难度：物种难度 × 轻微抖动(±15%)，作为进度流失速率与归一化基准 */
  readonly diff: number
  /** 每局"心情"：游速与活跃度随机浮动（±），让同种鱼时易时难 */
  readonly mood: number

  constructor(
    public readonly def: FishDef,
    private readonly rng: Rng,
    /** 当前钓鱼等级：抬高鱼的有效难度（方向 A：等级越高鱼越快越狂） */
    level = 0
  ) {
    this.pos = T.TRACK_H * rng.range(0.25, 0.75)
    this.mood = rng.range(T.FISH_MOOD_MIN, T.FISH_MOOD_MAX)
    const jitter = rng.range(0.85, 1.15)
    // 有效难度 = 物种难度 × 轻微抖动 × (1 + 等级 × 斜率)，上限 DIFF_MAX
    this.diff = clamp(def.difficulty * jitter * (1 + level * T.LEVEL_DIFF_K), T.DIFF_MIN, T.DIFF_MAX)
    this.pickTarget()
  }

  /** 难度归一化到 0~1（用于游速/幅度/频率映射） */
  private normT(): number {
    return clamp((this.diff - T.DIFF_MIN) / (T.DIFF_MAX - T.DIFF_MIN), 0, 1)
  }

  update(dt: number): void {
    const t = this.normT()
    // 1) 行为偏置加速度（官方：sinker 向下加速更快 / floater 向上加速更快）
    let bias = 0
    if (this.def.behavior === 'sinker') bias = T.SINKER_ACCEL
    if (this.def.behavior === 'floater') bias = -T.FLOATER_ACCEL

    // 2) 变向计时（活跃度 -> 频率）
    this.dartTimer -= dt * 1000
    if (this.dartTimer <= 0) this.pickTarget()

    // 3) 弹簧-阻尼追踪（弹簧硬度随归一化难度缩放：高难鱼响应 ~100ms，快于人类反应，
    //    能真正"晃掉"玩家；低难鱼保持 5.5 的稳。v2026-10-19 重调，plan/数值重调方案.md 第 5 节）
    const agility = 1 + 1.5 * t
    const accel = (this.target - this.pos) * T.FISH_SPRING_K * agility
    this.vel += (accel + bias - this.vel) * T.FISH_DAMPING * dt

    // 4) 限速（归一化难度 -> 鱼速，再乘心情冷热）
    const vmax = (T.FISH_SPEED_MIN + (T.FISH_SPEED_MAX - T.FISH_SPEED_MIN) * t) * this.mood
    this.vel = clamp(this.vel, -vmax, vmax)

    // 5) 位移与边界
    this.pos += this.vel * dt
    if (this.pos > T.TRACK_H - HALF) {
      this.pos = T.TRACK_H - HALF
      this.vel *= -0.3
    }
    if (this.pos < HALF) {
      this.pos = HALF
      this.vel *= -0.3
    }
  }

  private pickTarget(): void {
    const t = this.normT()
    // 间隔：低难鱼懒得动(CALM 长)、高难鱼不停变向(FRANTIC 短)；
    // 心情越高越活跃 -> 间隔越短（除以 mood）；行为系数再叠加，并带 ±30% 抖动
    const base = lerp(T.DART_INTERVAL_CALM, T.DART_INTERVAL_FRANTIC, t)
    this.dartTimer = (base * BEHAVIOR_INTERVAL[this.def.behavior] / this.mood) * this.rng.range(0.7, 1.3)

    // 幅度：低难鱼小幅、高难鱼大幅，再乘心情冷热
    let amp = lerp(T.DART_AMP_MIN, T.DART_AMP_MAX, t) * this.mood
    if (this.def.behavior === 'dart') amp *= 1 + (2 * this.diff) / 100
    if (this.def.behavior === 'smooth') amp *= 0.7

    const dir = this.rng.chance(0.5) ? -1 : 1
    this.target = clamp(this.pos + dir * amp * this.rng.next(), HALF, T.TRACK_H - HALF)
  }
}
