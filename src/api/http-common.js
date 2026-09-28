// 请求层公共部分：uni.request 与 uni.uploadFile 共用。
//
// 抽出来的动机：这两条通道的鉴权头、超时、401 处理、错误整形完全一致，
// 分散在各自文件里迟早会漂移（而鉴权一漂移就是线上才发现的登录问题）。

import { clearAuth, getToken } from './auth'

// 超时放宽到 5 分钟：Excel 导入（解析/预览/保存）耗时较长，
// 原 20s 会在解析大文件时误报 "timeout of 20000ms exceeded"。
//
// ⚠️ 小程序端另有天花板：app.json 的 networkTimeout.request / networkTimeout.uploadFile
//    默认 60s，真机大文件上传可能被它先掐断。需要在微信后台/项目配置里一并放宽。
export const DEFAULT_TIMEOUT = 300000

// 401 可能同时来自多个在途请求，用这个标记保证只跳转一次登录页
let redirecting = false

function currentRoute() {
  const pages = getCurrentPages()
  return pages.length ? `/${pages[pages.length - 1].route}` : ''
}

function redirectToLogin() {
  if (redirecting || currentRoute() === '/pages/login/login') return
  redirecting = true
  uni.reLaunch({
    url: '/pages/login/login',
    complete: () => {
      redirecting = false
    },
  })
}

/** 构造鉴权头：后端使用 Sa-Token，鉴权头为 satoken（不是 Authorization: Bearer） */
export function buildHeaders(extra) {
  const headers = { ...(extra || {}) }
  const token = getToken()
  if (token) headers.satoken = token
  return headers
}

/** 把响应体（可能是字符串）解析成对象 */
export function parseBody(body) {
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

/** 统一成 axios 形状的 Error（调用方依赖 error.response.data.msg） */
export function makeError({ status, body, transportError }) {
  const message =
    (typeof body === 'string' ? body : body?.message || body?.msg) ||
    transportError?.errMsg ||
    `请求失败${status ? `（HTTP ${status}）` : ''}`

  const error = new Error(message)
  if (status) {
    error.response = { status, data: body }
  }
  error.isNetworkError = !status
  return error
}

/**
 * 401（未登录 / token 失效）→ 清空凭据并跳登录页。
 * 403（已登录但无权限）保留登录态，由调用方提示错误即可。
 */
export function handleUnauthorized(status, body) {
  const code = String(body?.code ?? '')
  const message = typeof body === 'string' ? body : body?.message || body?.msg || ''

  const isUnauthorized =
    status === 401 ||
    code === '401' ||
    /未登录|登录过期|token\s*(失效|无效)|unauthorized|expired/i.test(message)

  if (!isUnauthorized) return

  clearAuth()
  redirectToLogin()
}
