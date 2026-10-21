// 小红书配图：用游戏真实渲染管线（SpriteFactory + PetView）出「钓鱼全过程」合成图。
// 不是截图，是同一套渲染代码的离屏绘制 —— 画面与真机一致，且保持 1:1 像素不被压缩。
import fs from 'node:fs'
import path from 'node:path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { SpriteFactory } from '../src/renderer/render/SpriteFactory'
import { PetView } from '../src/renderer/render/PetView'
import { FISH_TABLE } from '../src/renderer/fishing/data/fishTable'
import { T } from '../src/renderer/shared/constants'

const OUT_DIR = path.resolve('E:/fishing_codex/outputs/小红书预览/img')

const realCreate = createCanvas
;(globalThis as any).document = {
  createElement(tag: string) {
    if (tag === 'canvas') return realCreate(1, 1)
    return {} as any
  }
}

// 中文字体（Windows）
const FONT_BOLD = 'MSYHBD'
const FONT_REG = 'MSYH'
for (const [p, alias] of [
  ['C:/Windows/Fonts/msyhbd.ttc', FONT_BOLD],
  ['C:/Windows/Fonts/msyh.ttc', FONT_REG]
] as const) {
  if (fs.existsSync(p)) {
    const ok = GlobalFonts.registerFromPath(p, alias)
    console.log('font', alias, ok ? 'ok' : 'FAILED')
  } else {
    console.log('font missing', p)
  }
}

// ---------- 配色 ----------
const C = {
  pageBg: '#f6efe1',
  cardTop: '#e8f0f6',
  cardBottom: '#ccdeeb',
  cardBorder: '#b3c8d8',
  title: '#3a2a18',
  sub: '#7d6a52',
  badge: '#c8763c',
  badgeText: '#fff8ee',
  cap: '#33261a',
  footBg: '#efe2cb',
  footText: '#6a563c'
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ---------- 基本场景 ----------
function baseScene(): any {
  return {
    time: 1.0,
    playerPose: 'idle',
    playerFrame: 0,
    playerX: T.PLAYER_X,
    playerFootY: T.PLAYER_FOOT_Y,
    bobber: null,
    splash: null,
    lineVisible: false,
    minigame: null,
    result: null,
    hud: {
      level: 3,
      xp: 40,
      xpNeeded: 100,
      xpPct: 0.4,
      hint: '',
      charge: -1,
      exclaim: false,
      exclaimX: T.PLAYER_X,
      exclaimY: T.PLAYER_FOOT_Y - 40,
      casts: 12,
      caught: 7
    }
  }
}

function makeView(skin: any) {
  const sprites = SpriteFactory.build(FISH_TABLE, skin)
  const view = new PetView(sprites, skin)
  return { sprites, view }
}

/** 渲染一帧到 340×390 透明画布 */
function frame(view: PetView, scene: any) {
  const cv = realCreate(T.VIEW_W, T.VIEW_H)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  view.draw(ctx as any, scene)
  return cv
}

const SARDINE = FISH_TABLE.find((f) => f.id === 'sardine') ?? FISH_TABLE[0]
const PIKE = FISH_TABLE.find((f) => f.id === 'pike') ?? FISH_TABLE[0]

// ---------- 六个钓鱼阶段 ----------
function buildStages(sprites: any, view: PetView) {
  const stages: Array<{ title: string; desc: string; scene: any; zoom: [number, number, number, number] }> = []

  // 1 待机
  {
    const s = baseScene()
    s.playerPose = 'idle'
    stages.push({ title: '挂在桌面角落', desc: '随时能来一竿', scene: s, zoom: [210, 212, 120, 138] })
  }

  // 2 蓄力
  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 1
    s.hud.charge = 0.72
    s.hud.hint = '松开抛出！'
    stages.push({ title: '按住蓄力', desc: '金色 MAX 是满力度', scene: s, zoom: [210, 208, 120, 138] })
  }

  // 3 抛竿入水
  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 2
    s.bobber = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, shake: 0 }
    s.lineVisible = true
    s.splash = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, frame: 1 }
    stages.push({ title: '抛竿入水', desc: '怼得越远，好鱼越多', scene: s, zoom: [40, 272, 140, 118] })
  }

  // 4 咬钩
  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 2
    s.bobber = { x: 128, y: 322, shake: 0.95 }
    s.splash = { x: 128, y: 322, frame: 1 }
    s.hud.exclaim = true
    s.hud.exclaimX = 128
    s.hud.exclaimY = 396 - 14
    stages.push({ title: '咬钩了', desc: '浮标猛沉，点一下收线', scene: s, zoom: [78, 280, 120, 108] })
  }

  // 5 拉锯
  {
    const s = baseScene()
    s.playerPose = 'reel'
    s.minigame = {
      fishPos: 300,
      fishVel: 40,
      fishIcon: sprites.fish[SARDINE.id][1],
      barPos: 238,
      barSize: T.BAR_SIZE_BASE,
      progress: 0.55,
      treasure: { pos: 120, progress: 0.4 },
      legendary: false
    }
    s.hud.hint = ''
    stages.push({ title: '绿条拉锯', desc: '跟不住鱼就跑了', scene: s, zoom: [8, 232, 58, 118] })
  }

  // 6 上鱼结算
  {
    const s = baseScene()
    s.playerPose = 'show'
    s.result = {
      kind: 'fish',
      perfect: true,
      treasure: false,
      maxCast: true,
      xp: 26,
      leveledUp: 0,
      fishName: PIKE.name,
      fishIcon: sprites.fish[PIKE.id][1],
      size: 18,
      quality: 'gold'
    }
    stages.push({ title: '上鱼结算', desc: 'PERFECT +26 XP', scene: s, zoom: [78, 96, 180, 207] })
  }

  return stages
}

