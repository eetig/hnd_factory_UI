import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { UnifiedViteWeappTailwindcssPlugin as uvtw } from 'weapp-tailwindcss/vite'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
// 后端环境预设：与 src/api/config.js 共用同一份开关（改 src/api/env.js 的 APP_ENV）。
// 这样「前端切环境」和「H5 代理切环境」不会各切一半 —— 那种错配只在 H5 上暴露，
// App / 小程序端反而正常，很难第一时间发现。
import { ACTIVE_ENV, APP_ENV } from './src/api/env.js'

// 小程序端才有必要跑 weapp-tailwindcss：
// 它负责把 Tailwind 生成的非法选择器改写成 WXSS 能接受的形态
//   .hover\:bg-x  → .hover_bg-x（并同步改写 WXML 里的 class 属性）
//   .max-w-\[110px\] → .max-w-_110px_
// App 端（app-vue 是 webview 渲染）与 H5 端是完整 CSS 环境，原样即可，
// 跑这个插件反而会去改写本来合法的类名。
const isMiniProgram = /^mp-/.test(process.env.UNI_PLATFORM || '')

// 启动/构建时把当前后端环境打出来：打包前扫一眼终端，就能确认这个包连的是哪套后端
console.log(
  `[env] APP_ENV=${APP_ENV} → ${ACTIVE_ENV.label}（接口 base = ${ACTIVE_ENV.apiOrigin || '相对路径/Nginx 同源'}）`,
)

/**
 * H5 开发代理（仅 dev 生效；App / 小程序不走 devServer，请求直发绝对地址）。
 *
 * 规则跟随 src/api/env.js 的预设，保证 H5 与 App 端指向同一套后端：
 *   remote（域名同源）  → /api、/files、/thumbs 原样透传给 https://hbhnd.cloud，
 *                        不做任何 rewrite，本地拓扑与生产完全一致
 *                        （域名侧 Nginx 已配好 /api、/api/ocr、/files、/thumbs 四条路由）
 *   local （直连三台）  → /api/ocr 单独指到 myocr(8085)；
 *                        /files、/thumbs 重写成 img-service 的真实路径
 *                        （/api/img/file、/api/img/thumb，本地没有 Nginx 做这层路由）
 */
function buildProxy() {
  if (APP_ENV === 'local') {
    return {
      // ⚠️ '/api/ocr' 必须写在 '/api' 之前：vite 按书写顺序匹配，
      //    写反了识别请求会被 '/api' 那条先吃掉，打到 hnd_factory 上 404
      '/api/ocr': { target: ACTIVE_ENV.ocrOrigin, changeOrigin: true },
      '/api': { target: ACTIVE_ENV.apiOrigin, changeOrigin: true },
      '/files': {
        target: ACTIVE_ENV.imgOrigin,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/files/, '/api/img/file'),
      },
      '/thumbs': {
        target: ACTIVE_ENV.imgOrigin,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/thumbs/, '/api/img/thumb'),
      },
    }
  }

  const target = ACTIVE_ENV.apiOrigin
  return {
    '/api': { target, changeOrigin: true, secure: false },
    '/files': { target, changeOrigin: true, secure: false },
    '/thumbs': { target, changeOrigin: true, secure: false },
  }
}

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
    // ⚠️ 代理仅 H5 端开发期有效，规则见上方 buildProxy()。
    //    切换后端环境请改 src/api/env.js 的 APP_ENV，不要在这里逐个改 target，
    //    否则会与 src/api/config.js（App/小程序用的 origin）不一致。
    proxy: buildProxy(),
  },
})
