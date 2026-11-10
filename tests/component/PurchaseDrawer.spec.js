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

import request from '../../src/api/request'
import PurchaseDetailDrawer from '../../src/components/purchase/PurchaseDetailDrawer.vue'

/**
 * 采购需求抽屉（变更-117 → 变更-181）。
 *
 * 2026-11-10 起弹窗有**两层**：
 *   docket —— 有 OA 单号时打开先看「这一张单装了什么」（只读台账）
 *   form   —— 点某一行进去改，或从「再加一条需求」进新表单
 *
 * 所以要守的东西比原来多一条：docket 不能把表单的断言顺手带过去 ——
 * 以前"打开就有输入框"是默认，现在只有从 docket 点进 form 才有。
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
  oaNo: 'CG-CGSQ-20261022006',
  oaUrl: 'https://ekp.example.com/km/review',
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
    // 抽屉默认 append-to-body（变更-141），测试里关掉，DOM 留在原地
    props: { modelValue: true, mode: 'create', canEdit: true, row: null, appendToBody: false, ...props },
    global: {
      plugins: [ElementPlus],
      stubs: {},
    },
  })
  await flushPromises()
  await nextTick()
  // 自动聚焦是延迟一帧做的（等焦点陷阱先落位）
  await new Promise((r) => setTimeout(r, 120))
  return wrapper
}

/** 找抽屉里的按钮（按文案，去掉空白） */
function buttonByText(text) {
  return wrapper.findAll('button').find((b) => b.text().replace(/\s/g, '') === text)
}

