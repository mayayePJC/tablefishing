// 截图验证脚本：用 node + @napi-rs/canvas 把 PetView 渲染成 PNG，直观检查比例。
import { createCanvas } from '@napi-rs/canvas'
import { SpriteFactory } from '../src/renderer/render/SpriteFactory'
import { PetView } from '../src/renderer/render/PetView'
import { FISH_TABLE } from '../src/renderer/fishing/data/fishTable'
import { T } from '../src/renderer/shared/constants'
import type { CharacterSkin, SceneState } from '../src/renderer/shared/types'

// --- DOM 垫片：让 PixelCanvas(SpriteFactory) 在 Node 里也能建画布 ---
const realCreate = createCanvas
;(globalThis as any).document = {
  createElement(tag: string) {
    if (tag === 'canvas') return realCreate(1, 1)
    return {} as any
  }
}
;(globalThis as any).ImageData = (globalThis as any).ImageData

function baseScene(): SceneState {
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
      hint: '按住左键 / C 蓄力，松开抛竿',
      charge: -1,
      exclaim: false,
      exclaimX: T.PLAYER_X,
      exclaimY: T.PLAYER_FOOT_Y - 40,
      casts: 12,
      caught: 7
    }
  }
}

function render(name: string, scene: SceneState, view: PetView, sprites: ReturnType<typeof SpriteFactory.build>) {
  const cv = realCreate(T.VIEW_W, T.VIEW_H)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  // 透明背景（桌宠）。但为了能"看清楚比例"，加一层很淡的棋盘格提示窗口边界。
  const check = 8
  for (let y = 0; y < T.VIEW_H; y += check) {
    for (let x = 0; x < T.VIEW_W; x += check) {
      const on = ((x / check) | 0) % 2 === ((y / check) | 0) % 2
      ctx.fillStyle = on ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'
      ctx.fillRect(x, y, check, check)
    }
  }
  view.draw(ctx as any, scene)
  const out = `scripts/shot_${name}.png`
  require('fs').writeFileSync(out, cv.toBuffer('image/png'))
  console.log('wrote', out, `(${T.VIEW_W}x${T.VIEW_H})`)
}

function renderAll(skin: CharacterSkin) {
  const sprites = SpriteFactory.build(FISH_TABLE, skin)
  const view = new PetView(sprites, skin)
  const suffix = skin

  // 1) 待机（右下角可见工具按钮）
  render(`idle_${suffix}`, baseScene(), view, sprites)

  // 2) 小游戏进行中（新绿条尺寸 124、对齐开局）
  {
    const s = baseScene()
    s.playerPose = 'reel'
    const fish = FISH_TABLE.find((f) => f.id === 'sardine') ?? FISH_TABLE[0]
    s.minigame = {
      fishPos: 300,
      fishVel: 40,
      fishIcon: sprites.fish[fish.id][1],
      barPos: 238,
      barSize: T.BAR_SIZE_BASE,
      progress: 0.55,
      treasure: { pos: 120, progress: 0.4 },
      legendary: false
    }
    s.hud.hint = ''
    render(`minigame_${suffix}`, s, view, sprites)
  }

  // 3) 鱼逃走了
  {
    const s = baseScene()
    s.result = { kind: 'escaped', perfect: false, treasure: false, xp: 0, leveledUp: 0 }
    render(`escaped_${suffix}`, s, view, sprites)
  }

  // 4) 抛竿（浮标 + 水花 + 钓线；无池塘，直接悬空垂钓）
  // 姿态必须用 cast/cast2——钓鱼会话中蓄力后保持 cast2，钓线从 cast2 竿尖出发（规范 §2.4）
  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 2
    s.bobber = { x: 128, y: 322, shake: 0.1 }
    s.splash = { x: 128, y: 322, frame: 1 }
    render(`fishing_${suffix}`, s, view, sprites)
  }

  // 4b) 不蓄力（p=0）：落点靠右偏低 = 近
  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 2
    s.bobber = { x: T.CAST_X_MAX, y: T.CAST_Y_MAX, shake: 0 }
    s.lineVisible = true
    s.splash = { x: T.CAST_X_MAX, y: T.CAST_Y_MAX, frame: 1 }
    render(`cast_near_${suffix}`, s, view, sprites)
  }

  // 4c) 满蓄力（p=1）：落点靠左偏高 = 远，钓线明显更长
  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 2
    s.bobber = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, shake: 0 }
    s.lineVisible = true
    s.splash = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, frame: 1 }
    render(`cast_far_${suffix}`, s, view, sprites)
  }

  // 5) 咬钩！（浮标剧烈抖动 + 水花 + 感叹号）
  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 2
    s.bobber = { x: 128, y: 322, shake: 0.95 }
    s.splash = { x: 128, y: 322, frame: 1 }
    s.hud.exclaim = true
    s.hud.exclaimX = 128
    s.hud.exclaimY = 396 - 14
    render(`bite_${suffix}`, s, view, sprites)
  }

  // 6) 钓到鱼结算窗（验证文字清晰度；同时塞满 MAX/PERFECT/TREASURE/LEVEL UP 看高度）
  {
    const s = baseScene()
    s.playerPose = 'show'
    const fish = FISH_TABLE.find((f) => f.id === 'sardine') ?? FISH_TABLE[0]
    s.result = {
      kind: 'fish',
      perfect: true,
      treasure: true,
      maxCast: true,
      xp: 26,
      leveledUp: 1,
      fishName: fish.name,
      fishIcon: sprites.fish[fish.id][1],
      size: 18,
      quality: 'gold'
    }
    render(`catch_${suffix}`, s, view, sprites)
  }

  // 7) MAX 蓄力态（满力度：金色条 + MAX 闪烁提示）
  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 2
    s.hud.charge = 1
    s.hud.hint = '松开抛出！'
    render(`chargemax_${suffix}`, s, view, sprites)
  }

  // 8) MAX 抛竿钓到鱼（结算窗金色 MAX CAST 徽章）
  {
    const s = baseScene()
    s.playerPose = 'show'
    const fish = FISH_TABLE.find((f) => f.id === 'pike') ?? FISH_TABLE[0]
    s.result = {
      kind: 'fish',
      perfect: true,
      treasure: false,
      maxCast: true,
      xp: 26,
      leveledUp: 0,
      fishName: fish.name,
      fishIcon: sprites.fish[fish.id][1],
      size: 18,
      quality: 'gold'
    }
    render(`catchmax_${suffix}`, s, view, sprites)
  }

  // 9) 工具按钮悬停态（验证右下角汉堡图标高亮）
  {
    view.toolsHover = true
    render(`toolshover_${suffix}`, baseScene(), view, sprites)
    view.toolsHover = false
  }

  // 10) 隐身模式（隐藏人物与 lev 徽章，工具按钮仍在）
  {
    view.stealth = true
    render(`stealth_${suffix}`, baseScene(), view, sprites)
    view.stealth = false
  }

  // 11) 点击区域可视化（点按范围示意：钓鱼区 / 拖拽区 / 菜单 / 无效区）
  {
    view.showClickMap = true
    render(`clickmap_${suffix}`, baseScene(), view, sprites)
    view.showClickMap = false
  }
}

