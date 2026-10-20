/** 身体手势：按下立即蓄力，DOM 捕获指针位移越阈才进入系统拖窗。
 * 普通长按不调用原生移窗，轻抖不改变窗口位置。 */

export interface GestureState {
  /** 指针是否正按在身体区 */
  active: boolean
  /** 指针位移是否已越过阈值、进入拖窗模式 */
  dragging: boolean
}

export type BodyEvent =
  | { kind: 'down' }
  /** 捕获指针相对按下点的 CSS 位移（尚未启动原生拖窗） */
  | { kind: 'pointer-move'; dx: number; dy: number }
  | { kind: 'up' }

export type GestureResult =
  | { type: 'none' }
  | { type: 'fish-start' } // 按下：开始钓鱼按住（蓄力）
  | { type: 'drag-begin' } // 指针位移越阈：取消钓鱼，此后视为拖窗
  | { type: 'click-end' } // 松手且未越阈：点击成立（普通钓鱼松手）
  | { type: 'drag-end' } // 松手且已越阈：拖窗结束
  | { type: 'reset' } // 松手但本就没有活动手势：空操作

export function newGestureState(): GestureState {
  return { active: false, dragging: false }
}

/**
 * 推进状态机，返回调用方应执行的副作用。
 * @param threshold 判定为"拖窗"的指针位移阈值（CSS 逻辑像素）。
 */
export function stepGesture(s: GestureState, ev: BodyEvent, threshold: number): GestureResult {
  if (ev.kind === 'down') {
    s.active = true
    s.dragging = false
    return { type: 'fish-start' }
  }

  if (ev.kind === 'pointer-move') {
    if (!s.active || s.dragging) return { type: 'none' }
    // 只有"指针明确移动越阈"才算拖窗；微抖（≤ 阈值）继续蓄力
    if (ev.dx * ev.dx + ev.dy * ev.dy > threshold * threshold) {
      s.dragging = true
      return { type: 'drag-begin' }
    }
    return { type: 'none' }
  }

  // up
  if (!s.active) return { type: 'reset' }
  s.active = false
  const dragging = s.dragging
  s.dragging = false
  return dragging ? { type: 'drag-end' } : { type: 'click-end' }
}
