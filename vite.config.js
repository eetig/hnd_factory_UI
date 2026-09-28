import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { UnifiedViteWeappTailwindcssPlugin as uvtw } from 'weapp-tailwindcss/vite'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// 小程序端才有必要跑 weapp-tailwindcss：
// 它负责把 Tailwind 生成的非法选择器改写成 WXSS 能接受的形态
//   .hover\:bg-x  → .hover_bg-x（并同步改写 WXML 里的 class 属性）
//   .max-w-\[110px\] → .max-w-_110px_
// App 端（app-vue 是 webview 渲染）与 H5 端是完整 CSS 环境，原样即可，
// 跑这个插件反而会去改写本来合法的类名。
const isMiniProgram = /^mp-/.test(process.env.UNI_PLATFORM || '')

export default defineConfig({
  plugins: [uni(), ...(isMiniProgram ? [uvtw()] : [])],

  // postcss 配置内联在此，不用 postcss.config.js。
  // 原因：本项目 package.json 未声明 "type": "module"（跟随 uni-app 官方模板），
  // 独立的 postcss.config.js 会按 CJS 被 require，ESM 写法会直接报错；
  // 内联进 vite 配置可绕开这个二义性。
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },

  server: {
    port: 9091,
    host: true,
    // ⚠️ 以下代理仅 H5 端开发期有效。
    //    App 端与小程序端不走 devServer，请求直发真实域名（见 src/api/request.js 的 BASE_URL）。
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
      },
    },
  },
})
