import { computed, onMounted, ref, watch } from 'vue'
import { useVesselList } from './useVesselList'
import { UTubeBundle, shellVolumeMm3 } from '../utils/vesselVolume'

/**
 * 压力容器的**几何与展示模型**（原 WorkOrderList.vue 里「储罐体积计算」那一段）。
 *
 * 拆出来纯粹是因为那一个单文件太长：这段是**纯派生**（台账 → 几何 → 容积 / 说明 /
 * 校验告警），与画布、液位交互无关，所以单独成一份，页面与被 useVesselCanvas 都读它。
 *
 * 容器清单来自**设备台账**（`GET /api/equipment/vessels`，变更-025）—— 以前是写死在
 * 页面里的一个数组，每加一种规格都要改代码 + 出底图 + 重新发版。
 * 现在几何、底图、介质密度都在库里，这里只剩「取数 + 兜底 + 选中项」。
 *
 * ⚠️ 底图坐标（imageBounds）的口径是**原图像素**：`width/height` 是底图原图尺寸，
 *    其余数字用同一把尺子。绘制时是 `s = IMAGE_W / bounds.width`，
 *    所以「按宽度归一化（width=1、height=长宽比）」的旧写法也能用 —— 只要六个数字同尺。
 *    库里现存的行都是像素口径（变更-081 已把实体/VO 上写错的"按宽度归一化"改对）。
 */

/**
 * 液体体积（mm³）：壳体液位体积 − 液面以下换热管所占体积。
 *
 * 两项的实现都在 utils/vesselVolume.js（与小程序仓共用同一份内容），这里只做调用：
 *   · 壳体是闭式解，依据工艺核算公式
 *       V(h) = L[ πr²/2 − (r−h)√(2rh−h²) − r²·arcsin((r−h)/r) ]
 *            + (π·hi)/(3r) · [ 3r²h − r³ + (r−h)³ ]
 *     第一项为筒体（含两端直边）内液体体积，第二项为两端椭圆封头曲面内液体体积合计
 *   · 管束项只有配了 bundle 的罐（再沸器）才有；另两台罐 geometry.bundle 为 null，
 *     减 0，结果与改造前逐位一致
 * 液位入参是 mm，返回 mm³。
 */
export function liquidVolumeMm3(depth, geometry) {
  const shell = shellVolumeMm3(depth, geometry)
  const tubeBundle = geometry.bundle ? geometry.bundle.immersedVolumeMm3(depth) : 0
  return shell - tubeBundle
}

