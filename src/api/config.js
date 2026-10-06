// 接口基地址与静态资源地址解析。
//
// 一套代码 / 两套后端：环境预设与开关统一放在 ./env.js，
// 改那里的 APP_ENV 一处，H5 / App / 小程序的接口、图片、OCR 会一起切换
// （vite.config.js 的 H5 开发代理也读同一份预设，不会出现「前端切了、代理没切」）。
//
// 改造前整个前端跑在浏览器里，所有请求都写相对路径（/api/xxx、/files/xxx），
// 由 dev 代理或生产 Nginx 做同源路由。App 与小程序端没有「同源」这回事，
// 相对路径无法解析，必须补上绝对 origin。

import { ACTIVE_ENV, VESSEL_IMAGE_ORIGIN } from './env'

/**
 * 非 H5 端（App / 小程序）的接口 origin —— 后端 hnd_factory。
 *
 * 取值来自环境预设（src/api/env.js）：
 *   remote → https://hbhnd.cloud        线上部署，Nginx 同源入口
 *   local  → http://172.26.20.69:8084   本机/局域网联调（IP 见 env.js 的 LAN_HOST）
 *
 * ⚠️ 上线（打 APK / 小程序提审）前先确认 src/api/env.js 里 APP_ENV === 'remote'，
 *    否则开发机 IP 会被内联进产物 —— App 装到手机上连的仍是开发机（本次要修的就是这个）。
 *    另外小程序端要把该域名加进微信后台的 request / uploadFile / downloadFile 合法域名，
 *    否则真机上所有请求都会被微信拦截（开发者工具可勾「不校验合法域名」临时绕过）。
 */
export const API_ORIGIN = ACTIVE_ENV.apiOrigin

/**
 * 单据图片服务（img-service）的 origin。
 *
 * H5 端由 vite 代理（开发）/ Nginx 同源路由（生产）把 /files、/thumbs
 * 重写成 img-service 的 /api/img/file、/api/img/thumb。直连后端时没有这层代理，
 * 所以按 IMG_REWRITE 决定是否手工做同一套重写（见 resolveAssetUrl）：
 *   local  → 有值 + IMG_REWRITE=true（直连 8082，必须手工重写）
 *   remote → 留空 + IMG_REWRITE=false，退化为跟随 API_ORIGIN，
 *            相对路径原样交给域名侧 Nginx，与改造前行为一致
 */
export const IMG_ORIGIN = ACTIVE_ENV.imgOrigin

/** 是否按「直连 img-service」的规则手工重写图片路径（见 IMG_ORIGIN 注释） */
export const IMG_REWRITE = ACTIVE_ENV.imgRewrite

/**
 * 图片识别服务（myocr）的 origin —— /api/ocr/* 走它。
 *
 * OCR 是本项目唯一一个「挂在 /api 前缀下、却不在 hnd_factory 上」的接口：
 *   线上 → 由域名侧 Nginx 把 /api/ocr 分流给 myocr，与 apiOrigin 同源，留空即跟随；
 *   本机 → myocr(8085) 与 hnd_factory(8084) 是两台独立服务，必须单独指向，
 *          否则识别请求会打到 hnd_factory 上 404。
 * H5 端不受影响（开发走 vite 代理、生产走 Nginx，都按相对路径分流）。
 */
export const OCR_ORIGIN = ACTIVE_ENV.ocrOrigin

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
  const path = url.startsWith('/') ? url : `/${url}`

  // #ifndef H5
  // /api/ocr/* 归属 myocr 而非 hnd_factory，本机联调时两者是不同主机:端口，
  // 必须单独指过去（线上 OCR_ORIGIN 为空，直接跟随 ORIGIN，即域名侧 Nginx 分流）。
  // H5 端不需要这段：开发期由 vite 代理分流，生产由 Nginx 分流。
  if (OCR_ORIGIN && path.startsWith('/api/ocr')) return `${OCR_ORIGIN}${path}`
  // #endif

  return `${ORIGIN}${path}`
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

  const path = url.startsWith('/') ? url : `/${url}`

  // #ifndef H5
  if (IMG_ORIGIN) {
    if (IMG_REWRITE) {
      // 直连 img-service：按 vite 代理同样的规则把 /files、/thumbs 重写成真实路径
      if (path.startsWith('/files/')) return `${IMG_ORIGIN}/api/img/file/${path.slice(7)}`
      if (path.startsWith('/thumbs/')) return `${IMG_ORIGIN}/api/img/thumb/${path.slice(8)}`
    } else {
      // 域名同源：Nginx 已把 /files、/thumbs 路由给 img-service，原样透传
      return `${IMG_ORIGIN}${path}`
    }
  }
  // #endif

  return `${ORIGIN}${path}`
}

/**
 * 容器底图的取图地址（压力容器体积计算页）。
 *
 * `VESSELS[].image` / `.imageDark` 里现在只写**文件名**（如 'vessel.png'），
 * 由这里按环境补前缀：
 *   local  → `/static/vessel.png`               包内（开发/联调，离线可用）
 *   remote → `https://hbhnd.cloud/vessels/...`  走网络，不占小程序包体
 *
 * 为什么要这么做、服务器侧要放哪些文件，见 env.js 的 VESSEL_IMAGE_ORIGIN 注释
 * 与《UNIAPP迁移说明》§6.1。
 *
 * 已经是绝对地址或绝对路径的原样返回 —— 便于临时把某一张指到别处做验证。
 */
export function resolveVesselImage(file) {
  if (!file) return ''
  // **上传的底图**（2026-10-06 起「设备数据维护」页可传图）存的是 `/files/xxx.png` ——
  // img-service 存 MinIO、Nginx 同源暴露，与单据图片是同一条通道。
  // 必须交给 resolveAssetUrl 去补 origin：App/小程序端没有「同源」这回事，
  // 留个相对路径过去就是 404。
  if (file.startsWith('/files/') || file.startsWith('/thumbs/')) return resolveAssetUrl(file)
  if (/^(https?:)?\/\//i.test(file) || file.startsWith('/')) return file
  return VESSEL_IMAGE_ORIGIN ? `${VESSEL_IMAGE_ORIGIN}/${file}` : `/static/${file}`
}
