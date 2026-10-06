import { ref } from 'vue'
import request from '../api/request'

// ===== 容器列表（压力容器体积计算页的下拉候选）=====
//
// 数据源是设备台账 `equipment_ledger`（`GET /api/equipment/vessels`，变更-025）——
// 以前这份清单是**写死在 WorkOrderList.vue 里**的，每加一种规格都要改代码 + 出图 + 重新发版。
//
// ⚠️ 为什么必须有本地缓存：这个页面是**纯前端计算**（公式在 utils/vesselVolume.js，
//    后端挂了照样能算）。数据源一改成接口，没有降级就变成「后端一挂、下拉空、页面废」。
//
// 与 uni-app 仓那份是**同一套语义**（两边各自维护）：配色、文案、字段映射保持一致，
// 免得同一个容器在两端显示成两个样子。

const CACHE_KEY = 'hnd.vesselList.v1'

/**
 * 底图：把 `src/assets/vessel*.png` 建成「文件名 → 打包后 URL」的映射。
 *
 * 为什么用 glob 而不是像以前那样逐个 `import`：**文件名现在来自数据库**，
 * 编译期不知道会有哪几张。以后加容器只要把图丢进 assets 目录即可，不必改这里。
 */
const VESSEL_IMAGES = import.meta.glob('../assets/vessel*.png', {
  eager: true,
  import: 'default',
})

/**
 * 底图地址。两种来源（2026-10-06 起 `image_file` 有两种形态）：
 *   · **纯文件名**（`vessel.png`）—— 内置底图，走下面的 glob 映射到打包后的资源
 *   · **以 `/` 开头**（`/files/xxx.png`）—— 维护页上传的，由 img-service 存 MinIO、
 *     Nginx 同源暴露。**原样返回**：dev 走 vite 代理的 `/files`、生产走 Nginx，都不必加工。
 */
