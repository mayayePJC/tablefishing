/**
 * 难度曲线分析：对每条鱼用「智能策略」模拟 N 次，输出捕获率与平均步数。
 * 用于验证 P2 手感：低难度应稳定可钓，高难度应明显更难。
 */
import { Rng } from '../src/renderer/core/Rng'
import { AudioBus } from '../src/renderer/core/AudioBus'
import { FishingController } from '../src/renderer/fishing/FishingController'
import { SaveStore } from '../src/renderer/fishing/data/SaveStore'
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
const N = Number(process.argv[2] ?? 30)

function oneRun(seed: number, forceId: string): { caught: boolean; steps: number; minigameSteps: number } {
  const rng = new Rng(seed)
  const audio = new AudioBus()
  const save = new SaveStore()
  save.data = { version: 1, totalXp: 0, collection: {}, stats: { casts: 0, caught: 0, escaped: 0, trash: 0, perfect: 0, treasure: 0 } }
  const ctrl = new FishingController({ rng, audio, sprites: fakeSprites, fishPool: FISH_TABLE, save })
  ctrl.forceFish(forceId)

  let steps = 0
  let phase: 'idle' | 'charge' | 'waitHook' | 'minigame' | 'result' = 'idle'
  let chargeSteps = 0
  let minigameSteps = 0
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
      const center = st.barPos + st.barSize / 2
      ctrl.setInput(st.fishPos < center, false, false)
    } else if (name === 'result') {
      if (phase !== 'result') phase = 'result'
      ctrl.setInput(true, true, false)
    }
    ctrl.update(DT, steps * DT)
  }
  return { caught: save.data.stats.caught === 1, steps, minigameSteps }
}

console.log(`每条鱼 ${N} 次智能模拟：\n`)
console.log('鱼名        难度  行为    捕获率   小游戏平均秒数')
for (const f of FISH_TABLE) {
  let caught = 0
  let mgTotal = 0
  for (let i = 0; i < N; i++) {
    const r = oneRun(90000 + i * 131 + f.difficulty, f.id)
    if (r.caught) caught++
    mgTotal += r.minigameSteps
  }
  const rate = ((caught / N) * 100).toFixed(0).padStart(3) + '%'
  const avgSec = (mgTotal / N * DT).toFixed(1)
  console.log(
    `${f.name.padEnd(8, '　')} ${String(f.difficulty).padStart(3)}  ${f.behavior.padEnd(7)} ${rate}    ${avgSec}s`
  )
}
