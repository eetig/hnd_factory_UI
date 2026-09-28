import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 9091,
    host: true,
    proxy: {
      // 识别服务 myocr（变更-003）。
      // ⚠️ 必须排在下面的 '/api' 之前：Vite 按定义顺序匹配上下文，
      //    放到后面会被 '/api' 先吃掉，转发到 hnd_factory(8084) 而 404。
      // 注意与其它服务不同，这里不重写路径 —— myocr 的路由本身就是 /api/ocr/*。
      '/api/ocr': {
        target: 'http://localhost:8085',
        changeOrigin: true,
      },
      '/api': {
        // 后端 hnd_factory 端口（本地与容器统一为 8084）
        target: 'http://localhost:8084',
        changeOrigin: true,
        // 删除 rewrite，不去掉 /api，直接原样转发
      },
      // 单据图片（整改-001）：生产由 Nginx 同源路由，本地开发转发到 img-service
      // 注意：需重写路径 —— /files/X → /api/img/file/X，/thumbs/X → /api/img/thumb/X
      '/files': {
        target: 'http://localhost:8082',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/files/, '/api/img/file'),
      },
      '/thumbs': {
        target: 'http://localhost:8082',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/thumbs/, '/api/img/thumb'),
      }
    }
  }
})
