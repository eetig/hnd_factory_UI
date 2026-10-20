/**
 * 拍照水印：把「时间 + 地点」画进图片**本身**。
 *
 * <p>为什么不能用 CSS/遮罩叠一层：水印的用途是"这张照片出自何时何地"的证据，
 * 照片会经微信、相册、聊天记录流转出去，只有烧进像素里才跟着走。
 *
 * <p>为什么能失败就退回原图：水印是**增强**，不是功能前提。任何一环取不到
 * （平台不支持 canvas 导出、图片读不出尺寸、原生报错、导出 0 字节），
 * 都必须原样返回原路径 —— 绝不能因为加不上水印而让照片丢了（同 imageCompress 的取舍）。
 *
 * <p>平台差异：走的是 uni 的**旧版 canvas 接口**（createCanvasContext / canvasToTempFilePath），
 * 它是三端都实现的那一套；新版 type="2d" canvas 在小程序上性能好、但 App/H5 写法不同，
 * 为了"一套代码三端都跑"选了前者。画布是调用方提供的隐藏节点，尺寸由本函数回填。
 */

/**
 * 水印画布的固定边长（px）。
 *
 * <p>⚠️ 必须固定，不能"按图片尺寸动态改 canvas 的 style"：实测（H5）uni-canvas 的
 * **像素尺寸在挂载那一刻就定了**，之后改 style 只会改 CSS 盒子，导出时拿到的还是
 * 原来的 backing store —— 结果是「左上角一小块图 + 大片白」。
 * 所以画布固定成上限尺寸、图按需缩放画在左上角，导出时只取绘制区域
 * （canvasToTempFilePath 的 x/y/width/height）。
 *
 * <p>1024 是"看得清表盘/铭牌"与"低端机内存（1024²×4 ≈ 4 MB）"的折中。
 */
export const CANVAS_EDGE = 1024

/** 单边上限 = 画布边长：超过就缩，避免画到画布外面去 */
const MAX_EDGE = CANVAS_EDGE

/** JPEG 质量：0.88 是"文字边缘干净"与"体积可控"的折中（q80 时小字会糊） */
const JPEG_QUALITY = 0.88

/**
 * 画一张带水印的图。
 *
 * @param {object} options
 * @param {string} options.path        原图临时路径
 * @param {string[]} options.lines     水印文字，最多两行（第一行通常是时间，第二行是地点）
 * @param {string} options.canvasId    隐藏 canvas 的 canvas-id（尺寸固定为 CANVAS_EDGE）
 * @param {object} [options.instance]  组件实例（uni 的 canvas API 在组件里要传 this）
 * @returns {Promise<string>} 新图片路径；失败时**返回原路径**
 */
export async function watermarkPhoto({ path, lines, canvasId, instance }) {
  const fallback = path

  try {
    const size = await readImageSize(path)
    if (!size.width || !size.height) return fallback

    const scale = Math.min(1, MAX_EDGE / Math.max(size.width, size.height))
    const width = Math.max(1, Math.round(size.width * scale))
    const height = Math.max(1, Math.round(size.height * scale))

    const ctx = uni.createCanvasContext(canvasId, instance)
    if (!ctx) return fallback

    ctx.drawImage(path, 0, 0, width, height)
    drawStamp(ctx, width, height, lines)

    // 画完必须**等这次 draw 的回调**再导出：uni 的 draw 是异步落盘，
    // 抢跑会导出一张空白画布；而 exportCanvas 里绝不能再 createCanvasContext 一个
    // 新上下文去 draw —— 新上下文没有排队的绘制指令，会把刚画好的内容冲掉。
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('canvas draw 超时')), 4000)
      ctx.draw(false, () => {
        clearTimeout(timer)
        resolve()
      })
    })

    const output = await exportCanvas({ canvasId, instance, width, height })
    return (await toUsablePath(output)) || fallback
  } catch (error) {
    // 水印失败不影响取证：原图照常上传，控制台留一行便于真机排查
    console.info('[watermark] 已跳过水印，使用原图：', error?.message || error)
    return fallback
  }
}

/** 读原始尺寸（getImageInfo 三端都有；失败抛错交给上层兜底） */
function readImageSize(path) {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({
      src: path,
      success: (res) => resolve({ width: res.width, height: res.height }),
      fail: reject,
    })
  })
}

