import { reactive } from 'vue'
import { getItem, removeItem, setItem } from './storage'

const TOKEN_KEY = 'token'
const ROLE_KEY = 'roleKey'
const ROLE_NAME_KEY = 'roleName'
const PERMISSION_KEY = 'permissions'

function readPermissions() {
  try {
    const parsed = JSON.parse(getItem(PERMISSION_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 鉴权状态的内存镜像。
 *
 * 持久化是为了重启/刷新后恢复，但本地存储本身不是响应式的 ——
 * 直接读它的话，「登录 / 退出后按权限显隐的 Tab 与按钮」要等整页刷新才会变。
 * 所以读写一律经由这份 reactive 镜像，本地存储只作为持久化副本。
 */
export const authState = reactive({
  token: getItem(TOKEN_KEY) || '',
  roleName: getItem(ROLE_NAME_KEY) || '',
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
    setItem(TOKEN_KEY, data.token)
  }
  if (data.roleKey) {
    setItem(ROLE_KEY, data.roleKey)
  }
  if (data.roleName) {
    authState.roleName = data.roleName
    setItem(ROLE_NAME_KEY, data.roleName)
  }
  if (Array.isArray(data.permissions)) {
    authState.permissions = data.permissions
    setItem(PERMISSION_KEY, JSON.stringify(data.permissions))
  }
}

export function clearAuth() {
  authState.token = ''
  authState.roleName = ''
  authState.permissions = []

  removeItem(TOKEN_KEY)
  removeItem(ROLE_KEY)
  removeItem(ROLE_NAME_KEY)
  removeItem(PERMISSION_KEY)
}

// 权限判断：未指定权限标识时视为无需权限
export function hasPerm(key) {
  if (!key) return true
  return authState.permissions.includes(key)
}
