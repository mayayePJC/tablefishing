import { T } from '../shared/constants'
import { Loop } from './Loop'
import { Input } from './Input'
import { newGestureState, stepGesture } from './gesture'
import { AudioBus } from './AudioBus'
import { shouldCloseOverlay } from './overlayClose'
import { Rng } from './Rng'
import { SpriteFactory } from '../render/SpriteFactory'
import type { SpriteSet } from '../render/SpriteFactory'
import { ROD_TIPS, buildRodIcon } from '../render/SpriteFactory'
import { PetView } from '../render/PetView'
import { FishingController } from '../fishing/FishingController'
import {
  SaveStore,
  DEFAULT_SEDENTARY_REMINDER_MINUTES,
  DEFAULT_WATER_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  MIN_REMINDER_MINUTES,
  normalizeReminderMinutes
} from '../fishing/data/SaveStore'
import { FISH_TABLE } from '../fishing/data/fishTable'
import { SPOTS, spotFishDefs } from '../fishing/data/spots'
import type { CharacterSkin, BgmTrackId } from '../shared/types'
import { CHARACTER_LIST } from '../shared/characters'
import { ROD_LIST } from '../shared/rods'
import { BGM_TRACKS, bgmTrackById } from './Bgm'
import { LocalMusicLibrary, type LocalMusicTrack, type LocalMusicBridge } from './LocalMusic'
import { canvasInputRegions, type InputRect } from './WindowRegions'
import { getPetBridge } from './petBridge'

/** 环境音名称及场景说明。 */
function bgmName(id: BgmTrackId): string {
  const t = bgmTrackById(id)
  if (!t) return id
  return `${t.name} · ${t.cn}`
}

/** 菜单中显示简短中文名称，详细说明放入 title。 */
function bgmShortName(id: BgmTrackId | null): string {
  const t = bgmTrackById(id)
  if (!t) return '钓鱼音效'
  return t.name
}

/** 主进程暴露的桌宠桥 */
export interface PetBridge extends Partial<LocalMusicBridge> {
  /** 拖窗：渲染进程通知主进程"进入/退出身体拖窗态"，窗口由 OS 原生移动（无重影） */
  bodyDragBegin: (gestureId: number) => void
  bodyDragEnd: (gestureId: number) => void
  /** 主进程在拖窗过程中转发窗口位移增量（相对 begin 时记录的基准位置） */
  onBodyMoved: (cb: (d: { x: number; y: number; gestureId?: number }) => void) => void
  /** 原生拖窗吞掉 DOM 松开事件时，由壳层上报左键松开及最终窗口位移。 */
  onBodyReleased?: (cb: (d: { x: number; y: number; gestureId?: number }) => void) => void
  /** 点击成立但窗口被手抖蹭动过：弹回 begin 时记录的基准位置（单次 setPosition，无重影） */
  snapBack: () => void
  /** 主进程启动时推送一次指针相对画布的位置 */
  onPointerInit: (cb: (p: { x: number; y: number }) => void) => void
  /** 主进程（Tauri）轮询上报的指针相对画布位置（点击穿透无 forward 模式时的替代数据源） */
  onPointerMove: (cb: (p: { x: number; y: number }) => void) => void
  /** 渲染层初始化完成：通知主进程显示窗口并推送一次指针位置（消除白屏） */
  markReady: () => void
  quit: () => void
  openDevTools: () => void
  setAutostart: (on: boolean) => void
  /** 点击穿透：ignore=true 时窗口对鼠标"透明"（点击穿透到下方窗口） */
  setClickThrough: (ignore: boolean) => void
  /** 原生窗口形状：空白天然穿透，进入热点无需异步恢复。null 表示整窗。 */
  setInputRegions?: (regions: InputRect[] | null) => Promise<void> | void
}

/** 游戏总装：透明画布、循环、输入、控制器、桌宠视图 */
export class Game {
  /** 提醒周期：开关只保存在存档中，计时从本次打开桌宠开始。 */
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private loop: Loop
  private input: Input
  private audio = new AudioBus()
  private localMusic: LocalMusicLibrary
  private localMusicTracks: LocalMusicTrack[] = []
  private musicPicker: HTMLElement | null = null
  private musicLibraryBusy = false
  private musicLibraryLoading = false
  private musicLibraryRevision = 0
  private musicSelectionRevision = 0
  private musicStatus = ''
  private musicStatusError = false
  private refreshMusicUi: (() => void) | null = null
  private refreshStealthUi: (() => void) | null = null
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
  private toolsButton: HTMLButtonElement | null = null
  /** 工具菜单本体（关闭"点击外部"判定时作为内容区） */
  private toolsMenuEl: HTMLElement | null = null
  /** 一级菜单里的「设置 ▸」按钮（二级菜单纵向对齐它） */
  private toolsSettingsBtn: HTMLElement | null = null
  private helpOverlay: HTMLElement | null = null
  private helpDialog: HTMLElement | null = null
  /** 三个独立图鉴面板（形象 / 鱼类 / 钓竿，对齐 design/codex-ui.png；
   *  2026-10-19 从单一三栏合并面板拆回——工具菜单三个一级入口各开各的面板，互斥） */
  private charPicker: HTMLElement | null = null
  private rodPicker: HTMLElement | null = null
  private fishPicker: HTMLElement | null = null
  private charGrid: HTMLElement | null = null
  private charPreviews: Record<string, string> = {}
  private rodGrid: HTMLElement | null = null
  private rodIcons: Record<string, string> = {}
  private fishGrid: HTMLElement | null = null
  private fishIcons: Record<string, string> = {}
  /** 未发现鱼的「鱼影？」图标 dataURL（图鉴锁定卡） */
  private fishQuestUrl = ''
  /** 身体交互层（Tauri 原生 drag 区，由 OS 合成器移动窗口）：覆盖人物本体 +
   *  等级徽章及下方区域。点按/按住 = 钓鱼（蓄力/收线），按住并拖动 = OS 原生移窗（无重影）。
   *  仅 idle / charge 态显示（钓鱼会话期间隐藏，让位给小游戏/咬钩/结算的整窗交互）。 */
  private petHit: HTMLElement | null = null
  /** 人物交互区矩形（窗口坐标，= 点击穿透判定区，也是钓鱼/拖窗命中区） */
  private petHandleRect = { l: 0, t: 0, r: 0, b: 0 }
  /** 身体区混合手势状态机（点一下钓 / 按住拖 的判定，逻辑集中在 gesture.ts 便于测试） */
  private gesture = newGestureState()
  /** 捕获指针移动超过 12 CSS px 才启动 OS 拖窗；此前窗口保持原位。 */
  private readonly dragThreshold = 12
  /** 尚未启动系统移窗时的指针起点。 */
  private bodyOrigin = { x: 0, y: 0 }
  private bodyPointerId: number | null = null
  private bodyGestureId = 0
  private inputRegionSignature = ''
  private inputRegionFailed = false
  /** 本次 DOM 身体按住或原生拖动仍未结束。 */
  private bodyPressing = false
  /** 本次身体手势是否已判定为"拖窗"（用于松手时不误触发抛竿） */
  private bodyDragging = false
  /** 看门狗定时器：原生拖窗结束后 mouseup 若被系统吞掉，兜底清理手势记账 */
  private bodyWatchdog: number | null = null
  private waterReminderElapsed = 0
  private sedentaryReminderElapsed = 0
  private reminderOverlay: HTMLElement | null = null
  private reminderDialog: HTMLElement | null = null
  private reminderTitle: HTMLElement | null = null
  private reminderText: HTMLElement | null = null
  private reminderKind: 'water' | 'sedentary' | null = null

  /** 主进程桥（拖拽/退出/自启/点击穿透） */
  private bridge: PetBridge | undefined
  /** 当前 pet 拖拽/钓鱼层是否可见（仅在「空闲且无弹窗」时显示；弹窗/钓鱼中隐藏，避免拖拽层吞掉菜单点击） */
  private petLayersVisible = true

  // ---------- 点击穿透（缩小"可点击区域"，避免干扰工作） ----------
  /** 当前已生效的 OS 侧穿透状态（true=窗口对鼠标透明）。仅在翻转时通知主进程，避免每帧 IPC 抖动。
   *  初值取 false（可交互）：指针位置未知时保守不穿透，待主进程启动推送 / 首次 mousemove 后
   *  自动 reconciliation（空闲且指针在空白区→立刻置为穿透）。 */
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
    this.input.onStealthToggle = () => this.toggleStealth()
    // 弹窗开着时屏蔽钓鱼按下（图鉴/玩法说明覆盖层透明于指针，穿透的点击不应误起蓄力）
    this.input.inputBlocked = () => this.anyOverlayOpen()
    this.input.onCancel = () => {
      if (!this.input.held && this.controller.stateName === 'charge') this.controller.abort()
    }

