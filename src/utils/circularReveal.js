/**
 * 圆形揭露转场（Circular Reveal）—— 2026-10-23，变更-170。
 *
 * 点主题按钮时，以**按钮中心**为圆心把新配色铺满全屏。使用方定的口径：
 *   · 圆心 = 按钮 getBoundingClientRect 的中心，**不是屏幕中心**；
 *   · 优先 View Transitions API（原生顺滑）；
 *   · 不支持该 API、或取不到按钮 / 算不出半径 → **无动画直接切**（不许报错卡死）；
 *   · ease-out，520ms。
 *
 * ## 为什么半径是"到最远角"
 *
 * 圆铺满视口要求 r ≥ 圆心到**四个角**里最远的那个距离。只按高度算会在宽屏上
 * 露出没铺到的两角（那种"差一条缝"的过渡最显廉价）。
 *
 * ## 为什么先 await transition.ready 再 animate
 *
 * `startViewTransition` 的回调执行完、新快照 ready 之后，`::view-transition-new(root)`
 * 这个伪元素才存在；提前 animate 会拿到 null。
 *
 * @param {object} options
 * @param {() => void} options.apply 真正切主题的操作（同步）
 * @param {Element} [options.originElement] 圆形扩散的起点（按钮）
 * @param {number} [options.duration]
 * @returns {Promise<'view-transition' | 'no-anim'>}
 */
export const REVEAL_DURATION = 520

/** 圆心与半径（纯函数，便于单测；任何非法输入返回 null，调用方据此降级） */
export function revealGeometry(rect, viewport) {
  if (!rect || !viewport) return null
  const { left, top, width, height } = rect
  if (![left, top, width, height].every((n) => Number.isFinite(n))) return null
  if (width <= 0 || height <= 0) return null

  const vw = viewport.width
  const vh = viewport.height
  if (!(vw > 0) || !(vh > 0)) return null

  const cx = left + width / 2
  const cy = top + height / 2

  // 到四个角的最远距离：保证圆一定铺满整屏
  const radius = Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy))
  if (!Number.isFinite(radius) || radius <= 0) return null

  return { cx, cy, radius }
}

export async function circularRevealSwitch({ apply, originElement, duration = REVEAL_DURATION }) {
  const fallback = () => {
    try {
      apply()
    } catch {
      // 切换本身失败也不能把页面搞死；配色是纯视觉，宁可不变
    }
    return 'no-anim'
  }

  // 没有按钮 / 没有 VT / 浏览器不支持 animate ⇒ 直接切
  const startViewTransition = globalThis.document?.startViewTransition
  if (!originElement || typeof startViewTransition !== 'function') return fallback()

  const geometry = revealGeometry(originElement.getBoundingClientRect(), {
    width: globalThis.innerWidth || 0,
    height: globalThis.innerHeight || 0,
  })
  if (!geometry) return fallback()

  const { cx, cy, radius } = geometry
  const from = `circle(0px at ${cx}px ${cy}px)`
  const to = `circle(${radius}px at ${cx}px ${cy}px)`

  // apply 只许生效一次：VT 被跳过 / ready 被拒 / animate 抛错时，兜底路径还会再调一次
  let applied = false
  const applyOnce = () => {
    if (applied) return
    applied = true
    try {
      apply()
    } catch {
      // 配色是纯视觉，切失败也不该把页面搞死
    }
  }

  try {
    const transition = startViewTransition(() => {
      applyOnce()
    })

    // ready 之后 new(root) 才存在；rejected 也别抛到调用方
    await transition.ready

    const anim = globalThis.document.documentElement.animate(
      { clipPath: [from, to] },
      {
        duration,
        easing: 'ease-out',
        pseudoElement: '::view-transition-new(root)',
      },
    )
    // 动画跑完，VT 自己收尾；这里只兜"中途被打断"
    anim?.finished?.catch?.(() => {})
    return 'view-transition'
  } catch {
    // VT 抛错（老内核、被打断、被跳过）：保证主题仍然切了，只是没有动画
    applyOnce()
    return 'no-anim'
  }
}
