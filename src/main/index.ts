import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } from 'electron'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { T } from '../renderer/shared/constants'

// 启动优化：禁用原生窗口遮挡计算（透明 + alwaysOnTop 窗口可省去一次遮挡判定，缩短首屏延迟）
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.setAppUserModelId('com.fishingcodex.pet')

// 单实例：避免重复启动多个桌宠
const gotLock = app.requestSingleInstanceLock()
// forceQuit：只有「托盘退出 / 工具菜单退出」会置真；其余关闭一律改为隐藏（见 win.on('close')）
let forceQuit = false
let tray: Tray | null = null

if (!gotLock) {
  // 拿不到单实例锁：必须真正退出。先置 forceQuit，避免 before-quit 拦截把第二实例挂住。
  forceQuit = true
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    }
  })
}

/** 系统托盘：桌宠常驻 + 可靠的「显示/隐藏/退出」入口（截图或误关后再也不会"凭空消失"） */
function createTray(win: BrowserWindow): void {
  const iconPath = join(__dirname, '../../build/icon.ico')
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) return
  tray = new Tray(icon)
  tray.setToolTip('Fishing Cat · 钓鱼桌宠')
  const toggle = () => {
    if (win.isVisible()) win.hide()
    else {
      win.show()
      win.focus()
    }
  }
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: toggle },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        forceQuit = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', toggle)
}

// ---------- 窗口位置记忆：把窗口坐标存到 userData，下次启动直接恢复 ----------
function posFilePath(): string {
  return join(app.getPath('userData'), 'window-pos.json')
}
function loadPos(): { x: number; y: number } | null {
  try {
    const raw = readFileSync(posFilePath(), 'utf-8')
    const p = JSON.parse(raw)
    if (typeof p.x === 'number' && typeof p.y === 'number') return p
  } catch { /* 首次启动或文件损坏：返回 null，使用默认位置 */ }
  return null
}
function persistPos(win: BrowserWindow): void {
  try {
    const [x, y] = win.getPosition()
    writeFileSync(posFilePath(), JSON.stringify({ x: Math.round(x), y: Math.round(y) }))
  } catch { /* 忽略写入失败 */ }
}
/** 把坐标夹在主屏工作区内，避免记忆的位置跑到屏幕外（如换了显示器/分辨率） */
function clampToScreen(x: number, y: number): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workAreaSize
  const maxX = Math.max(0, area.width - T.VIEW_W)
  const maxY = Math.max(0, area.height - T.VIEW_H)
  return { x: Math.min(Math.max(0, Math.round(x)), maxX), y: Math.min(Math.max(0, Math.round(y)), maxY) }
}

// ---------- 开机自启：直接写注册表 Run 项（比 setLoginItemSettings 在免安装/未签名场景下更可靠） ----------
const AUTO_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const AUTO_RUN_NAME = 'FishingCatPet'
function setAutoStart(on: boolean): void {
  try {
    // 清掉 Electron 自带启动项（若此前用过 setLoginItemSettings），避免与注册表项重复触发
    app.setLoginItemSettings({ openAtLogin: false })
  } catch { /* ignore */ }
  const value = `"${app.getPath('exe')}"` // 路径含空格/中文，必须带引号
  const args = on
    ? ['add', AUTO_RUN_KEY, '/v', AUTO_RUN_NAME, '/t', 'REG_SZ', '/d', value, '/f']
    : ['delete', AUTO_RUN_KEY, '/v', AUTO_RUN_NAME, '/f']
  execFile('reg', args, (err) => {
    if (err) console.error('[pet] 设置开机自启失败:', err.message)
    else console.log('[pet] 开机自启已', on ? '开启' : '关闭')
  })
}

