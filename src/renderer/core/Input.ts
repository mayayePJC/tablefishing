/**
 * 输入抽象：把鼠标左键 / C 键 / 空格统一成「使用工具」的按住、按下沿、松开沿。
 *
 * 交互模型（清晰划分，避免"不知道点哪"）：
 *  - 人物身体（含等级徽章下方正方形热区）：由 Game 在窗口级监听里负责"拖动窗口"，
 *    其余点击/按住直接交给本类走钓鱼流程（蓄力 / 收线 / 继续）。
 *  - 右下角工具按钮：点击弹出 设置/音效/退出（toolsHitTest / onTools）。
 *  - 窗口其余区域：按住/点击 = 钓鱼（蓄力 / 收线 / 继续）。
 *  - 顶部空白带：不触发钓鱼，避免点到窗口外缘误钓。
 */
export class Input {
  private sources = new Set<string>()
  private pressEdges = 0
  private releaseEdges = 0

  /** 功能键回调 */
  onMuteToggle: (() => void) | null = null
  onAnyKey: (() => void) | null = null

  /** 工具按钮命中（右下角汉堡菜单） */
  toolsHitTest: ((x: number, y: number) => boolean) | null = null
  /** 点击工具按钮回调（切换菜单） */
  onTools: (() => void) | null = null

  private el: HTMLElement

  // 指针位置（画布坐标），用于悬停高亮
  private ptrX = -1
  private ptrY = -1

  // 工具按钮：需"完整点击"（按下+松开都在按钮上）才触发，避免误触
  private toolsArmed = false
  // 失焦/被遮盖时间戳：其后极短时间内忽略工具点击（仅挡掉焦点刚回到窗口时那一帧的误点）。
  // 注意：冷却过长是"点了菜单没反应"的头号元凶，所以压到很小（300ms ≈ 18 帧），
  // 既不影响截图后快速点菜单，也不会让正常点击被吞掉。
  private lastBlurAt = -1e9
  private lastHideAt = -1e9
  private readonly toolsCooldownMs = 300

  /** 顶部空白带：低于此 y 不触发钓鱼（窗口上缘是透明空区） */
  private readonly deadTopY = 30

  constructor(el: HTMLElement) {
    this.el = el

    el.addEventListener('pointerdown', (e) => this.handlePointerDown(e))

    window.addEventListener('pointermove', (e) => {
      const [cx, cy] = this.toCanvas(e)
      this.ptrX = cx
      this.ptrY = cy
    })

    const endPress = (e: PointerEvent) => {
      if (e.button !== 0) return
      const [cx, cy] = this.toCanvas(e)
      this.ptrX = cx
      this.ptrY = cy
      if (this.toolsArmed) {
        this.toolsArmed = false
        const cooled = performance.now() - Math.max(this.lastBlurAt, this.lastHideAt) > this.toolsCooldownMs
        if (cooled && this.toolsHitTest && this.toolsHitTest(cx, cy)) this.onTools?.()
        return
      }
      this.removeSource('mouse')
    }
    window.addEventListener('pointerup', endPress)
    window.addEventListener('pointercancel', () => {
      this.toolsArmed = false
    })
    el.addEventListener('contextmenu', (e) => e.preventDefault())

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' || e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) this.addSource(e.code)
      } else if (e.code === 'KeyM') {
        this.onMuteToggle?.()
      }
      this.onAnyKey?.()
    })
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyC' || e.code === 'Space') this.removeSource(e.code)
    })
    // 失焦时释放所有按键，并记录失焦时间用于工具冷静期
    window.addEventListener('blur', () => {
      this.sources.clear()
      this.toolsArmed = false
      this.ptrX = -1
      this.ptrY = -1
      this.lastBlurAt = performance.now()
    })
    // 页面被遮盖/最小化（如全屏截图覆盖层接管）也计入冷静期
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.lastHideAt = performance.now()
    })
  }

  /** 屏幕坐标 → 画布坐标 */
  private toCanvas(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.el.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  /**
   * 按下处理：人物热区 / 钓竿热区的点按与按住都汇到这里。
   * - 工具按钮：先"按下待确认"，松手仍在按钮上且不在冷静期才弹出；
   * - 顶部空白带不钓鱼；
   * - 其余 → 记一次"鼠标按住"源（蓄力 / 收线 / 继续钓鱼）。
   */
  handlePointerDown(e: PointerEvent): void {
    e.preventDefault()
    this.onAnyKey?.()
    if (e.button !== 0) return
    const [cx, cy] = this.toCanvas(e)
    this.ptrX = cx
    this.ptrY = cy
    // 工具按钮：先"按下待确认"，松手仍在按钮上且不在冷静期才弹出
    if (this.toolsHitTest && this.toolsHitTest(cx, cy)) {
      this.toolsArmed = true
      return
    }
    // 顶部空白带不钓鱼
    if (cy < this.deadTopY) return
    this.addSource('mouse')
  }

  /** 指针当前画布坐标（用于悬停高亮；-1 表示未知） */
  get pointerX(): number {
    return this.ptrX
  }
  get pointerY(): number {
    return this.ptrY
  }

  /**
   * 人物身体区域的按下入口：开始一次"钓鱼按住"，但**不调用 preventDefault**。
   * 原因：身体区域是 -webkit-app-region:drag（原生拖窗），若这里 preventDefault 会
   * 阻止操作系统接管"按住拖动=移动窗口"。由此实现「点一下=钓鱼」「按住拖动=移窗」并存：
   *  - 仅点按（几乎不动）→ 正常落到钓鱼流程（蓄力/收线）；
   *  - 按住并拖动 → Game 侧侦测到位移超阈值会 cancelHeld + controller.abort 取消钓鱼，
   *    同时 OS 原生拖拽接管窗口移动（合成器移动，顺滑无重影）。
   * 参数为屏幕(client)坐标，内部换算成画布坐标。
   */
  beginBodyHoldFromClient(clientX: number, clientY: number): void {
    this.onAnyKey?.()
    const [cx, cy] = this.toCanvas({ clientX, clientY })
    this.ptrX = cx
    this.ptrY = cy
    // 工具按钮：先"按下待确认"
    if (this.toolsHitTest && this.toolsHitTest(cx, cy)) {
      this.toolsArmed = true
      return
    }
    // 顶部空白带不钓鱼
    if (cy < this.deadTopY) return
    this.addSource('mouse')
  }

  /**
   * 撤销一个尚未松开的"鼠标按下"（用于人物区判定为拖拽窗口时，避免松手误触钓鱼）。
   * 只撤销由 mouse 源产生的按下：清除 held，并回退一次 press 沿计数，使控制器不会看到这次按下。
   */
  cancelHeld(): void {
    if (this.sources.has('mouse')) {
      this.sources.delete('mouse')
      if (this.pressEdges > 0) this.pressEdges--
    }
  }

  private addSource(id: string): void {
    if (this.sources.size === 0) this.pressEdges++
    this.sources.add(id)
  }

  private removeSource(id: string): void {
    if (this.sources.delete(id) && this.sources.size === 0) this.releaseEdges++
  }

  /** 当前是否按住 */
  get held(): boolean {
    return this.sources.size > 0
  }

  /** 消费一次按下沿（一个逻辑步内可能多次） */
  consumePress(): boolean {
    if (this.pressEdges > 0) {
      this.pressEdges--
      return true
    }
    return false
  }

  /** 消费一次松开沿 */
  consumeRelease(): boolean {
    if (this.releaseEdges > 0) {
      this.releaseEdges--
      return true
    }
    return false
  }
}
