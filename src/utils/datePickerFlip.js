/*
 * 日期面板翻页滑动动效（变更-040）。
 *
 * 使用方 2026-10-11：「滑动日历的动画要丝滑」。变更-039 的滚轮翻页已通，但 EP 换月是
 * **同步硬切**（date-picker 编译产物全目录零 Transition，表格原位 patch）。本模块让翻页
 * 整幅滑过去：旧内容截一张「幽灵」快照，新表格从 dir×W 滑入、幽灵反向滑出，
 * 260ms easeOutQuint，**只动 transform**（合成器层，不触发布局与重绘 —— 这是「丝滑」的关键）。
 *
 * 为什么是 document 级 capture 的 click 委托：
 *   · 面板 teleport 到 body，组件级钩子够不着（与 变更-039 同一条理由）；
 *   · 四个翻页箭头是原生 <button> + onClick，capture 阶段先于 EP 的换月跑 —— 这是**唯一**
 *     能克隆到旧内容的窗口（EP 是原位 patch，微任务之后 DOM 就是新月份了，拿不回旧的）；
 *   · 滚轮翻页（datePickerWheel.js）走的是程序化 .click()，同一个 click 会路过这里 ——
 *     一处监听同时覆盖「滚轮 + 手点箭头 + 键盘 Enter」三条路径。
 *     ⚠️ 因此绝不能筛 `event.isTrusted`（程序化 click 非 trusted，筛了会静默废掉滚轮路径）。
 *
 * 为什么用 WAAPI 而不是加 CSS：仓库没有可复用的动效 token；WAAPI 不碰任何 CSS 文件、
 * 不需要给 EP 的节点挂类、动画句柄可 cancel（连翻要打断旧动画）、不依赖 animationend 兜底。
 * 这是全仓第一处 WAAPI（缓动体例参照 WorkOrderList 的 vesselFrame：easeOut 系、起步快收尾缓）。
 *
 * 「减少动态效果」逃逸是**必须**的（全仓既定无障碍规范，见 LoadingMask / glass-effects：
 * 大幅位移是前庭不适的触发源）—— 动画在 JS 模块里，逃逸就必须在同一个模块里，
 * 靠 matchMedia 判定；命中时翻页照常，只是不滑。
 *
 * 月/年视图里的双箭头（.d-arrow-*）同样走这条动画，是刻意的统一，不是 bug。
 *
 * 防闪三件套（缺一实机就能看到「首帧新月份全显 + 旧月份叠字」或「收尾跳位」）：
 *   ① capture 时刻就把**内联起始位**写上（表格 translateX(dir×W)、幽灵 translateX(0)）——
 *      免疫「动画 servicing 与 rAF 回调」的先后差异，动画解析前画出的就是起始位姿；
 *   ② 动画 fill:'forwards' 压住终态（默认 fill:'none' 一结束，内联起始位就会复活）；
 *   ③ 收尾在**同一同步块里**「清内联 transform + cancel()」—— 浏览器不在 JS 块中重算样式。
 */

const PANEL_SELECTOR = '.el-picker-panel.el-date-picker'
const CONTENT_SELECTOR = '.el-picker-panel__content'
const ARROW_SELECTOR = '.arrow-left, .arrow-right, .d-arrow-left, .d-arrow-right'

/*
 * 三个手感常数，嫌快 / 嫌慢就调这里：
 *   FLIP_MS      —— 单程时长（与 WorkOrderList 的 .vessel-step 260ms 同档）
 *   FLIP_EASING  —— easeOutQuint：起步快、收尾极缓，「丝滑」感主要来自它
 *   CLEANUP_SLACK —— 兜底定时器余量（面板被 v-show 藏起 / 后台 tab 时间线节流时，
 *                    finished 可能迟到，兜底负责收尾）
 * 位移量不在这里 —— 取 content.clientWidth 实宽（has-sidebar 变体是 438，不写死 292）。
 */
const FLIP_MS = 260
const FLIP_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)'
const CLEANUP_SLACK = 300

let uninstall = null

/** content → 本次翻页的状态（Map 而不是 WeakMap：卸载时要能遍历收尾） */
const states = new Map()

function isReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** 收尾：摘幽灵、还原 overflow 与内联 transform、清 rAF/timer/动画（同一同步块，见头注释 ③） */
function dispose(content) {
  const state = states.get(content)
  if (!state) return
  states.delete(content)

  if (state.rafId) cancelAnimationFrame(state.rafId)
  if (state.timer) clearTimeout(state.timer)
  state.animTable?.cancel()
  state.animGhost?.cancel()
  state.table.style.transform = ''
  state.ghost.remove()
  content.style.overflow = state.prevOverflow // 精确还原（含空串）
  content.scrollLeft = 0
  content.scrollTop = 0
}

/** 收尾入口带 token 校验：旧一轮动画的 finished 迟到时，不许拆掉新一轮的状态 */
function finish(state) {
  if (states.get(state.content) !== state) return
  dispose(state.content)
}

