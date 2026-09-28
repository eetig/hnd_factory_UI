<script setup>
import { onLaunch } from '@dcloudio/uni-app'
import request from './api/request'
import { getToken, saveAuth } from './api/auth'
import { hasStoredRole } from './api/storage'

// 启动后恢复角色与权限：token 在本地存储里，角色信息需重新拉取。
// 沿用改造前的策略 —— 最多等 3 秒，避免后端不可用时阻塞启动。
function restoreAuth() {
  if (!getToken() || hasStoredRole()) return Promise.resolve()

  return Promise.race([
    request.get('/api/user/info').then((res) => saveAuth(res.data || {})),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).catch(() => {
    // token 失效时由 request 的响应处理统一清理并跳登录页
  })
}

onLaunch(() => {
  restoreAuth()
})
</script>

<style lang="scss">
@tailwind base;
@tailwind components;
@tailwind utilities;

// uni-app 没有 body/:root，等价选择器是 page。
// 原 style.css 的 :root + body 规则迁移到这里。
page {
  min-height: 100vh;
  background-color: $slate-50;
  color: $slate-700;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI',
    'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 28rpx;
  line-height: 1.5;
}
</style>
