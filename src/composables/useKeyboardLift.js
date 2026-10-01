import { onUnmounted, ref } from 'vue'

/**
 * 底部弹层里的输入框被软键盘盖住时，要抬起来多少（px）。
 *
 * <p>为什么必须自己抬：弹层是 `position: fixed` 的，而 uni `<input>` 的
 * `adjust-position`（默认开）只会滚动**页面** —— 对 fixed 元素一点作用都没有，
 * 于是键盘一弹就把弹层里的搜索框盖住，只露出标题那一行。
 *
 * <p>各端都提供了键盘高度事件（App / 小程序），拿到高度后把它变成弹层的
 * `padding-bottom`：弹层贴着屏幕底边，垫出这么高，内容就被顶到键盘上沿之上。
 * H5 没有这个事件 —— 但 H5 的浏览器自己会缩视口，本来就不需要抬。
 *
 * <p>用法：弹层打开时 `start()`，关闭时 `stop()`（不要在组件挂载时一直开着 ——
 * 监听是全局的，多个弹层同时挂着会互相覆盖）。
 */
export function useKeyboardLift() {
  const keyboardHeight = ref(0)

  const handleChange = (res) => {
    keyboardHeight.value = Number(res?.height) || 0
  }

  // H5 端没有这个 API，直接退化成「不抬」
  const supported = typeof uni.onKeyboardHeightChange === 'function'

  function start() {
    if (!supported) return
    uni.onKeyboardHeightChange(handleChange)
  }

  function stop() {
    keyboardHeight.value = 0
    if (!supported) return
    // 有的端没实现 off，缺了也只是多一个空转的回调，不该因此报错
    uni.offKeyboardHeightChange?.(handleChange)
  }

  onUnmounted(stop)

  return { keyboardHeight, start, stop }
}
