import { reactive } from 'vue'

const TOKEN_KEY = 'token'
const ROLE_KEY = 'roleKey'
const ROLE_NAME_KEY = 'roleName'
const PERMISSION_KEY = 'permissions'

function readPermissions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PERMISSION_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 鉴权状态的内存镜像。
 *
 * 存 localStorage 是为了刷新后恢复，但 localStorage 本身不是响应式的 ——
 * 直接读它的话，「登录 / 退出后按权限显隐的 Tab 与按钮」要等整页刷新才会变。
 * 所以读写一律经由这份 reactive 镜像，localStorage 只作为持久化副本。
 */
export const authState = reactive({
  token: localStorage.getItem(TOKEN_KEY) || '',
  roleName: localStorage.getItem(ROLE_NAME_KEY) || '',
  permissions: readPermissions(),
})

/** 未登录也能浏览（只读），写入类功能按权限隐藏 */
export function isLoggedIn() {
  return !!authState.token
}

export function getToken() {
  return authState.token
}

export function getRoleName() {
  return authState.roleName
}

export function getPermissions() {
  return authState.permissions
}

// 登录成功后保存凭据与权限
export function saveAuth(data) {
  if (!data) return

  if (data.token) {
    authState.token = data.token
    localStorage.setItem(TOKEN_KEY, data.token)
  }
  if (data.roleKey) {
    localStorage.setItem(ROLE_KEY, data.roleKey)
  }
  if (data.roleName) {
    authState.roleName = data.roleName
    localStorage.setItem(ROLE_NAME_KEY, data.roleName)
  }
  if (Array.isArray(data.permissions)) {
    authState.permissions = data.permissions
    localStorage.setItem(PERMISSION_KEY, JSON.stringify(data.permissions))
  }
}

export function clearAuth() {
  authState.token = ''
  authState.roleName = ''
  authState.permissions = []

  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(ROLE_NAME_KEY)
  localStorage.removeItem(PERMISSION_KEY)
}

// 权限判断：未指定权限标识时视为无需权限
export function hasPerm(key) {
  if (!key) return true
  return authState.permissions.includes(key)
}
