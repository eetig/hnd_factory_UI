import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'

// 抽屉里有远程物料检索与图片上传，测试里不发真实请求
vi.mock('../../src/api/request', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { success: true, data: [], dataList: [] } })),
    post: vi.fn(() => Promise.resolve({ data: { success: true, data: 'x.png' } })),
    delete: vi.fn(() => Promise.resolve({ data: { success: true } })),
  },
}))

import PurchaseDetailDrawer from '../../src/components/purchase/PurchaseDetailDrawer.vue'

/**
 * 采购需求抽屉（变更-117）。
 *
 * 三条是验收标准里点名的：
 *   · 新建模式**回车即提交**（"≤3 次点击"里的第三次可以省成一次回车）；
 *   · 无 `purchase:edit` 权限时**不出保存按钮**（也不出删除）；
 *   · 有未保存改动时按 Esc 要**先问一句**，不能悄悄丢。
 *
 * 抽屉的权限是用 `canEdit` prop 传进来的（不读全局 auth），所以这里不用打桩 auth。
 */
const ROW = {
  id: 7,
  requester: '张三',
  requestDate: '2026-10-01',
  materialName: '三氯氢硅',
  materialCode: '111001787',
  spec: '99%',
  purpose: '合成',
  category: '原料',
  quantity: 25,
  unit: '个',
  requiredArrivalDate: '2026-10-20',
  oaNo: 'OA-1',
  oaUrl: '',
  deliveryNote: '',
  receivedQuantity: '',
  actualArrivalDate: '',
  remark: '急',
  status: 'OVERDUE',
  overdueDays: 3,
}

let wrapper

async function open(props = {}) {
  wrapper = mount(PurchaseDetailDrawer, {
    attachTo: document.body,
    props: { modelValue: true, mode: 'create', canEdit: true, row: null, ...props },
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  await nextTick()
  // 自动聚焦是延迟一帧做的（等 el-drawer 的焦点陷阱先落位）
  await new Promise((r) => setTimeout(r, 120))
  return wrapper
}

/** 找抽屉里的按钮（按文案） */
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
  it('打开即空表，且光标落在物料名称（第三次点击可以省成打字）', async () => {
    await open()
    const input = wrapper.find('input[aria-label="物料名称"]')
    expect(input.exists(), '抽屉里没有物料名称输入框').toBe(true)
    expect(input.element.value).toBe('')
    expect(document.activeElement, '新建模式没有自动聚焦物料名称').toBe(input.element)
  })

  it('在输入框里回车 → 直接提交（不用点保存）', async () => {
    await open()
    await wrapper.find('input[aria-label="需求人"]').setValue('李四')
    await wrapper.find('input[aria-label="物料名称"]').setValue('乙炔')
    await wrapper.find('input[aria-label="物料名称"]').trigger('keydown', { key: 'Enter' })

    const saved = wrapper.emitted('save')
    expect(saved, '回车没有触发保存').toBeTruthy()
    expect(saved[0][0]).toMatchObject({ requester: '李四', materialName: '乙炔' })
  })

  it('在下拉里回车**不**提交（否则选个类别就把表存了）', async () => {
    await open()
    const select = wrapper.find('.el-select')
    expect(select.exists()).toBe(true)
    await select.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')).toBeFalsy()
  })
})

describe('编辑模式', () => {
  it('带上行数据打开，字段是这条记录的值', async () => {
    await open({ mode: 'edit', row: ROW })
    expect(wrapper.find('input[aria-label="需求人"]').element.value).toBe('张三')
    expect(wrapper.find('input[aria-label="物料名称"]').element.value).toBe('三氯氢硅')
    // 超期天数由后端给，抽屉只显示
    expect(wrapper.text()).toContain('已超 3 天')
  })

  it('点删除 → 抛给父组件（二次确认在父组件里做）', async () => {
    await open({ mode: 'edit', row: ROW })
    const del = buttonByText('删除')
    expect(del, '编辑模式没有删除按钮').toBeTruthy()
    await del.trigger('click')
    expect(wrapper.emitted('delete')?.[0][0]).toMatchObject({ id: 7 })
  })
})

describe('权限', () => {
  it('无 purchase:edit → 没有保存按钮、没有删除按钮，字段是禁用的', async () => {
    await open({ mode: 'edit', row: ROW, canEdit: false })
    expect(buttonByText('保存'), '无权限时不该出现保存按钮').toBeFalsy()
    expect(buttonByText('删除'), '无权限时不该出现删除按钮').toBeFalsy()
    expect(wrapper.find('input[aria-label="物料名称"]').element.disabled).toBe(true)
  })

  it('有权限时保存按钮在（这条是上一条的反面对照）', async () => {
    await open({ mode: 'edit', row: ROW, canEdit: true })
    expect(buttonByText('保存')).toBeTruthy()
  })
})

describe('关闭保护', () => {
  it('改过内容再按 Esc → 先弹确认；用户选"继续编辑"就留在抽屉里', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce(new Error('cancel'))
    await open({ mode: 'edit', row: ROW })
    await wrapper.find('input[aria-label="需求人"]').setValue('王五')

    await wrapper.find('input[aria-label="需求人"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    const closed = wrapper.emitted('update:modelValue')
    expect(closed?.[closed.length - 1]?.[0], '选了继续编辑却把抽屉关了').not.toBe(false)
  })

  it('没改过就按 Esc → 直接关（不打扰）', async () => {
    await open({ mode: 'edit', row: ROW })
    await wrapper.find('input[aria-label="需求人"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    const closed = wrapper.emitted('update:modelValue')
    expect(closed?.[closed.length - 1]?.[0]).toBe(false)
  })
})
