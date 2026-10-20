/**
 * 身体区手势状态机单元测试（纯逻辑，无 DOM）。
 * 运行：node --experimental-strip-types scripts/gesture-test.ts
 *
 * 判定信号 = 主进程转发的【窗口位移】（原生拖窗期间渲染进程 pointermove 会被吞）。
 * 覆盖：
 *  1) 点一下（按下即松开、窗口没动）= 钓鱼（fish-start → click-end）
 *  2) 按下 + 手抖（窗口位移 ≤ 阈值）= 仍视为钓鱼按住，不取消
 *  3) 按下 + 窗口位移超阈值 = 取消钓鱼并转拖窗（drag-begin → drag-end）
 *  4) 阈值边界：恰好等于阈值不算越界（严格大于才越界）
 *  5) 松手后 / 未按下时的 win-move 必须被忽略
 *  6) 第二次 down 复位上一次手势的 dragging 残留
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

const TH = 12

// 1) 纯点击（down → up，窗口没动）：点击成立，走钓鱼流程
{
  const s = newGestureState()
  check('tap.down', stepGesture(s, { kind: 'down' }, TH), { type: 'fish-start' })
  check('tap.up', stepGesture(s, { kind: 'up' }, TH), { type: 'click-end' })
}

// 2) 按下 + 手抖（窗口位移 2px ≤ 阈值）：不触发拖窗，松手仍是点击
{
  const s = newGestureState()
  stepGesture(s, { kind: 'down' }, TH)
  check('jitter.move', stepGesture(s, { kind: 'pointer-move', dx: 2, dy: 1 }, TH), { type: 'none' })
  check('jitter.move2', stepGesture(s, { kind: 'pointer-move', dx: -1, dy: 3 }, TH), { type: 'none' })
  check('jitter.up', stepGesture(s, { kind: 'up' }, TH), { type: 'click-end' })
}

// 3) 按下 + 窗口位移越阈：首帧返回 drag-begin（取消钓鱼），松手是 drag-end
{
  const s = newGestureState()
  stepGesture(s, { kind: 'down' }, TH)
  check('drag.begin', stepGesture(s, { kind: 'pointer-move', dx: 14, dy: 6 }, TH), { type: 'drag-begin' })
  check('drag.move1', stepGesture(s, { kind: 'pointer-move', dx: 15, dy: 8 }, TH), { type: 'none' })
  check('drag.move-back', stepGesture(s, { kind: 'pointer-move', dx: 0, dy: 0 }, TH), { type: 'none' })
  check('drag.up', stepGesture(s, { kind: 'up' }, TH), { type: 'drag-end' })
}

// 4) 阈值边界：位移恰好 = 阈值（5px）不算越界；超过 1px 才算
{
  const s = newGestureState()
  stepGesture(s, { kind: 'down' }, TH)
  check('boundary.equal', stepGesture(s, { kind: 'pointer-move', dx: 12, dy: 0 }, TH), { type: 'none' })
  check('boundary.over', stepGesture(s, { kind: 'pointer-move', dx: 0, dy: -13 }, TH), { type: 'drag-begin' })
}

// 5) 松手后的 move 必须被忽略（不残留拖窗）
{
  const s = newGestureState()
  stepGesture(s, { kind: 'down' }, TH)
  stepGesture(s, { kind: 'pointer-move', dx: 50, dy: 50 }, TH) // drag-begin
  stepGesture(s, { kind: 'up' }, TH) // drag-end
  check('after-up.move', stepGesture(s, { kind: 'pointer-move', dx: 999, dy: 999 }, TH), { type: 'none' })
}

// 6) 未按下时的 move 必须被忽略
{
  const s = newGestureState()
  check('no-down.move', stepGesture(s, { kind: 'pointer-move', dx: 50, dy: 50 }, TH), { type: 'none' })
}

// 7) 连续两次手势：第二次 down 必须复位 dragging 残留
{
  const s = newGestureState()
  stepGesture(s, { kind: 'down' }, TH)
  stepGesture(s, { kind: 'pointer-move', dx: 30, dy: 0 }, TH) // drag-begin
  stepGesture(s, { kind: 'up' }, TH) // drag-end
  check('second.down', stepGesture(s, { kind: 'down' }, TH), { type: 'fish-start' })
  check('second.jitter', stepGesture(s, { kind: 'pointer-move', dx: 1, dy: 1 }, TH), { type: 'none' })
  check('second.up', stepGesture(s, { kind: 'up' }, TH), { type: 'click-end' })
}

// 8) 未按下时 up 是空操作
{
  const s = newGestureState()
  check('no-down.up', stepGesture(s, { kind: 'up' }, TH), { type: 'reset' })
}

// 9) 蓄力按住期间手腕微抖（≤ 阈值）绝不误取消——这是"不能蓄力"回归的核心防线：
//    原生 app-region 拖拽对"按下 + 移动"极灵敏，阈值过小会把正常蓄力的手抖误判成拖窗。
{
  const s = newGestureState()
  stepGesture(s, { kind: 'down' }, TH)
  check('charge.jitter8', stepGesture(s, { kind: 'pointer-move', dx: 8, dy: 0 }, TH), { type: 'none' })
  check('charge.jitter11', stepGesture(s, { kind: 'pointer-move', dx: 0, dy: -11 }, TH), { type: 'none' })
  check('charge.up', stepGesture(s, { kind: 'up' }, TH), { type: 'click-end' })
}

console.log(`\ngesture-test: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
