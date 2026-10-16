import type { CharacterSkin } from './types'

/** 可选形象清单（图鉴式选择框的数据源）。新增形象只需在这里加一项。 */
export interface CharacterDef {
  id: CharacterSkin
  /** 展示名 */
  name: string
  /** 一句话简介（显示在卡片下方） */
  desc: string
}

export const CHARACTER_LIST: CharacterDef[] = [
  { id: 'farmer', name: '星露农夫', desc: '默认形象 · 经典绿衫' },
  { id: 'cat', name: '猫将', desc: '白猫绿甲 · 持竿出战' }
]