/** cover 模式把 src 的某块区域放大填满目标框（不变形，居中裁剪） */
function drawZoom(ctx: any, src: any, rect: [number, number, number, number], tx: number, ty: number, tw: number, th: number) {
  const [sx, sy, sw, sh] = rect
  const k = Math.max(tw / sw, th / sh)
  const dw = sw * k
  const dh = sh * k
  ctx.save()
  ctx.beginPath()
  ctx.rect(tx, ty, tw, th)
  ctx.clip()
  ctx.drawImage(src, sx, sy, sw, sh, tx + (tw - dw) / 2, ty + (th - dh) / 2, dw, dh)
  ctx.restore()
}

// ---------- 图 A：钓鱼全过程 6 格 ----------
function renderFlow(skin: any) {
  const { sprites, view } = makeView(skin)
  const stages = buildStages(sprites, view)

  const FR_W = T.VIEW_W // 340
  const FR_H = T.VIEW_H // 390
  const margin = 20
  const gap = 30
  const labelH = 66
  const cols = 3
  const W = margin * 2 + cols * FR_W + gap * (cols - 1) // 1120
  const titleH = 250
  const rowGap = 34
  const footH = 350
  const H = titleH + (FR_H + labelH) * 2 + rowGap + footH

  const cv = realCreate(W, H)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false

  // 页面底：羊皮纸暖色
  ctx.fillStyle = C.pageBg
  ctx.fillRect(0, 0, W, H)

  // 标题
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = C.title
  ctx.font = `bold 66px ${FONT_BOLD}`
  ctx.fillText('一条鱼是怎么钓上来的', margin + 4, 66)
  ctx.fillStyle = C.badge
  ctx.fillRect(margin + 4, 168, 96, 8)
  ctx.fillStyle = C.sub
  ctx.font = `30px ${FONT_REG}`
  ctx.fillText('星露谷同款钓鱼玩法 · 全流程演示', margin + 4, 194)

  stages.forEach((st, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = margin + col * (FR_W + gap)
    const y = titleH + row * (FR_H + labelH + rowGap)

    // 桌面感背景卡
    const grad = ctx.createLinearGradient(0, y, 0, y + FR_H)
    grad.addColorStop(0, C.cardTop)
    grad.addColorStop(1, C.cardBottom)
    roundRect(ctx, x, y, FR_W, FR_H, 10)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.strokeStyle = C.cardBorder
    ctx.lineWidth = 2
    ctx.stroke()

    // 1:1 绘制游戏帧
    const fr = frame(view, st.scene)
    ctx.drawImage(fr, x, y)
    ;(st as any)._cv = fr

    // 序号徽章
    const bx = x + 12
    const by = y + 12
    ctx.beginPath()
    ctx.arc(bx + 22, by + 22, 22, 0, Math.PI * 2)
    ctx.fillStyle = C.badge
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = C.badgeText
    ctx.font = `bold 26px ${FONT_BOLD}`
    ctx.fillText(String(i + 1), bx + 22, by + 23)

    // 说明
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = C.cap
    ctx.font = `bold 32px ${FONT_BOLD}`
    ctx.fillText(st.title, x, y + FR_H + 14)
    ctx.fillStyle = C.sub
    ctx.font = `24px ${FONT_REG}`
    ctx.fillText(st.desc, x, y + FR_H + 50)
  })

  // 底部：同一套画面的局部放大（桌宠在桌面上很小，手机上看不清细节）
  const ZW = 150
  const ZH = 172
  const zGap = 20
  const zCount = stages.length
  const zStartX = (W - (zCount * ZW + (zCount - 1) * zGap)) / 2
  const zTop = H - footH + 74

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = C.sub
  ctx.font = `26px ${FONT_REG}`
  ctx.fillText('放大看看（同一局画面）', margin + 4, H - footH + 26)

  stages.forEach((st, i) => {
    const x = zStartX + i * (ZW + zGap)
    roundRect(ctx, x, zTop, ZW, ZH, 8)
    const g = ctx.createLinearGradient(0, zTop, 0, zTop + ZH)
    g.addColorStop(0, C.cardTop)
    g.addColorStop(1, C.cardBottom)
    ctx.save()
    ctx.clip()
    ctx.fillStyle = g
    ctx.fillRect(x, zTop, ZW, ZH)
    drawZoom(ctx, (st as any)._cv, st.zoom, x, zTop, ZW, ZH)
    ctx.restore()
    ctx.strokeStyle = C.cardBorder
    ctx.lineWidth = 2
    roundRect(ctx, x, zTop, ZW, ZH, 8)
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = C.footText
    ctx.font = `22px ${FONT_REG}`
    ctx.fillText(`${i + 1}. ${st.title}`, x + ZW / 2, zTop + ZH + 12)
  })

  const out = path.join(OUT_DIR, '06-钓鱼全过程.png')
  fs.writeFileSync(out, cv.toBuffer('image/png'))
  console.log('wrote', out, `${W}x${H}`)
}

