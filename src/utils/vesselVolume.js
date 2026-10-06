// 压力容器液位体积计算。
//
// 为什么单独成模块：这段逻辑原先内联在 WorkOrderList.vue（PC）与 index.vue（uni-app）里，
// 两套前端各一份。再沸器要在壳体体积上再减掉「浸在液相中的 U 型管束」，
// 弓形面积 + 布管这批几何代码再各抄一遍到两个 .vue 里就没法维护了 ——
// 抽成纯 JS（不依赖 Vue / DOM），两仓共用同一份内容。
//
// 单位约定：内部一律 mm / mm³（与 VESSELS 配置、液位输入一致），
// 只在 Reboiler 的 M3 helper 里除以 1e9 换成 m³。

const SQRT3_OVER_2 = Math.sqrt(3) / 2
const EPS = 1e-9
const MM3_PER_M3 = 1e9

/**
 * 立式容器的液位体积：下封头段 + 筒体段 + 上封头段。
 *
 * 液位基准是**罐底最低点**（有下封头时就是下封头的顶点，没有时就是平底）——
 * 这是唯一说得通的口径：若以下封头与筒体的切线为 0 点，那么液位一读 0
 * 下封头里其实积着液体，量与读数自相矛盾。
 *
 * geometry.bottomHeadDepth 缺省为 0（平底/无下封头，即改造前的两台立式罐），
 * 此时下面的表达式与改造前的内联实现逐位相同。
 */
function verticalVolumeMm3(h, geometry) {
  const r = geometry.radius
  const bottomHead = geometry.bottomHeadDepth || 0

  // 下封头段：半椭球自顶点起的液体体积 V(z) = πr²( z²/hi − z³/(3hi²) )，
  // z = hi 时退化为 (2/3)πr²hi —— 正是半个椭球的体积
  let bottomPart = 0
  if (bottomHead > 0) {
    const z = Math.min(h, bottomHead)
    bottomPart =
      Math.PI * r * r * ((z * z) / bottomHead - Math.pow(z, 3) / (3 * bottomHead * bottomHead))
    // 液面还在下封头里：到此为止。
    // ⚠️ 这一句不能省 —— 少了它，下面 shellLevel = h − bottomHead 会是负数，
    //    被 Math.min 带进筒体段算出**负体积**（测试正是这么抓到的）
    if (h <= bottomHead) return bottomPart
  }

  // 筒体段：液位扣掉下封头那一段后，相对下封头切线的高度
  const shellLevel = h - bottomHead
  const cylinderPart = Math.PI * r * r * Math.min(shellLevel, geometry.cylinderHeight)
  if (shellLevel <= geometry.cylinderHeight) return bottomPart + cylinderPart

  // 上封头段：t 为液面高出上封头切线的高度
  const t = shellLevel - geometry.cylinderHeight
  const hi = geometry.headDepth
  const headPart = Math.PI * r * r * (t - Math.pow(t, 3) / (3 * hi * hi))
  return bottomPart + cylinderPart + headPart
}

/**
 * 壳体（筒体 + 两端椭圆封头）的液位体积，mm³。
 *
 * 闭式解，与改造前内联版本逐位一致（重构不许改数，见 tests/unit/vesselVolume.spec.js 的回归护栏）：
 *   V(h) = L[ πr²/2 − (r−h)√(2rh−h²) − r²·arcsin((r−h)/r) ]
 *        + (π·hi)/(3r) · [ 3r²h − r³ + (r−h)³ ]
 * 第一项为筒体（含两端直边）内液体体积，第二项为两端椭圆封头曲面内液体体积合计。
 *
 * @param {number} levelMm 液位高度（mm，自罐底最低点量起）
 * @param {object} geometry 几何参数：type / radius / maxLevel，卧式另有 cylinderLength、
 *                          straightFlange、headDepth，立式另有 cylinderHeight、headDepth，
 *                          立式可另给可选的 bottomHeadDepth（下封头曲面深度）
 */
