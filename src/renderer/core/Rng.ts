/** 可播种随机数（mulberry32）：保证同 seed 同结果，便于回归测试与手感复现 */
export class Rng {
  private state: number

  constructor(seed: number = 0x9e3779b9) {
    this.state = seed >>> 0
  }

  /** [0,1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [min,max] 浮点 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** [min,max] 整数（含端点） */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /** 以 p 概率返回 true */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** 按权重随机取一项 */
  pick<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0
    for (const it of items) total += Math.max(0, weightOf(it))
    if (total <= 0) return items[Math.floor(this.next() * items.length)]
    let roll = this.next() * total
    for (const it of items) {
      roll -= Math.max(0, weightOf(it))
      if (roll <= 0) return it
    }
    return items[items.length - 1]
  }
}
