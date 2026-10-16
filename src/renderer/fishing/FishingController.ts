import { T } from '../shared/constants'
import type { Rng } from '../core/Rng'
import type { AudioBus } from '../core/AudioBus'
import type { PlayerPose, SpriteSet } from '../render/SpriteFactory'
import { ROD_TIP, ROD_TIPS } from '../render/SpriteFactory'
import type { CatchResult, FishDef, ResultViewState, SceneState } from '../shared/types'
import { Bobber } from './entities/Bobber'
import { Player } from './entities/Player'
import { CatchBar } from './entities/CatchBar'
import { ProgressBar } from './entities/ProgressBar'
import { Treasure } from './entities/Treasure'
import { FishingMachine } from './FishingMachine'
import type { FishingContext } from './FishingContext'
import { IdleState } from './states/IdleState'
import { ChargeState } from './states/ChargeState'
import { CastState } from './states/CastState'
import { WaitState } from './states/WaitState'
import { HookState } from './states/HookState'
import { MinigameState } from './states/MinigameState'
import { ResultState } from './states/ResultState'
import { SaveStore } from './data/SaveStore'
import { xpProgress } from './data/xpTable'
import { ROD_LIST, getRod } from '../shared/rods'

const HINTS: Record<string, string> = {
  idle: '按住左键 / C 蓄力，松开抛竿',
  charge: '松开抛出！',
  cast: '',
  wait: '等待咬钩…（点击可收竿）',
  hook: '咬钩了！快点击！',
  minigame: '按住上升 · 松开下落 · 让鱼待在绿条内',
  result: '点击继续'
}

/**
 * 钓鱼总控制器：状态机宿主 + 实体驱动 + 场景状态组装。
 */
export class FishingController {
  private machine: FishingMachine
  private ctx: FishingContext
  private bobber = new Bobber()
  private player: Player
  private castState: CastState
  private splash: { x: number; y: number; frame: number; t: number } | null = null
  private pressQueued = false
  private releaseQueued = false
  private heldFlag = false
  private prevName = 'idle'
  private lastChargeTick = -1
  private rodTipMap: Record<PlayerPose, [number, number]>

  constructor(
    private deps: {
      rng: Rng
      audio: AudioBus
      sprites: SpriteSet
      fishPool: FishDef[]
      save: SaveStore
      rodTipMap?: Record<PlayerPose, [number, number]>
    }
  ) {
    this.rodTipMap = deps.rodTipMap ?? ROD_TIP
    this.player = new Player(T.PLAYER_X, T.PLAYER_FOOT_Y)
    this.ctx = {
      rng: deps.rng,
      audio: deps.audio,
      level: deps.save.level,
      rod: getRod(deps.save.data.rods?.equipped),
      held: false,
      rodTip: [T.PLAYER_X - (T.PLAYER_W * T.PLAYER_SCALE) / 2 + this.rodTipMap.idle0[0] * T.PLAYER_SCALE, T.PLAYER_FOOT_Y - T.PLAYER_H * T.PLAYER_SCALE + this.rodTipMap.idle0[1] * T.PLAYER_SCALE],
      castPower: 0,
      targetX: 0,
      targetY: 0,
      distanceTiles: 0,
      maxCast: false,
      roll: null,
      biteTimerMs: 0,
      reactionLeftMs: 0,
      isFirstCast: true,
      fish: null,
      bar: new CatchBar(T.BAR_SIZE_BASE),
      progress: new ProgressBar(),
      treasure: new Treasure(deps.rng),
      outMs: 0,
      perfect: false,
      result: null,
      forcedFishId: null,
      onResult: (r: CatchResult) => this.handleResult(r),
      fishPool: deps.fishPool
    }

    const transition = (name: Parameters<FishingMachine['transition']>[0]) => this.machine.transition(name)
    this.castState = new CastState(transition)
    this.machine = new FishingMachine(this.ctx, {
      idle: new IdleState(transition),
      charge: new ChargeState(transition),
      cast: this.castState,
      wait: new WaitState(transition),
      hook: new HookState(transition),
      minigame: new MinigameState(transition),
      result: new ResultState(transition)
    })
  }

