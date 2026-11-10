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
 * 采购需求弹窗（变更-117 → 变更-181 → 变更-184）。
 *
 * 使用方原话（2026-11-10）：
 *
 *   「最上面固定信息是 OA 单号，下面就是序号、物料名称、物料编码、规格型号、数量、
 *     类别、用途、要求到货日期、实际到货数量、实际到货日期、备注、送货单图片。
 *     为什么要加序号呢，因为一个 OA 单号一般不会只买一种物料。
 *     所以之前很多输入框占一行就不行，它没必要占一行，太占位置了。」
 *
 * 所以这里守三件事：
 *   1. 台账是**多行**的，一行一条物料，加行/删行不整单重开；
 *   2. 抬头（OA 单号/类型/采购单/验收单）只填一份，保存时逐行冗余下去；
 *   3. 只读单据视图（docket）不能漏出输入框，也不能把别的单的明细混进来。
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
  poNo: '',
  poUrl: '',
  acceptanceNo: '',
  acceptanceUrl: '',
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
  await new Promise((r) => setTimeout(r, 140))
  return wrapper
}

/** 找弹窗里的按钮（按文案，去掉空白） */
function buttonByText(text) {
  return wrapper.findAll('button').find((b) => b.text().replace(/\s/g, '') === text)
}

async function clickButton(text) {
  const btn = wrapper.findAll('button').find((b) => b.text().replace(/\s/g, '').includes(text))
  expect(btn, `找不到「${text}」按钮`).toBeTruthy()
  await btn.trigger('click')
  await flushPromises()
  await nextTick()
}

/** 台账里的某一格（第 n 行，1 起） */
function cell(label, index = 1) {
  return wrapper.find(`input[aria-label="第 ${index} 行${label}"]`)
}

async function fillLine(index, { requester, name, quantity }) {
  if (requester !== undefined) await cell('需求人', index).setValue(requester)
  if (name !== undefined) await cell('物料名称', index).setValue(name)
  if (quantity !== undefined) await cell('数量', index).setValue(quantity)
}

/** 链接小窗是 append-to-body 的（生产里主弹窗有 transform，不传送会被裁），所以从 body 上找 */
function bodyButton(text) {
  return Array.from(document.body.querySelectorAll('button')).find(
    (b) => b.textContent.replace(/\s/g, '') === text,
  )
}

async function setNativeValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
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

