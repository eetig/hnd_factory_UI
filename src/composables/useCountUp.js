import { onBeforeUnmount, ref, watch } from 'vue'

/**
 * 数字滚动（2026-10-18，变更-123）。
 *
 * 为什么值得有：一个「合计 6845」从 0 滚到 6845 用 700ms，读起来像是**数据到达了**；
 * 而直接闪现数字，看起来像"这页本来就是这些字"。这是唯一一种"动效让数字更好读"的场景。
 *
 * ## 三条边界
 *
 * 1. **只给"到达型"数字用**（合计、KPI）。表格里每一格都滚动是灾难 ——
 *    一屏 40 个数字同时跳，眼睛找不到落点。
 * 2. **尊重 `prefers-reduced-motion`**：直接给终值，不做过渡。
 * 3. **中途变化接着滚**（从当前显示值出发），不从头开始 —— 否则连点日期会把数字打回 0。
 *
 * @param {import('vue').Ref<number>} target 目标值
 * @param {{ duration?: number }} [options]
 * @returns {{ display: import('vue').Ref<number> }}
 */
export function useCountUp(target, options = {}) {
  const duration = options.duration ?? 700
  const display = ref(Number(target.value) || 0)

  let raf = 0
  let settleTimer = 0
  let from = display.value
  let startedAt = 0

  const prefersReduced = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // 三次方缓出：起步快、收尾稳。与全站 UI 曲线（ease-out）同族，不引入第二种节奏。
  const easeOut = (t) => 1 - (1 - t) ** 3

  function stop() {
    if (raf) cancelAnimationFrame(raf)
    if (settleTimer) clearTimeout(settleTimer)
    raf = 0
    settleTimer = 0
  }

  function run(to) {
    stop()
    const end = Number(to) || 0
    if (prefersReduced() || duration <= 0) {
      display.value = end
      return
    }
    from = display.value
    // 目标没变就别滚（否则每次父组件重算都会触发一次 700ms 过渡）
    if (from === end) return
    startedAt = performance.now()

    /*
     * 兜底：rAF 在后台标签页、省电模式、某些内嵌 WebView 里会被节流到几乎不跑。
     * 那时数字会**永远停在起点**（看起来像"没数据"），比没有动画糟得多。
     * 所以另起一个定时器，超过动画时长还没走完就直接落到终值 ——
     * 动画可以丢，数不能错。
     */
    settleTimer = setTimeout(() => {
      if (raf) {
        stop()
        display.value = end
      }
    }, duration + 80)

    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / duration)
      display.value = from + (end - from) * easeOut(t)
      if (t < 1) raf = requestAnimationFrame(tick)
      else raf = 0
    }
    raf = requestAnimationFrame(tick)
  }

  watch(target, (v) => run(v), { immediate: true })
  onBeforeUnmount(stop)

  return { display }
}
