/**
 * 全局可调参数（手感调参集中地）。
 * 标注「官方」的数值来自 Stardew Valley Wiki，不要随意改动；
 * 未标注的为社区参考值 + 设计校准值。
 *
 * ★ 调参基线（2026-10-15 起）：
 *   捕获条灵活（绿条手感见下方 BAR_*）；鱼的难度由「物种难度(鱼表) × 每局心情浮动」共同决定。
 *   - 物种难度区分明显：低难鱼慢而稳、高难鱼快而狂（见下方 FISH_* / DART_* 归一化映射）。
 *   - 每局「心情」(FISH_MOOD_*) 让同种鱼时易时难，不再一成不变、也不总是高难。
 *   改难度请另开档，不要原地覆盖这组默认值（Defaults 快照仍在代码中，必要时可重置）。
 */
export const T = {
  // ---------- 桌宠窗口（透明、可拖拽） ----------
  VIEW_W: 340,
  VIEW_H: 390,
  /** 垂钓者精灵原生素材尺寸（像素）：星露谷默认农夫，站立人形，面朝左 */
  PLAYER_W: 24,
  PLAYER_H: 40,
  /** 垂钓者在桌面上的显示缩放（紧凑化下调） */
  PLAYER_SCALE: 2.6,

  // ---------- 桌宠布局：人在右侧、左侧抛竿，无池塘（透明桌面上直接垂钓） ----------
  /** 玩家（垂钓者）站位：窗口右侧 */
  PLAYER_X: 238,
  PLAYER_FOOT_Y: 342,
  /** 抛竿落点范围（左下；蓄力越满越往左/越高 = 越远，靠 X 跨度体现远近） */
  CAST_X_MIN: 72,
  CAST_X_MAX: 165,
  CAST_Y_MIN: 312,
  CAST_Y_MAX: 332,
  /** 右下角工具按钮（汉堡菜单，点击弹出 设置/音效/退出） */
  TOOLS_BTN: { x: 318, y: 368, r: 12, hitHalf: 16 },

  // ---------- 小游戏轨道（官方锚点） ----------
  /** 官方：轨道总高 568px */
  TRACK_H: 568,
  /** 绿条底部边界 = 轨道总高（与鱼的活动范围一致，确保沉到底也能覆盖鱼） */
  BAR_BOTTOM: 568,
  /** 星露谷手感：绿条很灵活——按住快速上升、松开很快沉底，考验鼠标操控 */
  BAR_ACCEL_UP: 1300,
  BAR_GRAVITY: 900,
  BAR_SPEED_MAX: 300,
  BAR_BOUNCE: 30,
  /**
   * 绿条"逻辑尺寸"（轨道单位，0~568）。渲染时再乘 scale(=BAR_H/TRACK_H≈0.194)。
   * v2026-10-19 重调（plan/数值重调方案.md）：旧值 200 → 渲染 ~39px 远大于鱼图标，
   * 导致"打不输"（无头模拟全表 100%）。降到 120 → 渲染 ~23px，
   * 与缩小后的鱼图标(24px, PetView fishW/fishH)匹配：居中可盖住、移动时鱼会探出
   * 上下沿 = 产生真实挑战。等级/竿加成同步压缩，不再反杀难度缩放。
   */
  BAR_SIZE_BASE: 120,
  /** 每级绿条增量（轨道单位），Lv10 仅 +10（旧 2.5 会反向放大简单度） */
  BAR_SIZE_PER_LEVEL: 1.0,
  /** 绿条尺寸上限（轨道单位），任何情况下都不超过此值（含鱼竿加成） */
  BAR_SIZE_MAX: 165,

  // ---------- 鱼 AI（桌宠：绿条已调灵活，难度交给鱼——低难鱼慢而稳、高难鱼快而狂） ----------
  /** 难度归一化锚点（鱼表难度带约 10~110；上限 160 = 抬高天花板，让 Lv10 鱼王仍比 Lv0 难） */
  DIFF_MIN: 10,
  DIFF_MAX: 160,
  /** 鱼速范围（px/s）：归一化到难度带，低难鱼慢、高难鱼快，再乘心情浮动。
   * v2026-10-19 重调：DIFF_MAX 115→160 后高难鱼在 Lv0 偏慢（模拟人类可 100% 跟踪鱼王），
   * 按 plan/数值重调方案.md 第 5 节兜底把 MAX 158→215——低难鱼受 normT 保护几乎无感，高难鱼真正能跑出绿条。 */
  FISH_SPEED_MIN: 46,
  FISH_SPEED_MAX: 240,
  FISH_SPRING_K: 5.5,
  FISH_DAMPING: 5.5,
  /** 变向幅度范围（轨道单位）：低难鱼小幅、高难鱼大幅，再乘心情浮动 */
  DART_AMP_MIN: 70,
  DART_AMP_MAX: 185,
  /** 变向间隔锚点（ms）：低难鱼懒得动(CALM 长)、高难鱼不停变向(FRANTIC 短) */
  DART_INTERVAL_CALM: 720,
  DART_INTERVAL_FRANTIC: 150,
  /** 每局"心情"：游速与活跃度的随机浮动（±），让同种鱼时易时难，不再一成不变 */
  FISH_MOOD_MIN: 0.85,
  FISH_MOOD_MAX: 1.18,
  /** 官方：sinker 向下加速度更快 / floater 向上加速度更快（v2026-10-19 重调 52→30，压平贴墙） */
  SINKER_ACCEL: 30,
  FLOATER_ACCEL: 30,

  // ---------- 进度条（涨更快、流失更狠：单局 8-22s，普通鱼也不再稳钓） ----------
  PROGRESS_INITIAL: 0.28,
  PROGRESS_GAIN: 0.11,
  /** v2026-10-19 重调 0.18→0.20：抬高覆盖率门槛（鱼王需 ~72% 在条内才能净涨），
   * 按难度等比收紧——高难鱼流失系数最高、承受最多，低难鱼几乎无感（plan/数值重调方案.md 第 5 节方向） */
  PROGRESS_DRAIN_BASE: 0.2,

  // ---------- 宝箱（官方） ----------
  TREASURE_CHANCE: 0.15,
  TREASURE_DELAY_MIN: 1000,
  TREASURE_DELAY_MAX: 3000,
  TREASURE_GAIN: 0.8,
  TREASURE_DRAIN: 0.6,

  // ---------- 抛竿 / 咬钩 ----------
  /** 蓄力满所需秒数 */
  CHARGE_TIME: 1.0,
  /** 最大抛掷距离（格），换算 distanceFromLand 上限 5 */
  CAST_MAX_TILES: 5,
  /** 最大力度判定阈值：蓄力 >= 该值即算「MAX 抛竿」，抛得更远、好鱼概率更高 */
  MAX_CAST_THRESHOLD: 0.999,
  /** MAX 抛竿：鱼群权重按稀有度提升的斜率（权重 ×= 1 + 斜率 × 难度/110，鱼王约 ×3） */
  MAX_CAST_RARITY_BOOST: 2.2,
  /** MAX 抛竿：垃圾概率倍率（更少垃圾） */
  MAX_CAST_TRASH_MULT: 0.4,
  /** MAX 抛竿：宝箱概率加成（15% + 15% = 30%） */
  MAX_CAST_TREASURE_BONUS: 0.15,
  /** 桌宠节奏：咬钩 0.6~4s 随机（v2026-10-19 重调 0.7~8s→0.6~4s，压缩空等） */
  BITE_MIN_MS: 600,
  BITE_MAX_MS: 4000,
  /** 官方论坛：感叹号反应窗口约半秒 */
  REACTION_WINDOW_MS: 600,
  /** 首次咬钩时间 -25%（官方） */
  FIRST_BITE_FACTOR: 0.75,
  /** 每级最大咬钩时间 -0.25s（官方） */
  BITE_LEVEL_FACTOR: 0.25,

  // ---------- 成长 ----------
  /** 垃圾概率 v1 近似：基础 20%，每级 -1.5%，下限 5% */
  TRASH_BASE: 0.2,
  TRASH_LEVEL_FACTOR: 0.015,
  TRASH_MIN: 0.05,

  // ---------- 等级 → 难度（方向 A：绿条不变，鱼变难 + 高难鱼更易出现） ----------
  /** 鱼的难度随等级缩放斜率：effectiveDiff = 物种难度 × 抖动 × (1 + 等级 × 该值)，上限 DIFF_MAX。
   * v2026-10-19 重调 0.12→0.045：旧值下鱼王 Lv4 即撞 DIFF_MAX(160) 顶，Lv5+ 鱼王 AI 完全不变
   * （等级轴对鱼王失效）；0.045 使鱼王 Lv10 = 110×1.45 ≈ 159.5 恰好不封顶，全等级单调变难。 */
  LEVEL_DIFF_K: 0.045,
  /** 鱼池权重随等级向高难鱼倾斜的斜率：权重 ×= 1 + 等级 × 该值 × (难度/110) */
  LEVEL_POOL_K: 0.08
} as const

