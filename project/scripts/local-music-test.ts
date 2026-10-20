/** Playback and import regressions; async read/decode order is controlled, not timed with sleeps. */
import assert from 'node:assert/strict'
import { AudioBus } from '../src/renderer/core/AudioBus'
import { LocalMusicLibrary, LocalMusicPlayer, MAX_LOCAL_MUSIC_FILE_BYTES } from '../src/renderer/core/LocalMusic'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve() }

class FakeNode {
  connections: unknown[] = []
  starts: number[][] = []
  stops = 0
  buffer: unknown = null
  loop = false
  type = ''
  onended: (() => void) | null = null
  private param() {
    return { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} }
  }
  gain = this.param()
  frequency = this.param()
  connect(to: unknown) { this.connections.push(to); return to }
  disconnect() { this.connections = [] }
  start(...args: number[]) { this.starts.push(args) }
  stop() { this.stops++ }
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  currentTime = 0
  state = 'running'
  destination = new FakeNode()
  gains: FakeNode[] = []
  sources: FakeNode[] = []
  oscillators: FakeNode[] = []
  decodeCalls = 0
  decodeHook: ((data: ArrayBuffer) => Promise<any>) | null = null
  constructor() { FakeAudioContext.instances.push(this) }
  resume() { this.state = 'running'; return Promise.resolve() }
  createGain() { const node = new FakeNode(); this.gains.push(node); return node }
  createBufferSource() { const node = new FakeNode(); this.sources.push(node); return node }
  createOscillator() { const node = new FakeNode(); this.oscillators.push(node); return node }
  decodeAudioData(data: ArrayBuffer) {
    this.decodeCalls++
    return this.decodeHook?.(data) ?? Promise.resolve({ duration: 60, marker: new Uint8Array(data)[0] })
  }
}
Object.defineProperty(globalThis, 'window', { value: { AudioContext: FakeAudioContext }, configurable: true })
// Ambient recordings are bundled assets in production. Tests supply bytes locally and never fetch the network.
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: async () => ({ ok: true, arrayBuffer: async () => Uint8Array.of(79, 103, 103, 83).buffer })
})

let passed = 0
async function test(name: string, run: () => Promise<void> | void) {
  await run()
  passed++
  console.log(`  ✓ ${name}`)
}
function attachedPlayer() {
  const player = new LocalMusicPlayer()
  const ctx = new FakeAudioContext()
  const master = new FakeNode()
  player.attach(ctx as unknown as AudioContext, master as unknown as AudioNode)
  return { player, ctx, master }
}

