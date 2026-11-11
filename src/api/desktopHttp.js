/*
 * 桌面版的请求通道（2026-11-11）。
 *
 * 为什么不能直接用浏览器的 XHR/fetch：
 *   桌面版的页面来自 `tauri.localhost`（exe 里的本地文件），而接口在 hbhnd.cloud。
 *   浏览器规则下这是"跨域"，必须先发 OPTIONS 预检、服务器回一堆 Access-Control-Allow-* 才放行。
 *   线上后端目前不放行这个来源 —— 实测预检直接 403 Invalid CORS request，
 *   表现就是明明网络通、账号对，界面只显示 Network Error。
 *
 * 所以桌面版把请求交给 Rust 侧去发（@tauri-apps/plugin-http）：
 *   Rust 不是浏览器，没有同源策略，也不需要预检。代价是域名必须在 capabilities 里列白名单。
 *
 * 用法：给 axios 换一个 adapter，其余代码（拦截器、业务调用）一行都不用改。
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

function resolveUrl(config) {
  const url = config.url || ''
  if (/^https?:\/\//i.test(url)) return url
  const base = (config.baseURL || '').replace(/\/+$/, '')
  if (!base) return url
  return base + (url.startsWith('/') ? url : `/${url}`)
}

function headerObject(config) {
  const raw = config.headers || {}
  // AxiosHeaders 有 toJSON()，普通对象直接用
  const source = typeof raw.toJSON === 'function' ? raw.toJSON() : raw
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue
    out[key] = String(value)
  }
  return out
}

function headersToObject(headers) {
  const out = {}
  if (!headers) return out
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

async function readBody(response, responseType) {
  if (responseType === 'blob') return response.blob()
  if (responseType === 'arraybuffer') return response.arrayBuffer()
  const text = await response.text()
  if (responseType === 'text') return text
  if (!text) return text
  // 后端统一返回 JSON；解析失败就原样给出，让调用方看见真正的内容
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function makeError(message, config, response) {
  const error = new Error(message)
  error.config = config
  error.isAxiosError = true
  if (response) error.response = response
  return error
}

/**
 * axios adapter：签名与 axios 自带 adapter 一致。
 * 网络层失败时把"发给谁"写进错误文案 —— 桌面版最常见的故障就是地址不对，
 * 只显示 Network Error 根本看不出是在连哪个域名。
 */
export async function desktopAdapter(config) {
  const url = resolveUrl(config)
  const method = (config.method || 'get').toUpperCase()
  const headers = headerObject(config)
  const withBody =
    method !== 'GET' && method !== 'HEAD' && config.data !== undefined && config.data !== null

  let raw
  try {
    raw = await tauriFetch(url, {
      method,
      headers,
      // FormData / Blob / 字符串都能交给浏览器 Request 去序列化（plugin-http 内部会转成 ArrayBuffer）
      body: withBody ? config.data : undefined,
      signal: config.signal,
    })
  } catch (e) {
    const reason = e?.message || String(e)
    throw makeError(`连不上服务器（${url}）：${reason}`, config, null)
  }

  const data = await readBody(raw, config.responseType)
  const response = {
    data,
    status: raw.status,
    statusText: raw.statusText,
    headers: headersToObject(raw.headers),
    config,
    request: null,
  }

  const validateStatus = config.validateStatus || ((status) => status >= 200 && status < 300)
  if (!validateStatus(response.status)) {
    throw makeError(
      `Request failed with status code ${response.status}（${url}）`,
      config,
      response,
    )
  }

  return response
}
