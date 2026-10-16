/**
 * 构建前自动结束运行中的 FishingCat 进程，并等待 dist 下的 exe 文件句柄释放。
 *
 * 为什么需要它：桌宠运行时占用了 dist/FishingCat.exe，重新打包要覆盖该文件，
 * 必须先把旧进程结束、等系统释放句柄，否则 electron-builder 无法写入。
 * 把这一步放进 `predist`，用户就再也不用自己去任务管理器手动结束了。
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const EXE = 'FishingCat.exe'
const exePath = path.join(__dirname, '..', 'dist', EXE)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1) 结束进程（没有该进程时 taskkill 会报错，忽略即可）
  try {
    execSync('taskkill /f /im ' + EXE, { stdio: 'ignore', windowsHide: true })
    console.log('[kill-before-build] 已结束运行中的 ' + EXE)
  } catch {
    // 进程不存在 / 非 Windows 环境，忽略
  }

  // 2) 轮询等待 exe 可被写入（句柄释放），最多 ~5 秒
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (!fs.existsSync(exePath)) break
    try {
      const fd = fs.openSync(exePath, 'r+')
      fs.closeSync(fd)
      break
    } catch {
      // 仍被占用，稍候重试
      await sleep(200)
    }
  }
}

main()
