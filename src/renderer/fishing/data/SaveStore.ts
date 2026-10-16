import type { CatchResult, FishQuality, SaveData } from '../../shared/types'
import { levelFromXp } from './xpTable'

const KEY = 'fishing-codex-save-v1'

function defaultSave(): SaveData {
  return {
    version: 1,
    totalXp: 0,
    character: 'farmer',
    rods: { owned: ['bamboo'], equipped: 'bamboo' },
    stealth: false,
    autostart: false,
    collection: {},
    stats: { casts: 0, caught: 0, escaped: 0, trash: 0, perfect: 0, treasure: 0 }
  }
}

/** 本地存档：等级/经验/图鉴/统计（localStorage） */
export class SaveStore {
  data: SaveData

  constructor() {
    this.data = this.load()
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return defaultSave()
      const parsed = JSON.parse(raw) as SaveData
      if (parsed.version !== 1) return defaultSave()
      return { ...defaultSave(), ...parsed, stats: { ...defaultSave().stats, ...parsed.stats } }
    } catch {
      return defaultSave()
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data))
    } catch {
      /* 隐私模式等场景下静默失败 */
    }
  }

  get level(): number {
    return levelFromXp(this.data.totalXp)
  }

  noteCast(): void {
    this.data.stats.casts++
    this.save()
  }

  /** 应用一次钓鱼结果，返回升级数 */
  applyResult(r: CatchResult): number {
    const before = this.level
    const stats = this.data.stats

    if (r.kind === 'fish' && r.def) {
      stats.caught++
      if (r.perfect) stats.perfect++
      if (r.treasure) stats.treasure++
      this.data.totalXp += r.xp ?? 0
      const entry = this.data.collection[r.def.id] ?? { count: 0, bestSize: 0, bestQuality: 'normal' as FishQuality }
      entry.count++
      if ((r.size ?? 0) > entry.bestSize) entry.bestSize = r.size ?? 0
      if (qualityRank(r.quality ?? 'normal') > qualityRank(entry.bestQuality)) entry.bestQuality = r.quality ?? 'normal'
      this.data.collection[r.def.id] = entry
    } else if (r.kind === 'trash') {
      stats.trash++
      this.data.totalXp += r.xp ?? 3
    } else {
      stats.escaped++
    }

    this.save()
    return Math.max(0, this.level - before)
  }
}

function qualityRank(q: FishQuality): number {
  return q === 'iridium' ? 3 : q === 'gold' ? 2 : q === 'silver' ? 1 : 0
}