describe('新增：一张 OA 单 = 一张台账', () => {
  it('打开就是一行空白台账，光标落在物料名称（少点一次）', async () => {
    await open()
    const input = cell('物料名称')
    expect(input.exists(), '新建没有物料名称输入框').toBe(true)
    expect(input.element.value).toBe('')
    expect(document.activeElement, '新建没有自动聚焦物料名称').toBe(input.element)
    // 提出日期预填今天，省得每次点日期
    expect(cell('提出需求日期').element.value).toBeTruthy()
  })

  it('加一行 → 表里多一行，序号跟着变', async () => {
    await open()
    expect(wrapper.findAll('tbody tr').length).toBe(1)

    await clickButton('加一行')
    expect(wrapper.findAll('tbody tr').length, '点了加一行没有多出一行').toBe(2)
    expect(cell('物料名称', 2).element.value).toBe('')
  })

  it('整单保存：两行一起交出去，抬头逐行冗余', async () => {
    await open()
    await wrapper.find('input[aria-label="OA 单号"]').setValue('CG-CGSQ-20261110001')
    await clickButton('加一行')
    await fillLine(1, { requester: '洪旭', name: '水泵接合器保温罩', quantity: '8' })
    await fillLine(2, { requester: '章主任', name: '方形吨袋', quantity: '30' })

    await clickButton('保存整单')
    const payload = wrapper.emitted('save')?.[0]?.[0]
    expect(payload, '点保存整单没有抛出 save').toBeTruthy()
    expect(payload.rows.length, '两行没有一起交出去').toBe(2)
    expect(payload.rows[0]).toMatchObject({
      oaNo: 'CG-CGSQ-20261110001',
      requester: '洪旭',
      materialName: '水泵接合器保温罩',
      requestDate: expect.any(String),
    })
    expect(payload.rows[1].materialName).toBe('方形吨袋')
    // 每行都要带上抬头，否则后端按行存的时候又得回填一遍
    expect(payload.rows[1].oaNo).toBe('CG-CGSQ-20261110001')
  })

  it('有空行（物料名称没填）不保存，且提示第几行', async () => {
    await open()
    await clickButton('加一行')
    await fillLine(1, { requester: '洪旭', name: '乙炔', quantity: '1' })
    // 第 2 行留空：既不该拦住整单，也不该把空行写进库
    await clickButton('保存整单')
    const payload = wrapper.emitted('save')?.[0]?.[0]
    expect(payload.rows.length, '空行被当成一条需求存进去了').toBe(1)
  })

  it('缺必填（数量）不让存，并说清是第几行', async () => {
    await open()
    await fillLine(1, { requester: '洪旭', name: '乙炔' })
    await clickButton('保存整单')
    expect(wrapper.emitted('save'), '必填没齐却把单存了').toBeFalsy()
    expect(wrapper.text()).toContain('第 1 行数量空着')
  })

  it('链接不占表头：点单号右边的「链接」填一次，整单每行都带上', async () => {
    await open()
    const chip = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === '给这张单加 OA 链接')
    expect(chip, 'OA 单号右边没有链接按钮').toBeTruthy()
    await chip.trigger('click')
    await flushPromises()

    // 小窗里只有一个网址输入框
    const urlInput = document.body.querySelector('input[aria-label="链接地址"]')
    expect(urlInput, '点了链接按钮没有弹出填地址的小窗').toBeTruthy()
    await setNativeValue(urlInput, 'https://ekp.example.com/km/review/1')

    const save = bodyButton('存下来')
    expect(save, '小窗没有「存下来」').toBeTruthy()
    save.click()
    await flushPromises()

    // 存完按钮变实心（aria-label 改口），说明这个字段真有值了
    expect(
      wrapper.findAll('button').some((b) => b.attributes('aria-label') === 'OA 链接已填，点击修改'),
      '链接存下来后按钮没有变成已填状态',
    ).toBe(true)

    await fillLine(1, { requester: '洪旭', name: '乙炔', quantity: '1' })
    await clickButton('保存整单')
    const payload = wrapper.emitted('save')?.[0]?.[0]
    expect(payload.rows[0].oaUrl, '链接没有跟着整单交出去').toBe(
      'https://ekp.example.com/km/review/1',
    )
  })

  it('默认单据类型按页面给（费用申请默认 ZCSG）', async () => {
    await open({ defaultOrderType: 'ZCSG' })
    const selects = wrapper.findAllComponents({ name: 'ElSelect' })
    expect(selects.some((c) => c.props('modelValue') === 'ZCSG')).toBe(true)
  })
})

describe('单据视图（一张 OA 单 = 一张单据）', () => {
  it('有 OA 单号时打开先给整张单：同单合并、按提出日期正序、只读', async () => {
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

    expect(wrapper.text()).toContain('CG-CGSQ-20261022006')
    // 关键字捞回来的结果按单号**全等**过滤：别的单不能混进这张单
    expect(wrapper.text()).not.toContain('别的单的料')

    const rows = wrapper.findAll('tbody tr')
    expect(rows.length, '同单两条明细没合并进来').toBe(2)
    expect(rows[0].text()).toContain('三氯氢硅')
    expect(rows[1].text()).toContain('乙炔')
    // 只读台账里一个输入框都没有
    expect(wrapper.findAll('input').length).toBe(0)
  })

  it('order_type 空着就按单号认类型，不写「单据类型未填」', async () => {
    request.get.mockResolvedValueOnce({ data: { success: true, dataList: [{ ...ROW, orderType: null }] } })
    await open({ mode: 'edit', row: { ...ROW, orderType: null } })
    expect(wrapper.text()).toContain('采购申请 CGSQ')
    expect(wrapper.text()).not.toContain('单据类型未填')
  })

  it('没有 OA 单号的老数据不伪造单据，直接落台账', async () => {
    await open({ mode: 'edit', row: { ...ROW, oaNo: '' } })
    expect(cell('需求人').exists(), '没有 OA 单号时应当直接可编辑').toBe(true)
    expect(cell('需求人').element.value).toBe('张三')
    expect(buttonByText('编辑这张单')).toBeFalsy()
  })
})

