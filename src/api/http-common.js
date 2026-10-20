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

  /*
   * 使用方 2026-10-21：「默认不需要登录」。
   *
   * 区分两种情况，它们的正确反应完全不同：
   *   ① **本来就没登录**（游客点了个需要登录的功能）——**不能**跳登录页。
   *      跳过去会让人以为"这个 App 必须先登录"，而且他连注册入口都找不到；
   *      正确做法是就地提示一句，留在原地。
   *   ② **登录过但会话过期**（有 token、服务端说无效）—— 清凭据 + 跳登录页，
   *      否则他会一直卡在"看得见界面、每个请求都 401"的状态里。
   *
   * 之前两者都跳登录页，所以游客一碰工单/领料就"被送进登录页" —— 那正是使用方
   * 截图里那张"一打开就是登录页"的真因（不是启动就跳）。
   */
  const hadToken = !!getToken()
  clearAuth()

  if (!hadToken) {
    uni.showToast({ title: '该功能需要注册后使用', icon: 'none', duration: 2200 })
    return
  }

  redirectToLogin()
}