  private handleResult(r: CatchResult): void {
    const gained = this.deps.save.applyResult(r)
    if (gained > 0) {
      r.leveledUp = gained
      this.deps.audio.levelUp()
      const unlocked = this.checkRodUnlocks()
      if (unlocked) r.unlockedRod = unlocked
    }
    this.ctx.level = this.deps.save.level
  }

  /** 升级后自动解锁达到等级要求的钓鱼竿，返回首个新解锁的竿 id（用于结算提示） */
  private checkRodUnlocks(): string | null {
    const data = this.deps.save.data
    const owned = data.rods?.owned ?? ['bamboo']
    const lvl = this.deps.save.level
    const next = owned.slice()
    let first: string | null = null
    for (const rod of ROD_LIST) {
      if (lvl >= rod.level && !next.includes(rod.id)) {
        next.push(rod.id)
        if (!first) first = rod.id
      }
    }
    if (next.length !== owned.length) {
      data.rods = { owned: next, equipped: data.rods?.equipped ?? 'bamboo' }
      this.deps.save.save()
    }
    return first
  }

  /** Game 每逻辑步调用：注入输入 */
  setInput(held: boolean, press: boolean, release: boolean): void {
    this.heldFlag = held
    if (press) this.pressQueued = true
    if (release) this.releaseQueued = true
  }

  /** 沙盒：强制下一条鱼 */
  forceFish(id: string | null): void {
    this.ctx.forcedFishId = id
  }

  /** 切换人物形象时同步更新竿尖偏移映射 */
  setRodTipMap(map: Record<PlayerPose, [number, number]>): void {
    this.rodTipMap = map
  }

  get stateName(): string {
    return this.machine.name
  }

  update(dt: number, time: number): void {
    this.ctx.held = this.heldFlag
    this.ctx.level = this.deps.save.level
    this.ctx.rod = getRod(this.deps.save.data.rods?.equipped)

    if (this.pressQueued) {
      this.pressQueued = false
      this.machine.onPress()
    }
    if (this.releaseQueued) {
      this.releaseQueued = false
      this.machine.onRelease()
    }

    this.machine.update(dt)

    const name = this.machine.name

    // 进入 hook：浮标剧烈抖动 + 水花（让池塘里的咬钩更明显）
    if (name === 'hook' && this.prevName !== 'hook') {
      this.bobber.shake = 0.9
      this.splash = { x: this.bobber.x, y: this.bobber.y, frame: 0, t: 0 }
    }

    // 玩家姿态
    if (name === 'charge') {
      const p = this.ctx.castPower
      this.player.setPose('cast', p < 0.34 ? 0 : p < 0.67 ? 1 : 2)
      // 蓄力提示音：随力度升高的短促嘀嗒（约 9 次/秒）
      if (time - this.lastChargeTick > 0.11) {
        this.lastChargeTick = time
        this.deps.audio.chargeTick(p)
      }
    } else if (name === 'cast') {
      this.player.setPose('cast', 2)
    } else if (name === 'hook' || name === 'minigame') {
      this.player.setPose('reel')
    } else if (name === 'result') {
      this.player.setPose(this.ctx.result?.kind === 'fish' ? 'show' : 'idle')
    } else {
      this.player.setPose('idle')
    }

    // 进入 cast：从竿尖抛出浮标
    if (name === 'cast' && this.prevName !== 'cast') {
      this.deps.save.noteCast()
      const [rx, ry] = this.rodTipWorld()
      this.bobber.launch(rx, ry, this.ctx.targetX, this.ctx.targetY)
      this.deps.audio.castWhoosh()
    }

    // 浮标更新 + 落水
    const wasFlying = this.bobber.flying
    this.bobber.update(dt, time)
    if (wasFlying && !this.bobber.flying) {
      this.splash = { x: this.bobber.x, y: this.bobber.y, frame: 0, t: 0 }
      this.deps.audio.splash()
      this.castState.onLanded(this.ctx)
    }

    // 水花动画
    if (this.splash) {
      this.splash.t += dt
      this.splash.frame = Math.floor(this.splash.t / 0.09)
      if (this.splash.t > 0.28) this.splash = null
    }

    this.prevName = name
  }