async function main() {
  await test('导入精确保留文件字节，返回本批曲目；读、列出、删除经桌面桥处理', async () => {
    const track = { id: 'a', name: 'Spring.mp3', mime: 'audio/mpeg' }
    const calls: unknown[] = []
    const library = new LocalMusicLibrary({
      listLocalMusic: async () => [track],
      importLocalMusic: async (files) => { calls.push(files); return [track] },
      readLocalMusic: async (id) => { calls.push(id); return [73, 68, 51] },
      removeLocalMusic: async (id) => { calls.push(`remove:${id}`) }
    })
    assert.equal(library.available, true)
    assert.deepEqual(await library.import([new File([new Uint8Array([73, 68, 51])], 'Spring.mp3')]), [track])
    assert.deepEqual(calls[0], [{ name: 'Spring.mp3', data: [73, 68, 51] }])
    assert.deepEqual(await library.list(), [track])
    assert.deepEqual(await library.read('a'), [73, 68, 51])
    await library.remove('a')
    assert.equal(calls[2], 'remove:a')
  })
  await test('错误扩展名、空文件及超限批次在读取和 IPC 前拒绝', async () => {
    let reads = 0
    let imports = 0
    const library = new LocalMusicLibrary({ importLocalMusic: async () => { imports++; return [] } })
    const fakeFile = (name: string, size: number) => ({ name, size, arrayBuffer: async () => { reads++; return new ArrayBuffer(1) } }) as File
    await assert.rejects(library.import([fakeFile('bad.exe', 5)]), /不支持/)
    await assert.rejects(library.import([fakeFile('empty.mp3', 0)]), /为空/)
    await assert.rejects(library.import([fakeFile('big.wav', MAX_LOCAL_MUSIC_FILE_BYTES + 1)]), /50 MB/)
    await assert.rejects(library.import(Array.from({ length: 4 }, (_, i) => fakeFile(`${i}.mp3`, MAX_LOCAL_MUSIC_FILE_BYTES))), /150 MB/)
    assert.equal(reads, 0)
    assert.equal(imports, 0)
    assert.equal(new LocalMusicLibrary({}).available, false)
  })
  await test('目录曲目来源原样保留；实际目录路径经可选桥读取，旧桥不伪造路径', async () => {
    const track = { id: 'folder-track', name: 'Owned OST.ogg', mime: 'audio/ogg', source: 'folder' as const }
    const musicPath = 'E:\\Fishing Cat\\BGM'
    const library = new LocalMusicLibrary({
      musicFolderInfo: async () => musicPath,
      listLocalMusic: async () => [track],
      readLocalMusic: async () => [79, 103, 103, 83],
      importLocalMusic: async () => [], removeLocalMusic: async () => {}
    })
    assert.equal(library.available, true)
    assert.equal(await library.folderPath(), musicPath)
    assert.deepEqual(await library.list(), [track])
    assert.deepEqual(await library.read(track.id), [79, 103, 103, 83])
    assert.equal(await new LocalMusicLibrary({}).folderPath(), null)
    const failed = new LocalMusicLibrary({ musicFolderInfo: async () => { throw new Error('目录读取失败') } })
    await assert.rejects(failed.folderPath(), /目录读取失败/)
  })
  await test('恢复选曲在首次手势前不读取文件，重复 attach 不重复读取', async () => {
    const player = new LocalMusicPlayer()
    const bytes = deferred<number[]>()
    let reads = 0
    player.play('saved', () => { reads++; return bytes.promise })
    assert.equal(player.playing, 'saved')
    assert.equal(reads, 0)
    const ctx = new FakeAudioContext()
    const master = new FakeNode()
    player.attach(ctx as unknown as AudioContext, master as unknown as AudioNode)
    player.attach(ctx as unknown as AudioContext, master as unknown as AudioNode)
    assert.equal(reads, 1)
    bytes.resolve([1])
    await flush()
    assert.equal(ctx.sources.length, 1)
    assert.equal(ctx.sources[0].loop, true)
    assert.equal(ctx.gains[0].connections[0], master)
    player.stop()
  })
  await test('先选 A 再选 B：A 的晚到读取不能解码或覆盖 B', async () => {
    const { player, ctx } = attachedPlayer()
    const oldRead = deferred<number[]>()
    player.play('A', () => oldRead.promise)
    player.play('B', async () => [2])
    await flush()
    oldRead.resolve([1])
    await flush()
    assert.equal(player.playing, 'B')
    assert.equal(ctx.decodeCalls, 1)
    assert.equal(ctx.sources.length, 1)
    assert.equal((ctx.sources[0].buffer as any).marker, 2)
    player.stop()
  })
  await test('旧曲解码晚到以及旧曲错误不能恢复已切走的音频或显示过期错误', async () => {
    const { player, ctx } = attachedPlayer()
    const oldDecode = deferred<any>()
    const errors: string[] = []
    player.onError = (message) => errors.push(message)
    ctx.decodeHook = (data) => new Uint8Array(data)[0] === 1 ? oldDecode.promise : Promise.resolve({ duration: 60, marker: 2 })
    player.play('A', async () => [1])
    await flush()
    player.play('B', async () => [2])
    await flush()
    oldDecode.resolve({ duration: 60, marker: 1 })
    await flush()
    assert.equal(ctx.sources.length, 1)
    assert.equal((ctx.sources[0].buffer as any).marker, 2)
    const oldError = deferred<number[]>()
    player.play('C', () => oldError.promise)
    player.play('D', async () => [2])
    oldError.reject(new Error('old failure'))
    await flush()
    assert.deepEqual(errors, [])
    assert.equal(player.playing, 'D')
    player.stop()
  })
  await test('静音期间完成读取只缓存；恢复沿用解码结果及暂停位置', async () => {
    const { player, ctx } = attachedPlayer()
    const bytes = deferred<number[]>()
    player.play('A', () => bytes.promise)
    player.setPaused(true)
    bytes.resolve([1])
    await flush()
    assert.equal(ctx.sources.length, 0)
    player.setPaused(false)
    assert.equal(ctx.sources.length, 1)
    ctx.currentTime = 12
    player.setPaused(true)
    assert.equal(ctx.sources[0].stops, 1)
    ctx.currentTime = 30
    player.setPaused(false)
    assert.deepEqual(ctx.sources[1].starts[0], [0, 12])
    assert.equal(ctx.decodeCalls, 1)
    player.stop()
  })
  await test('关闭后晚到读取不会重新开始；当前文件读取/解码错误会清理选择并通知', async () => {
    const { player, ctx } = attachedPlayer()
    const bytes = deferred<number[]>()
    const errors: string[] = []
    player.onError = (message) => errors.push(message)
    player.play('A', () => bytes.promise)
    player.stop()
    bytes.resolve([1])
    await flush()
    assert.equal(ctx.sources.length, 0)
    player.play('missing', async () => { throw new Error('文件不存在') })
    await flush()
    assert.equal(player.playing, null)
    assert.match(errors[0], /文件不存在/)
    ctx.decodeHook = async () => { throw new Error('音频损坏') }
    player.play('bad', async () => [3])
    await flush()
    assert.equal(player.playing, null)
    assert.match(errors[1], /音频损坏/)
  })
  await test('AudioBus 恢复待手势、共用 master、静音恢复及本地/环境音互斥', async () => {
    const before = FakeAudioContext.instances.length
    const audio = new AudioBus()
    audio.setLocalMusic('saved', async () => [1], true)
    assert.equal(FakeAudioContext.instances.length, before)
    audio.unlock()
    await flush()
    const ctx = FakeAudioContext.instances.at(-1)!
    assert.equal(ctx.sources.length, 1)
    // master 是首个 gain，本地播放器的 gain 接到它，master 再接音频输出。
    assert.equal(ctx.gains[0].connections[0], ctx.destination)
    assert.equal(ctx.sources[0].connections[0], ctx.gains[2])
    assert.equal(ctx.gains[2].connections[0], ctx.gains[0])
    audio.setMuted(true)
    assert.equal(audio.localMusic.playing, 'saved')
    assert.equal(ctx.sources[0].stops, 1)
    audio.setMuted(false)
    assert.equal(ctx.sources.length, 2)
    audio.setBgm('forest-rain')
    await flush()
    assert.equal(audio.localMusic.playing, null)
    assert.equal(ctx.sources[1].stops, 1)
    assert.equal(audio.bgm.playing, 'forest-rain')
    const ambient = ctx.sources.at(-1)!
    assert.notEqual(ambient, ctx.sources[1])
    assert.equal(ambient.loop, true)
    audio.setMuted(true)
    assert.equal(ambient.stops, 1)
    audio.setMuted(false)
    await flush()
    assert.equal(audio.bgm.playing, 'forest-rain')
    const resumedAmbient = ctx.sources.at(-1)!
    audio.setLocalMusic('new', async () => [2])
    await flush()
    assert.equal(audio.bgm.playing, null)
    assert.equal(audio.localMusic.playing, 'new')
    assert.equal(resumedAmbient.stops, 1, 'switching to a local file must stop the active ambient recording')
    assert.equal(ctx.sources.filter((source) => source.starts.length && !source.stops).length, 1)
    audio.setBgm(null)
    assert.equal(audio.localMusic.playing, null)
    assert.equal(ctx.sources.at(-1)!.stops, 1)
  })
  await test('AudioBus 将当前播放失败交给 UI，静音时选曲待恢复再读取', async () => {
    const audio = new AudioBus()
    const errors: string[] = []
    audio.onMusicError = (message) => errors.push(message)
    let reads = 0
    audio.setMuted(true)
    audio.setLocalMusic('bad', async () => { reads++; throw new Error('本地文件丢失') })
    await flush()
    assert.equal(reads, 0)
    audio.setMuted(false)
    await flush()
    assert.equal(reads, 1)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /本地文件丢失/)
    assert.equal(audio.localMusic.playing, null)
    audio.setBgm(null)
  })
  console.log(`\n本地音乐回归：${passed} 项通过`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
