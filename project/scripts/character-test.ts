/** Asset contracts for every selectable skin and the five anime companions. */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { SpriteFactory, ROD_TIPS, type PlayerPose } from '../src/renderer/render/SpriteFactory'
import { CHARACTER_LIST } from '../src/renderer/shared/characters'
import { SaveStore } from '../src/renderer/fishing/data/SaveStore'
import type { CharacterSkin } from '../src/renderer/shared/types'

;(globalThis as any).document = { createElement: () => createCanvas(1, 1) }
const poses: PlayerPose[] = ['idle0', 'idle1', 'cast0', 'cast1', 'cast2', 'reel', 'show']
const newSkins: CharacterSkin[] = ['shinchan', 'maruko', 'pikachu', 'rukawa', 'doraemon']
const eyeBounds: Partial<Record<CharacterSkin, readonly [number, number, number, number]>> = {
  frog: [4, 17, 5, 9],
  shinchan: [5, 16, 12, 13],
  maruko: [5, 16, 12, 13],
  pikachu: [5, 16, 16, 18],
  rukawa: [5, 16, 9, 11],
  doraemon: [6, 15, 10, 12]
}
const rgba = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, 24, 40).data
const silhouette = (canvas: HTMLCanvasElement) => Array.from(rgba(canvas)).filter((_, i) => i % 4 === 3)
let passed = 0
let failed = 0
function test(name: string, run: () => void) {
  try { run(); passed++; console.log('  PASS', name) }
  catch (error) { failed++; console.error('  FAIL', name, error) }
}

