/**
 * 「密码 / 配方」两格之间的滑动方向。
 *
 * 这是两个独立页面，靠 `uni.redirectTo` 换页，换页本身没有动画。为了不让它看起来像
 * 「啪」地一下从一页跳到另一页，出发前先记下往哪边滑（left = 新页从右边进来），
 * 到站后读一次、用完立刻删，下一掌进来就不会误播。
 */

const KEY = 'vaultSwitchDir'

export function markSwitch(dir) {
  try {
    uni.setStorageSync(KEY, dir)
  } catch (err) {
    // 存不下就算了，最多是没有进场动画，不影响功能
  }
}

export function takeSwitch() {
  try {
    const dir = uni.getStorageSync(KEY)
    if (dir) uni.removeStorageSync(KEY)
    return dir || ''
  } catch (err) {
    return ''
  }
}
