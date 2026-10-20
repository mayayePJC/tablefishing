import { strict as assert } from 'node:assert'
import { Fish } from '../src/renderer/fishing/entities/Fish'
import { FISH_TABLE } from '../src/renderer/fishing/data/fishTable'
import { Rng } from '../src/renderer/core/Rng'
import { T } from '../src/renderer/shared/constants'

const DT = 1 / 60
const HALF = 4
const MIN_POS = HALF
const MAX_POS = T.TRACK_H - HALF
const MIN_TARGET = HALF + T.FISH_EDGE_MARGIN
const MAX_TARGET = T.TRACK_H - HALF - T.FISH_EDGE_MARGIN

type FishInternals = { target: number }

let passed = 0
let failed = 0
function test(name: string, run: () => void): void {
  try {
    run()
    passed++
    console.log('  PASS', name)
  } catch (error) {
    failed++
    console.error('  FAIL', name, error)
  }
}

for (const [index, def] of FISH_TABLE.entries()) {
  test(`${def.id} 目标点避开上下沿`, () => {
    const fish = new Fish(def, new Rng(0x4f1bbcdc + index), 0)
    const target = (fish as unknown as FishInternals).target
    assert(target >= MIN_TARGET && target <= MAX_TARGET,
      `target=${target} should be within [${MIN_TARGET}, ${MAX_TARGET}]`)
  })

  test(`${def.id} 触边后会离开而非停在原地`, () => {
    const fish = new Fish(def, new Rng(0x8a5cd789 + index), 0)
    const internals = fish as unknown as FishInternals

    fish.pos = MIN_POS
    fish.vel = 0
    internals.target = MIN_POS
    fish.update(DT)
    fish.update(DT)
    assert(fish.pos > MIN_POS, `top edge did not release: pos=${fish.pos}`)

    fish.pos = MAX_POS
    fish.vel = 0
    internals.target = MAX_POS
    fish.update(DT)
    fish.update(DT)
    assert(fish.pos < MAX_POS, `bottom edge did not release: pos=${fish.pos}`)
  })

  test(`${def.id} 长时间游动不在物理边界驻留`, () => {
    const fish = new Fish(def, new Rng(0x1a2b3c4d + index), 0)
    let topEdgeFrames = 0
    let bottomEdgeFrames = 0
    for (let frame = 0; frame < 60 * 30; frame++) {
      fish.update(DT)
      assert(fish.pos >= MIN_POS && fish.pos <= MAX_POS, `out of bounds: ${fish.pos}`)
      if (fish.pos <= MIN_POS + 2) topEdgeFrames++
      if (fish.pos >= MAX_POS - 2) bottomEdgeFrames++
    }
    assert(topEdgeFrames <= 6, `top edge frames=${topEdgeFrames}`)
    assert(bottomEdgeFrames <= 6, `bottom edge frames=${bottomEdgeFrames}`)
  })
}

console.log(`\nfish-boundary-test: ${passed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