test('10 unique selectable characters are registered with complete rod mappings', () => {
  assert.equal(CHARACTER_LIST.length, 10)
  assert.equal(new Set(CHARACTER_LIST.map((entry) => entry.id)).size, 10)
  assert.deepEqual(Object.keys(ROD_TIPS).sort(), CHARACTER_LIST.map((entry) => entry.id).sort())
})
const legacyCharacters = [
  ['rabbit', 'shinchan'], ['fox', 'maruko'], ['panda', 'pikachu'],
  ['raccoon', 'rukawa'], ['robot', 'doraemon']
] as const
function populatedSave(character: unknown) {
  return {
    version: 1, totalXp: 4875, character,
    rods: { owned: ['bamboo', 'fiberglass', 'iridium'], equipped: 'iridium' },
    stealth: true, autostart: true, bgm: 'forest-rain', localBgm: 'owned-ost-local-id',
    collection: { tuna: { count: 12, bestSize: 58, bestQuality: 'iridium' } },
    stats: { casts: 51, caught: 37, escaped: 8, trash: 6, perfect: 17, treasure: 4 }
  }
}
function mockStorage(raw: string, denyWrites = false) {
  const values = new Map<string, string>([['fishing-codex-save-v1', raw]])
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (denyWrites) throw new Error('localStorage unavailable')
      values.set(key, value)
    }
  }
  return values
}
for (const [legacyId, expectedId] of legacyCharacters) {
  test(`${legacyId}: real legacy save migrates to ${expectedId} without losing progress or music`, () => {
    const original = populatedSave(legacyId)
    const values = mockStorage(JSON.stringify(original))
    const migrated = new SaveStore()
    assert.deepEqual(migrated.data, { ...original, character: expectedId })
    assert.equal(JSON.parse(values.get('fishing-codex-save-v1')!).character, expectedId, 'migration must be persisted')
    assert.deepEqual(new SaveStore().data, migrated.data, 'second reload changes a migrated save')
    migrated.save()
    assert.deepEqual(new SaveStore().data, { ...original, character: expectedId }, 'ordinary save discards progress')
  })
}
test('unknown or malformed character values fall back to farmer while preserving the rest of the save', () => {
  for (const value of ['removed-character', '__proto__', 'constructor', '', null, 42, {}, ['shinchan']]) {
    const original = populatedSave(value)
    const values = mockStorage(JSON.stringify(original))
    const loaded = new SaveStore()
    assert.deepEqual(loaded.data, { ...original, character: 'farmer' })
    assert.equal(JSON.parse(values.get('fishing-codex-save-v1')!).character, 'farmer')
  }
})
test('readable legacy saves keep all progress even if persisting the migrated character is denied', () => {
  const original = populatedSave('robot')
  mockStorage(JSON.stringify(original), true)
  assert.deepEqual(new SaveStore().data, { ...original, character: 'doraemon' })
})
test('older saves without a selected character get a valid default without dropping progress', () => {
  const { character: _unusedCharacter, ...original } = populatedSave('farmer')
  mockStorage(JSON.stringify(original))
  assert.deepEqual(new SaveStore().data, { ...original, character: 'farmer' })
})
const assets = CHARACTER_LIST.map((character) => {
  const sprites = SpriteFactory.build([], character.id)
  return { character, frames: [...sprites.playerIdle, ...sprites.playerCast, sprites.playerReel, sprites.playerShow] }
})
for (const { character, frames } of assets) {
  test(`${character.id}: selected skin survives a real SaveStore reload`, () => {
    const values = new Map<string, string>()
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
    const save = new SaveStore()
    save.data.character = character.id
    save.save()
    const restored = new SaveStore()
    assert.equal(restored.data.character, character.id)
    assert(CHARACTER_LIST.some((entry) => entry.id === restored.data.character))
    const restoredFrame = SpriteFactory.build([], restored.data.character).playerIdle[0]
    assert.deepEqual(rgba(restoredFrame), rgba(frames[0]), 'restored skin falls back to a different sprite')
  })
  test(`${character.id}: all seven transparent 24×40 poses have opaque rod tips and grounded feet`, () => {
    assert.equal(frames.length, poses.length)
    frames.forEach((frame, index) => {
      assert.equal(frame.width, 24)
      assert.equal(frame.height, 40)
      const data = rgba(frame)
      const alpha = silhouette(frame)
      assert(alpha.filter((v) => v > 0).length > 200, `${poses[index]} empty or incomplete`)
      assert(alpha.some((v) => v === 0), `${poses[index]} must retain transparent background`)
      assert(alpha.every((v) => v === 0 || v === 255), `${poses[index]} contains antialiasing`)
      assert(alpha.slice(39 * 24).some((v) => v === 255), `${poses[index]} feet float above baseline`)
      const [x, y] = ROD_TIPS[character.id][poses[index]]
      assert(x >= 0 && y >= 0 && x < 24 && y < 40)
      assert.equal(data[(y * 24 + x) * 4 + 3], 255, `${poses[index]} rod tip is transparent`)
    })
  })
  test(`${character.id}: blink changes eyes without shifting alpha or body`, () => {
    const a = rgba(frames[0]), b = rgba(frames[1])
    assert.deepEqual(silhouette(frames[0]), silhouette(frames[1]))
    let changes = 0
    for (let pixel = 0; pixel < 24 * 40; pixel++) {
      if (a.slice(pixel * 4, pixel * 4 + 4).some((value, i) => value !== b[pixel * 4 + i])) {
        const x = pixel % 24, y = Math.floor(pixel / 24)
        const [eyeLeft, eyeRight, eyeTop, eyeBottom] = eyeBounds[character.id] ?? [4, 17, 8, 14]
        assert(x >= eyeLeft && x <= eyeRight && y >= eyeTop && y <= eyeBottom, `blink changes non-eye pixel (${x},${y})`)
        changes++
      }
    }
    assert(changes >= 2 && changes <= 16, `unexpected blink changes: ${changes}`)
  })
  if (!newSkins.includes(character.id)) continue
  test(`${character.id}: fixed palette remains within 32 colors including rod and display fish`, () => {
    for (const [index, frame] of frames.entries()) {
      const data = rgba(frame), colors = new Set<string>()
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
      }
      assert(colors.size <= 32, `${poses[index]} has ${colors.size} colors`)
    }
  })
  test(`${character.id}: casting has three distinct poses, explicit backswing and forward rod arc`, () => {
    assert(ROD_TIPS[character.id].cast0[0] > ROD_TIPS[character.id].cast1[0])
    assert(ROD_TIPS[character.id].cast2[1] > ROD_TIPS[character.id].cast1[1])
    assert(ROD_TIPS[character.id].reel[1] > ROD_TIPS[character.id].cast2[1])
    const moving = frames.slice(2, 5).map(rgba)
    for (let i = 1; i < moving.length; i++) {
      let differences = 0
      for (let j = 0; j < moving[i].length; j += 4) {
        if (moving[i].slice(j, j + 4).some((value, k) => value !== moving[i - 1][j + k])) differences++
      }
      assert(differences > 80, `casting frames differ by only ${differences} pixels`)
    }
  })
}

