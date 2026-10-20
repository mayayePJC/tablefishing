/** Real Game menu/save integration. Native storage and audio decoder have separate tests. */
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { Game } from '../src/renderer/core/Game'
import type { LocalMusicTrack, LocalMusicImportFile } from '../src/renderer/core/LocalMusic'

const noop = () => {}
class Classes {
  values = new Set<string>()
  add(name: string) { this.values.add(name) }
  remove(name: string) { this.values.delete(name) }
  contains(name: string) { return this.values.has(name) }
  toggle(name: string, force?: boolean) { const next = force ?? !this.contains(name); next ? this.add(name) : this.remove(name); return next }
}
class Element {
  id = ''; className = ''; title = ''; type = ''; value = ''; accept = ''; hidden = false
  multiple = false; disabled = false; clicks = 0; files: File[] = []
  children: Element[] = []; classList = new Classes(); dataset: Record<string, string> = {}
  attributes = new Map<string, string>(); listeners: Record<string, Array<(event: any) => void>> = {}
  private text = ''
  private styles = new Map<string, string>()
  style: any = { setProperty: (k: string, v: string) => this.styles.set(k, v),
    removeProperty: (k: string) => this.styles.delete(k), getPropertyValue: (k: string) => this.styles.get(k) ?? '' }
  width = 340; height = 390; clientWidth = 340; clientHeight = 390; scrollHeight = 200; scrollTop = 0
  constructor(public tagName: string) {}
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join('') }
  set textContent(value: string) { this.text = value; this.children = [] }
  get innerHTML() { return this.text }
  set innerHTML(value: string) { this.textContent = value }
  append(...children: Element[]) { this.children.push(...children) }
  appendChild(child: Element) { this.children.push(child); return child }
  setAttribute(k: string, v: string) { this.attributes.set(k, v) }
  getAttribute(k: string) { return this.attributes.get(k) ?? null }
  hasAttribute(k: string) { return this.attributes.has(k) }
  addEventListener(type: string, cb: (event: any) => void) { (this.listeners[type] ??= []).push(cb) }
  removeEventListener() {}
  fire(type: string, extra: object = {}) { for (const cb of this.listeners[type] ?? []) cb({ stopPropagation: noop, preventDefault: noop, ...extra }) }
  click() { if (!this.disabled) { this.clicks++; this.fire('click') } }
  getBoundingClientRect() { return { left: 0, top: 0, right: 340, bottom: 300, width: 340, height: 300 } }
  contains(target: Element): boolean { return target === this || this.children.some((child) => child.contains(target)) }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => {
      const matches = selector.startsWith('#') ? child.id === selector.slice(1)
        : child.className.split(' ').includes(selector.slice(1)) || child.classList.contains(selector.slice(1))
      return [...(matches ? [child] : []), ...child.querySelectorAll(selector)]
    })
  }
  getContext() { return createCanvas(340, 390).getContext('2d') }
}
function param() { return { value: 0, setTargetAtTime: noop, setValueAtTime: noop, exponentialRampToValueAtTime: noop } }
function audioNode(extra = {}) { return { ...extra, connect: (to: unknown) => to, disconnect: noop, start: noop, stop: noop } }
class AudioContextStub {
  currentTime = 0; state = 'running'; destination = {}; sampleRate = 44100
  resume() { return Promise.resolve() }
  createGain() { return audioNode({ gain: param() }) }
  createOscillator() { return audioNode({ frequency: param() }) }
  createBufferSource() { return audioNode({ buffer: null, loop: false }) }
  decodeAudioData() { return Promise.resolve({ duration: 30 }) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve() }
const trackA = { id: 'A', name: '01 - Spring (It’s a Big World Outside).mp3', mime: 'audio/mpeg' }
const trackB = { id: 'B', name: 'Summer.mp3', mime: 'audio/mpeg' }
const trackC = { id: 'C', name: 'Fall.mp3', mime: 'audio/mpeg' }
const folderA: LocalMusicTrack = { id: 'folder:A', name: '01 - Lake at Dawn.ogg', mime: 'audio/ogg', source: 'folder' }
const folderB: LocalMusicTrack = { id: 'folder:B', name: '02 - Evening Walk.mp3', mime: 'audio/mpeg', source: 'folder' }
const folderPath = 'E:\\Fishing Cat 钓鱼桌宠\\BGM'
const activeGames: any[] = []

function fixture(tracks: LocalMusicTrack[] = [], saved: object = {}, options: {
  listed?: () => Promise<LocalMusicTrack[]>; folderInfo?: () => Promise<string>; desktop?: boolean
} = {}) {
  let library = tracks.slice()
  const storage = new Map<string, string>()
  if (Object.keys(saved).length) storage.set('fishing-codex-save-v1', JSON.stringify({ version: 1, ...saved }))
  const roots = new Map<string, Element>()
  const created: Element[] = []
  const windowEvents: Record<string, Array<(e: any) => void>> = {}
  const calls = { imports: 0, lists: 0, folderInfo: 0, reads: [] as string[], removes: [] as string[] }
  const hooks: {
    listed?: () => Promise<LocalMusicTrack[]>; folderInfo?: () => Promise<string>;
    imported?: (files: LocalMusicImportFile[]) => Promise<LocalMusicTrack[]>;
    removed?: (id: string) => Promise<void>; read?: (id: string) => Promise<number[]>
  } = { listed: options.listed, folderInfo: options.folderInfo }
  const bridge = {
    bodyDragBegin: noop, bodyDragEnd: noop, onBodyMoved: noop, onBodyReleased: noop, snapBack: noop,
    onPointerInit: noop, onPointerMove: noop, markReady: noop, quit: noop, openDevTools: noop,
    setAutostart: noop, setClickThrough: noop,
    listLocalMusic: async () => { calls.lists++; return hooks.listed?.() ?? library.slice() },
    musicFolderInfo: async () => { calls.folderInfo++; return hooks.folderInfo?.() ?? folderPath },
    importLocalMusic: async (files: LocalMusicImportFile[]) => {
      calls.imports++
      const imported = await (hooks.imported?.(files) ?? Promise.resolve([trackA]))
      library = Array.from(new Map([...library, ...imported].map((track) => [track.id, track])).values())
      return imported
    },
    readLocalMusic: async (id: string) => { calls.reads.push(id); return hooks.read?.(id) ?? [1, 2, 3] },
    removeLocalMusic: async (id: string) => { calls.removes.push(id); await hooks.removed?.(id); library = library.filter((track) => track.id !== id) }
  }
  Object.assign(globalThis, {
    document: {
      createElement: (tag: string) => { if (tag === 'canvas') return createCanvas(1, 1); const element = new Element(tag); created.push(element); return element },
      getElementById: (id: string) => {
        const existing = created.find((element) => element.id === id)
        if (existing) return existing
        if (!roots.has(id)) { const element = new Element(id === 'game' ? 'canvas' : 'div'); element.id = id; roots.set(id, element) }
        return roots.get(id)
      }, addEventListener: noop, removeEventListener: noop, hidden: false, visibilityState: 'visible', hasFocus: () => true,
      documentElement: { clientHeight: 390 }
    },
    window: {
      fishingCodex: options.desktop === false ? undefined : bridge, AudioContext: AudioContextStub, innerWidth: 340, innerHeight: 390, devicePixelRatio: 1,
      addEventListener: (type: string, cb: (event: any) => void) => { (windowEvents[type] ??= []).push(cb) }, removeEventListener: noop,
      setTimeout, clearTimeout
    },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, String(value)) },
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    fetch: async () => ({ ok: true, arrayBuffer: async () => Uint8Array.of(79, 103, 103, 83).buffer })
  })
  const game: any = new Game()
  activeGames.push(game)
  const byId = (id: string) => (globalThis.document.getElementById(id) as unknown as Element)
  const rows = () => byId('local-music-list').children
  const play = (id: string) => rows().find((row) => row.dataset.musicId === id)!.querySelector('.local-music-play')!.click()
  const remove = (id: string) => rows().find((row) => row.dataset.musicId === id)!.querySelector('.local-music-remove')!.click()
  const select = (files: File[]) => { const input = byId('music-file-input'); input.files = files; input.fire('change') }
  const openBgm = () => {
    if (!game.toolsOpen) game.toggleTools(true)
    if (!game.toolsSubmenu.classList.contains('visible')) game.toolsSettingsBtn.click()
    if (!byId('bgm-list').classList.contains('visible')) game.toolsSubmenu.querySelector('.submenu-parent').click()
  }
  const closeBgm = () => {
    if (byId('bgm-list').classList.contains('visible')) game.toggleMusic(false)
  }
  const setLibrary = (tracks: LocalMusicTrack[]) => { library = tracks.slice() }
  return { game, bridge, byId, rows, play, remove, select, openBgm, closeBgm, setLibrary, hooks, calls, windowEvents, storage }
}
let passed = 0
let failed = 0
async function test(name: string, run: () => Promise<void>) {
  try { await run(); passed++; console.log(`  ✓ ${name}`) }
  catch (error) { failed++; console.error(`  ✗ ${name}`, error) }
  finally {
    for (const game of activeGames.splice(0)) game.audio.setBgm(null)
  }
}

