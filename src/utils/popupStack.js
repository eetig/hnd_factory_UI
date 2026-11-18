/**
 * 全局浮层守卫（2026-11-18，第二轮）
 *
 * 解决的是「返回手势打错人」：手机上从屏幕边缘往里滑 = 返回手势，
 * 页面把它当成「开左侧抽屉」。可是弹窗开着的时候，人想关的是弹窗，
 * 结果抽屉从旁边滑出来，弹窗还杵在那儿。
 *
 * 口径（使用方定的优先级，从高到低）：
 *   1. 有弹窗 → 只关最上面那层弹窗，不碰抽屉、不退出页面；
 *   2. 没弹窗、抽屉开着 → 关抽屉；
 *   3. 都没有 → 交给页面（首页是「开抽屉」，其它页是「返回上一页」）。
 *
 * 为什么弹窗用**栈**：弹窗能叠（详情里再点编辑、详情里再开送货单来源），
 * 一次返回只该关掉用户眼前那层，布尔记不住「现在最上面是谁」。
 * 为什么抽屉**不进栈**、单独一个布尔：抽屉永远在最底下、独占一层，
 * 它开着的时候不可能同时有更深的抽屉；用一个布尔比往栈里塞一个特例更直白。
 *
 * 用法：
 *   - 弹窗：用 `<AppPopup v-model="x">`，它自己 push/pop，业务代码不用管；
 *     自绘浮层（拍照来源、改读数）调 `pushPopup(id, close)` / `removePopup(id)`。
 *   - 抽屉：`setDrawerOpen(true/false)` + `bindDrawerClose(fn)`（首页调用一次）。
 *   - 页面：`onBackPress(() => handleGlobalBack() !== 'root')`，其余什么都不用写。
 *
 * 本文件不依赖任何页面，App / H5 都能用。uni-app 的 App 端没有「边缘滑动」独立
 * 事件，系统返回手势最终就是 onBackPress —— 所以「全局判断」落在这里，
 * 页面只剩一行调用。
 */
import { ref } from 'vue'

const stack = ref([])
const drawerOpen = ref(false)

/** 谁负责关抽屉（首页把 closeMenu 绑进来，其它页没有抽屉、不绑） */
let drawerClose = null

/** 只读给调试用 */
export const popupStack = stack
export const drawerVisible = drawerOpen

/**
 * 记一层弹窗。
 * 同 id 会先摘掉旧的再压栈 —— 防止同一个弹窗被连点两次、在栈里留两份，
 * 那样用户要按两下返回才能关掉一个弹窗。
 */
export function pushPopup(id, close) {
  if (!id || typeof close !== 'function') return
  stack.value = stack.value.filter((item) => item.id !== id)
  stack.value.push({ id, close })
}

/** 弹窗自己关掉了（点关闭、点遮罩、点保存后自动关）都要摘掉 */
export function removePopup(id) {
  if (!id) return
  stack.value = stack.value.filter((item) => item.id !== id)
}

export function hasPopup() {
  return stack.value.length > 0
}

/**
 * 关掉最上面那层，返回是否真的关了一层。
 * 先把栈顶摘掉再调关闭函数：有些弹窗的关闭会触发 @close / watch 里的 removePopup，
 * 若顺序反了会重复摘一次（虽然幂等，但先摘更能保证「一次返回只关一层」）。
 */
export function closeTopPopup() {
  const top = stack.value[stack.value.length - 1]
  if (!top) return false
  removePopup(top.id)
  try {
    top.close()
  } catch (e) {
    // 关不掉也不能把返回手势卡死：这一下就当已经消费掉了
    console.warn('[overlay] 关闭弹窗失败', e)
  }
  return true
}

/* ===== 抽屉 ===== */

export function setDrawerOpen(value) {
  drawerOpen.value = !!value
}

/** 首页把「关抽屉」的动作绑进来，守卫层不直接依赖 index.vue */
export function bindDrawerClose(fn) {
  drawerClose = typeof fn === 'function' ? fn : null
}

export function closeDrawer() {
  setDrawerOpen(false)
  if (drawerClose) {
    try {
      drawerClose()
    } catch (e) {
      console.warn('[overlay] 关闭抽屉失败', e)
    }
  }
}

/* ===== 统一判断 ===== */

/**
 * 返回手势的唯一入口。
 *
 * @returns {'popup'|'drawer'|'root'} 消费掉了哪一层；`root` 表示没人接，
 *          交给页面自己决定（首页开抽屉，其它页返回上一页）。
 */
export function handleGlobalBack() {
  if (closeTopPopup()) return 'popup'
  if (drawerOpen.value) {
    closeDrawer()
    return 'drawer'
  }
  return 'root'
}

/*
 * 开发期后门：H5 里没有硬件返回键（onBackPress 只在 App 端触发），
 * 想验「弹窗开着时返回该关弹窗」只能在控制台手动调。
 * 只在 dev 挂到 window，生产包不会出现。
 */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  window.__overlay = {
    popupStack,
    drawerVisible,
    hasPopup,
    closeTopPopup,
    setDrawerOpen,
    closeDrawer,
    pushPopup,
    removePopup,
    handleGlobalBack,
  }
}
