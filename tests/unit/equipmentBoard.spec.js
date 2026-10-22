import { describe, expect, it } from 'vitest'
import {
  LEDGER_COLUMNS,
  blockReasonText,
  columnOfEquipment,
  groupLedger,
  hasCalibration,
  hasImage,
  sizeText,
} from '../../src/components/equipment/ledgerGroups.js'

/**
 * 设备看板的分列（变更-150）。
 *
 * 设备的"待办"不是按容器类型分的，而是按**还缺什么**：
 * 缺底图 → 缺标定 → 已停用 → 已就绪。四列不许重叠，也不许漏人。
 *
 * 这里守的是分类优先级：一台设备同时缺底图又停用时，必须落在「缺底图」
 * （先补底图，停用与否是后面的事）。分错列 = 待办消失在没人看的那一列。
 */

const eq = (over = {}) => ({
  id: 1,
  equipmentCode: 'V-150',
  equipmentName: 'HND-V150 合成釜',
  containerType: 1,
  enabled: 1,
  imageFile: '/files/a.png',
  volumePerMm: 0.0123,
  spec: 'Φ1200×3000',
  ...over,
})

describe('四列定义', () => {
  it('就是这四列，顺序固定（缺底图最先）', () => {
    expect(LEDGER_COLUMNS.map((c) => c.label)).toEqual(['缺底图', '缺标定', '已停用', '已就绪'])
  })
})

describe('分类', () => {
  it('数据完整且启用 → 已就绪', () => {
    expect(columnOfEquipment(eq())).toBe('ready')
  })

  it('没有底图 → 缺底图（哪怕也停用/没标定）', () => {
    expect(columnOfEquipment(eq({ imageFile: '' }))).toBe('noImage')
    expect(columnOfEquipment(eq({ imageFile: '', enabled: 0 }))).toBe('noImage')
    expect(columnOfEquipment(eq({ imageFile: null, volumePerMm: null }))).toBe('noImage')
  })

  it('有底图但没标定 → 缺标定', () => {
    expect(columnOfEquipment(eq({ volumePerMm: null }))).toBe('noCalibration')
    expect(columnOfEquipment(eq({ volumePerMm: 0 }))).toBe('noCalibration')
    expect(columnOfEquipment(eq({ volumePerMm: '' }))).toBe('noCalibration')
  })

  it('完整但停用 → 已停用', () => {
    expect(columnOfEquipment(eq({ enabled: 0 }))).toBe('disabled')
  })

  it('空白对象也能分（不炸）', () => {
    expect(columnOfEquipment()).toBe('noImage')
  })
})

describe('分组与排序', () => {
  it('四列都返回（空列不消失），行落到对应列', () => {
    const groups = groupLedger([
      eq({ id: 1 }),
      eq({ id: 2, imageFile: '' }),
      eq({ id: 3, volumePerMm: null }),
      eq({ id: 4, enabled: 0 }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['noImage', 'noCalibration', 'disabled', 'ready'])
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1, 1, 1])
  })

  it('列内按位号字典序（现场叫法的心理顺序），空位号排最后', () => {
    const groups = groupLedger([
      eq({ id: 1, equipmentCode: 'V-150' }),
      eq({ id: 2, equipmentCode: 'R-201' }),
      eq({ id: 3, equipmentCode: '' }),
    ])
    expect(groups.find((g) => g.key === 'ready').rows.map((r) => r.equipmentCode)).toEqual([
      'R-201',
      'V-150',
      '',
    ])
  })

  it('空入参不炸', () => {
    expect(groupLedger(null).every((g) => g.rows.length === 0)).toBe(true)
  })
})

describe('卡片文案', () => {
  it('「为什么还不能用」优先用后端给的 enableBlockReason', () => {
    expect(blockReasonText(eq({ enabled: 0, enableBlockReason: '缺底图坐标' }))).toBe('缺底图坐标')
  })

  it('后端没给时按缺什么兜底，就绪时返回空串', () => {
    expect(blockReasonText(eq({ imageFile: '' }))).toBe('缺容器底图')
    expect(blockReasonText(eq({ volumePerMm: null }))).toBe('缺每毫米体积（未标定）')
    expect(blockReasonText(eq({ enabled: 0 }))).toBe('已停用')
    expect(blockReasonText(eq())).toBe('')
  })

  it('规格优先；没规格就用内径×筒长拼', () => {
    expect(sizeText(eq())).toBe('Φ1200×3000')
    expect(sizeText(eq({ spec: '', innerDiameter: 800, shellLength: 2000 }))).toBe('Φ800×2000')
    expect(sizeText(eq({ spec: '', innerDiameter: null }))).toBe('')
  })

  it('hasImage / hasCalibration 的判定边界', () => {
    expect(hasImage({ imageFile: '  ' })).toBe(false)
    expect(hasImage({ imageFile: 'x.png' })).toBe(true)
    expect(hasCalibration({ volumePerMm: 0.001 })).toBe(true)
    expect(hasCalibration({ volumePerMm: 0 })).toBe(false)
    expect(hasCalibration({})).toBe(false)
  })
})
