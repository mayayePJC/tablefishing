/** Real Game regression: body charge, native release, drag, click-through. Bundle with esbuild for Node CJS. */
import { createCanvas } from '@napi-rs/canvas'
import { webcrypto } from 'node:crypto'
import { mockIPC } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import { Game } from '../src/renderer/core/Game.ts'

const noop = () => {}
type Pos = { x: number; y: number }
type BodyEvent = Pos & { gestureId?: number }
type Listeners = Record<string, Array<(event: any) => void>>
class MockClassList {
  private values = new Set<string>()
  add(name: string) { this.values.add(name) }
  remove(name: string) { this.values.delete(name) }
  contains(name: string) { return this.values.has(name) }
  toggle(name: string, force?: boolean) {
    const on = force ?? !this.values.has(name)
    on ? this.values.add(name) : this.values.delete(name)
    return on
  }
}
class MockStyle {
  [key: string]: any
  private props: Record<string, string> = {}
  setProperty(name: string, value: string) { this.props[name] = value }
  getPropertyValue(name: string) { return this.props[name] ?? '' }
  removeProperty(name: string) { delete this.props[name] }
}
function fakeCtx(): any {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'measureText') return () => ({ width: 0 })
      if (prop === 'createImageData' || prop === 'getImageData') return (...args: number[]) => {
        const [width, height] = args.slice(-2)
        return { data: new Uint8ClampedArray(width * height * 4), width, height }
      }
      return noop
    },
    set() { return true }
  })
}
class MockElement {
  id = ''
  className = ''
  textContent = ''
  innerHTML = ''
  style = new MockStyle()
  classList = new MockClassList()
  dataset: Record<string, string> = {}
  children: MockElement[] = []
  attributes = new Map<string, string>()
  listeners: Listeners = {}
  capturedPointers = new Set<number>()
  width = 0
  height = 0
  clientWidth = 340
  clientHeight = 390
  constructor(public tagName: string) {}
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  hasAttribute(name: string) { return this.attributes.has(name) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  append(...children: MockElement[]) { children.forEach((child) => this.appendChild(child)) }
  appendChild(child: MockElement) { this.children.push(child); return child }
  addEventListener(type: string, cb: (event: any) => void) { (this.listeners[type] ||= []).push(cb) }
  removeEventListener(type: string, cb: (event: any) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((listener) => listener !== cb)
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 340, height: 390, right: 340, bottom: 390, x: 0, y: 0, toJSON() {} }
  }
  querySelector(selector: string): MockElement | null { return this.querySelectorAll(selector)[0] ?? null }
  querySelectorAll(selector: string): MockElement[] {
    return this.children.flatMap((child) => {
      const matches = selector.startsWith('#') ? child.id === selector.slice(1)
        : child.classList.contains(selector.slice(1)) || child.className.split(' ').includes(selector.slice(1))
      return [...(matches ? [child] : []), ...child.querySelectorAll(selector)]
    })
  }
  contains(target: MockElement): boolean { return target === this || this.children.some((child) => child.contains(target)) }
  getContext() { return fakeCtx() }
  setPointerCapture(pointerId: number) { this.capturedPointers.add(pointerId) }
  releasePointerCapture(pointerId: number) { this.capturedPointers.delete(pointerId) }
  hasPointerCapture(pointerId: number) { return this.capturedPointers.has(pointerId) }
  toDataURL() { return 'data:image/png;base64,' }
  fire(type: string, event: any) { [...(this.listeners[type] ?? [])].forEach((cb) => cb(event)) }
}
const elements: Record<string, MockElement> = {}
const created: MockElement[] = []
const documentListeners: Listeners = {}
const windowListeners: Listeners = {}
const documentShim: any = {
  createElement(tag: string) {
    if (tag === 'canvas') return createCanvas(1, 1)
    const element = new MockElement(tag)
    created.push(element)
    return element
  },
  getElementById(id: string) {
    const existing = created.find((element) => element.id === id)
    if (existing) return existing
    if (!elements[id]) { elements[id] = new MockElement('div'); elements[id].id = id }
    return elements[id]
  },
  addEventListener(type: string, cb: (event: any) => void) { (documentListeners[type] ||= []).push(cb) },
  removeEventListener(type: string, cb: (event: any) => void) {
    documentListeners[type] = (documentListeners[type] ?? []).filter((listener) => listener !== cb)
  },
  hidden: false
}
function audioParam() {
  return { value: 0, setTargetAtTime: noop, setValueAtTime: noop, exponentialRampToValueAtTime: noop,
    linearRampToValueAtTime: noop, cancelScheduledValues: noop }
}
function audioNode(extra: object = {}) {
  return { ...extra, connect: (destination: unknown) => destination, disconnect: noop, start: noop, stop: noop }
}
class AudioContextStub {
  currentTime = 0
  state = 'running'
  destination = {}
  sampleRate = 44100
  resume() { return Promise.resolve() }
  createGain() { return audioNode({ gain: audioParam() }) }
  createOscillator() { return audioNode({ type: '', frequency: audioParam() }) }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) } }
  createBufferSource() { return audioNode({ buffer: null, loop: false }) }
  createBiquadFilter() { return audioNode({ type: '', frequency: audioParam(), Q: audioParam() }) }
}
// Virtual time covers the watchdog boundary immediately and leaves no real timers between cases.
let nowMs = 0
let timerId = 0
const timers = new Map<number, { at: number; cb: () => void }>()
function schedule(cb: () => void, delay = 0) {
  const id = ++timerId
  timers.set(id, { at: nowMs + delay, cb })
  return id
}
function advance(ms: number) {
  const until = nowMs + ms
  for (;;) {
    const next = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
    if (!next) break
    nowMs = next[1].at
    timers.delete(next[0])
    next[1].cb()
  }
  nowMs = until
}
const windowShim: any = {
  addEventListener(type: string, cb: (event: any) => void) { (windowListeners[type] ||= []).push(cb) },
  removeEventListener(type: string, cb: (event: any) => void) {
    windowListeners[type] = (windowListeners[type] ?? []).filter((listener) => listener !== cb)
  },
  setTimeout: schedule,
  clearTimeout: (id: number) => timers.delete(id),
  AudioContext: AudioContextStub,
  crypto: webcrypto,
  devicePixelRatio: 1,
  innerWidth: 340,
  innerHeight: 390
}
const bridgeCalls = {
  setClickThrough: [] as boolean[], inputRegions: [] as (unknown[] | null)[],
  bodyDragBegin: 0, bodyDragEnd: 0, snapBack: 0, markReady: 0,
  beginIds: [] as number[], endIds: [] as number[]
}
let bodyMovedCb: ((position: BodyEvent) => void) | null = null
let bodyReleasedCb: ((position: BodyEvent) => void) | null = null
let pointerMoveCb: ((position: Pos) => void) | null = null
let stealthToggleCb: (() => void) | null = null
let shortcutStatus = { registered: true, shortcut: 'H', error: null as string | null }
const mockBridge = {
  bodyDragBegin: (gestureId: number) => { bridgeCalls.bodyDragBegin++; bridgeCalls.beginIds.push(gestureId) },
  bodyDragEnd: (gestureId: number) => { bridgeCalls.bodyDragEnd++; bridgeCalls.endIds.push(gestureId) },
  onBodyMoved: (cb: (position: BodyEvent) => void) => { bodyMovedCb = cb },
  onBodyReleased: (cb: (position: BodyEvent) => void) => { bodyReleasedCb = cb },
  snapBack: () => { bridgeCalls.snapBack++ },
  onPointerInit: noop,
  onPointerMove: (cb: (position: Pos) => void) => { pointerMoveCb = cb },
  onStealthToggle: (cb: () => void) => { stealthToggleCb = cb },
  stealthShortcutInfo: async () => ({ ...shortcutStatus }),
  markReady: () => { bridgeCalls.markReady++ },
  quit: noop,
  openDevTools: noop,
  setAutostart: noop,
  setInputRegions: (rects: unknown[] | null) => { bridgeCalls.inputRegions.push(rects) },
  setClickThrough: (ignore: boolean) => { bridgeCalls.setClickThrough.push(ignore) }
}
const storage = new Map<string, string>()
Object.assign(globalThis, {
  window: windowShim,
  document: documentShim,
  localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)), removeItem: (key: string) => storage.delete(key) },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: noop,
  setTimeout: schedule,
  clearTimeout: (id: number) => timers.delete(id)
})
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => nowMs } })
let passed = 0
let failed = 0
function assert(name: string, condition: boolean): void {
  if (condition) { passed++; console.log('  ✓', name) }
  else { failed++; console.error('  ✗', name) }
}
async function test(name: string, run: () => void | Promise<void>) {
  console.log(name)
  try { await run() }
  catch (error) { failed++; console.error('  ✗ 用例异常:', error) }
}
const tauriCalls: Array<{ command: string; args: any }> = []
function freshGame(tauri = false, shortcutRegistered = true): { g: any; petHit: MockElement; ctrl: any } {
  for (const record of [elements, windowListeners, documentListeners]) {
    for (const key of Object.keys(record)) delete record[key]
  }
  created.length = 0
  timers.clear()
  storage.clear()
  nowMs = 0
  documentShim.hidden = false
  bodyMovedCb = bodyReleasedCb = pointerMoveCb = null
  stealthToggleCb = null
  shortcutStatus = { registered: shortcutRegistered, shortcut: 'H', error: shortcutRegistered ? null : 'Hotkey occupied (1409)' }
  bridgeCalls.setClickThrough.length = 0
  bridgeCalls.inputRegions.length = bridgeCalls.beginIds.length = bridgeCalls.endIds.length = 0
  bridgeCalls.bodyDragBegin = bridgeCalls.bodyDragEnd = bridgeCalls.snapBack = bridgeCalls.markReady = 0
  tauriCalls.length = 0
  delete windowShim.__TAURI_INTERNALS__
  delete windowShim.__TAURI_EVENT_PLUGIN_INTERNALS__
  windowShim.fishingCodex = tauri ? undefined : mockBridge
  if (tauri) mockIPC((command, args) => {
    tauriCalls.push({ command, args })
    if (command === 'stealth_shortcut_info') return { ...shortcutStatus }
  }, { shouldMockEvents: true })
  const g: any = new Game()
  return { g, petHit: created.find((element) => element.id === 'pet-hit')!, ctrl: g.controller }
}
function step(g: any, frames = 1) {
  for (let i = 0; i < frames; i++) { advance(1000 / 60); g.update(1 / 60); g.frame() }
}
function event(extra: object = {}) {
  return { button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse',
    clientX: 238, clientY: 300, screenX: 238, screenY: 300,
    preventDefault: noop, stopPropagation: noop, ...extra }
}
function fireWindow(type: string, extra: object = {}) {
  const e = event(extra)
  ;[...(windowListeners[type] ?? [])].forEach((cb) => cb(e))
}
function pressBody(petHit: MockElement, extra: object = {}) { petHit.fire('pointerdown', event({ target: petHit, ...extra })) }
function moveBody(dx: number, extra: object = {}) {
  fireWindow('pointermove', { clientX: 238 + dx, screenX: 238 + dx, ...extra })
}
function releaseBody(extra: object = {}) { fireWindow('pointerup', { buttons: 0, ...extra }) }
function releaseNative(position: BodyEvent = { x: 0, y: 0 }) {
  assert('已订阅原生 body-released', bodyReleasedCb !== null)
  bodyReleasedCb?.({ gestureId: bridgeCalls.beginIds.at(-1), ...position })
}
function casts(g: any): number { return g.save.data.stats.casts }
/** Mirror the browser event path: document capture, actual target, then window. */
function clickAt(g: any, x: number, y: number, target: MockElement = g.canvas) {
  const down = event({ target, clientX: x, clientY: y })
  let stopped = false
  down.stopPropagation = () => { stopped = true }
  for (const listener of documentListeners.pointerdown ?? []) listener(down)
  if (!stopped) target.fire('pointerdown', down)
  const up = event({ target, buttons: 0, clientX: x, clientY: y })
  target.fire('pointerup', up)
  for (const listener of windowListeners.pointerup ?? []) listener(up)
  target.fire('click', event({ target, buttons: 0, detail: 1, clientX: x, clientY: y }))
}
function toolsTarget(g: any): MockElement {
  // A dedicated accessible button, when present, sits over every panel.
  const button = created.find((element) => element.id === 'tools-toggle')
  return button ?? (g.toolsOpen ? g.toolsOverlay : g.canvas)
}
async function main() {
  await test('[1] 按住先捕获指针和蓄力，普通松手抛竿，完全不启动原生拖窗', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    assert('按下即捕获本次指针', petHit.hasPointerCapture(1))
    assert('按下即把整个窗口设为交互区', bridgeCalls.inputRegions.at(-1) === null)
    assert('普通按下不启动系统拖窗', bridgeCalls.bodyDragBegin === 0)
    step(g, 30)
    assert('0.5 秒为 charge 且力约 0.5', ctrl.stateName === 'charge' && Math.abs(ctrl.ctx.castPower - 0.5) < 0.02)
    step(g, 30)
    assert('1 秒达到 MAX=1', ctrl.ctx.castPower === 1 && ctrl.ctx.maxCast === true)
    releaseBody()
    step(g)
    assert('松开进入 cast，次数只增加一次', ctrl.stateName === 'cast' && casts(g) === 1)
    assert('身体、捕获和 mouse source 均结束', !g.bodyPressing && !petHit.hasPointerCapture(1) && !g.input.held)
    assert('整次点击不调用 native begin/end/snapBack', bridgeCalls.bodyDragBegin === 0 && bridgeCalls.bodyDragEnd === 0 && bridgeCalls.snapBack === 0)
    releaseBody()
    releaseNative()
    step(g)
    assert('重复或迟到松手不再抛竿', casts(g) === 1)
  })
  await test('[2] 轻点同一逻辑帧 down/up 成功近抛，不等待 native release', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    releaseBody()
    step(g)
    assert('同帧 press/release 抛近竿', ctrl.stateName === 'cast' && casts(g) === 1 && ctrl.ctx.castPower === 0)
    assert('轻点从不进入系统拖窗', bridgeCalls.bodyDragBegin === 0 && bridgeCalls.bodyDragEnd === 0)
    pressBody(petHit)
    releaseBody()
    step(g)
    assert('cast 期间连点不创建第二次抛竿', casts(g) === 1)
  })
  await test('[3] 12px 内手抖继续蓄力，捕获保证身体外松开仍只抛一次', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    step(g, 10)
    moveBody(12)
    step(g, 10)
    assert('阈值内保持 charge 与指针捕获', ctrl.stateName === 'charge' && petHit.hasPointerCapture(1) && bridgeCalls.bodyDragBegin === 0)
    releaseBody({ clientX: 5, clientY: 5, screenX: 5, screenY: 5 })
    step(g)
    assert('身体外捕获的 pointerup 正常抛竿', ctrl.stateName === 'cast' && casts(g) === 1 && !g.input.held)
    assert('无拖窗或窗口回弹', bridgeCalls.bodyDragBegin === 0 && bridgeCalls.snapBack === 0)
  })
  await test('[4] 真正移动超过 12px 才取消钓鱼并启动一次系统拖窗', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    step(g, 20)
    moveBody(13)
    step(g)
    assert('超过阈值返回 idle，无蓄力和抛竿', ctrl.stateName === 'idle' && !g.input.held && casts(g) === 0)
    assert('原生拖窗只开始一次且有数字手势 ID', bridgeCalls.bodyDragBegin === 1 && Number.isInteger(bridgeCalls.beginIds[0]))
    moveBody(30)
    moveBody(40)
    step(g)
    assert('后续移动不重复启动原生拖窗', bridgeCalls.bodyDragBegin === 1)
    releaseNative({ x: 40, y: 0 })
    step(g)
    assert('系统拖窗松开只清理，不抛竿', !g.bodyPressing && !g.bodyDragging && ctrl.stateName === 'idle' && casts(g) === 0)
    assert('结束只对应当前原生手势', bridgeCalls.bodyDragEnd === 1 && bridgeCalls.endIds[0] === bridgeCalls.beginIds[0])
    assert('始终没有手工回弹窗口', bridgeCalls.snapBack === 0)
  })
  for (const type of ['pointercancel', 'lostpointercapture']) {
    await test(`[5:${type}] 普通蓄力取消事件撤销手势而不抛竿`, () => {
      const { g, petHit, ctrl } = freshGame()
      pressBody(petHit)
      step(g, 20)
      petHit.fire(type, event())
      fireWindow(type)
      step(g)
      assert('取消后 idle 且无 held 或身体手势', ctrl.stateName === 'idle' && !g.input.held && !g.bodyPressing)
      releaseBody()
      releaseNative()
      step(g)
      assert('取消后的迟到松手不抛竿', ctrl.stateName === 'idle' && casts(g) === 0)
      assert('没有伪造原生结束', bridgeCalls.bodyDragEnd === 0)
    })
  }
  await test('[6] 原生拖窗的 pointercancel 和 blur 保留 ID，等 native release 清理', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    step(g)
    moveBody(20)
    fireWindow('pointercancel')
    fireWindow('blur')
    step(g)
    assert('OS 接管后仍保留拖窗记录', g.bodyPressing && g.bodyDragging && bridgeCalls.bodyDragEnd === 0)
    assert('OS 接管期间钓鱼已取消', ctrl.stateName === 'idle' && !g.input.held && casts(g) === 0)
    releaseNative({ x: 20, y: 0 })
    step(g)
    assert('真正 native 松手清理，仍不抛竿', !g.bodyPressing && !g.bodyDragging && bridgeCalls.bodyDragEnd === 1 && casts(g) === 0)
  })
  await test('[7] 迟到 native release 不能结束新点击或另一轮原生拖窗', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    step(g)
    moveBody(20)
    const firstId = bridgeCalls.beginIds.at(-1)!
    releaseNative({ x: 20, y: 0, gestureId: firstId })
    pressBody(petHit)
    step(g, 10)
    releaseNative({ x: 20, y: 0, gestureId: firstId })
    step(g)
    assert('上一轮 native release 不结束当前普通蓄力', ctrl.stateName === 'charge' && g.bodyPressing && g.input.held)
    moveBody(20)
    const secondId = bridgeCalls.beginIds.at(-1)!
    assert('每轮原生手势 ID 不同', secondId !== firstId)
    releaseNative({ x: 20, y: 0, gestureId: firstId })
    step(g)
    assert('旧 ID 不结束当前原生拖窗', g.bodyPressing && g.bodyDragging && bridgeCalls.bodyDragEnd === 1)
    releaseNative({ x: 20, y: 0, gestureId: secondId })
    step(g)
    assert('当前 ID 才结束拖窗且没有误抛', !g.bodyPressing && bridgeCalls.bodyDragEnd === 2 && casts(g) === 0)
  })
  await test('[8] 长按三秒持续 MAX，其他指针不能松开当前手势', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    step(g, 180)
    assert('3 秒仍 charge/MAX，手势和 held 保留', ctrl.stateName === 'charge' && ctrl.ctx.castPower === 1 && g.bodyPressing && g.input.held)
    releaseBody({ pointerId: 2 })
    step(g)
    assert('其他 pointerId 的松开被忽略', ctrl.stateName === 'charge' && g.bodyPressing && casts(g) === 0)
    fireWindow('pointercancel', { pointerId: 2 })
    step(g)
    assert('其他 pointerId 的取消也不影响当前蓄力', ctrl.stateName === 'charge' && g.input.held && g.bodyPressing)
    releaseBody()
    step(g)
    assert('原始指针松开才完成抛竿', ctrl.stateName === 'cast' && casts(g) === 1 && bridgeCalls.bodyDragBegin === 0)
  })
  await test('[9] 右键和非主指针不启动蓄力', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit, { button: 2 })
    step(g)
    pressBody(petHit, { pointerId: 2, isPrimary: false })
    step(g)
    assert('忽略非主点击，不 capture 或 drag', ctrl.stateName === 'idle' && !g.bodyPressing && !petHit.hasPointerCapture(1) && bridgeCalls.bodyDragBegin === 0)
  })
  await test('[10] 普通蓄力失焦取消，迟到 DOM/native 松手不抛竿', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    step(g, 30)
    fireWindow('blur')
    step(g)
    assert('失焦回 idle，清除 held、捕获和身体手势', ctrl.stateName === 'idle' && !g.input.held && !g.bodyPressing && !petHit.hasPointerCapture(1))
    releaseBody()
    releaseNative({ x: 0, y: 0, gestureId: 999 })
    step(g, 2)
    assert('迟到松手不误抛', ctrl.stateName === 'idle' && casts(g) === 0)
    pressBody(petHit)
    step(g, 10)
    assert('下次按下可以重新蓄力', ctrl.stateName === 'charge' && ctrl.ctx.castPower > 0)
  })
  await test('[11] mouse+C 多源按住，松 mouse 后 C 继续，最后松 C 才抛', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    fireWindow('keydown', { code: 'KeyC', repeat: false })
    step(g, 20)
    releaseBody()
    step(g)
    assert('mouse 松开仅移除 mouse source，C 保持 charge', ctrl.stateName === 'charge' && !g.bodyPressing && g.input.held && casts(g) === 0)
    fireWindow('keyup', { code: 'KeyC' })
    step(g)
    assert('最后一个 source 松开只抛一次', ctrl.stateName === 'cast' && casts(g) === 1 && !g.input.held)
  })
  await test('[12] mouse+C 松 C 后身体仍按住，最终 pointerup 才抛', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    fireWindow('keydown', { code: 'KeyC', repeat: false })
    step(g, 20)
    fireWindow('keyup', { code: 'KeyC' })
    step(g)
    assert('keyboard 松开不误结束 mouse charge', ctrl.stateName === 'charge' && g.bodyPressing && g.input.held && casts(g) === 0)
    releaseBody()
    step(g)
    assert('最终 mouse 松开抛一次', ctrl.stateName === 'cast' && casts(g) === 1)
  })
  await test('[13] C+Space 多键及失焦清理，迟到 keyup 不误抛', () => {
    const { g, ctrl } = freshGame()
    fireWindow('keydown', { code: 'KeyC', repeat: false })
    fireWindow('keydown', { code: 'Space', repeat: false })
    step(g, 20)
    fireWindow('keyup', { code: 'KeyC' })
    step(g)
    assert('C 松开后 Space 继续蓄力', ctrl.stateName === 'charge' && g.input.held)
    fireWindow('blur')
    step(g)
    assert('失焦取消所有键盘 sources', ctrl.stateName === 'idle' && !g.input.held && casts(g) === 0)
    fireWindow('keyup', { code: 'Space' })
    step(g)
    assert('迟到 keyup 不产生 release', ctrl.stateName === 'idle' && casts(g) === 0)
    fireWindow('keydown', { code: 'KeyC', repeat: false })
    step(g)
    assert('重新按 C 从零开始正常蓄力', ctrl.stateName === 'charge' && ctrl.ctx.castPower > 0 && ctrl.ctx.castPower < 0.1)
  })
  await test('[14] 原生热区初始化，按下立即全窗，pointer轮询不翻转全窗穿透', () => {
    const { g, petHit } = freshGame()
    assert('初始化直接提供身体与工具热区', bridgeCalls.inputRegions.some((regions) => Array.isArray(regions) && regions.length >= 2))
    const before = bridgeCalls.inputRegions.length
    pointerMoveCb?.({ x: 5, y: 5 })
    pointerMoveCb?.({ x: 238, y: 300 })
    assert('指针轮询不再驱动 setClickThrough', bridgeCalls.setClickThrough.length === 0)
    assert('闲置指针运动不重复发送相同热区', bridgeCalls.inputRegions.length === before)
    pressBody(petHit)
    assert('还未到下一逻辑帧就立即整窗交互', bridgeCalls.inputRegions.at(-1) === null)
    step(g)
    releaseBody()
    step(g)
    assert('cast 隐藏身体拖窗层并继续整窗交互', petHit.style.display === 'none' && bridgeCalls.inputRegions.at(-1) === null)
  })
  await test('[15] 菜单覆盖阻止身体误按，打开/关闭同步热区', () => {
    const { g, petHit, ctrl } = freshGame()
    g.toggleHelp(true)
    assert('说明打开后立即全窗交互', bridgeCalls.inputRegions.at(-1) === null)
    pressBody(petHit)
    step(g)
    assert('覆盖层内身体不启动蓄力或拖窗', ctrl.stateName === 'idle' && !g.bodyPressing && bridgeCalls.bodyDragBegin === 0)
    g.toggleHelp(false)
    step(g)
    assert('关闭后恢复身体和工具的局部热区', Array.isArray(bridgeCalls.inputRegions.at(-1)))
    pressBody(petHit)
    step(g)
    assert('关闭覆盖后再次点击可蓄力', ctrl.stateName === 'charge' && g.bodyPressing)
  })
  await test('[16] 真实 Tauri invoke/listen 使用延迟拖窗、热区和手势 ID', async () => {
    const { g, petHit, ctrl } = freshGame(true)
    assert('身体没有 Tauri 自动拖窗区', !petHit.hasAttribute('data-tauri-drag-region'))
    assert('身体没有吞 DOM 的 CSS drag 区', petHit.style.getPropertyValue('-webkit-app-region') !== 'drag')
    assert('真实桥初始化 mark_ready 与 set_input_regions', tauriCalls.some(({ command }) => command === 'mark_ready') && tauriCalls.some(({ command }) => command === 'set_input_regions'))
    pressBody(petHit)
    step(g, 20)
    assert('真实桥普通按下只蓄力，不调用 native begin', ctrl.stateName === 'charge' && !tauriCalls.some(({ command }) => command === 'body_drag_begin'))
    moveBody(20)
    step(g)
    const begin = tauriCalls.find(({ command }) => command === 'body_drag_begin')
    assert('越阈值才 invoke native begin 并带 gestureId', begin !== undefined && Number.isInteger(begin.args?.gestureId))
    const gestureId = begin?.args?.gestureId
    await emit('body-released', { x: 20, y: 0, gestureId: gestureId + 1 })
    step(g)
    assert('真实 listen 忽略其他手势 ID 的释放', g.bodyDragging && g.bodyPressing)
    await emit('body-released', { x: 20, y: 0, gestureId })
    step(g)
    assert('真实 listen 结束正确拖窗且不抛竿', ctrl.stateName === 'idle' && !g.bodyPressing && casts(g) === 0)
    assert('native end 带同一 ID，始终不 snap_back', tauriCalls.some(({ command, args }) => command === 'body_drag_end' && args?.gestureId === gestureId) && !tauriCalls.some(({ command }) => command === 'snap_back'))
  })
  await test('[17] 鱼竿图鉴升级后刷新解锁，切换装备不覆盖锁定文案', () => {
    const { g } = freshGame()
    const cards = (g.rodGrid as MockElement).querySelectorAll('.rod-card')
    const fiberglass = cards.find((card) => card.dataset.id === 'fiberglass') as any
    const iridium = cards.find((card) => card.dataset.id === 'iridium') as any
    assert('未解锁的鱼竿禁用', fiberglass.disabled && iridium.disabled)
    g.save.data.rods.owned.push('fiberglass')
    g.toggleRod(true)
    assert('重新打开显示本次新解锁的鱼竿', !fiberglass.disabled && fiberglass.querySelector('.sl').textContent === '点击装备')
    fiberglass.fire('click', {})
    assert('新解锁卡片可以装备', g.save.data.rods.equipped === 'fiberglass' && fiberglass.querySelector('.sl').textContent === '使用中')
    assert('其他锁定鱼竿保留等级提示', iridium.disabled && iridium.querySelector('.sl').textContent === 'Lv.6 解锁')
  })
  await test('[18] 同帧 mouse+C 取消 mouse 后，键盘仍可开始蓄力', () => {
    const { g, petHit, ctrl } = freshGame()
    pressBody(petHit)
    fireWindow('keydown', { code: 'KeyC', repeat: false })
    fireWindow('pointercancel')
    step(g)
    assert('C 仍按住时聚合 press 不能被 mouse cancel 撤销', g.input.held && ctrl.stateName === 'charge')
  })
  await test('[19] 键盘蓄力期间拖动人物仍保留键盘输入', () => {
    const { g, petHit, ctrl } = freshGame()
    fireWindow('keydown', { code: 'KeyC', repeat: false })
    step(g, 10)
    pressBody(petHit)
    step(g, 10)
    moveBody(20)
    step(g)
    assert('按住 C 后 mouse 拖窗仍保留键盘蓄力', g.input.held && ctrl.stateName === 'charge')
    fireWindow('blur')
    step(g)
    assert('OS 拖动失焦清键盘蓄力，保留拖动编号，不残留 charge', !g.input.held && ctrl.stateName === 'idle' && g.bodyDragging)
    releaseNative({ x: 30, y: 0, gestureId: bridgeCalls.beginIds[0] })
    fireWindow('keyup', { code: 'KeyC' })
    step(g)
    assert('原生结束与迟到 keyup 不误抛', !g.bodyPressing && ctrl.stateName === 'idle' && casts(g) === 0)
  })
  await test('[20] 点击说明面板外关闭，消费同一击避免误起蓄力', () => {
    const { g, ctrl } = freshGame()
    g.toggleHelp(true)
    let stopped = false
    const click = event({
      target: g.canvas, clientX: 100, clientY: 300,
      stopPropagation: () => { stopped = true }
    })
    for (const listener of documentListeners.pointerdown ?? []) listener(click)
    if (!stopped) g.canvas.fire('pointerdown', click)
    step(g)
    assert('同一击关闭面板后仍 idle', ctrl.stateName === 'idle')
  })
  await test('[21] 工具按钮再次点击关闭面板，覆盖层不能截走同一按钮', () => {
    const { g, ctrl } = freshGame()
    clickAt(g, 318, 368, toolsTarget(g))
    assert('第一次完整点击打开菜单', g.toolsOpen)
    clickAt(g, 318, 368, toolsTarget(g))
    step(g)
    assert('第二次完整点击关闭所有面板', !g.anyOverlayOpen())
    assert('快速两次菜单点击不蓄力、不抛竿', ctrl.stateName === 'idle' && !g.input.held && casts(g) === 0)
    clickAt(g, 318, 368, toolsTarget(g))
    assert('第三次完整点击重新打开菜单', g.toolsOpen)
  })
  await test('[22] 玩法和三个图鉴打开时，菜单按钮关闭当前面板', () => {
    for (const open of ['toggleHelp', 'toggleChar', 'toggleFish', 'toggleRod']) {
      const { g, ctrl } = freshGame()
      g[open](true)
      clickAt(g, 318, 368, toolsTarget(g))
      step(g)
      assert(`${open} 打开后点菜单关闭所有面板`, !g.anyOverlayOpen())
      assert(`${open} 关闭同一击不钓鱼`, ctrl.stateName === 'idle' && !g.input.held && casts(g) === 0)
    }
  })
  await test('[23] 失焦或恢复可见后，新的完整菜单点击立即有效', () => {
    const { g } = freshGame()
    fireWindow('blur')
    advance(1)
    clickAt(g, 318, 368, toolsTarget(g))
    assert('失焦后 1ms 新点击也可打开工具菜单', g.toolsOpen)
    g.toggleTools(false)
    documentShim.hidden = true
    for (const listener of documentListeners.visibilitychange ?? []) listener({})
    documentShim.hidden = false
    advance(1)
    clickAt(g, 318, 368, toolsTarget(g))
    assert('恢复可见后新的完整点击不被冷却吞掉', g.toolsOpen)
  })
  await test('[24] 工具边缘覆盖描边和点击余量，原生热区与实际命中一致', () => {
    const { g, ctrl } = freshGame()
    assert('可见描边之外 1px 仍命中工具，避免误钓鱼', g.input.toolsHitTest(332, 368))
    assert('按钮外空白没有无限扩大的工具热区', !g.input.toolsHitTest(338, 368))
    const regions = bridgeCalls.inputRegions.at(-1) as Array<{ x: number; y: number; width: number; height: number }>
    assert('原生窗口热区保留右侧点击余量', regions.some((r) => 332 >= r.x && 332 < r.x + r.width && 368 >= r.y && 368 < r.y + r.height))
    clickAt(g, 332, 368, toolsTarget(g))
    step(g)
    assert('点击菜单边缘打开菜单且不蓄力', g.toolsOpen && ctrl.stateName === 'idle' && casts(g) === 0)
  })
  await test('[25] 按下菜单后拖离或取消，不切换面板也不误钓鱼', () => {
    for (const cancel of [false, true]) {
      const { g, ctrl } = freshGame()
      const target = toolsTarget(g)
      const down = event({ target, clientX: 318, clientY: 368 })
      for (const listener of documentListeners.pointerdown ?? []) listener(down)
      target.fire('pointerdown', down)
      step(g)
      assert(`${cancel ? '取消' : '拖离'}之前按下不立即弹菜单`, !g.anyOverlayOpen())
      if (cancel) {
        const cancelled = event({ target, clientX: 318, clientY: 368 })
        target.fire('pointercancel', cancelled)
        for (const listener of windowListeners.pointercancel ?? []) listener(cancelled)
      }
      const up = event({ target: g.canvas, buttons: 0, clientX: cancel ? 318 : 280, clientY: 368 })
      const upTarget = target.hasPointerCapture(1) ? target : g.canvas
      upTarget.fire('pointerup', up)
      for (const listener of windowListeners.pointerup ?? []) listener(up)
      if (!cancel && upTarget === target) target.fire('click', up)
      step(g)
      assert(`${cancel ? '取消后迟到松手' : '拖离按钮再松手'}不切换面板`, !g.anyOverlayOpen())
      assert(`${cancel ? '取消' : '拖离'}菜单手势不抛竿`, ctrl.stateName === 'idle' && !g.input.held && casts(g) === 0)
      clickAt(g, 318, 368, toolsTarget(g))
      assert(`${cancel ? '取消' : '拖离'}后可正常重新点击打开`, g.toolsOpen)
    }
  })
  await test('[26] 菜单完整方形热区四角可点击，边界外保持不命中', () => {
    const { g, ctrl } = freshGame()
    for (const [x, y] of [[302, 352], [333, 352], [302, 383], [333, 383]]) {
      assert(`点击余量角落 ${x},${y} 属于菜单`, g.input.toolsHitTest(x, y))
      clickAt(g, x, y, toolsTarget(g))
      assert(`角落 ${x},${y} 打开菜单`, g.toolsOpen)
      clickAt(g, x, y, toolsTarget(g))
      assert(`角落 ${x},${y} 再点关闭`, !g.anyOverlayOpen())
    }
    for (const [x, y] of [[301, 368], [334, 368], [318, 351], [318, 384]]) {
      assert(`边界外 ${x},${y} 不属于菜单`, !g.input.toolsHitTest(x, y))
    }
    step(g)
    assert('全部角落点击不蓄力、不抛竿', ctrl.stateName === 'idle' && casts(g) === 0)
  })
  await test('[27] 菜单键盘激活不冒泡为空格钓鱼，pointerup 后 click 不重复切换', () => {
    for (const code of ['Space', 'Enter']) {
      const { g, ctrl } = freshGame()
      const target = toolsTarget(g)
      for (const type of ['keydown', 'keyup']) {
        let stopped = false
        const key = event({ target, code, repeat: false, stopPropagation: () => { stopped = true } })
        target.fire(type, key)
        if (!stopped) fireWindow(type, key)
      }
      target.fire('click', event({ target, buttons: 0, detail: 0 }))
      step(g)
      assert(`${code} 原生激活打开菜单且不钓鱼`, g.toolsOpen && ctrl.stateName === 'idle' && !g.input.held && casts(g) === 0)
      target.fire('click', event({ target, buttons: 0, detail: 0 }))
      assert(`${code} 再次激活关闭菜单`, !g.anyOverlayOpen())
      clickAt(g, 318, 368, target)
      assert('pointerup 加实际 click 事件只切换一次', g.toolsOpen)
    }
  })
  await test('[28] 菜单捕获丢失后迟到松手不切换，下一次点击仍有效', () => {
    const { g, ctrl } = freshGame()
    const target = toolsTarget(g)
    target.fire('pointerdown', event({ target, clientX: 318, clientY: 368 }))
    target.releasePointerCapture(1)
    target.fire('lostpointercapture', event({ target, clientX: 318, clientY: 368 }))
    fireWindow('pointerup', { target, buttons: 0, clientX: 318, clientY: 368 })
    step(g)
    assert('丢失捕获的旧手势不打开菜单、不抛竿', !g.anyOverlayOpen() && ctrl.stateName === 'idle' && casts(g) === 0)
    clickAt(g, 318, 368, target)
    assert('丢失捕获后新的完整点击有效', g.toolsOpen)
  })
  await test('[29] 设置和音乐展开时再次点击菜单收起全部层级', () => {
    const { g } = freshGame()
    clickAt(g, 318, 368, toolsTarget(g))
    g.toolsSubmenu.classList.add('visible')
    g.toolsSettingsBtn.setAttribute('aria-expanded', 'true')
    const list = g.musicPicker as MockElement
    const bgmParent = g.toolsSubmenu.querySelector('.submenu-parent') as MockElement
    list.classList.add('visible')
    bgmParent.fire('click', event({ target: bgmParent }))
    clickAt(g, 318, 368, toolsTarget(g))
    assert('音乐展开时按菜单关闭全部面板', !g.anyOverlayOpen())
    assert('设置和BGM展开态全部收起', !g.toolsSubmenu.classList.contains('visible') && !list.classList.contains('visible'))
    assert('语义展开状态同步关闭', g.toolsSettingsBtn.getAttribute('aria-expanded') === 'false' && toolsTarget(g).getAttribute('aria-expanded') === 'false')
    clickAt(g, 318, 368, toolsTarget(g))
    assert('再次打开只显示一级菜单', g.toolsOpen && !g.toolsSubmenu.classList.contains('visible') && !list.classList.contains('visible'))
  })
  await test('[30] 全局隐身事件无需焦点，菜单状态、存档和身体热区立即同步', async () => {
    const { g, petHit } = freshGame()
    await Promise.resolve()
    const stealthBtn = created.find((element) => element.title === 'H')!
    assert('隐身仅保留H快捷键属性，不增加菜单说明行', stealthBtn.getAttribute('aria-keyshortcuts') === 'H' && !created.some((element) => element.id === 'stealth-shortcut-state'))
    assert('已接入原生隐身事件', stealthToggleCb !== null)
    fireWindow('blur')
    stealthToggleCb?.()
    assert('未聚焦时原生事件隐藏人物并保存', g.view.stealth && g.save.data.stealth)
    assert('隐身立即去掉DOM身体层和fallback命中', petHit.style.display === 'none' && !g.inPetBody(238, 300))
    const regions = bridgeCalls.inputRegions.at(-1) as Array<{ x: number; y: number; width: number; height: number }>
    assert('隐身立即移除身体原生热区，仍保留菜单', regions.length === 1 && regions[0].x === 302)
    assert('菜单隐身开关与快捷键同步', stealthBtn.children.some((child) => child.textContent === '开'))
    stealthToggleCb?.()
    assert('再次全局事件恢复人物和身体热区', !g.view.stealth && !g.save.data.stealth && petHit.style.display === '' && (bridgeCalls.inputRegions.at(-1) as unknown[]).length === 2)
    fireWindow('keydown', { code: 'KeyH', repeat: false })
    fireWindow('keydown', { code: 'KeyH', repeat: true })
    assert('原生H已注册时，DOM H及长按不重复切换', !g.view.stealth)
  })
  await test('[31] 隐身取消普通身体蓄力和捕获，不误抛；不可用快捷键有提示且菜单可用', async () => {
    const { g, petHit, ctrl } = freshGame(false, false)
    await Promise.resolve()
    const stealthBtn = created.find((element) => element.title?.includes('1409'))!
    assert('注册错误只放悬停提示，不占用菜单布局', !!stealthBtn && !created.some((element) => element.id === 'stealth-shortcut-state'))
    pressBody(petHit)
    step(g, 10)
    stealthBtn.fire('click', event())
    assert('菜单隐身仍可用且立即取消身体蓄力', g.view.stealth && !g.bodyPressing && !g.input.held && ctrl.stateName === 'idle' && !petHit.hasPointerCapture(1))
    releaseBody()
    pressBody(petHit)
    step(g)
    assert('迟到松手或隐藏层残留事件不误抛', casts(g) === 0 && ctrl.stateName === 'idle')
  })
  await test('[32] 原生快捷键IPC与事件接线，角色卡片仅选中项显示使用中', async () => {
    const { g, petHit } = freshGame(true)
    await Promise.resolve()
    assert('读取原生真实注册状态', tauriCalls.some(({ command }) => command === 'stealth_shortcut_info'))
    await emit('stealth-toggle')
    assert('原生事件直接切隐身及命中区', g.view.stealth && petHit.style.display === 'none')
    const cards = (g.charGrid as MockElement).querySelectorAll('.char-card')
    assert('非选中角色不再显示重复切换文字', cards.filter((card) => card.querySelector('.sl')!.textContent === '使用中').length === 1 && cards.every((card) => ['', '使用中'].includes(card.querySelector('.sl')!.textContent)))
    const other = cards.find((card) => card.dataset.id !== g.skin)!
    other.fire('click', event())
    assert('切换后只有新角色显示使用中', cards.filter((card) => card.querySelector('.sl')!.textContent === '使用中').length === 1 && other.querySelector('.sl')!.textContent === '使用中')
  })
  await test('[33] M静音、H隐身：单键生效，长按、修饰键与原生监听不重复切换', async () => {
    const { g, ctrl } = freshGame(false, false)
    await Promise.resolve()
    fireWindow('keydown', { code: 'KeyH', repeat: false })
    assert('H单键切换隐身，原生不可用时仍可在窗口内使用', g.view.stealth && g.save.data.stealth)
    fireWindow('keydown', { code: 'KeyH', repeat: true })
    assert('长按H只切换一次', g.view.stealth)
    fireWindow('keyup', { code: 'KeyH' })
    fireWindow('keydown', { code: 'KeyH', repeat: false })
    assert('松开后再次按H恢复显示', !g.view.stealth)
    const muted = g.audio.muted
    fireWindow('keydown', { code: 'KeyM', repeat: false })
    assert('M单键切换静音', g.audio.muted !== muted)
    fireWindow('keydown', { code: 'KeyM', repeat: true })
    assert('长按M只切换一次', g.audio.muted !== muted)
    for (const code of ['KeyH', 'KeyM']) {
      for (const modifier of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'isComposing']) {
        fireWindow('keydown', { code, repeat: false, [modifier]: true })
      }
    }
    assert('带修饰键或输入法组合不触发M/H', !g.view.stealth && g.audio.muted !== muted)
    assert('M/H操作不误触蓄力或抛竿', !g.input.held && ctrl.stateName === 'idle' && casts(g) === 0)
  })
  console.log(`\ninteraction-test: ${passed} passed, ${failed} failed`)
  process.exitCode = failed > 0 ? 1 : 0
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