  /** 竿尖世界坐标 */
  private rodTipWorld(): [number, number] {
    const pose: PlayerPose =
      this.player.pose === 'cast' ? 'cast2' : this.player.pose === 'reel' ? 'reel' : 'idle0'
    const [dx, dy] = this.rodTipMap[pose]
    const dw = T.PLAYER_W * T.PLAYER_SCALE
    const dh = T.PLAYER_H * T.PLAYER_SCALE
    return [this.player.x - dw / 2 + dx * T.PLAYER_SCALE, this.player.footY - dh + dy * T.PLAYER_SCALE]
  }

  private buildResultView(r: CatchResult): ResultViewState {
    const view: ResultViewState = {
      kind: r.kind,
      perfect: r.perfect,
      treasure: r.treasure,
      maxCast: this.ctx.maxCast,
      xp: r.xp,
      leveledUp: r.leveledUp,
      unlockedRod: r.unlockedRod ? getRod(r.unlockedRod).name : undefined
    }
    if (r.kind === 'fish' && r.def) {
      view.fishName = r.def.name
      view.fishIcon = this.deps.sprites.fish[r.def.id]?.[1]
      view.size = r.size
      view.quality = r.quality
    } else if (r.kind === 'trash') {
      const idx = Math.floor(this.deps.rng.next() * this.deps.sprites.trash.length)
      view.trashIcon = this.deps.sprites.trash[idx]
    }
    return view
  }

  getSceneState(time: number): SceneState {
    const name = this.machine.name
    const showBobber = name === 'cast' || name === 'wait' || name === 'hook' || name === 'minigame'
    const [cur, span, pct] = xpProgress(this.deps.save.data.totalXp, this.deps.save.level)

    const minigame =
      name === 'minigame' && this.ctx.fish
        ? {
            fishPos: this.ctx.fish.pos,
            fishVel: this.ctx.fish.vel,
            fishIcon: this.deps.sprites.fish[this.ctx.fish.def.id][this.ctx.fish.vel >= 0 ? 1 : 0],
            barPos: this.ctx.bar.pos,
            barSize: this.ctx.bar.size,
            progress: this.ctx.progress.value,
            treasure: this.ctx.treasure.visible
              ? { pos: this.ctx.treasure.pos, progress: this.ctx.treasure.progress }
              : null,
            legendary: !!this.ctx.fish.def.legendary
          }
        : null

    return {
      time,
      playerPose: this.player.pose,
      playerFrame: this.player.frame,
      playerX: this.player.x,
      playerFootY: this.player.footY,
      bobber: showBobber ? { x: this.bobber.x, y: this.bobber.y, shake: this.bobber.shake } : null,
      splash: this.splash,
      lineVisible: showBobber && this.bobber.landed,
      minigame,
      result: name === 'result' && this.ctx.result ? this.buildResultView(this.ctx.result) : null,
      hud: {
        level: this.deps.save.level,
        xp: cur,
        xpNeeded: span,
        xpPct: pct,
        hint: HINTS[name] ?? '',
        charge: name === 'charge' ? this.ctx.castPower : -1,
        exclaim: name === 'hook',
        exclaimX: name === 'hook' ? this.bobber.x : this.player.x,
        exclaimY: name === 'hook' ? this.bobber.y - 14 : this.player.footY - 40,
        casts: this.deps.save.data.stats.casts,
        caught: this.deps.save.data.stats.caught
      }
    }
  }
}