export function useVesselModel() {
  const { vessels, vesselsLoading, vesselsFromCache, loadVessels } = useVesselList()

  // 清单是异步来的，先留空，到位后由下面这个 watch 补上选中项
  const vesselKey = ref('')

  watch(vessels, (list) => {
    if (!list.length) return
    // 只在「当前选中项不在新清单里」时才改 —— 否则每次刷新都会把用户选中的罐顶掉
    if (!list.some((item) => item.key === vesselKey.value)) {
      vesselKey.value = list[0].key
    }
  })

  // 这个页面是**纯前端计算**（公式在本地），台账取不到时会退到本地缓存，见 useVesselList。
  //
  // 每次进这一页都重新取一次容器列表（变更-087）：原先只在整个工作台挂载时取一次，
  // 而「设备数据维护」与「体积计算」是两个 v-show 页签（不共享状态）—— 于是在维护页
  // 刚标定好一台容器并启用，切回计算页，**下拉里还是旧的 4 台**，必须整页刷新才看得到。
  // 按「进入页面」重取，比在两端之间做跨页通知简单得多，也够用。路由化之后
  // 「进入页面」就等于本组件的挂载，所以在 onMounted 里取。
  onMounted(loadVessels)

  // 当前选中的容器。**可能是 null**：清单异步来，且台账取不到时会退到缓存/空。
  // 下游一律走 vesselGeometry，由它在没有选中项时返回一份「空白几何」，避免整页崩掉。
  const selectedVessel = computed(() => {
    const list = vessels.value
    if (!list.length) return null
    return list.find((item) => item.key === vesselKey.value) ?? list[0]
  })

  // 没有选中项时用这份**空白几何**兜住：vesselCapacity / vesselDescription / renderVessel
  // 等全都读它，给 null 会一路崩到模板。形状保证「画不出东西但不炸、也不产生 NaN」
  // （半径、量程都取正数，避免体积公式里出现除以零），界面上另有明确提示。
  const BLANK_VESSEL_GEOMETRY = {
    type: 'horizontal',
    diameter: 1,
    radius: 0.5,
    cylinderLength: 1,
    straightFlange: 0,
    headDepth: 0.25,
    bottomHeadDepth: 0,
    maxLevel: 1,
    imageBounds: { width: 1, height: 1, left: 0, right: 1, top: 0, bottom: 1 },
    displayWidth: 320,
    liquid: { fill: 'transparent', line: 'transparent' },
    medium: '',
    density: null,
    note: '',
    bundle: null,
  }

  // 当前储罐的几何参数（统一两种罐型的字段）
  const vesselGeometry = computed(() => {
    const vessel = selectedVessel.value
    if (!vessel) return BLANK_VESSEL_GEOMETRY

    if (vessel.type === 'vertical') {
      // 下封头可选：150 产品储罐是平底，缺省 0；甲醇计量罐上下都有封头。
      // 液位基准是**罐底最低点**（有下封头时即下封头顶点），所以量程要把下封头那一段算进去。
      // 直边（那 40mm）是等径圆筒段，并入筒体高度 —— 体积与液位映射都按合并后的算
      const bottomHeadDepth = vessel.bottomHeadDepth ?? 0
      const cylinderHeight = vessel.cylinderHeight + 2 * (vessel.straightFlange ?? 0)
      return {
        type: 'vertical',
        diameter: vessel.diameter,
        radius: vessel.diameter / 2,
        cylinderHeight,
        headDepth: vessel.headDepth,
        bottomHeadDepth,
        // 直边已经并进上面那个 cylinderHeight 了（体积与液位映射都用合并后的值），
        // 这里再单独透传一份：对账要按「封头曲面 + 直边」算，缺了它会对不上台账的 head_volume
        straightFlange: vessel.straightFlange ?? 0,
        maxLevel: bottomHeadDepth + cylinderHeight + vessel.headDepth,
        imageBounds: vessel.imageBounds,
        displayWidth: vessel.displayWidth ?? 680,
        liquid: vessel.liquid,
        medium: vessel.medium ?? '',
        density: vessel.density ?? null,
        note: vessel.note ?? '',
      }
    }

    const headTotal = vessel.straightFlange + vessel.headDepth
    return {
      type: 'horizontal',
      diameter: vessel.diameter,
      radius: vessel.diameter / 2,
      cylinderLength: vessel.cylinderLength,
      straightFlange: vessel.straightFlange,
      headDepth: vessel.headDepth,
      headTotal,
      totalLength: vessel.cylinderLength + 2 * headTotal,
      maxLevel: vessel.diameter,
      imageBounds: vessel.imageBounds,
      displayWidth: vessel.displayWidth ?? 680,
      liquid: vessel.liquid,
      medium: vessel.medium ?? '',
      density: vessel.density ?? null,
      note: vessel.note ?? '',
      // 罐内管束：只有再沸器有。构造一次由 computed 缓存，不会每帧重建；
      // 容积计算读它，没配 bundle 的两台罐拿到 null（行为与改造前一致）
      bundle: vessel.bundle ? new UTubeBundle({ ...vessel.bundle }) : null,
    }
  })

  // 立式罐：图形与信息区并排布局（横卧罐图形较宽，保持上下堆叠）
  const isVerticalVessel = computed(() => vesselGeometry.value.type === 'vertical')

  // 画布尺寸：底图宽度 + 右侧引线标注栏
  const VESSEL_CANVAS_WIDTH = 1075
  const VESSEL_LABEL_COLUMN = 300

  /**
   * 画布的高度上限（变更-089）。
   *
   * ⚠️ 为什么必须有这一条：画布原先写的是 `w-full` + `maxWidth` + `aspectRatio` ——
   * **宽度一被拉满，高度就只能由长宽比推出来**，没人管它多高。立式罐（3600×4800）于是得到
   * 680 / 0.75 ≈ **907px** 高，把整页顶出滚动条（使用方 2026-10-16 圈着右边那条滑块问的
   * 就是它：「这个页面也出现了滑块，是因为图片太大了」）。
   *
   * 通用写法（图/画布同理，规则见 DESIGN.md §7）：**不许用宽度定高度**，改成
   * `h-auto w-auto max-w-full` + `max-width` + `max-height` —— 浏览器会在这两个上限里
   * 自动取"保持长宽比的最大一档"，元素矩形永远等于实际绘制区。
   * 这里用 `calc(100vh - 21rem)` 把上限挂到视口上：剩下的 21rem 留给页签头、信息行、
   * 液位读数与底部公式，所以立式罐再高也只占屏幕内、不会撑出页面滚动条。
   * 卧式罐（宽扁）不受影响 —— 它的高度本来就够小，`maxWidth` 先起作用。
   *
   * 变更-090 又把这笔预算收紧到 **20rem**：介质/几何那段说明搬进右栏后，顶部那行的高度
   * 由选择器决定（≈36px）而不是文字（两行 ≈34px），`py` 也从 16px 收到 8px ⇒
   * 实际腾出约 **1rem** —— 常量就跟着减 1rem（诚实对账：减多了会反而溢出，
   * 反倒把页面滚动条又请回来）。
   * ⚠️ 这是本页**唯一的高度调节旋钮**：觉得图偏小就把 rem 调小，觉得页面还滚就调大。
   */
  const CANVAS_MAX_HEIGHT = 'calc(100vh - 20rem)'

  // 画布宽高比（用于 CSS 平滑过渡罐型切换时的高度变化）
  const vesselCanvasAspect = computed(() => {
    const bounds = vesselGeometry.value.imageBounds
    const height = Math.round((VESSEL_CANVAS_WIDTH * bounds.height) / bounds.width)
    return (VESSEL_CANVAS_WIDTH + VESSEL_LABEL_COLUMN) / height
  })

  const vesselCapacity = computed(
    () => liquidVolumeMm3(vesselGeometry.value.maxLevel, vesselGeometry.value) / 1e9,
  )

  // 规格说明（随所选储罐变化）
  const vesselDescription = computed(() => {
    const g = vesselGeometry.value
    // 说明性字段（图纸口径的筒体高与直边、管束根数、铭牌容积）读原始配置：
    // 几何实例上只留计算用到的量 —— 直边在几何里已并进筒体高，显示时得拆回来
    // `?? {}` 兜住「清单还没到」的瞬间（此时各项都取不到，描述会退化成只写几何算得出的部分）
    const raw = selectedVessel.value ?? {}
    const m = (value) => (value / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    const capacity = vesselCapacity.value.toFixed(1)

    const medium =
      g.medium && g.density ? `介质 ${g.medium}（ρ=${g.density} g/cm³，20°C、101.325 kPa）｜` : ''

    if (g.type === 'vertical') {
      const flange = (raw.straightFlange ?? 0) > 0 ? `直边 ${m(raw.straightFlange)}m，` : ''
      // 上下都有封头时两条分开写，免得「封头内高度 0.55m」被当成罐底也是封头
      const heads =
        (g.bottomHeadDepth ?? 0) > 0
          ? `上封头内高度 ${m(g.headDepth)}m，下封头内高度 ${m(g.bottomHeadDepth)}m`
          : `封头内高度 ${m(g.headDepth)}m`
      return `${medium}筒体 φ${m(g.diameter)}m，筒体高度 ${m(raw.cylinderHeight ?? g.cylinderHeight)}m，${flange}${heads}，总容积 ${capacity} m³`
    }

    // 直边为 0 时不写这一项，免得出现「直边 0m」
    const flange = g.straightFlange > 0 ? `直边 ${m(g.straightFlange)}m，` : ''

    // 带管束的罐（再沸器）：capacity 是**扣掉管束后的净值**，必须写明，
    // 否则会被当成毛容积用。管束与铭牌的说明性字段读原始配置（实例上只留计算用到的量）。
    const bundleConfig = raw.bundle
    const bundle =
      bundleConfig && g.bundle
        ? `；罐内 U 型管束 ${bundleConfig.tubeCount} 根 ${bundleConfig.tubeSpec}` +
          `（罐内 ${m(bundleConfig.tubeLengthMm)}m/根），全浸没挤占 ${(g.bundle.totalVolumeMm3 / 1e9).toFixed(4)} m³` +
          ` —— 上述体积与总容积均已扣除管束`
        : ''
    // 数据表的铭牌全容积。只作对照、不参与计算 —— 它与按几何算出的总容积对不上，
    // 所以必须带上「数据表值」这半句，否则会被当成程序算错了
    const nameplate = raw.nameplateVolume
      ? `；铭牌全容积 ${raw.nameplateVolume} m³（数据表值，仅作对照、不参与计算）`
      : ''

    return `筒体 l=${m(g.cylinderLength)}m，φ${m(g.diameter)}m，${flange}封头内高度 hi=${m(g.headDepth)}m，总容积 ${capacity} m³${nameplate}${bundle}`
  })

  // 录入对账：台账里的 head_volume 是**单个封头的「曲面 + 直边」**容积（源台账给的，不是我们编的），
  // 按同一口径用当前几何自己算一遍，对不上就说明库里的几何填错了。
  // 这是白捡的校验 —— 几何一填错（内径多打个 0、封头深忘了改）立刻看得见，
  // 否则要等到有人拿它算体积时才发现，而那时数值已经错了。
  // 台账没给 head_volume 的行（如 150产品罐是平底、源表未给）跳过，不误报。
  const RECONCILE_TOLERANCE = 0.01 // 1%：图纸取值与源台账的舍入差远小于这个
  const vesselReconcileWarning = computed(() => {
    const expected = selectedVessel.value?.headVolumeForCheck
    if (!expected) return ''

    const g = vesselGeometry.value
    const r = g.radius
    const head = g.headDepth
    if (!r || !head) return ''

    // 单位：r / head / straightFlange 都是 mm，算出来是 mm³，除以 1e9 得 m³
    const computedM3 =
      ((2 / 3) * Math.PI * r * r * head + Math.PI * r * r * (g.straightFlange ?? 0)) / 1e9
    const diff = Math.abs(computedM3 - expected) / expected
    if (diff <= RECONCILE_TOLERANCE) return ''

    return (
      `几何参数与台账对不上：按几何算出的封头容积是 ${computedM3.toFixed(4)} m³，` +
      `台账记的是 ${expected} m³（差 ${(diff * 100).toFixed(1)}%）。` +
      `请核对台账里这台容器的内径 / 封头曲面深 / 直边。`
    )
  })

  // 台账标了「带内置管束」（container_type=4）却取不到管束参数 —— 那会**静默不扣**管内排液体积
  // （再沸器满罐偏大约 1.9%），页面上看不出任何异常。管束参数目前还在前端的临时表里
  // （见 useVesselList 的 BUNDLE_BY_ID，待台账加列后删除），所以新增同类容器时最容易漏配。
  const vesselBundleWarning = computed(() => {
    const vessel = selectedVessel.value
    if (vessel?.containerType === 4 && !vessel.bundle) {
      return '这台容器在台账里标了「带内置管束」，但取不到它的管束参数，体积没有扣除管内排液体积 —— 请补录。'
    }
    return ''
  })

  // 公式块下方那句说明。页面上方那个式子算的是**壳体**体积，而配了管束的罐（再沸器）
  // 读数还要再扣掉管束 —— 说明必须跟着变，否则「程序按此式实时计算液体体积」
  // 与旁边的读数对不上，会被当成算错了。
  // 写成 computed 而不是模板里的 v-if：小程序端对块级条件渲染的编译支持面更窄，
  // 插值在三端行为完全一致。
  const vesselFormulaCaption = computed(() =>
    vesselGeometry.value.bundle
      ? '程序按此式算出壳体体积，再扣除液面以下的换热管体积 —— 两者之差才是上表的有效液体体积'
      : '程序按此式实时计算液体体积',
  )

  return {
    vessels,
    vesselsLoading,
    vesselsFromCache,
    vesselKey,
    selectedVessel,
    vesselGeometry,
    isVerticalVessel,
    VESSEL_CANVAS_WIDTH,
    VESSEL_LABEL_COLUMN,
    CANVAS_MAX_HEIGHT,
    vesselCanvasAspect,
    vesselCapacity,
    vesselDescription,
    vesselReconcileWarning,
    vesselBundleWarning,
    vesselFormulaCaption,
  }
}
