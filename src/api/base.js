/*
 * 接口与静态资源的基地址（2026-11-11，桌面版接入）。
 *
 * 同一份代码要在两个"房子"里跑，接口地址的写法必须分开：
 *   · 网页版：页面就在 hbhnd.cloud 名下，`/api/...` 是同源请求，写空串即可（保持原样）；
 *   · 桌面版：页面来自 `tauri.localhost`（exe 里的本地文件），相对路径会打到本地，
 *     必须写绝对地址 —— 否则登录、列表全部 404，表现是"打开了但一片空白"。
 *
 * 构建时可以用 `VITE_API_BASE=https://xxx` 覆盖，方便以后换域名或连测试环境。
 */
const DESKTOP_ORIGIN = 'https://hbhnd.cloud'

export const IS_DESKTOP = import.meta.env.MODE === 'desktop'

/**
 * 真的跑在 Tauri 壳里吗（2026-11-23）。
 *
 * `IS_DESKTOP` 只认 `--mode desktop` 那份构建；但桌面构建漏跑到、或把网页包塞进
 * Tauri 里时，注入的 `__TAURI_INTERNALS__` 仍然在。窗口钮 / 拖动这类**只在有壳时
 * 才有意义**的东西按这个判据显隐 —— 网页版里它们既不该出现，也不该报错。
 * （router/index.js 的 `isDesktopRuntime()` 是同一判据，那边还带着路由守卫的语境，
 *  这里给界面层用，别在组件里各抄一份。）
 */
export const IS_TAURI =
  IS_DESKTOP || (typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__))

export const API_BASE =
  import.meta.env.VITE_API_BASE || (IS_DESKTOP ? DESKTOP_ORIGIN : '')

/**
 * 把接口返回的相对路径（`/files/x.jpg`、`/thumbs/x.jpg`）补成能直接放的地址。
 * 网页版原样返回（同源）；桌面版补上域名，否则图片会指向 exe 自己。
 */
export function assetUrl(path) {
  if (!path || typeof path !== 'string') return path
  if (/^(https?:|data:|blob:)/i.test(path)) return path
  if (!path.startsWith('/')) return path
  return API_BASE ? API_BASE + path : path
}
