/**
 * 身体区手势状态机单元测试（纯逻辑，无 DOM）。
 * 运行：node --experimental-strip-types scripts/gesture-test.ts
 *
 * 覆盖三种核心行为：
 *  1) 点一下（按下即松开、无移动）= 钓鱼（fish-start → reset）
 *  2) 按下 + 微抖（未超阈值）= 仍视为钓鱼按住，不触发拖窗
 *  3) 按下 + 移动超阈值 = 取消钓鱼并转拖窗（begin-drag → 连续 drag）
 *  4) 拖窗中/松手后，多余 move 被正确忽略
 */
import { newGestureState, stepGesture, type GestureResult } from '../src/renderer/core/gesture.ts'

let passed = 0
let failed = 0
function check(name: string, got: GestureResult, want: GestureResult): void {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) {
    passed++
    console.log('  PASS', name)
  } else {
    failed++
    console.log('  FAIL', name, '\n    got :', g, '\n    want:', w)
  }
}

const TH = 5

// 1) 纯点击（down → up，无 move）：应触发钓鱼，不产生拖窗
{
  const s = newGestureState()
  check('tap.down', stepGesture(s, { kind: 'down', x: 100, y: 100 }, TH), { type: 'fish-start' })
  check('tap.up', stepGesture(s, { kind: 'up' }, TH), { type: 'reset' })
}

// 2) 按下 + 低于阈值的微抖：不应触发拖窗
{
  const s = newGestureState()
  stepGesture(s, { kind: 'down', x: 100, y: 100 }, TH)
  check('jitter.move', stepGesture(s, { kind: 'move', x: 102, y: 101 }, TH), { type: 'none' })
  check('jitter.up', stepGesture(s, { kind: 'up' }, TH), { type: 'reset' })
}

// 3) 按下 + 越过阈值：首帧返回 begin-drag（取消钓鱼 + 位移增量），随后持续 drag
{
  const s = newGestureState()
  stepGesture(s, { kind: 'down', x: 100, y: 100 }, TH)
  check('drag.begin', stepGesture(s, { kind: 'move', x: 110, y: 104 }, TH), { type: 'begin-drag', dx: 10, dy: 4 })
  check('drag.move1', stepGesture(s, { kind: 'move', x: 115, y: 108 }, TH), { type: 'drag', dx: 5, dy: 4 })
  check('drag.move2', stepGesture(s, { kind: 'move', x: 110, y: 108 }, TH), { type: 'drag', dx: -5, dy: 0 })
  check('drag.up', stepGesture(s, { kind: 'up' }, TH), { type: 'reset' })
}

// 4) 松手后的 move 必须被忽略（不残留拖窗）
{
  const s = newGestureState()
  stepGesture(s, { kind: 'down', x: 0, y: 0 }, TH)
  stepGesture(s, { kind: 'move', x: 50, y: 50 }, TH) // begin-drag
  stepGesture(s, { kind: 'up' }, TH)
  check('after-up.move', stepGesture(s, { kind: 'move', x: 999, y: 999 }, TH), { type: 'none' })
}

// 5) 未按下时的 move 必须被忽略
{
  const s = newGestureState()
  check('no-down.move', stepGesture(s, { kind: 'move', x: 50, y: 50 }, TH), { type: 'none' })
}

console.log(`\ngesture-test: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
