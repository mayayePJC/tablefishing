/** Native window shapes must retain every visible canvas pixel and explicit DOM target. */
import { createCanvas } from '@napi-rs/canvas'
import { strict as assert } from 'node:assert'
import { canvasInputRegions, type InputRect } from '../src/renderer/core/WindowRegions'
import { SpriteFactory, ROD_TIPS } from '../src/renderer/render/SpriteFactory'
import { PetView } from '../src/renderer/render/PetView'
import { FISH_TABLE } from '../src/renderer/fishing/data/fishTable'
import { CHARACTER_LIST } from '../src/renderer/shared/characters'
import { T } from '../src/renderer/shared/constants'
import type { SceneState } from '../src/renderer/shared/types'

let passed = 0
let failed = 0
function test(name: string, run: () => void) {
  try { run(); passed++; console.log('  PASS', name) }
  catch (error) { failed++; console.error('  FAIL', name, error) }
}
function pixels(width: number, height: number) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}
function coveredMask(regions: InputRect[], width: number, height: number) {
  const covered = new Uint8Array(width * height)
  for (const region of regions) {
    for (const value of Object.values(region)) assert(Number.isInteger(value), 'region coordinates must be integers')
    assert(region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0, 'invalid region bounds')
    assert(region.x + region.width <= width && region.y + region.height <= height, 'region exceeds viewport')
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) covered[y * width + x] = 1
    }
  }
  return covered
}
function inTarget(x: number, y: number, target: InputRect) {
  return target.width > 0 && target.height > 0
    && x >= Math.floor(target.x) && x < Math.ceil(target.x + target.width)
    && y >= Math.floor(target.y) && y < Math.ceil(target.y + target.height)
}
function verifyExactMask(image: ReturnType<typeof pixels>, targets: InputRect[]) {
  const regions = canvasInputRegions(image, targets)
  const covered = coveredMask(regions, image.width, image.height)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = y * image.width + x
      const expected = image.data[index * 4 + 3] > 0 || targets.some((target) => inTarget(x, y, target))
      if (Boolean(covered[index]) !== expected) {
        assert.fail(`pixel (${x},${y}) alpha=${image.data[index * 4 + 3]} expected=${expected} covered=${covered[index]}`)
      }
    }
  }
  return regions
}

test('透明画布没有 target 时完全穿透', () => {
  assert.deepEqual(verifyExactMask(pixels(340, 390), []), [])
})
test('保留 alpha=1 的边缘和不相连的像素，同时保留透明洞', () => {
  const image = pixels(11, 9)
  for (const [x, y, alpha] of [[0, 0, 1], [10, 8, 255], [4, 4, 128], [6, 4, 1]]) {
    image.data[(y * image.width + x) * 4 + 3] = alpha
  }
  verifyExactMask(image, [])
})
test('相同横向 run 竖向合并，分叉和透明行不能错误连成大矩形', () => {
  const image = pixels(9, 10)
  for (let y = 1; y <= 7; y++) {
    if (y === 4) continue
    for (let x = 2; x < 6; x++) image.data[(y * image.width + x) * 4 + 3] = 255
  }
  assert.deepEqual(verifyExactMask(image, []), [
    { x: 2, y: 1, width: 4, height: 3 }, { x: 2, y: 5, width: 4, height: 3 }
  ])
})
test('小数与边缘 target 按覆盖像素夹紧到 340×390', () => {
  const targets = [
    { x: -2.5, y: -1.5, width: 5, height: 5 },
    { x: 338.4, y: 388.2, width: 20, height: 20 },
    { x: 100.2, y: 200.2, width: 1.2, height: 1.2 }
  ]
  verifyExactMask(pixels(340, 390), targets)
})
test('完全在画布外的 target 不会把负下标解释成数组尾部', () => {
  const targets = [
    { x: -20, y: 0, width: 5, height: 5 },
    { x: 400, y: 10, width: 5, height: 5 },
    { x: 10, y: -20, width: 5, height: 5 },
    { x: 10, y: 400, width: 5, height: 5 }
  ]
  assert.deepEqual(verifyExactMask(pixels(340, 390), targets), [])
})
test('重叠 target 合并并保留内部透明区外的真实像素', () => {
  const image = pixels(20, 20)
  image.data[(1 * 20 + 18) * 4 + 3] = 1
  const targets = [
    { x: 2, y: 4, width: 8, height: 5 },
    { x: 6, y: 6, width: 8, height: 5 }
  ]
  verifyExactMask(image, targets)
})

;(globalThis as any).document = { createElement: () => createCanvas(1, 1) }
let largestRegionCount = 0
let renderedCases = 0
for (const character of CHARACTER_LIST) {
  const sprites = SpriteFactory.build(FISH_TABLE, character.id)
  for (const level of [1, 12, 100]) {
    const view = new PetView(sprites, character.id)
    for (const time of [0, 2.25]) {
      test(`真实 ${character.id} 待机/眨眼 LV${level} t=${time} 保留竿尖、等级牌及所有像素`, () => {
        const canvas = createCanvas(T.VIEW_W, T.VIEW_H)
        const ctx = canvas.getContext('2d')
        const state: SceneState = {
          time, playerPose: 'idle', playerFrame: 0, playerX: T.PLAYER_X,
          playerFootY: T.PLAYER_FOOT_Y, bobber: null, splash: null,
          lineVisible: false, minigame: null, result: null,
          hud: { level, xp: 25, xpNeeded: 100, xpPct: 0.25, hint: '', charge: -1,
            exclaim: false, exclaimX: 0, exclaimY: 0, casts: 3, caught: 1 }
        }
        view.draw(ctx as unknown as CanvasRenderingContext2D, state)
        const image = ctx.getImageData(0, 0, T.VIEW_W, T.VIEW_H)
        const tool = T.TOOLS_BTN
        const targets = [{ x: tool.x - tool.hitHalf, y: tool.y - tool.hitHalf, width: tool.hitHalf * 2, height: tool.hitHalf * 2 }]
        const regions = verifyExactMask(image, targets)
        assert(regions.length > 0 && regions.length <= 4096, `native region budget exceeded: ${regions.length}`)
        const visiblePixels = image.data.filter((_, index) => index % 4 === 3 && image.data[index] > 0).length
        assert(visiblePixels > 1500, 'real render must include character and badge')
        const [tipX, tipY] = ROD_TIPS[character.id].idle0
        const renderedWidth = Math.round(T.PLAYER_W * T.PLAYER_SCALE)
        const renderedHeight = Math.round(T.PLAYER_H * T.PLAYER_SCALE)
        const x = Math.round(T.PLAYER_X - T.PLAYER_W * T.PLAYER_SCALE / 2) + Math.floor((tipX + 0.5) * renderedWidth / T.PLAYER_W)
        const y = Math.round(T.PLAYER_FOOT_Y - T.PLAYER_H * T.PLAYER_SCALE) + Math.floor((tipY + 0.5) * renderedHeight / T.PLAYER_H)
        assert(image.data[(y * image.width + x) * 4 + 3] > 0, 'rod tip is actually present in rendered canvas')
        largestRegionCount = Math.max(largestRegionCount, regions.length)
        renderedCases++
      })
    }
  }
}
console.log(`\nwindow-regions-test: ${passed} passed, ${failed} failed; ${renderedCases} real scenes; max ${largestRegionCount}/4096 rectangles`)
process.exitCode = failed > 0 ? 1 : 0
