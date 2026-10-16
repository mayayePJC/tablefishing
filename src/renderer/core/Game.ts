import { T } from '../shared/constants'
import { Loop } from './Loop'
import { Input } from './Input'
import { AudioBus } from './AudioBus'
import { Rng } from './Rng'
import { SpriteFactory } from '../render/SpriteFactory'
import type { SpriteSet } from '../render/SpriteFactory'
import { ROD_TIPS, buildRodIcon } from '../render/SpriteFactory'
import { PetView } from '../render/PetView'
import { QUALITY_COLOR, QUALITY_LABEL } from '../render/Palette'
import { FishingController } from '../fishing/FishingController'
import { SaveStore } from '../fishing/data/SaveStore'
import { FISH_TABLE } from '../fishing/data/fishTable'
import { SPOTS, spotFishDefs } from '../fishing/data/spots'
import type { CharacterSkin } from '../shared/types'
import { CHARACTER_LIST } from '../shared/characters'
import { ROD_LIST } from '../shared/rods'

/** 主进程暴露的桌宠桥 */
interface PetBridge {
  drag: (dx: number, dy: number) => void
  quit: () => void
  openDevTools: () => void
  setAutostart: (on: boolean) => void
  /** 点击穿透：ignore=true 时窗口对鼠标"透明"（点击穿透到下方窗口） */
  setClickThrough: (ignore: boolean) => void
}

/** 游戏总装：透明画布、循环、输入、控制器、桌宠视图 */
export class Game {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private loop: Loop
  private input: Input
  private audio = new AudioBus()
  private rng = new Rng((Math.random() * 0xffffffff) >>> 0)
  private skin: CharacterSkin
  private sprites: SpriteSet
  private view: PetView
  private save = new SaveStore()
  private controller: FishingController
  private time = 0
  private toolsOverlay: HTMLElement | null = null
  private toolsSubmenu: HTMLElement | null = null
  private toolsOpen = false
  private helpOverlay: HTMLElement | null = null
  private helpDialog: HTMLElement | null = null
  private charPicker: HTMLElement | null = null
  private charGrid: HTMLElement | null = null
  private charPreviews: Record<string, string> = {}
  private rodPicker: HTMLElement | null = null
  private rodGrid: HTMLElement | null = null
  private rodIcons: Record<string, string> = {}
  private fishPicker: HTMLElement | null = null
  private fishGrid: HTMLElement | null = null
  private fishIcons: Record<string, string> = {}
  /** 原生拖拽底层（app-region:drag）：覆盖人物本体 + 等级徽章及下方区域。
   *  仅在"按住拖动"时（pet-hit 被隐藏露出它）由 OS 合成器移动窗口，顺滑无重影。 */
  private petHandle: HTMLElement | null = null
  /** 无拖拽透明顶层（app-region:no-drag）：覆盖同一身体区，接收点按/按住 → 钓鱼（蓄力/收线）。
   *  拖拽判定（位移超阈值）时被临时隐藏，露出底层 drag 层交由 OS 原生拖动窗口。 */
  private petHit: HTMLElement | null = null
  /** 人物交互区矩形（窗口坐标，= 点击穿透判定区，也是钓鱼/拖窗命中区） */
  private petHandleRect = { l: 0, t: 0, r: 0, b: 0 }
  /** 混合手势状态：身体上"点一下钓 / 按住拖"的判定 */
  private petPressActive = false // 当前是否在身体区按下了
  private petMoveDetected = false // 本次按下是否已判定为"拖动"
  private petDownX = 0 // 按下时的屏幕坐标，用于位移阈值判定
  private petDownY = 0

  /** 主进程桥（拖拽/退出/自启/点击穿透） */
  private bridge: PetBridge | undefined
  /** 当前 pet 拖拽/钓鱼层是否可见（仅在「空闲且无弹窗」时显示；弹窗/钓鱼中隐藏，避免拖拽层吞掉菜单点击） */
  private petLayersVisible = true

