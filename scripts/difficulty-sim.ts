/**
 * 无头小游戏难度模拟（不依赖 DOM/音频）。
 * 复刻 MinigameState 的物理：Fish + CatchBar + ProgressBar，
 * 用一个"人类近似策略"（鱼在绿条中心之上就按住上升，否则松开下落）跑 N 次，
 * 输出各鱼捕获率与小游戏平均时长，用于验证调参。
 */
import { T } from '../src/renderer/shared/constants'
import { Fish } from '../src/renderer/fishing/entities/Fish'
import { CatchBar } from '../src/renderer/fishing/entities/CatchBar'
import { ProgressBar } from '../src/renderer/fishing/entities/ProgressBar'
import { FISH_TABLE } from '../src/renderer/fishing/data/fishTable'
import type { FishDef } from '../src/renderer/shared/types'

const DT = 1 / 60

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

/** 共享伪随机流：跨多次运行顺序消费，保证每次运行独立（不是重复同一结果） */
let gSeed = 0x9e3779b9 >>> 0
function nextRand(): number {
  gSeed = (gSeed * 1664525 + 1013904223) >>> 0
  return gSeed / 0xffffffff
}

/** 对齐开局：让鱼正好落在绿条中心 */
function makeBarCenteredOn(fish: Fish): CatchBar {
  const size = T.BAR_SIZE_BASE
  const bar = new CatchBar(size)
  const maxP = T.BAR_BOTTOM - size
  bar.pos = clamp(fish.pos - size / 2, 0, maxP)
  return bar
}

/**
 * 单局模拟。策略采用"人类近似"：每 ~130ms 才根据鱼位置重新决策一次（反应延迟），
 * 高等级鱼更快，延迟导致的滞后会让绿条更难贴住鱼 -> 进度流失更多 -> 更易失败。
 */
function oneRun(def: FishDef, align: boolean, level: number): { caught: boolean; sec: number } {
  const rng = {
    range: (a: number, b: number) => a + (b - a) * nextRand(),
    next: () => nextRand(),
    chance: (p: number) => nextRand() < p
  } as any

  const fish = new Fish(def, rng, level)
  const bar = align ? makeBarCenteredOn(fish) : new CatchBar(T.BAR_SIZE_BASE)
  const progress = new ProgressBar()

  let sec = 0
  let hold = false
  let reactTimer = 0
  const REACT = 0.13 // 人类反应延迟 ~130ms
  for (let i = 0; i < 60 * 90; i++) {
    sec += DT
    fish.update(DT)
    const center = bar.pos + bar.size / 2
    reactTimer -= DT
    if (reactTimer <= 0) {
      // 带 ±6px 瞄准误差，模拟手抖
      const err = (rng.next() - 0.5) * 12
      hold = fish.pos + err < center
      reactTimer = REACT
    }
    bar.update(DT, hold)
    const inBar = fish.pos >= bar.pos - 4 && fish.pos <= bar.pos + bar.size + 4
    progress.update(DT, inBar, fish.diff)
    if (progress.full) return { caught: true, sec }
    if (progress.empty) return { caught: false, sec }
  }
  return { caught: false, sec }
}

function run(align: boolean, level: number) {
  const N = Number(process.argv[2] ?? 120)
  gSeed = (0x9e3779b9 ^ (level * 2654435761)) >>> 0
  console.log(`\n=== 等级 Lv${level} | ${align ? '开局对齐' : '原版'} | 每条鱼 ${N} 次 ===`)
  console.log('鱼名        难度  行为    捕获率   平均秒数')
  let totalCaught = 0
  for (const f of FISH_TABLE) {
    let caught = 0
    let tot = 0
    for (let i = 0; i < N; i++) {
      const r = oneRun(f, align, level)
      if (r.caught) caught++
      tot += r.sec
    }
    totalCaught += caught
    const rate = ((caught / N) * 100).toFixed(0).padStart(3) + '%'
    const avg = (tot / N).toFixed(1)
    console.log(`${f.name.padEnd(8, '　')} ${String(f.difficulty).padStart(3)}  ${f.behavior.padEnd(7)} ${rate}    ${avg}s`)
  }
  const overall = ((totalCaught / (FISH_TABLE.length * N)) * 100).toFixed(0)
  console.log(`— 总捕获率 ${overall}% —`)
}

// 开局对齐（真实开局），按 0/5/10 级对比，验证"等级越高越难"
run(true, 0)
run(true, 5)
run(true, 10)
