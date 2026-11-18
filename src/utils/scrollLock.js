/**
 * 全屏滚动锁（2026-11-18）
 *
 * 为什么不用 wd-popup 自带的 lock-scroll：
 * 它只做了一件事 —— 把 body 的 overflow 设成 hidden
 * （见 node_modules/wot-design-uni/components/composables/useLockScroll.ts）。
 * 但页面真正的滚动容器在 App 的 webview / 部分安卓浏览器里是 html（或页面容器），
 * 只锁 body 挡不住手指在遮罩上的拖动 —— 用户实测：弹窗开着，手指在遮罩上划，
 * 底下页面照样滚，而且不是某一个弹窗的问题，是所有弹窗都有。
 *
 * 这里用「把 body 定住」的老办法：记下当前 scrollY，body 设成 position: fixed
 * 并向上平移同样的距离 —— 视觉上页面一动不动，但物理上已经不可滚动；
 * 解锁时把样式原样还回去，再滚回原来的位置（不然关掉弹窗会跳回顶部）。
 *
 * 计数是为了「弹窗套弹窗」：关掉上面那层，不能把下面那层还需要的锁一起解开。
 *
 * 小程序端没有 document，直接 no-op —— 那边靠遮罩的 catchtouchmove 兜底。
 */

let count = 0

/** 锁之前记下的原地状态，解锁时逐项还原 */
let saved = null

function restore(style, snapshot) {
  if (!snapshot) return
  Object.keys(snapshot).forEach((key) => {
    style[key] = snapshot[key]
  })
}

export function lockPageScroll() {
  if (typeof document === 'undefined' || !document.body) return
  count += 1
  if (count > 1 || saved) return

  const body = document.body
  const html = document.documentElement
  const y = window.scrollY || window.pageYOffset || html.scrollTop || 0

  saved = {
    y,
    body: {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      overscrollBehavior: body.style.overscrollBehavior
    },
    html: {
      overflow: html.style.overflow,
      overscrollBehavior: html.style.overscrollBehavior
    }
  }

  html.style.overflow = 'hidden'
  html.style.overscrollBehavior = 'none'

  body.style.position = 'fixed'
  body.style.top = `-${y}px`
  body.style.left = '0'
  body.style.right = '0'
  body.style.width = '100%'
  body.style.overflow = 'hidden'
  body.style.overscrollBehavior = 'none'
}

export function unlockPageScroll() {
  if (typeof document === 'undefined' || !document.body) return
  if (count === 0) return
  count -= 1
  if (count > 0 || !saved) return

  const body = document.body
  const html = document.documentElement
  const { y, body: bodyStyle, html: htmlStyle } = saved
  saved = null

  restore(body.style, bodyStyle)
  restore(html.style, htmlStyle)

  // 还原固定定位后再滚回去，顺序反了会滚在「还固定着」的页面上，白滚
  window.scrollTo(0, y)
}

/** 给测试 / 极端情况用：把计数清零并解锁 */
export function resetPageScrollLock() {
  count = 0
  if (!saved) return
  const body = document.body
  const html = document.documentElement
  const { y, body: bodyStyle, html: htmlStyle } = saved
  saved = null
  restore(body.style, bodyStyle)
  restore(html.style, htmlStyle)
  window.scrollTo(0, y)
}
