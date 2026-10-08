import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import request from './api/request'
import { getToken, saveAuth } from './api/auth'

/*
 * 样式导入顺序是有意的，别调换：
 *   element-plus/dist/index.css  先 —— EP 组件库自带样式
 *   ./theme.css                  后 —— 覆盖 --el-color-primary 与圆角变量；
 *                                     两者同优先级（都是 :root），谁后加载谁赢
 *   ./style.css                  最后 —— Tailwind 与全局基础样式
 *
 * 原先 EP 的样式是在 WorkOrderList.vue / WorkOrderImport.vue 里各自 import 的，
 * 覆盖规则排在其后就只能靠「哪个组件先加载」来保证，太脆。
 * 顺带修掉一个潜在缺陷：ImageParse.vue 用着 el-dialog / el-image 却从没 import 过
 * EP 样式，之前只是沾了「WorkOrderList 一定先加载」的光；放到这里之后，
 * 任何按路由单独加载的页面都不会裸奔。
 */
import 'element-plus/dist/index.css'
import './theme.css'
import './liquid-glass.css'
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
