/*
 * 统一页框尺寸（2026-11-18）
 *
 * 使用方要求：所有页面去掉带圆角容器的顶部栏、也不再用系统标题栏，
 * 只在最上方居中一行纯文字标题。于是页面要自己负责「状态栏高度」——
 * 以前这段高度由系统导航栏占着，现在必须让页面自己留出来。
 *
 * 这里把两个数字算一次、全站共用：
 *   --app-status-bar  状态栏高度（刘海/挖孔屏那一条）
 *   --app-title-h     状态栏 + 标题行的总高
 *
 * 为什么用 CSS 变量而不是每页各算一遍：页面里有 `height: 100vh` 的容器，
 * 标题加进来以后必须从 100vh 里扣掉标题高度；变量放根节点上，
 * 样式里写 `calc(100vh - var(--app-title-h))` 就自动跟着机型走。
 *
 * 2026-11-18 二次调整：使用方看真机截图后要求「标题再往上，贴到状态栏下面」。
 * 原来标题行按 iOS 导航栏 44px 居中，字实际落在状态栏下面 22px 处，显得空。
 * 现在把标题行压到 28px，并让行顶向上吃掉 12px 状态栏间距 ——
 * 字心正好贴住状态栏下沿，同时整块上移约 20px，给业务内容多让出一行。
 */
import { computed } from 'vue'

/** 标题文字所在那一行的高度（不含状态栏） */
export const TITLE_BAR_HEIGHT = 28

/** 标题行向上吃进状态栏内侧的距离：字心因此贴住状态栏下沿 */
export const TITLE_TOP_INSET = 12

/** 状态栏高度；H5 里可能是 0（浏览器没有状态栏），所以给兜底 */
export function getStatusBarHeight() {
  try {
    const info = uni.getSystemInfoSync()
    const value = Number(info && info.statusBarHeight)
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch (e) {
    return 0
  }
}

/** 标题行的顶部偏移与总高：PageTitle 与各页面的 100vh 扣减都读这两个数 */
export function getTitleBarMetrics() {
  const statusBar = getStatusBarHeight()
  const top = Math.max(0, statusBar - TITLE_TOP_INSET)
  return { statusBar, top, height: top + TITLE_BAR_HEIGHT }
}

/**
 * 页面根节点用：把两个尺寸变量挂到根节点 style 上。
 * 用法：`<view class="xx" :style="[themeVars, frameStyle]">`
 */
export function usePageFrame() {
  const metrics = getTitleBarMetrics()
  const frameStyle = computed(() => ({
    '--app-status-bar': metrics.statusBar + 'px',
    '--app-title-h': metrics.height + 'px',
  }))
  return { statusBar: metrics.statusBar, titleHeight: metrics.height, frameStyle }
}