function createWindow(): void {
  const savedRaw = loadPos()
  const saved = savedRaw ? clampToScreen(savedRaw.x, savedRaw.y) : null
  const win = new BrowserWindow({
    width: T.VIEW_W,
    height: T.VIEW_H,
    // 恢复上次关闭时的位置（没有记录则使用默认位置）
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    resizable: false,
    // 必须可移动，否则 -webkit-app-region:drag 原生拖拽区域会被系统忽略（桌宠会"拖不动"）
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    show: false, // 先不显示，等 ready-to-show 再显示，消除白屏、加速"出现感"
    title: 'Fishing Cat · 钓鱼桌宠',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 拖窗（ghost-free 原生拖拽）：身体区是 app-region:drag，由 OS 合成器移动窗口。
  // 渲染进程按下身体时通知本进程"进入拖窗态"，期间 win 的 move 事件即代表用户在拖窗，
  // 转发给渲染进程用于"取消钓鱼"；松手再通知退出拖窗态。彻底避免手动 setPosition 在透明窗上的拖影。
  let bodyDragging = false
  ipcMain.on('pet-body-drag-begin', () => {
    bodyDragging = true
  })
  ipcMain.on('pet-body-drag-end', () => {
    bodyDragging = false
  })
  win.on('move', () => {
    if (bodyDragging) win.webContents.send('pet-body-moved')
  })
  ipcMain.on('pet-quit', () => {
    forceQuit = true
    app.quit()
  })
  ipcMain.on('pet-devtools', (e) => BrowserWindow.fromWebContents(e.sender)?.webContents.openDevTools())

  // 开机自启：写入/移除 Windows 注册表 Run 项
  ipcMain.on('pet-autostart', (_e, on: boolean) => {
    setAutoStart(!!on)
  })

  // 点击穿透：空闲时让窗口"透明"到鼠标（点击穿透到下方工作窗口），
  // 只有指针落在人物 / 工具按钮 / 钓鱼中 / 弹窗时才恢复可交互。
  // forward:true 让页面在忽略鼠标时仍能收到 mousemove，以便渲染进程实时判定热点。
  ipcMain.on('pet-clickthrough', (e, ignore: boolean) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w || w.isDestroyed()) return
    w.setIgnoreMouseEvents(!!ignore, { forward: true })
  })

  // 关键：截图工具 / 意外失焦常会隐藏透明置顶窗，或令渲染进程崩溃。
  // 把「关闭」改成「隐藏」——桌宠常驻，不再轻易退出；真正的退出只走
  // 托盘「退出」或工具菜单「退出」（会先置 forceQuit）。
  win.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()
      win.hide()
    }
  })
  // 渲染进程崩溃：自动重载恢复，而不是让整个应用退出
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[pet] 渲染进程异常:', details.reason)
    if (!forceQuit && !win.isDestroyed()) {
      setTimeout(() => {
        if (!win.isDestroyed()) win.reload()
      }, 400)
    }
  })

  // 锁定缩放因子，保证像素渲染不被 DPI 缩放干扰
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(1)
  })

  // 首屏就绪后再显示：透明窗口不再闪白，用户"点开即见"
  win.once('ready-to-show', () => win.show())

  createTray(win)

  // 窗口被拖动（原生 app-region 拖拽或 IPC 拖拽都会触发 move）时，防抖保存坐标 —— 下次启动直接还原
  let moveTimer: ReturnType<typeof setTimeout> | null = null
  win.on('move', () => {
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => persistPos(win), 300)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 截图工具 / 误触 / 系统事件可能触发 before-quit：除非是「托盘退出 / 工具菜单退出」(已置 forceQuit)，
// 否则一律拦截并收起窗口，应用继续驻留——桌宠绝不因截图而退出。
app.on('before-quit', (e) => {
  if (!forceQuit) {
    console.log('[pet] before-quit intercepted (not forceQuit) -> hide')
    e.preventDefault()
    const w = BrowserWindow.getAllWindows()[0]
    if (w && w.isVisible()) w.hide()
  } else {
    console.log('[pet] before-quit allowed (forceQuit=true)')
  }
})

// 安全网：某些系统事件会走到 will-quit，同样拦截非主动退出。
app.on('will-quit', (e) => {
  if (!forceQuit) {
    console.log('[pet] will-quit intercepted (not forceQuit) -> prevent')
    e.preventDefault()
  } else {
    console.log('[pet] will-quit allowed (forceQuit=true)')
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 关闭已改为「隐藏」，非主动退出时不真正退出（见 win.on('close')）
  if (forceQuit) {
    console.log('[pet] window-all-closed with forceQuit -> quit')
    app.quit()
  } else {
    console.log('[pet] window-all-closed without forceQuit -> stay alive')
  }
})