  // ---------- 点击穿透（缩小"可点击区域"，避免干扰工作） ----------
  /** 当前已生效的 OS 侧穿透状态（true=窗口对鼠标透明）。仅在翻转时通知主进程，避免每帧 IPC 抖动。
   *  初值取 false 与 OS 默认（窗口默认捕获鼠标）对齐：首帧 frame() 会据当前指针/状态自动 reconciliation
   *  （空闲且指针在空白区→立刻置为穿透），无需等待 mousemove。 */
  private clickThrough = false
  /** 强制可交互：钓鱼进行中或任意弹窗打开时，无视指针位置，整窗可点 */
  private forceInteractive = false
  /** 用于穿透判定的指针坐标（由 mousemove 实时写入；-1 表示未知） */
  private ctPtrX = -1
  private ctPtrY = -1

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement
    this.canvas.width = T.VIEW_W
    this.canvas.height = T.VIEW_H
    this.ctx = this.canvas.getContext('2d')!
    this.ctx.imageSmoothingEnabled = false
    // 钓鱼区光标提示：整窗（除人物拖拽区外）都是"可点击钓鱼"的，用 pointer 暗示可点；
    // 人物身上的 #drag-handle 会覆盖成 grab（拖拽），两者结合让点击范围一目了然。
    this.canvas.style.cursor = 'pointer'

    this.skin = this.save.data.character ?? 'farmer'
    this.sprites = SpriteFactory.build(FISH_TABLE, this.skin)
    this.view = new PetView(this.sprites, this.skin)
    this.view.stealth = this.save.data.stealth ?? false

    const fishPool = spotFishDefs(SPOTS[0], FISH_TABLE)
    this.controller = new FishingController({
      rng: this.rng,
      audio: this.audio,
      sprites: this.sprites,
      fishPool,
      save: this.save,
      rodTipMap: ROD_TIPS[this.skin]
    })

    this.input = new Input(this.canvas)
    this.input.onAnyKey = () => this.audio.unlock()
    this.input.onMuteToggle = () => this.audio.setMuted(!this.audio.muted)

    const bridge = (window as unknown as { fishingCodex?: PetBridge }).fishingCodex
    this.bridge = bridge

    // 人物区交互：同一块区域既「点一下钓鱼」又「按住拖动移窗」，二者并存、互不打架。
    //   设计：两层叠加在同一身体区——
    //    · 底层 pet-handle = app-region:drag（OS 合成器移窗，顺滑无重影）；
    //    · 顶层 pet-hit   = app-region:no-drag（透明），接收点按/按住 → 钓鱼（蓄力/收线）。
    //   关键点：Electron 的 app-region:drag 元素会吞掉 pointerdown，JS 收不到 → 钓鱼起不来。
    //   所以钓鱼必须走顶层 no-drag 的 pet-hit。而"按住拖动"在 pet-hit 上侦测到位移超阈值时，
    //   把 pet-hit 临时隐藏（display:none）→ 露出底层 drag 层 → 此刻 OS 原生拖拽接管移动窗口；
    //   松手（或任何按下）再把 pet-hit 显回来。这样既保留"按住蓄力"又不重影。
    //   点击穿透：仅当指针落在「人物交互区 或 工具按钮」时才恢复可交互，其余区域穿透到下方工作窗口。
    // 几何以常量推导，保证与 PetView 实际绘制的人物 / 等级徽章位置一致：
    //   人物：以 (playerX - CAT_DW/2, playerFootY - CAT_DH) 为左上角。
    //   徽章：以 (playerX + CAT_DW/2 + 4, playerFootY - CAT_DH + 4) 为左上角、宽 68。
    const CAT_DW = T.PLAYER_W * T.PLAYER_SCALE
    const CAT_DH = T.PLAYER_H * T.PLAYER_SCALE
    const charL = T.PLAYER_X - CAT_DW / 2
    const charT = T.PLAYER_FOOT_Y - CAT_DH
    const charR = T.PLAYER_X + CAT_DW / 2
    const charB = T.PLAYER_FOOT_Y
    const badgeR = Math.min(T.VIEW_W - 1, T.PLAYER_X + CAT_DW / 2 + 4 + 68)
    // 人物交互区 = 人物本体 + 等级徽章及「其下方区域」（含徽章右侧那一列空当）。
    // 底部留白避免盖住右下角工具按钮（TOOLS_BTN 位于 x:318 y:368 r:12）。
    const hL = charL - 6
    const hT = charT - 6
    const hR = badgeR + 2
    const hB = Math.min(T.TOOLS_BTN.y - T.TOOLS_BTN.r - 4, charB + 10)
    this.petHandleRect = { l: hL, t: hT, r: hR, b: hB }
    const w = hR - hL
    const h = hB - hT

