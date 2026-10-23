/**
 * 圆形揭露转场（Circular Reveal）—— 2026-10-23，变更-170 第三版。
 *
 * ## 使用方指出的真问题（这是设计口径，不是性能问题）
 *
 *   「圆圈切换的时候，用**要切换的主题**去扩散」
 *
 * 前两版的错：
 *   ① 先画一个**旧底色**的圆、铺满之后才切主题 ⇒ 看起来是"一个圈慢慢扩开、然后整屏跳一下"，
 *      感官上就是卡；圈里滚的根本不是新东西。
 *   ② 我当时把"卡"归因给 View Transitions 的快照，其实那正是**唯一能实现正确观感**的机制：
 *      VT 的 new(root) 快照里就是**新主题**，用 `clip-path: circle()` 裁一下 ——
 *      圆扩到哪里，新主题就露到哪里，中间没有硬切。
 *
 * 所以这一版：
 *   · **有 VT 就走 VT**（默认），`apply()` 放在 VT 回调里 ⇒ 快照即新主题 ✓
 *   · 没有 VT（老 WebView / 小程序）⇒ 退化成"**新主题底色**的圆扩散"，铺满后再真正切换
 *     （此刻整屏已被圆盖住，切换看不出来）—— 圆里滚的是新主题的颜色，不是旧的
 *
 * 几何仍是使用方口径：圆心 = **按钮中心**；半径 = 到**四个角**最远距离（保证铺满）。
 *
 * ## 关于"只动 transform / opacity"这条
 *
 * `ui-taste` §4 要求只动 transform / opacity。本效果的主路径动的是 `clip-path`
 * —— 这是**有意的例外**，理由一句话：主题切换需要"新界面从按钮里长出来"，
 * 而裁切快照是唯一能表达这件事的手段（换成 scale 一层纯色，圆里滚的就不是真界面）。
 * 退化路径（无 VT）仍然遵守该规则：那层用 `transform: scale()`。
 * 时长/缓动按 skill 的区间取（320ms / ease-out），并且尊重 `prefers-reduced-motion`。
 *
 * 开关：`?noVT=1` 直接无动画切（现场排查用）。
 */
/**
 * 时长 320ms —— 按 `ui-taste` 的 motion 区间定的：
 *   · 状态切换 200–300ms、页面/弹层 300–500ms；主题切换属于**状态切换**，
 *     取两个区间的交界 320ms：既看得出"从按钮长出来"，又不拖。
 *   · 之前用 480/520ms 偏"页面级"，使用方反馈"感官上很卡"——
 *     全屏裁切每多 100ms，掉帧就多几帧。
 */
export const REVEAL_DURATION = 320

/**
 * 是否允许播放动画。
 *
 * `ui-taste` §2 把这条列为**硬性**：任何超出 hover/press 的动效都必须尊重
 * `prefers-reduced-motion`，并且退化为静止。这里是全屏裁切，量级远超 hover ⇒ 必须遵守。
 */
export function prefersReducedMotion() {
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}

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

/** 只有 `?noVT=1` 才跳过动画；其余情况优先 VT（观感正确比省一次快照重要） */
export function readRevealMode(search) {
  try {
    const params = new URLSearchParams(search ?? globalThis.location?.search ?? '')
    if (params.get('noVT') === '1') return 'none'
  } catch {
    /* ignore */
  }
  return 'auto'
}

/**
 * 没有 VT 时的退化路径：画一个**新主题底色**的圆放大铺满，铺满后再执行切换。
 * @param {{cx:number, cy:number, radius:number}} geo
 */
function playOverlayCircle(geo, duration, targetColor) {
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
  // ★ 关键：用**目标主题**的底色，而不是当前主题的
  style.background = targetColor || 'var(--hnd-reveal-color, #ffffff)'
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
 *
 * @param {object} options
 * @param {() => void} options.apply 真正切主题的操作（同步）
 * @param {Element} [options.originElement] 圆形扩散的起点（按钮）
 * @param {string} [options.targetColor] 没有 VT 时，圆用什么颜色扩散（= 目标主题的纸色）
 * @param {number} [options.duration]
 * @param {string} [options.mode] 覆盖 URL 开关（测试用）
 * @returns {Promise<'view-transition' | 'overlay' | 'no-anim'>}
 */
export async function circularRevealSwitch({
  apply,
  originElement,
  targetColor,
  duration = REVEAL_DURATION,
  mode,
}) {
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

  const resolvedMode = mode || readRevealMode()
  // 减弱动效 / 显式关闭 / 没有起点 ⇒ 直接切（无障碍硬性要求）
  if (resolvedMode === 'none' || prefersReducedMotion() || !originElement) {
    applyOnce()
    return 'no-anim'
  }

  /*
   * 看门狗：VT 回调/ready 卡住时也要切（applyOnce 幂等）。
   * 这是"点了没反应"从设计上消失的保证 —— 切换永远不依赖动画链路是否顺利。
   */
  const watchdog = setTimeout(() => applyOnce(), 200)

  const geometry = revealGeometry(originElement.getBoundingClientRect(), {
    width: globalThis.innerWidth || 0,
    height: globalThis.innerHeight || 0,
  })
  if (!geometry) {
    clearTimeout(watchdog)
    applyOnce()
    return 'no-anim'
  }

  /*
   * ★ 首选：View Transitions。
   * apply() 在回调里同步执行 ⇒ new 快照就是**新主题**；再把 new(root) 用
   * clip-path: circle() 从小裁到大 —— 圆扩到哪，新主题露到哪，没有硬切。
   */
  if (typeof globalThis.document?.startViewTransition === 'function') {
    try {
      const transition = globalThis.document.startViewTransition(() => {
        applyOnce()
      })
      await transition.ready
      const from = `circle(0px at ${geometry.cx}px ${geometry.cy}px)`
      const to = `circle(${geometry.radius}px at ${geometry.cx}px ${geometry.cy}px)`
      const anim = globalThis.document.documentElement.animate(
        { clipPath: [from, to] },
        { duration, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' },
      )
      /*
       * ⚠️ 不要 `await anim.finished`（2026-10-23 实测）：
       * 伪元素动画的 finished 在部分情况下**永远不 resolve**，于是调用方的 busy 一直为 true，
       * 表现就是"第一次点有效、第二次点没反应"。改成定时器等一个确定的时长。
       */
      try {
        anim?.finished?.catch?.(() => {})
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, duration + 60))
      clearTimeout(watchdog)
      applyOnce()
      return 'view-transition'
    } catch {
      // 掉到退化路径（apply 可能已经执行过，applyOnce 保证不会重复）
    }
  }

  try {
    await playOverlayCircle(geometry, duration, targetColor)
  } catch {
    /* 动画失败不影响切换 */
  }
  clearTimeout(watchdog)
  applyOnce()
  return 'overlay'
}
