/**
 * 星露谷风调色板（从游戏截屏取色归纳）。
 * 原则：每精灵 16~32 色、硬边缘无抗锯齿、粗黑描边、轻噪点。
 */
export const PAL = {
  // 天空
  skyTop: '#5ea9d6',
  skyMid: '#8ecfe8',
  skyLow: '#c4e8f2',
  cloud: '#ffffff',
  cloudShade: '#d8ecf5',

  // 远岸
  sand: '#e3cf9e',
  sandShade: '#cbb37e',
  treeDark: '#2e6b34',
  treeMid: '#3f8a3f',
  treeLight: '#57a54b',

  // 水
  waterDeep: '#1d5c7a',
  waterMid: '#2a7fa3',
  waterLight: '#4aa8c4',
  waterFoam: '#e8f6f9',

  // 草地/泥土
  grass: '#5aa64b',
  grassDark: '#4c9440',
  grassLight: '#6fbf56',
  dirt: '#a8763e',
  dirtDark: '#8a5c2e',

  // 木头
  wood: '#7a5230',
  woodDark: '#5d3d22',
  woodLight: '#9c6d40',

  // 角色
  skin: '#f0c8a0',
  skinShade: '#d9a87c',
  hair: '#6b4226',
  hairLight: '#8a5a34',
  shirt: '#3f6fb5',
  shirtDark: '#2f5390',
  pants: '#4a4f63',
  boot: '#3a2e22',

  // 小游戏 UI
  uiBorder: '#0d2b3a',
  barFill: '#82e500',
  barFillDark: '#5aa800',
  barEdge: '#216501',
  barHighlight: '#c8ff7a',
  trackTop: '#9fd9e8',
  trackBottom: '#12506b',
  progressLow: '#d64545',
  progressMid: '#e8c53a',
  progressHigh: '#5fd45f',
  chest: '#8a5a2e',
  chestDark: '#5d3d22',
  chestGold: '#e8c53a',
  exclaim: '#ffd23f',
  exclaimDark: '#b8860b',
  crown: '#ffb830',

  // 文字
  textLight: '#e8f6f9',
  textDark: '#0d2b3a',
  textShadow: 'rgba(6, 13, 20, 0.55)'
} as const

/** 品质 -> 星星颜色 */
export const QUALITY_COLOR: Record<string, string> = {
  normal: '#c8ccd4',
  silver: '#dfe8f0',
  gold: '#ffd23f',
  iridium: '#7ec8f0'
}

/** 品质 -> 中文标签 */
export const QUALITY_LABEL: Record<string, string> = {
  normal: '普通',
  silver: '银星',
  gold: '金星',
  iridium: '铱星'
}
