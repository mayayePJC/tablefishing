import { T } from '../shared/constants'
import { PAL, QUALITY_COLOR, QUALITY_LABEL } from './Palette'
import type { PlayerPose, SpriteSet } from './SpriteFactory'
import { ROD_TIPS } from './SpriteFactory'
import { drawPixelText, drawPixelTextCenter } from './PixelFont'
import type { CharacterSkin, SceneState, MinigameViewState, ResultViewState } from '../shared/types'

/** 小游戏捕获条在桌宠窗口中的布局：缩小、精致，放在「与小人平行」的左侧（不再高高挂在左上角） */
const BAR_W = 34
const BAR_H = 110
const BAR_TOP = 236
const BAR_X = 16

/** 垂钓者的屏幕显示尺寸 */
const CAT_DW = T.PLAYER_W * T.PLAYER_SCALE
const CAT_DH = T.PLAYER_H * T.PLAYER_SCALE

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
  /** 隐身模式：隐藏人物与 lev 徽章，仅保留工具按钮（由 Game 写入） */
  stealth = false
  /** 点击区域可视化：开启后把"钓鱼区 / 拖拽区 / 菜单 / 无效区"用彩色边框+标签画出来，
   *  让使用者一眼看清"点哪里生效哪里不生效"。纯画布叠加层，不拦截任何点击。 */
  showClickMap = false

  private skin: CharacterSkin
  private rodTip: Record<PlayerPose, [number, number]>
  private sprites: SpriteSet

  constructor(sprites: SpriteSet, skin: CharacterSkin = 'farmer') {
    this.sprites = sprites
    this.skin = skin
    this.rodTip = ROD_TIPS[skin]
  }

  /** 切换人物形象并刷新精灵与竿尖偏移 */
  setSprites(sprites: SpriteSet, skin: CharacterSkin = this.skin): void {
    this.sprites = sprites
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
    const px = state.playerX
    const py = state.playerFootY

    // 点击区域示意（先画底层填充/边框，最后再画文字标签，确保标签永远在最上层）
    if (this.showClickMap) this.drawClickMapBack(ctx)

    // 接触阴影（让垂钓者"站"在桌面上）——隐身时一并隐藏
    if (!this.stealth) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.beginPath()
      ctx.ellipse(px, py - 1, CAT_DW * 0.42, 5, 0, 0, Math.PI * 2)
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
      const cx = px - 23
      const cy = py - CAT_DH - 12
      const isMax = state.hud.charge >= T.MAX_CAST_THRESHOLD
      const glow = isMax ? 0.5 + 0.5 * Math.sin(state.time * 12) : 0
      ctx.fillStyle = isMax ? `rgba(96,66,12,${0.6 + glow * 0.25})` : 'rgba(6,13,20,0.55)'
      ctx.fillRect(cx - 1, cy - 1, 48, 6)
      ctx.fillStyle = '#12384f'
      ctx.fillRect(cx, cy, 46, 4)
      ctx.fillStyle = isMax ? mix('#e8b23a', '#fff0b8', glow) : mix(PAL.progressMid, PAL.progressHigh, state.hud.charge)
      ctx.fillRect(cx, cy, Math.round(46 * state.hud.charge), 4)
      if (isMax) {
        drawPixelTextCenter(ctx, 'MAX', cx + 23, cy - 13, mix('#e8b23a', '#fff0b8', glow), 2, true)
      }
    }

    // 垂钓者（隐身模式下不绘制人物与 lev 徽章）
    if (!this.stealth) {
      this.drawCat(ctx, state)
      this.drawLevelBadge(ctx, state)
    }

    // 右下角工具按钮
    this.drawToolsButton(ctx)

    // 点击区域示意：标签画在最上层
    if (this.showClickMap) this.drawClickMapTags(ctx)

    // 结算弹窗
    if (state.result) this.drawResult(ctx, state.result)
  }

  /**
   * 点击区域可视化（底层）：用半透明填充 + 彩色边框标出四大区域。
   *  - 顶部红色带：无效区（窗口上缘，避免误触）
   *  - 绿色虚线框：钓鱼区（点按任意处 = 钓鱼）
   *  - 蓝色框：拖拽/轻点区（恰好覆盖原生拖拽手柄，与 Game 里的 #drag-handle 一致）
   *  - 黄色圈：工具菜单命中范围
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

    // 钓鱼区：绿色虚线框（人物本体 + 等级徽章及下方区域，与 Game 中 #pet-hit 一致）
    const catL = T.PLAYER_X - CAT_DW / 2
    const catR = T.PLAYER_X + CAT_DW / 2
    const badgeR = Math.min(T.VIEW_W - 1, T.PLAYER_X + CAT_DW / 2 + 4 + 68)
    const hitL = catL - 6
    const hitT = T.PLAYER_FOOT_Y - CAT_DH - 6
    const hitR = badgeR + 2
    const hitB = T.PLAYER_FOOT_Y + 6
    ctx.strokeStyle = 'rgba(90,210,120,0.85)'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.strokeRect(hitL, hitT, hitR - hitL, hitB - hitT)
    ctx.setLineDash([])

    // 拖拽/轻点区：蓝色实框（钓鱼区外扩一圈细拖窗框，与 Game 中 #pet-handle 一致）
    const MM = 20
    const hl = Math.max(0, hitL - MM)
    const ht = Math.max(0, hitT - MM)
    const hr = Math.min(T.VIEW_W, hitR + MM)
    const hb = Math.min(T.TOOLS_BTN.y - T.TOOLS_BTN.r - 4, hitB + 4)
    ctx.fillStyle = 'rgba(80,150,230,0.16)'
    ctx.fillRect(hl, ht, hr - hl, hb - ht)
    ctx.strokeStyle = 'rgba(120,180,255,0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(hl, ht, hr - hl, hb - ht)

    // 工具菜单命中区：黄色圈（比视觉圈略大，表示实际命中半径）
    const t = T.TOOLS_BTN
    ctx.strokeStyle = 'rgba(240,210,80,0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(t.x, t.y, t.r + 3, 0, Math.PI * 2)
    ctx.stroke()

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
      '点按任意处 = 钓鱼（蓄力 / 收线）',
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
    ctx.fillStyle = this.toolsHover ? 'rgba(42,107,143,0.96)' : 'rgba(12,20,28,0.78)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = this.toolsHover ? '#bfe6f5' : 'rgba(232,246,249,0.85)'
    ctx.stroke()
    // 汉堡菜单：三横线
    ctx.strokeStyle = this.toolsHover ? '#ffffff' : '#e8f6f9'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    const w = r * 0.52
    for (let i = -1; i <= 1; i++) {
      const yy = y + i * 5
      ctx.beginPath()
      ctx.moveTo(x - w, yy)
      ctx.lineTo(x + w, yy)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawCat(ctx: CanvasRenderingContext2D, state: SceneState): void {
    const pose = state.playerPose
    let img: HTMLCanvasElement
    if (pose === 'idle') img = this.sprites.playerIdle[Math.floor(state.time * 1.6) % 2]
    else if (pose === 'cast') img = this.sprites.playerCast[Math.min(2, state.playerFrame | 0)]
    else if (pose === 'reel') img = this.sprites.playerReel
    else img = this.sprites.playerShow
    const dx = Math.round(state.playerX - CAT_DW / 2)
    const dy = Math.round(state.playerFootY - CAT_DH)
    ctx.drawImage(img, dx, dy, CAT_DW, CAT_DH)
  }

  private rodTipWorld(state: SceneState): [number, number] {
    const pose = state.playerPose
    const key = pose === 'reel' ? 'reel' : pose === 'cast' ? 'cast2' : 'idle0'
    const [ox, oy] = this.rodTip[key]
    const dx = state.playerX - CAT_DW / 2
    const dy = state.playerFootY - CAT_DH
    return [dx + ox * T.PLAYER_SCALE, dy + oy * T.PLAYER_SCALE]
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

    // 外框（半透明玻璃感 + 柔和青色辉光，缩小后更精致；圆角贴合桌宠整体风格）
    const fx = BAR_X - 5, fy = BAR_TOP - 5, fw = BAR_W + 10, fh = BAR_H + 10
    ctx.save()
    ctx.shadowColor = 'rgba(111,195,223,0.55)'
    ctx.shadowBlur = 10
    ctx.fillStyle = 'rgba(13,43,58,0.82)'
    ctx.beginPath()
    ctx.roundRect(fx, fy, fw, fh, 6)
    ctx.fill()
    ctx.restore()
    // 细亮边框
    ctx.strokeStyle = 'rgba(111,195,223,0.85)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(fx + 0.75, fy + 0.75, fw - 1.5, fh - 1.5, 6)
    ctx.stroke()
    // 顶/底深色压边，增强对比
    ctx.fillStyle = PAL.uiBorder
    ctx.fillRect(fx, fy, fw, 2)
    ctx.fillRect(fx, fy + fh - 2, fw, 2)

    // 轨道背景（竖直渐变）
    for (let y = 0; y < BAR_H; y++) {
      ctx.fillStyle = mix(PAL.trackTop, PAL.trackBottom, y / BAR_H)
      ctx.fillRect(BAR_X, BAR_TOP + y, BAR_W, 1)
    }
    // 水中微粒
    ctx.fillStyle = 'rgba(232,246,249,0.14)'
    for (let i = 0; i < 12; i++) {
      const px = BAR_X + 10 + ((i * 53) % (BAR_W - 20))
      const py = BAR_TOP + ((i * 97) % BAR_H)
      ctx.fillRect(px, py, 2, 2)
    }

    // 宝箱（含独立进度）
    if (s.treasure) {
      const ty = this.clampTrack(this.toY(s.treasure.pos), 12)
      ctx.drawImage(this.sprites.chest, BAR_X + BAR_W / 2 - 16, Math.round(ty - 12), 32, 25)
      const bw = 22
      const bx = BAR_X + BAR_W / 2 - bw / 2
      const by = ty + 13
      ctx.fillStyle = 'rgba(6,13,20,0.7)'
      ctx.fillRect(bx - 1, by - 1, bw + 2, 5)
      ctx.fillStyle = PAL.chestGold
      ctx.fillRect(bx, by, Math.round(bw * s.treasure.progress), 3)
    }

    // 鱼图标（夹在轨道框内，避免沉底时戳出绿条下边界）
    const fishY = this.clampTrack(this.toY(s.fishPos), 16)
    const fishW = 22
    const fishH = 33
    ctx.drawImage(s.fishIcon, BAR_X + BAR_W / 2 - fishW / 2, Math.round(fishY - fishH / 2), fishW, fishH)
    if (s.legendary) ctx.drawImage(this.sprites.crown, BAR_X + BAR_W / 2 - 13, Math.round(fishY - 25), 26, 19)

    // 绿色捕获条（夹在轨道框内，确保沉到底也能覆盖鱼）
    const barH = s.barSize * scale
    const barY = Math.max(BAR_TOP, Math.min(BAR_TOP + BAR_H - barH, this.toY(s.barPos)))
    ctx.fillStyle = PAL.barEdge
    ctx.fillRect(BAR_X + 6, Math.round(barY) - 2, BAR_W - 12, Math.round(barH) + 4)
    ctx.fillStyle = PAL.barFill
    ctx.fillRect(BAR_X + 8, Math.round(barY), BAR_W - 16, Math.round(barH))
    ctx.fillStyle = PAL.barHighlight
    ctx.fillRect(BAR_X + 8, Math.round(barY), BAR_W - 16, 2)
    ctx.fillStyle = PAL.barFillDark
    ctx.fillRect(BAR_X + 8, Math.round(barY + barH) - 2, BAR_W - 16, 2)

    // 进度条（轨道右侧）
    const pX = BAR_X + BAR_W + 8
    const pW = 14
    ctx.fillStyle = 'rgba(13,43,58,0.82)'
    ctx.fillRect(pX - 2, BAR_TOP - 2, pW + 4, BAR_H + 4)
    ctx.fillStyle = '#0d2b3a'
    ctx.fillRect(pX, BAR_TOP, pW, BAR_H)
    const pH = Math.round(BAR_H * s.progress)
    const pColor = s.progress < 0.35 ? PAL.progressLow : s.progress < 0.7 ? PAL.progressMid : PAL.progressHigh
    ctx.fillStyle = pColor
    ctx.fillRect(pX + 1, BAR_TOP + BAR_H - pH - 1, pW - 2, pH)
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.fillRect(pX + 1, BAR_TOP + BAR_H - pH - 1, pW - 2, 2)
  }

  private drawLevelBadge(ctx: CanvasRenderingContext2D, state: SceneState): void {
    const h = state.hud
    // 紧贴人物右上角，跟随人物站位
    const x = Math.round(state.playerX + CAT_DW / 2 + 4)
    const y = Math.round(state.playerFootY - CAT_DH + 4)
    ctx.fillStyle = 'rgba(6,13,20,0.5)'
    ctx.fillRect(x - 1, y - 1, 68, 18)
    drawPixelText(ctx, `LV${h.level}`, x, y, PAL.textLight, 2)
    // 经验条
    const bx = x + 26
    const by = y + 3
    const bw = 34
    ctx.fillStyle = '#0d2b3a'
    ctx.fillRect(bx, by, bw, 9)
    ctx.fillStyle = PAL.barFill
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * h.xpPct), 7)
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * h.xpPct), 2)
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

  /** 结算弹窗：按内容多少动态调整高度，整体紧凑；MAX CAST 徽章加宽并完整放入框内。 */
  private drawResult(ctx: CanvasRenderingContext2D, r: ResultViewState): void {
    const w = 230
    const x = Math.round((T.VIEW_W - w) / 2)
    const y = 46
    const dark = '#3a2e22'
    const sub = '#6a5a44'
    const cx = x + w / 2

    // 先按类型计算所需高度
    let h = 150
    if (r.kind === 'fish') {
      h = 150 // 标题 + 尺寸 + 品质 + XP + 点击继续
      if (r.maxCast) h += 16
      if (r.perfect) h += 16
      if (r.treasure) h += 16
      if (r.leveledUp) h += 16
      if (r.unlockedRod) h += 16
    } else if (r.kind === 'trash') {
      h = 146
    } else {
      h = 132
    }

    // 背板（星露谷对话框：米色 + 木棕描边）
    ctx.fillStyle = 'rgba(6,13,20,0.3)'
    ctx.fillRect(x + 3, y + 3, w, h)
    ctx.fillStyle = '#f0e6cc'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = PAL.dirt
    ctx.fillRect(x, y, w, 3)
    ctx.fillRect(x, y + h - 3, w, 3)
    ctx.fillRect(x, y, 3, h)
    ctx.fillRect(x + w - 3, y, 3, h)
    ctx.fillStyle = PAL.woodLight
    ctx.fillRect(x + 3, y + 3, w - 6, 1)

    if (r.kind === 'fish') {
      // 鱼图标（左侧，与文字块留 4px 间隙）
      if (r.fishIcon) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(r.fishIcon, x + 18, y + 28, r.fishIcon.width * 3, r.fishIcon.height * 3)
      }
      // 右侧文字块：左对齐、紧凑行高
      const tx = x + 88
      let ty = y + 24
      this.rtext(ctx, `钓到了 ${r.fishName ?? ''}！`, tx, ty, 16, dark, 'left'); ty += 22
      this.rtext(ctx, `${r.size ?? 0} IN`, tx, ty, 12, sub, 'left'); ty += 20
      // 品质星星（与标签同行，竖直居中）
      const stars = r.quality === 'iridium' ? 3 : r.quality === 'gold' ? 2 : r.quality === 'silver' ? 1 : 0
      const qc = QUALITY_COLOR[r.quality ?? 'normal']
      for (let i = 0; i < 3; i++) {
        const sx = Math.round(tx + i * 14)
        const sy = ty - 4
        if (i < stars) {
          ctx.drawImage(this.sprites.star, sx, sy)
          ctx.globalCompositeOperation = 'source-atop'
          ctx.fillStyle = qc
          ctx.fillRect(sx, sy, 7, 7)
          ctx.globalCompositeOperation = 'source-over'
        } else {
          ctx.fillStyle = 'rgba(58,46,34,0.18)'
          ctx.fillRect(sx, sy, 7, 7)
        }
      }
      this.rtext(ctx, QUALITY_LABEL[r.quality ?? 'normal'], tx + 48, ty, 12, sub, 'left'); ty += 20

      if (r.maxCast) {
        const chipW = 56
        const chipX = tx - 2
        ctx.fillStyle = '#8a5c2e'
        ctx.fillRect(chipX, ty - 9, chipW, 15)
        ctx.fillStyle = PAL.chestGold
        ctx.fillRect(chipX + 1, ty - 8, chipW - 2, 13)
        this.rtext(ctx, 'MAX CAST', tx + chipW / 2 - 1, ty - 1, 10, '#5d3d22', 'center')
        ty += 16
      }
      if (r.perfect) { this.rtext(ctx, 'PERFECT!', tx, ty, 12, PAL.progressHigh, 'left'); ty += 16 }
      if (r.treasure) {
        ctx.drawImage(this.sprites.chest, Math.round(tx - 2), ty - 9)
        this.rtext(ctx, 'TREASURE', tx + 22, ty - 2, 11, PAL.chest, 'left')
        ty += 16
      }
      this.rtext(ctx, `+${r.xp ?? 0} XP`, tx, ty, 13, dark, 'left'); ty += 16
      if (r.leveledUp && r.leveledUp > 0) {
        this.rtext(ctx, `升级 ×${r.leveledUp}`, tx, ty, 13, PAL.progressHigh, 'left'); ty += 16
      }
      if (r.unlockedRod) {
        ctx.drawImage(this.sprites.rod, Math.round(tx - 2), ty - 9)
        this.rtext(ctx, `解锁 ${r.unlockedRod}`, tx + 22, ty - 2, 11, PAL.chestGold, 'left')
      }
    } else if (r.kind === 'trash') {
      if (r.trashIcon) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(r.trashIcon, cx - r.trashIcon.width * 2, y + 22, r.trashIcon.width * 4, r.trashIcon.height * 4)
      }
      this.rtext(ctx, '钓上了垃圾…', cx, y + 60, 17, dark, 'center')
      this.rtext(ctx, '（没用的东西）', cx, y + 86, 11, sub, 'center')
      this.rtext(ctx, `+${r.xp ?? 3} XP`, cx, y + 108, 13, dark, 'center')
    } else {
      this.rtext(ctx, '鱼逃走了…', cx, y + 40, 17, dark, 'center')
      this.rtext(ctx, 'GOT AWAY', cx, y + 64, 12, PAL.progressLow, 'center')
      this.rtext(ctx, '点击重新抛竿', cx, y + 94, 12, sub, 'center')
    }

    this.rtext(ctx, '点击继续', cx, y + h - 14, 11, '#8a7a64', 'center')
  }
}
