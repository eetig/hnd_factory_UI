/*
 * 左侧边缘右滑（2026-11-18）
 *
 * 顶栏的三横线取消后，抽屉没了看得见的入口。使用方选择「左侧边缘右滑打开抽屉」，
 * 做法与系统返回手势同一套逻辑：从屏幕最左边往里推、横向位移够大、纵向不明显漂移。
 *
 * 为什么不用一个 fixed 的感应条盖在左边缘：
 *   1) 那会吃掉左边缘的点击（列表里的按钮、底栏箭头都可能被挡住）；
 *   2) 加 `.prevent` 会挡住从边缘开始的纵向滚动，长列表会变涩。
 *   所以只是在页面根节点被动监听 touchstart/touchend，不改任何默认行为。
 *
 * 为什么只判 touchend 不给拖拽反馈：抽屉本身是 wd-popup，弹出时有自己的动画；
 * 手指从边缘推一下、松手、抽屉滑出，这个节奏和微信一致，也最省事。
 */
import { ref } from 'vue'

export function useEdgeSwipe(onTrigger, options = {}) {
  const { edgeWidth = 30, minDistance = 56, maxDrift = 50 } = options
  const startX = ref(0)
  const startY = ref(0)
  const tracking = ref(false)

  function onTouchStart(event) {
    const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0])
    if (!touch) return
    // 只认从最左边开始的那一下，屏幕中间的横滑交给页面自己的滑动组件
    if (touch.clientX > edgeWidth) {
      tracking.value = false
      return
    }
    startX.value = touch.clientX
    startY.value = touch.clientY
    tracking.value = true
  }

  function onTouchEnd(event) {
    if (!tracking.value) return
    tracking.value = false
    const touch = (event.changedTouches && event.changedTouches[0]) || (event.touches && event.touches[0])
    if (!touch) return
    const dx = touch.clientX - startX.value
    const dy = Math.abs(touch.clientY - startY.value)
    if (dx >= minDistance && dy <= maxDrift) {
      onTrigger()
    }
  }

  return { onTouchStart, onTouchEnd }
}
