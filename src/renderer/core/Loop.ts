/**
 * 固定步长游戏循环：1/60s 累加器（帧率无关，最多追 3 步防死亡螺旋），
 * 逻辑 update 与渲染 render 分离。
 */
export class Loop {
  static readonly STEP = 1 / 60

  private accumulator = 0
  private last = 0
  private rafId = 0

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: () => void
  ) {}

  start(): void {
    this.last = performance.now()
    const frame = (now: number) => {
      let elapsed = (now - this.last) / 1000
      this.last = now
      // 切窗口/卡顿后避免一次性补太多步
      if (elapsed > 0.25) elapsed = 0.25
      this.accumulator += elapsed
      let steps = 0
      while (this.accumulator >= Loop.STEP && steps < 3) {
        this.update(Loop.STEP)
        this.accumulator -= Loop.STEP
        steps++
      }
      this.render()
      this.rafId = requestAnimationFrame(frame)
    }
    this.rafId = requestAnimationFrame(frame)
  }

  stop(): void {
    cancelAnimationFrame(this.rafId)
  }
}
