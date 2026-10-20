import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { PetBridge } from './Game'

/**
 * 返回桌宠桥：自动识别运行环境。
 *  - Tauri 运行时（window.__TAURI_INTERNALS__ 存在）：用 @tauri-apps/api 的 invoke / listen 实现；
 *  - 否则（Electron）：沿用 window.fishingCodex（preload 注入），保持旧链路可用。
 * 这样同一份渲染代码可同时跑在 Electron 与 Tauri 两套外壳上，互不破坏。
 */
export function getPetBridge(): PetBridge | undefined {
  const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'
  if (!isTauri) {
    return (window as unknown as { fishingCodex?: PetBridge }).fishingCodex
  }

  return {
    bodyDragBegin: (gestureId) => {
      // 同一原生命令先记录手势基准，再启动系统拖窗，避免两次 IPC 的先后竞争。
      void invoke('body_drag_begin', { gestureId })
    },
    bodyDragEnd: (gestureId) => {
      void invoke('body_drag_end', { gestureId })
    },
    onBodyMoved: (cb) => {
      void listen<{ x: number; y: number; gestureId: number }>('body-moved', (e) => cb(e.payload))
    },
    onBodyReleased: (cb) => {
      void listen<{ x: number; y: number; gestureId: number }>('body-released', (e) => cb(e.payload))
    },
    snapBack: () => {
      void invoke('snap_back')
    },
    onPointerInit: (cb) => {
      void listen<{ x: number; y: number }>('pointer-init', (e) => cb(e.payload))
    },
    // Tauri 点击穿透没有 forward 模式，指针位置由 Rust 轮询线程持续上报
    onPointerMove: (cb) => {
      void listen<{ x: number; y: number }>('pointer-move', (e) => cb(e.payload))
    },
    markReady: () => {
      void invoke('mark_ready')
    },
    quit: () => {
      void invoke('quit')
    },
    // 调试构建才有开发者工具；这里统一做成空操作（渲染层本就不依赖它）
    openDevTools: () => {},
    setAutostart: (on: boolean) => {
      void invoke('set_autostart', { on })
    },
    setClickThrough: (ignore: boolean) => {
      void invoke('set_click_through', { ignore })
    },
    setInputRegions: (regions) => invoke('set_input_regions', { regions }),
    onStealthToggle: (cb) => {
      void listen('stealth-toggle', () => cb())
    },
    stealthShortcutInfo: () => invoke('stealth_shortcut_info'),
    musicFolderInfo: () => invoke('music_folder_info'),
    listLocalMusic: () => invoke('list_local_music'),
    importLocalMusic: (files) => invoke('import_local_music', { files }),
    readLocalMusic: (id) => invoke('read_local_music', { id }),
    removeLocalMusic: (id) => invoke('remove_local_music', { id })
  }
}
