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
  const absolute = /^https?:\/\//i.test(url)
  let full = absolute ? url : url
  if (!absolute) {
    const base = (config.baseURL || '').replace(/\/+$/, '')
    if (base) full = base + (url.startsWith('/') ? url : `/${url}`)
  }
  const query = serializeParams(config.params)
  if (!query) return full
  return full + (full.includes('?') ? '&' : '?') + query
}

/*
 * 把 axios 的 config.params 拼成查询串。
 *
 * ⚠️ 这是 1.0.2 的真实事故：自写 adapter 只顾了 URL 和 body，忘了 params，
 * 于是所有带查询条件的接口都变成"裸请求"——物料查询页直接报「缺少分页参数 pageNum」。
 * 浏览器版由 axios 自己拼，所以网页版一直是好的，只有桌面版踩中。
 * 数组按 axios 默认风格写成 `key[]=a&key[]=b`（后端的 String[] / List 都能接）。
 */
export function serializeParams(params) {
  if (!params) return ''
  const parts = []
  const push = (key, value) => {
    if (value === undefined || value === null || value === '') return
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue
        parts.push(`${encodeURIComponent(`${key}[]`)}=${encodeURIComponent(String(item))}`)
      }
      continue
    }
    push(key, value)
  }
  return parts.join('&')
}

/*
 * 浏览器自己会算 Content-Type 的请求体（2026-11-17）。
 *
 * ⚠️ 这是 1.0.30 的真实事故：桌面端上传附件报 **415**，网页版却好的。
 * 原因：axios 给 `post` 预置了 `Content-Type: application/x-www-form-urlencoded`，
 * 而浏览器版 xhr adapter 遇到 FormData 会**删掉**这个头，让 Request 自己写上
 * `multipart/form-data; boundary=...`；我们的自定义 adapter 却原样转发了。
 * 于是后端收到"声明是表单、内容却不是表单"的请求 → 415 Unsupported Media Type。
 * 这里照浏览器的做法：这类请求体一律不带 Content-Type，交给 `new Request()` 算。
 */
function browserSetsContentType(data) {
  if (!data || typeof data !== 'object') return false
  if (typeof FormData !== 'undefined' && data instanceof FormData) return true
  if (typeof Blob !== 'undefined' && data instanceof Blob) return true
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) return true
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return true
  return false
}

/** 不区分大小写地删掉某个请求头 */
function dropHeader(headers, name) {
  const target = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) delete headers[key]
  }
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
  // 见 browserSetsContentType 的注释：这类体子的 Content-Type 必须留给 Request 生成
  if (withBody && browserSetsContentType(config.data)) {
    dropHeader(headers, 'content-type')
  }

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
