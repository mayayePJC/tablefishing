/**
 * BGM 菜单端到端探针（Chrome headless + CDP，真实视口 340×390）：
 *   1) 启动后「设置 ▸」子菜单里有「BGM：钓鱼音效」
 *   2) 展开 BGM → 就地展开 4 项（钓鱼音效 + Spring/Summer/Fall），层级不横向溢出
 *   3) 点 Spring → 标签变、该项金边高亮、存档 bgm=spring
 *   4) 再点 Spring → 关闭（回到钓鱼音效），存档 bgm=null
 *   5) 点 Summer → 切歌；点「钓鱼音效」→ 关闭
 *   6) 刷新页面 → 恢复上次曲目
 *   7) 三级菜单展开后，二级菜单底边仍在窗口内（「退出」不被顶出窗口）
 * 用法：node scripts/bgm-menu-test.mjs   （需先 npm run build）
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9333
const VW = 340
const VH = 390
const URL_APP = 'file:///' + path.resolve('out/renderer/index.html').replace(/\\/g, '/')

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${VW},${VH}`,
    '--user-data-dir=' + path.resolve('.workbuddy/chrome-bgm-test'),
    URL_APP
  ],
  { stdio: 'ignore' }
)

let seq = 0
const pending = new Map()
let ws

function send(method, params = {}, sessionId) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(200)
  }
  throw new Error('CDP 连接超时')
}

async function evalJs(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise,
    userGesture: true
  })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails))
  return r.result.value
}

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) {
    pass++
    console.log(`  ✓ ${msg}`)
  } else {
    fail++
    console.log(`  ✗ ${msg}`)
  }
}

/** 打开工具菜单（点画布右下角汉堡按钮），等覆盖层可见 */
const OPEN_MENU = `
  (() => {
    const c = document.getElementById('game')
    const r = c.getBoundingClientRect()
    const ev = (type) => c.dispatchEvent(new PointerEvent(type, {
      clientX: r.left + 318, clientY: r.top + 368, bubbles: true, pointerType: 'mouse', button: 0
    }))
    ev('pointerdown'); ev('pointerup')
    return new Promise((res) => setTimeout(() => res(!!document.querySelector('#tools-overlay.visible')), 120))
  })()
`

/** 读 BGM 相关状态（标签 / 各曲目文案 / 选中态 / 各级包围盒） */
const READ_STATE = `
  (() => {
    const sub = document.getElementById('tools-submenu')
    const list = document.getElementById('bgm-list')
    const bgmBtn = sub ? [...sub.children].find((el) => el.tagName === 'BUTTON' && el.textContent.startsWith('BGM')) : null
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { y: Math.round(r.y), bottom: Math.round(r.bottom), right: Math.round(r.right), w: Math.round(r.width) }
    }
    const save = localStorage.getItem('fishing-codex-save-v1')
    return {
      label: bgmBtn ? bgmBtn.textContent : '',
      open: list ? list.classList.contains('visible') : false,
      items: list ? [...list.children].map((b) => ({ t: b.textContent, active: b.classList.contains('active') })) : [],
      saved: save ? JSON.parse(save).bgm : '<none>',
      win: { w: innerWidth, h: innerHeight },
      subBox: box(sub),
      listBox: box(list),
      lastBtn: (() => {
        if (!sub) return null
        const bs = [...sub.children].filter((el) => el.tagName === 'BUTTON')
        return bs.length ? { t: bs[bs.length - 1].textContent, ...box(bs[bs.length - 1]) } : null
      })()
    }
  })()
`

