const TOKEN_KEY = 'token'
const ROLE_KEY = 'roleKey'
const ROLE_NAME_KEY = 'roleName'
const PERMISSION_KEY = 'permissions'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

// 登录成功后保存凭据与权限
export function saveAuth(data) {
  if (!data) return

  if (data.token) localStorage.setItem(TOKEN_KEY, data.token)
  if (data.roleKey) localStorage.setItem(ROLE_KEY, data.roleKey)
  if (data.roleName) localStorage.setItem(ROLE_NAME_KEY, data.roleName)
  if (Array.isArray(data.permissions)) {
    localStorage.setItem(PERMISSION_KEY, JSON.stringify(data.permissions))
  }
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(ROLE_NAME_KEY)
  localStorage.removeItem(PERMISSION_KEY)
}

export function getRoleName() {
  return localStorage.getItem(ROLE_NAME_KEY) || ''
}

export function getPermissions() {
  try {
    const permissions = JSON.parse(localStorage.getItem(PERMISSION_KEY) || '[]')
    return Array.isArray(permissions) ? permissions : []
  } catch {
    return []
  }
}

// 权限判断：未指定权限标识时视为无需权限
export function hasPerm(key) {
  if (!key) return true
  return getPermissions().includes(key)
}
