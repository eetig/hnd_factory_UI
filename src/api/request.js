import axios from 'axios'
import router from '../router'

const TOKEN_KEY = 'token'

const request = axios.create({
  baseURL: '/',
  timeout: 20000,
})

request.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)

  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
}, (error) => Promise.reject(error))

request.interceptors.response.use(
  (response) => response,
  (error) => {
    const response = error?.response
    const data = response?.data || {}
    const message = typeof data === 'string' ? data : data.message || data.msg || ''
    const status = response?.status
    const isAuthError =
      status === 401 ||
      status === 403 ||
      String(data.code) === '401' ||
      String(data.code) === '403' ||
      /未登录|登录过期|token|Token|unauthorized|forbidden|expired/i.test(message)

    if (isAuthError) {
      localStorage.removeItem(TOKEN_KEY)
      if (router.currentRoute.value?.path !== '/login') {
        router.replace('/login')
      }
    }

    return Promise.reject(error)
  },
)

export default request