/** 起动画（rAF 里跑：此时 Vue 的微任务 patch 已完成，表格已是新月份） */
function startFlip(state) {
  state.rafId = 0
  if (states.get(state.content) !== state) return // 已被更新的一次翻页接管

  const { content, table, ghost, w, dir } = state
  const dist = dir * w
  // EP 的表格 watch 会在换月后重聚焦单元格（focus 无 preventScroll），可能把裁切窗顶偏，先归零
  content.scrollLeft = 0
  content.scrollTop = 0

  const options = { duration: FLIP_MS, easing: FLIP_EASING, fill: 'forwards' }
  state.animTable = table.animate(
    [{ transform: `translateX(${dist}px)` }, { transform: 'translateX(0)' }],
    options,
  )
  state.animTable.finished.catch(() => {}) // 连翻打断时 finished 以 AbortError 拒绝，吞掉
  state.animGhost = ghost.animate(
    [{ transform: 'translateX(0)' }, { transform: `translateX(${-dist}px)` }],
    options,
  )
  state.animGhost.finished.then(
    () => finish(state),
    () => {}, // 被 cancel：收尾由「接管的那一轮」或卸载负责
  )
  state.timer = setTimeout(() => finish(state), FLIP_MS + CLEANUP_SLACK) // 兜底
}

function onClick(event) {
  const target = event.target
  if (!target || typeof target.closest !== 'function') return

  // 只认面板头部的翻页箭头。点击本身**放行** —— EP 要靠这个事件换月（不 stopPropagation / preventDefault）
  const arrow = target.closest(ARROW_SELECTOR)
  if (!arrow) return
  const panelEl = arrow.closest(PANEL_SELECTOR)
  if (!panelEl) return // daterange 根类是 el-date-range-picker，天然排除（与滚轮模块同口径）

  const content = panelEl.querySelector(CONTENT_SELECTOR)
  if (!content) return
  const table = content.querySelector('table') // 不用 firstElementChild，多一层升版抗性
  if (!table) return

  // 逃逸与降级，都在建幽灵之前判掉（翻页功能本身不受影响，只是不滑）
  if (typeof table.animate !== 'function') return // jsdom / 无 WAAPI 的老内核
  if (isReducedMotion()) return
  const w = content.clientWidth // 实宽，见 FLIP_MS 注释
  if (!w) return // 面板不可见

  const dir = arrow.matches('.arrow-right, .d-arrow-right') ? 1 : -1

  // 重入（连翻：滚轮冷却 150ms < 260ms 动画，必然重叠）：先收掉上一轮。
  // overflow 原值**只认链路起点** —— 否则第二次会把 'hidden' 记成「原值」永久残留
  const prevOverflow = states.get(content)?.prevOverflow ?? content.style.overflow
  dispose(content)
  // 保险丝：若上一轮的幽灵因任何原因还挂在 content 里（如动画中切视图），一并清掉
  content.querySelectorAll('[data-flip-ghost]').forEach((el) => el.remove())

  const ghost = table.cloneNode(true)
  ghost.setAttribute('data-flip-ghost', '') // 探针按这个属性识别幽灵
  ghost.setAttribute('aria-hidden', 'true')
  ghost.querySelectorAll('[tabindex]').forEach((el) => el.removeAttribute('tabindex')) // 旧选中格的 tabindex 不复制进来
  ghost.style.position = 'absolute'
  ghost.style.top = '0'
  ghost.style.left = '0'
  ghost.style.right = '0'
  ghost.style.bottom = '0'
  ghost.style.margin = '0'
  ghost.style.pointerEvents = 'none'
  ghost.style.zIndex = '1' // 两页在裁切窗里严丝合缝拼接，这里只为确定性
  ghost.style.transform = 'translateX(0)' // 防闪①

  content.appendChild(ghost)
  content.style.overflow = 'hidden' // 裁切窗：只看见两页在窗内并排滑过
  table.style.transform = `translateX(${dir * w}px)` // 防闪①：新表格也从起始位开始

  const state = {
    content,
    table,
    ghost,
    animTable: null,
    animGhost: null,
    rafId: 0,
    timer: 0,
    w,
    dir,
    prevOverflow,
  }
  states.set(content, state)
  state.rafId = requestAnimationFrame(() => startFlip(state))
}

/**
 * 装上「日历翻页滑动动效」。重复调用不会装第二条（返回同一个卸载函数）。
 *
 * @returns {() => void} 卸载函数（生产不用；测试收尾）
 */
export function installDatePickerFlip() {
  if (uninstall) return uninstall

  document.addEventListener('click', onClick, { capture: true })

  uninstall = () => {
    document.removeEventListener('click', onClick, { capture: true })
    for (const content of [...states.keys()]) dispose(content)
    uninstall = null
  }
  return uninstall
}
