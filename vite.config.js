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
  },
  build: {
    /**
     * chunk 体积告警阈值。
     *
     * 拆包后业务代码 chunk 只有 ~116 kB（改一行代码只让这个小包失效），
     * 触发告警的是 element-plus 全量引入形成的 vendor chunk（~812 kB）。
     * 它体积大是「全量引入」的必然结果 —— 要真正降下来需要改成按需引入
     * （unplugin-vue-components 等），属于单独一次改动；
     * 这里把阈值放到 900 kB，让告警只在「业务包明显变胖」时出现，
     * 而不是每次构建都被一个已知的、不可通过本次改动消除的数字刷屏。
     */
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        /**
         * 手动拆包：把长期不变的第三方库从业务代码里分出来。
         *
         * 拆之前 index-*.js 是 630kB（gzip 206kB），业务代码每次改动都会让
         * 整个大包失效；拆开后三方库 chunk 只有在升级依赖时才会变，
         * 浏览器缓存命中率显著提高。
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          // element-plus 放最前：它的内部路径里也可能出现 /vue/ 片段
          if (id.includes('element-plus')) return 'element-plus'
          if (id.includes('@vue/') || id.includes('/vue/') || id.includes('vue-router')) {
            return 'vue'
          }

          return 'vendor'
        },
      },
    },
  },
  // Vitest 复用这一份配置：只保留一个配置入口，避免出现两份配置文件各写一半
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.spec.js'],
  },
})
