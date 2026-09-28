import { buildUrl } from './config'
import {
  DEFAULT_TIMEOUT,
  buildHeaders,
  handleUnauthorized,
  makeError,
  parseBody,
} from './http-common'

/**
 * multipart 上传。
 *
 * 为什么不能继续用 FormData + request.post：
 * uni.request 在**任何端**都不支持 FormData 请求体（H5 端也一样，它内部走 XHR 的
 * 自有实现），改造前的 `new FormData()` 用法在 uni 里整个不成立。
 * multipart 只能走 uni.uploadFile。
 *
 * 而 uni.uploadFile 一次只能带**一个**文件，于是原来「一次 POST 传 N 张图」的
 * 三处调用（工单图片上传 ×2、导入保存）要改成循环单文件请求。
 * 循环调用对现有接口是兼容的 —— 后端若是 Spring 的 MultipartFile[]，
 * 传单元素数组天然合法；且原返回值本就是「本次上传的图片列表」，累加即可。
 */

/** H5 端拿到的是 File 对象，uni.uploadFile 需要路径 → 转成 blob URL */
export function toUploadPath(fileOrPath) {
  if (typeof fileOrPath === 'string') return fileOrPath
  // #ifdef H5
  return URL.createObjectURL(fileOrPath)
  // #endif
  // #ifndef H5
  // App / 小程序端 filePath 本来就来自 chooseImage 的临时路径，不会是 File 对象
  return fileOrPath?.path || ''
  // #endif
}

/** 释放 toUploadPath 创建的 blob URL（仅 H5 需要，避免内存泄漏） */
export function releaseUploadPath(fileOrPath, path) {
  if (typeof fileOrPath === 'string' || !path) return
  // #ifdef H5
  URL.revokeObjectURL(path)
  // #endif
}

/**
 * 上传单个文件。
 * @returns {Promise<{data: any, status: number}>} 形状与 request.js 一致
 */
export function uploadFile({ url, filePath, name = 'file', formData = {}, onProgress }) {
  return new Promise((resolve, reject) => {
    const task = uni.uploadFile({
      url: buildUrl(url),
      filePath,
      name,
      formData,
      header: buildHeaders(),
      timeout: DEFAULT_TIMEOUT,
      success: (res) => {
        // uni.uploadFile 的 res.data 是**字符串**（原始响应体），必须自己解析
        const body = parseBody(res.data)

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ data: body, status: res.statusCode })
          return
        }

        handleUnauthorized(res.statusCode, body)
        reject(makeError({ status: res.statusCode, body }))
      },
      fail: (err) => {
        reject(makeError({ status: 0, body: null, transportError: err }))
      },
    })

    if (onProgress && task && typeof task.onProgressUpdate === 'function') {
      task.onProgressUpdate((event) => onProgress(event))
    }
  })
}

/**
 * 顺序上传多个文件（每次一个）。
 *
 * 顺序而非并发：文件多时并发上传会挤占上行带宽，反而拖慢整体，
 * 而且后端按到达顺序处理更符合导入类接口的预期。
 *
 * 返回形状与单文件一致：`data.data` 为各次响应的合并结果。
 * 只要有一次 `success === false`，立刻返回那次响应，交给调用方走错误分支。
 */
export async function uploadFiles({
  url,
  name = 'files',
  files = [],
  formData = {},
  onProgress,
}) {
  const responses = []

  for (let index = 0; index < files.length; index += 1) {
    const raw = files[index]
    const path = toUploadPath(raw)

    try {
      const res = await uploadFile({
        url,
        filePath: path,
        name,
        formData,
        onProgress: onProgress
          ? (event) => {
              // 换算成「整体进度」：已完成文件数 + 当前文件的进度
              const perFile = (event.progress || 0) / 100
              onProgress({
                ...event,
                progress: Math.round(((index + perFile) / files.length) * 100),
                fileIndex: index,
              })
            }
          : undefined,
      })

      responses.push(res)

      if (res.data?.success === false) return res
    } finally {
      releaseUploadPath(raw, path)
    }
  }

  return mergeResponses(responses)
}

/** 把多次上传的响应合并成一个，数组型 data 做拼接 */
function mergeResponses(responses) {
  if (!responses.length) return { data: { success: true, data: [] }, status: 200 }

  const last = responses[responses.length - 1]
  const merged = responses.flatMap((res) => {
    const inner = res.data?.data
    if (Array.isArray(inner)) return inner
    return inner == null ? [] : [inner]
  })

  return {
    ...last,
    data: { ...(last.data || {}), data: merged },
  }
}
