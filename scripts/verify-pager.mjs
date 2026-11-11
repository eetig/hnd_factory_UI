#!/usr/bin/env node
/**
 * verify-pager.mjs —— 用 CDP 合成触摸，量「跟手翻页」的手感有没有退化。
 *
 * 用法（先跑起 dev server，并且让 Chrome 带调试端口打开页面）：
 *   chrome --remote-debugging-port=9222
 *   node scripts/verify-pager.mjs --cdp http://127.0.0.1:9222 --path meterRead
 *
 * 首次进去如果被踢回登录页，可以带 token 让它自己注入（token 用 /api/login 取）：
 *   node scripts/verify-pager.mjs --cdp http://127.0.0.1:9222 --path meterRead --token <token>
 *
 * 量五件事：
 *   1) 跟手比例：拖动 50px 时轨道应该也走 50px（1:1，没有阈值/阻尼）
 *   2) 松手落点：停稳后必须精确对齐整页（偏差 ≤ 0.06 页）
 *   3) 快甩跨页：用力甩一次至少跨 3 页
 *   4) 滑行时长：0.9 ~ 2.9 秒之间（太短=被"推一把"，太长=发黏）
 *   5) DOM 页数：滑行中同时挂着的页 ≤ 7（38 张全挂会掉帧）
 *
 * 只依赖 Node 22+ 内置的 fetch / WebSocket，不装任何包。
 */

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const CDP = arg('cdp', 'http://127.0.0.1:9222').replace(/\/$/, '')
const PATH_HINT = arg('path', 'meterRead')
const TOKEN = arg('token', '')
const TRACK = arg('track', '.mr__track, .gp__track')
const PAGE = arg('page', '.mr__page, .gp__page')
const STAGE = arg('stage', '.mr__stage, .gp')
const PROGRESS = arg('progress', '.mr__progress, .mr__progress-text')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickTarget() {
  const res = await fetch(`${CDP}/json/list`)
  const text = await res.text()
  if (!text.trim().startsWith('[')) {
    throw new Error(`${CDP}/json/list 返回的不是 CDP 列表 —— 这个端口不是浏览器调试端口（vite 的 9092 不是，要用 chrome --remote-debugging-port 开出来的那个）`)
  }
  const list = JSON.parse(text)
  const page = list.find((t) => t.type === 'page' && t.url.includes(PATH_HINT))
  if (!page) throw new Error(`没找到包含 "${PATH_HINT}" 的页面，先在那个浏览器里打开它`)
  return page
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', (e) => reject(new Error(`CDP 连接失败：${e?.message || e}`)))
  })
}

let seq = 0
const pending = new Map()

