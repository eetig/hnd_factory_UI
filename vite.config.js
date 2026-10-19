import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/*
 * 本地预览可以**直连线上接口**（变更-096 期间加的，使用方「先就在本地跑，看看效果」）：
 *
 *   PowerShell:  $env:HND_REMOTE='https://hbhnd.cloud'; npm run dev
 *
 * 为什么需要它：本机没有后端 —— 8084（hnd_factory）与 8082（img-service）都跑在服务器上，
 * 默认代理会全部连不上，页面只能停在登录页，看不到这次改的样式。
 * 给了这个变量，/api、/files、/thumbs 整段转发到远端站点：登录后看到的是**线上真实数据**
 * 配新样式。
 *
 * ⚠️ 此时**任何写操作都会直接写进生产**（保存/删除/上传）。只看，别动。
 * ⚠️ 不给变量时行为与以前**完全一致**（本地 8084 / 8082，含 img-service 的路径重写）。
 */
const REMOTE = process.env.HND_REMOTE || ''

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 9091,
    host: true,
    /*
     * 让监听忽略「原子写」留下的临时目录（2026-10-15 实测踩到）。
     *
     * 编辑器/工具用「写临时文件 → rename」的方式落盘时，被监听的目录里会短暂出现
     * `.X.vue.<pid>.<uuid>.tmpdir/`。只要 vite 恰好在那一瞬间去 watch 它，就会
     * `EBUSY: resource busy or locked` 直接**把 dev server 打死**（目录事后会被清掉，
     * 但进程已经退了）。表现是「改一行代码，页面就再也刷不出来」。
     *
     * `*.tmp` 本来就在 .gitignore 里；这里补上监听侧的忽略，让改代码时 server 还活着。
     */
    watch: {
      ignored: ['**/.*.tmpdir/**', '**/.*.tmpdir', '**/*.tmp'],
    },
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
        // 后端 hnd_factory 端口（本地与容器统一为 8084）；设了 HND_REMOTE 则直连远端站点
        target: REMOTE || 'http://localhost:8084',
        changeOrigin: true,
        secure: !REMOTE,
        // 删除 rewrite，不去掉 /api，直接原样转发
      },
      /*
       * 单据图片（整改-001）：生产由 Nginx 同源路由，本地开发转发到 img-service。
       *
       * ⚠️ 那个 rewrite 只对 **img-service** 需要（/files/X → /api/img/file/X）。
       *    直连远端站点时**绝不能重写** —— 远端是 Nginx 同源路由，原路径就是 /files/X，
       *    重写成 /api/img/file/X 会 404（这次差点踩到）。
       */
      '/files': REMOTE
        ? { target: REMOTE, changeOrigin: true, secure: false }
        : {
            target: 'http://localhost:8082',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/files/, '/api/img/file'),
          },
      '/thumbs': REMOTE
        ? { target: REMOTE, changeOrigin: true, secure: false }
        : {
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
     *
     * ⚠️ 2026-10-16 试过并**回滚**了 unplugin-element-plus@0.11.2（记在这里，免得下次重走）：
     *    那个插件只做**样式**注入（transformImportStyle → components/<name>/style/css），
     *    **不改写 JS 导入路径**；装了它 element-plus chunk 仍是 812.32 KB（字节相同、只是 hash 变），
     *    再补 include 把 .js 也纳进来（它的默认范围只有 vue/ts/tsx/jsx）也毫无变化。
     *    所以 JS 要真按需只有两条路，都不是改构建配置能解决的：
     *      ① 把 9 个文件里的 `import { ElX } from 'element-plus'` 改成按组件子路径导入；
     *      ② 删掉这些显式导入、改用 unplugin-vue-components + ElementPlusResolver 自动导入
     *         （JS 服务类仍要显式导入，如 ElMessage）。两条都要逐页目视确认组件没裸奔。
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
