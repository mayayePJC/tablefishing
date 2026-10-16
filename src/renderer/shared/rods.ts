import type { CharacterSkin } from './types'

/** 钓鱼竿定义（图鉴式数据源，新增竿只需在此加一项）。 */
export interface RodDef {
  id: string
  /** 展示名 */
  name: string
  /** 一句话简介（卡片下方） */
  desc: string
  /** 解锁所需等级（达到即自动收入图鉴；低于则显示「LvX 解锁」） */
  level: number
  /** 绿条尺寸加成（px，叠加在等级基础上，受 BAR_SIZE_MAX 封顶） */
  barBonus: number
  /** 咬钩时间倍率（<1 = 更快咬钩） */
  biteMult: number
  /** 宝箱概率加成（绝对值，叠加在基础概率上） */
  treasureBonus: number
  /** 抛竿距离倍率（>1 = 抛得更远，影响落点/线长/品质） */
  rangeMult: number
  /** 图鉴卡片主色（用于图标与描边） */
  color: string
}

export const ROD_LIST: RodDef[] = [
  {
    id: 'bamboo',
    name: '竹竿',
    desc: '初心之选 · 万能基础竿',
    level: 0,
    barBonus: 0,
    biteMult: 1,
    treasureBonus: 0,
    rangeMult: 1,
    color: '#7a9a4e'
  },
  {
    id: 'fiberglass',
    name: '玻璃纤维竿',
    desc: '更顺手 · 咬钩更快',
    level: 3,
    barBonus: 6,
    biteMult: 0.85,
    treasureBonus: 0.03,
    rangeMult: 1.15,
    color: '#4ea0c9'
  },
  {
    id: 'iridium',
    name: '铱金竿',
    desc: '高级货 · 捕获更稳宝箱更多',
    level: 6,
    barBonus: 14,
    biteMult: 0.7,
    treasureBonus: 0.07,
    rangeMult: 1.3,
    color: '#9b6fce'
  },
  {
    id: 'legend',
    name: '传说之竿',
    desc: '传说级 · 极致手感',
    level: 9,
    barBonus: 22,
    biteMult: 0.58,
    treasureBonus: 0.12,
    rangeMult: 1.5,
    color: '#e0b341'
  }
]

const ROD_MAP: Record<string, RodDef> = Object.fromEntries(ROD_LIST.map((r) => [r.id, r]))

/** 取某竿定义，缺省返回竹竿（恒拥有） */
export function getRod(id: string | undefined): RodDef {
  return (id && ROD_MAP[id]) || ROD_LIST[0]
}
