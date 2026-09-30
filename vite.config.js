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
    port: 9092,
    host: true,
    // ⚠️ 以下代理仅 H5 端开发期有效。
    //    App 端与小程序端不走 devServer，请求直发真实域名（见 src/api/request.js 的 BASE_URL）。
    //
    // 当前为「接入已部署线上后端」的联调配置：三组路由全部指向 https://hbhnd.cloud。
    // hbhnd.cloud 的生产 Nginx 已把 /api(FastAPI hnd_factory)、/api/ocr(myocr 8085)、
    // /files、/thumbs(img-service 8082) 同源配好，故这里【不做任何 rewrite】，
    // 原样透传即可，本地拓扑与生产完全一致。
    //   若要回切到本地后端（8084 / 8082 / 8085），把下面 target 换成本地地址，
    //   并把 /files、/thumbs 各自带上注释掉的 rewrite 即可（本地 img-service 需手工重写）。
    proxy: {
      // 后端 hnd_factory 的 /api/*；/api/ocr/* 也由同一条规则吃掉，
      // 交由 hbhnd.cloud 的 Nginx 分流到 myocr —— 无需再单独定义 '/api/ocr'。
      '/api': {
        target: 'https://hbhnd.cloud',
        changeOrigin: true,
        secure: false,
      },
      // 单据图片（整改-001）：生产由 Nginx 同源路由到 img-service。
      '/files': {
        target: 'https://hbhnd.cloud',
        changeOrigin: true,
        secure: false,
        // 本地直连 img-service 时启用：
        // rewrite: (path) => path.replace(/^\/files/, '/api/img/file'),
      },
      '/thumbs': {
        target: 'https://hbhnd.cloud',
        changeOrigin: true,
        secure: false,
        // 本地直连 img-service 时启用：
        // rewrite: (path) => path.replace(/^\/thumbs/, '/api/img/thumb'),
      },
    },
  },
})