/** docket 是只读的：要断言表单，得先点这一行的「编辑」进第二层 */
async function enterForm() {
  const edit = buttonByText('编辑')
  expect(edit, '单据视图里没有「编辑」，进不了表单').toBeTruthy()
  await edit.trigger('click')
  await flushPromises()
  await nextTick()
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

describe('单据视图（一张 OA 单 = 一张单据）', () => {
  it('有 OA 单号时打开先给整张单：单号、同单其它明细、单据级单号都在', async () => {
    request.get.mockResolvedValueOnce({
      data: {
        success: true,
        dataList: [
          { ...ROW, id: 8, materialName: '乙炔', requestDate: '2026-10-05', status: 'WAITING' },
          { ...ROW, id: 7 },
          { ...ROW, id: 9, oaNo: 'CG-CGSQ-不是这张单', materialName: '别的单的料' },
        ],
      },
    })
    await open({ mode: 'edit', row: ROW })

    // 抬头是单号本身 —— 这是他认这张单的唯一标识
    expect(wrapper.text()).toContain('CG-CGSQ-20261022006')
    // 关键字捞回来的结果按单号**全等**过滤：别的单不能混进这张单的台账
    expect(wrapper.text()).not.toContain('别的单的料')

    const rows = wrapper.findAll('tbody tr')
    expect(rows.length, '同单两条明细没合并进来').toBe(2)
    // 按提出日期正序：10-01 在上
    expect(rows[0].text()).toContain('三氯氢硅')
    expect(rows[1].text()).toContain('乙炔')

    // 单据视图里没有表单输入框（只读台账）
    expect(wrapper.findAll('input').length).toBe(0)
  })

  it('「再加一条需求」→ 把这张单的单号与需求人带给新表单', async () => {
    request.get.mockResolvedValueOnce({ data: { success: true, dataList: [ROW] } })
    await open({ mode: 'edit', row: ROW })

    await buttonByText('再加一条需求').trigger('click')
    await flushPromises()
    await nextTick()

    const seed = wrapper.emitted('add-line')?.[0]?.[0]
    expect(seed, '没有把预填值抛给父组件').toMatchObject({
      oaNo: 'CG-CGSQ-20261022006',
      oaUrl: 'https://ekp.example.com/km/review',
      requester: '张三',
    })

    // 表单已经就地打开，且单号是带过来的（不用重填）
    const oaNo = wrapper.find('input[aria-label="OA 单号"]')
    expect(oaNo.exists(), '点了「再加一条」没有切到表单').toBe(true)
    expect(oaNo.element.value).toBe('CG-CGSQ-20261022006')

    // 补完一条要能回到整张单，不能只剩「取消」把人连同单据一起关掉
    expect(wrapper.text(), '在单里加一条却没有回单据的路').toContain('返回单据')
    const back = wrapper.findAll('button').find((b) => b.text().includes('返回单据'))
    expect(back, '回单据的按钮不在').toBeTruthy()
    await back.trigger('click')
    await flushPromises()
    await nextTick()
    expect(wrapper.text(), '点了返回单据没回到整张单').toContain('再加一条需求')
  })

  it('order_type 空着就按单号认类型，不写「单据类型未填」', async () => {
    request.get.mockResolvedValueOnce({ data: { success: true, dataList: [{ ...ROW, orderType: null }] } })
    await open({ mode: 'edit', row: { ...ROW, orderType: null } })
    expect(wrapper.text()).toContain('采购申请 CGSQ')
    expect(wrapper.text()).not.toContain('单据类型未填')
  })

  it('没有 OA 单号的老数据不伪造单据，直接落表单', async () => {
    await open({ mode: 'edit', row: { ...ROW, oaNo: '' } })
    expect(wrapper.find('input[aria-label="需求人"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('再加一条需求')
  })
})

describe('编辑模式（从单据点进某一条）', () => {
  it('点行进表单，字段是这条记录的值', async () => {
    await open({ mode: 'edit', row: ROW })
    await enterForm()
    expect(wrapper.find('input[aria-label="需求人"]').element.value).toBe('张三')
    expect(wrapper.find('input[aria-label="物料名称"]').element.value).toBe('三氯氢硅')
    // 超期天数由后端给，抽屉只显示
    expect(wrapper.text()).toContain('超 3 天')
  })

  /*
   * 2026-11-10 使用方报的 bug：「我保存了单据类型，再次点开就没了」。
   *
   * 真因不在抽屉（抽屉一直有这一格），而在保存时的那份字段白名单
   * `buildPurchasePayload` 漏了 orderType / acceptanceNo / acceptanceUrl / poNo / poUrl ——
   * 白名单漏字段**不会报错**，后端收到的就是没这两项，于是库里一直空。
   * 这条守两端：① 编辑打开时行里的 orderType 要装进下拉；② 保存时原样带回去。
   */
  it('编辑模式把单据类型装进下拉，保存时原样带回去', async () => {
    await open({ mode: 'edit', row: { ...ROW, orderType: 'FWCGSQ' } })
    await enterForm()

    const selects = wrapper.findAllComponents({ name: 'ElSelect' })
    const orderTypeSelect = selects.find((c) => c.props('modelValue') === 'FWCGSQ')
    expect(orderTypeSelect, '打开编辑时单据类型没装进下拉').toBeTruthy()

    await buttonByText('保存').trigger('click')
    const saved = wrapper.emitted('save')?.[0]?.[0]
    expect(saved, '点保存没有抛 save').toBeTruthy()
    expect(saved.orderType).toBe('FWCGSQ')
    // 同一份白名单还漏过这两个：验收单与采购单
    expect(saved).toHaveProperty('acceptanceNo')
    expect(saved).toHaveProperty('poNo')
  })

  it('点删除 → 抛给父组件（二次确认在父组件里做）', async () => {
    await open({ mode: 'edit', row: ROW })
    await enterForm()
    const del = buttonByText('删除')
    expect(del, '编辑模式没有删除按钮').toBeTruthy()
    await del.trigger('click')
    expect(wrapper.emitted('delete')?.[0][0]).toMatchObject({ id: 7 })
  })
})

describe('权限', () => {
  it('无 purchase:edit → 单据只读：没有保存、删除、编辑入口', async () => {
    await open({ mode: 'edit', row: ROW, canEdit: false })
    expect(wrapper.text()).toContain('三氯氢硅')
    expect(buttonByText('保存'), '无权限时不该出现保存按钮').toBeFalsy()
    expect(buttonByText('删除'), '无权限时不该出现删除按钮').toBeFalsy()
    expect(buttonByText('编辑'), '无权限时不该出现编辑入口').toBeFalsy()
    expect(buttonByText('再加一条需求'), '无权限时不该能往单里加需求').toBeFalsy()
  })

  it('有权限时保存按钮在（从单据点进去之后）', async () => {
    await open({ mode: 'edit', row: ROW, canEdit: true })
    await enterForm()
    expect(buttonByText('保存')).toBeTruthy()
  })
})

describe('关闭保护', () => {
  it('改过内容再按 Esc → 先弹确认；用户选"继续编辑"就留在抽屉里', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce(new Error('cancel'))
    await open({ mode: 'edit', row: ROW })
    await enterForm()
    await wrapper.find('input[aria-label="需求人"]').setValue('王五')

    await wrapper.find('input[aria-label="需求人"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    // 表单里按 Esc 是"回单据"，不是关窗 —— 无论选什么，弹窗都不该被关掉
    const closed = wrapper.emitted('update:modelValue')
    expect(closed?.[closed.length - 1]?.[0], '选了继续编辑却把抽屉关了').not.toBe(false)
  })

  it('单据视图按 Esc → 直接关（只读，没什么可丢的）', async () => {
    await open({ mode: 'edit', row: ROW })
    await wrapper.find('.drawer-enter').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    const closed = wrapper.emitted('update:modelValue')
    expect(closed?.[closed.length - 1]?.[0]).toBe(false)
  })
})
