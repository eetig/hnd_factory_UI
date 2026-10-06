import { describe, it, expect } from 'vitest'
import {
  UTubeBundle,
  Reboiler,
  buildTriangularLayout,
  shellVolumeMm3,
} from '../../src/utils/vesselVolume'

// 甲醇计量罐（VESSELS 里 methanol 那一项）的几何。与 150 产品储罐的唯一区别就是
// **上下都有封头**（150 是平底，bottomHeadDepth 缺省）。口径已与使用方确认：
// 「直径2200，筒体3400，直边40」，上下封头都是标准椭圆 D/4。
const METHANOL = {
  type: 'vertical',
  radius: 1100,
  // 几何层把直边并进筒体高（直边就是等径圆筒段）：3400 + 上下各 40
  cylinderHeight: 3480,
  headDepth: 550,
  bottomHeadDepth: 550,
  maxLevel: 4580,
}

describe('甲醇计量罐：口径与体积（数字已与使用方确认）', () => {
  const r = METHANOL.radius
  const halfEllipsoid = (2 / 3) * Math.PI * r * r * 550

  it('量程 = 下封头 550 + 筒体 3480 + 上封头 550 = 4580mm', () => {
    expect(METHANOL.maxLevel).toBe(550 + 3480 + 550)
  })

  it('满罐 16.0163 m³ = 下封头 + 筒体 + 上封头', () => {
    const expected = halfEllipsoid + Math.PI * r * r * 3480 + halfEllipsoid
    expect(shellVolumeMm3(4580, METHANOL)).toBeCloseTo(expected, 6)
    expect(shellVolumeMm3(4580, METHANOL) / 1e9).toBeCloseTo(16.0163, 3)
  })

  it('两处分段点：550（下封头顶）/ 4030（上封头起）', () => {
    expect(shellVolumeMm3(550, METHANOL)).toBeCloseTo(halfEllipsoid, 6)
    const atTopTangent = halfEllipsoid + Math.PI * r * r * 3480
    expect(shellVolumeMm3(4030, METHANOL)).toBeCloseTo(atTopTangent, 6)
  })

  it('甲醇 ρ=0.792 g/cm³ → 满罐 12.685 t', () => {
    const tons = (shellVolumeMm3(4580, METHANOL) / 1e9) * 0.792
    expect(tons).toBeCloseTo(12.685, 3)
  })

  it('液位全程非负、单调不减', () => {
    let previous = 0
    for (let h = 0; h <= 4580; h += 5) {
      const volume = shellVolumeMm3(h, METHANOL)
      expect(volume).toBeGreaterThanOrEqual(previous)
      previous = volume
    }
  })

  it('下封头不是摆设：不做下封头扣除会把 0~550mm 那一段算小', () => {
    // 若把甲醇罐误当成平底（漏配 bottomHeadDepth），同一液位会算出完全不同的体积 ——
    // 这条是为了让「上下都有封头」这件事在测试里留个痕迹
    const flatBottom = { ...METHANOL, bottomHeadDepth: 0 }
    expect(shellVolumeMm3(275, METHANOL)).not.toBeCloseTo(shellVolumeMm3(275, flatBottom), 0)
  })
})

