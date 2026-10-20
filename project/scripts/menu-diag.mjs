/**
 * 菜单溢出诊断：输出二级菜单的 scrollHeight / clientHeight，判断是否真的需要滚动。
 * 用法：node scripts/menu-diag.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import fs from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9335
const VW = 340
const VH = 390
const OUT = path.resolve('scripts/menu_shots')
fs.mkdirSync(OUT, { recursive: true })
const URL_APP = 'file:///' + path.resolve('out/renderer/index.html').replace(/\\/g, '/')

const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--allow-file-access-from-files',
   `--window-size=${VW},${VH}`,
   '--user-data-dir=' + path.resolve('.workbuddy/chrome-menu-diag'), URL_APP],
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
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p) return p.webSocketDebuggerUrl
    } catch { /* wait */ }
    await sleep(200)
  }
  throw new Error('CDP 超时')
}

const evalJs = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error')
  return r.result.value
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
  // 视口锁成真实桌宠尺寸 340×390（headless 的 --window-size 会被浏览器边框吃掉，必须用 emulation 覆盖）
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false })
  await sleep(1600)
  await evalJs(`localStorage.clear()`)

  // 截图：把 emulation 高度临时放大到 1200，让整块菜单都渲染出来，截图后按 340×390 裁剪。
  // 放大期间必须把高度基准钉死（100vh → 390px），否则窗口尺寸元素会跟着放大后的视口重排，
  // 截到的就不是真实画面了。窗口本身是透明的，390 以下的内容在桌面上根本不存在。
  const PIN_H = `
    (() => {
      for (const el of document.querySelectorAll('html, body, #stage')) {
        el.style.setProperty('height', '390px', 'important')
        el.style.setProperty('min-height', '390px', 'important')
        el.style.setProperty('max-height', '390px', 'important')
      }
    })()
  `
  const shot = async (name) => {
    await send('Emulation.setDeviceMetricsOverride', { width: VW, height: 1200, deviceScaleFactor: 1, mobile: false })
    await evalJs(PIN_H)
    await sleep(320)
    let r
    try {
      r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    } finally {
      await evalJs(`
        for (const el of document.querySelectorAll('html, body, #stage')) {
          el.style.removeProperty('height'); el.style.removeProperty('min-height'); el.style.removeProperty('max-height')
        }
      `)
      await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false })
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'))
    console.log('  wrote', `scripts/menu_shots/${name}.png`)
  }
  const state = async (tag) => {
    const s = await evalJs(`
      (() => {
        const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null
          const r = el.getBoundingClientRect()
          return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom) } }
        const sub = document.getElementById('tools-submenu')
        return { tag: ${JSON.stringify(tag)}, winH: innerHeight,
          menu: pick('#tools-menu'), sub: pick('#tools-submenu'), bgm: pick('#bgm-list'),
          scrollH: sub ? sub.scrollHeight : 0, clientH: sub ? sub.clientHeight : 0,
          maxH: sub ? getComputedStyle(sub).maxHeight : '',
          lift: document.getElementById('tools-menu').style.getPropertyValue('--menu-lift') }
      })()
    `)
    console.log(JSON.stringify(s))
    return s
  }

  await evalJs(`
    (() => {
      const c = document.getElementById('game'); const r = c.getBoundingClientRect()
      const ev = (t) => c.dispatchEvent(new PointerEvent(t, { clientX: r.left + 318, clientY: r.top + 368, bubbles: true, pointerType: 'mouse', button: 0 }))
      ev('pointerdown'); ev('pointerup')
    })()
  `)
  await sleep(200)
  await state('menu')
  await evalJs(`[...document.getElementById('tools-menu').children].find(el => el.tagName==='BUTTON' && el.textContent.startsWith('设置')).click()`)
  await sleep(250)
  await state('settings')
  await evalJs(`[...document.getElementById('tools-submenu').children].find(el => el.tagName==='BUTTON' && el.textContent.startsWith('BGM')).click()`)
  await sleep(300)
  await state('bgm')
  await shot('diag-340x390')

  const diag = await evalJs(`
    (() => {
      const sub = document.getElementById('tools-submenu')
      const cs = getComputedStyle(sub)
      const btns = [...sub.children].filter(el => el.tagName === 'BUTTON')
      return {
        winH: innerHeight,
        maxH: cs.maxHeight,
        overflowY: cs.overflowY,
        lastBtn: (() => { const b = btns[btns.length-1]; const br = b.getBoundingClientRect(); return { t: b.textContent, y: Math.round(br.y), bottom: Math.round(br.bottom) } })(),
        bgmItems: [...document.querySelectorAll('#bgm-list > button')].map(b => {
          const r = b.getBoundingClientRect()
          return { t: b.textContent, x: Math.round(r.x), w: Math.round(r.width), scrollW: b.scrollWidth, bottom: Math.round(r.bottom) }
        })
      }
    })()
  `)
  console.log(JSON.stringify(diag, null, 2))
} catch (e) {
  console.log('异常：', e.message)
} finally {
  try { ws?.close() } catch {}
  chrome.kill()
  await sleep(300)
}