function send(ws, method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP 超时：${method}`))
      }
    }, 15000)
  })
}

async function evalJs(ws, expression) {
  const res = await send(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || '页面脚本抛错')
  return res.result?.value
}

/** 合成一次拖拽：返回每一步的轨道位移 */
async function drag(ws, { from, steps, stepGap, holdMs }) {
  const setup = await evalJs(
    ws,
    `(() => {
      const stage = document.querySelector(${JSON.stringify(STAGE)});
      if (!stage) return null;
      const r = stage.getBoundingClientRect();
      window.__vp = { stage, y: Math.round(r.top + r.height / 2), x: ${from} };
      const mk = (x) => new Touch({ identifier: 7, target: stage, clientX: x, clientY: window.__vp.y });
      window.__vp.mk = mk;
      window.__vp.fire = (type, x) => stage.dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [mk(x)],
        changedTouches: [mk(x)],
        bubbles: true, cancelable: true,
      }));
      window.__vp.fire('touchstart', window.__vp.x);
      return { width: Math.round(r.width) };
    })()`,
  )
  if (!setup) throw new Error(`页面上没找到拖动区域（${STAGE}）`)

  const samples = []
  for (const dx of steps) {
    await evalJs(ws, `window.__vp.fire('touchmove', window.__vp.x - (${dx}))`)
    await sleep(stepGap)
    const tx = await evalJs(
      ws,
      `(() => { const t = document.querySelector(${JSON.stringify(TRACK)}); const m = /translate3d\\((-?[\\d.]+)px/.exec(t.style.transform || getComputedStyle(t).transform); return m ? Number(m[1]) : null; })()`,
    )
    samples.push({ dx, tx })
  }
  if (holdMs) await sleep(holdMs)
  return { width: setup.width, samples }
}

async function release(ws) {
  await evalJs(ws, `window.__vp.fire('touchend', window.__vp.x)`)
}

async function readState(ws) {
  return evalJs(
    ws,
    `(() => {
      const t = document.querySelector(${JSON.stringify(TRACK)});
      const m = /translate3d\\((-?[\\d.]+)px/.exec(t.style.transform || getComputedStyle(t).transform);
      const stage = document.querySelector(${JSON.stringify(STAGE)});
      const prog = document.querySelector(${JSON.stringify(PROGRESS)});
      return {
        tx: m ? Number(m[1]) : null,
        width: Math.round(stage.getBoundingClientRect().width),
        pages: document.querySelectorAll(${JSON.stringify(PAGE)}).length,
        progress: prog ? prog.textContent.replace(/\\s+/g, ' ').trim() : '',
        cardAnimating: !!document.querySelector('.mr__card'),
      };
    })()`,
  )
}

function pageIndexOf(progress) {
  const m = /^(\d+)\s*\/\s*(\d+)/.exec(progress)
  return m ? Number(m[1]) : null
}

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : '—'
}

async function main() {
  const target = await pickTarget()
  const ws = await connect(target.webSocketDebuggerUrl)
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    const job = msg.id && pending.get(msg.id)
    if (!job) return
    pending.delete(msg.id)
    if (msg.error) job.reject(new Error(msg.error.message))
    else job.resolve(msg.result)
  })

  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')

  if (TOKEN) {
    // 注入登录态（token 由 /api/login 取），再整页重载，避免停在登录页
    await evalJs(
      ws,
      `(() => {
        localStorage.setItem('token', ${JSON.stringify(TOKEN)});
        localStorage.setItem('roleKey', 'admin');
        localStorage.setItem('roleName', '管理员');
        localStorage.setItem('permissions', '[]');
        location.reload();
        return true;
      })()`,
    )
    await sleep(3500)
  }

  const before = await readState(ws)
  const W = before.width
  console.log(`页面宽度 ${W}px，起始 ${before.progress || '（无进度文本）'}`)

  // ---- 1) 跟手比例：拖 50px ----
  const d1 = await drag(ws, { from: Math.round(W * 0.8), steps: [10, 25, 50], stepGap: 45 })
  const last = d1.samples[d1.samples.length - 1]
  const baseTx = d1.samples[0].tx
  const follow = baseTx !== null && last.tx !== null ? Math.abs((last.tx - baseTx) / (last.dx - d1.samples[0].dx)) : NaN
  await release(ws)
  await sleep(700)
  const settled1 = await readState(ws)
  const dev1 = settled1.tx !== null ? Math.abs(settled1.tx / W - Math.round(settled1.tx / W)) : NaN

  // ---- 2) 快甩：200px / 3 帧 ----
  const startIdx = pageIndexOf(settled1.progress) || 1
  const t0 = Date.now()
  const d2 = await drag(ws, { from: Math.round(W * 0.85), steps: [70, 140, 200], stepGap: 16 })
  await release(ws)
  await sleep(300)
  const mid = await readState(ws)
  await sleep(2600)
  const elapsed = (Date.now() - t0) / 1000
  const settled2 = await readState(ws)
  const endIdx = pageIndexOf(settled2.progress) || startIdx
  const dev2 = settled2.tx !== null ? Math.abs(settled2.tx / W - Math.round(settled2.tx / W)) : NaN

  const rows = [
    ['跟手比例（1:1 应为 1.00）', fmt(follow), Math.abs(follow - 1) <= 0.02 ? 'PASS' : 'FAIL'],
    ['慢拖后落点偏差（页）', fmt(dev1, 3), Number.isFinite(dev1) && dev1 <= 0.06 ? 'PASS' : 'FAIL'],
    ['快甩跨页数', String(endIdx - startIdx), endIdx - startIdx >= 3 ? 'PASS' : 'FAIL'],
    ['快甩后落点偏差（页）', fmt(dev2, 3), Number.isFinite(dev2) && dev2 <= 0.06 ? 'PASS' : 'FAIL'],
    ['滑行+吸附时长（秒）', fmt(elapsed, 2), elapsed >= 0.9 && elapsed <= 2.9 ? 'PASS' : 'FAIL'],
    ['滑行中 DOM 页数', String(mid.pages), mid.pages > 0 && mid.pages <= 7 ? 'PASS' : 'FAIL'],
  ]

  const width = Math.max(...rows.map((r) => r[0].length)) + 2
  console.log('\n' + '-'.repeat(width + 20))
  for (const [name, value, verdict] of rows) {
    console.log(`${name.padEnd(width)} ${String(value).padStart(8)}   ${verdict}`)
  }
  console.log('-'.repeat(width + 20))

  const failed = rows.filter((r) => r[2] === 'FAIL')
  if (failed.length) {
    console.log(`\n${failed.length} 项不达标。常见原因：拖动被阈值/阻尼拦住（跟手≠1）、`)
    console.log('松手没做收尾吸附（落点偏差>0）、滑行距离系数太小（跨页少）、')
    console.log('或每帧都在读布局/重建表单（DOM 页数多、时长异常）。')
    process.exitCode = 1
  } else {
    console.log('\n六项全部通过。')
  }
  ws.close()
}

main().catch((err) => {
  console.error(`验证失败：${err.message}`)
  process.exitCode = 2
})
