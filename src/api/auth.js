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
  // roleKey 也进镜像：台账类 Tab 按角色显隐（决策-004），
  // 只写本地存储的话，登录/退出后 Tab 要等重开小程序才会变
  roleKey: getItem(ROLE_KEY) || '',
  roleName: getItem(ROLE_NAME_KEY) || '',
  permissions: readPermissions(),
})

/** 未登录也能浏览（只读），写入类功能按权限隐藏 */
export function isLoggedIn() {
  return !!authState.token
}

/**
 * 是否管理员。
 *
 * 与后端 `SaTokenConfigure` 的角色闸门（`checkRole("admin")`）一一对应：
 * 后端管「能不能拿到数据」，这里管「显不显示入口」，两边判定口径必须一致，
 * 否则就会出现「看得见点进去全 403」或者「明明有权限却找不到入口」。
 */
export function isAdmin() {
  return authState.roleKey === 'admin'
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
    authState.roleKey = data.roleKey
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
  authState.roleKey = ''
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