export function shellVolumeMm3(levelMm, geometry) {
  const r = geometry.radius
  const h = Math.max(0, Math.min(geometry.maxLevel, Number(levelMm) || 0))
  if (h <= 0) return 0

  // 立式容器：下封头（可选）+ 等径圆柱筒体 + 上封头
  if (geometry.type === 'vertical') {
    return verticalVolumeMm3(h, geometry)
  }

  // 卧式储罐：闭式解，依据工艺核算公式
  const straightLength = geometry.cylinderLength + 2 * geometry.straightFlange
  const sqrtTerm = Math.sqrt(Math.max(0, 2 * r * h - h * h))
  const asinTerm = Math.asin(Math.max(-1, Math.min(1, (r - h) / r)))

  const cylinder =
    straightLength * ((Math.PI * r * r) / 2 - (r - h) * sqrtTerm - r * r * asinTerm)
  const heads =
    ((Math.PI * geometry.headDepth) / (3 * r)) *
    (3 * r * r * h - Math.pow(r, 3) + Math.pow(r - h, 3))

  return cylinder + heads
}

/**
 * 在半径 usableRadius 的圆内按正三角形铺一层管中心点，圆心在原点。
 *
 * 行距 pitch·√3/2，奇数行相对偶数行错开半个节距 —— 所以对中行（y = 0）的管子落在
 * 0, ±pitch, ±2·pitch …（根数为奇数），错开行的管子落在 ±(pitch/2 + k·pitch)（根数为偶数）。
 *
 * 注意 usableRadius 传的是「管中心可落点半径」= 布管圆半径 − 管外半径：
 * 布管圆界定的是管束**外缘**，而包络区间的上下界（Y ∈ [bottom, top]）说的是外缘，
 * 两者差一个管半径。见 UTubeBundle 的 spanBottomMm / spanTopMm 推导。
 */
function latticeRows(pitchMm, usableRadius) {
  const rowGap = pitchMm * SQRT3_OVER_2
  const maxRowIndex = Math.ceil(usableRadius / rowGap) + 1
  const rows = []

  for (let i = -maxRowIndex; i <= maxRowIndex; i += 1) {
    const y = i * rowGap
    if (Math.abs(y) >= usableRadius) continue

    const half = Math.sqrt(usableRadius * usableRadius - y * y)
    const staggered = Math.abs(i) % 2 === 1
    // 错开行：half < pitch/2 时 floor 得 −1，根数自然为 0，不必特判
    const count = staggered
      ? 2 * (Math.floor((half - pitchMm / 2) / pitchMm + EPS) + 1)
      : 2 * Math.floor(half / pitchMm + EPS) + 1

    if (count > 0) rows.push({ y, count })
  }

  rows.sort((a, b) => b.y - a.y)
  return rows
}

const countAt = (pitchMm, usableRadius) =>
  latticeRows(pitchMm, usableRadius).reduce((sum, row) => sum + row.count, 0)

/**
 * 反推节距：取「仍然放得下 tubeCount 根」的最大节距。
 *
 * 为什么不是「恰好等于 tubeCount 的节距」：正三角形布管里凑不出任意根数 ——
 * 每行根数由圆边界跨界决定，是跳变的。以本项目的再沸器为例（Ø550 圆、φ25 管），
 * 节距在 50.55~52.54mm 时格点数是 91，一过 52.55 就掉到 85，**87 无解**。
 * 于是取 91 再削 4 根，比反过来取 85 少 2 根更能保证「管数够」。
 * 取「放得下」的最大节距 = 最稀疏且仍容得下全部管子的排布，管束正好铺满布管圆；
 * 多出来的点位再由 trimToCount 从最外两行削掉。
 *
 * count 随节距单调不增（个别行跨越圆边界时有微小抖动），二分足够；
 * 抖动只影响末位小数，对体积曲线的影响远小于管子本身的离散性。
 */
