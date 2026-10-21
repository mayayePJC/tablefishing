/** Real result entry -> save -> one-shot feedback, plus canvas isolation and audio routing. */
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FishingController } from '../src/renderer/fishing/FishingController'
import { SaveStore } from '../src/renderer/fishing/data/SaveStore'
import { Rng } from '../src/renderer/core/Rng'
import { AudioBus } from '../src/renderer/core/AudioBus'
import { SpriteFactory } from '../src/renderer/render/SpriteFactory'
import { PetView } from '../src/renderer/render/PetView'
import { FISH_TABLE } from '../src/renderer/fishing/data/fishTable'
import { T } from '../src/renderer/shared/constants'
import type { CatchResult, SceneState } from '../src/renderer/shared/types'
import type { FishingContext } from '../src/renderer/fishing/FishingContext'
import type { FishingMachine } from '../src/renderer/fishing/FishingMachine'

Object.assign(globalThis, {
  document: { createElement: () => createCanvas(1, 1) },
  localStorage: { getItem: () => null, setItem: () => {} }
})
const sprites = SpriteFactory.build(FISH_TABLE, 'farmer')
const fish = FISH_TABLE[0]
let assertions = 0
function check(condition: unknown, message: string): void {
  assertions++
  assert.ok(condition, message)
}

function setup(xp: number) {
  const save = new SaveStore()
  save.data.totalXp = xp
  const sounds: number[] = []
  const audio = { levelUp: (delay: number) => sounds.push(delay), uiClick() {} } as unknown as AudioBus
  const controller = new FishingController({ rng: new Rng(17), audio, sprites, fishPool: FISH_TABLE, save })
  // ResultState.enter is the production seam shared by fish, trash and escape outcomes.
  const ctx = Reflect.get(controller, 'ctx') as FishingContext
  const machine = Reflect.get(controller, 'machine') as FishingMachine
  function settle(result: CatchResult) {
    controller.abort()
    ctx.result = result
    machine.transition('result')
  }
  return { controller, save, sounds, settle }
}
function catchFish(xp: number): CatchResult {
  return { kind: 'fish', def: fish, xp, size: 10, quality: 'normal' }
}

const ordinary = setup(95)
ordinary.settle(catchFish(4))
check(!ordinary.controller.getSceneState(0).levelUp && ordinary.sounds.length === 0,
  'An ordinary catch below the XP threshold has no level celebration or sound')

const upgraded = setup(95)
upgraded.settle(catchFish(10))
const first = upgraded.controller.getSceneState(0)
check(upgraded.save.level === 1 && first.levelUp?.level === 1 && first.levelUp.gained === 1,
  'Real XP threshold crossing publishes the reached level and upgrade count')
check(first.result?.leveledUp === 1 && upgraded.sounds.length === 1,
  'Result metadata and one sound agree with the actual save upgrade')
check(upgraded.sounds[0] >= 0.9, 'The upgrade sound waits for the normal catch fanfare')
for (let i = 0; i < 30; i++) {
  upgraded.controller.update(1 / 60, i / 60)
  upgraded.controller.getSceneState(i / 60)
}
check(upgraded.sounds.length === 1 && Math.abs(upgraded.controller.getSceneState(0.5).levelUp!.elapsed - 0.5) < 1e-6,
  'Repeated simulation/render frames advance the existing event without replaying the sound')
const detached = upgraded.controller.getSceneState(0.5)
detached.levelUp!.elapsed = 100
check(upgraded.controller.getSceneState(0.5).levelUp!.elapsed < 1,
  'A scene snapshot cannot mutate the celebration clock')
upgraded.controller.update(0.45, 0.95)
upgraded.controller.setInput(false, true, false)
upgraded.controller.update(1 / 60, 0.97)
const afterSkip = upgraded.controller.getSceneState(0.97)
check(upgraded.controller.stateName === 'idle' && !afterSkip.result && !!afterSkip.levelUp,
  'Clicking through the ready result leaves the remaining celebration visible')
upgraded.controller.update(2, 3)
check(!upgraded.controller.getSceneState(3).levelUp && upgraded.sounds.length === 1,
  'Celebration expires after its finite duration even when the player is idle')

const multi = setup(95)
multi.settle(catchFish(700))
const multiScene = multi.controller.getSceneState(0)
check(multi.save.level === 3 && multiScene.levelUp?.gained === 3 && multiScene.levelUp.level === 3,
  'A multi-level catch shows the final level and the complete upgrade count')
check(multi.sounds.length === 1, 'A multi-level catch plays one celebration instead of overlapping fanfares')
check(multi.save.data.rods?.owned.includes('fiberglass'), 'Existing rod unlocks still run during level feedback')
multi.settle(catchFish(1))
check(multi.sounds.length === 1, 'A following non-upgrading result never schedules a second upgrade sound')
const max = setup(4750)
max.settle(catchFish(500))
check(max.sounds.length === 0 && !max.controller.getSceneState(0).levelUp,
  'A catch at max level does not pretend to level up')