// 改造前内联在 WorkOrderList.vue / index.vue 里的壳体积分实现，原样抄一份作为对照。
// ⚠️ 这份**不要**跟着 src 一起改 —— 它的价值就在于「冻结」重构前的算法，
//    逐点比对能挡住「抽取时手滑改了系数」这类只在小数位上体现的问题。
function legacyShellVolumeMm3(depth, geometry) {
  const r = geometry.radius
  const h = Math.max(0, Math.min(geometry.maxLevel, Number(depth) || 0))
  if (h <= 0) return 0

  if (geometry.type === 'vertical') {
    const cylinderPart = Math.PI * r * r * Math.min(h, geometry.cylinderHeight)
    if (h <= geometry.cylinderHeight) return cylinderPart

    const t = h - geometry.cylinderHeight
    const hi = geometry.headDepth
    const headPart = Math.PI * r * r * (t - Math.pow(t, 3) / (3 * hi * hi))
    return cylinderPart + headPart
  }

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

// 现场两台罐（VESSELS 里前两项）的几何，用于回归比对
const SILANE = {
  type: 'horizontal',
  radius: 1400,
  cylinderLength: 5500,
  straightFlange: 40,
  headDepth: 700,
  maxLevel: 2800,
}
const PRODUCT150 = {
  type: 'vertical',
  radius: 1800,
  cylinderHeight: 4800,
  headDepth: 900,
  maxLevel: 5700,
}

// 再沸器的壳体几何。l=4.0 + 直边 0.04×2 = 4.08 —— 与「l=4.08、直边 0」数值等价，
// 这里按图纸口径写（直边单列），下面有一条专门断言两者相等
const REBOILER_SHELL = {
  type: 'horizontal',
  radius: 1100,
  cylinderLength: 4000,
  straightFlange: 40,
  headDepth: 550, // D/4
  maxLevel: 2200,
}

// VESSELS 里 reboiler.bundle 的那组参数。
// tubeLengthMm = 2 程 × 3.6m —— 3.6m 是折流板区间（8 × 450mm），不是管子的几何长度
// （数据表写 φ25×2×4400，4.4m 是单程管长，2 是「2 个行程」不是壁厚；
//   换热面积按 4.4m/程 反推根数，体积扣除按罐内 3.6m/程）
const BUNDLE_CONFIG = {
  tubeOuterDiameter: 25,
  tubeLengthMm: 7200,
  tubeCount: 87,
  circleCenterY: 315,
  circleRadius: 275,
}

const makeBundle = (overrides = {}) => new UTubeBundle({ ...BUNDLE_CONFIG, ...overrides })
const makeReboiler = (bundle = makeBundle()) =>
  new Reboiler({ shell: REBOILER_SHELL, bundle })

describe('shellVolumeMm3：与重构前的内联实现逐点一致', () => {
  it('卧式罐（三氯氢硅）每个液位都相等到浮点极限', () => {
    for (let h = 0; h <= 2800; h += 7) {
      expect(shellVolumeMm3(h, SILANE)).toBe(legacyShellVolumeMm3(h, SILANE))
    }
    // 边界与非整数液位
    for (const h of [0.5, 39.9, 1399.5, 2799.9, 2800, 5000]) {
      expect(shellVolumeMm3(h, SILANE)).toBe(legacyShellVolumeMm3(h, SILANE))
    }
  })

  it('立式罐（150产品）每个液位都相等到浮点极限', () => {
    for (let h = 0; h <= 5700; h += 13) {
      expect(shellVolumeMm3(h, PRODUCT150)).toBe(legacyShellVolumeMm3(h, PRODUCT150))
    }
    // 筒体/封头分界与满罐
    for (const h of [0, 1, 4799.5, 4800, 4800.5, 5700, 9999]) {
      expect(shellVolumeMm3(h, PRODUCT150)).toBe(legacyShellVolumeMm3(h, PRODUCT150))
    }
  })

  it('液位为负或非数一律归零，超过满罐按满罐钳位', () => {
    expect(shellVolumeMm3(-1, SILANE)).toBe(0)
    expect(shellVolumeMm3(Number.NaN, SILANE)).toBe(0)
    expect(shellVolumeMm3(9999, SILANE)).toBe(shellVolumeMm3(2800, SILANE))
  })
})

// 带**下封头**的立式罐（甲醇计量罐这类）。150 产品储罐是平底，没有这一段。
// 液位基准是罐底最低点（下封头顶点），量程 = 下封头深 + 筒体高 + 上封头深。
const BOTTOM_HEAD_TANK = {
  type: 'vertical',
  radius: 1000,
  cylinderHeight: 3000,
  headDepth: 500,
  bottomHeadDepth: 500,
  maxLevel: 4000,
}

describe('shellVolumeMm3：立式罐带下封头', () => {
  const r = BOTTOM_HEAD_TANK.radius
  // 一个半椭球封头的体积
  const halfEllipsoid = (hi) => (2 / 3) * Math.PI * r * r * hi

  it('下封头灌满时正好是 (2/3)πr²hi', () => {
    expect(shellVolumeMm3(500, BOTTOM_HEAD_TANK)).toBeCloseTo(halfEllipsoid(500), 6)
  })

  it('筒体段线性增长，起点接在下封头的满值上', () => {
    const atTangent = shellVolumeMm3(500, BOTTOM_HEAD_TANK)
    for (const h of [1000, 2000, 3500]) {
      const expected = atTangent + Math.PI * r * r * (h - 500)
      expect(shellVolumeMm3(h, BOTTOM_HEAD_TANK)).toBeCloseTo(expected, 6)
    }
  })

  it('满罐 = 下封头 + 筒体 + 上封头', () => {
    const expected = halfEllipsoid(500) + Math.PI * r * r * 3000 + halfEllipsoid(500)
    expect(shellVolumeMm3(4000, BOTTOM_HEAD_TANK)).toBeCloseTo(expected, 6)
    expect(shellVolumeMm3(9999, BOTTOM_HEAD_TANK)).toBeCloseTo(expected, 6) // 钳位
  })

  it('两个分段点处连续（下封头↔筒体、筒体↔上封头）', () => {
    for (const joint of [500, 3500]) {
      const below = shellVolumeMm3(joint - 0.001, BOTTOM_HEAD_TANK)
      const above = shellVolumeMm3(joint + 0.001, BOTTOM_HEAD_TANK)
      expect(Math.abs(above - below)).toBeLessThan(1e4) // mm³，相对整罐 ~1.15e10 是微不足道的一步
    }
  })

  it('全程单调不减', () => {
    let previous = 0
    for (let h = 0; h <= 4000; h += 5) {
      const volume = shellVolumeMm3(h, BOTTOM_HEAD_TANK)
      expect(volume).toBeGreaterThanOrEqual(previous)
      previous = volume
    }
  })

  it('没有下封头的罐（bottomHeadDepth 缺省或 0）与改造前逐位一致', () => {
    // 150 产品储罐走的就是这一支：不给 bottomHeadDepth 时必须与旧实现完全相同
    const withoutField = { ...PRODUCT150 }
    const withZero = { ...PRODUCT150, bottomHeadDepth: 0 }
    for (let h = 0; h <= 5700; h += 23) {
      expect(shellVolumeMm3(h, withoutField)).toBe(legacyShellVolumeMm3(h, withoutField))
      expect(shellVolumeMm3(h, withZero)).toBe(shellVolumeMm3(h, withoutField))
    }
  })
})

describe('UTubeBundle：布管结果', () => {
  it('排出 87 根，且节距反推自洽', () => {
    const bundle = makeBundle()
    expect(bundle.layout.count).toBe(87)
    expect(bundle.layout.rows.length).toBeGreaterThan(5)
    expect(bundle.layout.pitchMm).toBeGreaterThan(bundle.tubeRadiusMm * 2) // 管子不能重叠
    // 每行根数之和 = 总数
    expect(bundle.layout.rows.reduce((s, row) => s + row.count, 0)).toBe(87)
  })

  it('管束外缘落在使用方给的 [40, 590] 区间内', () => {
    // 这条是「590 处不跳变」的前提：外缘一旦越界，逐根累加与常数之间就会露出台阶
    const bundle = makeBundle()
    expect(bundle.spanBottomMm).toBeGreaterThanOrEqual(40)
    expect(bundle.spanTopMm).toBeLessThanOrEqual(590)
  })

  it('全浸没体积 = 87 × π rp² × 罐内 7.2m = 0.3075 m³', () => {
    const bundle = makeBundle()
    // 87 根 φ25（rp=12.5mm）× 罐内 2 程 × 3.6m = 7.2m
    expect(bundle.totalVolumeMm3 / 1e9).toBeCloseTo(0.3075, 4)
    expect(bundle.totalVolumeMm3).toBeCloseTo(87 * Math.PI * 12.5 ** 2 * 7200, 6)
  })

  it('管长参数直接决定扣除量（改 tubeLengthMm 就换口径）', () => {
    // 同一组管数、不同罐内长度下的一一对应关系，防止将来调错单位
    const at = (mm) => makeBundle({ tubeLengthMm: mm }).totalVolumeMm3 / 1e9
    expect(at(3600)).toBeCloseTo(0.1537, 4) // 只算单程
    expect(at(7200)).toBeCloseTo(0.3075, 4) // 2 程 × 3.6m（本配置）
    expect(at(8800)).toBeCloseTo(0.3758, 4) // 若按管子几何全长 2 × 4.4m
  })

  it('可以换掉布管方式：给显式管中心标高就跳过自动布管', () => {
    const bundle = makeBundle({ tubeCount: 3, centers: [100, 200, 300] })
    expect(bundle.layout.count).toBe(3)
    expect(bundle.layout.centers).toEqual([100, 200, 300])
    expect(bundle.spanBottomMm).toBe(100 - 12.5)
    expect(bundle.spanTopMm).toBe(300 + 12.5)
  })

  it('布管圆太小放不下目标根数时报错，而不是悄悄少几根', () => {
    expect(() => makeBundle({ tubeCount: 400 })).toThrow(/容纳不下/)
  })

  it('buildTriangularLayout 可单独调用（布管算法与体积计算解耦）', () => {
    const layout = buildTriangularLayout({
      tubeCount: 87,
      tubeRadius: 12.5,
      circleRadius: 275,
    })
    expect(layout.count).toBe(87)
    // 这一层的坐标以布管圆圆心为原点（UTubeBundle 再按 circleCenterY 平移到罐底坐标），
    // 布管关于圆心上下对称，所以最小中心标高 = −(外缘顶 − 管半径)
    expect(Math.min(...layout.centers)).toBeCloseTo(-(layout.spanTopMm - 12.5), 6)
    expect(Math.max(...layout.centers)).toBeCloseTo(layout.spanTopMm - 12.5, 6)
  })
})

describe('UTubeBundle：按使用方给的四段算法算浸入体积', () => {
  const bundle = makeBundle()

  it('H ≤ 0 返回 0', () => {
    expect(bundle.immersedVolumeMm3(0)).toBe(0)
    expect(bundle.immersedVolumeMm3(-5)).toBe(0)
  })

  it('液位还没碰到管束时返回 0', () => {
    expect(bundle.immersedVolumeMm3(20)).toBe(0)
    expect(bundle.immersedVolumeMm3(40)).toBe(0)
    expect(bundle.immersedVolumeMm3(bundle.spanBottomMm - 0.001)).toBe(0)
  })

  it('管束全部浸没后取常数 totalVolumeMm3', () => {
    expect(bundle.immersedVolumeMm3(bundle.spanTopMm + 0.001)).toBeCloseTo(
      bundle.totalVolumeMm3,
      6,
    )
    expect(bundle.immersedVolumeMm3(590)).toBe(bundle.totalVolumeMm3)
    expect(bundle.immersedVolumeMm3(2200)).toBe(bundle.totalVolumeMm3)
  })

  it('中间区间按单管弓形累加：单调不减、且不超总量', () => {
    let previous = 0
    for (let h = 0; h <= 700; h += 1) {
      const volume = bundle.immersedVolumeMm3(h)
      expect(volume).toBeGreaterThanOrEqual(previous)
      expect(volume).toBeLessThanOrEqual(bundle.totalVolumeMm3 + 1e-6)
      previous = volume
    }
    expect(previous).toBeCloseTo(bundle.totalVolumeMm3, 6)
  })

  // 管子几何从配置取，别在这里写死数字 —— 改一次 tubeLengthMm 就要回来改测试的话，
  // 迟早漏掉一处（这次调 8000 → 7200 就踩到了）
  const TUBE_LENGTH = BUNDLE_CONFIG.tubeLengthMm

  it('单根管全浸没时正好是 π rp² Lp（逐个管验算）', () => {
    const single = makeBundle({ tubeCount: 1, centers: [315] })
    const full = Math.PI * 12.5 ** 2 * TUBE_LENGTH
    expect(single.immersedVolumeMm3(315 + 12.5)).toBeCloseTo(full, 6)
    expect(single.immersedVolumeMm3(1000)).toBeCloseTo(full, 6)
  })

  it('单根管半浸没时等于半圆面积 × 管长', () => {
    const single = makeBundle({ tubeCount: 1, centers: [315] })
    const halfCircle = (Math.PI * 12.5 ** 2) / 2
    // 液面正好在管中心：浸入深度 = rp
    expect(single.immersedVolumeMm3(315)).toBeCloseTo(halfCircle * TUBE_LENGTH, 6)
  })
})

describe('Reboiler：净值 = 壳体 − 浸入管束', () => {
  it('没配管束时退化回纯壳体（现有两台罐不受影响）', () => {
    const plain = new Reboiler({ shell: SILANE, bundle: null })
    for (let h = 0; h <= 2800; h += 37) {
      expect(plain.liquidVolumeMm3(h)).toBe(legacyShellVolumeMm3(h, SILANE))
    }
  })

  it('净值恒等于壳体减管束', () => {
    const reboiler = makeReboiler()
    for (let h = 0; h <= 2200; h += 11) {
      const expected = shellVolumeMm3(h, REBOILER_SHELL) - reboiler.bundle.immersedVolumeMm3(h)
      expect(reboiler.liquidVolumeMm3(h)).toBeCloseTo(expected, 6)
    }
  })

  it('液位 0~2200 全程非负', () => {
    const reboiler = makeReboiler()
    for (let h = 0; h <= 2200; h += 1) {
      expect(reboiler.liquidVolumeMm3(h)).toBeGreaterThanOrEqual(0)
    }
  })

  it('满罐 = 壳体满罐容积 − 0.3075 m³', () => {
    const reboiler = makeReboiler()
    const shellCapacity = shellVolumeMm3(2200, REBOILER_SHELL) / 1e9
    expect(shellCapacity).toBeCloseTo(18.2971, 3)
    expect(reboiler.capacityM3()).toBeCloseTo(shellCapacity - 0.3075, 4)
  })

  it('l=4.0 + 直边 0.04×2 与「l=4.08、直边 0」逐位等价', () => {
    // 图纸口径把直边单列出来，但直边段本身就是等径圆筒的一部分 ——
    // 两种写法必须给出同一个数，否则等于把同一台设备算成了两台
    const split = { ...REBOILER_SHELL }
    const merged = { ...REBOILER_SHELL, cylinderLength: 4080, straightFlange: 0 }
    for (let h = 0; h <= 2200; h += 7) {
      expect(shellVolumeMm3(h, split)).toBe(shellVolumeMm3(h, merged))
    }
  })

  it('液位落在管束区间之外时，与纯壳体只差一个常数或零', () => {
    const reboiler = makeReboiler()

    // 未触及管束：两者相等
    expect(reboiler.liquidVolumeMm3(40)).toBeCloseTo(shellVolumeMm3(40, REBOILER_SHELL), 6)

    // 全部浸没：差一个 totalVolumeMm3
    const delta = reboiler.liquidVolumeMm3(1000) - shellVolumeMm3(1000, REBOILER_SHELL)
    expect(delta).toBeCloseTo(-makeBundle().totalVolumeMm3, 6)
  })
})

describe('Reboiler：管束在 590 处不能出现台阶', () => {
  // 使用方给的算法在 H>590 直接取常数，而逐根累加的末值是离散的 ——
  // 若布管的最上管顶高于 590（或把 590 写死在代码里而当管束实际只到 545），
  // 两条路径在交界处就对不上，液位一过 590 体积就跳一下。
  // 实现取的是**布管结果的实际外缘**做短路，这里验证两条路径在交点处确实相等。
  it('逐根累加到管束外缘顶时已等于常数分支的值', () => {
    const bundle = makeBundle()
    const deficit = bundle.totalVolumeMm3 - bundle.immersedVolumeMm3(bundle.spanTopMm - 0.01)
    expect(deficit).toBeGreaterThanOrEqual(0)
    // 差不到一根管的千分之一（一根管全浸没是 3.93e6 mm³）；
    // 若外缘顶与实际管顶错开，这里会差出整根管甚至几十根
    expect(deficit).toBeLessThan(1e3)
  })

  it('外缘底的另一侧同样接得上：从 0 连续长起来', () => {
    const bundle = makeBundle()
    const bottom = bundle.spanBottomMm
    expect(bundle.immersedVolumeMm3(bottom)).toBe(0)
    // 跨过外缘底那一瞬不能凭空跳出一段体积：极小的液位增量只带来极小的浸入体积
    expect(bundle.immersedVolumeMm3(bottom + 1e-6)).toBeLessThan(1)
    // 第一个 1mm 的增量应远小于一根管全浸没的体积（3.93e6 mm³）——
    // 注意弓形面积在切点处导数为 0，但 1mm 是有限步长，dA/dh = 2√(2rp·h) 在 h=1 时约为 10 mm/mm，
    // 底部一行的管子又共用同一标高、同时接触，所以这一步是 2e5 量级而不是极小量
    const firstStep = bundle.immersedVolumeMm3(bottom + 1) - bundle.immersedVolumeMm3(bottom)
    expect(firstStep).toBeGreaterThan(0)
    expect(firstStep).toBeLessThan(bundle.fullTubeVolumeMm3)
  })

  it('590 与 591 的差值就是壳体的 1mm 增量（管束已饱和，不再变）', () => {
    const reboiler = makeReboiler()
    const actual = reboiler.liquidVolumeMm3(591) - reboiler.liquidVolumeMm3(590)
    const shell = shellVolumeMm3(591, REBOILER_SHELL) - shellVolumeMm3(590, REBOILER_SHELL)
    expect(actual).toBeCloseTo(shell, 9)
  })

  // 说明：不在这里对整个量程做统一的二阶差分阈值 ——
  // 壳体自身在 h→0 处按 h^1.5 增长（二阶导在 0 处发散），h=1、2 的二阶差量级就有 2e5 mm³，
  // 那是几何本身的弯曲，不是台阶；写死一个阈值只会得到一个恒失误的测试。
})
