/*
 * 统一页框尺寸（2026-11-18）
 *
 * 使用方要求：所有页面去掉带圆角容器的顶部栏、也不再用系统标题栏，
 * 只在最上方居中一行纯文字标题。于是页面要自己负责「状态栏高度」——
 * 以前这段高度由系统导航栏占着，现在必须让页面自己留出来。
 *
 * 这里把两个数字算一次、全站共用：
 *   --app-status-bar  状态栏高度（刘海/挖孔屏那一条）
 *   --app-title-h     状态栏 + 标题行（44px，iOS 导航栏的标准高度，安卓也够用）
 *
 * 为什么用 CSS 变量而不是每页各算一遍：页面里有 `height: 100vh` 的容器，
 * 标题加进来以后必须从 100vh 里扣掉标题高度；变量放根节点上，
 * 样式里写 `calc(100vh - var(--app-title-h))` 就自动跟着机型走。
 */
import { computed } from 'vue'

/** 标题行高度：与系统导航栏对齐，44px 是 iOS 的标准值 */
export const TITLE_BAR_HEIGHT = 44

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

/**
 * 页面根节点用：把两个尺寸变量挂到根节点 style 上。
 * 用法：`<view class="xx" :style="[themeVars, frameStyle]">`
 */
export function usePageFrame() {
  const statusBar = getStatusBarHeight()
  const titleHeight = statusBar + TITLE_BAR_HEIGHT
  const frameStyle = computed(() => ({
    '--app-status-bar': statusBar + 'px',
    '--app-title-h': titleHeight + 'px',
  }))
  return { statusBar, titleHeight, frameStyle }
}
