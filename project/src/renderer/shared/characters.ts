import type { CharacterSkin } from './types'

/** 可选形象清单（图鉴式选择框的数据源，命名对齐 design/codex-ui.png 设计稿）。新增形象只需在这里加一项。 */
export interface CharacterDef {
  id: CharacterSkin
  /** 展示名 */
  name: string
  /** 一句话简介（显示在卡片下方） */
  desc: string
}

export const CHARACTER_LIST: CharacterDef[] = [
  { id: 'farmer', name: 'ABIGAIL', desc: '星露谷默认农夫 · 经典绿衫' },
  { id: 'cat', name: 'HARRY', desc: '橘猫条纹 · 奶油肚皮' },
  { id: 'frog', name: '威利', desc: '大眼绿蛙 · 溪边老渔夫' },
  { id: 'penguin', name: '柯罗拉', desc: '圆滚企鹅 · 红围巾' },
  { id: 'wizard', name: '矮人', desc: '星纹尖帽 · 浮标法杖' },
  { id: 'shinchan', name: '蜡笔小新', desc: '粗眉圆脸 · 红衣黄裤' },
  { id: 'maruko', name: '樱桃小丸子', desc: '锯齿短发 · 白衫红裙' },
  { id: 'pikachu', name: '皮卡丘', desc: '黑尖长耳 · 红颊闪电尾' },
  { id: 'rukawa', name: '流川枫', desc: '黑发冷面 · 湘北 11 号球衣' },
  { id: 'doraemon', name: '哆啦A梦', desc: '蓝色圆身 · 红鼻铃铛百宝袋' }
]
