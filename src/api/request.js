import axios from 'axios'
import router from '../router'
import { clearAuth, getToken } from './auth'

const request = axios.create({
  baseURL: '/',
  timeout: 20000,
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
  (response) => response,
  (error) => {
    const response = error?.response
    const data = response?.data || {}
    const message = typeof data === 'string' ? data : data.message || data.msg || ''
    const status = response?.status
    const code = String(data.code ?? '')

    // 401：未登录或 token 失效 → 清空凭据并跳登录页
    const isUnauthorized =
      status === 401 ||
      code === '401' ||
      /未登录|登录过期|token\s*(失效|无效)|unauthorized|expired/i.test(message)

    if (isUnauthorized) {
      clearAuth()
      if (router.currentRoute.value?.path !== '/login') {
        router.replace('/login')
      }
    }
    // 403：已登录但无权限 —— 保留登录态，由调用方提示错误即可

    return Promise.reject(error)
  },
)

export default request