const trash = setup(99)
trash.settle({ kind: 'trash', xp: 3 })
check(trash.controller.getSceneState(0).levelUp?.level === 1 && trash.sounds.length === 1,
  'A genuine XP upgrade from trash also celebrates')

// Exercise the real WebAudio entrypoint: all notes go through the muted master.
const starts: number[] = []
const routes: unknown[] = []
const parameter = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {},
  setTargetAtTime(value: number) { this.value = value } })
const master = { gain: parameter() }
const audio = new AudioBus()
Object.assign(audio, {
  ctx: {
    currentTime: 8,
    createOscillator: () => ({ frequency: parameter(), connect: (to: unknown) => to,
      start: (at: number) => starts.push(at), stop() {} }),
    createGain: () => ({ gain: parameter(), connect: (to: unknown) => { routes.push(to); return to } })
  }, master
})
audio.setMuted(true)
audio.levelUp(1.12)
check(starts.length >= 8 && Math.min(...starts) >= 9.12,
  'The actual upgrade melody schedules the full arpeggio after the supplied catch delay')
check(routes.every((route) => route === master) && master.gain.value === 0.0001,
  'All upgrade notes respect the same muted master as the other audio')
check(multiScene.levelUp!.duration > 1.12 + Math.max(...starts) - Math.min(...starts) + 0.46,
  'The visual celebration outlasts the delayed upgrade melody')

function render(scene: SceneState, overlay = false) {
  const canvas = createCanvas(T.VIEW_W, T.VIEW_H)
  const view = new PetView(sprites, 'farmer')
  view.overlayOpen = overlay
  const context = canvas.getContext('2d')
  view.draw(context as unknown as CanvasRenderingContext2D, scene)
  check(context.globalAlpha === 1, 'Celebration restores the caller canvas alpha')
  return canvas
}
const visual: SceneState = { ...first, time: 0.4, levelUp: { ...first.levelUp!, elapsed: 0.4 } }
const withFeedback = render(visual)
const withoutFeedback = render({ ...visual, levelUp: null })

// A rewarded catch can make the result card taller (MAX/PERFECT/TREASURE),
// but the character must remain visible below the card.  This is the real
// regression reported in the app: PetView used to suppress the whole player
// whenever any of those result flags was present.
const expandedResultScene: SceneState = {
  ...visual,
  result: { ...visual.result!, maxCast: true, perfect: true, treasure: true }
}
const expandedResult = render(expandedResultScene)
const expandedResultPixels = expandedResult.getContext('2d').getImageData(207, 260, 64, 82).data
let expandedResultOpaque = 0
for (let i = 3; i < expandedResultPixels.length; i += 4) if (expandedResultPixels[i] > 0) expandedResultOpaque++
check(expandedResultOpaque > 200, 'An expanded fish result keeps the character visible below the result card')
check(Buffer.from(withFeedback.getContext('2d').getImageData(54, 42, 232, 220).data).equals(
  Buffer.from(withoutFeedback.getContext('2d').getImageData(54, 42, 232, 220).data)),
  'Upgrade particles and banner leave all result text and content pixels untouched')
check(!withFeedback.toBuffer('image/png').equals(withoutFeedback.toBuffer('image/png')),
  'A real upgrade produces visible new pixels')
check(render(visual, true).toBuffer('image/png').equals(render({ ...visual, levelUp: null }, true).toBuffer('image/png')),
  'Opening a menu or picker hides the complete celebration behind the overlay')
check(render({ ...visual, levelUp: { ...visual.levelUp!, elapsed: 2.8 } }).toBuffer('image/png').equals(
  withoutFeedback.toBuffer('image/png')), 'Expired event draws no residual ring, banner or particles')
const legendScene: SceneState = { ...multiScene, time: 0.55,
  result: { ...multiScene.result!, legendary: true },
  levelUp: { ...multiScene.levelUp!, elapsed: 0.55 } }
const legendary = render(legendScene)
const legendPlain = render({ ...legendScene, levelUp: null })
check(Buffer.from(legendary.getContext('2d').getImageData(145, 28, 50, 24).data).equals(
  Buffer.from(legendPlain.getContext('2d').getImageData(145, 28, 50, 24).data)),
  'The legendary crown retains every pixel below the upgrade banner')

if (process.argv.includes('--screenshots')) {
  const output = 'outputs/v0.1.3-qa'
  mkdirSync(output, { recursive: true })
  const idle = render({ ...afterSkip, levelUp: { ...first.levelUp!, elapsed: 1.02 } })
  const preview = createCanvas(T.VIEW_W * 3, T.VIEW_H)
  const previewCtx = preview.getContext('2d')
  previewCtx.fillStyle = '#203036'
  previewCtx.fillRect(0, 0, preview.width, preview.height)
  ;[withFeedback, idle, legendary].forEach((canvas, i) => {
    previewCtx.drawImage(canvas, i * T.VIEW_W, 0)
    writeFileSync(`${output}/level-up-${['result', 'idle', 'multi'][i]}.png`, canvas.toBuffer('image/png'))
  })
  writeFileSync(`${output}/level-up-feedback.png`, preview.toBuffer('image/png'))
}
console.log(`level-feedback-test: ${assertions} assertions passed`)
