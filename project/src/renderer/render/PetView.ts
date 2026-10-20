import { T } from '../shared/constants'
import { PAL, QUALITY_COLOR, QUALITY_LABEL } from './Palette'
import type { PlayerPose, SpriteSet } from './SpriteFactory'
import { ROD_TIPS } from './SpriteFactory'
import { drawPixelText, drawPixelTextCenter, pixelTextWidth } from './PixelFont'
import type { CharacterSkin, SceneState, MinigameViewState, ResultViewState } from '../shared/types'

/** 小游戏捕获条在桌宠窗口中的布局：缩小、精致，放在「与小人平行」的左侧（不再高高挂在左上角） */
const BAR_W = 34
const BAR_H = 110
const BAR_TOP = 236
const BAR_X = 16

/** 垂钓者的屏幕显示尺寸 */
const CAT_DW = T.PLAYER_W * T.PLAYER_SCALE
const CAT_DH = T.PLAYER_H * T.PLAYER_SCALE

/**
 * A tiny shared animation language for every skin.  The sprites stay crisp
 * pixel art, while these two-pixel glints give the idle pose a little life and
 * make the character cards feel like companions instead of static stickers.
 */
const SKIN_GLINT: Record<CharacterSkin, string> = {
  farmer: '#f4d36c', cat: '#f5b54b', frog: '#b9e77d', penguin: '#cbe9ff', wizard: '#d7b6ff',
  shinchan: '#f3c36b', maruko: '#f4a5a5', pikachu: '#fff09a', rukawa: '#ffd2a5', doraemon: '#f4d884'
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t)
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t)
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t)
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`
}

/**
 * 桌宠视图：在透明画布上绘制「垂钓猫 + 钓鱼 UI」。
 * 不做任何背景填充，桌面透过透明区域可见。
 */
export class PetView {
  /** 工具按钮悬停高亮（由 Game 每帧写入） */
  toolsHover = false
  /** 打开菜单或面板时只保留工具按钮，避免人物/徽章从面板边缘露出残片。 */
  overlayOpen = false
  /** 隐身模式：隐藏人物与 lev 徽章，仅保留工具按钮（由 Game 写入） */
  stealth = false
  /** 点击区域可视化：开启后把"钓鱼区 / 拖拽区 / 菜单 / 无效区"用彩色边框+标签画出来，
   *  让使用者一眼看清"点哪里生效哪里不生效"。纯画布叠加层，不拦截任何点击。 */
  showClickMap = false

  private skin: CharacterSkin
  private rodTip: Record<PlayerPose, [number, number]>
  private sprites: SpriteSet
  private starMasks = new Map<string, HTMLCanvasElement>()
  /** 自然眨眼调度（设计规范 §2.2 idle1 眨眼帧）：下次眨眼时刻 / 本轮闭眼截止时刻（秒，游戏时间轴） */
  private blinkNextAt = 2.2
  private blinkUntil = 0
  /** 最近一次绘制时的游戏时间（供 blinkActive 断言当前是否闭眼） */
  private blinkNow = -1

  /** 当前是否处于眨眼闭眼帧（调试 / E2E 观测用） */
  get blinkActive(): boolean {
    return this.blinkNow >= 0 && this.blinkNow < this.blinkUntil
  }

  constructor(sprites: SpriteSet, skin: CharacterSkin = 'farmer') {
    this.sprites = sprites
    this.skin = skin
    this.rodTip = ROD_TIPS[skin]
  }

  /** 切换人物形象并刷新精灵与竿尖偏移 */
  setSprites(sprites: SpriteSet, skin: CharacterSkin = this.skin): void {
    this.sprites = sprites
    this.starMasks.clear()
    this.skin = skin
    this.rodTip = ROD_TIPS[skin]
  }

  private toY(pos: number): number {
    return BAR_TOP + (pos / T.TRACK_H) * BAR_H
  }

  /** 把绘制 y 夹在轨道框内，避免鱼/绿条超出边界（即使物理上已到极值） */
  private clampTrack(y: number, half: number): number {
    return Math.max(BAR_TOP + half, Math.min(BAR_TOP + BAR_H - half, y))
  }

  draw(ctx: CanvasRenderingContext2D, state: SceneState): void {
    ctx.imageSmoothingEnabled = false
    if (this.overlayOpen) {
      this.drawToolsButton(ctx)
      return
    }
    const px = state.playerX
    const py = state.playerFootY
    // 奖励卡会伸入人物区域；此时让结算独占画面，避免只露出半身和一截等级条。
    const r = state.result
    const expandedResult = r?.kind === 'fish' && (r.maxCast || r.perfect || r.treasure || r.unlockedRod || (r.fishName?.length ?? 0) > 8)
    const showPet = !this.stealth && !expandedResult

    // 点击区域示意（先画底层填充/边框，最后再画文字标签，确保标签永远在最上层）
    if (this.showClickMap) this.drawClickMapBack(ctx)

    // 接触阴影（让垂钓者"站"在桌面上）——隐身时一并隐藏
    if (showPet) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.beginPath()
      // Breathing shadow: a barely perceptible pulse is enough to make every
      // idle skin feel grounded and alive without moving the rod tip/ hitbox.
      const breath = 1 + Math.sin(state.time * 2.2) * 0.035
      ctx.ellipse(px, py - 1, CAT_DW * 0.42 * breath, 5, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // 小游戏 / 待钓 二选一
    if (state.minigame) {
      this.drawMinigame(ctx, state.minigame)
    } else {
      if (state.bobber) this.drawBobberAndLine(ctx, state)
      if (state.hud.exclaim) {
        const by = state.hud.exclaimY - 18 + Math.sin(state.time * 9) * 1.5
        ctx.drawImage(this.sprites.exclaim, Math.round(state.hud.exclaimX - 7), Math.round(by), 14, 22)
      }
    }

    // 蓄力指示（满力度 = MAX：金色高亮 + 呼吸闪烁 + MAX 提示）
    if (state.hud.charge >= 0) {
      const width = Math.round(CAT_DW)
      const cx = Math.round(px - CAT_DW / 2)
      const cy = Math.round(py - CAT_DH - 14)
      const isMax = state.hud.charge >= T.MAX_CAST_THRESHOLD
      const glow = isMax ? 0.5 + 0.5 * Math.sin(state.time * 12) : 0
      ctx.fillStyle = PAL.ink
      ctx.fillRect(cx, cy, width, 8)
      ctx.fillStyle = PAL.woodLight
      ctx.fillRect(cx + 1, cy + 1, width - 2, 6)
      ctx.fillStyle = PAL.woodDark
      ctx.fillRect(cx + 2, cy + 2, width - 4, 4)
      ctx.fillStyle = isMax ? mix(PAL.chestGold, PAL.paperLight, glow) : mix(PAL.progressMid, PAL.progressHigh, state.hud.charge)
      ctx.fillRect(cx + 2, cy + 2, Math.round((width - 4) * Math.max(0, Math.min(1, state.hud.charge))), 4)
      if (isMax) {
        drawPixelTextCenter(ctx, 'MAX', cx + width / 2, cy - 13, mix(PAL.chestGold, PAL.paperLight, glow), 2, true)
      }
    }

    // 垂钓者（隐身模式下不绘制人物与 lev 徽章）
    if (showPet) {
      this.drawCat(ctx, state)
      this.drawCharacterAccent(ctx, state)
      this.drawLevelBadge(ctx, state)
    }

    // 右下角工具按钮
    this.drawToolsButton(ctx)

    // 点击区域示意：标签画在最上层
    if (this.showClickMap) this.drawClickMapTags(ctx)

    // 结算弹窗
    if (state.result) this.drawResult(ctx, state.result, state.time)

    // A finite event keeps playing after「点击继续」; overlayOpen returns above, so no panel bleed.
    if (state.levelUp) this.drawLevelUp(ctx, state)
  }

  /** Gold pixel burst + a reserved top banner, never covering the result panel's text. */
  private drawLevelUp(ctx: CanvasRenderingContext2D, state: SceneState): void {
    const event = state.levelUp!
    const age = event.elapsed
    if (age < 0 || age >= event.duration) return
    const alpha = Math.min(1, age / 0.1) * Math.min(1, (event.duration - age) / 0.45)
    const burst = Math.min(1, age / 0.65)
    const gold = PAL.chestGold
    ctx.save()
    ctx.globalAlpha = alpha

    if (!state.result && !this.stealth) {
      // Expanding dotted ellipse behind the outer silhouette, not a looping screen flash.
      const cx = state.playerX
      const cy = state.playerFootY - CAT_DH / 2
      const rx = 33 + burst * 15
      const ry = 43 + burst * 12
      ctx.globalAlpha = alpha * Math.max(0, 1 - age / 1.5)
      for (let i = 0; i < 24; i++) {
        const angle = i * Math.PI * 2 / 24
        const x = Math.round(cx + Math.cos(angle) * rx)
        const y = Math.round(cy + Math.sin(angle) * ry)
        ctx.fillStyle = i % 2 ? PAL.paperLight : gold
        ctx.fillRect(x - 1, y - 1, 3, 3)
      }
    }

    ctx.globalAlpha = alpha
    // End at y=28, above even the legendary result's crown (y=28..50).
    const bx = Math.round(T.VIEW_W / 2) - 64
    const by = 3
    ctx.fillStyle = PAL.ink
    ctx.fillRect(bx, by, 128, 25)
    ctx.fillStyle = PAL.woodDark
    ctx.fillRect(bx + 1, by + 1, 126, 23)
    ctx.fillStyle = gold
    ctx.fillRect(bx + 2, by + 2, 124, 1)
    ctx.fillRect(bx + 2, by + 23, 124, 1)
    drawPixelTextCenter(ctx, 'LEVEL UP!', T.VIEW_W / 2, by + 4, PAL.paperLight, 2, false)
    const levelLabel = `LV.${event.level}${event.gained > 1 ? `  +${event.gained}` : ''}`
    drawPixelTextCenter(ctx, levelLabel, T.VIEW_W / 2, by + 17, gold, 1, false)
    this.sparkle(ctx, bx + 13, by + 12, 2, gold)
    this.sparkle(ctx, bx + 115, by + 12, 2, gold)

    // Rise along the result's outside margins; no particle crosses the text or toolbar.
    for (let i = 0; i < 10; i++) {
      const localAge = age - i * 0.045
      if (localAge < 0 || localAge > 1.8) continue
      const side = i % 2
      const x = side ? 311 + (i % 3) * 4 : 29 - (i % 3) * 4
      const y = Math.round(300 - (i % 5) * 37 - localAge * (24 + (i % 3) * 7))
      ctx.globalAlpha = alpha * Math.min(1, localAge / 0.08) * Math.min(1, (1.8 - localAge) / 0.5)
      this.sparkle(ctx, x, y, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? PAL.paperLight : gold)
    }
    ctx.restore()
  }

  /**
   * 点击区域可视化（底层）：用半透明填充 + 彩色边框标出四大区域。
   *  - 顶部红色带：无效区（窗口上缘，避免误触）
   *  - 黄色圈：工具菜单命中范围
   *  - 蓝色框：人物交互区（既「点一下=钓鱼」又「按住拖动=移窗」，覆盖 Game 的 #pet-handle）
   */
  private drawClickMapBack(ctx: CanvasRenderingContext2D): void {
    const W = T.VIEW_W
    const H = T.VIEW_H
    const dead = 30
    ctx.save()

    // 顶部无效区
    ctx.fillStyle = 'rgba(186,54,54,0.20)'
    ctx.fillRect(0, 0, W, dead)
    ctx.strokeStyle = 'rgba(255,120,120,0.9)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, dead)
    ctx.lineTo(W, dead)
    ctx.stroke()

    // 人物交互区：蓝色实框（人物本体 + 等级徽章及下方，与 Game 中 #pet-handle 一致）。
    // 同一块区域：点按=钓鱼，按住拖动=移窗。
    const catL = T.PLAYER_X - CAT_DW / 2
    const catR = T.PLAYER_X + CAT_DW / 2
    const badgeR = Math.min(T.VIEW_W - 1, T.PLAYER_X + CAT_DW / 2 + 4 + 68)
    const hitL = catL - 6
    const hitT = T.PLAYER_FOOT_Y - CAT_DH - 6
    const hitR = badgeR + 2
    const hitB = Math.min(T.TOOLS_BTN.y - T.TOOLS_BTN.hitHalf - 1, T.PLAYER_FOOT_Y + 10)
    ctx.fillStyle = 'rgba(80,150,230,0.16)'
    ctx.fillRect(hitL, hitT, hitR - hitL, hitB - hitT)
    ctx.strokeStyle = 'rgba(120,180,255,0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(hitL, hitT, hitR - hitL, hitB - hitT)

    // 工具菜单命中区：与 DOM 按钮及原生 region 一致的 32×32 方框。
    const t = T.TOOLS_BTN
    ctx.strokeStyle = 'rgba(240,210,80,0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(t.x - t.hitHalf, t.y - t.hitHalf, t.hitHalf * 2, t.hitHalf * 2)

    ctx.restore()
  }

  /** 点击区域可视化（标签层）：在对应区域上方画可读的中文小标签 */
  private drawClickMapTags(ctx: CanvasRenderingContext2D): void {
    this.tag(ctx, T.VIEW_W / 2, 15, '顶部 30px：无效区', 'rgba(120,30,30,0.92)', '#ffd9d9')
    this.tag(
      ctx,
      T.PLAYER_X,
      T.PLAYER_FOOT_Y - CAT_DH - 22,
      '拖拽移动 / 轻点钓鱼',
      'rgba(24,60,110,0.92)',
      '#cfe6ff'
    )
    this.tag(
      ctx,
      T.VIEW_W / 2,
      T.VIEW_H - 15,
      '人物蓄力 / 钓鱼中整窗收线',
      'rgba(20,70,40,0.92)',
      '#c8ffd8'
    )
    const t = T.TOOLS_BTN
    this.tag(ctx, t.x, t.y - t.r - 12, '≡ 菜单（点击）', 'rgba(96,78,12,0.92)', '#fff0b8')
  }

  /** 画一个小标签：半透明底框 + 描边 + 居中中文，保证在任意壁纸上都清晰 */
  private tag(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, bg: string, fg: string): void {
    ctx.save()
    ctx.font = '11px "Microsoft YaHei", "PingFang SC", sans-serif'
    const w = Math.ceil(ctx.measureText(text).width) + 10
    const h = 17
    const x = Math.round(cx - w / 2)
    const y = Math.round(cy - h / 2)
    ctx.fillStyle = bg
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    ctx.fillStyle = fg
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, cx, cy + 0.5)
    ctx.restore()
  }

  /** 右下角工具按钮（汉堡菜单图标，暗底 + 亮描边，透明背景中清晰，悬停高亮） */
  private drawToolsButton(ctx: CanvasRenderingContext2D): void {
    const { x, y, r } = T.TOOLS_BTN
    ctx.save()
    // 圆底
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = this.toolsHover ? PAL.wood : PAL.uiBacking
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = this.toolsHover ? PAL.chestGold : PAL.paperShade
    ctx.stroke()
    // 汉堡菜单：三横线
    ctx.fillStyle = this.toolsHover ? PAL.paperLight : PAL.paper
    const w = Math.round(r * 0.5)
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(x - w, y + i * 4 - 1, w * 2, 2)
    }
    ctx.restore()
  }

  private drawCat(ctx: CanvasRenderingContext2D, state: SceneState): void {
    const pose = state.playerPose
    let img: HTMLCanvasElement
    if (pose === 'idle') {
      // 自然眨眼：待机时每 2.6~4.2s 随机眨一次，闭眼约 110ms（idle0/idle1 仅差眼睛）。
      // 旧版 Math.floor(t*1.6)%2 是 1.6Hz 快闪，像故障而非眨眼——用户不可感。
      const t = state.time
      this.blinkNow = t
      if (t >= this.blinkNextAt) {
        this.blinkUntil = t + 0.11
        this.blinkNextAt = t + 2.6 + Math.random() * 1.6
      }
      img = t < this.blinkUntil ? this.sprites.playerIdle[1] : this.sprites.playerIdle[0]
    } else if (pose === 'cast') {
      img = this.sprites.playerCast[Math.min(2, Math.max(0, state.playerFrame | 0))]
    } else if (pose === 'reel') img = this.sprites.playerReel
    else img = this.sprites.playerShow
    const dx = Math.round(state.playerX - CAT_DW / 2)
    const dy = Math.round(state.playerFootY - CAT_DH)
    ctx.drawImage(img, dx, dy, Math.round(CAT_DW), Math.round(CAT_DH))
  }

  /**
   * Small, skin-coloured idle glints.  They are deliberately drawn outside
   * the sprite so the seven pose masks and the fishing geometry remain
   * unchanged.  During a cast the same pixels become a short motion trail.
   */
  private drawCharacterAccent(ctx: CanvasRenderingContext2D, state: SceneState): void {
    const color = SKIN_GLINT[this.skin] ?? PAL.chestGold
    const x = Math.round(state.playerX - CAT_DW * 0.5)
    const y = Math.round(state.playerFootY - CAT_DH * 0.9)
    ctx.save()
    ctx.fillStyle = color
    if (state.playerPose === 'idle') {
      const pulse = 0.26 + (Math.sin(state.time * 2.6) + 1) * 0.16
      ctx.globalAlpha = pulse
      ctx.fillRect(x + 5, y + 3, 2, 2)
      ctx.globalAlpha = pulse * 0.7
      ctx.fillRect(x + Math.round(CAT_DW * 0.72), y + 12, 2, 2)
      if (Math.sin(state.time * 2.6) > 0.35) {
        ctx.globalAlpha = pulse * 0.55
        ctx.fillRect(x + Math.round(CAT_DW * 0.63), y - 2, 1, 1)
      }
    } else if (state.playerPose === 'cast' && (state.playerFrame | 0) > 0) {
      // A few trailing pixels reinforce the backswing/forward motion without
      // touching the actual rod line or the click region.
      ctx.globalAlpha = 0.24
      const trail = Math.min(2, state.playerFrame | 0)
      for (let i = 0; i < trail; i++) ctx.fillRect(x + 8 + i * 4, y + 21 - i * 3, 2, 1)
    }
    ctx.restore()
  }

  private rodTipWorld(state: SceneState): [number, number] {
    // 钓线起点跟随当前姿态帧的竿尖（设计规范 §2.4：不允许"线从空气中长出来"）：
    //  cast 按帧取 cast0/1/2（蓄力弧线沿线扫）；reel 取 reel；其余（idle/show）取 idle0。
    const pose = state.playerPose
    const key: PlayerPose =
      pose === 'reel'
        ? 'reel'
        : pose === 'cast'
          ? (`cast${Math.min(2, Math.max(0, state.playerFrame | 0))}` as PlayerPose)
          : 'idle0'
    const [ox, oy] = this.rodTip[key]
    const dx = Math.round(state.playerX - CAT_DW / 2)
    const dy = Math.round(state.playerFootY - CAT_DH)
    return [Math.round(dx + ox * Math.round(CAT_DW) / T.PLAYER_W), Math.round(dy + oy * Math.round(CAT_DH) / T.PLAYER_H)]
  }

  private drawBobberAndLine(ctx: CanvasRenderingContext2D, state: SceneState): void {
    const b = state.bobber!
    const [rx, ry] = this.rodTipWorld(state)
    const bx = b.x + Math.sin(state.time * 40) * b.shake * 2
    const by = b.y + Math.cos(state.time * 37) * b.shake * 1.5 + Math.sin(state.time * 2.4) * 1.2

    // 水面：多层同心涟漪（暗描边 + 亮青色，透明背景中也清晰可见）
    const drawRing = (r: number, alpha: number) => {
      ctx.beginPath()
      ctx.ellipse(bx, by + 5, r, r * 0.38, 0, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(18,52,70,${alpha})`
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.beginPath()
      ctx.ellipse(bx, by + 5, r, r * 0.38, 0, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(150,228,242,${alpha})`
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
    drawRing(13, 0.55)
    if (b.shake < 0.05) drawRing(8, 0.45)

    // 钓线（竿尖 -> 浮标，带下垂弧）：先暗描边再亮色，任何背景都可见
    const sag = Math.min(26, Math.hypot(bx - rx, by - ry) * 0.16)
    const linePath = (cx: number, cy: number) => {
      ctx.beginPath()
      ctx.moveTo(rx, ry)
      ctx.quadraticCurveTo((rx + bx) / 2, (ry + by) / 2 + sag, cx, cy)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(18,40,55,0.9)'
    ctx.lineWidth = 2.6
    linePath(bx, by)
    ctx.strokeStyle = 'rgba(236,246,250,0.95)'
    ctx.lineWidth = 1
    linePath(bx, by)

    // 浮标（带暗描边，更醒目）
    const bw = 14
    const bh = 14
    ctx.drawImage(this.sprites.bobber, Math.round(bx - bw / 2), Math.round(by - bh / 2), bw, bh)
    ctx.strokeStyle = 'rgba(18,40,55,0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(bx, by, bw / 2 + 1, 0, Math.PI * 2)
    ctx.stroke()

    // 落水水花（高对比、带描边，放大显示）
    if (state.splash) {
      const sp = this.sprites.splash[Math.min(2, state.splash.frame)]
      ctx.drawImage(sp, Math.round(b.x - 13), Math.round(b.y - 9), 26, 18)
    }
  }

  private drawMinigame(ctx: CanvasRenderingContext2D, s: MinigameViewState): void {
    const scale = BAR_H / T.TRACK_H
    // 木框使用整像素色阶；轨道和右侧进度保持原有位置与尺寸。
    const fx = BAR_X - 5, fy = BAR_TOP - 5, fw = BAR_W + 10, fh = BAR_H + 10
    ctx.fillStyle = PAL.panelShadow
    ctx.fillRect(fx + 2, fy + 3, fw, fh)
    ctx.fillStyle = PAL.ink
    ctx.fillRect(fx, fy, fw, fh)
    ctx.fillStyle = PAL.wood
    ctx.fillRect(fx + 1, fy + 1, fw - 2, fh - 2)
    ctx.fillStyle = PAL.woodLight
    ctx.fillRect(fx + 2, fy + 2, fw - 4, 2)
    ctx.fillRect(fx + 2, fy + 2, 2, fh - 4)
    ctx.fillStyle = PAL.woodDark
    ctx.fillRect(fx + fw - 4, fy + 4, 2, fh - 6)
    ctx.fillRect(fx + 4, fy + fh - 4, fw - 6, 2)

    // 四档水色代替连续模糊渐变，像素层次在 1× 下仍清楚。
    for (let y = 0; y < BAR_H; y++) {
      ctx.fillStyle = mix(PAL.trackTop, PAL.trackBottom, Math.floor(y * 4 / BAR_H) / 3)
      ctx.fillRect(BAR_X, BAR_TOP + y, BAR_W, 1)
    }
    // 水中微粒
    ctx.fillStyle = 'rgba(232,246,249,0.14)'
    for (let i = 0; i < 12; i++) {
      const px = BAR_X + 10 + ((i * 53) % (BAR_W - 20))
      const py = BAR_TOP + ((i * 97) % BAR_H)
      ctx.fillRect(px, py, 2, 2)
    }

    // 捕获条先画，鱼和宝箱后画，避免绿色实块把目标本身完全盖住。
    const barH = Math.max(4, Math.min(BAR_H - 4, Math.round(s.barSize * scale)))
    const barY = Math.max(BAR_TOP + 2, Math.min(BAR_TOP + BAR_H - barH - 2, Math.round(this.toY(s.barPos))))
    ctx.fillStyle = PAL.barEdge
    ctx.fillRect(BAR_X + 6, barY - 2, BAR_W - 12, barH + 4)
    ctx.fillStyle = PAL.barFill
    ctx.fillRect(BAR_X + 8, barY, BAR_W - 16, barH)
    ctx.fillStyle = PAL.barHighlight
    ctx.fillRect(BAR_X + 8, barY, BAR_W - 16, 2)
    ctx.fillStyle = PAL.barFillDark
    ctx.fillRect(BAR_X + 8, barY + barH - 2, BAR_W - 16, 2)

    // 宝箱与其进度视为一个 32px 高的整体，沉底时也留在轨道内。
    if (s.treasure) {
      const ty = Math.max(BAR_TOP + 1, Math.min(BAR_TOP + BAR_H - 33, Math.round(this.toY(s.treasure.pos)) - 12))
      ctx.drawImage(this.sprites.chest, BAR_X + BAR_W / 2 - 16, ty, 32, 25)
      const bw = 22
      const bx = BAR_X + BAR_W / 2 - bw / 2
      const by = ty + 28
      ctx.fillStyle = PAL.ink
      ctx.fillRect(bx - 1, by - 1, bw + 2, 5)
      ctx.fillStyle = PAL.chestGold
      ctx.fillRect(bx, by, Math.round(bw * Math.max(0, Math.min(1, s.treasure.progress))), 3)
    }

    // 鱼图标（夹在轨道框内，避免沉底时戳出绿条下边界）
    // v2026-10-19 重调（plan/数值重调方案.md）：鱼 22×33 → 16×24，
    // 与缩小后的绿条(BASE 120 → 渲染 ~23px)匹配：小绿条 ≥ 小鱼，居中可盖、移动时探出产生挑战。
    const fishY = Math.round(this.clampTrack(this.toY(s.fishPos), s.legendary ? 20 : 12))
    const fishW = 16
    const fishH = 24
    ctx.drawImage(s.fishIcon, BAR_X + BAR_W / 2 - fishW / 2, Math.round(fishY - fishH / 2), fishW, fishH)
    if (s.legendary) ctx.drawImage(this.sprites.crown, BAR_X + BAR_W / 2 - 10, fishY - 20, 20, 15)

    // 进度条（轨道右侧）
    const pX = BAR_X + BAR_W + 8
    const pW = 14
    ctx.fillStyle = PAL.ink
    ctx.fillRect(pX - 2, BAR_TOP - 2, pW + 4, BAR_H + 4)
    ctx.fillStyle = PAL.woodDark
    ctx.fillRect(pX, BAR_TOP, pW, BAR_H)
    const pH = Math.round((BAR_H - 2) * Math.max(0, Math.min(1, s.progress)))
    const pColor = s.progress < 0.35 ? PAL.progressLow : s.progress < 0.7 ? PAL.progressMid : PAL.progressHigh
    ctx.fillStyle = pColor
    if (pH > 0) {
      ctx.fillRect(pX + 1, BAR_TOP + BAR_H - pH - 1, pW - 2, pH)
      ctx.fillStyle = PAL.paperLight
      ctx.fillRect(pX + 1, BAR_TOP + BAR_H - pH - 1, pW - 2, Math.min(2, pH))
    }
  }

  private drawLevelBadge(ctx: CanvasRenderingContext2D, state: SceneState): void {
    const h = state.hud
    // 紧贴人物右上角，跟随人物站位
    const x = Math.round(state.playerX + CAT_DW / 2 + 4)
    const y = Math.round(state.playerFootY - CAT_DH + 4)
    const width = Math.min(68, T.VIEW_W - x - 3)
    const label = `LV${h.level}`
    const textScale = pixelTextWidth(label, 2) <= width - 23 ? 2 : 1
    const labelW = pixelTextWidth(label, textScale)
    ctx.fillStyle = PAL.ink
    ctx.fillRect(x, y, width, 18)
    ctx.fillStyle = PAL.uiBacking
    ctx.fillRect(x + 1, y + 1, width - 2, 16)
    ctx.fillStyle = PAL.woodLight
    ctx.fillRect(x + 1, y + 1, width - 2, 1)
    drawPixelText(ctx, label, x + 3, y + Math.floor((18 - textScale * 5) / 2), PAL.paperLight, textScale, false)
    // 经验条
    const bx = x + 3 + labelW + 4
    const by = y + 5
    const bw = Math.max(4, width - (bx - x) - 3)
    ctx.fillStyle = PAL.woodDark
    ctx.fillRect(bx, by, bw, 9)
    ctx.fillStyle = PAL.barFill
    const fillW = Math.round((bw - 2) * Math.max(0, Math.min(1, h.xpPct)))
    ctx.fillRect(bx + 1, by + 1, fillW, 7)
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.fillRect(bx + 1, by + 1, fillW, 2)
  }

  /**
   * 干净的中文/矢量文本：米色面板上用深棕细描边（1px 级），整数对齐、行高一致。
   * 描边仅作对比衬底，绝不抢字——字粗由 fill 决定，故描边压到最细，避免「字太粗看不清」。
   */
  private rtext(
    ctx: CanvasRenderingContext2D,
    str: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: CanvasTextAlign = 'center'
  ): void {
    ctx.save()
    ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // 细描边：尺寸/16 且不低于 1px，仅作衬底，不糊字
    const lw = Math.max(1, size / 16)
    ctx.lineWidth = lw
    ctx.strokeStyle = 'rgba(40,28,16,0.5)'
    const rx = Math.round(x)
    const ry = Math.round(y)
    if (lw > 1) ctx.strokeText(str, rx, ry)
    ctx.fillStyle = color
    ctx.fillText(str, rx, ry)
    ctx.restore()
  }

  /** 内容先排版再确定面板高度，奖励、长名称与页脚各有独立的行。 */
  private drawResult(ctx: CanvasRenderingContext2D, r: ResultViewState, time: number): void {
    const w = 232
    const x = Math.round((T.VIEW_W - w) / 2)
    const y = 42
    const cx = x + w / 2
    const innerW = w - 28
    const bodyTop = 44
    const tx = x + 76
    const textW = w - 90
    const nameLines = this.wrapResultText(ctx, r.fishName ?? '', textW, 16, 2)
    const bodyH = Math.max(64, nameLines.length * 20 + 34)
    const chips: Array<{ kind: 'max' | 'perfect' | 'treasure'; width: number }> = []
    if (r.maxCast) chips.push({ kind: 'max', width: 66 })
    if (r.perfect) chips.push({ kind: 'perfect', width: 80 })
    if (r.treasure) chips.push({ kind: 'treasure', width: 88 })
    const chipRows: typeof chips[] = []
    let used = 0
    for (const chip of chips) {
      if (!chipRows.length || used + chip.width > innerW) {
        chipRows.push([])
        used = 0
      }
      chipRows[chipRows.length - 1].push(chip)
      used += chip.width + 6
    }
    const xp = `+${r.xp ?? 0} XP`
    const level = r.leveledUp && r.leveledUp > 0 ? `升级 ×${r.leveledUp}` : ''
    ctx.save()
    ctx.font = '12px "Microsoft YaHei", "PingFang SC", sans-serif'
    const separateLevel = !!level && ctx.measureText(xp).width + ctx.measureText(level).width + 14 > innerW
    ctx.restore()
    const rodLines = r.unlockedRod ? this.wrapResultText(ctx, `解锁 ${r.unlockedRod}`, innerW - 22, 11, 2) : []
    let footerTop = bodyTop + bodyH + 8
    if (r.price != null) footerTop += 20
    footerTop += chipRows.length * 22 + (separateLevel ? 40 : 20)
    if (rodLines.length) footerTop += rodLines.length * 16 + 6
    footerTop += 8
    const h = r.kind === 'fish' ? footerTop + 24 : r.kind === 'trash' ? 164 : 132

    ctx.fillStyle = PAL.panelShadow
    ctx.fillRect(x + 3, y + 3, w, h)
    ctx.fillStyle = PAL.ink
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = PAL.wood
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2)
    ctx.fillStyle = PAL.woodLight
    ctx.fillRect(x + 2, y + 2, w - 4, 2)
    ctx.fillRect(x + 2, y + 2, 2, h - 4)
    ctx.fillStyle = PAL.paper
    ctx.fillRect(x + 4, y + 32, w - 8, h - 36)
    ctx.fillStyle = PAL.paperLight
    ctx.fillRect(x + 5, y + 33, w - 10, 1)
    ctx.fillStyle = PAL.paperShade
    ctx.fillRect(x + 5, y + h - 6, w - 10, 2)

    const legendary = r.kind === 'fish' && !!r.legendary
    const title = r.kind === 'fish' ? legendary ? 'LEGENDARY' : r.perfect ? 'PERFECT' : 'COMMON' : r.kind === 'trash' ? 'FOUND' : 'ESCAPED'
    const letter = legendary ? 'L' : r.perfect ? 'P' : r.kind === 'fish' ? 'C' : r.kind === 'trash' ? '?' : '!'
    const badgeColor = legendary ? PAL.chestGold : r.perfect ? PAL.waterLight : r.kind === 'fish' ? PAL.progressHigh : PAL.paperShade
    this.resultBadge(ctx, x + 18, y + 17, 10, letter, badgeColor, PAL.ink)
    drawPixelText(ctx, title, x + 35, y + 12, PAL.paperLight, 2, false)
    this.resultCloseX(ctx, x + w - 17, y + 17)
    if (r.kind === 'fish' && r.isNew) this.newRibbon(ctx, x + w - 60, y + 17)
    if (legendary) ctx.drawImage(this.sprites.crown, cx - 15, y - 14, 30, 22)

    if (r.kind === 'fish') {
      const iy = y + bodyTop
      ctx.fillStyle = PAL.paperShade
      ctx.fillRect(x + 12, iy - 2, 52, bodyH + 4)
      ctx.fillStyle = PAL.paperLight
      ctx.fillRect(x + 13, iy - 1, 50, bodyH + 2)
      if (r.fishIcon) {
        const iconScale = Math.max(1, Math.min(4, Math.floor(44 / r.fishIcon.width), Math.floor((bodyH - 12) / r.fishIcon.height)))
        const iw = r.fishIcon.width * iconScale
        const ih = r.fishIcon.height * iconScale
        const ix = x + 38 - Math.floor(iw / 2)
        const iconY = iy + Math.floor((bodyH - ih) / 2)
        ctx.drawImage(r.fishIcon, ix, iconY, iw, ih)
        if (legendary) {
          const tw = 1 + Math.round((0.5 + 0.5 * Math.sin(time * 6)))
          this.sparkle(ctx, x + 18, iy + 8, tw, PAL.chestGold)
          this.sparkle(ctx, x + 56, iy + bodyH - 9, tw, PAL.chestGold)
        }
      }
      for (let i = 0; i < nameLines.length; i++) {
        this.rtext(ctx, nameLines[i], tx, iy + 8 + i * 20, 16, PAL.ink, 'left')
      }
      const sizeY = iy + nameLines.length * 20 + 5
      const sizeText = this.fitResultText(ctx, `Size ${r.size ?? 0}`, textW, 12)
      this.rtext(ctx, sizeText, tx, sizeY, 12, PAL.textMuted, 'left')
      const stars = r.quality === 'iridium' ? 3 : r.quality === 'gold' ? 2 : r.quality === 'silver' ? 1 : 0
      const starY = sizeY + 13
      for (let i = 0; i < 3; i++) {
        this.drawQualityStar(ctx, tx + i * 18, starY, i < stars ? QUALITY_COLOR[r.quality ?? 'normal'] : PAL.paperShade)
      }
      let row = y + bodyTop + bodyH + 8
      if (r.price != null) {
        const label = QUALITY_LABEL[r.quality ?? 'normal']
        ctx.drawImage(this.sprites.coin, x + 14, row, 14, 14)
        this.rtext(ctx, this.fitResultText(ctx, `${r.price}`, innerW - 60, 13), x + 34, row + 7, 13, PAL.ink, 'left')
        this.rtext(ctx, label, x + w - 14, row + 7, 11, PAL.textMuted, 'right')
        row += 20
      }
      for (const chipsInRow of chipRows) {
        let chipX = x + 14
        for (const chip of chipsInRow) {
          if (chip.kind === 'perfect') {
            this.perfectStamp(ctx, chipX + chip.width / 2, row + 8)
          } else {
            ctx.fillStyle = chip.kind === 'max' ? PAL.woodDark : PAL.wood
            ctx.fillRect(chipX, row, chip.width, 16)
            ctx.fillStyle = chip.kind === 'max' ? PAL.chestGold : PAL.paperShade
            ctx.fillRect(chipX + 1, row + 1, chip.width - 2, 14)
            if (chip.kind === 'treasure') {
              ctx.drawImage(this.sprites.chestOpen, chipX + 3, row + 2, 16, 12)
              this.rtext(ctx, 'TREASURE', chipX + 22, row + 8, 10, PAL.woodDark, 'left')
            } else this.rtext(ctx, 'MAX CAST', chipX + chip.width / 2, row + 8, 10, PAL.woodDark)
          }
          chipX += chip.width + 6
        }
        row += 22
      }
      this.rtext(ctx, this.fitResultText(ctx, xp, separateLevel ? innerW : level ? innerW / 2 : innerW, 12), x + 14, row + 7, 12, PAL.ink, 'left')
      if (level) this.rtext(ctx, this.fitResultText(ctx, level, separateLevel ? innerW : innerW / 2, 12), separateLevel ? x + 14 : x + w - 14, row + (separateLevel ? 27 : 7), 12, PAL.treeDark, separateLevel ? 'left' : 'right')
      row += separateLevel ? 40 : 20
      if (rodLines.length) {
        ctx.drawImage(this.sprites.rod, x + 14, row + 1, 16, 16)
        for (let i = 0; i < rodLines.length; i++) this.rtext(ctx, rodLines[i], x + 36, row + 8 + i * 16, 11, PAL.woodDark, 'left')
      }
    } else if (r.kind === 'trash') {
      if (r.trashIcon) {
        const iw = r.trashIcon.width * 3
        const ih = r.trashIcon.height * 3
        ctx.drawImage(r.trashIcon, cx - Math.floor(iw / 2), y + 44, iw, ih)
      }
      this.rtext(ctx, '钓上了垃圾…', cx, y + 84, 16, PAL.ink)
      this.rtext(ctx, '（没用的东西）', cx, y + 104, 11, PAL.textMuted)
      this.rtext(ctx, `+${r.xp ?? 3} XP`, cx, y + 124, 12, PAL.ink)
    } else {
      this.rtext(ctx, '鱼逃走了…', cx, y + 56, 16, PAL.ink)
      drawPixelTextCenter(ctx, 'GOT AWAY', cx, y + 78, PAL.progressLow, 1, false)
    }
    const footerY = y + h - 24
    ctx.fillStyle = PAL.paperShade
    ctx.fillRect(x + 12, footerY, w - 24, 1)
    this.rtext(ctx, '点击继续', cx, footerY + 11, 11, PAL.textMuted)
  }

  private fitResultText(ctx: CanvasRenderingContext2D, text: string, width: number, size: number): string {
    ctx.save()
    ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`
    let fitted = text
    if (ctx.measureText(fitted).width > width) {
      while (fitted && ctx.measureText(fitted + '…').width > width) fitted = Array.from(fitted).slice(0, -1).join('')
      fitted += '…'
    }
    ctx.restore()
    return fitted
  }

  private wrapResultText(ctx: CanvasRenderingContext2D, text: string, width: number, size: number, maxLines: number): string[] {
    ctx.save()
    ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`
    const lines: string[] = []
    let line = ''
    const chars = Array.from(text)
    for (let i = 0; i < chars.length; i++) {
      if (line && ctx.measureText(line + chars[i]).width > width) {
        if (lines.length === maxLines - 1) {
          line = this.fitResultText(ctx, line + chars.slice(i).join(''), width, size)
          break
        }
        lines.push(line.trim())
        line = ''
      }
      line += chars[i]
    }
    if (line || !lines.length) lines.push(line.trim())
    ctx.restore()
    return lines
  }

  /** 在透明离屏画布上染色，避免 source-atop 把不透明的面板底色染成方块。 */
  private starMask(color: string): HTMLCanvasElement {
    let mask = this.starMasks.get(color)
    if (!mask) {
      mask = document.createElement('canvas')
      mask.width = this.sprites.star.width
      mask.height = this.sprites.star.height
      const target = mask.getContext('2d')!
      target.drawImage(this.sprites.star, 0, 0)
      target.globalCompositeOperation = 'source-in'
      target.fillStyle = color
      target.fillRect(0, 0, mask.width, mask.height)
      this.starMasks.set(color, mask)
    }
    return mask
  }

  private drawQualityStar(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const edge = this.starMask(PAL.woodDark)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(edge, x + dx, y + dy, 14, 14)
    ctx.drawImage(this.starMask(color), x, y, 14, 14)
  }


  /** 结算窗圆形徽章（字母 + 暗描边） */
  private resultBadge(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    letter: string,
    bg: string,
    fg: string
  ): void {
    ctx.save()
    ctx.fillStyle = PAL.ink
    ctx.fillRect(cx - r + 2, cy - r, r * 2 - 4, r * 2)
    ctx.fillRect(cx - r, cy - r + 2, r * 2, r * 2 - 4)
    ctx.fillStyle = bg
    ctx.fillRect(cx - r + 3, cy - r + 2, r * 2 - 6, r * 2 - 4)
    ctx.fillRect(cx - r + 2, cy - r + 3, r * 2 - 4, r * 2 - 6)
    ctx.fillStyle = fg
    drawPixelTextCenter(ctx, letter, cx, cy - 5, fg, 2, false)
    ctx.restore()
  }

  /** 结算窗右上角 X 关闭钮（纯视觉；点击任意处继续由状态机处理） */
  private resultCloseX(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save()
    ctx.fillStyle = PAL.ink
    ctx.fillRect(cx - 8, cy - 8, 16, 16)
    ctx.fillStyle = PAL.woodLight
    ctx.fillRect(cx - 7, cy - 7, 14, 14)
    ctx.fillStyle = PAL.paperLight
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(cx - 4 + i * 2, cy - 4 + i * 2, 2, 2)
      ctx.fillRect(cx + 2 - i * 2, cy - 4 + i * 2, 2, 2)
    }
    ctx.restore()
  }

  /** PERFECT! 红印章（斜盖章） */
  private perfectStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.fillStyle = PAL.progressLow
    ctx.fillRect(-40, -8, 80, 16)
    ctx.fillStyle = PAL.paperLight
    ctx.fillRect(-39, -7, 78, 14)
    drawPixelTextCenter(ctx, 'PERFECT!', 0, -5, PAL.progressLow, 2, false)
    ctx.restore()
  }

  /** NEW 金色飘带（首次钓到传说鱼） */
  private newRibbon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.fillStyle = PAL.ink
    ctx.fillRect(-22, -8, 44, 16)
    ctx.fillStyle = PAL.chestGold
    ctx.fillRect(-21, -7, 42, 14)
    ctx.fillStyle = PAL.dirt
    ctx.fillRect(-21, 4, 42, 3)
    drawPixelTextCenter(ctx, 'NEW', 0, -5, PAL.woodDark, 2, false)
    ctx.restore()
  }

  /** 四角星闪光（传说鱼结算） */
  private sparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string): void {
    ctx.fillStyle = color
    const size = Math.max(1, Math.round(s))
    ctx.fillRect(Math.round(cx - size / 2), Math.round(cy - size * 1.5), size, size * 3)
    ctx.fillRect(Math.round(cx - size * 1.5), Math.round(cy - size / 2), size * 3, size)
  }
}
