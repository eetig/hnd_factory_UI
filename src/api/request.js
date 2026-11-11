import axios from 'axios'
import router from '../router'
import { clearAuth, getToken } from './auth'
import { API_BASE } from './base'

/*
 * 「登录失效」的统一判定（2026-11-03）。
 *
 * 这个仓的后端把业务失败也走 HTTP 200（Result{code,msg,data,success}），
 * 所以"未登录"既可能出现在 HTTP 401 里，也可能出现在 200 的 msg 里 ——
 * 两处必须用同一套判据，否则就会出现"这个页面会跳登录页、那个页面只弹红条"。
 */
const LOGIN_EXPIRED = /未登录|登录过期|登录已过期|请先登录|token\s*(失效|无效)|unauthorized|expired/i

/** 清凭据并回登录页（带 expired=1，登录页可提示"登录已过期"） */
function redirectToLogin() {
  clearAuth()
  const current = router.currentRoute.value
  if (current?.path === '/login') return
  router.replace({ path: '/login', query: { expired: '1', redirect: current?.fullPath || '' } })
}

const request = axios.create({
  // 网页版为空串（同源），桌面版是 https://hbbhnd.cloud —— 见 api/base.js 的说明
  baseURL: API_BASE,
  // 超时放宽到 5 分钟：Excel 导入（解析/预览/保存）耗时较长，
  // 原 20s 会在解析大文件时误报 "timeout of 20000ms exceeded"。
  timeout: 300000,
})

request.interceptors.request.use(
  (config) => {
    const token = getToken()

    if (token) {
      config.headers = config.headers || {}
      // 后端使用 Sa-Token，鉴权头为 satoken（不是 Authorization: Bearer）
      config.headers.satoken = token
    }

    return config
  },
  (error) => Promise.reject(error),
)

request.interceptors.response.use(
  (response) => {
    // ⚠️ 业务失败也走 **HTTP 200**（后端统一返回 Result{code,msg,data,success}）。
    // 必须在成功分支里拦下 —— 原先前端原样放行，调用方拿到的"成功"是假的：
    // 弹窗关掉了、界面当成功了，而库里什么都没变（变更-085 修的就是这个：
    // 保存被后端以 {code:500,success:false,msg:"设备位号不能为空"} 拒掉，使用者却毫无察觉）。
    // 这里只对「明确的 success:false」生效， blob/字符串等其它响应类型不受影响。
    const data = response?.data
    if (data && typeof data === 'object' && data.success === false) {
      const message = data.msg || '操作失败'

      /*
       * 2026-11-03：**登录失效也走这里**。
       *
       * 后端把"未登录"包在 HTTP 200 里返回：{code:500, msg:"请先登录", success:false}。
       * 它不进下面的错误分支，所以原来只 reject、不清凭据 —— 表现就是
       * "我已经登录了，页面却显示请先登录"，而且每个页面各弹各的红条。
       * 现在统一在这里清凭据 + 回登录页，全站一个行为。
       */
      if (LOGIN_EXPIRED.test(message) || String(data.code) === '401') {
        redirectToLogin()
      }

      const error = new Error(message)
      // 保留 response，调用方现有的 `e.response.data.msg` 读法不用改
      error.response = response
      error.businessError = true
      return Promise.reject(error)
    }
    return response
  },
  (error) => {
    const response = error?.response
    const data = response?.data || {}
    const message = typeof data === 'string' ? data : data.message || data.msg || ''
    const status = response?.status
    const code = String(data.code ?? '')

    // 401 / 未登录 / token 失效 → 清凭据并回登录页（与成功分支同一套判据）
    if (status === 401 || code === '401' || LOGIN_EXPIRED.test(message)) {
      redirectToLogin()
    }
    // 403：已登录但无权限 —— 保留登录态，由调用方提示错误即可

    return Promise.reject(error)
  },
)

export default request
