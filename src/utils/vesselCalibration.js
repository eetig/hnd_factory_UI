/**
 * 底图标定的纯计算（变更-082）。
 *
 * 背景：体积计算页的液面是按「罐体轮廓框 + 筒体上下切线」画到图上的
 * （见 composables/useVesselCanvas.js 的 renderVessel），而这四个/六个数字原先只能靠人手工按图量、
 * 再手写进 image_bounds —— 手填必然错位，且错位不报错。本模块给标定界面提供：
 *   · 没有现成坐标时的**初始框**；
 *   · 按几何**反推上下切线**的初值（人再微调）；
 *   · 组装/解析坐标 JSON（与后端 VesselBounds 的口径一致：**原图像素**）；
 *   · 拖拽时的边界收拢（框不许拖出图外、切线不许跑出框外）。
 *
 * ⚠️ 坐标口径是**原图像素**：`{width, height}` 是底图原图尺寸，其余数字都用这把尺子。
 * 体积计算页按 `s = IMAGE_W / bounds.width` 换算，所以「按宽度归一化（width=1）」的
 * 旧写法也能用 —— 但本模块统一产出像素口径，与库里现存 4 行一致。
 */

/** 立式容器（2 平底立式 / 3 立式）才需要上下切线；卧式（1）与再沸器（4）不需要 */
export function showsTangents(containerType) {
  return containerType === 2 || containerType === 3
}

/** 解析坐标：入参可以是 JSON 字符串、对象或空；坏数据一律返回 null（不抛） */
export function parseBounds(raw) {
  if (!raw) return null
  let obj = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null
  const nums = {}
  for (const key of ['width', 'height', 'left', 'right', 'top', 'bottom', 'tangent', 'tangentBottom']) {
    const v = obj[key]
    if (v === undefined || v === null) continue
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    nums[key] = n
  }
  for (const key of ['width', 'height', 'left', 'right', 'top', 'bottom']) {
    if (!(key in nums)) return null
  }
  if (nums.width <= 0 || nums.height <= 0) return null
  return nums
}

/**
 * 没有现成坐标时的初始框：居中的一列。
 *
 * 为什么是「居中一列」而不是「整张图」：待标定的图是 CAD 导出的轮廓图，
 * 四周有留白（实测左侧留白 15%~27%），右下角还有水印 —— 整张图当罐体画出来必然错位。
 * 这一列只是**起点**，标定界面里可以整框拖、可以拉四条边。
 */
export function defaultBox(imgW, imgH) {
  return {
    left: Math.round(imgW * 0.3),
    right: Math.round(imgW * 0.72),
    top: Math.round(imgH * 0.04),
    bottom: Math.round(imgH * 0.96),
  }
}

/**
 * 按几何反推上下切线（返回像素坐标；不适用时返回空对象）。
 *
 * 依据：库里 4 台在用的容器，其坐标都满足
 *   「轮廓框高 ↔ 上封头曲面深 + 筒体直段长 + 下封头曲面深」，
 *   「上切线 = 框顶 + 上封头深 × 比例」、「下切线 = 框底 − 下封头深 × 比例」。
 * 拿真实数据验算（674 甲醇计量罐：框 83~1247、上封头 550、筒体 3400、下封头 550）：
 *   比例 = 1164 / 4500 = 0.2587 → 自动算出上切线 225.3、下切线 1104.7，
 *   人工标的是 218 / 1114 —— 差 2% 以内（图纸并非严格按比例画），够当起点。
 *
 * ⚠️ 只是**初值**：标定界面允许拖着两条线微调（图纸不按比例时以人眼为准）。
 */
export function deriveTangents(box, geometry = {}) {
  const topHead = num(geometry.topHeadDepth)
  const shell = num(geometry.shellLength)
  const bottomHead = num(geometry.bottomHeadDepth)
  const boxHeight = box.bottom - box.top
  if (!(boxHeight > 0) || topHead === null || shell === null) return {}

  const total = topHead + shell + (bottomHead ?? 0)
  if (!(total > 0)) return {}

  const scale = boxHeight / total
  const result = { tangent: round1(box.top + topHead * scale) }
  // 平底（无下封头）没有下切线 —— 与后端门槛、体积计算页的判定一致
  if (bottomHead !== null && bottomHead > 0) {
    result.tangentBottom = round1(box.bottom - bottomHead * scale)
  }
  return result
}

/** 拖拽用：把框收拢在图内，并保证不塌成一条线（至少留 8px） */
export function clampBox(box, imgW, imgH, min = 8) {
  const out = { ...box }
  out.left = Math.min(Math.max(0, out.left), imgW - min)
  out.right = Math.min(Math.max(out.left + min, out.right), imgW)
  out.top = Math.min(Math.max(0, out.top), imgH - min)
  out.bottom = Math.min(Math.max(out.top + min, out.bottom), imgH)
  return out
}

/** 把一个数夹到 [min, max] */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/**
 * 组装要存进 `image_bounds` 的 JSON（原图像素）。
 *
 * 切线只在**立式**且数值有效、且落在框内时才带上：多带一个没用的键，
 * 只会让体积计算页多一条要判断的分支。
 */
export function boundsPayload({ imgW, imgH, box, containerType, tangents = {} }) {
  const payload = {
    width: Math.round(imgW),
    height: Math.round(imgH),
    left: round1(box.left),
    right: round1(box.right),
    top: round1(box.top),
    bottom: round1(box.bottom),
  }
  if (showsTangents(containerType)) {
    const t = num(tangents.tangent)
    if (t !== null && t > box.top && t < box.bottom) payload.tangent = round1(t)
    const tb = num(tangents.tangentBottom)
    if (tb !== null && tb > box.top && tb < box.bottom && (payload.tangent === undefined || tb > payload.tangent)) {
      payload.tangentBottom = round1(tb)
    }
  }
  return JSON.stringify(payload)
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round1(v) {
  return Math.round(Number(v) * 10) / 10
}