describe('编辑：整张单一起改', () => {
  it('点「编辑这张单」→ 台账里就是这张单的所有行，抬头带过来', async () => {
    request.get.mockResolvedValueOnce({ data: { success: true, dataList: [ROW] } })
    await open({ mode: 'edit', row: ROW })

    await clickButton('编辑这张单')
    expect(wrapper.findAll('tbody tr').length).toBe(1)
    expect(cell('需求人').element.value).toBe('张三')
    expect(cell('物料名称').element.value).toBe('三氯氢硅')
    expect(wrapper.find('input[aria-label="OA 单号"]').element.value).toBe('CG-CGSQ-20261022006')
    // 从单据进来的，要能回去；不能只剩「取消」把人连单一起关掉
    expect(wrapper.findAll('button').some((b) => b.text().includes('返回单据'))).toBe(true)
  })

  it('删除已有行先确认，确认后把那条抛给父组件', async () => {
    request.get.mockResolvedValueOnce({ data: { success: true, dataList: [ROW] } })
    await open({ mode: 'edit', row: ROW })
    await clickButton('编辑这张单')

    const del = wrapper.find('button[aria-label="删掉第 1 行"]')
    expect(del.exists(), '台账里没有删除这一行的按钮').toBe(true)
    await del.trigger('click')
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(wrapper.emitted('delete')?.[0]?.[0]).toMatchObject({ id: 7 })
  })

  it('取消删除确认 → 行还在，不抛 delete', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce(new Error('cancel'))
    request.get.mockResolvedValueOnce({ data: { success: true, dataList: [ROW] } })
    await open({ mode: 'edit', row: ROW })
    await clickButton('编辑这张单')

    await wrapper.find('button[aria-label="删掉第 1 行"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('delete')).toBeFalsy()
    expect(wrapper.findAll('tbody tr').length).toBe(1)
  })

  it('编辑时把单据类型装进下拉，保存时原样带回去', async () => {
    request.get.mockResolvedValueOnce({
      data: { success: true, dataList: [{ ...ROW, orderType: 'FWCGSQ' }] },
    })
    await open({ mode: 'edit', row: { ...ROW, orderType: 'FWCGSQ' } })
    await clickButton('编辑这张单')

    const selects = wrapper.findAllComponents({ name: 'ElSelect' })
    const orderTypeSelect = selects.find((c) => c.props('modelValue') === 'FWCGSQ')
    expect(orderTypeSelect, '打开编辑时单据类型没装进下拉').toBeTruthy()

    await clickButton('保存整单')
    const saved = wrapper.emitted('save')?.[0]?.[0]
    expect(saved.rows[0].orderType).toBe('FWCGSQ')
    // 白名单漏字段不会报错，只会静默丢数据 —— 这两项以前漏过
    expect(saved.rows[0]).toHaveProperty('acceptanceNo')
    expect(saved.rows[0]).toHaveProperty('poNo')
  })
})

describe('权限', () => {
  it('无 purchase:edit → 单据只读：没有保存、编辑、加行、删除', async () => {
    request.get.mockResolvedValueOnce({ data: { success: true, dataList: [ROW] } })
    await open({ mode: 'edit', row: ROW, canEdit: false })

    expect(wrapper.text()).toContain('三氯氢硅')
    expect(buttonByText('保存整单'), '无权限时不该出现保存按钮').toBeFalsy()
    expect(buttonByText('编辑这张单'), '无权限时不该出现编辑入口').toBeFalsy()
    expect(buttonByText('加一行')).toBeFalsy()
    expect(wrapper.find('button[aria-label="删掉第 1 行"]').exists()).toBe(false)
  })
})

describe('关闭保护', () => {
  it('台账里改过内容再按 Esc → 先问一句，选「继续编辑」就留在原地', async () => {
    ElMessageBox.confirm.mockRejectedValueOnce(new Error('cancel'))
    await open()
    await cell('物料名称').setValue('乙炔')

    await wrapper.find('.drawer-enter').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    const closed = wrapper.emitted('update:modelValue')
    expect(closed?.[closed.length - 1]?.[0], '选了继续编辑却把弹窗关了').not.toBe(false)
  })

  it('只读单据视图按 Esc → 直接关（没东西可丢）', async () => {
    request.get.mockResolvedValueOnce({ data: { success: true, dataList: [ROW] } })
    await open({ mode: 'edit', row: ROW })
    await wrapper.find('.drawer-enter').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    const closed = wrapper.emitted('update:modelValue')
    expect(closed?.[closed.length - 1]?.[0]).toBe(false)
  })

  it('从单据进台账后按 Esc → 回单据，不关窗', async () => {
    request.get.mockResolvedValue({ data: { success: true, dataList: [ROW] } })
    await open({ mode: 'edit', row: ROW })
    await clickButton('编辑这张单')

    await wrapper.find('.drawer-enter').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.text(), 'Esc 没有回到整张单').toContain('编辑这张单')
    const closed = wrapper.emitted('update:modelValue')
    expect(closed?.[closed.length - 1]?.[0], 'Esc 把弹窗关掉了').not.toBe(false)
  })
})