    // 底层：原生拖拽层（仅在 pet-hit 隐藏时暴露给 OS 接管移窗）
    const handle = document.createElement('div')
    handle.id = 'pet-handle'
    handle.style.position = 'absolute'
    handle.style.left = `${hL}px`
    handle.style.top = `${hT}px`
    handle.style.width = `${w}px`
    handle.style.height = `${h}px`
    handle.style.setProperty('-webkit-app-region', 'drag')
    handle.style.cursor = 'grab'
    ;(document.getElementById('stage') as HTMLElement).appendChild(handle)
    this.petHandle = handle

    // 顶层：无拖拽透明热区（接钓鱼点击）
    const hit = document.createElement('div')
    hit.id = 'pet-hit'
    hit.style.position = 'absolute'
    hit.style.left = `${hL}px`
    hit.style.top = `${hT}px`
    hit.style.width = `${w}px`
    hit.style.height = `${h}px`
    hit.style.setProperty('-webkit-app-region', 'no-drag')
    hit.style.cursor = 'pointer'
    hit.style.touchAction = 'none'
    ;(document.getElementById('stage') as HTMLElement).appendChild(hit)
    this.petHit = hit

    // 身体区手势：点按/按住 = 钓鱼；按住并拖动 = 移窗。
    const showHit = () => {
      // 仅在层本应可见（空闲且无弹窗）时才显回，避免钓鱼/弹窗期间误显热区
      if (this.petHit && this.petLayersVisible) this.petHit.style.display = ''
    }
    const hideHit = () => {
      if (this.petHit) this.petHit.style.display = 'none'
    }
    hit.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault()
      this.input.beginBodyHoldFromClient(e.clientX, e.clientY)
      if (e.button !== 0) return
      showHit() // 确保可见（上一次拖拽结束的兜底恢复）
      this.petPressActive = true
      this.petMoveDetected = false
      this.petDownX = e.clientX
      this.petDownY = e.clientY
    })
    // 拖拽判定：位移超 5px → 取消钓鱼并露出底层 drag 层，交由 OS 原生拖动窗口
    const onPetMove = (e: PointerEvent) => {
      if (!this.petPressActive || this.petMoveDetected) return
      const dx = e.clientX - this.petDownX
      const dy = e.clientY - this.petDownY
      if (dx * dx + dy * dy > 25) {
        this.petMoveDetected = true
        this.input.cancelHeld()
        this.controller.abort()
        hideHit()
      }
    }
    const onPetUp = () => {
      this.petPressActive = false
      this.petMoveDetected = false
      showHit()
    }
    hit.addEventListener('pointermove', onPetMove)
    window.addEventListener('pointerup', onPetUp)
    window.addEventListener('pointercancel', onPetUp)
    // 兜底：原生拖拽结束时 OS 可能吞掉 pointerup，导致 pet-hit 一直隐藏；
    // 任意处按下都尝试显回 pet-hit（仅在层本应可见时才生效），保证下次点身体能钓鱼。
    window.addEventListener('pointerdown', () => showHit())

    // 右下角工具按钮：点击弹出 设置 / 音效 / 退出
    const t = T.TOOLS_BTN
    this.input.toolsHitTest = (x, y) => Math.hypot(x - t.x, y - t.y) <= t.r
    this.input.onTools = () => this.toggleTools()
    this.buildToolsMenu(bridge)
    this.buildCharPicker()
    this.buildRodPicker()
    this.buildFishPicker()
    // 玩法说明弹窗：用 pointerdown 关闭（click 在透明窗体下常被抑制，pointerdown 更稳）。
    // 点关闭按钮、或点对话框之外（暗色遮罩）即关闭；点弹窗内部(文字)不关。
    this.helpOverlay = document.getElementById('help-overlay') as HTMLElement
    this.helpDialog = document.getElementById('help-dialog')
    const helpClose = document.getElementById('help-close')
    const onHelpDown = (e: PointerEvent) => {
      const inDialog = this.helpDialog?.contains(e.target as Node) ?? false
      if (e.target === helpClose || !inDialog) {
        e.stopPropagation()
        this.toggleHelp(false)
      }
    }
    this.helpOverlay?.addEventListener('pointerdown', onHelpDown)
    helpClose?.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.toggleHelp(false) })

    // 启动时把已保存的开机自启状态同步给主进程（写入注册表 Run 项）
    bridge?.setAutostart(this.save.data.autostart ?? false)
    // 阻止系统右键菜单（右键不退出）
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    // 点击穿透判定：窗口"透明"到鼠标时，页面仍能收到 mousemove（主进程 forward:true）。
    // 据此实时判断指针是否落在热点（人物 / 工具按钮），只有热点才恢复可交互，
    // 其余区域点击直接穿透到下方工作窗口——桌宠不再"抢"工作区的点击。
    document.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect()
      this.ctPtrX = e.clientX - rect.left
      this.ctPtrY = e.clientY - rect.top
      this.updateClickThrough()
    })

    this.loop = new Loop(
      (dt) => this.update(dt),
      () => this.frame()
    )
  }

  start(): void {
    this.loop.start()
  }

  private update(dt: number): void {
    this.time += dt
    const press = this.input.consumePress()
    const release = this.input.consumeRelease()
    this.controller.setInput(this.input.held, press, release)
    this.controller.update(dt, this.time)
  }

  private frame(): void {
    const state = this.controller.getSceneState(this.time)
    this.ctx.imageSmoothingEnabled = false
    this.ctx.clearRect(0, 0, T.VIEW_W, T.VIEW_H) // 透明：不填充背景
    // 悬停高亮：指针在工具按钮上时按钮变亮
    const t = T.TOOLS_BTN
    const px = this.input.pointerX
    const py = this.input.pointerY
    this.view.toolsHover = px >= 0 && py >= 0 && Math.hypot(px - t.x, py - t.y) <= t.r
    this.view.draw(this.ctx, state)

    // 点击穿透控制：钓鱼进行中 / 任意弹窗打开 → 强制可交互；
    // 空闲时只有在指针落在「人物身体 / 工具按钮」上才恢复可交互，其余区域穿透到下方窗口。
    const active =
      !!state.minigame ||
      !!state.bobber ||
      state.hud.charge >= 0 ||
      !!state.result ||
      state.playerPose === 'cast' ||
      state.playerPose === 'reel'
    const overlayOpen =
      this.toolsOpen ||
      !!this.helpOverlay?.classList.contains('visible') ||
      !!this.charPicker?.classList.contains('visible') ||
      !!this.rodPicker?.classList.contains('visible') ||
      !!this.fishPicker?.classList.contains('visible')
    this.forceInteractive = active || overlayOpen
    this.updateClickThrough()
    this.updatePetLayers()

    // 光标：钓鱼热区显示 pointer（可点击钓鱼），外圈拖窗框显示 grab（拖动窗口）
    this.canvas.style.cursor = 'pointer'
  }

  /** 构建工具菜单（DOM 覆盖层）：
   *  一级目录 = 玩法相关：玩法说明 / 形象图鉴 / 钓鱼竿
   *  二级「设置 ▸」= 音效 / 隐身 / 开机自启 / 退出
   */
  private buildToolsMenu(bridge: PetBridge | undefined): void {
    const overlay = document.createElement('div')
    overlay.id = 'tools-overlay'
    const menu = document.createElement('div')
    menu.id = 'tools-menu'

    const closeAll = () => this.toggleTools(false)
    // 顶层按钮
    const topBtn = (label: string, fn: () => void) => {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        fn()
        closeAll()
      })
      menu.appendChild(b)
      return b
    }

    // 玩法相关：一级目录
    topBtn('玩法说明', () => this.toggleHelp(true))
    topBtn('形象图鉴', () => this.toggleCharPicker(true))
    topBtn('鱼图鉴', () => this.toggleFishPicker(true))
    topBtn('钓鱼竿', () => this.toggleRodPicker(true))

    // 「设置 ▸」二级目录
    const settingsBtn = document.createElement('button')
    settingsBtn.textContent = '设置 ▸'
    menu.appendChild(settingsBtn)
    const sub = document.createElement('div')
    sub.id = 'tools-submenu'
    sub.className = 'submenu'
    menu.appendChild(sub)

    const subBtn = (label: string, fn: () => void) => {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        fn()
        closeAll()
      })
      sub.appendChild(b)
      return b
    }

    const soundBtn = subBtn('音效：开', () => {
      this.audio.setMuted(!this.audio.muted)
      soundBtn.textContent = this.audio.muted ? '音效：关' : '音效：开'
    })
    const stealthBtn = subBtn(this.view.stealth ? '隐身：开' : '隐身：关', () => {
      this.view.stealth = !this.view.stealth
      this.save.data.stealth = this.view.stealth
      this.save.save()
      stealthBtn.textContent = this.view.stealth ? '隐身：开' : '隐身：关'
    })
    const autoBtn = subBtn(this.save.data.autostart ? '开机自启：开' : '开机自启：关', () => {
      this.save.data.autostart = !this.save.data.autostart
      this.save.save()
      autoBtn.textContent = this.save.data.autostart ? '开机自启：开' : '开机自启：关'
      bridge?.setAutostart(this.save.data.autostart)
    })
    // 退出也收进设置二级目录
    subBtn('退出', () => bridge?.quit())

    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      sub.classList.toggle('visible')
    })

    menu.addEventListener('click', (e) => e.stopPropagation())
    overlay.appendChild(menu)
    // 仅点击菜单背后的空白区才关闭菜单（避免覆盖按钮的 click，导致"点了没反应"）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        sub.classList.remove('visible')
        this.toggleTools(false)
      }
    })
    ;(document.getElementById('stage') as HTMLElement).appendChild(overlay)
    this.toolsOverlay = overlay
    this.toolsSubmenu = sub
  }

  /** 切换工具菜单显隐（force 显式指定） */
  private toggleTools(force?: boolean): void {
    this.toolsOpen = force === undefined ? !this.toolsOpen : force
    this.toolsOverlay?.classList.toggle('visible', this.toolsOpen)
    // 关闭/切换时收起二级子菜单，避免下次打开残留展开态
    this.toolsSubmenu?.classList.remove('visible')
    this.updateDragWhileOverlay()
  }

  /** 切换玩法说明弹窗显隐（force 显式指定） */
  private toggleHelp(force?: boolean): void {
    if (!this.helpOverlay) return
    const open = force === undefined ? !this.helpOverlay.classList.contains('visible') : force
    this.helpOverlay.classList.toggle('visible', open)
    this.updateDragWhileOverlay()
  }

  /**
   * 任意弹窗打开/关闭时调用：刷新点击穿透判定，并同步 pet 拖拽/钓鱼层显隐。
   * 弹窗期间 forceInteractive 已自动置真，窗口整窗可交互；同时隐藏 pet 层，
   * 否则其覆盖在工具菜单/子菜单区域之上的透明 drag 层会吞掉菜单点击（这正是
   * "点击设置/设置面板都点不动" 的根因）。
   */
  private updateDragWhileOverlay(): void {
    this.updateClickThrough()
    this.updatePetLayers()
  }

  /** 是否任意弹窗（工具菜单/玩法说明/各图鉴）已打开 */
  private anyOverlayOpen(): boolean {
    return (
      this.toolsOpen ||
      !!this.helpOverlay?.classList.contains('visible') ||
      !!this.charPicker?.classList.contains('visible') ||
      !!this.rodPicker?.classList.contains('visible') ||
      !!this.fishPicker?.classList.contains('visible')
    )
  }

  /**
   * 同步 pet 交互层（#pet-handle）显隐：
   *  仅当「空闲态 且 无弹窗」时显示——此时身体区既要接钓鱼点击、又要接拖窗手势；
   *  弹窗打开或钓鱼进行中则隐藏，避免透明 drag 层盖住菜单、或误把钓鱼按键当成拖窗。
   */
  private updatePetLayers(): void {
    const show = this.controller.stateName === 'idle' && !this.anyOverlayOpen()
    if (show === this.petLayersVisible) return
    this.petLayersVisible = show
    const d = show ? '' : 'none'
    if (this.petHandle) this.petHandle.style.display = d
    if (this.petHit) this.petHit.style.display = d
  }

  /**
   * 人物可交互命中框（= 点击穿透判定区）：以 petHandleRect 为准 —— 覆盖「人物本体 +
   * 等级徽章及其下方区域」整块区域。落在此区域内 → 窗口恢复可交互
   * （否则点击穿透到下方工作窗口）。工具按钮小圆区被排除（避免与菜单冲突）。
   */
  private inPetBody(x: number, y: number): boolean {
    const r = this.petHandleRect
    if (x < r.l || x > r.r || y < r.t || y > r.b) return false
    if (this.input.toolsHitTest && this.input.toolsHitTest(x, y)) return false
    return true
  }

  /**
   * 重新计算"是否应让鼠标穿透"并仅在状态翻转时通知主进程（避免每帧 IPC 抖动）。
   * 应穿透的条件：指针既不在人物身体、也不在工具按钮，且没有强制可交互（钓鱼中/弹窗）。
   */
  private updateClickThrough(): void {
    const overPet = this.ctPtrX >= 0 && this.ctPtrY >= 0 && this.inPetBody(this.ctPtrX, this.ctPtrY)
    const overTools = this.input.toolsHitTest?.(this.ctPtrX, this.ctPtrY) ?? false
    const shouldIgnore = !(overPet || overTools || this.forceInteractive)
    if (shouldIgnore !== this.clickThrough) {
      this.clickThrough = shouldIgnore
      this.bridge?.setClickThrough(shouldIgnore)
    }
  }

  /** 构建形象图鉴选择框：烘焙每个形象的待机预览图，生成卡片网格 */
  private buildCharPicker(): void {
    this.charPicker = document.getElementById('char-picker')
    this.charGrid = document.getElementById('char-grid')
    if (!this.charPicker || !this.charGrid) return

    // 预先把每个形象的待机帧烘焙成透明 PNG dataURL，作为卡片预览
    this.charPreviews = {}
    for (const def of CHARACTER_LIST) {
      this.charPreviews[def.id] = SpriteFactory.build(FISH_TABLE, def.id).playerIdle[0].toDataURL()
    }

    const grid = this.charGrid
    grid.innerHTML = ''
    for (const def of CHARACTER_LIST) {
      const card = document.createElement('div')
      card.className = 'char-card' + (def.id === this.skin ? ' selected' : '')
      card.dataset.id = def.id
      const img = document.createElement('img')
      img.src = this.charPreviews[def.id]
      img.alt = def.name
      const nm = document.createElement('div')
      nm.className = 'nm'
      nm.textContent = def.name
      const ds = document.createElement('div')
      ds.className = 'ds'
      ds.textContent = def.desc
      const sl = document.createElement('div')
      sl.className = 'sl'
      sl.textContent = def.id === this.skin ? '✓ 使用中' : ''
      card.append(img, nm, ds, sl)
      card.addEventListener('click', () => this.selectCharacter(def.id))
      grid.appendChild(card)
    }

    // 点遮罩空白处关闭；关闭按钮关闭
    this.charPicker.addEventListener('pointerdown', (e) => {
      if (e.target === this.charPicker) this.toggleCharPicker(false)
    })
    document.getElementById('char-close')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      this.toggleCharPicker(false)
    })
  }

  /** 选中某个形象：实时切换 + 持久化 + 刷新卡片选中态 */
  private selectCharacter(id: CharacterSkin): void {
    if (id === this.skin) return
    this.skin = id
    this.sprites = SpriteFactory.build(FISH_TABLE, this.skin)
    this.view.setSprites(this.sprites, this.skin)
    this.controller.setRodTipMap(ROD_TIPS[this.skin])
    this.save.data.character = this.skin
    this.save.save()
    this.charGrid?.querySelectorAll<HTMLElement>('.char-card').forEach((c) => {
      const selected = c.dataset.id === this.skin
      c.classList.toggle('selected', selected)
      const sl = c.querySelector<HTMLElement>('.sl')
      if (sl) sl.textContent = selected ? '✓ 使用中' : ''
    })
  }

  /** 切换形象图鉴选择框显隐（force 显式指定） */
  private toggleCharPicker(force?: boolean): void {
    if (!this.charPicker) return
    const open = force === undefined ? !this.charPicker.classList.contains('visible') : force
    this.charPicker.classList.toggle('visible', open)
    this.updateDragWhileOverlay()
  }

  /** 构建钓鱼竿图鉴：烘焙每根竿的彩色图标，生成卡片网格 */
  private buildRodPicker(): void {
    this.rodPicker = document.getElementById('rod-picker')
    this.rodGrid = document.getElementById('rod-grid')
    if (!this.rodPicker || !this.rodGrid) return

    // 预先把每根竿按主色烘焙成图标，作为卡片预览
    this.rodIcons = {}
    for (const def of ROD_LIST) {
      this.rodIcons[def.id] = buildRodIcon(def.color).toDataURL()
    }

    const owned = this.save.data.rods?.owned ?? ['bamboo']
    const equipped = this.save.data.rods?.equipped ?? 'bamboo'

    const grid = this.rodGrid
    grid.innerHTML = ''
    for (const def of ROD_LIST) {
      const isOwned = owned.includes(def.id)
      const isEquipped = def.id === equipped
      const card = document.createElement('div')
      card.className = 'rod-card' + (isEquipped ? ' selected' : '') + (isOwned ? '' : ' locked')
      card.dataset.id = def.id

      const img = document.createElement('img')
      img.src = this.rodIcons[def.id]
      img.alt = def.name

      const nm = document.createElement('div')
      nm.className = 'nm'
      nm.textContent = def.name

      const ds = document.createElement('div')
      ds.className = 'ds'
      ds.textContent = def.desc

      // 属性标签：把数值加成翻译成简短文案
      const tags: string[] = []
      if (def.barBonus > 0) tags.push(`绿条+${def.barBonus}`)
      if (def.biteMult < 1) tags.push(`咬钩×${def.biteMult}`)
      if (def.treasureBonus > 0) tags.push(`宝箱+${Math.round(def.treasureBonus * 100)}%`)
      if (def.rangeMult > 1) tags.push(`距离×${def.rangeMult}`)
      const tg = document.createElement('div')
      tg.className = 'tg'
      tg.textContent = tags.join(' · ')

      const sl = document.createElement('div')
      sl.className = 'sl'
      sl.textContent = isEquipped ? '✓ 使用中' : isOwned ? '点击装备' : `Lv${def.level} 解锁`

      card.append(img, nm, ds, tg, sl)
      if (isOwned) card.addEventListener('click', () => this.selectRod(def.id))
      grid.appendChild(card)
    }

    // 点遮罩空白处关闭；关闭按钮关闭
    this.rodPicker.addEventListener('pointerdown', (e) => {
      if (e.target === this.rodPicker) this.toggleRodPicker(false)
    })
    document.getElementById('rod-close')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      this.toggleRodPicker(false)
    })
  }

  /** 选中/装备某根已拥有的竿：实时切换 + 持久化 + 刷新卡片选中态（控制器每步自动读取装备竿） */
  private selectRod(id: string): void {
    const owned = this.save.data.rods?.owned ?? ['bamboo']
    if (!owned.includes(id)) return
    if (this.save.data.rods?.equipped === id) return
    this.save.data.rods = { owned, equipped: id }
    this.save.save()
    this.rodGrid?.querySelectorAll<HTMLElement>('.rod-card').forEach((c) => {
      const selected = c.dataset.id === id
      c.classList.toggle('selected', selected)
      const sl = c.querySelector<HTMLElement>('.sl')
      if (sl) sl.textContent = selected ? '✓ 使用中' : '点击装备'
    })
  }

  /** 切换钓鱼竿图鉴显隐（force 显式指定） */
  private toggleRodPicker(force?: boolean): void {
    if (!this.rodPicker) return
    const open = force === undefined ? !this.rodPicker.classList.contains('visible') : force
    this.rodPicker.classList.toggle('visible', open)
    this.updateDragWhileOverlay()
  }

  /**
   * 构建鱼图鉴骨架：烘焙每条鱼的图标（只需一次），绑定关闭逻辑。
   * 卡片网格在每次打开时由 refreshFishPicker 重建，以反映最新捕获进度。
   */
  private buildFishPicker(): void {
    this.fishPicker = document.getElementById('fish-picker')
    this.fishGrid = document.getElementById('fish-grid')
    if (!this.fishPicker || !this.fishGrid) return

    // 预先把每条鱼的图标烘焙成 dataURL（朝上帧）
    this.fishIcons = {}
    for (const def of FISH_TABLE) {
      const frames = this.sprites.fish[def.id]
      this.fishIcons[def.id] = (frames?.[0] ?? this.sprites.fish.carp[0]).toDataURL()
    }

    // 点遮罩空白处关闭；关闭按钮关闭
    this.fishPicker.addEventListener('pointerdown', (e) => {
      if (e.target === this.fishPicker) this.toggleFishPicker(false)
    })
    document.getElementById('fish-close')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      this.toggleFishPicker(false)
    })
  }

  /** 重建鱼图鉴卡片网格（每次打开时调用，反映最新捕获进度） */
  private refreshFishPicker(): void {
    if (!this.fishGrid) return
    const collection = this.save.data.collection
    const discovered = Object.keys(collection).length
    const sub = document.getElementById('fish-sub')
    if (sub) sub.textContent = `已发现 ${discovered} / ${FISH_TABLE.length}　·　未捕获的神秘鱼影已隐去真容`

    const grid = this.fishGrid
    grid.innerHTML = ''
    for (const def of FISH_TABLE) {
      const entry = collection[def.id]
      const known = !!entry
      const card = document.createElement('div')
      card.className = 'fish-card' + (known ? '' : ' locked')

      const img = document.createElement('img')
      img.src = this.fishIcons[def.id]
      img.alt = def.name

      const nm = document.createElement('div')
      nm.className = 'fc-nm'
      nm.textContent = known ? def.name : '？？？'

      const st = document.createElement('div')
      st.className = 'fc-st'
      if (known) {
        const qc = QUALITY_COLOR[entry.bestQuality ?? 'normal']
        const ql = QUALITY_LABEL[entry.bestQuality ?? 'normal']
        st.innerHTML =
          `<span class="fc-cnt">×${entry.count}</span>` +
          `<span class="fc-sz">最大 ${entry.bestSize}"</span>` +
          `<span class="fc-ql" style="color:${qc}">${ql}</span>`
      } else {
        st.textContent = '未发现'
      }

      card.append(img, nm, st)
      grid.appendChild(card)
    }
  }

  /** 切换鱼图鉴显隐（force 显式指定） */
  private toggleFishPicker(force?: boolean): void {
    if (!this.fishPicker) return
    const open = force === undefined ? !this.fishPicker.classList.contains('visible') : force
    if (open) this.refreshFishPicker()
    this.fishPicker.classList.toggle('visible', open)
    this.updateDragWhileOverlay()
  }
}
