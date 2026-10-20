/**
 * overlayClose 单元测试：验证"点击内容区之外才关闭面板"的判定。
 * 运行：node --experimental-strip-types scripts/overlay-close-test.ts
 */
import { shouldCloseOverlay } from '../src/renderer/core/overlayClose.ts'
import type { OverlaySpec } from '../src/renderer/core/overlayClose.ts'

let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.error(`  ✗ ${name}`)
  }
}

// 伪造 DOM 节点 / 容器
const visible = (v: boolean) => ({ classList: { contains: (c: string) => c === 'visible' ? v : false } })
const container = (holds: boolean) => ({ contains: (_n: Node | null) => holds })

const targetInside = {} as Node
const targetOutside = {} as Node

const spec = (v: boolean, holds: boolean | null): OverlaySpec => ({
  overlay: visible(v),
  content: holds === null ? null : container(holds)
})

console.log('overlayClose 判定：')
check('面板不可见 → 不关闭', shouldCloseOverlay(spec(false, true), targetOutside) === false)
check('面板可见且无内容区 → 关闭', shouldCloseOverlay(spec(true, null), targetOutside) === true)
check('面板可见 + 点击在内容区内 → 不关闭', shouldCloseOverlay(spec(true, true), targetInside) === false)
check('面板可见 + 点击在内容区外 → 关闭', shouldCloseOverlay(spec(true, false), targetOutside) === true)
check('点击落点为 null 且不在内容区 → 关闭', shouldCloseOverlay(spec(true, false), null) === true)

// 真实场景：工具菜单（内容=菜单本体）展开子菜单，点击子菜单按钮不应关闭
const menu = { contains: (n: Node | null) => n === targetInside }
const toolsSpec: OverlaySpec = { overlay: visible(true), content: menu }
check('工具菜单可见 + 点子菜单按钮(在内容区内) → 不关闭', shouldCloseOverlay(toolsSpec, targetInside) === false)
check('工具菜单可见 + 点菜单外空白 → 关闭', shouldCloseOverlay(toolsSpec, targetOutside) === true)

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
if (fail > 0) process.exit(1)
