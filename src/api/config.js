// 接口基地址与静态资源地址解析。
//
// 改造前整个前端跑在浏览器里，所有请求都写相对路径（/api/xxx、/files/xxx），
// 由 dev 代理或生产 Nginx 做同源路由。App 与小程序端没有「同源」这回事，
// 相对路径无法解析，必须补上绝对 origin。

/**
 * 非 H5 端（App / 小程序）的接口 origin —— 后端 hnd_factory。
 *
 * 当前填的是开发期直连地址：手机与电脑同一局域网时可直接联调。
 * ⚠️ 上线前必须换成 Nginx 域名（形如 https://factory.example.com），并要求运维：
 *   1. 小程序端要把该域名加进微信后台的 request / uploadFile / downloadFile 合法域名，
 *      否则真机上所有请求都会被微信拦截（开发者工具可勾「不校验合法域名」临时绕过）。
 *   2. /files、/thumbs、/api/ocr 的路由要按 前后端改动统筹.md 配齐。
 */
export const API_ORIGIN = 'http://172.26.20.69:8084'

/**
 * 单据图片服务（img-service）的直连地址。
 *
 * H5 端由 vite 代理（开发）/ Nginx 同源路由（生产）把 /files、/thumbs
 * 重写成 img-service 的 /api/img/file、/api/img/thumb。直连后端时没有这层代理，
 * 所以在这里手工做同一套重写（见 resolveAssetUrl）。
 *
 * 上线后若改成「域名 + Nginx 同源路由」，把它留空即退化为跟随 API_ORIGIN，
 * 相对路径原样交给 Nginx 处理，与改造前行为一致。
 */
export const IMG_ORIGIN = 'http://172.26.20.69:8082'

// H5 端保持相对路径：开发由 vite 代理，生产由 Nginx 同源路由，行为与改造前完全一致。
// 用 uni-app 的条件编译区分，避免把 H5 的相对路径行为带到 App/小程序上。
// #ifdef H5
export const ORIGIN = ''
// #endif
// #ifndef H5
export const ORIGIN = API_ORIGIN
// #endif

/** 把接口相对路径补成可请求的绝对地址 */
export function buildUrl(url) {
  if (!url) return url
  if (/^https?:\/\//i.test(url)) return url
  return `${ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`
}

/**
 * 解析后端返回的资源路径（单据图片的 thumbnailUrl / imageUrl 都是相对路径，
 * 见 变更-001：生产环境 image.base-url 留空 → 后端返回纯相对路径）。
 */
export function resolveAssetUrl(url) {
  if (!url) return ''
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url
  }

  // #ifndef H5
  // 直连场景：按 vite 代理同样的规则，把 /files、/thumbs 指到 img-service
  if (IMG_ORIGIN) {
    if (url.startsWith('/files/')) return `${IMG_ORIGIN}/api/img/file/${url.slice(7)}`
    if (url.startsWith('/thumbs/')) return `${IMG_ORIGIN}/api/img/thumb/${url.slice(8)}`
    return `${IMG_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`
  }
  // #endif

  return `${ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`
}