    const bridge = getPetBridge()
    this.bridge = bridge
    this.localMusic = new LocalMusicLibrary(bridge ?? {})
    this.audio.onMusicError = (message) => {
      this.musicSelectionRevision++
      this.save.data.localBgm = null
      this.save.data.bgm = null
      this.save.save()
      this.setMusicStatus(message, true)
    }
    // 本地选曲优先；重启后直到首次真实用户操作才读取、解码和播放。
    const savedLocal = this.save.data.localBgm
    if (typeof savedLocal === 'string' && savedLocal) {
      this.audio.setLocalMusic(savedLocal, () => this.localMusic.read(savedLocal), true)
    } else this.audio.bgm.play(this.save.data.bgm ?? null)
    // 启动时主进程推送一次指针相对画布的位置：从第一帧起就拥有正确的穿透判定，
    // 消除"鼠标恰好停在人物上且不动 → 点击被穿透到下方窗口"的启动竞态。
    bridge?.onPointerInit((p) => this.setPointer(p.x, p.y))
    // Tauri 点击穿透无 forward 模式：窗口透明后页面收不到 mousemove，指针位置改由
    // Rust 轮询线程持续上报（pointer-move）。Electron 下该事件不触发，仍走 document mousemove。
    bridge?.onPointerMove((p) => this.setPointer(p.x, p.y))

    // 人物与徽章统一点击区。DOM 负责普通点击/蓄力与指针捕获，
    // 超过拖动阈值才启动一次 OS 移窗，避免原生拖窗干扰焦点和蓄力。
    const CAT_DW = T.PLAYER_W * T.PLAYER_SCALE
    const CAT_DH = T.PLAYER_H * T.PLAYER_SCALE
    const charL = T.PLAYER_X - CAT_DW / 2
    const charT = T.PLAYER_FOOT_Y - CAT_DH
    const charB = T.PLAYER_FOOT_Y
    const badgeR = Math.min(T.VIEW_W - 1, T.PLAYER_X + CAT_DW / 2 + 4 + 68)
    // 人物交互区 = 人物本体 + 等级徽章及「其下方区域」（含徽章右侧那一列空当）。
    // 底部留白避免盖住右下角工具按钮（TOOLS_BTN 位于 x:318 y:368 r:12）。
    const hL = charL - 6
    const hT = charT - 6
    const hR = badgeR + 2
    const hB = Math.min(T.TOOLS_BTN.y - T.TOOLS_BTN.hitHalf - 1, charB + 10)
    this.petHandleRect = { l: hL, t: hT, r: hR, b: hB }
    const w = hR - hL
    const hh = hB - hT

    const hit = document.createElement('div')
    hit.id = 'pet-hit'
    hit.setAttribute('role', 'button')
    hit.setAttribute('aria-label', '钓鱼人物：按住蓄力，松开抛竿，拖动移动')
    hit.setAttribute('aria-keyshortcuts', 'C Space')
    hit.tabIndex = 0
    hit.style.position = 'absolute'
    hit.style.left = `${hL}px`
    hit.style.top = `${hT}px`
    hit.style.width = `${w}px`
    hit.style.height = `${hh}px`
    hit.style.cursor = 'grab'
    hit.style.touchAction = 'none'
    // 不设置 CSS app-region（会吞 DOM 按下）或 data-tauri-drag-region。
    // 后者会额外启动一次拖窗，且双击默认执行最大化；统一让 Rust 在记录基准后启动原生拖窗。
    ;(document.getElementById('stage') as HTMLElement).appendChild(hit)
    this.petHit = hit