test('each new companion has a distinct silhouette from every other selectable character', () => {
  const masks = assets.map(({ character, frames }) => ({ id: character.id, mask: silhouette(frames[0]) }))
  for (const a of masks.filter((entry) => newSkins.includes(entry.id))) {
    for (const b of masks.filter((entry) => entry.id !== a.id)) {
      const changed = a.mask.filter((value, i) => value !== b.mask[i]).length
      assert(changed >= 70, `${a.id}/${b.id} silhouettes differ by only ${changed} pixels`)
    }
  }
})

function saveCanvas(path: string, canvas: ReturnType<typeof createCanvas>) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, canvas.toBuffer('image/png'))
  console.log('  wrote', path)
}
function backdrop(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, x: number, y: number, w: number, h: number) {
  for (let yy = 0; yy < h; yy += 8) {
    for (let xx = 0; xx < w; xx += 8) {
      ctx.fillStyle = ((xx + yy) / 8) % 2 ? '#e3d4b9' : '#eddfc8'
      ctx.fillRect(x + xx, y + yy, Math.min(8, w - xx), Math.min(8, h - yy))
    }
  }
}
function renderSheets() {
  GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei')
  const output = resolve('outputs/v0.1.4-qa')
  const scale = 4, cellW = 108, cellH = 190, titleH = 44, margin = 16
  const combined = createCanvas(7 * cellW + margin * 2, newSkins.length * (cellH + titleH) + margin)
  const combinedCtx = combined.getContext('2d')
  combinedCtx.imageSmoothingEnabled = false
  combinedCtx.fillStyle = '#f6ecd7'; combinedCtx.fillRect(0, 0, combined.width, combined.height)
  for (const [row, id] of newSkins.entries()) {
    const { character, frames } = assets.find((entry) => entry.character.id === id)!
    const sheet = createCanvas(7 * cellW + margin * 2, cellH + titleH + margin)
    const ctx = sheet.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#f6ecd7'; ctx.fillRect(0, 0, sheet.width, sheet.height)
    ctx.fillStyle = '#5b3d28'; ctx.font = 'bold 17px "Microsoft YaHei", sans-serif'
    ctx.fillText(`${character.name} · ${id}  /  24 × 40`, margin, 27)
    frames.forEach((frame, column) => {
      const x = margin + column * cellW
      backdrop(ctx, x, titleH, 96, 160)
      ctx.drawImage(frame as any, x, titleH, 24 * scale, 40 * scale)
      ctx.fillStyle = '#5b3d28'; ctx.font = '12px monospace'
      ctx.fillText(poses[column], x + 3, titleH + 179)
    })
    saveCanvas(resolve(`design/char-${id}/pose-sheet.png`), sheet)
    combinedCtx.drawImage(sheet, 0, row * (cellH + titleH))
  }
  saveCanvas(resolve(output, 'new-character-poses.png'), combined)
  const overview = createCanvas(newSkins.length * 144 + margin * 2, 288)
  const ctx = overview.getContext('2d'); ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#f6ecd7'; ctx.fillRect(0, 0, overview.width, overview.height)
  ctx.fillStyle = '#5b3d28'; ctx.font = 'bold 18px "Microsoft YaHei", sans-serif'
  ctx.fillText('动漫钓友 · v0.1.4', margin, 30)
  for (const [i, id] of newSkins.entries()) {
    const { character, frames } = assets.find((entry) => entry.character.id === id)!
    const x = margin + i * 144 + 12
    backdrop(ctx, x, 52, 120, 200)
    ctx.drawImage(frames[0] as any, x, 52, 120, 200)
    ctx.fillStyle = '#5b3d28'; ctx.font = 'bold 15px "Microsoft YaHei", sans-serif'
    ctx.fillText(character.name, x, 275)
  }
  saveCanvas(resolve(output, 'new-characters.png'), overview)
}
if (process.argv.includes('--render')) renderSheets()
console.log(`\ncharacter-test: ${passed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
