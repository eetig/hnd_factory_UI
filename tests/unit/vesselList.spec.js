import { describe, it, expect } from 'vitest'
import { toVesselOption, toVesselOptions, renderKindOf } from '../../src/composables/useVesselList'

// 容器清单来自设备台账（变更-025）。这里钉住的是「库里的行 → 页面用的选项」这段映射 ——
// 它错了不会报错，只会让某台罐画错：把立式当卧式（液位轴就错了）、把下封头丢了（体积算小）、
// 把颜色配错（还能看，但没必要）。
//
// 用的数据照着本地库里那四行写，改动台账回填语句时这些数要同步。

const BOUNDS_METHANOL = JSON.stringify({
  width: 1,
  height: 2.146893,
  left: 0.101695,
  right: 0.886299,
  top: 0.117232,
  tangent: 0.30791,
  tangentBottom: 1.573446,
  bottom: 1.761299,
})

/** 甲醇计量罐：立式、上下都有封头 */
function methanolRow(overrides = {}) {
  return {
    id: 37,
    name: '甲醇计量罐',
    code: '',
    workshop: '罐区',
    containerType: 3, // 台账口径：1卧式 2平底 3其他
    diameter: 2200,
    shellLength: 3400,
    straightFlange: 40,
    topHeadDepth: 550,
    bottomHeadDepth: 550,
    imageFile: 'vessel-methanol.png',
    imageBounds: BOUNDS_METHANOL,
    medium: '甲醇',
    density: 0.792,
    headVolume: 1.5459,
    volume: null,
    ...overrides,
  }
}

describe('renderKindOf：由台账的 container_type 与几何定渲染类型', () => {
  it('container_type=1 是卧式', () => {
    expect(renderKindOf({ containerType: 1, bottomHeadDepth: 550 })).toBe('horizontal')
  })

  it('container_type=4（卧式带内置管束，再沸器那一种）也是卧式', () => {
    // 漏判 4 的后果不是「少个功能」—— 会把它画成立式罐，液位轴整个换方向，一眼看不出错。
    // 台账里 4 由 spec 含「管束」派生出来（见 docs/schema.sql 的回填语句）。
    expect(renderKindOf({ containerType: 4, bottomHeadDepth: 550 })).toBe('horizontal')
    expect(toVesselOption(methanolRow({ id: 548, containerType: 4 })).type).toBe('horizontal')
  })

  it('立式看有没有下封头分成两种（150 是平底，甲醇上下都有）', () => {
    expect(renderKindOf({ containerType: 3, bottomHeadDepth: 550 })).toBe('vertical-bottom-head')
    expect(renderKindOf({ containerType: 2, bottomHeadDepth: null })).toBe('vertical-flat')
  })
})

describe('toVesselOption：库里的行 → 页面选项', () => {
  it('立式带下封头：几何、量程、类型都对', () => {
    const v = toVesselOption(methanolRow())
    expect(v.type).toBe('vertical')
    expect(v.key).toBe('37') // key 用 id：名称会重名
    expect(v.diameter).toBe(2200)
    expect(v.cylinderHeight).toBe(3400)
    expect(v.straightFlange).toBe(40)
    expect(v.headDepth).toBe(550)
    expect(v.bottomHeadDepth).toBe(550)
    expect(v.medium).toBe('甲醇')
    expect(v.density).toBe(0.792)
    expect(v.headVolumeForCheck).toBe(1.5459)
    expect(v.imageBounds.left).toBeCloseTo(0.101695, 6)
    expect(v.image).toBeTruthy() // 经 glob 映射到了打包后的 URL
  })

  it('平底容器：下封头必须是 0 而不是缺字段（体积公式按 0 走，缺了会变 NaN）', () => {
    const v = toVesselOption(
      methanolRow({ id: 89, name: '150产品罐', containerType: 2, bottomHeadDepth: null }),
    )
    expect(v.type).toBe('vertical')
    expect(v.bottomHeadDepth).toBe(0)
    expect(renderKindOf({ containerType: 2, bottomHeadDepth: null })).toBe('vertical-flat')
  })

  it('卧式容器：筒体长映射到 cylinderLength（库里是同一个 shell_length）', () => {
    const v = toVesselOption(
      methanolRow({
        id: 87,
        name: '三氯氢硅储罐',
        containerType: 1,
        diameter: 2800,
        shellLength: 5500,
        topHeadDepth: 700,
        bottomHeadDepth: 700,
        imageFile: 'vessel.png',
        headVolume: 3.1198,
      }),
    )
    expect(v.type).toBe('horizontal')
    expect(v.cylinderLength).toBe(5500)
    expect(v.cylinderHeight).toBe(5500) // 两个名字都填，页面按类型取用
  })

  it('液面颜色按 id 取模 —— **现有四台必须落回原本的颜色**', () => {
    // 这条一挂说明调色板被「顺手整理」过：那会让所有容器的颜色在页面上一起跳一遍。
    // 期望值就是改造前写死在 VESSELS 里的那四个色。
    const line = (id) => toVesselOption(methanolRow({ id })).liquid.line
    expect(line(37)).toBe('#a78bfa') // 甲醇计量罐 · 淡紫
    expect(line(548)).toBe('#f59e0b') // 再沸器 · 琥珀
    expect(line(87)).toBe('#a6cb3c') // 三氯氢硅储罐 · 黄绿
    expect(line(89)).toBe('#00ffff') // 150产品罐 · 青
  })

  it('备注文案按 id 取（现有四台的原文照旧）', () => {
    expect(toVesselOption(methanolRow()).note).toContain('甲醇，20℃')
    expect(toVesselOption(methanolRow({ id: 87 })).note).toContain('SIS 联锁')
    // 没登记过的 id 自动生成，不至于空着
    expect(toVesselOption(methanolRow({ id: 9999 })).note).toContain('甲醇')
  })

  it('再沸器的管束走临时覆盖表（漏了会让它静默算大 0.3075 m³）', () => {
    const reb = toVesselOption(methanolRow({ id: 548, name: '再沸器', containerType: 1 }))
    expect(reb.bundle).toBeTruthy()
    expect(reb.bundle.tubeCount).toBe(87)
    // 其它容器不该凭空长出管束来
    expect(toVesselOption(methanolRow()).bundle).toBeNull()
  })

  it('坏数据不炸、也不进下拉：缺 id / 缺坐标 / 坐标不是 JSON / 图不在本仓 assets', () => {
    expect(toVesselOption(null)).toBeNull()
    expect(toVesselOption(methanolRow({ id: null }))).toBeNull()
    expect(toVesselOption(methanolRow({ imageBounds: null }))).toBeNull()
    expect(toVesselOption(methanolRow({ imageBounds: '{不是 json' }))).toBeNull()
    expect(toVesselOption(methanolRow({ imageFile: '没有这张图.png' }))).toBeNull()
  })

  it('toVesselOptions 把坏行滤掉而不是整批失败', () => {
    const list = toVesselOptions([methanolRow(), null, methanolRow({ id: 88, imageBounds: null })])
    expect(list).toHaveLength(1)
    expect(list[0].key).toBe('37')
  })
})