    // 防系统右键菜单（drag 区域右键可能弹出系统菜单）
    hit.addEventListener('contextmenu', (e) => e.preventDefault())
    // 普通点击由 DOM 捕获，只有明确移动越阈才交给系统拖窗。
    hit.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0 || e.isPrimary === false || this.bodyPressing || this.view.stealth || this.anyOverlayOpen()) return
      e.preventDefault()
      this.bodyGestureId++
      this.bodyPointerId = e.pointerId
      this.bodyOrigin = { x: e.clientX, y: e.clientY }
      this.bodyPressing = true
      this.bodyDragging = false
      stepGesture(this.gesture, { kind: 'down' }, this.dragThreshold)
      this.input.beginBodyHoldFromClient(e.clientX, e.clientY, e.pointerId)
      hit.setPointerCapture(e.pointerId)
      this.updateClickThrough()
    })
    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.bodyPressing || this.bodyDragging || e.pointerId !== this.bodyPointerId) return
      const verdict = stepGesture(this.gesture, {
        kind: 'pointer-move', dx: e.clientX - this.bodyOrigin.x, dy: e.clientY - this.bodyOrigin.y
      }, this.dragThreshold)
      if (verdict.type !== 'drag-begin') return
      // 先取消蓄力再释放捕获；失去捕获不能结束已经交给 OS 的拖动。
      this.abortBodyDrag()
      this.releaseBodyCapture()
      this.bridge?.bodyDragBegin(this.bodyGestureId)
      this.armBodyWatchdog()
    })
    window.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerId !== this.bodyPointerId) return
      this.finishBodyGesture(false)
    })
    const cancelBody = (e: PointerEvent) => {
      if (e.pointerId !== this.bodyPointerId || this.bodyDragging) return
      this.finishBodyGesture(true)
    }
    window.addEventListener('pointercancel', cancelBody)
    hit.addEventListener('lostpointercapture', cancelBody)
    this.bridge?.onBodyMoved(() => {})
    this.bridge?.onBodyReleased?.((d) => {
      if (!this.bodyDragging || (d.gestureId !== undefined && d.gestureId !== this.bodyGestureId)) return
      this.finishBodyGesture(false)
    })
    window.addEventListener('blur', () => {
      if (this.controller.stateName === 'charge') this.controller.abort()
      if (this.bodyDragging) return
      this.finishBodyGesture(true)
    })

    // 点击菜单/弹窗外任意位置即关闭：统一在捕获阶段拦截，落点在内容区之外就关掉对应面板。
    document.addEventListener('pointerdown', (e: PointerEvent) => this.onDocPointerDown(e), true)

    // 右下角工具按钮：点击弹出 设置 / 音效 / 退出
    const t = T.TOOLS_BTN
    this.input.toolsHitTest = (x, y) => x >= t.x - t.hitHalf && x < t.x + t.hitHalf &&
      y >= t.y - t.hitHalf && y < t.y + t.hitHalf
    this.input.onTools = () => this.toggleMenuButton()
    this.buildToolsMenu(bridge)
    this.buildReminderOverlay()
    const toolsButton = document.createElement('button')
    toolsButton.id = 'tools-toggle'
    toolsButton.type = 'button'
    toolsButton.setAttribute('aria-label', '菜单')
    toolsButton.setAttribute('aria-expanded', 'false')
    toolsButton.setAttribute('aria-controls', 'tools-overlay')
    toolsButton.title = '菜单（再次点击关闭面板）'
    Object.assign(toolsButton.style, {
      left: `${t.x - t.hitHalf}px`, top: `${t.y - t.hitHalf}px`,
      width: `${t.hitHalf * 2}px`, height: `${t.hitHalf * 2}px`
    })
    toolsButton.addEventListener('pointerdown', (e) => this.input.handlePointerDown(e, toolsButton))
    toolsButton.addEventListener('lostpointercapture', () => this.input.cancelToolsPress())
    toolsButton.addEventListener('click', (e) => {
      // Pointer clicks are completed by Input on pointerup; Enter/Space uses native button activation.
      if (e.detail !== 0) return
      this.input.onAnyKey?.()
      this.input.onTools?.()
    })
    toolsButton.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') e.stopPropagation()
    })
    toolsButton.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') e.stopPropagation()
    })
    this.canvas.parentElement?.appendChild(toolsButton)
    this.toolsButton = toolsButton
    this.buildPickers()
    // 玩法说明弹窗：点关闭按钮关闭；点对话框之外任意处关闭由统一的 onDocPointerDown 处理。
    this.helpOverlay = document.getElementById('help-overlay') as HTMLElement
    this.helpDialog = document.getElementById('help-dialog')
    const helpClose = document.getElementById('help-close')
    helpClose?.addEventListener('click', (e) => { e.stopPropagation(); this.toggleHelp(false) })

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

    // 通知主进程：渲染层已就绪，可显示窗口（消除白屏）并推送一次指针位置。
    // Electron 下该桥为 no-op（窗口由 ready-to-show 自行显示）。
    this.frame()
    bridge?.markReady()
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
    this.updateReminders(dt)
  }

  private frame(): void {
    const state = this.controller.getSceneState(this.time)
    this.ctx.imageSmoothingEnabled = false
    this.ctx.clearRect(0, 0, T.VIEW_W, T.VIEW_H) // 透明：不填充背景
    // 悬停高亮：指针在工具按钮上时按钮变亮
    const px = this.input.pointerX
    const py = this.input.pointerY
    this.view.toolsHover = !!this.input.toolsHitTest?.(px, py)
    this.view.overlayOpen = this.anyOverlayOpen()
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
    const overlayOpen = this.anyOverlayOpen()
    this.forceInteractive = active || overlayOpen
    this.updateClickThrough()
    this.updatePetLayers()
    this.updateWindowRegion()

    // 光标：身体交互层（#pet-hit）本身显示 grab/grabbing，窗体其余区域显示 pointer 暗示可点击钓鱼
    this.canvas.style.cursor = 'pointer'
  }

  /** 构建工具菜单（DOM 覆盖层）：
   *  一级目录 = 玩法相关 + BGM：玩法说明 / 图鉴 / BGM
   *  二级「设置 ▸」= 音效 / 隐身 / 自启 / 喝水提醒 / 久坐提醒 / 退出
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

    // 玩法相关：一级目录（三个图鉴各自独立面板，不收成一个"图鉴"）
    topBtn('玩法说明', () => this.toggleHelp(true))
    topBtn('形象', () => this.toggleChar(true))
    topBtn('鱼图鉴', () => this.toggleFish(true))
    topBtn('鱼竿', () => this.toggleRod(true))

    // 「设置 ▸」二级目录
    const settingsBtn = document.createElement('button')
    const settingsLabel = document.createElement('span')
    settingsLabel.textContent = '设置'
    const settingsArrow = document.createElement('span')
    settingsArrow.className = 'menu-arrow'
    settingsArrow.textContent = '▸'
    settingsBtn.append(settingsLabel, settingsArrow)
    settingsBtn.setAttribute('aria-expanded', 'false')
    const sub = document.createElement('div')
    sub.id = 'tools-submenu'
    sub.className = 'submenu'

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

    const setToggleLabel = (button: HTMLElement, label: string, on: boolean) => {
      button.textContent = ''
      const name = document.createElement('span')
      name.className = 'menu-label'
      name.textContent = label
      const value = document.createElement('span')
      value.className = 'menu-value'
      value.textContent = on ? '开' : '关'
      button.append(name, value)
    }
    const soundBtn = subBtn('', () => {
      this.audio.setMuted(!this.audio.muted)
      setToggleLabel(soundBtn, '音效', !this.audio.muted)
    })
    setToggleLabel(soundBtn, '音效', !this.audio.muted)
    soundBtn.title = 'M'
    soundBtn.setAttribute('aria-keyshortcuts', 'M')

    // BGM 是一级入口；曲目列表仍用独立面板，避免把设置挤成长三级菜单。
    const bgmBtn = document.createElement('button')
    bgmBtn.className = 'submenu-parent'
    const bgmCurrent = document.createElement('span')
    bgmCurrent.className = 'bgm-current-name'
    bgmBtn.appendChild(bgmCurrent)
    // 直接挂在一级菜单（测试用的轻量 DOM 也只实现 appendChild）。
    menu.appendChild(bgmBtn)
    // BGM 后再放设置，一级菜单顺序为：玩法/图鉴 → BGM → 设置。
    menu.appendChild(settingsBtn)
    menu.appendChild(sub)
    const bgmSub = document.createElement('div')
    bgmSub.id = 'bgm-list'
    bgmSub.className = 'picker'
    this.musicPicker = bgmSub
    const musicPanel = document.createElement('div')
    musicPanel.className = 'panel'
    musicPanel.setAttribute('role', 'dialog')
    musicPanel.setAttribute('aria-labelledby', 'music-title')
    const head = document.createElement('div')
    head.className = 'codex-head'
    const heading = document.createElement('h3')
    heading.id = 'music-title'
    heading.textContent = '音乐'
    const musicClose = document.createElement('button')
    musicClose.className = 'close'
    musicClose.textContent = '✕'
    musicClose.setAttribute('aria-label', '关闭音乐')
    musicClose.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMusic(false) })
    head.append(heading, musicClose)
    const nowPlaying = document.createElement('div')
    nowPlaying.id = 'music-now-playing'
    const musicScroll = document.createElement('div')
    musicScroll.className = 'music-scroll'
    musicPanel.append(head, nowPlaying, musicScroll)
    bgmSub.appendChild(musicPanel)
    ;(document.getElementById('stage') as HTMLElement).appendChild(bgmSub)

    const bgmEntries: Array<{ id: BgmTrackId | null; btn: HTMLButtonElement }> = []
    const offBtn = document.createElement('button')
    offBtn.className = 'submenu-leaf'
    offBtn.id = 'music-stop'
    nowPlaying.appendChild(offBtn)
    bgmEntries.push({ id: null, btn: offBtn })

    const importBtn = document.createElement('button')
    importBtn.id = 'music-import'
    importBtn.textContent = '＋ 添加音乐'
    importBtn.title = '选择 MP3、OGG、WAV 或 FLAC，单首不超过 50 MB'
    const fileInput = document.createElement('input')
    fileInput.id = 'music-file-input'
    fileInput.type = 'file'
    fileInput.multiple = true
    fileInput.accept = '.mp3,.ogg,.wav,.flac,audio/mpeg,audio/ogg,audio/wav,audio/flac'
    fileInput.hidden = true
    fileInput.setAttribute('aria-label', '选择本地音乐文件')
    musicPanel.appendChild(fileInput)
    const status = document.createElement('div')
    status.id = 'music-status'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    musicPanel.appendChild(status)
    const localList = document.createElement('div')
    localList.id = 'local-music-list'
    localList.setAttribute('role', 'list')
    const ambientHeading = document.createElement('div')
    ambientHeading.className = 'music-section-title'
    ambientHeading.textContent = '自然与远方'
    const synthList = document.createElement('div')
    synthList.className = 'bgm-synth-list'
    const localHeading = document.createElement('div')
    localHeading.className = 'music-section-title'
    localHeading.textContent = '我的音乐'
    const emptyLibrary = document.createElement('div')
    emptyLibrary.id = 'music-empty'
    emptyLibrary.textContent = '收藏一段喜欢的旋律'
    musicScroll.append(ambientHeading, synthList, localHeading, localList, emptyLibrary)
    musicPanel.appendChild(importBtn)

    const refreshBgm = (): void => {
      const cur = this.audio.bgm.playing
      const local = this.audio.localMusic.playing
      bgmCurrent.textContent = this.bgmLabel()
      bgmBtn.title = this.bgmLabel()
      bgmBtn.setAttribute('aria-haspopup', 'dialog')
      offBtn.title = local || cur ? '停止背景音乐，保留钓鱼音效' : '当前只播放钓鱼音效'
      for (const e of bgmEntries) {
        const on = !local && e.id === cur
        e.btn.classList.toggle('active', on)
        e.btn.setAttribute('aria-pressed', String(on))
        if (!e.id) e.btn.textContent = local || cur ? '■ 停止背景音乐' : '♪ 仅钓鱼音效'
        e.btn.title = e.id ? `${bgmName(e.id)}（再点一次关闭）` : offBtn.title
      }
      importBtn.disabled = !this.localMusic.available || this.musicLibraryBusy || this.musicLibraryLoading
      importBtn.textContent = this.musicLibraryBusy ? '正在处理…' : '＋ 添加音乐'
      emptyLibrary.hidden = this.localMusicTracks.length > 0
      status.textContent = this.musicStatus || (this.musicLibraryLoading ? '正在载入音乐…'
        : !this.localMusic.available ? '桌面版可添加自己的音乐' : '')
      status.title = status.textContent
      status.classList.toggle('error', this.musicStatusError)
      localList.textContent = ''
      for (const track of this.localMusicTracks) {
        const row = document.createElement('div')
        row.className = 'local-music-row'
        row.dataset.musicId = track.id
        row.setAttribute('role', 'listitem')
        const play = document.createElement('button')
        play.className = 'local-music-play'
        const on = local === track.id
        play.classList.toggle('active', on)
        play.setAttribute('aria-pressed', String(on))
        play.setAttribute('aria-label', `${on ? '停止' : '播放'} ${track.name}`)
        play.title = `${track.name}（${on ? '再点一次关闭' : '播放'}）`
        const name = document.createElement('span')
        name.className = 'local-music-name'
        name.textContent = track.name
        const action = document.createElement('span')
        action.className = 'local-music-action'
        action.textContent = on ? '■' : '▶'
        action.setAttribute('aria-hidden', 'true')
        play.append(name, action)
        play.addEventListener('click', (e) => { e.stopPropagation(); this.pickLocalMusic(track) })
        row.appendChild(play)
        if (track.source !== 'folder') {
          const remove = document.createElement('button')
          remove.className = 'local-music-remove'
          remove.textContent = '移除'
          remove.title = `从桌宠音乐库移除 ${track.name}，不影响原文件`
          remove.setAttribute('aria-label', `移除 ${track.name}`)
          remove.disabled = this.musicLibraryBusy
          remove.addEventListener('click', (e) => { e.stopPropagation(); void this.removeLocalMusic(track) })
          row.appendChild(remove)
        }
        localList.appendChild(row)
      }
    }
    const bgmPick = (id: BgmTrackId | null): void => {
      this.musicSelectionRevision++
      const next = id !== null && this.audio.bgm.playing === id ? null : id
      this.audio.setBgm(next)
      this.save.data.bgm = next
      this.save.data.localBgm = null
      this.save.save()
      this.musicStatus = ''
      this.musicStatusError = false
      refreshBgm()
    }
    offBtn.addEventListener('click', (e) => { e.stopPropagation(); bgmPick(null) })
    for (const { id } of BGM_TRACKS) {
      const b = document.createElement('button')
      b.className = 'submenu-leaf'
      const name = document.createElement('span')
      name.textContent = bgmShortName(id)
      const detail = document.createElement('span')
      detail.className = 'music-track-detail'
      detail.textContent = id === 'forest-rain' ? '柔和绵雨 · 放松入眠' : '远处人声 · 偶有广播'
      b.append(name, detail)
      b.setAttribute('aria-label', bgmShortName(id))
      b.addEventListener('click', (e) => { e.stopPropagation(); bgmPick(id) })
      synthList.appendChild(b)
      bgmEntries.push({ id, btn: b })
    }
    importBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (importBtn.disabled) return
      fileInput.value = ''
      fileInput.click()
    })
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files ?? [])
      fileInput.value = ''
      if (files.length) void this.importLocalMusic(files)
    })
    this.refreshMusicUi = refreshBgm
    refreshBgm()
    void this.refreshLocalMusicLibrary()
    bgmBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleTools(false)
      this.toggleMusic(true)
    })

    const stealthBtn = subBtn('', () => this.toggleStealth())
    this.refreshStealthUi = () => {
      setToggleLabel(stealthBtn, '隐身', this.view.stealth)
      stealthBtn.setAttribute('aria-keyshortcuts', 'H')
      stealthBtn.title = 'H'
    }
    this.refreshStealthUi()
    const autoBtn = subBtn('', () => {
      this.save.data.autostart = !this.save.data.autostart
      this.save.save()
      setToggleLabel(autoBtn, '开机自启', this.save.data.autostart)
      bridge?.setAutostart(this.save.data.autostart)
    })
    setToggleLabel(autoBtn, '开机自启', this.save.data.autostart ?? false)
    const setReminderLabel = (button: HTMLButtonElement, label: string, on: boolean, minutes: number): HTMLInputElement => {
      setToggleLabel(button, label, on)
      const input = document.createElement('input')
      input.className = 'reminder-interval'
      input.type = 'number'
      input.min = String(MIN_REMINDER_MINUTES)
      input.max = String(MAX_REMINDER_MINUTES)
      input.step = '1'
      input.value = String(minutes)
      input.setAttribute('aria-label', `${label}间隔（分钟）`)
      input.title = `${MIN_REMINDER_MINUTES}-${MAX_REMINDER_MINUTES} 分钟`
      // The number field is inside the menu button so it stays aligned with the toggle.
      // Stop the event here to avoid toggling/closing the parent button while editing.
      for (const event of ['pointerdown', 'mousedown', 'click']) input.addEventListener(event, (e) => e.stopPropagation())
      button.appendChild(input)
      return input
    }
    const waterBtn = subBtn('', () => {
      this.save.data.waterReminder = !(this.save.data.waterReminder ?? false)
      this.waterReminderElapsed = 0
      this.save.save()
      refreshWaterReminder()
    })
    const waterInterval = setReminderLabel(
      waterBtn,
      '喝水提醒',
      this.save.data.waterReminder ?? false,
      normalizeReminderMinutes(this.save.data.waterReminderMinutes, DEFAULT_WATER_REMINDER_MINUTES)
    )
    const refreshWaterReminder = (): void => {
      const minutes = normalizeReminderMinutes(this.save.data.waterReminderMinutes, DEFAULT_WATER_REMINDER_MINUTES)
      this.save.data.waterReminderMinutes = minutes
      setToggleLabel(waterBtn, '喝水提醒', this.save.data.waterReminder ?? false)
      waterBtn.appendChild(waterInterval)
      waterInterval.value = String(minutes)
      waterBtn.title = `每 ${minutes} 分钟提醒一次`
    }
    const sedentaryBtn = subBtn('', () => {
      this.save.data.sedentaryReminder = !(this.save.data.sedentaryReminder ?? false)
      this.sedentaryReminderElapsed = 0
      this.save.save()
      refreshSedentaryReminder()
    })
    const sedentaryInterval = setReminderLabel(
      sedentaryBtn,
      '久坐提醒',
      this.save.data.sedentaryReminder ?? false,
      normalizeReminderMinutes(this.save.data.sedentaryReminderMinutes, DEFAULT_SEDENTARY_REMINDER_MINUTES)
    )
    const refreshSedentaryReminder = (): void => {
      const minutes = normalizeReminderMinutes(this.save.data.sedentaryReminderMinutes, DEFAULT_SEDENTARY_REMINDER_MINUTES)
      this.save.data.sedentaryReminderMinutes = minutes
      setToggleLabel(sedentaryBtn, '久坐提醒', this.save.data.sedentaryReminder ?? false)
      sedentaryBtn.appendChild(sedentaryInterval)
      sedentaryInterval.value = String(minutes)
      sedentaryBtn.title = `每 ${minutes} 分钟提醒一次`
    }
    const commitReminderInterval = (kind: 'water' | 'sedentary', input: HTMLInputElement): void => {
      const fallback = kind === 'water' ? DEFAULT_WATER_REMINDER_MINUTES : DEFAULT_SEDENTARY_REMINDER_MINUTES
      const minutes = normalizeReminderMinutes(Number(input.value), fallback)
      input.value = String(minutes)
      if (kind === 'water') {
        this.save.data.waterReminderMinutes = minutes
        this.waterReminderElapsed = 0
        refreshWaterReminder()
      } else {
        this.save.data.sedentaryReminderMinutes = minutes
        this.sedentaryReminderElapsed = 0
        refreshSedentaryReminder()
      }
      this.save.save()
    }
    waterInterval.addEventListener('change', () => commitReminderInterval('water', waterInterval))
    waterInterval.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitReminderInterval('water', waterInterval) } })
    sedentaryInterval.addEventListener('change', () => commitReminderInterval('sedentary', sedentaryInterval))
    sedentaryInterval.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitReminderInterval('sedentary', sedentaryInterval) } })
    refreshWaterReminder()
    refreshSedentaryReminder()
    // 退出也收进设置二级目录
    subBtn('退出', () => bridge?.quit())

    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const open = !sub.classList.contains('visible')
      settingsBtn.setAttribute('aria-expanded', String(open))
      settingsArrow.textContent = open ? '◂' : '▸'
      setToggleLabel(soundBtn, '音效', !this.audio.muted)
      refreshWaterReminder()
      refreshSedentaryReminder()
      if (open) {
        sub.classList.add('visible')
        this.fitMenuToViewport(sub, settingsBtn)
      } else {
        sub.classList.remove('visible')
        this.fitMenuToViewport(null)
      }
    })
    menu.addEventListener('click', (e) => e.stopPropagation())
    overlay.appendChild(menu)
    ;(document.getElementById('stage') as HTMLElement).appendChild(overlay)
    this.toolsOverlay = overlay
    this.toolsSubmenu = sub
    this.toolsMenuEl = menu
    this.toolsSettingsBtn = settingsBtn
  }

  /** 创建提醒弹层。提示使用独立 DOM，不会把文字绘制到人物画布上。 */
  private buildReminderOverlay(): void {
    const stage = document.getElementById('stage') as HTMLElement | null
    if (!stage) return
    const overlay = document.createElement('div')
    overlay.id = 'reminder-overlay'
    overlay.className = 'reminder-overlay'
    overlay.setAttribute('aria-hidden', 'true')
    const dialog = document.createElement('div')
    dialog.className = 'reminder-dialog'
    dialog.setAttribute('role', 'alertdialog')
    dialog.setAttribute('aria-modal', 'true')
    const title = document.createElement('h3')
    const text = document.createElement('p')
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.className = 'reminder-dismiss'
    dismiss.textContent = '知道了'
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation()
      this.dismissReminder()
    })
    dialog.append(title, text, dismiss)
    overlay.appendChild(dialog)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismissReminder()
    })
    stage.appendChild(overlay)
    this.reminderOverlay = overlay
    this.reminderDialog = dialog
    this.reminderTitle = title
    this.reminderText = text
  }

  private updateReminders(dt: number): void {
    if (this.save.data.waterReminder) {
      this.waterReminderElapsed += dt
      const waterSeconds = normalizeReminderMinutes(this.save.data.waterReminderMinutes, DEFAULT_WATER_REMINDER_MINUTES) * 60
      if (this.waterReminderElapsed >= waterSeconds && !this.reminderKind) {
        this.waterReminderElapsed = 0
        this.showReminder('water')
      }
    } else {
      this.waterReminderElapsed = 0
    }
    if (this.save.data.sedentaryReminder) {
      this.sedentaryReminderElapsed += dt
      const sedentarySeconds = normalizeReminderMinutes(this.save.data.sedentaryReminderMinutes, DEFAULT_SEDENTARY_REMINDER_MINUTES) * 60
      if (this.sedentaryReminderElapsed >= sedentarySeconds && !this.reminderKind) {
        this.sedentaryReminderElapsed = 0
        this.showReminder('sedentary')
      }
    } else {
      this.sedentaryReminderElapsed = 0
    }
  }

  private showReminder(kind: 'water' | 'sedentary'): void {
    if (!this.reminderOverlay || !this.reminderTitle || !this.reminderText) return
    this.reminderKind = kind
    const water = kind === 'water'
    this.reminderTitle.textContent = water ? '喝水时间' : '起来活动一下'
    this.reminderText.textContent = water ? '大姐姐，该喝水啦' : '大姐姐，站起来走走吧'
    this.reminderOverlay.classList.add('visible')
    this.reminderOverlay.setAttribute('aria-hidden', 'false')
    this.updateDragWhileOverlay()
    // 只为小新保留语音接口；没有随包提供授权音频时 AudioBus 会静默失败。
    this.audio.playReminderVoice(kind, this.skin)
    const dismiss = this.reminderDialog?.querySelector('button') as HTMLButtonElement | null
    dismiss?.focus?.()
  }

  private dismissReminder(): void {
    this.reminderKind = null
    this.reminderOverlay?.classList.remove('visible')
    this.reminderOverlay?.setAttribute('aria-hidden', 'true')
    this.updateDragWhileOverlay()
  }

  private toggleStealth(): void {
    this.view.stealth = !this.view.stealth
    if (this.view.stealth) this.finishBodyGesture(true)
    this.save.data.stealth = this.view.stealth
    this.save.save()
    this.refreshStealthUi?.()
    // 同步像素、DOM命中层与原生热区，隐去的人物不能吞掉桌面点击。
    this.frame()
  }

  /** 「BGM」入口标签：显示当前曲目短名，未选中时显示「钓鱼音效」（▸/▾ 由 CSS ::after 提供） */
  private bgmLabel(): string {
    const local = this.audio.localMusic.playing
    if (local) return `BGM：${this.localMusicTracks.find((track) => track.id === local)?.name ?? '本地音乐'}`
    return `BGM：${this.audio.bgm.playing ? bgmShortName(this.audio.bgm.playing) : '钓鱼音效'}`
  }

  private setMusicStatus(message: string, error = false): void {
    this.musicStatus = message
    this.musicStatusError = error
    this.refreshMusicUi?.()
  }

  private async refreshLocalMusicLibrary(): Promise<void> {
    if (!this.localMusic.available || this.musicLibraryBusy) return
    const revision = ++this.musicLibraryRevision
    const selection = this.musicSelectionRevision
    this.musicLibraryLoading = true
    this.musicStatus = ''
    this.musicStatusError = false
    this.refreshMusicUi?.()
    try {
      const tracks = await this.localMusic.list()
      if (revision !== this.musicLibraryRevision || selection !== this.musicSelectionRevision) return
      this.localMusicTracks = Array.from(new Map(tracks.map((track) => [track.id, track])).values())
      const selected = this.audio.localMusic.playing
      if (selected && !this.localMusicTracks.some((track) => track.id === selected)) {
        this.audio.setBgm(null)
        this.save.data.localBgm = null
        this.save.data.bgm = null
        this.save.save()
        this.musicSelectionRevision++
        this.musicStatus = '当前音乐已移除，请重新选择。'
      }
    } catch (error) {
      if (revision === this.musicLibraryRevision && selection === this.musicSelectionRevision) {
        this.setMusicStatus(this.musicErrorText(error), true)
      }
    } finally {
      if (revision === this.musicLibraryRevision) {
        this.musicLibraryLoading = false
        this.refreshMusicUi?.()
      }
    }
  }

  private pickLocalMusic(track: LocalMusicTrack, toggle = true): void {
    this.musicSelectionRevision++
    const id = toggle && this.audio.localMusic.playing === track.id ? null : track.id
    this.save.data.localBgm = id
    this.save.data.bgm = null
    this.save.save()
    this.musicStatus = ''
    this.musicStatusError = false
    this.audio.setLocalMusic(id, id ? () => this.localMusic.read(id) : null)
    this.refreshMusicUi?.()
  }

  private async importLocalMusic(files: File[]): Promise<void> {
    if (this.musicLibraryBusy || !files.length) return
    this.musicLibraryBusy = true
    this.musicLibraryLoading = false
    ++this.musicLibraryRevision
    const selection = this.musicSelectionRevision
    const existingIds = new Set(this.localMusicTracks.map((track) => track.id))
    this.setMusicStatus('正在导入…')
    try {
      const imported = await this.localMusic.import(files)
      const all = new Map(this.localMusicTracks.map((track) => [track.id, track]))
      for (const track of imported) all.set(track.id, track)
      this.localMusicTracks = Array.from(all.values())
      const next = imported.find((track) => !existingIds.has(track.id)) ?? imported[0]
      // 导入期间若用户已选另一首，不让晚到的导入结果覆盖新选择。
      if (next && selection === this.musicSelectionRevision) this.pickLocalMusic(next, false)
      if (!this.musicStatusError) this.setMusicStatus(imported.length ? `已导入 ${imported.length} 首音乐` : '没有新增音乐')
    } catch (error) {
      this.setMusicStatus(this.musicErrorText(error), true)
    } finally {
      this.musicLibraryBusy = false
      this.refreshMusicUi?.()
    }
  }

  private async removeLocalMusic(track: LocalMusicTrack): Promise<void> {
    if (this.musicLibraryBusy || track.source === 'folder') return
    this.musicLibraryBusy = true
    this.musicLibraryLoading = false
    ++this.musicLibraryRevision
    this.setMusicStatus('正在移除…')
    try {
      await this.localMusic.remove(track.id)
      this.localMusicTracks = this.localMusicTracks.filter((item) => item.id !== track.id)
      if (this.audio.localMusic.playing === track.id) {
        this.musicSelectionRevision++
        this.audio.setBgm(null)
        this.save.data.localBgm = null
        this.save.data.bgm = null
        this.save.save()
      }
      this.setMusicStatus('已移除，原文件不受影响')
    } catch (error) {
      this.setMusicStatus(this.musicErrorText(error), true)
    } finally {
      this.musicLibraryBusy = false
      this.refreshMusicUi?.()
    }
  }

  private musicErrorText(error: unknown): string {
    return typeof error === 'string' ? error : error instanceof Error ? error.message : '音乐库操作失败，请重试。'
  }

  /**
   * 工具菜单纵向适配视口。
   *
   * 窗口只有 340×390（减去标题栏/任务栏后可视高度更小），设置二级菜单
   * 需要与一级菜单一起适配视口。BGM 已移到一级菜单并使用独立音乐面板，
   * 不再与设置项叠成三级菜单。
   *
   * 最终策略：**不压缩内容**（曲名一行放得下），改为整体自适应——
   *   · 测出「一级菜单 + 已展开的设置二级菜单」的真实总高；
   *   · 放不下就把整块上移（`--menu-lift`），最多移到窗口顶边留 6px；
   *   · 上移仍放不下，才收紧二级菜单的 `--sub-max-h` 让其内部滚动（兜底，正常不触发）。
   */
  private fitMenuToViewport(sub: HTMLElement | null, anchor?: HTMLElement): void {
    const menu = this.toolsMenuEl
    if (!menu) return
    const EDGE = 6 // 距窗口上下边的最小留白
    const vh = window.innerHeight || document.documentElement.clientHeight

    // 1) 归零后重新量基准：菜单本身的自然位置与自然高度
    menu.style.removeProperty('--menu-lift')
    if (sub) {
      sub.style.removeProperty('--sub-top')
      sub.style.removeProperty('--sub-max-h')
    }
    // 注意：这里必须同步读几何（getBoundingClientRect/scrollHeight 会强制回流），
    // 不能靠过渡结束事件，也不能读缓存值——两次点击在同一帧内连续发生时，
    // 读到的必须是已应用后的真实布局，否则整块会算错而顶出窗口。
    const m = menu.getBoundingClientRect()
    const subOpen = !!sub && sub.classList.contains('visible')

    // 2) 二级菜单默认顶端与「设置」按钮对齐（就地展开，不横弹）
    //    subNatural 取「展开状态下」的真实内容高度（scrollHeight 与 rect 取大值）
    const anchorTop = anchor ? anchor.getBoundingClientRect().top : m.top + 30
    const desiredTop = Math.round(anchorTop - m.top)
    const subNatural = subOpen && sub ? Math.max(sub.scrollHeight, sub.getBoundingClientRect().height) : 0
    let subTop = desiredTop
    if (sub) sub.style.setProperty('--sub-top', `${Math.round(subTop)}px`)

    // 3) 二级菜单能贴到窗口顶（顶部留白够不够）——够就让它「向上生长」：
    //    一级菜单底部保持不动，二级菜单顶端按需抬高，于是第三层越往下越长也不会顶出窗口。
    //    （此前二级菜单只能往下长，展开曲目列表后必然把「退出」压出窗口。）
    //    还要预留整块上移的空间（见 3b），否则「先上长、再上移」会重复算一遍而顶穿窗口。
    if (sub && subOpen) {
      const start = desiredTop
      const bottomAtStart = Math.max(m.top + start + subNatural + 4, m.bottom)
      const rawOverflow = bottomAtStart - (vh - EDGE)
      const maxRise = Math.max(0, Math.round(m.top - EDGE))
      const rise = Math.min(maxRise, Math.max(0, Math.round(rawOverflow)))
      subTop = start - rise
      sub.style.setProperty('--sub-top', `${Math.round(subTop)}px`)
    }

    // 3b) 上长之后仍放不下（窗口更矮，如系统任务栏/缩放较大的场景）：整块上移
    const bottomNow = Math.max(m.bottom, m.top + subTop + subNatural + 4)
    const overflow = bottomNow - (vh - EDGE)
    const lift = overflow > 0 ? Math.min(overflow, Math.max(0, m.top - EDGE)) : 0
    if (lift > 0) menu.style.setProperty('--menu-lift', `${Math.round(lift)}px`)

    // 4) 上移后仍不够（极端小窗口）：收紧二级菜单高度，让它内部滚动
    if (!sub || !subOpen) return
    const avail = Math.floor(vh - EDGE - (m.top - lift + subTop + 4))
    if (avail < subNatural) {
      sub.style.setProperty('--sub-max-h', `${Math.max(120, avail)}px`)
      sub.scrollTop = 0
    }
  }

  /** 同一菜单按钮关闭任意已打开面板，空闲时打开一级菜单。 */
  private toggleMenuButton(): void {
    const open = !this.anyOverlayOpen()
    this.toggleHelp(false)
    this.toggleChar(false)
    this.toggleFish(false)
    this.toggleRod(false)
    this.toggleMusic(false)
    this.toggleTools(open)
  }

  /** 切换工具菜单显隐（force 显式指定） */
  private toggleTools(force?: boolean): void {
    this.toolsOpen = force === undefined ? !this.toolsOpen : force
    this.toolsOverlay?.classList.toggle('visible', this.toolsOpen)
    // 关闭/切换时收起二级子菜单与 BGM 曲目列表，避免下次打开残留展开态
    this.toolsSubmenu?.classList.remove('visible')
    this.toolsSettingsBtn?.setAttribute('aria-expanded', 'false')
    const settingsArrow = this.toolsSettingsBtn?.querySelector('.menu-arrow')
    if (settingsArrow) settingsArrow.textContent = '▸'
    // 菜单恢复一级高度：撤销上移与二级菜单定位
    this.toolsMenuEl?.style.removeProperty('--menu-lift')
    this.toolsSubmenu?.style.removeProperty('--sub-top')
    this.toolsSubmenu?.style.removeProperty('--sub-max-h')
    this.updateDragWhileOverlay()
  }

  /** 切换玩法说明弹窗显隐（force 显式指定） */
  private toggleHelp(force?: boolean): void {
    if (!this.helpOverlay) return
    const open = force === undefined ? !this.helpOverlay.classList.contains('visible') : force
    this.helpOverlay.classList.toggle('visible', open)
    this.updateDragWhileOverlay()
  }

  private toggleMusic(force?: boolean): void {
    if (!this.musicPicker) return
    const open = force ?? !this.musicPicker.classList.contains('visible')
    this.musicPicker.classList.toggle('visible', open)
    if (open) void this.refreshLocalMusicLibrary()
    this.updateDragWhileOverlay()
  }

  /**
   * 任意弹窗打开/关闭时调用：刷新点击穿透判定，并同步 pet 拖拽/钓鱼层显隐。
   * 弹窗期间 forceInteractive 已自动置真，窗口整窗可交互；同时隐藏 pet 层，
   * 否则其覆盖在工具菜单/子菜单区域之上的透明 drag 层会吞掉菜单点击（这正是
   * "点击设置/设置面板都点不动" 的根因）。
   */
  private updateDragWhileOverlay(): void {
    this.toolsButton?.setAttribute('aria-expanded', String(this.anyOverlayOpen()))
    this.updateClickThrough()
    this.updatePetLayers()
  }

  /** 是否任意弹窗（工具菜单/图鉴/音乐/提醒）已打开 */
  private anyOverlayOpen(): boolean {
    return (
      this.toolsOpen ||
      !!this.reminderOverlay?.classList.contains('visible') ||
      !!this.musicPicker?.classList.contains('visible') ||
      !!this.helpOverlay?.classList.contains('visible') ||
      !!this.charPicker?.classList.contains('visible') ||
      !!this.rodPicker?.classList.contains('visible') ||
      !!this.fishPicker?.classList.contains('visible')
    )
  }

  /**
   * 同步 pet 交互层（#pet-hit）显隐：
   *  - idle / charge：显示。idle 时身体区要接钓鱼点击 + 拖窗手势；charge（蓄力按住）
   *    期间保持可见，确保"按住→拖动"整个手势都发生在原生 drag 区域上（若按下后就把层
   *    藏掉，随后的拖动会因指针已不在 drag 区域而失败）；
   *  - cast / wait / hook / minigame / result：隐藏。钓鱼会话期间整窗需要可交互
   *    （小游戏按住抬绿条、咬钩点击、结算点击），且 drag 区域会吞掉这些点击；
   *  - 任意弹窗打开：隐藏。避免透明 drag 层盖住菜单/图鉴（"点设置点不动"的根因）。
   */
  private updatePetLayers(): void {
    const name = this.controller.stateName
    const show = !this.view.stealth && (name === 'idle' || name === 'charge') && !this.anyOverlayOpen()
    if (show === this.petLayersVisible) return
    this.petLayersVisible = show
    const d = show ? '' : 'none'
    if (this.petHit) this.petHit.style.display = d
  }

  private abortBodyDrag(): void {
    if (!this.bodyPressing) return
    this.bodyDragging = true
    this.input.cancelHeld()
    if (!this.input.held) this.controller.abort()
    if (this.petHit) this.petHit.style.cursor = 'grabbing'
  }

  private releaseBodyCapture(): void {
    if (this.bodyPointerId !== null && this.petHit?.hasPointerCapture(this.bodyPointerId)) {
      this.petHit.releasePointerCapture(this.bodyPointerId)
    }
  }

  private finishBodyGesture(cancelled: boolean): void {
    if (!this.bodyPressing) return
    const dragging = this.bodyDragging
    this.bodyPressing = false
    this.bodyDragging = false
    const pointerId = this.bodyPointerId
    this.bodyPointerId = null
    stepGesture(this.gesture, { kind: 'up' }, this.dragThreshold)
    if (dragging || cancelled) {
      this.input.cancelHeld()
      // 仅取消鼠标；仍按住的 C/空格继续拥有普通蓄力。
      if (!this.input.held && this.controller.stateName === 'charge') this.controller.abort()
    } else this.input.endBodyHold()
    if (pointerId !== null && this.petHit?.hasPointerCapture(pointerId)) this.petHit.releasePointerCapture(pointerId)
    if (dragging) this.bridge?.bodyDragEnd(this.bodyGestureId)
    if (this.petHit) this.petHit.style.cursor = 'grab'
    this.disarmBodyWatchdog()
  }

  private armBodyWatchdog(): void {
    this.disarmBodyWatchdog()
    if (this.bridge?.onBodyReleased) return
    this.bodyWatchdog = window.setTimeout(() => this.finishBodyGesture(true), 2500)
  }

  private disarmBodyWatchdog(): void {
    if (this.bodyWatchdog !== null) {
      clearTimeout(this.bodyWatchdog)
      this.bodyWatchdog = null
    }
  }

  /**
   * 任意面板打开时，点击其"内容区之外"的位置即关闭该面板。捕获阶段拦截：
   *  - 工具菜单：内容区 = #tools-menu（含其展开的子菜单）；
   *  - 玩法说明 / 形象 / 鱼图鉴 / 鱼竿：内容区 = 各面板的 .panel。
   * 工具按钮本身不在此处理（由 Input 负责开关菜单）。
   */
  private onDocPointerDown(e: PointerEvent): void {
    if (!this.anyOverlayOpen()) return
    const [x, y] = this.input.clientToCanvas(e)
    if (this.input.toolsHitTest?.(x, y)) return
    const t = e.target as Node | null
    if (this.toolsOpen && shouldCloseOverlay({ overlay: this.toolsOverlay, content: this.toolsMenuEl }, t)) {
      this.toggleTools(false)
    }
    if (shouldCloseOverlay({ overlay: this.helpOverlay, content: this.helpDialog }, t)) this.toggleHelp(false)
    if (shouldCloseOverlay({ overlay: this.musicPicker, content: this.musicPicker?.querySelector('.panel') ?? null }, t)) this.toggleMusic(false)
    if (shouldCloseOverlay({ overlay: this.charPicker, content: this.charPicker?.querySelector('.panel') ?? null }, t)) {
      this.toggleChar(false)
    }
    if (shouldCloseOverlay({ overlay: this.fishPicker, content: this.fishPicker?.querySelector('.panel') ?? null }, t)) {
      this.toggleFish(false)
    }
    if (shouldCloseOverlay({ overlay: this.rodPicker, content: this.rodPicker?.querySelector('.panel') ?? null }, t)) {
      this.toggleRod(false)
    }
    if (!this.anyOverlayOpen()) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  /**
   * 人物可交互命中框（= 点击穿透判定区）：以 petHandleRect 为准 —— 覆盖「人物本体 +
   * 等级徽章及其下方区域」整块区域。落在此区域内 → 窗口恢复可交互
   * （否则点击穿透到下方工作窗口）。工具按钮小圆区被排除（避免与菜单冲突）。
   * @param margin 外扩量：穿透判定用正 margin 做"预热区"（指针还在热点外侧就恢复
   *   可交互，抵消 setClickThrough 的 IPC 一帧延迟，消除"快速扫过人物点不到"的竞态）；
   *   真实命中判定（钓鱼/工具按钮）用 0，保持精确。
   */
  private inPetBody(x: number, y: number, margin = 0): boolean {
    if (this.view.stealth) return false
    const r = this.petHandleRect
    if (x < r.l - margin || x > r.r + margin || y < r.t - margin || y > r.b + margin) return false
    if (margin === 0 && this.input.toolsHitTest && this.input.toolsHitTest(x, y)) return false
    return true
  }

  /** 热点"预热"外扩量（屏幕像素）：穿透判定区比真实命中区大一圈，抵消 IPC 延迟 */
  private readonly ctSlop = 10

  /** 写入指针相对画布坐标并重算点击穿透（被 onPointerInit / onPointerMove / document mousemove 共用） */
  private setPointer(x: number, y: number): void {
    this.ctPtrX = x
    this.ctPtrY = y
    this.updateClickThrough()
  }

  /**
   * 重新计算"是否应让鼠标穿透"并仅在状态翻转时通知主进程（避免每帧 IPC 抖动）。
   * 应穿透的条件：指针已知、且既不在人物身体预热区、也不在工具按钮预热区，
   * 且没有强制可交互（钓鱼中/弹窗）。指针位置未知时（尚未收到任何 mousemove /
   * 启动推送）保守保持可交互——宁可让宠物响应一次误点，也不让宠物"点不动"。
   */
  private updateClickThrough(): void {
    if (this.bridge?.setInputRegions) {
      if (this.bodyPressing || this.forceInteractive || this.anyOverlayOpen()) this.applyInputRegion(null)
      return
    }
    const ptrKnown = this.ctPtrX >= 0 && this.ctPtrY >= 0
    const t = T.TOOLS_BTN
    const overPet = ptrKnown && this.inPetBody(this.ctPtrX, this.ctPtrY, this.ctSlop)
    const overTools = ptrKnown && Math.abs(this.ctPtrX - t.x) < t.hitHalf + this.ctSlop &&
      Math.abs(this.ctPtrY - t.y) < t.hitHalf + this.ctSlop
    const shouldIgnore = ptrKnown && !(overPet || overTools || this.forceInteractive || this.bodyPressing)
    if (shouldIgnore !== this.clickThrough) {
      this.clickThrough = shouldIgnore
      this.bridge?.setClickThrough(shouldIgnore)
    }
  }

  private updateWindowRegion(): void {
    if (!this.bridge?.setInputRegions || this.inputRegionFailed) return
    if (this.bodyPressing || this.forceInteractive || this.anyOverlayOpen()) {
      this.applyInputRegion(null)
      return
    }
    const rect = this.petHandleRect
    const tools = T.TOOLS_BTN
    const targets: InputRect[] = [{
      x: tools.x - tools.hitHalf, y: tools.y - tools.hitHalf, width: tools.hitHalf * 2, height: tools.hitHalf * 2
    }]
    if (this.petLayersVisible) targets.push({ x: rect.l, y: rect.t, width: rect.r - rect.l, height: rect.b - rect.t })
    this.applyInputRegion(canvasInputRegions(this.ctx.getImageData(0, 0, T.VIEW_W, T.VIEW_H), targets))
  }

  private applyInputRegion(regions: InputRect[] | null): void {
    if (this.inputRegionFailed || !this.bridge?.setInputRegions) return
    const signature = `${window.devicePixelRatio}:${JSON.stringify(regions)}`
    if (signature === this.inputRegionSignature) return
    this.inputRegionSignature = signature
    void Promise.resolve(this.bridge.setInputRegions(regions)).catch((error) => {
      this.inputRegionFailed = true
      void this.bridge?.setInputRegions?.(null)
      this.bridge?.setClickThrough(false)
      console.error('Native input region failed', error)
    })
  }

  /** 构建三个独立图鉴面板（形象 / 鱼类 / 钓竿，羊皮纸风，对齐 design/codex-ui.png）：
   *  角色与钓竿一次性烘焙；鱼图标一次性烘焙、卡片每次打开时刷新（反映捕获进度）。
   *  三个面板互斥（打开一个即收起其余），各自 ✕ 关闭，点面板外任意处也可关闭。 */
  private buildPickers(): void {
    this.charPicker = document.getElementById('char-picker')
    this.rodPicker = document.getElementById('rod-picker')
    this.fishPicker = document.getElementById('fish-picker')
    this.charGrid = document.getElementById('char-grid')
    this.rodGrid = document.getElementById('rod-grid')
    this.fishGrid = document.getElementById('fish-grid')

    // —— 形象面板：由角色清单生成待机预览、完整名称与选中态。——
    this.charPreviews = {}
    for (const def of CHARACTER_LIST) {
      this.charPreviews[def.id] = SpriteFactory.build(FISH_TABLE, def.id).playerIdle[0].toDataURL()
    }
    const cg = this.charGrid
    if (cg) {
      cg.innerHTML = ''
      for (const def of CHARACTER_LIST) {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'char-card' + (def.id === this.skin ? ' selected' : '')
        card.dataset.id = def.id
        card.title = def.desc
        card.setAttribute('aria-pressed', String(def.id === this.skin))
        const img = document.createElement('img')
        img.src = this.charPreviews[def.id]
        img.alt = ''
        const nm = document.createElement('div')
        nm.className = 'nm'
        nm.textContent = def.name
        const sl = document.createElement('div')
        sl.className = 'sl'
        sl.textContent = def.id === this.skin ? '使用中' : ''
        card.append(img, nm, sl)
        card.addEventListener('click', () => this.selectCharacter(def.id))
        cg.appendChild(card)
      }
    }

    // —— 鱼竿面板：按竿 id 分型图标（竹绑带/纤维卷线器/秘银星闪/传奇宝石）+ 绿条加成小条 ——
    this.rodIcons = {}
    for (const def of ROD_LIST) {
      this.rodIcons[def.id] = buildRodIcon(def.color, def.id).toDataURL()
    }
    const rg = this.rodGrid
    if (rg) {
      rg.innerHTML = ''
      const owned = this.save.data.rods?.owned ?? ['bamboo']
      const equipped = this.save.data.rods?.equipped ?? 'bamboo'
      for (const def of ROD_LIST) {
        const isOwned = owned.includes(def.id)
        const isEquipped = def.id === equipped
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'rod-card' + (isEquipped ? ' selected' : '') + (isOwned ? '' : ' locked')
        card.dataset.id = def.id
        card.title = def.desc
        card.disabled = !isOwned
        card.setAttribute('aria-pressed', String(isEquipped))
        const img = document.createElement('img')
        img.src = this.rodIcons[def.id]
        img.alt = ''
        const body = document.createElement('div')
        body.className = 'rd-body'
        const nm = document.createElement('div')
        nm.className = 'nm'
        nm.textContent = def.name
        const stat = document.createElement('div')
        stat.className = 'rd-stat'
        stat.textContent = `控鱼加成 +${def.barBonus}`
        const bar = document.createElement('div')
        bar.className = 'rd-bar'
        bar.setAttribute('aria-hidden', 'true')
        const fill = document.createElement('i')
        fill.style.width = `${Math.min(100, (def.barBonus / Math.max(...ROD_LIST.map((r) => r.barBonus))) * 100)}%`
        bar.appendChild(fill)
        const sl = document.createElement('div')
        sl.className = 'sl'
        sl.textContent = isEquipped ? '使用中' : isOwned ? '点击装备' : `Lv.${def.level} 解锁`
        const meta = document.createElement('div')
        meta.className = 'rd-meta'
        meta.append(stat, sl)
        body.append(nm, meta, bar)
        card.append(img, body)
        card.addEventListener('click', () => this.selectRod(def.id))
        rg.appendChild(card)
      }
    }

    // —— 鱼图鉴面板：图标 + 锁定鱼影一次性烘焙（卡片在打开时刷新）——
    this.fishIcons = {}
    this.fishQuestUrl = this.sprites.fishQuest.toDataURL()
    for (const def of FISH_TABLE) {
      this.fishIcons[def.id] = SpriteFactory.buildFishIcon(def).toDataURL()
    }

    // 各面板 ✕ 关闭；点面板外任意处关闭由统一的 onDocPointerDown 处理
    document.getElementById('char-close')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleChar(false)
    })
    document.getElementById('fish-close')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleFish(false)
    })
    document.getElementById('rod-close')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleRod(false)
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
      c.setAttribute('aria-pressed', String(selected))
      const sl = c.querySelector<HTMLElement>('.sl')
      if (sl) sl.textContent = selected ? '使用中' : ''
    })
  }

  /** 选中/装备某根已拥有的竿：实时切换 + 持久化 + 刷新卡片选中态（控制器每步自动读取装备竿） */
  private selectRod(id: string): void {
    const owned = this.save.data.rods?.owned ?? ['bamboo']
    if (!owned.includes(id)) return
    if (this.save.data.rods?.equipped === id) return
    this.save.data.rods = { owned, equipped: id }
    this.save.save()
    this.refreshRodPicker()
  }

  /** 同步升级后新解锁的竿，以及所有卡片的使用/锁定状态。 */
  private refreshRodPicker(): void {
    const owned = this.save.data.rods?.owned ?? ['bamboo']
    const equipped = this.save.data.rods?.equipped ?? 'bamboo'
    this.rodGrid?.querySelectorAll<HTMLButtonElement>('.rod-card').forEach((c) => {
      const def = ROD_LIST.find((rod) => rod.id === c.dataset.id)
      if (!def) return
      const isOwned = owned.includes(def.id)
      const selected = def.id === equipped
      c.classList.toggle('selected', selected)
      c.classList.toggle('locked', !isOwned)
      c.disabled = !isOwned
      c.setAttribute('aria-pressed', String(selected))
      const sl = c.querySelector<HTMLElement>('.sl')
      if (sl) sl.textContent = selected ? '使用中' : isOwned ? '点击装备' : `Lv.${def.level} 解锁`
    })
  }

  /** 重建鱼图鉴卡片网格（每次打开时调用，反映最新捕获进度；未捕获显示鱼影？+ ？？？） */
  private refreshFishPicker(): void {
    if (!this.fishGrid) return
    const collection = this.save.data.collection
    const discovered = Object.keys(collection).length
    const sub = document.getElementById('fish-sub')
    if (sub) sub.textContent = `已发现 ${discovered} / ${FISH_TABLE.length}`

    const grid = this.fishGrid
    grid.innerHTML = ''
    for (const def of FISH_TABLE) {
      const entry = collection[def.id]
      const known = !!entry
      const card = document.createElement('div')
      card.className = 'fish-card' + (known ? '' : ' locked')

      const img = document.createElement('img')
      img.src = known ? this.fishIcons[def.id] : this.fishQuestUrl
      img.alt = known ? def.name : '未发现的鱼'

      const nm = document.createElement('div')
      nm.className = 'fc-nm'
      nm.textContent = known ? def.name : '？？？'

      const pr = document.createElement('div')
      pr.className = 'fc-pr'
      pr.innerHTML = `<span class="coin" aria-hidden="true"></span><b>${known ? def.price : '??'}</b>`
      pr.setAttribute('aria-label', known ? `基础售价 ${def.price} 金币` : '售价未知')
      if (entry) card.title = `已捕获 ${entry.count} 条 · 最大 ${entry.bestSize} 英寸`

      card.append(img, nm, pr)
      grid.appendChild(card)
    }
  }

  /** 切换形象面板显隐（force 显式指定；打开时收起另外两个图鉴面板，互斥） */
  private toggleChar(force?: boolean): void {
    if (!this.charPicker) return
    const open = force === undefined ? !this.charPicker.classList.contains('visible') : force
    if (open) {
      this.fishPicker?.classList.remove('visible')
      this.rodPicker?.classList.remove('visible')
    }
    this.charPicker.classList.toggle('visible', open)
    this.updateDragWhileOverlay()
  }

  /** 切换鱼图鉴面板显隐（打开时刷新卡片反映最新捕获进度；收起另外两个面板，互斥） */
  private toggleFish(force?: boolean): void {
    if (!this.fishPicker) return
    const open = force === undefined ? !this.fishPicker.classList.contains('visible') : force
    if (open) {
      this.refreshFishPicker()
      this.charPicker?.classList.remove('visible')
      this.rodPicker?.classList.remove('visible')
    }
    this.fishPicker.classList.toggle('visible', open)
    this.updateDragWhileOverlay()
  }

  /** 切换鱼竿面板显隐（force 显式指定；打开时收起另外两个图鉴面板，互斥） */
  private toggleRod(force?: boolean): void {
    if (!this.rodPicker) return
    const open = force === undefined ? !this.rodPicker.classList.contains('visible') : force
    if (open) {
      this.refreshRodPicker()
      this.charPicker?.classList.remove('visible')
      this.fishPicker?.classList.remove('visible')
    }
    this.rodPicker.classList.toggle('visible', open)
    this.updateDragWhileOverlay()
  }
}
