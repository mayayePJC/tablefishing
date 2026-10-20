/**
 * 菜单布局截图探针：打开 设置 ▸ / BGM ▸ 三级菜单，截图并输出每层菜单的包围盒，
 * 用于诊断"三级菜单乱了"（溢出窗口 / 遮挡 / 错位）。
 * 用法：node scripts/menu-shot.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import fs from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9334
const URL_APP = 'file:///' + path.resolve('out/renderer/index.html').replace(/\\/g, '/')
const OUT = path.resolve('scripts/menu_shots')
fs.mkdirSync(OUT, { recursive: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--allow-file-access-from-files',
    '--hide-scrollbars',
    '--window-size=340,470',
    '--user-data-dir=' + path.resolve('.workbuddy/chrome-menu-shot'),
    URL_APP
  ],
  { stdio: 'ignore' }
)

let seq = 0
const pending = new Map()
let ws
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(200)
  }
  throw new Error('CDP 超时')
}

async function evalJs(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error')
  return r.result.value
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'))
  console.log('  wrote', `scripts/menu_shots/${name}.png`)
}

try {
  ws = new WebSocket(await connect())
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(1600)
  await evalJs(`localStorage.clear()`)

  // 打开工具菜单
  await evalJs(`
    (() => {
      const c = document.getElementById('game'); const r = c.getBoundingClientRect()
      const ev = (t) => c.dispatchEvent(new PointerEvent(t, { clientX: r.left + 318, clientY: r.top + 368, bubbles: true, pointerType: 'mouse', button: 0 }))
      ev('pointerdown'); ev('pointerup')
    })()
  `)
  await sleep(200)
  await shot('01-menu')

  // 展开设置（真实点击，触发 JS 纵向定位）
  await evalJs(`
    (() => {
      const b = [...document.getElementById('tools-menu').children].find(el => el.tagName === 'BUTTON' && el.textContent.startsWith('设置'))
      b.click()
    })()
  `)
  await sleep(200)
  await shot('02-settings')

  // 展开 BGM
  await evalJs(`
    (() => {
      const sub = document.getElementById('tools-submenu')
      const b = [...sub.children].find(el => el.tagName === 'BUTTON' && el.textContent.startsWith('BGM'))
      b.click()
    })()
  `)
  await sleep(200)
  await shot('03-bgm')

  // 包围盒诊断
  const boxes = await evalJs(`
    (() => {
      const pick = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
      }
      return {
        win: { w: innerWidth, h: innerHeight },
        menu: pick('#tools-menu'),
        sub: pick('#tools-submenu'),
        bgm: pick('#bgm-list'),
        items: [...document.querySelectorAll('#bgm-list > button')].map(b => {
          const r = b.getBoundingClientRect()
          return { t: b.textContent, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), right: Math.round(r.right) }
        })
      }
    })()
  `)
  console.log(JSON.stringify(boxes, null, 2))
} catch (e) {
  console.log('异常：', e.message)
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  chrome.kill()
  await sleep(300)
}
