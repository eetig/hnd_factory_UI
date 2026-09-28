import { createSSRApp } from 'vue'
import App from './App.vue'

// uni-app 的入口约定：必须导出 createApp，且用 createSSRApp。
// 原来的 `Promise.race([restoreAuth(), 3s])` 挂载前等待逻辑，
// 已挪到 App.vue 的 onLaunch 里（那里才是 uni-app 的启动钩子）。
export function createApp() {
  const app = createSSRApp(App)
  return { app }
}
