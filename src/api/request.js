import { buildUrl } from './config'
import {
  DEFAULT_TIMEOUT,
  buildHeaders,
  handleUnauthorized,
  makeError,
} from './http-common'

/**
 * 请求层：用 uni.request 复刻 axios 的对外契约。
 *
 * 为什么刻意保持 axios 的形状，而不是让调用方改成 uni.request 风格：
 * 全项目有 20 多处调用点、6 个 composable，以及散落各处的
 * `error.response.data.msg` / `error.response.status === 404` 错误分支。
 * 契约一旦对齐，这些地方一行都不用动，改造面收敛到本文件。
 *
 * 对齐的三个语义（uni.request 与 axios 不一致，必须手工补齐）：
 *   1. **非 2xx 走 reject**。uni.request 对 404/500 也走 success，
 *      不补这条，所有 catch 分支和错误提示都会变成哑的。
 *   2. 成功结果包成 `{ data }`（axios 的 response 形状）。
 *   3. 失败结果带 `error.response = { status, data }`。
 *
 * 注意：这里只处理 JSON / 表单编码的请求体。
 * multipart 上传走 uni.uploadFile，见 ./upload.js
 * （uni.request 发不了 multipart，H5 端也一样 —— axios 那套 FormData 用法在 uni 里不成立）。
 */

function send(method, url, data, config = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: buildUrl(url),
      method,
      data,
      header: buildHeaders(config.headers),
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ data: res.data, status: res.statusCode, headers: res.header || {} })
          return
        }

        handleUnauthorized(res.statusCode, res.data)
        reject(makeError({ status: res.statusCode, body: res.data }))
      },
      fail: (err) => {
        reject(makeError({ status: 0, body: null, transportError: err }))
      },
    })
  })
}

const request = {
  get: (url, config) => send('GET', url, undefined, config),
  delete: (url, config) => send('DELETE', url, undefined, config),
  head: (url, config) => send('HEAD', url, undefined, config),
  post: (url, data, config) => send('POST', url, data, config),
  put: (url, data, config) => send('PUT', url, data, config),
  patch: (url, data, config) => send('PATCH', url, data, config),
}

export default request
