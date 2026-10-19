/**
 * 弹窗"点击外部关闭"的纯判定逻辑（无 DOM 依赖，可单元测试）。
 *
 * 规则：某面板只有在「可见」且「点击落点不在其内容区内」时才应被关闭。
 * 工具按钮的点击不在此处处理（由 Input 负责开关菜单），因此调用方在传入时
 * 已排除工具按钮，这里只判断"内容区之外"。
 */

export interface VisibleLike {
  classList: { contains: (cls: string) => boolean }
}
export interface ContainsLike {
  contains: (node: Node | null) => boolean
}

export interface OverlaySpec {
  overlay: VisibleLike | null
  content: ContainsLike | null
}

/**
 * 该弹窗是否应因"点在内容区之外"而关闭。
 * @param target 指针事件的 target（点击落点）
 */
export function shouldCloseOverlay(spec: OverlaySpec, target: Node | null): boolean {
  if (!spec.overlay || !spec.overlay.classList.contains('visible')) return false
  // 没有内容区参照 → 任意可见点击都关闭
  if (!spec.content) return true
  return !spec.content.contains(target)
}
