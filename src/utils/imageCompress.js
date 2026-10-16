// 选中的照片在**离开手机之前**压一次（2026-10-16 性能审查，变更-077）。
//
// 为什么必须有这一步：系统相册那条路（chooseImages.js 的 pickFromSystemAlbum）拿到的是
// **原图**，没有任何压缩开关 —— 手机拍一张 3~8MB，识别时上传一次、确认入库时**再传一次**。
// 一张单据 5 张图就是 30~80MB 上行。实测本机到服务端的链路上限只有 **3.75 Mbps**
// （4.1MB 的图上传 8.68s），按这个速率一单要 ~85 秒，车间弱网下更久。
//
// 压到「长边 2000px + JPEG q80」之后：用仓库里 4MB 的截图当样本实测为 **187~236KB**
// （原体积的 5~6%），q80 下文字边缘仍然干净（目视过工单号/日期/类型那一屏）。
// 真实单据**照片**（噪声、低对比、文字在画面里占比更小）预计 300~600KB —— 这一档等真机实测，
// 每次压缩都会打一行 console.info 报出前后体积，真机上直接看日志即可核对。
// 按 300~600KB/张算，一单 5 张的上行从 30~80MB 降到 2~5MB（3.75 Mbps 下约 5~10 秒）。
//
// 三条刻意的取舍：
//   ① **只压 App 端**。H5 / 小程序走的是 uni.chooseImage 的 sizeType，压缩由平台自己做，
//      这里再套一层 canvas 只会更慢、且容易在小程序里踩到 canvas 兼容坑。
//   ② **宁可不用压缩，也不能丢图**：任何一步失败（取不到尺寸、原生压缩报错、结果比原图还大、
//      结果 0 字节）都退回原图。压缩是优化，不该成为新的失败点。
//   ③ **压完删原图**：交出去的自始至终只有压缩后的那一份，原图留着只是白占手机存储
//      （picked 目录本来靠 24 小时清理兜底，但没必要等它）。删除前先校验压缩结果可用。

import { isAndroidBridgeAvailable } from './androidContent'

/**
 * 压缩后的长边上限（像素）。
 *
 * 2000 是这个场景的择优值：手机照片长边通常 3000~4000，压到 2000 后单据上的正文
 * （物料名、数量、日期）在腾讯「文档抽取」里仍然清晰；再往下调（1024/1280）小字会开始糊，
 * OCR 识别率下降的代价远大于省下的那点流量。
 */
export const COMPRESS_MAX_EDGE = 2000

/** JPEG 质量（1~100）。80 是体积与文字的常见拐点；调到 60 以下文字边缘会出现明显块状伪影 */
export const COMPRESS_QUALITY = 80

/**
 * 需要压缩时压一次，否则原样返回。
 *
 * <p>入参出参同形（都是 copyContentUriToPrivateDir 的返回值），所以调用点可以直接
 * `files.push(await compressIfNeeded(copied))`，下游完全不用知道自己拿到的是压缩图还是原图。
 *
 * @param {{path: string, url: string, name: string, size: number}} file 已拷进私有目录的原图
 * @returns {Promise<{path: string, url: string, name: string, size: number,
 *                    compressed: boolean, originalSize: number, reason?: string}>}
 */
