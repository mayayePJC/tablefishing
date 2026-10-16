import type { FishDef } from '../../shared/types'

/**
 * v1 鱼表：覆盖 5 种行为与 15~110 难度带（数值来自 Stardew Valley Wiki Fish 页）。
 * weight 为生成权重；legendary 为稀有彩蛋。
 */
export const FISH_TABLE: FishDef[] = [
  { id: 'carp', name: '鲤鱼', nameEn: 'Carp', difficulty: 15, behavior: 'mixed', minSize: 15, maxSize: 51, color: '#8a9a4e', color2: '#c8b86e', body: 'spindle', weight: 14 },
  { id: 'herring', name: '鲱鱼', nameEn: 'Herring', difficulty: 25, behavior: 'dart', minSize: 8, maxSize: 21, color: '#9fb8cc', color2: '#dfe8f0', body: 'long', weight: 10 },
  { id: 'anchovy', name: '凤尾鱼', nameEn: 'Anchovy', difficulty: 30, behavior: 'dart', minSize: 1, maxSize: 17, color: '#7fa8c8', color2: '#c4dcec', body: 'long', weight: 10 },
  { id: 'sunfish', name: '太阳鱼', nameEn: 'Sunfish', difficulty: 30, behavior: 'mixed', minSize: 5, maxSize: 16, color: '#e8a83a', color2: '#f0d060', body: 'spindle', weight: 12 },
  { id: 'bream', name: '鲷鱼', nameEn: 'Bream', difficulty: 35, behavior: 'smooth', minSize: 12, maxSize: 31, color: '#a8b8a0', color2: '#d8e0d0', body: 'flat', weight: 10 },
  { id: 'sea_cucumber', name: '海参', nameEn: 'Sea Cucumber', difficulty: 40, behavior: 'sinker', minSize: 3, maxSize: 21, color: '#7a5a6e', color2: '#a88498', body: 'long', weight: 8 },
  { id: 'walleye', name: '大眼梭鲈', nameEn: 'Walleye', difficulty: 45, behavior: 'smooth', minSize: 10, maxSize: 41, color: '#8a7a4e', color2: '#c8b86e', body: 'spindle', weight: 8 },
  { id: 'largemouth_bass', name: '大口鲈', nameEn: 'Largemouth Bass', difficulty: 50, behavior: 'mixed', minSize: 11, maxSize: 31, color: '#5a8a4e', color2: '#a8c86e', body: 'spindle', weight: 9 },
  { id: 'pike', name: '狗鱼', nameEn: 'Pike', difficulty: 60, behavior: 'dart', minSize: 15, maxSize: 61, color: '#6a8a3a', color2: '#c8d86e', body: 'long', weight: 6 },
  { id: 'tuna', name: '金枪鱼', nameEn: 'Tuna', difficulty: 70, behavior: 'smooth', minSize: 12, maxSize: 61, color: '#3a6a9a', color2: '#9fc8e8', body: 'spindle', weight: 5 },
  { id: 'catfish', name: '鲶鱼', nameEn: 'Catfish', difficulty: 75, behavior: 'mixed', minSize: 12, maxSize: 73, color: '#7a6a52', color2: '#a89878', body: 'long', weight: 5 },
  { id: 'squid', name: '鱿鱼', nameEn: 'Squid', difficulty: 75, behavior: 'sinker', minSize: 12, maxSize: 49, color: '#d8a8b8', color2: '#f0d0dc', body: 'long', weight: 5 },
  { id: 'pufferfish', name: '河豚', nameEn: 'Pufferfish', difficulty: 80, behavior: 'floater', minSize: 1, maxSize: 37, color: '#e8c53a', color2: '#f8e890', body: 'round', weight: 4 },
  { id: 'octopus', name: '章鱼', nameEn: 'Octopus', difficulty: 95, behavior: 'sinker', minSize: 12, maxSize: 49, color: '#a85a6e', color2: '#d88a9e', body: 'round', weight: 3 },
  { id: 'legend', name: '鱼王', nameEn: 'Legend', difficulty: 110, behavior: 'mixed', minSize: 49, maxSize: 51, color: '#d6452e', color2: '#f0a030', body: 'spindle', legendary: true, weight: 0.4 }
]

export const FISH_BY_ID: Record<string, FishDef> = Object.fromEntries(FISH_TABLE.map((f) => [f.id, f]))

/** 垃圾图标索引 */
export const TRASH_NAMES = ['湿报纸', '海草', '破靴']
