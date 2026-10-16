import type { FishingContext } from './FishingContext'
import type { CatchResult, FishQuality } from '../shared/types'
import { QUALITY_XP_INDEX } from './data/xpTable'

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function upgrade(q: FishQuality): FishQuality {
  switch (q) {
    case 'normal':
      return 'silver'
    case 'silver':
      return 'gold'
    default:
      return 'iridium'
  }
}

/**
 * 捕获结算（官方公式）：
 * fishSize = clamp01(距离/5 × (级+2)/10 × rand(90,110)/100)
 * 品质：<0.33 普通 / <0.66 银 / ≥0.66 金
 * 尺寸：min + (max-min)×fishSize + 1，收杆每 0.8s 出条 -1 寸
 * 品质提升：先 Quality Bobber（v1 无）后 Perfect（初始须≥银）
 * 经验：(品质+1)×3 + floor(难度/3)，依次 ×2.2 宝箱 ×2.4 完美 ×5 传说，每步截断
 */
export function computeCatchResult(ctx: FishingContext): CatchResult {
  const roll = ctx.roll
  if (!roll || roll.kind !== 'fish') {
    return { kind: 'escaped' }
  }
  const def = roll.def
  const distance = clamp01(ctx.distanceTiles / 5)
  const sizeFactor = clamp01(distance * ((ctx.level + 2) / 10) * (ctx.rng.range(90, 110) / 100))

  let quality: FishQuality = sizeFactor < 0.33 ? 'normal' : sizeFactor < 0.66 ? 'silver' : 'gold'
  let sizeIn = Math.floor(def.minSize + (def.maxSize - def.minSize) * sizeFactor + 1)

  // 收杆期间每 0.8s 出条 -1 寸（不低于 minSize）
  sizeIn = Math.max(def.minSize, sizeIn - Math.floor(ctx.outMs / 800))
  // 不完美且最终尺寸正好等于 maxSize，再 -1
  if (!ctx.perfect && sizeIn === def.maxSize) sizeIn -= 1

  // 完美捕获品质 +1（前提初始至少银色）
  if (ctx.perfect && quality !== 'normal') quality = upgrade(quality)

  let xp = (QUALITY_XP_INDEX[quality] + 1) * 3 + Math.floor(def.difficulty / 3)
  if (ctx.treasure.caught) xp = Math.floor(xp * 2.2)
  if (ctx.perfect) xp = Math.floor(xp * 2.4)
  if (def.legendary) xp = Math.floor(xp * 5)

  return {
    kind: 'fish',
    def,
    size: sizeIn,
    quality,
    perfect: ctx.perfect,
    treasure: ctx.treasure.caught,
    xp
  }
}