try {
  const wsUrl = await connect()
  ws = new WebSocket(wsUrl)
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })
  await new Promise((res) => ws.addEventListener('open', res, { once: true }))
  await send('Runtime.enable')
  await send('Page.enable')
  // 锁成真实桌宠视口（headless 的 --window-size 会被浏览器边框吃掉）
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false })
  await sleep(1500)

  console.log('BGM 菜单端到端探针')

  // 0) 清存档，刷新页面拿到干净状态
  await evalJs(`localStorage.clear()`)
  await send('Page.reload')
  await sleep(1800)

  // 1) 打开工具菜单
  ok(await evalJs(OPEN_MENU, true), '点击汉堡按钮后工具菜单打开')

  const labels = await evalJs(`[...document.querySelectorAll('#tools-submenu > button')].map((b) => b.textContent).join(' | ')`)
  ok(labels.includes('BGM'), `「设置」子菜单含 BGM 入口（${labels || '空'}）`)

  // 2) 展开设置 → 展开 BGM（两次点击分开到不同帧，等价于真人操作）
  await evalJs(
    `[...document.getElementById('tools-menu').children].find((el) => el.tagName === 'BUTTON' && el.textContent.startsWith('设置')).click()`
  )
  await sleep(180)
  await evalJs(
    `[...document.getElementById('tools-submenu').children].find((el) => el.tagName === 'BUTTON' && el.textContent.startsWith('BGM')).click()`
  )
  await sleep(260)
  const s1 = await evalJs(READ_STATE)
  ok(s1.open, 'BGM 曲目列表就地展开')
  ok(s1.items.length === 4, `BGM 列表 4 项（实际 ${s1.items.length}：${s1.items.map((i) => i.t).join(' / ')}）`)
  ok(s1.items[0].t === '钓鱼音效', `第一项是「钓鱼音效」（${s1.items[0].t}）`)
  ok(s1.items[1].t.includes('大千世界'), `第二项是春季主题（${s1.items[1].t}）`)
  ok(s1.items[2].t.includes('自然的渐强') && s1.items[3].t.includes('乌鸦降临'), '含夏季 / 秋季曲目')
  ok(s1.items[0].active, '默认选中「钓鱼音效」')

  // 布局：三级展开后仍在窗口内，且不横向溢出
  ok(s1.listBox && s1.listBox.right <= s1.win.w, `三级列表未横向溢出（right=${s1.listBox?.right} ≤ ${s1.win.w}）`)
  ok(s1.subBox && s1.subBox.bottom <= s1.win.h, `二级菜单未纵向溢出（bottom=${s1.subBox?.bottom} ≤ ${s1.win.h}）`)
  ok(s1.lastBtn && s1.lastBtn.bottom <= s1.win.h, `「${s1.lastBtn?.t}」完整可见（bottom=${s1.lastBtn?.bottom}）`)

  // 3) 点 Spring → 播放
  const afterSpring = await evalJs(`
    (() => {
      document.querySelectorAll('#bgm-list > button')[1].click()
      return true
    })()
  `)
  ok(afterSpring, '点击春季曲目')
  const s2 = await evalJs(READ_STATE)
  ok(s2.label.includes('大千世界'), `BGM 标签跟随（${s2.label}）`)
  ok(s2.items[1].active && !s2.items[0].active, '春季项高亮、钓鱼音效取消高亮')
  ok(s2.saved === 'spring', `存档 bgm=spring（${s2.saved}）`)

  // 4) 再点同一首 → 关闭
  await evalJs(`document.querySelectorAll('#bgm-list > button')[1].click()`)
  const s3 = await evalJs(READ_STATE)
  ok(s3.label === 'BGM：钓鱼音效', `再点同一首 → 回到钓鱼音效（${s3.label}）`)
  ok(s3.items[0].active, '「钓鱼音效」恢复高亮')
  ok(s3.saved === null, `存档 bgm=null（${JSON.stringify(s3.saved)}）`)

  // 5) 切 Summer → 点「钓鱼音效」关闭
  await evalJs(`document.querySelectorAll('#bgm-list > button')[2].click()`)
  const s4 = await evalJs(READ_STATE)
  ok(s4.label.includes('自然的渐强'), `切到夏季曲目（${s4.label}）`)
  await evalJs(`document.querySelectorAll('#bgm-list > button')[0].click()`)
  const s5 = await evalJs(READ_STATE)
  ok(s5.label === 'BGM：钓鱼音效', `点「钓鱼音效」关闭 BGM（${s5.label}）`)
  ok(s5.saved === null, '关闭后存档 bgm=null')

  // 6) 选 Spring 后刷新 → 恢复
  await evalJs(`document.querySelectorAll('#bgm-list > button')[1].click()`)
  await send('Page.reload')
  await sleep(1800)
  await evalJs(OPEN_MENU, true)
  const restored = await evalJs(`
    (() => {
      const menu = document.getElementById('tools-menu')
      ;[...menu.children].find((el) => el.tagName === 'BUTTON' && el.textContent.startsWith('设置')).click()
      const sub = document.getElementById('tools-submenu')
      const bgmBtn = [...sub.children].find((el) => el.tagName === 'BUTTON' && el.textContent.startsWith('BGM'))
      return bgmBtn ? bgmBtn.textContent : ''
    })()
  `)
  ok(restored.includes('大千世界'), `刷新后恢复上次曲目（${restored}）`)

  // 7) 播放调度期间无未捕获错误（等 ~1.6s，约 3 拍）
  await sleep(1600)
  const errors = await evalJs(`window.__errors ? window.__errors.length : 0`)
  ok(errors === 0, '页面无未捕获错误（含播放期间）')

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
} catch (e) {
  console.log('探针异常：', e.message)
  fail++
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  chrome.kill()
  await sleep(300)
  process.exit(fail > 0 ? 1 : 0)
}