/** 计算某等级下的绿条尺寸（含鱼竿加成 rodBonus），封顶 BAR_SIZE_MAX */
export function barSizeForLevel(level: number, rodBonus = 0): number {
  return Math.min(T.BAR_SIZE_BASE + T.BAR_SIZE_PER_LEVEL * level + rodBonus, T.BAR_SIZE_MAX)
}

/** 可调参数键（数值型，集中管理手感参数） */
export const TUNABLE_KEYS = [
  'BAR_ACCEL_UP',
  'BAR_GRAVITY',
  'BAR_SPEED_MAX',
  'BAR_BOUNCE',
  'FISH_SPEED_MIN',
  'FISH_SPEED_MAX',
  'FISH_SPRING_K',
  'FISH_DAMPING',
  'DART_AMP_MIN',
  'DART_AMP_MAX',
  'DART_INTERVAL_CALM',
  'DART_INTERVAL_FRANTIC',
  'SINKER_ACCEL',
  'FLOATER_ACCEL',
  'PROGRESS_GAIN',
  'PROGRESS_DRAIN_BASE',
  'TREASURE_CHANCE',
  'REACTION_WINDOW_MS',
  'CHARGE_TIME',
  'TRASH_BASE',
  'MAX_CAST_RARITY_BOOST',
  'MAX_CAST_TRASH_MULT',
  'MAX_CAST_TREASURE_BONUS',
  'LEVEL_DIFF_K',
  'LEVEL_POOL_K'
] as const

export type TunableKey = (typeof TUNABLE_KEYS)[number]
