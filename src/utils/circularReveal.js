/**
 * 圆形揭露转场（Circular Reveal）—— 2026-10-23，变更-170 续（性能版）。
 *
 * ## 为什么从 View Transitions 换成"自己画一层小圆"
 *
 * 使用方反馈「不行，体验不好，特别卡」。两条实测原因：
 *   ① VT 每次切换要给**整页拍快照**（页面有 27 行表格 + 侧栏），那一下就是明显掉帧；
 *   ② 原来的圆按"直径 = 2 × 半径"建（1280×720 上约 2700px），
 *      几百万像素一片实色、又没提升为合成层 ⇒ 每帧重绘整屏。
 *
 * 现在的做法：
 *   · 一个 **固定 240px** 的小圆，用 `transform: scale(k)` 放大到铺满 ——
 *     光栅化面积小两个数量级，缩放走合成器（GPU）
 *   · `will-change: transform` + `backface-visibility: hidden` 明确提升为合成层
 *   · 不拍快照、不动文档结构
 *
 * ## 圆的几何（仍是使用方的口径）
 *   圆心 = **按钮中心**（不是屏幕中心）；半径 = 圆心到**四个角**的最远距离（保证铺满）
 *
 * ## 顺序
 *   **先把圆铺满，再真正切主题**：切换引起的整页重排发生在圆盖住之后，看不到掉帧。
 *   反过来（一边动画一边重排）正是"特别卡"的来源之一。
 *
 * 开关：`?vt=1` 用回 View Transitions（对比用）；`?noVT=1` 直接无动画切。
 */
export const REVEAL_DURATION = 520

/** 小圆的基准直径（CSS px）：放大倍数 = 目标直径 / 这个值 */
export const BASE_CIRCLE_PX = 240

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
  const radius = Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy))
  if (!Number.isFinite(radius) || radius <= 0) return null

  return { cx, cy, radius }
}

/** URL 开关：?vt=1 用 View Transitions，?noVT=1 直接切 */
export function readRevealMode(search) {
  try {
    const params = new URLSearchParams(search ?? globalThis.location?.search ?? '')
    if (params.get('noVT') === '1') return 'none'
    if (params.get('vt') === '1') return 'view-transition'
  } catch {
    /* ignore */
  }
  return 'overlay'
}

/**
 * 画一层会放大的小圆，铺满后 resolve。
 * @param {{cx:number, cy:number, radius:number}} geo
 * @param {number} duration
 */
function playOverlayCircle(geo, duration) {
  const { cx, cy, radius } = geo
  const base = BASE_CIRCLE_PX
  const scale = (radius * 2) / base
  const doc = globalThis.document
  if (!doc?.body) return Promise.resolve()

  const circle = doc.createElement('div')
  circle.setAttribute('aria-hidden', 'true')
  circle.dataset.hndReveal = '1'
  const style = circle.style
  style.position = 'fixed'
  style.zIndex = '9999'
  style.left = `${cx - base / 2}px`
  style.top = `${cy - base / 2}px`
  style.width = `${base}px`
  style.height = `${base}px`
  style.borderRadius = '50%'
  // 底色取新主题的纸色（CSS 变量由调用方/主题层提供），铺满瞬间不会整屏跳
  style.background = 'var(--hnd-reveal-color, #ffffff)'
  style.pointerEvents = 'none'
  style.transformOrigin = 'center center'
  style.willChange = 'transform'
  style.backfaceVisibility = 'hidden'
  style.transform = 'translateZ(0) scale(0)'
  doc.body.appendChild(circle)

  const anim = circle.animate(
    [{ transform: 'translateZ(0) scale(0)' }, { transform: `translateZ(0) scale(${scale})` }],
    { duration, easing: 'ease-out', fill: 'forwards' },
  )

  const cleanup = () => circle.remove()
  return (anim.finished || Promise.resolve())
    .then(cleanup)
    .catch(() => {
      cleanup()
    })
}

/**
 * 切主题 + 圆形揭露。
 * @param {object} options
 * @param {() => void} options.apply 真正切主题的操作（同步）
 * @param {Element} [options.originElement] 圆形扩散的起点（按钮）
 * @param {number} [options.duration]
 * @param {string} [options.mode] 覆盖 URL 开关（测试用）
 * @returns {Promise<'overlay' | 'view-transition' | 'no-anim'>}
 */
export async function circularRevealSwitch({ apply, originElement, duration = REVEAL_DURATION, mode }) {
  const applySafe = () => {
    try {
      apply()
    } catch {
      // 配色是纯视觉，切失败也不该把页面搞死
    }
  }

  const resolvedMode = mode || readRevealMode()
  if (resolvedMode === 'none' || !originElement) {
    applySafe()
    return 'no-anim'
  }

  const geometry = revealGeometry(originElement.getBoundingClientRect(), {
    width: globalThis.innerWidth || 0,
    height: globalThis.innerHeight || 0,
  })
  if (!geometry) {
    applySafe()
    return 'no-anim'
  }

  // 可选：View Transitions（?vt=1），代价是整页快照
  if (
    resolvedMode === 'view-transition' &&
    typeof globalThis.document?.startViewTransition === 'function'
  ) {
    try {
      const transition = globalThis.document.startViewTransition(() => {})
      await transition.ready
      const from = `circle(0px at ${geometry.cx}px ${geometry.cy}px)`
      const to = `circle(${geometry.radius}px at ${geometry.cx}px ${geometry.cy}px)`
      const anim = globalThis.document.documentElement.animate(
        { clipPath: [from, to] },
        { duration, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' },
      )
      try {
        await anim?.finished
      } catch {
        /* ignore */
      }
      applySafe()
      return 'view-transition'
    } catch {
      // 落到 overlay
    }
  }

  try {
    await playOverlayCircle(geometry, duration)
  } catch {
    /* 动画失败不影响切换 */
  }
  applySafe()
  return 'overlay'
}
