import type { CatchResult, CharacterSkin, FishQuality, SaveData } from '../../shared/types'
import { CHARACTER_LIST } from '../../shared/characters'
import { levelFromXp } from './xpTable'

const KEY = 'fishing-codex-save-v1'
export const DEFAULT_WATER_REMINDER_MINUTES = 60
export const DEFAULT_SEDENTARY_REMINDER_MINUTES = 50
export const MIN_REMINDER_MINUTES = 1
export const MAX_REMINDER_MINUTES = 240
const LEGACY_CHARACTERS = new Map<string, CharacterSkin>([
  ['rabbit', 'shinchan'], ['fox', 'maruko'], ['panda', 'pikachu'],
  ['raccoon', 'rukawa'], ['robot', 'doraemon']
])

function normalizeCharacter(value: unknown): CharacterSkin {
  if (typeof value !== 'string') return 'farmer'
  const id = LEGACY_CHARACTERS.get(value) ?? value
  return CHARACTER_LIST.find((character) => character.id === id)?.id ?? 'farmer'
}

function defaultSave(): SaveData {
  return {
    version: 1,
    totalXp: 0,
    character: 'farmer',
    rods: { owned: ['bamboo'], equipped: 'bamboo' },
    stealth: false,
    autostart: false,
    waterReminderMinutes: DEFAULT_WATER_REMINDER_MINUTES,
    sedentaryReminderMinutes: DEFAULT_SEDENTARY_REMINDER_MINUTES,
    collection: {},
    stats: { casts: 0, caught: 0, escaped: 0, trash: 0, perfect: 0, treasure: 0 }
  }
}

/** Keep user-configured reminder intervals usable when reading old or edited saves. */
export function normalizeReminderMinutes(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(MAX_REMINDER_MINUTES, Math.max(MIN_REMINDER_MINUTES, n))
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
      const data: SaveData = {
        ...defaultSave(), ...parsed,
        character: normalizeCharacter(parsed.character),
        waterReminderMinutes: normalizeReminderMinutes(parsed.waterReminderMinutes, DEFAULT_WATER_REMINDER_MINUTES),
        sedentaryReminderMinutes: normalizeReminderMinutes(parsed.sedentaryReminderMinutes, DEFAULT_SEDENTARY_REMINDER_MINUTES),
        stats: { ...defaultSave().stats, ...parsed.stats }
      }
      // Removed melody selections must not silently turn into a different recording.
      // User-imported music, progress, collection and equipment remain intact.
      if (parsed.bgm != null && parsed.bgm !== 'forest-rain' && parsed.bgm !== 'airport') data.bgm = null
      if (
        data.character !== parsed.character ||
        data.bgm !== parsed.bgm ||
        data.waterReminderMinutes !== parsed.waterReminderMinutes ||
        data.sedentaryReminderMinutes !== parsed.sedentaryReminderMinutes
      ) {
        try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* still use the readable save */ }
      }
      return data
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
