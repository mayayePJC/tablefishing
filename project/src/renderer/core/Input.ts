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
  onStealthToggle: (() => void) | null = null
  onAnyKey: (() => void) | null = null

  /** 工具按钮命中（右下角汉堡菜单） */
  toolsHitTest: ((x: number, y: number) => boolean) | null = null
  /** 点击工具按钮回调（切换菜单） */
  onTools: (() => void) | null = null

  /**
   * 输入屏蔽 predicates（由 Game 挂上）：返回 true 时忽略"钓鱼按下"。
   * 图鉴/玩法说明面板采用 pointer-events:none 覆盖层（保证工具按钮可点、可快速换面板），
   * 其"内容区之外"的点击会穿透到画布——若不屏蔽，关面板的同一击会误起蓄力。
   * 工具按钮的放行在本检查之前，不受影响。
   */
  inputBlocked: (() => boolean) | null = null

  private el: HTMLElement

  // 指针位置（画布坐标），用于悬停高亮
  private ptrX = -1
  private ptrY = -1

  // 工具按钮：需"完整点击"（按下+松开都在按钮上）才触发，避免误触
  private toolsArmed = false
  private mousePointerId: number | null = null
  onCancel: (() => void) | null = null

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
      if (this.mousePointerId !== null && e.pointerId !== this.mousePointerId) return
      this.mousePointerId = null
      const [cx, cy] = this.toCanvas(e)
      this.ptrX = cx
      this.ptrY = cy
      if (this.toolsArmed) {
        this.toolsArmed = false
        if (this.toolsHitTest?.(cx, cy)) this.onTools?.()
        return
      }
      this.removeSource('mouse')
    }
    window.addEventListener('pointerup', endPress)
    window.addEventListener('pointercancel', (e) => {
      if (this.mousePointerId !== null && e.pointerId !== this.mousePointerId) return
      this.toolsArmed = false
      this.cancelHeld()
      this.mousePointerId = null
      this.onCancel?.()
    })
    el.addEventListener('contextmenu', (e) => e.preventDefault())

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' || e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) this.addSource(e.code)
      } else if (!e.repeat && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.isComposing) {
        if (e.code === 'KeyM') this.onMuteToggle?.()
        if (e.code === 'KeyH') this.onStealthToggle?.()
      }
      this.onAnyKey?.()
    })
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyC' || e.code === 'Space') this.removeSource(e.code)
    })
    // 失焦/隐藏只撤销旧手势；下次完整点击立即有效。
    const cancelAll = () => {
      this.sources.clear()
      this.pressEdges = 0
      this.releaseEdges = 0
      this.toolsArmed = false
      this.mousePointerId = null
      this.ptrX = -1
      this.ptrY = -1
    }
    window.addEventListener('blur', cancelAll)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAll()
    })
  }

  /** 屏幕坐标 → 画布坐标 */
  private toCanvas(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.el.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  /** 公开：屏幕坐标 → 画布坐标（供 Game 做点击穿透 / 工具按钮判定） */
  clientToCanvas(e: { clientX: number; clientY: number }): [number, number] {
    return this.toCanvas(e)
  }

  /**
   * 按下处理：人物热区 / 钓竿热区的点按与按住都汇到这里。
   * - 工具按钮：先"按下待确认"，松手仍在按钮上才切换；
   * - 顶部空白带不钓鱼；
   * - 其余 → 记一次"鼠标按住"源（蓄力 / 收线 / 继续钓鱼）。
   */
  handlePointerDown(e: PointerEvent, captureTarget: HTMLElement = this.el): void {
    e.preventDefault()
    this.onAnyKey?.()
    if (e.button !== 0 || e.isPrimary === false) return
    if (this.mousePointerId !== null && e.pointerId !== this.mousePointerId) return
    this.mousePointerId = e.pointerId
    const [cx, cy] = this.toCanvas(e)
    this.ptrX = cx
    this.ptrY = cy
    // 独立按钮捕获本次指针，拖离、取消和失焦均不冒充完整点击。
    if (this.toolsHitTest && this.toolsHitTest(cx, cy)) {
      this.toolsArmed = true
      captureTarget.setPointerCapture(e.pointerId)
      return
    }
    // 弹窗（图鉴/玩法说明）打开中：不起钓鱼按下，避免"点面板外关闭"误触蓄力
    if (this.inputBlocked?.()) return
    // 顶部空白带不钓鱼
    if (cy < this.deadTopY) return
    this.mousePointerId = e.pointerId
    this.el.setPointerCapture(e.pointerId)
    this.addSource('mouse')
  }

  /** 指针当前画布坐标（用于悬停高亮；-1 表示未知） */
  get pointerX(): number {
    return this.ptrX
  }
  get pointerY(): number {
    return this.ptrY
  }

  cancelToolsPress(): void {
    if (!this.toolsArmed) return
    this.toolsArmed = false
    this.mousePointerId = null
  }

  /**
   * 人物身体区域的按下入口：开始一次"钓鱼按住"。
   * 拖窗由 Game 侧手势状态机判定（窗口位移超阈值 → cancelHeld + controller.abort），
   * 窗口仍由 OS 原生移动，本函数只负责正常起始钓鱼蓄力。
   * 参数为屏幕(client)坐标，内部换算成画布坐标。
   */
  beginBodyHoldFromClient(clientX: number, clientY: number, pointerId?: number): void {
    this.onAnyKey?.()
    const [cx, cy] = this.toCanvas({ clientX, clientY })
    this.ptrX = cx
    this.ptrY = cy
    // 工具按钮：先"按下待确认"
    if (this.toolsHitTest && this.toolsHitTest(cx, cy)) {
      this.toolsArmed = true
      return
    }
    // 弹窗（图鉴/玩法说明）打开中：身体区也不起钓鱼按下（同上）
    if (this.inputBlocked?.()) return
    // 顶部空白带不钓鱼
    if (cy < this.deadTopY) return
    this.mousePointerId = pointerId ?? null
    this.addSource('mouse')
  }

  /** 原生拖窗可能吞掉 pointerup；由壳层松开通知补齐，重复通知不会重复抛竿。 */
  endBodyHold(): void {
    this.removeSource('mouse')
  }

  /**
   * 撤销一个尚未松开的"鼠标按下"（用于人物区判定为拖拽窗口时，避免松手误触钓鱼）。
   * 撤销 mouse；仍有键盘来源时保留聚合 press，避免取消鼠标吞掉同帧 C/空格。
   */
  cancelHeld(): void {
    if (this.sources.has('mouse')) {
      this.sources.delete('mouse')
      if (this.sources.size === 0 && this.pressEdges > 0) this.pressEdges--
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