// ---------- 图 B：隐身前后对比 ----------
function renderStealth(skin: any) {
  const { sprites, view } = makeView(skin)

  const scale = 1.5
  const FR_W = Math.round(T.VIEW_W * scale) // 510
  const FR_H = Math.round(T.VIEW_H * scale) // 585
  const margin = 30
  const gap = 40
  const W = margin * 2 + FR_W * 2 + gap // 1120
  const titleH = 120
  const labelH = 70
  const H = titleH + FR_H + labelH + 40 // 815

  const cv = realCreate(W, H)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false

  ctx.fillStyle = C.pageBg
  ctx.fillRect(0, 0, W, H)

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = C.title
  ctx.font = `bold 46px ${FONT_BOLD}`
  ctx.fillText('老板来了按一下 H', margin, 34)
  ctx.fillStyle = C.sub
  ctx.font = `24px ${FONT_REG}`
  ctx.fillText('小人立刻消失，只剩右下角一个菜单点', margin, 90)

  // 左：正常钓鱼（拉锯中）
  const normalScene = baseScene()
  normalScene.playerPose = 'reel'
  normalScene.minigame = {
    fishPos: 300,
    fishVel: 40,
    fishIcon: sprites.fish[SARDINE.id][1],
    barPos: 238,
    barSize: T.BAR_SIZE_BASE,
    progress: 0.55,
    treasure: null,
    legendary: false
  }

  // 右：隐身
  const hidden = baseScene()
  hidden.playerPose = 'reel'
  hidden.minigame = { ...normalScene.minigame }

  const panels = [
    { x: margin, scene: normalScene, t: '平时', d: '挂在角落钓鱼', stealth: false },
    { x: margin + FR_W + gap, scene: hidden, t: '隐身后', d: '人和等级全部消失', stealth: true }
  ]

  for (const p of panels) {
    const grad = ctx.createLinearGradient(0, titleH, 0, titleH + FR_H)
    grad.addColorStop(0, C.cardTop)
    grad.addColorStop(1, C.cardBottom)
    roundRect(ctx, p.x, titleH, FR_W, FR_H, 12)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.strokeStyle = C.cardBorder
    ctx.lineWidth = 2
    ctx.stroke()

    view.stealth = p.stealth
    const f = frame(view, p.scene)
    view.stealth = false
    ctx.drawImage(f, p.x, titleH, FR_W, FR_H)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = C.cap
    ctx.font = `bold 34px ${FONT_BOLD}`
    ctx.fillText(p.t, p.x, titleH + FR_H + 16)
    ctx.fillStyle = C.sub
    ctx.font = `24px ${FONT_REG}`
    ctx.fillText(p.d, p.x, titleH + FR_H + 56)
  }

  // 中间箭头
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = C.badge
  ctx.font = `bold 60px ${FONT_BOLD}`
  ctx.fillText('→', margin + FR_W + gap / 2, titleH + FR_H / 2)

  const out = path.join(OUT_DIR, '07-隐身防老板.png')
  fs.writeFileSync(out, cv.toBuffer('image/png'))
  console.log('wrote', out, `${W}x${H}`)
}

// ---------- 图 C：待机单帧（封面候选，桌面背景） ----------
function renderHero(skin: any) {
  const { view } = makeView(skin)
  const scale = 3
  const W = T.VIEW_W * scale
  const H = T.VIEW_H * scale
  const cv = realCreate(W, H)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#eaf2f8')
  grad.addColorStop(1, '#c6dae8')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
  const s = baseScene()
  s.playerPose = 'idle'
  view.toolsHover = true
  ctx.drawImage(frame(view, s), 0, 0, W, H)
  view.toolsHover = false
  const out = path.join(OUT_DIR, `08-封面-${skin}.png`)
  fs.writeFileSync(out, cv.toBuffer('image/png'))
  console.log('wrote', out, `${W}x${H}`)
}

const skin = (process.argv[2] as any) ?? 'shinchan'
renderFlow(skin)
renderStealth(skin)
renderHero(skin)
