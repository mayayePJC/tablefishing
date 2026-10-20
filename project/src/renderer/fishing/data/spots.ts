import type { FishDef } from '../../shared/types'

/**
 * 钓点配置（数据驱动：新增钓点 = 加一条配置）。
 * v1 只有一个「山湖栈桥」钓点。
 */
export interface SpotConfig {
  id: string
  name: string
  /** 该钓点鱼池（引用鱼表 id） */
  fishIds: string[]
  /** 场景色调微调（预留） */
  waterTint: string
}

export const SPOTS: SpotConfig[] = [
  {
    id: 'mountain_lake_dock',
    name: '山湖 · 木栈桥',
    fishIds: [
      'carp', 'herring', 'anchovy', 'sunfish', 'bream', 'sea_cucumber', 'walleye',
      'largemouth_bass', 'pike', 'tuna', 'catfish', 'squid', 'pufferfish', 'octopus', 'legend'
    ],
    waterTint: '#2a7fa3'
  }
]

export function spotFishDefs(spot: SpotConfig, table: FishDef[]): FishDef[] {
  return spot.fishIds.map((id) => table.find((f) => f.id === id)!).filter(Boolean)
}
