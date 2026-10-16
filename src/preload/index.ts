import { contextBridge, ipcRenderer } from 'electron'

// 渲染进程通过此桥与主进程通信（拖拽窗口、退出、调试）
contextBridge.exposeInMainWorld('fishingCodex', {
  version: '0.2.0',
  /** 拖拽窗口：传入屏幕像素增量 */
  drag: (dx: number, dy: number) => ipcRenderer.send('pet-drag', dx, dy),
  /** 退出桌宠 */
  quit: () => ipcRenderer.send('pet-quit'),
  /** 打开开发者工具 */
  openDevTools: () => ipcRenderer.send('pet-devtools'),
  /** 设置开机自启 */
  setAutostart: (on: boolean) => ipcRenderer.send('pet-autostart', on),
  /** 点击穿透：ignore=true 时窗口对鼠标"透明"（点击穿透到下方窗口）；
   *  配合 forward 选项，页面仍能在 mousemove 中感知指针位置，从而只在热点区恢复可交互。 */
  setClickThrough: (ignore: boolean) => ipcRenderer.send('pet-clickthrough', ignore)
})