// 12) 新形象七姿态对比表：缩放 4x 最近邻排到一张图，检查剪影/描边/持竿
function renderPoseSheet(skin: CharacterSkin) {
  const sprites = SpriteFactory.build(FISH_TABLE, skin)
  const scale = 4
  const cellW = 24 * scale
  const cellH = 40 * scale
  const cols = 4
  const rows = 2
  const pad = 10
  const titleH = 30
  const labelH = 20
  const cv = realCreate(cols * cellW + pad * 2, titleH + pad + rows * cellH + labelH + pad)
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#10181f'
  ctx.fillRect(0, 0, cv.width, cv.height)
  ctx.fillStyle = '#8fc4d4'
  ctx.font = 'bold 18px sans-serif'
  ctx.fillText(`poses · ${skin}`, pad, 22)
  const poses: Array<[string, HTMLCanvasElement]> = [
    ['idle0', sprites.playerIdle[0]],
    ['idle1', sprites.playerIdle[1]],
    ['cast0', sprites.playerCast[0]],
    ['cast1', sprites.playerCast[1]],
    ['cast2', sprites.playerCast[2]],
    ['reel', sprites.playerReel],
    ['show', sprites.playerShow]
  ]
  poses.forEach(([label, img], i) => {
    const cx = pad + (i % cols) * cellW
    const cy = titleH + pad + Math.floor(i / cols) * cellH
    // 棋盘格衬底，凸显透明像素与暗描边
    const check = 8
    for (let y = 0; y < cellH; y += check) {
      for (let x = 0; x < cellW; x += check) {
        const on = ((x / check) | 0) % 2 === ((y / check) | 0) % 2
        ctx.fillStyle = on ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'
        ctx.fillRect(cx + x, cy + y, check, check)
      }
    }
    ctx.drawImage(img, cx, cy, cellW, cellH)
    ctx.fillStyle = '#9fc4d6'
    ctx.font = '12px monospace'
    ctx.fillText(label, cx + 2, cy + cellH + 14)
  })
  const out = `scripts/poses_${skin}.png`
  require('fs').writeFileSync(out, cv.toBuffer('image/png'))
  console.log('wrote', out, `(${cv.width}x${cv.height})`)
}

renderAll('farmer')
renderAll('cat')
renderPoseSheet('farmer')
renderPoseSheet('cat')
renderPoseSheet('frog')
renderPoseSheet('penguin')
renderPoseSheet('wizard')

// 13) 新形象关键场景：待机 / 远抛钓线 / 咬钩 / 举鱼结算（验证竿尖世界坐标与窗口协调）
function renderKeyScenes(skin: CharacterSkin) {
  const sprites = SpriteFactory.build(FISH_TABLE, skin)
  const view = new PetView(sprites, skin)

  render(`key_idle_${skin}`, baseScene(), view, sprites)

  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 2
    s.bobber = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, shake: 0 }
    s.lineVisible = true
    s.splash = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, frame: 1 }
    render(`key_castfar_${skin}`, s, view, sprites)
  }

  {
    const s = baseScene()
    s.playerPose = 'cast'
    s.playerFrame = 2
    s.bobber = { x: 128, y: 322, shake: 0.95 }
    s.splash = { x: 128, y: 322, frame: 1 }
    s.hud.exclaim = true
    s.hud.exclaimX = 128
    s.hud.exclaimY = 396 - 14
    render(`key_bite_${skin}`, s, view, sprites)
  }

  {
    const s = baseScene()
    s.playerPose = 'show'
    const fish = FISH_TABLE.find((f) => f.id === 'sardine') ?? FISH_TABLE[0]
    s.result = {
      kind: 'fish',
      perfect: true,
      treasure: true,
      maxCast: false,
      xp: 26,
      leveledUp: 0,
      fishName: fish.name,
      fishIcon: sprites.fish[fish.id][1],
      size: 18,
      quality: 'gold'
    }
    render(`key_catch_${skin}`, s, view, sprites)
  }
}

renderKeyScenes('frog')
renderKeyScenes('penguin')
renderKeyScenes('wizard')
