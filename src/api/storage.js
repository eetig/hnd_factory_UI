// 本地存储适配层。
//
// 改造前直接用了 localStorage —— 只有浏览器有。App 与小程序端要用
// uni.setStorageSync / uni.getStorageSync（三端都有，H5 端 uni 内部仍落到
// localStorage，所以 H5 行为不变）。
//
// 注意 uni.getStorageSync 在键不存在时返回 ''（不是 null），
// 且写入对象会被平台序列化，因此这里统一只存字符串。

export function getItem(key) {
  try {
    return uni.getStorageSync(key) || ''
  } catch {
    return ''
  }
}

export function setItem(key, value) {
  try {
    uni.setStorageSync(key, value)
  } catch {
    // 存储写满或被禁用时静默降级：本次会话内仍可用（有 reactive 内存镜像兜底）
  }
}

export function removeItem(key) {
  try {
    uni.removeStorageSync(key)
  } catch {
    // 同上
  }
}

/** 是否已持久化过角色信息（用于启动时判断要不要重新拉 /api/user/info） */
export function hasStoredRole() {
  return !!getItem('roleKey')
}
