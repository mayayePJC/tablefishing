/**
 * 经验与等级（Stardew Valley Wiki Fishing 页）。
 * XP_LEVELS[i] = 达到 i+1 级所需的累计总经验。
 * 经验公式：(品质+1)×3 + floor(难度/3)，依次 ×2.2(宝箱) ×2.4(完美) ×5(传说)，每步截断取整。
 */
export const XP_LEVELS = [100, 380, 750, 1280, 1750, 2250, 2750, 3250, 3750, 4750]

export const MAX_LEVEL = 10

/** 品质 -> 经验公式用的索引（官方：普通0/银1/金2/铱4） */
export const QUALITY_XP_INDEX: Record<string, number> = {
  normal: 0,
  silver: 1,
  gold: 2,
  iridium: 4
}

export function levelFromXp(totalXp: number): number {
  let level = 0
  for (let i = 0; i < XP_LEVELS.length; i++) {
    if (totalXp >= XP_LEVELS[i]) level = i + 1
  }
  return level
}

/** 当前等级内的经验进度：返回 [本级累计, 下一级所需, 0~1] */
export function xpProgress(totalXp: number, level: number): [number, number, number] {
  const base = level <= 0 ? 0 : XP_LEVELS[level - 1]
  const next = level >= MAX_LEVEL ? XP_LEVELS[MAX_LEVEL - 1] : XP_LEVELS[level]
  const span = next - base
  const cur = totalXp - base
  const pct = span <= 0 ? 1 : Math.min(1, Math.max(0, cur / span))
  return [cur, span, pct]
}
