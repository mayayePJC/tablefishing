/** 玩家实体：站位 + 动画姿态（姿态帧由控制器驱动，渲染层读取） */
export type PlayerPose = 'idle' | 'cast' | 'reel' | 'show'

export class Player {
  pose: PlayerPose = 'idle'
  /** cast 姿态帧 0..2 */
  frame = 0

  constructor(
    public x: number,
    public footY: number
  ) {}

  setPose(pose: PlayerPose, frame = 0): void {
    this.pose = pose
    this.frame = frame
  }
}