async function main() {
  await test('真实菜单有多选文件入口、可访问状态和文件名完整提示；取消选择保持原状态', async () => {
    const f = fixture([trackA])
    await flush()
    assert.equal(f.byId('music-file-input').multiple, true)
    assert.match(f.byId('music-file-input').accept, /\.mp3/)
    assert.equal(f.byId('music-status').getAttribute('role'), 'status')
    assert.match(f.rows()[0].querySelector('.local-music-play')!.title, /Big World Outside/)
    f.play('A')
    f.select([])
    assert.equal(f.calls.imports, 0)
    assert.equal(f.game.audio.localMusic.playing, 'A')
    f.game.audio.setBgm(null)
  })
  await test('导入自动选择第一首新增曲目并保存；文件选择失焦和导入不会关闭菜单', async () => {
    const f = fixture([trackA])
    await flush()
    f.game.toggleTools(true)
    f.game.toolsSettingsBtn.click()
    f.game.toolsSubmenu.querySelector('.submenu-parent').click()
    await flush()
    f.byId('music-import').click()
    assert.equal(f.byId('music-file-input').clicks, 1)
    for (const cb of f.windowEvents.blur ?? []) cb({})
    assert.equal(f.game.toolsOpen, false)
    assert.equal(f.game.anyOverlayOpen(), true)
    f.hooks.imported = async () => [trackA, trackB, trackC]
    f.select([new File([new Uint8Array([1])], 'Summer.mp3'), new File([new Uint8Array([2])], 'Fall.mp3')])
    await flush()
    assert.equal(f.game.audio.localMusic.playing, 'B')
    assert.equal(f.game.save.data.localBgm, 'B')
    assert.equal(f.game.save.data.bgm, null)
    assert.equal(f.rows().length, 3)
    assert.equal(f.game.toolsOpen, false)
    assert.equal(f.game.anyOverlayOpen(), true)
    assert.equal(f.byId('bgm-list').classList.contains('visible'), true)
    f.game.audio.setBgm(null)
  })
  await test('再次点击本地曲目关闭；重复导入不会产生重复行', async () => {
    const f = fixture([trackA])
    await flush()
    f.play('A')
    assert.equal(f.game.audio.localMusic.playing, 'A')
    f.play('A')
    assert.equal(f.game.audio.localMusic.playing, null)
    assert.equal(f.game.save.data.localBgm, null)
    f.hooks.imported = async () => [trackA, trackA]
    f.select([new File(['ID3'], 'Spring.mp3')])
    await flush()
    assert.equal(f.rows().length, 1)
    assert.equal(f.game.audio.localMusic.playing, 'A')
    f.game.audio.setBgm(null)
  })
  await test('移除正在播放的曲目停止播放并清除存档；失败保留条目和播放', async () => {
    const f = fixture([trackA, trackB])
    await flush()
    f.play('A')
    f.hooks.removed = async () => { throw new Error('无法移除') }
    f.remove('A')
    await flush()
    assert.equal(f.rows().length, 2)
    assert.equal(f.game.audio.localMusic.playing, 'A')
    assert.match(f.byId('music-status').textContent, /无法移除/)
    f.hooks.removed = undefined
    f.remove('A')
    await flush()
    assert.equal(f.rows().length, 1)
    assert.equal(f.game.audio.localMusic.playing, null)
    assert.equal(f.game.save.data.localBgm, null)
  })
  await test('导入失败不覆盖旧选曲；晚到导入结果不覆盖用户之后选择的环境音', async () => {
    const f = fixture([trackA])
    await flush()
    f.play('A')
    f.hooks.imported = async () => { throw new Error('文件格式不匹配') }
    f.select([new File(['ID3'], 'bad.mp3')])
    await flush()
    assert.equal(f.game.audio.localMusic.playing, 'A')
    assert.equal(f.byId('music-status').classList.contains('error'), true)
    const pending = deferred<LocalMusicTrack[]>()
    f.hooks.imported = () => pending.promise
    f.select([new File(['ID3'], 'Summer.mp3')])
    const synth = f.byId('bgm-list').querySelector('.bgm-synth-list')!
    synth.children[0].click()
    pending.resolve([trackB])
    await flush()
    assert.equal(f.game.audio.bgm.playing, 'forest-rain')
    assert.equal(f.game.audio.localMusic.playing, null)
    assert.equal(f.game.save.data.localBgm, null)
    f.game.audio.setBgm(null)
  })
  await test('存档本地曲目优先于环境音，首次操作前不读音频；缺失旧曲安全回退', async () => {
    const f = fixture([trackA], { localBgm: 'A', bgm: 'airport' })
    await flush()
    assert.equal(f.game.audio.localMusic.playing, 'A')
    assert.equal(f.game.audio.bgm.playing, null)
    assert.deepEqual(f.calls.reads, [])
    f.game.audio.unlock()
    await flush()
    assert.deepEqual(f.calls.reads, ['A'])
    f.game.audio.setBgm(null)
    const missing = fixture([], { localBgm: 'gone', bgm: 'airport' })
    await flush()
    assert.equal(missing.game.audio.localMusic.playing, null)
    assert.equal(missing.game.save.data.localBgm, null)
    assert.match(missing.byId('music-status').textContent, /已移除/)
  })
  await test('当前音频读取失败会清理选曲并在菜单显示可读错误', async () => {
    const f = fixture([trackA])
    await flush()
    f.hooks.read = async () => { throw new Error('音乐文件不存在，请重新导入') }
    f.play('A')
    await flush()
    assert.equal(f.game.audio.localMusic.playing, null)
    assert.equal(f.game.save.data.localBgm, null)
    assert.match(f.byId('music-status').textContent, /重新导入/)
    assert.equal(f.byId('music-status').classList.contains('error'), true)
  })
  await test('目录音乐没有移除按钮，导入副本可移除；界面不暴露目录和刷新操作', async () => {
    const f = fixture([folderA, trackA])
    await flush()
    const directoryRow = f.rows().find((row) => row.dataset.musicId === folderA.id)!
    const importedRow = f.rows().find((row) => row.dataset.musicId === trackA.id)!
    assert(directoryRow, 'folder entry must be rendered')
    assert.equal(directoryRow.querySelector('.local-music-remove'), null)
    assert(importedRow.querySelector('.local-music-remove'))
    assert.equal(f.byId('bgm-list').querySelector('#music-folder-path'), null)
    assert.equal(f.byId('bgm-list').querySelector('#music-refresh'), null)
    assert(!f.byId('bgm-list').textContent.includes(folderPath))
    assert.equal(f.calls.folderInfo, 0)
    f.play(folderA.id)
    await flush()
    assert.equal(f.game.audio.localMusic.playing, folderA.id)
    assert.deepEqual(f.calls.removes, [])
    f.game.audio.setBgm(null)
  })
  await test('每次展开 BGM 都重新扫描：新增文件出现，删除正在播放文件则停播并持久清选曲', async () => {
    const f = fixture([folderA])
    await flush()
    const initialScans = f.calls.lists
    f.setLibrary([folderA, folderB])
    f.openBgm()
    await flush()
    assert.equal(f.calls.lists, initialScans + 1)
    assert.deepEqual(f.rows().map((row) => row.dataset.musicId), [folderA.id, folderB.id])
    f.play(folderA.id)
    await flush()
    assert.equal(f.game.save.data.localBgm, folderA.id)
    f.closeBgm()
    assert.equal(f.calls.lists, initialScans + 1, 'closing the panel must not trigger an unnecessary scan')
    f.setLibrary([folderB])
    f.openBgm()
    await flush()
    assert.equal(f.calls.lists, initialScans + 2)
    assert.deepEqual(f.rows().map((row) => row.dataset.musicId), [folderB.id])
    assert.equal(f.game.audio.localMusic.playing, null)
    assert.equal(f.game.save.data.localBgm, null)
    assert.equal(JSON.parse(f.storage.get('fishing-codex-save-v1')!).localBgm, null)
    assert.match(f.byId('music-status').textContent, /已移除|不存在|未找到/)
  })
  await test('重新打开面板自动更新音乐，保留仍存在的当前曲目及播放进度', async () => {
    const f = fixture([folderA])
    await flush()
    f.play(folderA.id)
    await flush()
    const reads = f.calls.reads.slice(), scans = f.calls.lists
    f.setLibrary([folderA, folderB])
    f.closeBgm(); f.openBgm()
    await flush()
    assert.equal(f.calls.lists, scans + 1)
    assert.equal(f.rows().length, 2)
    assert.equal(f.game.audio.localMusic.playing, folderA.id)
    assert.equal(f.game.save.data.localBgm, folderA.id)
    assert.deepEqual(f.calls.reads, reads)
    f.game.audio.setBgm(null)
  })
  await test('空目录有可读引导；扫描失败保留已有列表与播放，后续刷新可恢复', async () => {
    const empty = fixture([])
    await flush()
    assert.equal(empty.rows().length, 0)
    assert.equal(empty.byId('music-empty').hidden, false)
    assert.match(empty.byId('music-empty').textContent, /旋律/)
    assert.equal(empty.byId('music-status').classList.contains('error'), false)
    const f = fixture([folderA])
    await flush()
    f.play(folderA.id)
    await flush()
    f.hooks.listed = async () => { throw new Error('文件夹读取失败：无访问权限') }
    f.closeBgm(); f.openBgm()
    await flush()
    assert.equal(f.rows().length, 1)
    assert.equal(f.game.audio.localMusic.playing, folderA.id)
    assert.equal(f.game.save.data.localBgm, folderA.id)
    assert.match(f.byId('music-status').textContent, /无访问权限/)
    assert.equal(f.byId('music-status').classList.contains('error'), true)
    f.hooks.listed = undefined
    f.setLibrary([folderA, folderB])
    f.closeBgm(); f.openBgm()
    await flush()
    assert.equal(f.rows().length, 2)
    assert.equal(f.byId('music-status').classList.contains('error'), false)
    f.game.audio.setBgm(null)
  })
  await test('启动扫描失败不会把暂时无法读取的保存曲目当作删除；浏览器环境说明桌面功能', async () => {
    const f = fixture([folderA], { localBgm: folderA.id }, {
      listed: async () => { throw new Error('BGM 目录暂时无法读取') }
    })
    await flush()
    assert.equal(f.game.audio.localMusic.playing, folderA.id)
    assert.equal(f.game.save.data.localBgm, folderA.id)
    assert.match(f.byId('music-status').textContent, /无法读取/)
    assert.deepEqual(f.calls.reads, [])
    f.game.audio.setBgm(null)
    const browser = fixture([], {}, { desktop: false })
    await flush()
    assert.equal(browser.byId('music-import').disabled, true)
    assert.match(browser.byId('music-status').textContent, /桌面/)
  })
  await test('晚到目录扫描不能覆盖用户随后选择的目录曲目或环境音', async () => {
    const f = fixture([folderA, folderB])
    await flush()
    f.play(folderA.id)
    const pending = deferred<LocalMusicTrack[]>()
    f.hooks.listed = () => pending.promise
    f.openBgm()
    f.play(folderB.id)
    pending.resolve([])
    await flush()
    assert.equal(f.game.audio.localMusic.playing, folderB.id)
    assert.equal(f.game.save.data.localBgm, folderB.id)
    assert(f.rows().some((row) => row.dataset.musicId === folderB.id))
    const again = deferred<LocalMusicTrack[]>()
    f.hooks.listed = () => again.promise
    f.closeBgm(); f.openBgm()
    const ambient = f.byId('bgm-list').querySelector('.bgm-synth-list')!
    ambient.children[0].click()
    again.resolve([])
    await flush()
    assert.equal(f.game.audio.bgm.playing, 'forest-rain')
    assert.equal(f.game.audio.localMusic.playing, null)
    assert.equal(f.game.save.data.bgm, 'forest-rain')
    assert.equal(f.game.save.data.localBgm, null)
    f.game.audio.setBgm(null)
  })
  await test('换选环境音后旧目录扫描失败不能覆盖新播放、存档或错误状态', async () => {
    const f = fixture([folderA])
    await flush()
    f.play(folderA.id)
    await flush()
    const pending = deferred<LocalMusicTrack[]>()
    f.hooks.listed = () => pending.promise
    f.openBgm()
    f.byId('bgm-list').querySelector('.bgm-synth-list')!.children[0].click()
    await flush()
    assert.equal(f.game.audio.bgm.playing, 'forest-rain')
    pending.reject(new Error('旧目录扫描失败，不应显示'))
    await flush()
    assert.equal(f.game.audio.bgm.playing, 'forest-rain')
    assert.equal(f.game.audio.localMusic.playing, null)
    assert.equal(f.game.save.data.bgm, 'forest-rain')
    assert.equal(f.game.save.data.localBgm, null)
    assert.equal(JSON.parse(f.storage.get('fishing-codex-save-v1')!).bgm, 'forest-rain')
    assert.equal(f.byId('music-status').classList.contains('error'), false)
    assert.doesNotMatch(f.byId('music-status').textContent, /旧目录扫描失败/)
  })
  await test('目录扫描期间完成先前打开的文件选择，晚扫描不能丢掉新导入及新选曲', async () => {
    const f = fixture([folderA])
    await flush()
    f.openBgm()
    await flush()
    f.byId('music-import').click()
    assert.equal(f.byId('music-file-input').clicks, 1)
    const pending = deferred<LocalMusicTrack[]>()
    f.hooks.listed = () => pending.promise
    f.closeBgm(); f.openBgm()
    f.hooks.imported = async () => [trackC]
    f.select([new File(['ID3'], 'Fall.mp3')])
    await flush()
    assert.equal(f.game.audio.localMusic.playing, trackC.id)
    pending.resolve([folderA])
    await flush()
    assert(f.rows().some((row) => row.dataset.musicId === trackC.id))
    assert.equal(f.game.audio.localMusic.playing, trackC.id)
    assert.equal(f.game.save.data.localBgm, trackC.id)
    f.game.audio.setBgm(null)
  })
  await test('目录曲目与两种新环境音互斥；旧三首选曲不会变成其它音乐', async () => {
    const f = fixture([folderA])
    await flush()
    const ambient = f.byId('bgm-list').querySelector('.bgm-synth-list')!
    assert.equal(ambient.children.length, 2)
    assert.match(ambient.textContent, /森林|雨/)
    assert.match(ambient.textContent, /机场/)
    assert.doesNotMatch(ambient.textContent, /春日|夏日|秋日|合成曲/)
    for (const [index, id] of ['forest-rain', 'airport'].entries()) {
      ambient.children[index].click()
      await flush()
      assert.equal(f.game.audio.bgm.playing, id)
      assert.equal(f.game.audio.localMusic.playing, null)
      f.play(folderA.id)
      await flush()
      assert.equal(f.game.audio.bgm.playing, null)
      assert.equal(f.game.audio.localMusic.playing, folderA.id)
    }
    f.game.audio.setBgm(null)
    for (const legacy of ['spring', 'summer', 'fall']) {
      const restored = fixture([], { bgm: legacy })
      await flush()
      assert.equal(restored.game.audio.bgm.playing, null)
      assert.equal(restored.game.save.data.bgm, null)
    }
  })
  await test('内置环境音载入失败清理选中与存档，并在真实菜单显示可读错误', async () => {
    const f = fixture([folderA])
    await flush()
    Object.assign(globalThis, { fetch: async () => { throw new Error('内置环境音文件暂时无法读取') } })
    f.byId('bgm-list').querySelector('.bgm-synth-list')!.children[0].click()
    await flush()
    assert.equal(f.game.audio.bgm.playing, null)
    assert.equal(f.game.audio.localMusic.playing, null)
    assert.equal(f.game.save.data.bgm, null)
    assert.equal(f.game.save.data.localBgm, null)
    assert.match(f.byId('music-status').textContent, /暂时无法读取/)
    assert.equal(f.byId('music-status').classList.contains('error'), true)
  })
  console.log(`\n本地音乐菜单/存档：${passed} 项通过，${failed} 项失败`)
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
