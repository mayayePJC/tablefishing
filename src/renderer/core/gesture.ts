/**
 * 身体区手势状态机（无 DOM 依赖，可单元测试）。
 *
 * 目标：同一块身体区域，既要「点一下 = 钓鱼」，又要「按住拖动 = 移动窗口」。
 * 原生 app-region:drag 会吞掉 pointerdown，无法在同一区域同时做到两者；因此拖窗改由
 * 渲染进程记录位移、经 IPC 调主进程 setPosition 完成（主进程 pet-drag 已就绪）。
 *
 * 判定：按下即开始钓鱼（蓄力）；位移超过阈值则取消钓鱼、转为拖窗。
 */

export interface GestureState {
  /** 指针是否正按在身体区 */
  active: boolean
  /** 是否已越过阈值、进入拖窗模式 */
  dragging: boolean
  /** 按下时的屏幕坐标 */
  downX: number
  downY: number
  /** 上一次 move 的屏幕坐标（用于算增量） */
  lastX: number
  lastY: number
}

export type BodyEvent =
  | { kind: 'down'; x: number; y: number }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'up' }

export type GestureResult =
  | { type: 'none' }
  | { type: 'fish-start' } // 按下：开始钓鱼按住（蓄力）
  | { type: 'begin-drag'; dx: number; dy: number } // 越过阈值：取消钓鱼并首帧移动窗口
  | { type: 'drag'; dx: number; dy: number } // 拖窗中：窗口位移增量
  | { type: 'reset' } // 松开：结束本次手势

export function newGestureState(): GestureState {
  return { active: false, dragging: false, downX: 0, downY: 0, lastX: 0, lastY: 0 }
}

/**
 * 推进状态机，返回调用方应执行的副作用。
 * @param threshold 判定为"拖窗"的位移阈值（屏幕像素）。
 */
export function stepGesture(s: GestureState, ev: BodyEvent, threshold: number): GestureResult {
  if (ev.kind === 'down') {
    s.active = true
    s.dragging = false
    s.downX = ev.x
    s.downY = ev.y
    s.lastX = ev.x
    s.lastY = ev.y
    return { type: 'fish-start' }
  }

  if (ev.kind === 'move') {
    if (!s.active) return { type: 'none' }
    if (!s.dragging) {
      const dx = ev.x - s.downX
      const dy = ev.y - s.downY
      if (dx * dx + dy * dy > threshold * threshold) {
        s.dragging = true
        const ddx = ev.x - s.downX
        const ddy = ev.y - s.downY
        s.lastX = ev.x
        s.lastY = ev.y
        return { type: 'begin-drag', dx: ddx, dy: ddy }
      }
      return { type: 'none' }
    }
    const dx = ev.x - s.lastX
    const dy = ev.y - s.lastY
    s.lastX = ev.x
    s.lastY = ev.y
    return { type: 'drag', dx, dy }
  }

  // up
  s.active = false
  s.dragging = false
  return { type: 'reset' }
}
