/**
 * 难度曲线分析：驱动真实 FishingController，对每条鱼用「人类近似策略」模拟 N 次，
 * 输出捕获率与平均小游戏时长。用于验证数值重调（plan/数值重调方案.md 第 6 节）：
 *   - 鲤鱼 Lv0 ≥ 90%，鱼王 Lv0 < 60%
 *   - 鱼王 Lv10 捕获率 < 鱼王 Lv0（等级轴不反向变易）
 *
 * v2026-10-19 重写：旧版用「零延迟全知策略」（每帧精确读鱼位）导致全表 100%，
 * 对平衡问题失明。现版加入 ~130ms 反应延迟 + ±6px 瞄准误差，并按 Lv0/5/10 分级跑。
 */
import { Rng } from '../src/renderer/core/Rng'
import { AudioBus } from '../src/renderer/core/AudioBus'
import { FishingController } from '../src/renderer/fishing/FishingController'
import { SaveStore } from '../src/renderer/fishing/data/SaveStore'
import { XP_LEVELS } from '../src/renderer/fishing/data/xpTable'
import { FISH_TABLE } from '../src/renderer/fishing/data/fishTable'
import type { SpriteSet } from '../src/renderer/render/SpriteFactory'

const memStore = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k)
}

const fakeCanvas = { width: 8, height: 12 } as unknown as HTMLCanvasElement
const fakeSprites = {
  fish: Object.fromEntries(FISH_TABLE.map((f) => [f.id, [fakeCanvas, fakeCanvas]])),
  trash: [fakeCanvas, fakeCanvas, fakeCanvas]
} as unknown as SpriteSet

const DT = 1 / 60
const N = Number(process.argv[2] ?? 40)
// 人类近似参数（人因数据）：跟踪移动目标并做二选一决策的选择反应时 ~200-300ms
// （130ms 是简单反应时，对跟踪任务偏超人）；±30 轨道单位 ≈ ±6px 屏幕，
// 对应 16px 鱼图标 / 23px 绿条尺度下的真实鼠标判断误差。
const REACT = 0.22
const AIM_ERR = 30

/** 目标等级 -> 累计经验（XP_LEVELS[i] = 达到 i+1 级所需） */
function xpForLevel(level: number): number {
  return level <= 0 ? 0 : XP_LEVELS[level - 1]
}

function oneRun(seed: number, forceId: string, level: number): { caught: boolean; minigameSteps: number } {
  const rng = new Rng(seed)
  const srng = new Rng((seed ^ 0x5bf03635) >>> 0) // 策略专用随机流（不污染控制器）
  const audio = new AudioBus()
  const save = new SaveStore()
  save.data = { version: 1, totalXp: xpForLevel(level), collection: {}, stats: { casts: 0, caught: 0, escaped: 0, trash: 0, perfect: 0, treasure: 0 } }
  const ctrl = new FishingController({ rng, audio, sprites: fakeSprites, fishPool: FISH_TABLE, save })
  ctrl.forceFish(forceId)

  let steps = 0
  let phase: 'idle' | 'charge' | 'waitHook' | 'minigame' | 'result' = 'idle'
  let chargeSteps = 0
  let minigameSteps = 0
  // 人类近似：延迟记忆的鱼位 + 周期性重瞄（带手抖误差）
  let fishMem = 0
  let reactTimer = 0
  let aimErr = 0
  const maxSteps = 30000

  while (steps < maxSteps) {
    steps++
    const name = ctrl.stateName
    if (name === 'idle') {
      if (phase === 'result') break
      phase = 'charge'
      chargeSteps = 0
      ctrl.setInput(true, true, false)
    } else if (name === 'charge') {
      chargeSteps++
      ctrl.setInput(true, false, false)
      if (chargeSteps >= 60) ctrl.setInput(false, false, true)
    } else if (name === 'cast' || name === 'wait') {
      ctrl.setInput(false, false, false)
    } else if (name === 'hook') {
      if (phase !== 'waitHook') {
        phase = 'waitHook'
        ctrl.setInput(true, true, false)
      } else ctrl.setInput(false, false, false)
    } else if (name === 'minigame') {
      minigameSteps++
      const st = ctrl.getSceneState(steps * DT).minigame!
      reactTimer -= DT
      if (reactTimer <= 0) {
        fishMem = st.fishPos
        aimErr = (srng.next() - 0.5) * 2 * AIM_ERR // 手抖
        reactTimer = REACT * (0.75 + srng.next() * 0.5) // 反应时间 itself 也有波动
      }
      const center = st.barPos + st.barSize / 2
      ctrl.setInput(fishMem + aimErr < center, false, false)
    } else if (name === 'result') {
      if (phase !== 'result') phase = 'result'
      ctrl.setInput(true, true, false)
    }
    ctrl.update(DT, steps * DT)
  }
  return { caught: save.data.stats.caught === 1, minigameSteps }
}

function runLevel(level: number) {
  console.log(`\n=== 等级 Lv${level}（累计 XP ${xpForLevel(level)}）| 每条鱼 ${N} 次 | 人类近似策略 ===`)
  console.log('鱼名        难度  行为    捕获率   小游戏平均秒数')
  const rows: { name: string; diff: number; rate: number }[] = []
  for (const f of FISH_TABLE) {
    let caught = 0
    let mgTotal = 0
    for (let i = 0; i < N; i++) {
      const r = oneRun(90000 + i * 131 + f.difficulty, f.id, level)
      if (r.caught) caught++
      mgTotal += r.minigameSteps
    }
    const rate = (caught / N) * 100
    rows.push({ name: f.name, diff: f.difficulty, rate })
    const avgSec = (mgTotal / N * DT).toFixed(1)
    console.log(
      `${f.name.padEnd(8, '　')} ${String(f.difficulty).padStart(3)}  ${f.behavior.padEnd(7)} ${rate.toFixed(0).padStart(3)}%    ${avgSec}s`
    )
  }
  return rows
}

const lv0 = runLevel(0)
const lv5 = runLevel(5)
const lv10 = runLevel(10)

// ---- 梯度断言（plan/数值重调方案.md 第 6 节）----
const carp0 = lv0.find((r) => r.name === '鲤鱼')!.rate
const king0 = lv0.find((r) => r.name === '鱼王')!.rate
const king10 = lv10.find((r) => r.name === '鱼王')!.rate
const checks: [string, boolean, string][] = [
  ['鲤鱼 Lv0 ≥ 90%', carp0 >= 90, `实际 ${carp0.toFixed(0)}%`],
  ['鱼王 Lv0 < 60%', king0 < 60, `实际 ${king0.toFixed(0)}%`],
  ['鱼王 Lv10 < 鱼王 Lv0（等级轴不反向）', king10 < king0, `Lv10 ${king10.toFixed(0)}% vs Lv0 ${king0.toFixed(0)}%`]
]
console.log('\n=== 梯度断言 ===')
let pass = 0
for (const [label, ok, detail] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
  if (ok) pass++
}
console.log(`— ${pass}/${checks.length} 通过 —`)
process.exit(pass === checks.length ? 0 : 2)