function solvePitchMm({ tubeCount, usableRadius, minPitchMm }) {
  if (countAt(minPitchMm, usableRadius) < tubeCount) {
    throw new Error(
      `布管圆容纳不下 ${tubeCount} 根管子（最小节距 ${minPitchMm}mm 时只能排 ${countAt(minPitchMm, usableRadius)} 根）`,
    )
  }

  let lo = minPitchMm
  let hi = Math.max(minPitchMm * 2, usableRadius * 2)
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2
    if (countAt(mid, usableRadius) >= tubeCount) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * 把多出来的点位从最外两行削掉，凑到恰好 tubeCount 根。
 *
 * 从最上/最下两行交替各削一根：越靠外缘的行越是被布管圆"切"出来的，
 * 少一根最不改变管束的竖向密度分布。削的是行内的一根（不区分左右 x）——
 * 液位是水平的，管的浸入体积只取决于它的中心标高 y，与 x 无关，
 * 所以这里不需要维护每根管的二维坐标。
 */
function trimToCount(rows, tubeCount) {
  const trimmed = rows.map((row) => ({ ...row }))
  let excess = trimmed.reduce((sum, row) => sum + row.count, 0) - tubeCount

  let fromTop = true
  while (excess > 0) {
    // 只删还有余量、且删掉后不会让整行消失的最外行
    const index = fromTop ? 0 : trimmed.length - 1
    const row = trimmed[index]
    if (!row || row.count <= 1) break
    row.count -= 1
    excess -= 1
    fromTop = !fromTop
  }

  return trimmed.filter((row) => row.count > 0)
}

/**
 * 正三角形布管。返回 { pitchMm, rows, centers, count, spanBottomMm, spanTopMm }。
 *
 * @param {object} options
 * @param {number} options.tubeCount  目标根数
 * @param {number} options.tubeRadius 管外半径（mm）
 * @param {number} options.circleRadius 布管圆半径（mm，界定管束外缘）
 * @param {number} [options.pitchMm]  显式节距；不给则由 tubeCount 反推
 * @param {number[]} [options.centers] 显式管中心标高（mm，相对布管圆中心）；
 *                                     给了就直接用，跳过自动布管
 */
export function buildTriangularLayout({
  tubeCount,
  tubeRadius,
  circleRadius,
  pitchMm,
  centers,
}) {
  const usableRadius = circleRadius - tubeRadius
  if (usableRadius <= 0) {
    throw new Error(`布管圆半径 ${circleRadius}mm 小于管外半径 ${tubeRadius}mm，无法布管`)
  }

  if (centers) {
    const list = [...centers].sort((a, b) => a - b)
    return {
      pitchMm: pitchMm ?? null,
      rows: null,
      centers: list,
      count: list.length,
      spanBottomMm: Math.min(...list) - tubeRadius,
      spanTopMm: Math.max(...list) + tubeRadius,
    }
  }

  const pitch =
    pitchMm ?? solvePitchMm({ tubeCount, usableRadius, minPitchMm: tubeRadius * 2 })
  const rows = trimToCount(latticeRows(pitch, usableRadius), tubeCount)
  const count = rows.reduce((sum, row) => sum + row.count, 0)

  if (count !== tubeCount) {
    throw new Error(
      `布管削到 ${count} 根，凑不出目标 ${tubeCount} 根（该布管圆与节距组合下根数是跳变的）`,
    )
  }

  // centers 按行展开；同一行的管子共用一个标高，体积计算与 x 无关
  const list = []
  rows.forEach((row) => {
    for (let i = 0; i < row.count; i += 1) list.push(row.y)
  })
  list.sort((a, b) => a - b)

  return {
    pitchMm: pitch,
    rows,
    centers: list,
    count,
    spanBottomMm: list[0] - tubeRadius,
    spanTopMm: list[list.length - 1] + tubeRadius,
  }
}

/**
 * 内置 U 型换热管束：给定液位，算它浸在液相里挤占了多少体积。
 *
 * 每根 U 管按"一根水平圆柱"处理 —— 罐内两侧直管各 Lp/2，合计有效长度 Lp；
 * 管箱（管板外侧）的那一段不属于容器内部，不参与扣除。
 */
export class UTubeBundle {
  /**
   * @param {object} options
   * @param {number} options.tubeOuterDiameter 管外径（mm）
   * @param {number} options.tubeLengthMm 单根 U 管**罐内**有效总长度（mm，两侧直管合计）
   * @param {number} options.tubeCount 根数
   * @param {number} options.circleCenterY 布管圆中心的标高（mm，罐底 Y=0）
   * @param {number} options.circleRadius 布管圆半径（mm）
   * @param {number} [options.pitchMm] 显式节距；不给则按 tubeCount 反推
   * @param {number[]} [options.centers] 显式管中心标高（mm，罐底 Y=0），给了就跳过自动布管
   */
  constructor({
    tubeOuterDiameter,
    tubeLengthMm,
    tubeCount,
    circleCenterY,
    circleRadius,
    pitchMm,
    centers,
  }) {
    this.tubeRadiusMm = tubeOuterDiameter / 2
    this.tubeLengthMm = tubeLengthMm
    this.tubeCount = tubeCount
    this.circleCenterY = circleCenterY
    this.circleRadiusMm = circleRadius

    const layout = buildTriangularLayout({
      tubeCount,
      tubeRadius: this.tubeRadiusMm,
      circleRadius,
      pitchMm,
      // 显式坐标是"相对罐底"的绝对标高，布管算法内部用的是相对圆心的，这里先换算
      centers: centers ? centers.map((y) => y - circleCenterY) : undefined,
    })

    // 换算回罐底坐标
    this.layout = {
      ...layout,
      centers: layout.centers.map((y) => y + circleCenterY),
      spanBottomMm: layout.spanBottomMm + circleCenterY,
      spanTopMm: layout.spanTopMm + circleCenterY,
    }

    /** 单根管全浸没时的排液体积（mm³） */
    this.fullTubeVolumeMm3 = Math.PI * this.tubeRadiusMm ** 2 * this.tubeLengthMm
  }

  /** 全部管子完全浸没时挤占的体积（mm³）—— 使用方给定的 0.3416 m³ 就是它 */
  get totalVolumeMm3() {
    return this.tubeCount * this.fullTubeVolumeMm3
  }

  /** 管束外缘的最低标高（mm）—— 低于它液位还没碰到管束 */
  get spanBottomMm() {
    return this.layout.spanBottomMm
  }

  /** 管束外缘的最高标高（mm）—— 高于它管束已全部浸没 */
  get spanTopMm() {
    return this.layout.spanTopMm
  }

  /**
   * 液位为 levelMm 时，管束浸入液相所占的体积（mm³）。
   *
   * 使用方给的算法分四段，这里落成两段短路 + 一次逐根累加：
   *   H ≤ 0                                        → 0
   *   0 < H ≤ 管束外缘最低点                        → 0（液位未接触管束）
   *   管束外缘最低点 < H < 管束外缘最高点            → 逐根弓形累加
   *   H ≥ 管束外缘最高点                            → 常数 totalVolumeMm3
   *
   * ⚠️ 第三/第四段的阈值取自**布管结果的实际外缘**，而不是写死 40 / 590：
   *    布管是离散的，最上管顶未必正好落在 590 —— 写死的话，逐根累加在 590 处的
   *    结果会小于常数，590 一过就是一个台阶（液位每挪 1mm 体积跳一下）。
   *    用实际外缘做短路，两条路径在交点处天然相等，曲线连续。
   *    测试里断言布管外缘落在 [40, 590] 之内，把两者钉在一起。
   */
  immersedVolumeMm3(levelMm) {
    const h = Number(levelMm) || 0
    if (h <= 0) return 0
    if (h <= this.spanBottomMm) return 0
    if (h >= this.spanTopMm) return this.totalVolumeMm3

    const rp = this.tubeRadiusMm
    let volume = 0

    for (const centerY of this.layout.centers) {
      const yBottom = centerY - rp
      const yTop = centerY + rp

      if (h >= yTop) {
        volume += this.fullTubeVolumeMm3
        continue
      }
      if (h <= yBottom) continue

      // 液面切割管子：浸入深度 hSub 对应的圆弓形面积 × 管长
      const hSub = h - yBottom
      const bowArea =
        rp * rp * Math.acos(Math.max(-1, Math.min(1, (rp - hSub) / rp))) -
        (rp - hSub) * Math.sqrt(Math.max(0, 2 * rp * hSub - hSub * hSub))
      volume += bowArea * this.tubeLengthMm
    }

    return volume
  }

  immersedVolumeM3(levelMm) {
    return this.immersedVolumeMm3(levelMm) / MM3_PER_M3
  }
}

/**
 * 卧式容器（可含内置管束）的液位体积：壳体体积 − 浸在液相里的管束体积。
 *
 * 没有管束时（bundle 传 null）退化成纯壳体，与改造前两种罐的结果完全一致。
 */
export class Reboiler {
  /**
   * @param {object} options
   * @param {object} options.shell 壳体几何（shellVolumeMm3 的 geometry 参数）
   * @param {UTubeBundle|null} [options.bundle] 内置管束，可为空
   */
  constructor({ shell, bundle = null }) {
    this.shell = shell
    this.bundle = bundle
  }

  /** 液位 levelMm 时的有效液体体积（mm³） */
  liquidVolumeMm3(levelMm) {
    const shellVolume = shellVolumeMm3(levelMm, this.shell)
    const bundleVolume = this.bundle ? this.bundle.immersedVolumeMm3(levelMm) : 0
    return shellVolume - bundleVolume
  }

  liquidVolumeM3(levelMm) {
    return this.liquidVolumeMm3(levelMm) / MM3_PER_M3
  }

  /** 满罐容积（m³） */
  capacityM3() {
    return this.liquidVolumeM3(this.shell.maxLevel)
  }
}
