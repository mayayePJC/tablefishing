/** Packaged ambient audio, async playback races, mute/resume and legacy-save migration. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { BGM_TRACKS, BgmPlayer, bgmTrackById, type BgmLoader } from '../src/renderer/core/Bgm'
import { SaveStore } from '../src/renderer/fishing/data/SaveStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve() }
const bytes = (marker = 1) => Uint8Array.of(marker).buffer
const decoded = (marker = 1, duration = 120) => ({ marker, duration })
class FakeNode {
  connections: unknown[] = []
  starts: number[][] = []
  stops = 0
  disconnects = 0
  loop = false
  buffer: ReturnType<typeof decoded> | null = null
  onended: (() => void) | null = null
  targets: number[][] = []
  gain = { value: 0, setTargetAtTime: (...args: number[]) => this.targets.push(args) }
  connect(target: unknown) { this.connections.push(target); return target }
  disconnect() { this.connections = []; this.disconnects++ }
  start(...args: number[]) { this.starts.push(args) }
  stop() { this.stops++ }
}
class FakeContext {
  currentTime = 0
  gains: FakeNode[] = []
  sources: FakeNode[] = []
  decodes = 0
  decodeHook: ((input: ArrayBuffer) => Promise<ReturnType<typeof decoded>>) | null = null
  createGain() { const node = new FakeNode(); this.gains.push(node); return node }
  createBufferSource() { const node = new FakeNode(); this.sources.push(node); return node }
  decodeAudioData(input: ArrayBuffer) {
    this.decodes++
    return this.decodeHook?.(input) ?? Promise.resolve(decoded(new Uint8Array(input)[0]))
  }
}
const attach = (player: BgmPlayer, ctx: FakeContext, master: FakeNode) =>
  player.attach(ctx as unknown as AudioContext, master as unknown as AudioNode)
function setup(loader: BgmLoader = async (id) => bytes(id === 'forest-rain' ? 1 : 2)) {
  const player = new BgmPlayer(loader)
  const ctx = new FakeContext()
  const master = new FakeNode()
  attach(player, ctx, master)
  return { player, ctx, master }
}
let passed = 0
async function test(name: string, run: () => void | Promise<void>) {
  await run()
  passed++
  console.log(`  ✓ ${name}`)
}

async function main() {
  await test('内置曲库仅有森林雨声/机场候机，旧旋律不再可选', () => {
    assert.deepEqual(BGM_TRACKS.map(({ id, name }) => ({ id, name })), [
      { id: 'forest-rain', name: '森林雨声' }, { id: 'airport', name: '机场候机' }
    ])
    for (const track of BGM_TRACKS) {
      assert.ok(track.cn.length > 10)
      assert.equal(bgmTrackById(track.id), track)
      assert.equal('bpm' in track, false)
      assert.equal('tonic' in track, false)
    }
    for (const value of [null, undefined, 'spring', 'summer', 'fall', 'unknown']) {
      assert.equal(bgmTrackById(value as any), null)
    }
  })
  await test('两条可独立解码的Ogg均为120秒立体声Vorbis，所有页面完整', () => {
    for (const track of BGM_TRACKS) {
      const file = readFileSync(resolve('src/renderer/public/audio', `${track.id}.ogg`))
      assert.ok(file.length > 1_000_000)
      let offset = 0
      let finalGranule = 0n
      let sampleRate = 0
      let pages = 0
      while (offset < file.length) {
        assert.equal(file.toString('ascii', offset, offset + 4), 'OggS')
        assert.equal(file[offset + 4], 0)
        const segments = file[offset + 26]
        const payload = offset + 27 + segments
        let size = 0
        for (let i = 0; i < segments; i++) size += file[offset + 27 + i]
        assert.ok(payload + size <= file.length)
        if (pages === 0) {
          assert.equal(file[payload], 1)
          assert.equal(file.toString('ascii', payload + 1, payload + 7), 'vorbis')
          assert.equal(file[payload + 11], 2)
          sampleRate = file.readUInt32LE(payload + 12)
        }
        const granule = file.readBigInt64LE(offset + 6)
        if (granule >= 0) finalGranule = granule
        offset = payload + size
        pages++
      }
      assert.equal(offset, file.length)
      assert.ok(pages > 100)
      assert.equal(sampleRate, 32000)
      assert.equal(Number(finalGranule) / sampleRate, 120)
    }
  })
  await test('打包音频与校验清单一致，机场开场提示/播报后每60秒一次且跨循环保持间隔', () => {
    const manifest = JSON.parse(readFileSync(resolve('src/renderer/public/audio/ambient-manifest.json'), 'utf8'))
    assert.equal(manifest.durationSeconds, 120)
    assert.equal(manifest.announcementIntervalSeconds, 60)
    assert.equal(manifest.announcements.length, 2)
    const [opening, next] = manifest.announcements
    assert.ok(opening.cueAtSeconds >= 0 && opening.cueAtSeconds <= 1)
    assert.ok(opening.atSeconds > opening.cueAtSeconds && opening.atSeconds <= 2)
    assert.ok(Math.abs(next.cueAtSeconds - opening.cueAtSeconds - 60) < 1e-6)
    assert.ok(Math.abs(next.atSeconds - opening.atSeconds - 60) < 1e-6)
    assert.ok(Math.abs(120 + opening.cueAtSeconds - next.cueAtSeconds - 60) < 1e-6)
    for (const check of manifest.encodedAnnouncementChecks) {
      assert.ok(check.encodedCueCorrelation > 0.25)
      assert.ok(check.encodedVoiceCorrelation > 0.40)
    }
    assert.equal(manifest.encodedAnnouncementChecks.length, 2)
    for (const id of ['forest-rain', 'airport']) {
      const track = manifest.tracks.find((entry: any) => entry.id === id)
      assert.ok(track)
      const file = readFileSync(resolve('src/renderer/public/audio', `${id}.ogg`))
      assert.equal(createHash('sha256').update(file).digest('hex'), track.sha256)
      assert.equal(file.length, track.bytes)
      assert.equal(track.clippedSamples, 0)
      assert.ok(track.peakDbfs < -1)
    }
    const rain = manifest.tracks.find((entry: any) => entry.id === 'forest-rain')
    const airport = manifest.tracks.find((entry: any) => entry.id === 'airport')
    assert.ok(rain.frequencyBandPowerPercent.above4000Hz < 0.01)
    assert.ok(rain.oneSecondRmsDbfs.p95MinusP05 < 1)
    assert.ok(Math.abs(rain.rmsDbfs - airport.rmsDbfs) < 0.5)
  })
  await test('手势attach前选曲不读取，重复attach不重复加载、解码或启动', async () => {
    let reads = 0
    const input = deferred<ArrayBuffer>()
    const player = new BgmPlayer(() => { reads++; return input.promise })
    player.play('forest-rain')
    await flush()
    assert.equal(reads, 0)
    assert.equal(player.playing, 'forest-rain')
    const ctx = new FakeContext(), master = new FakeNode()
    attach(player, ctx, master)
    attach(player, ctx, master)
    await flush()
    assert.equal(reads, 1)
    input.resolve(bytes())
    await flush()
    attach(player, ctx, master)
    assert.equal(ctx.decodes, 1)
    assert.equal(ctx.gains.length, 1)
    assert.equal(ctx.sources.length, 1)
    assert.equal(ctx.sources[0].loop, true)
    assert.deepEqual(ctx.sources[0].starts, [[0, 0]])
    assert.equal(ctx.sources[0].connections[0], ctx.gains[0])
    assert.equal(ctx.gains[0].connections[0], master)
    player.stop()
  })
  await test('同一首再点击停止，停止后可重播，切曲停止旧节点并复用缓存', async () => {
    const { player, ctx } = setup()
    player.play('forest-rain'); await flush()
    const first = ctx.sources[0]
    player.play('forest-rain')
    assert.equal(player.playing, null)
    assert.equal(first.stops, 1)
    assert.equal(first.connections.length, 0)
    player.play('forest-rain'); await flush()
    assert.equal(ctx.decodes, 1)
    assert.equal(ctx.sources.length, 2)
    player.play('airport'); await flush()
    assert.equal(ctx.sources[1].stops, 1)
    assert.equal(ctx.sources[2].buffer?.marker, 2)
    player.play('forest-rain'); await flush()
    assert.equal(ctx.sources[2].stops, 1)
    assert.equal(ctx.decodes, 2)
    assert.equal(ctx.sources[3].buffer?.marker, 1)
    player.play(null)
    assert.equal(ctx.sources[3].stops, 1)
    assert.equal(player.playing, null)
  })
  await test('多次静音保留暂停位置，恢复不重新读取，跨循环位置取模', async () => {
    let reads = 0
    const { player, ctx, master } = setup(async () => { reads++; return bytes() })
    player.play('forest-rain'); await flush()
    ctx.currentTime = 12
    player.stop(false)
    player.stop(false)
    assert.equal(player.playing, 'forest-rain')
    assert.equal(ctx.sources[0].stops, 1)
    ctx.currentTime = 70
    attach(player, ctx, master)
    assert.deepEqual(ctx.sources[1].starts[0], [0, 12])
    ctx.currentTime = 203
    player.stop(false)
    ctx.currentTime = 500
    attach(player, ctx, master)
    assert.deepEqual(ctx.sources[2].starts[0], [0, 25])
    assert.equal(reads, 1)
    assert.equal(ctx.decodes, 1)
    player.stop()
  })
  await test('读取或解码期间静音只缓存，重复恢复各只启动一次', async () => {
    for (const pendingAt of ['read', 'decode']) {
      const read = deferred<ArrayBuffer>(), decode = deferred<ReturnType<typeof decoded>>()
      let reads = 0
      const { player, ctx, master } = setup(() => { reads++; return read.promise })
      ctx.decodeHook = () => decode.promise
      player.play('airport')
      await flush()
      if (pendingAt === 'decode') { read.resolve(bytes()); await flush() }
      player.stop(false)
      read.resolve(bytes())
      decode.resolve(decoded())
      await flush()
      assert.equal(ctx.sources.length, 0)
      attach(player, ctx, master)
      attach(player, ctx, master)
      assert.equal(ctx.sources.length, 1)
      assert.equal(reads, 1)
      assert.equal(ctx.decodes, 1)
      player.stop()
    }
  })
  await test('先选A再选B，A晚到读取不解码、不替换B', async () => {
    const old = deferred<ArrayBuffer>()
    const { player, ctx } = setup((id) => id === 'forest-rain' ? old.promise : Promise.resolve(bytes(2)))
    player.play('forest-rain'); await flush()
    player.play('airport'); await flush()
    old.resolve(bytes(1)); await flush()
    assert.equal(player.playing, 'airport')
    assert.equal(ctx.decodes, 1)
    assert.equal(ctx.sources.length, 1)
    assert.equal(ctx.sources[0].buffer?.marker, 2)
    player.stop()
  })
  await test('旧解码和旧读取失败晚到时均不覆盖新选择或通知过期错误', async () => {
    const oldDecode = deferred<ReturnType<typeof decoded>>()
    const { player, ctx } = setup()
    const errors: string[] = []
    player.onError = (message) => errors.push(message)
    ctx.decodeHook = (input) => new Uint8Array(input)[0] === 1 ? oldDecode.promise : Promise.resolve(decoded(2))
    player.play('forest-rain'); await flush()
    player.play('airport'); await flush()
    oldDecode.resolve(decoded(1)); await flush()
    assert.equal(ctx.sources.length, 1)
    assert.equal(ctx.sources[0].buffer?.marker, 2)
    const oldRead = deferred<ArrayBuffer>()
    const next = setup((id) => id === 'forest-rain' ? oldRead.promise : Promise.resolve(bytes(2)))
    next.player.onError = (message) => errors.push(message)
    next.player.play('forest-rain'); await flush()
    next.player.play('airport'); await flush()
    oldRead.reject(new Error('过期读取失败')); await flush()
    assert.equal(next.player.playing, 'airport')
    assert.deepEqual(errors, [])
    player.stop(); next.player.stop()
  })
  await test('关闭后晚到读取/解码都不启动节点', async () => {
    for (const pendingAt of ['read', 'decode']) {
      const read = deferred<ArrayBuffer>(), decode = deferred<ReturnType<typeof decoded>>()
      const { player, ctx } = setup(() => read.promise)
      ctx.decodeHook = () => decode.promise
      player.play('airport'); await flush()
      if (pendingAt === 'decode') { read.resolve(bytes()); await flush() }
      player.stop()
      read.resolve(bytes()); decode.resolve(decoded()); await flush()
      assert.equal(player.playing, null)
      assert.equal(ctx.sources.length, 0)
      assert.equal(ctx.decodes, pendingAt === 'decode' ? 1 : 0)
    }
  })
  await test('读取异常、同步异常、解码错误、无效时长清空选择并仅通知一次', async () => {
    for (const failure of ['read', 'sync', 'decode', 'empty', 'nan']) {
      const { player, ctx } = setup(() => {
        if (failure === 'sync') throw new Error('同步读取失败')
        return failure === 'read' ? Promise.reject(new Error('文件不存在')) : Promise.resolve(bytes())
      })
      if (failure === 'decode') ctx.decodeHook = async () => { throw new Error('录音损坏') }
      if (failure === 'empty' || failure === 'nan') ctx.decodeHook = async () => decoded(1, failure === 'empty' ? 0 : NaN)
      const errors: string[] = []
      player.onError = (message) => errors.push(message)
      player.play('forest-rain'); await flush()
      assert.equal(player.playing, null)
      assert.equal(ctx.sources.length, 0)
      assert.equal(errors.length, 1)
      assert.match(errors[0], /^森林雨声播放失败：/)
    }
  })
  await test('默认加载器只读取打包相对路径，HTTP错误交给播放器通知', async () => {
    const originalFetch = globalThis.fetch
    const paths: unknown[] = []
    try {
      globalThis.fetch = (async (url) => { paths.push(url); return { ok: true, arrayBuffer: async () => bytes() } }) as typeof fetch
      const player = new BgmPlayer(), ctx = new FakeContext(), master = new FakeNode()
      attach(player, ctx, master)
      player.play('forest-rain'); await flush()
      assert.deepEqual(paths, ['./audio/forest-rain.ogg'])
      assert.equal(ctx.sources.length, 1)
      player.stop()
      globalThis.fetch = (async () => ({ ok: false, status: 404 })) as typeof fetch
      const errors: string[] = []
      player.onError = (message) => errors.push(message)
      player.play('airport'); await flush()
      assert.equal(player.playing, null)
      assert.match(errors[0], /404/)
      assert.equal(ctx.decodes, 1)
    } finally { globalThis.fetch = originalFetch }
  })
  await test('master更换重连且保留位置；context更换停止旧节点并重新解码', async () => {
    const { player, ctx } = setup()
    player.play('forest-rain'); await flush()
    const oldGain = ctx.gains[0]
    ctx.currentTime = 9
    const nextMaster = new FakeNode()
    attach(player, ctx, nextMaster)
    assert.equal(ctx.sources[0].stops, 1)
    assert.equal(oldGain.disconnects, 1)
    assert.equal(ctx.gains[1].connections[0], nextMaster)
    assert.equal(ctx.decodes, 1)
    assert.deepEqual(ctx.sources[1].starts[0], [0, 9])
    const newContext = new FakeContext()
    attach(player, newContext, nextMaster); await flush()
    assert.equal(ctx.sources[1].stops, 1)
    assert.equal(newContext.decodes, 1)
    assert.equal(newContext.sources.length, 1)
    assert.deepEqual(newContext.sources[0].starts[0], [0, 9])
    player.stop()
  })
  await test('context更换期间旧解码不写入新context缓存', async () => {
    const pending = deferred<ReturnType<typeof decoded>>()
    const { player, ctx, master } = setup()
    ctx.decodeHook = () => pending.promise
    player.play('airport'); await flush()
    const next = new FakeContext()
    attach(player, next, master); await flush()
    pending.resolve(decoded(9)); await flush()
    assert.equal(ctx.sources.length, 0)
    assert.equal(next.sources.length, 1)
    assert.equal(next.sources[0].buffer?.marker, 2)
    player.stop()
  })
  await test('音量在attach前保留并限制0..1，运行时平滑调节，NaN安全静音', () => {
    const player = new BgmPlayer(async () => bytes())
    player.setVolume(3)
    const ctx = new FakeContext(), master = new FakeNode()
    attach(player, ctx, master)
    assert.equal(ctx.gains[0].gain.value, 1)
    ctx.currentTime = 7
    for (const value of [0.3, -1, NaN]) player.setVolume(value)
    assert.deepEqual(ctx.gains[0].targets, [[0.3, 7, 0.05], [0, 7, 0.05], [0, 7, 0.05]])
    assert.equal(player.volume, 0)
    assert.equal(ctx.gains[0].connections[0], master)
  })
  const seed = {
    version: 1, totalXp: 5432, character: 'farmer', localBgm: 'owned-ost',
    rods: { owned: ['bamboo', 'training'], equipped: 'training' }, stealth: true, autostart: false,
    waterReminderMinutes: 60, sedentaryReminderMinutes: 50,
    collection: { carp: { count: 4, bestSize: 8, bestQuality: 'gold' } },
    stats: { casts: 100, caught: 51, escaped: 41, trash: 8, perfect: 3, treasure: 2 }
  }
  function loadSave(bgm: unknown, writingFails = false) {
    const stored = { ...seed, ...(bgm === undefined ? {} : { bgm }) }
    let raw = JSON.stringify(stored), writes = 0
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => raw,
      setItem: (_key: string, value: string) => { writes++; if (writingFails) throw new Error('只读'); raw = value }
    } })
    return { save: new SaveStore(), stored, read: () => JSON.parse(raw), writes: () => writes }
  }
  await test('spring/summer/fall和未知旧曲迁移为关闭并持久化，其余进度/本地OST保持', () => {
    for (const id of ['spring', 'summer', 'fall', 'unknown']) {
      const { save, read, writes } = loadSave(id)
      assert.deepEqual(save.data, { ...seed, bgm: null })
      assert.deepEqual(read(), { ...seed, bgm: null })
      assert.equal(writes(), 1)
    }
  })
  await test('新曲/关闭/未选曲均原样保留，迁移无法写盘时仍可读取原存档', () => {
    for (const id of ['forest-rain', 'airport', null, undefined]) {
      const { save, stored, writes } = loadSave(id)
      assert.deepEqual(save.data, { autostart: false, ...stored })
      assert.equal(writes(), 0)
    }
    const { save, writes } = loadSave('spring', true)
    assert.equal(save.data.bgm, null)
    assert.equal(save.data.totalXp, seed.totalXp)
    assert.equal(save.data.localBgm, 'owned-ost')
    assert.equal(writes(), 1)
  })
  console.log(`\n环境音回归：${passed} 项通过`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
