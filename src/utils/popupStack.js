/**
 * 弹窗栈（2026-11-18）
 *
 * 解决的是「返回手势打错人」：手机上从屏幕边缘往里滑 = 返回手势，
 * 页面把它当成「开左侧抽屉」。可是弹窗开着的时候，人想关的是弹窗，
 * 结果抽屉从旁边滑出来，弹窗还杵在那儿。
 *
 * 口径（使用方定的优先级）：
 *   有弹窗 → 这一下只关最上面那层弹窗，不碰抽屉、不退出页面；
 *   没弹窗 → 才轮到抽屉（抽屉照旧：关着就开、开着就收）。
 *
 * 为什么用**栈**而不是一个布尔：弹窗能叠（详情里再点编辑、详情里再开送货单来源），
 * 一次返回只该关掉用户眼前那层，布尔记不住「现在最上面是谁」。
 *
 * 用法：每个弹窗在打开时 pushPopup(id, 关闭函数)，关闭后 removePopup(id)。
 * 本文件不依赖任何页面，App / H5 都能用；H5 里返回手势由浏览器管，不影响这里。
 */
import { ref } from 'vue'

const stack = ref([])

/** 只读给调试用（dev 控制台里能看 popupStack.value.length） */
export const popupStack = stack

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
    console.warn('[popupStack] 关闭弹窗失败', e)
  }
  return true
}

/*
 * 开发期后门：H5 里没有硬件返回键（onBackPress 只在 App 端触发），
 * 想验「弹窗开着时返回该关弹窗」只能在控制台手动调。
 * 只在 dev 挂到 window，生产包不会出现。
 */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  window.__popupStack = { hasPopup, closeTopPopup, popupStack }
}
