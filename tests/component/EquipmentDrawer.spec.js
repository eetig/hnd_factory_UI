import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'

// 抽屉里挂着底图上传（走后端转发端点），测试里不发真实请求
vi.mock('../../src/api/request', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { success: true, data: [], dataList: [] } })),
    post: vi.fn(() => Promise.resolve({ data: { success: true, data: { fileName: 'x.png' } } })),
    delete: vi.fn(() => Promise.resolve({ data: { success: true } })),
  },
}))

import EquipmentDetailDrawer from '../../src/components/equipment/EquipmentDetailDrawer.vue'

/**
 * 设备详情抽屉（2026-10-18，变更-118）。
 *
 * 验收标准点名的四条在这里：
 *   · 新建模式**回车即提交**（"新增一台设备"只需点一下「新增设备」+ 打字 + 回车）；
 *   · 无 `equipment:edit` 时**不出保存按钮**、字段禁用；
 *   · 有未保存改动时按 Esc **先问一句**；
 *   · **永远没有删除按钮**（台账是历史依据，接口只有 enable/disable）。
 */
const ROW = {
  id: 12,
  equipmentCode: 'V-150',
  equipmentName: 'HND-V150 合成釜',
  nickname: '',
  workshop: '合成车间',
  spec: 'Φ1200×3000',
  containerType: 1,
  innerDiameter: 1200,
  shellLength: 3000,
  straightFlange: 40,
  topHeadDepth: 300,
  bottomHeadDepth: null,
  volumePerMm: 1.13,
  density: 1.2,
  medium: '三氯氢硅',
  remark: '',
  imageFile: '',
  imageBounds: '',
  enabled: 1,
  enableBlockReason: '',
}

let wrapper

async function open(props = {}) {
  wrapper = mount(EquipmentDetailDrawer, {
    attachTo: document.body,
    props: { modelValue: true, mode: 'create', canEdit: true, row: null, ...props },
    global: {
      plugins: [ElementPlus],
      // 标定器要 canvas，这里只验抽屉本身；它是否被正确调用由面板测试与手测覆盖
      stubs: { VesselCalibrateDialog: true },
    },
  })
  await flushPromises()
  await nextTick()
  // 自动聚焦是延迟一帧做的（等 el-drawer 的焦点陷阱先落位）
  await new Promise((r) => setTimeout(r, 120))
  return wrapper
}

function buttonByText(text) {
  return wrapper.findAll('button').find((b) => b.text().replace(/\s/g, '') === text)
}

beforeEach(() => {
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('新建模式', () => {
  it('打开即空表，且光标落在「设备名称」（新增一台只需点一次 + 打字）', async () => {
    await open()
    const input = wrapper.find('input[aria-label="设备名称"]')
    expect(input.exists(), '抽屉里没有设备名称输入框').toBe(true)
    expect(input.element.value).toBe('')
    expect(document.activeElement, '新建模式没有自动聚焦设备名称').toBe(input.element)
  })

  it('在输入框里回车 → 直接提交', async () => {
    await open()
    await wrapper.find('input[aria-label="设备名称"]').setValue('V-151 精馏塔')
    await wrapper.find('input[aria-label="设备位号"]').setValue('V-151')
    await wrapper.find('input[aria-label="设备名称"]').trigger('keydown', { key: 'Enter' })

    const saved = wrapper.emitted('save')
    expect(saved, '回车没有触发保存').toBeTruthy()
    expect(saved[0][0]).toMatchObject({ equipmentName: 'V-151 精馏塔', equipmentCode: 'V-151' })
  })

  it('在下拉里回车**不**提交（否则选个容器类型就把设备存了）', async () => {
    await open()
    const select = wrapper.find('.el-select')
    expect(select.exists()).toBe(true)
    await select.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')).toBeFalsy()
  })

  it('容器类型默认是 3（立式圆筒），不用每次选一遍', async () => {
    await open()
    await wrapper.find('input[aria-label="设备名称"]').setValue('新设备')
    await wrapper.find('input[aria-label="设备名称"]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')[0][0].containerType).toBe(3)
  })
})

describe('编辑模式', () => {
  it('带上行数据打开，字段就是这条记录的值', async () => {
    await open({ mode: 'edit', row: ROW })
    expect(wrapper.find('input[aria-label="设备位号"]').element.value).toBe('V-150')
    expect(wrapper.find('input[aria-label="设备名称"]').element.value).toBe('HND-V150 合成釜')
    expect(wrapper.find('input[aria-label="介质"]').element.value).toBe('三氯氢硅')
    expect(wrapper.find('input[aria-label="内径"]').element.value).toBe('1200')
    expect(wrapper.find('input[aria-label="介质密度"]').element.value).toBe('1.2')
  })

  it('已停用的行在抽屉里说"已停用"，并给出不能启用的原因', async () => {
    await open({
      mode: 'edit',
      row: { ...ROW, enabled: 0, enableBlockReason: '不能启用：未配置容器底图' },
    })
    expect(wrapper.text()).toContain('已停用')
    expect(wrapper.text()).toContain('不能启用：未配置容器底图')
  })

  it('已启用但进不了体积计算的行，要说"仅台账"（变更-087 的口径不能丢）', async () => {
    await open({
      mode: 'edit',
      row: { ...ROW, enabled: 1, enableBlockReason: '不能启用：未配置容器底图' },
    })
    expect(wrapper.text()).toContain('仅台账')
  })

  it('**没有删除按钮** —— 台账是历史依据，接口只提供启停', async () => {
    await open({ mode: 'edit', row: ROW })
    expect(buttonByText('删除'), '抽屉里出现了删除按钮，但后端没有删除接口').toBeFalsy()
  })
})

describe('权限', () => {
  it('无 equipment:edit → 没有保存按钮，字段是禁用的', async () => {
    await open({ mode: 'edit', row: ROW, canEdit: false })
    expect(buttonByText('保存'), '无权限时不该出现保存按钮').toBeFalsy()
    expect(wrapper.find('input[aria-label="设备名称"]').element.disabled).toBe(true)
  })

  it('有权限时保存按钮在（上一条的反面对照）', async () => {
    await open({ mode: 'edit', row: ROW, canEdit: true })
    expect(buttonByText('保存')).toBeTruthy()
  })
})

describe('关闭保护', () => {
  it('改过内容再按 Esc → 先弹确认；选"继续编辑"就留在抽屉里', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce(new Error('cancel'))
    await open({ mode: 'edit', row: ROW })
    await wrapper.find('input[aria-label="设备名称"]').setValue('改过的名字')

    await wrapper.find('input[aria-label="设备名称"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    const closed = wrapper.emitted('update:modelValue')
    expect(closed?.[closed.length - 1]?.[0], '选了继续编辑却把抽屉关了').not.toBe(false)
  })

  it('没改过就按 Esc → 直接关（不打扰）', async () => {
    await open({ mode: 'edit', row: ROW })
    await wrapper.find('input[aria-label="设备名称"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    const closed = wrapper.emitted('update:modelValue')
    expect(closed?.[closed.length - 1]?.[0]).toBe(false)
  })
})
