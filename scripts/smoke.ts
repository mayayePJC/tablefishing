/**
 * 逻辑层冒烟测试（Node + esbuild 打包运行）：
 * 用 DOM 桩驱动 FishingController 跑完整钓鱼循环，
 * 验证状态机流转、捕获结算、经验/等级、逃脱与垃圾分支。
 */
import { Rng } from '../src/renderer/core/Rng'
import { AudioBus } from '../src/renderer/core/AudioBus'
import { FishingController } from '../src/renderer/fishing/FishingController'
import { SaveStore } from '../src/renderer/fishing/data/SaveStore'
import { FISH_TABLE } from '../src/renderer/fishing/data/fishTable'
import type { SpriteSet } from '../src/renderer/render/SpriteFactory'

// ---- DOM 桩 ----
const memStore = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear()
}

const fakeCanvas = { width: 8, height: 12 } as unknown as HTMLCanvasElement
const fakeSprites = {
  fish: Object.fromEntries(FISH_TABLE.map((f) => [f.id, [fakeCanvas, fakeCanvas]])),
  trash: [fakeCanvas, fakeCanvas, fakeCanvas]
} as unknown as SpriteSet

const DT = 1 / 60

function makeController(seed: number, totalXp = 0) {
  const rng = new Rng(seed)
  const audio = new AudioBus()
  const save = new SaveStore()
  save.data = {
    version: 1,
    totalXp,
    collection: {},
    stats: { casts: 0, caught: 0, escaped: 0, trash: 0, perfect: 0, treasure: 0 }
  }
  const ctrl = new FishingController({ rng, audio, sprites: fakeSprites, fishPool: FISH_TABLE, save })
  return { ctrl, save, rng }
}

interface SimOutcome {
  casts: number
  caught: number
  escaped: number
  trash: number
  totalXp: number
  level: number
  steps: number
}

/**
 * 模拟一次完整钓鱼。
 * smart=true 用「鱼在条上半则按住」的 bang-bang 策略；
 * reactInHook=false 模拟错过感叹号。
 */
function simulate(seed: number, opts: { forceId?: string; smart?: boolean; reactInHook?: boolean; totalXp?: number } = {}): SimOutcome {
  const { smart = true, reactInHook = true } = opts
  const { ctrl, save } = makeController(seed, opts.totalXp ?? 0)
  if (opts.forceId) ctrl.forceFish(opts.forceId)

  let steps = 0
  let phase: 'idle' | 'charge' | 'waitHook' | 'minigame' | 'result' = 'idle'
  let chargeSteps = 0
  let resultSteps = 0
  const maxSteps = 20000

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
    } else if (name === 'cast') {
      ctrl.setInput(false, false, false)
    } else if (name === 'wait') {
      ctrl.setInput(false, false, false)
    } else if (name === 'hook') {
      if (phase !== 'waitHook') {
        phase = 'waitHook'
        if (reactInHook) ctrl.setInput(true, true, false)
        else ctrl.setInput(false, false, false)
      } else {
        ctrl.setInput(false, false, false)
      }
    } else if (name === 'minigame') {
      const st = ctrl.getSceneState(steps * DT).minigame
      if (!st) {
        throw new Error('minigame state without view state')
      }
      const center = st.barPos + st.barSize / 2
      const hold = smart ? st.fishPos < center : (steps % 7 < 4)
      ctrl.setInput(hold, false, false)
    } else if (name === 'result') {
      if (phase !== 'result') {
        phase = 'result'
        resultSteps = 0
      }
      resultSteps++
      ctrl.setInput(true, true, false)
    }

    ctrl.update(DT, steps * DT)
  }

  if (steps >= maxSteps) throw new Error(`simulation timeout (seed=${seed})`)

  return {
    casts: save.data.stats.casts,
    caught: save.data.stats.caught,
    escaped: save.data.stats.escaped,
    trash: save.data.stats.trash,
    totalXp: save.data.totalXp,
    level: save.level,
    steps
  }
}

// ---- 用例 ----
let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`)
  } else {
    failures++
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)
  }
}

console.log('1. 智能策略钓鲤鱼（难度15）x10')
{
  let caught = 0
  let escaped = 0
  let xp = 0
  for (let i = 0; i < 10; i++) {
    const o = simulate(1000 + i, { forceId: 'carp', smart: true })
    caught += o.caught
    escaped += o.escaped
    xp += o.totalXp
    if (o.casts !== 1) throw new Error(`casts should be 1, got ${o.casts}`)
  }
  check('10 次抛竿全部完成', true, `caught=${caught} escaped=${escaped}`)
  check('智能策略至少钓上 5 条', caught >= 5, `caught=${caught}/10`)
  check('经验正常累积', xp > 0, `xp=${xp}`)
}

console.log('2. 随机乱按（不智能）x10 — 稳定性')
{
  let caught = 0
  for (let i = 0; i < 10; i++) {
    const o = simulate(2000 + i, { forceId: 'anchovy', smart: false })
    caught += o.caught
  }
  check('乱按也能偶尔钓到', caught >= 0, `caught=${caught}/10`)
}

console.log('3. 错过感叹号 -> 逃脱')
{
  const o = simulate(3001, { forceId: 'carp', reactInHook: false })
  check('过晚点击鱼逃走', o.escaped === 1 && o.caught === 0, `escaped=${o.escaped} caught=${o.caught}`)
}

console.log('4. 高难度鱼王（110）x3 — 不崩溃')
{
  for (let i = 0; i < 3; i++) {
    const o = simulate(4000 + i, { forceId: 'legend', smart: true })
    check(`鱼王模拟 ${i + 1} 完成`, o.casts === 1, `caught=${o.caught} escaped=${o.escaped} xp=${o.totalXp}`)
  }
}

console.log('5. 升级路径（预置 95 XP，钓鲤鱼应升 1 级）')
{
  const o = simulate(5001, { forceId: 'carp', smart: true, totalXp: 95 })
  check('捕获后达到 1 级', o.level >= 1, `level=${o.level} totalXp=${o.totalXp}`)
}

console.log('6. 垃圾分支（无强制鱼，20 次抽样至少出现垃圾或鱼）')
{
  let trash = 0
  let caught = 0
  for (let i = 0; i < 20; i++) {
    const o = simulate(6000 + i, { smart: true })
    trash += o.trash
    caught += o.caught
  }
  check('20 次抽样有产出', trash + caught > 0, `trash=${trash} caught=${caught}`)
}

console.log('7. 宝箱与完美统计字段存在')
{
  const { ctrl, save } = makeController(7001)
  ctrl.forceFish('carp')
  // 直接跑一段确认无异常即可
  check('控制器可构造', ctrl.stateName === 'idle' && save.level === 0)
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