/**
 * 在画布上画水印：底部压一条半透明墨条 + 两行白字。
 *
 * <p>用**实色半透明**而不是渐变：渐变对象在不同平台/基础库上的支持面不一致，
 * 一旦不认就是一整块黑底或者干脆不画，比"不够精致"严重得多。
 *
 * @param {number} width  画布宽（已缩放）
 * @param {number} height 画布高
 * @param {string[]} lines 文字行（最多两行，第一行更粗更大）
 */
function drawStamp(ctx, width, height, lines) {
  const textLines = (lines || []).filter((line) => String(line ?? '').trim()).slice(0, 2)
  if (!textLines.length) return

  // 尺寸随图缩放：小图别把字画得满屏，大图也别小到看不清
  const base = Math.max(width, height)
  const primary = clamp(Math.round(base * 0.032), 20, 56)
  const secondary = Math.round(primary * 0.82)
  const lineGap = Math.round(primary * 0.42)
  const padding = Math.round(base * 0.022)
  const barHeight = Math.round(primary + lineGap + secondary + padding * 1.8)

  // 1) 底部墨条：压暗背景，白字才在任何画面上都读得出
  ctx.setFillStyle('rgba(0, 0, 0, 0.42)')
  ctx.fillRect(0, height - barHeight, width, barHeight)

  // 2) 左侧一条强调竖线，像是"取证条"的起手，也让两行字有对齐基准
  ctx.setFillStyle('rgba(255, 255, 255, 0.85)')
  ctx.fillRect(padding, height - barHeight + padding * 0.9, Math.max(2, Math.round(primary * 0.12)),
    barHeight - padding * 1.8)

  const textX = padding + Math.max(6, Math.round(primary * 0.5))

  // 3) 第一行（时间）：更粗
  ctx.setFontSize(primary)
  ctx.setFillStyle('#ffffff')
  ctx.setTextAlign('left')
  ctx.setTextBaseline('top')
  ctx.fillText(textLines[0], textX, height - barHeight + padding)

  // 4) 第二行（地点）：略小、略淡
  if (textLines[1]) {
    ctx.setFontSize(secondary)
    ctx.setFillStyle('rgba(255, 255, 255, 0.86)')
    ctx.fillText(textLines[1], textX, height - barHeight + padding + primary + lineGap)
  }
}

/** 导出画布为临时文件；三端都认 fileType=jpg */
function exportCanvas({ canvasId, instance, width, height }) {
  return new Promise((resolve, reject) => {
    uni.canvasToTempFilePath(
      {
        canvasId,
        x: 0,
        y: 0,
        width,
        height,
        destWidth: width,
        destHeight: height,
        fileType: 'jpg',
        quality: JPEG_QUALITY,
        success: (res) => resolve(res.tempFilePath || ''),
        fail: reject,
      },
      instance,
    )
  })
}

/**
 * 把导出结果变成"上传链路认得的路径"。
 *
 * <p>H5 的 canvasToTempFilePath 回的是 **data: URL**（base64），而上传链路
 * （uni.uploadFile）吃的是 chooseImage 那种临时路径 / blob URL。实测 data URL 直接
 * 交给 uni.uploadFile 会走不通，所以这里转成 blob URL —— 与相册选出来的路径同构。
 * App / 小程序回的是真实临时文件路径，原样返回。
 */
async function toUsablePath(path) {
  if (!path) return ''
  // #ifdef H5
  if (path.startsWith('data:')) {
    try {
      const blob = await (await fetch(path)).blob()
      return URL.createObjectURL(blob)
    } catch {
      return path
    }
  }
  // #endif
  return path
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 水印文字：`2026-10-20 11:39` + `包装车间 · 171产品包装罐A/B`。
 *
 * <p>地点取自**表单里的属地/容器名称**，不取 GPS：
 * 车间里 GPS 基本无信号、定位权限还要额外申请（manifest 也没声明），
 * 而"哪台罐、哪个车间"恰恰是这台设备记在表上的信息，比坐标更有用。
 */
export function buildStampLines({ time, location, tankName }) {
  const place = [location, tankName]
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .join(' · ')
  return [time, truncate(place, 28)]
}

function truncate(text, max) {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