function imageUrlOf(fileName) {
  if (!fileName) return ''
  if (/^(https?:)?\/\//i.test(fileName) || fileName.startsWith('/')) return fileName
  return VESSEL_IMAGES[`../assets/${fileName}`] ?? ''
}

/**
 * 底图地址（对外版）。
 *
 * 导出给「设备数据维护」页的缩略图用 —— 那边拿到的 `image_file` 与这边同源，
 * 解析规则必须一致，否则会出现「维护页看得到缩略图、体积计算页却没有图」这种灵异现象。
 * 未配底图或内置资源缺失时返回空串，由调用方决定显示占位。
 */
export function vesselImageUrl(fileName) {
  return imageUrlOf(fileName)
}

/**
 * 液面配色：`id % PALETTE.length` 取色。
 *
 * ⚠️ **这个顺序不是随手排的，别「顺手整理」** —— 它让现有四台罐的 id 恰好落回原本的颜色：
 *    甲醇计量罐 37 → 1 淡紫、再沸器 548 → 2 琥珀、三氯氢硅储罐 87 → 3 黄绿、
 *    150产品罐 89 → 5 青。槽位 0 / 4 留给后来者。
 *    重排调色板会让所有容器的颜色在页面上一起跳一遍。
 */
const PALETTE = [
  { fill: 'rgba(96, 165, 250, 0.3)', line: '#60a5fa' }, // 0 蓝
  { fill: 'rgba(167, 139, 250, 0.3)', line: '#a78bfa' }, // 1 淡紫 ← 甲醇计量罐
  { fill: 'rgba(251, 191, 36, 0.3)', line: '#f59e0b' }, // 2 琥珀 ← 再沸器
  { fill: 'rgba(208, 226, 128, 0.28)', line: '#a6cb3c' }, // 3 黄绿 ← 三氯氢硅储罐
  { fill: 'rgba(251, 113, 133, 0.3)', line: '#fb7185' }, // 4 玫红
  { fill: 'rgba(0, 255, 255, 0.4)', line: '#00ffff' }, // 5 青 ← 150产品罐
]

/**
 * 展示层特例（按 equipment id）—— 只放**画不出来、只能靠人写**的东西：备注文案、显示宽度。
 * 几何与介质密度不在这里，那些是数据。
 * 新容器没进这张表也能正常显示：备注按几何自动生成，显示宽度按底图长宽比算。
 */
const STYLE_BY_ID = {
  87: {
    note: '三氯氢硅，若用于 SIS 联锁、储罐容积、物料衡算、泄放计算，工程上直接采用：20℃，101.325kPa，ρ=1.35 g/cm³',
  },
  89: {
    note: '乙烯基三氯硅烷，基准条件：20℃，101.325 kPa（常压），液体密度 1.27 g/cm³；物性来源：GB/T 35498-2017《工业用乙烯基三氯硅烷》。',
  },
  37: {
    note: '甲醇，20℃，101.325 kPa，ρ=0.792 g/cm³。上下封头均为标准椭圆封头（曲面深 D/4=0.55m，两端各带 40mm 直边）；液位自罐底最低点（下封头顶点）量起，量程 0~4580mm。',
  },
  548: {
    note: '有效液体体积已扣除罐内 U 型管束的排液体积：87 根 φ25，罐内 2 程 × 3.6m（折流板区间 8 × 450mm），全浸没时挤占 0.3075 m³。管箱在容器外部，不计入。铭牌全容积 21.2 m³ 取自数据表，与按几何算出的壳体容积 18.30 m³ 不一致，不参与本页计算。',
  },
}

/**
 * ⚠️ **临时覆盖表 —— 待台账加上管束列后删除**（变更-025 明确登记的技术债）。
 *
 * 再沸器壳体内有 87 根 U 型管，算体积时要扣掉浸在液相里那部分。这套参数本该书跟着容器
 * 一起进库，本期没做，先按 id 挂在这里。**不做这件事的后果不是「少个功能」，是静默算错**：
 * 容积会偏大 0.3075 m³（满罐约 1.9%），页面上看不出任何异常。
 *
 * 与 uni-app 仓那张表内容必须一致 —— 两边不一致会让同一台罐在两端算出不同的数。
 */
const BUNDLE_BY_ID = {
  548: {
    tubeSpec: 'φ25，2 程 × 4.4m 直管段',
    tubeOuterDiameter: 25,
    tubeLengthMm: 7200,
    tubeCount: 87,
    circleCenterY: 315,
    circleRadius: 275,
  },
}

/** 渲染类型：台账的 container_type 兼作朝向（1 或 4 = 卧式，2/3 = 立式），带不带下封头看几何 */
export function renderKindOf(row) {
  // 4 = 卧式带内置管束（再沸器那一种）。**朝向与画法与 1 完全相同**，
  // 区别只在算体积时要扣掉管内排液体积（见 bundle）。漏判 4 的后果不是「少个功能」，
  // 是把它画成立式罐 —— 液位轴整个换了方向，一眼看不出错。
  if (row.containerType === 1 || row.containerType === 4) return 'horizontal'
  return row.bottomHeadDepth > 0 ? 'vertical-bottom-head' : 'vertical-flat'
}

function buildNote(row, styleNote) {
  if (styleNote) return styleNote
  const parts = []
  if (row.medium && row.density) parts.push(`${row.medium}，ρ=${row.density} g/cm³`)
  parts.push(row.containerType === 1 ? '卧式容器' : '立式容器')
  parts.push(
    renderKindOf(row) === 'vertical-bottom-head'
      ? '上下封头均为标准椭圆封头；液位自罐底最低点（下封头顶点）量起'
      : '液位自罐底量起',
  )
  return parts.join('。') + '。'
}

/** 显示宽度：按底图长宽比反推，让渲染高度不超过预算（长宽比大的罐自然更窄） */
const MAX_ASPECT_HEIGHT = 820
function pickDisplayWidth(bounds) {
  const aspect = bounds.height / bounds.width
  return Math.min(680, Math.max(320, Math.round(MAX_ASPECT_HEIGHT / aspect)))
}

/**
 * 台账一行 → 页面用的容器选项（**纯函数**，有单测）。
 * 字段名沿用改造前 VESSELS 的那套，页面其余部分不用改。
 */
export function toVesselOption(row) {
  if (!row || !row.id || !row.imageBounds) return null

  let bounds
  try {
    bounds = typeof row.imageBounds === 'string' ? JSON.parse(row.imageBounds) : row.imageBounds
  } catch {
    // 坐标是 JSON 列，理论上不会坏；坏掉就跳过这台，别让整个下拉打不开
    return null
  }

  const kind = renderKindOf(row)
  const style = STYLE_BY_ID[row.id] ?? {}
  const image = imageUrlOf(row.imageFile)
  if (!image) return null // 台账配了图但本仓 assets 里没有 → 宁可不出现在下拉里

  return {
    key: String(row.id), // 用 id 不用名称：台账里有两行都叫「150产品罐」
    type: kind === 'horizontal' ? 'horizontal' : 'vertical',
    // 台账口径的容器类型（1卧式 2平底 3其他 4卧式带管束）—— 页面用它做「标了带管束却没参数」的提示
    containerType: row.containerType,
    label: row.name,
    diameter: Number(row.diameter),
    radius: Number(row.diameter) / 2,
    // 卧式叫 cylinderLength、立式叫 cylinderHeight —— 库里是同一个 shell_length
    cylinderLength: Number(row.shellLength),
    cylinderHeight: Number(row.shellLength),
    straightFlange: Number(row.straightFlange ?? 0),
    headDepth: Number(row.topHeadDepth),
    bottomHeadDepth: Number(row.bottomHeadDepth ?? 0),
    image,
    imageBounds: bounds,
    displayWidth: style.displayWidth ?? pickDisplayWidth(bounds),
    liquid: PALETTE[row.id % PALETTE.length],
    medium: row.medium ?? '',
    density: row.density ? Number(row.density) : null,
    note: buildNote(row, style.note),
    bundle: BUNDLE_BY_ID[row.id] ? { ...BUNDLE_BY_ID[row.id] } : null,
    // 仅用于对账（比对按几何算出的封头容积），不参与体积计算
    headVolumeForCheck: row.headVolume ? Number(row.headVolume) : null,
    // 台账「容积」列。本页只作对照值展示 —— 再沸器的铭牌全容积就放这一列
    nameplateVolume: row.volume ? Number(row.volume) : null,
  }
}

export function toVesselOptions(rows) {
  return (Array.isArray(rows) ? rows : []).map(toVesselOption).filter(Boolean)
}

// 模块级单例：一个页面只取一次
const vessels = ref([])
const vesselsLoading = ref(false)
const vesselsFromCache = ref(false) // true = 走的是缓存或空，界面上要挂个提示

function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(options) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(options))
  } catch {
    // 缓存写不进去不影响本次使用（比如隐私模式），下次再取就是了
  }
}

/**
 * 拉取容器列表。**失败不抛**，而是退到本地缓存 —— 这个页面没网也得能用。
 *
 * 注意**不做内置兜底清单**：再抄一份几何放在代码里，就会和库里的值各说各话
 * （改一处忘一处），比空列表更危险。缓存已经覆盖了「后端暂时不可用」这个常见情形，
 * 且界面上会明确标出「这是缓存」。
 */
export async function loadVessels() {
  vesselsLoading.value = true
  try {
    const res = await request.get('/api/equipment/vessels')
    const options = toVesselOptions(res.data?.data)
    if (!options.length) throw new Error('empty') // 台账还没填几何，同样走缓存分支
    vessels.value = options
    vesselsFromCache.value = false
    writeCache(options)
    return options
  } catch {
    const cached = readCache()
    vessels.value = cached?.length ? cached : []
    vesselsFromCache.value = true
    return vessels.value
  } finally {
    vesselsLoading.value = false
  }
}

export function useVesselList() {
  return { vessels, vesselsLoading, vesselsFromCache, loadVessels }
}