export async function compressIfNeeded(file) {
  const originalSize = file.size || 0

  if (!isAndroidBridgeAvailable() || typeof plus === 'undefined' || !plus.zip) {
    // H5 / 小程序：压缩交给平台的 sizeType（见文件头 ①）
    return { ...file, compressed: false, originalSize, reason: '平台不支持（交给 sizeType）' }
  }

  let info
  try {
    info = await getImageInfo(file.url)
  } catch (error) {
    return { ...file, compressed: false, originalSize, reason: `取尺寸失败：${error.message}` }
  }

  const width = Number(info.width) || 0
  const height = Number(info.height) || 0
  if (!width || !height) {
    return { ...file, compressed: false, originalSize, reason: '尺寸为 0' }
  }
  if (Math.max(width, height) <= COMPRESS_MAX_EDGE) {
    // 已经够小，重压一遍只会掉质量（相册里的截图、微信另存的图经常就这个量级）
    return { ...file, compressed: false, originalSize, reason: '长边已在上限内' }
  }

  // 只给长边一个值：plus.zip.compressImage 单边取值时按比例缩放，两边都写有被拉伸的风险
  const box =
    width >= height
      ? { width: COMPRESS_MAX_EDGE }
      : { height: COMPRESS_MAX_EDGE }
  const dst = compressedPath(file.path)

  let target
  try {
    target = await runCompress({ src: file.path, dst, quality: COMPRESS_QUALITY, ...box })
  } catch (error) {
    return { ...file, compressed: false, originalSize, reason: `压缩失败：${error.message}` }
  }

  let size = 0
  try {
    size = await getFileSize(`file://${target}`)
  } catch {
    // 取不到大小就当 0，下面的兜底会退回原图
  }

  // 兜底：结果必须是「有字节 且 不比原图大」。不满足就用原图，绝不让压缩把图毁掉
  if (!(size > 0) || (originalSize > 0 && size > originalSize)) {
    removeQuietly(target)
    return { ...file, compressed: false, originalSize, reason: `结果不可用（${size} 字节）` }
  }

  removeQuietly(file.url) // 见文件头 ③

  // 留一条能对得上的日志：真机上量收益 / 排查"为什么这张没压"都靠它
  console.info(
    `[imageCompress] ${width}x${height} ${formatSize(originalSize)} → ${formatSize(size)}` +
      ` (q${COMPRESS_QUALITY}, 长边${COMPRESS_MAX_EDGE})`,
  )

  return {
    path: target,
    url: `file://${target}`,
    name: file.name.replace(/(\.[a-z0-9]+)$/i, '-c$1'),
    size,
    compressed: true,
    originalSize,
  }
}

/** uni.getImageInfo 的 Promise 版（只为取宽高，别的字段不用） */
function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({
      src,
      success: resolve,
      fail: (error) => reject(new Error((error && error.errMsg) || 'getImageInfo fail')),
    })
  })
}

/** plus.zip.compressImage 的 Promise 版。成功回传压缩后的**绝对路径** */
function runCompress(options) {
  return new Promise((resolve, reject) => {
    plus.zip.compressImage(
      { ...options, overwrite: false },
      (result) => {
        if (result && result.target) resolve(result.target)
        else reject(new Error('未返回 target'))
      },
      (error) => reject(new Error((error && error.message) || 'compressImage fail')),
    )
  })
}

/** 读文件字节数（plus.zip 不回报大小，只能自己问一次） */
function getFileSize(url) {
  return new Promise((resolve, reject) => {
    plus.io.resolveLocalFileSystemURL(
      url,
      (entry) => {
        entry.file((file) => resolve(file.size || 0), () => reject(new Error('file() fail')))
      },
      () => reject(new Error('resolve fail')),
    )
  })
}

/** 删文件。删不掉不影响主流程（picked 目录另有 24 小时清理兜底） */
function removeQuietly(url) {
  try {
    plus.io.resolveLocalFileSystemURL(
      url,
      (entry) => {
        try {
          entry.remove()
        } catch {
          /* 忽略 */
        }
      },
      () => {
        /* 忽略 */
      },
    )
  } catch {
    /* 忽略 */
  }
}

/** 压缩产物落回同一个 picked 目录，名字加 -c 后缀，与 copyContentUriToPrivateDir 的命名习惯一致 */
function compressedPath(path) {
  return path.replace(/(\.[a-z0-9]+)$/i, '-c$1')
}

/** 日志里用的人类可读体积 */
function formatSize(bytes) {
  if (!bytes) return '0B'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
