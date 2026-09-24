import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import request from './api/request'
import { getToken, saveAuth } from './api/auth'
import './style.css'

// 刷新页面后恢复角色与权限：token 在 localStorage，角色信息需重新拉取
async function restoreAuth() {
  if (!getToken() || localStorage.getItem('roleKey')) return

  try {
    const res = await request.get('/api/user/info')
    saveAuth(res.data || {})
  } catch {
    // token 失效时由 request 响应拦截器统一清理并跳转登录页
  }
}

// 最多等待 3 秒，避免后端不可用时阻塞页面加载
Promise.race([
  restoreAuth(),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]).finally(() => {
  createApp(App).use(router).mount('#app')
})
