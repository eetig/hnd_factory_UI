/**
 * 防抖执行器（变更-059）。
 *
 * 为什么需要它：这一代起，「输入框 → 服务端查询」是**实时**的（边打边查）。但逐字发
 * 请求会把接口打成筛子 —— 敲「HND-2171」是 8 次请求，其中 7 次的结果还没用上就被下
 * 一次盖掉了。防抖把「每次按键」换成「每次停顿」：最后一次输入之后 `delay` 毫秒才发。
 *
 * 三个动作，别只包一层 setTimeout 了事：
 *   · 调用（默认）—— 重置计时器（打字期间不发请求）；
 *   · `flush()`  —— 立刻发：回车 / 清空这类**明确的意图**不该再等 `delay` 毫秒；
 *   · `cancel()` —— 撤销待发的那次（组件卸载时用，避免卸载后仍有请求落地写状态）。
 *
 * ⚠️ 防抖**不能**代替「过期响应」处理：停顿之后连打两次仍会并发两个请求，谁先回来
 * 说不准，慢的那次会把新结果覆盖掉。数据层那边另有请求序号护栏 —— 见
 * `useMaterialStockData.js` 里的 `stockRequestSeq`。
 *
 * @param {Function} fn 要防抖的函数
 * @param {number} delay 静默多久才算「打完了」（毫秒）
 * @returns {Function & { flush: Function, cancel: Function }} 包装后的函数
 */
export function debounce(fn, delay = 250) {
  let timer = null

  const invoke = (...args) => {
    timer = null
    return fn(...args)
  }

  const wrapped = (...args) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(invoke, delay, ...args)
  }

  /** 立刻执行（并吃掉待发的那次）；返回值就是 fn 的返回值 */
  wrapped.flush = (...args) => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    return fn(...args)
  }

  /** 撤销待发的那次（fn 不会被调用） */
  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return wrapped
}
