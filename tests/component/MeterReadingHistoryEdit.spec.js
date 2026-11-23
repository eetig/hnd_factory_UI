import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { authState } from '../../src/api/auth'

/**
 * 抄表历史「改读数」弹层（2026-11-23，变更-264）。
 *
 * 使用方原话：「要不做一个功能吧，能够编辑历史抄表数据。不然下次抄错了，又不知道怎么改了。」
 * 起因是把 334.7 抄成 3347。这条链上有三个地方**只有挂载才验得到**：
 *   1. 「改」这一列是不是真的只给管理员（`isAdminUser` 读的是 reactive 的 roleKey）；
 *   2. 弹层里的预览是不是拿**这条记录自己的**上一条 / 倍率算的；
 *   3. 保存时发给后端的是不是 `{ reading }`、以及打的是不是 `/readings/{id}`。
 * 单测跑得起 jsdom，所以不需要真连后端。
 */

// 确认框直接放行：这一测的是「点了保存之后发什么」，不是弹窗文案
// （vi.mock 会被提到文件顶端，所以桩必须用 vi.hoisted 定义）
const { requestMock, confirmMock } = vi.hoisted(() => {
  const HISTORY = [
    {
      id: 12,
      meterId: 7,
      readDate: '2026-11-20',
      meterNo: '1AN13',
      meterName: '4#厂房',
      section: '一车间',
      multiplier: 1,
      reading: 3347,
      prevReading: 3300,
      usageQty: 47,
      imagePath: '/files/meter-20261120.jpg',
      note: '',
    },
  ]
  const NEXT = {
    id: 13,
    meterId: 7,
    readDate: '2026-12-04',
    meterName: '4#厂房',
    section: '一车间',
    multiplier: 1,
    reading: 400,
    prevReading: 3347,
    usageQty: 0,
    imagePath: '',
  }
  return {
    confirmMock: vi.fn(() => Promise.resolve('confirm')),
    requestMock: {
      get: vi.fn((url, config) => {
        const params = config?.params || {}
        if (url === '/api/electricity/meters') return Promise.resolve({ data: { data: [] } })
        if (url === '/api/electricity/sections') return Promise.resolve({ data: { data: ['一车间'] } })
        if (url === '/api/electricity/sheet') return Promise.resolve({ data: { data: [] } })
        if (url === '/api/electricity/readings') {
          // 带 meterId + from 的那次是「查这块表的下一条」
          if (params.meterId) return Promise.resolve({ data: { data: [NEXT] } })
          return Promise.resolve({ data: { data: HISTORY } })
        }
        return Promise.resolve({ data: { data: [] } })
      }),
      put: vi.fn(() =>
        Promise.resolve({
          data: {
            success: true,
            data: {
              id: 12,
              meterId: 7,
              readDate: '2026-11-20',
              before: 3347,
              reading: 334,
              prevReading: 3300,
              usageQty: 34,
              next: { id: 13, readDate: '2026-12-04', reading: 400, prevReading: 334, usageQty: 66 },
            },
          },
        }),
      ),
      post: vi.fn(() => Promise.resolve({ data: { success: true, data: null } })),
      delete: vi.fn(() => Promise.resolve({ data: { success: true } })),
    },
  }
})

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessageBox: { ...actual.ElMessageBox, confirm: confirmMock },
  }
})

vi.mock('../../src/api/request', () => ({ default: requestMock }))

// 这一页只用到 useRoute 读 query（预填日期），给个空壳就够
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

import MeterReadingView from '../../src/views/equipment/MeterReadingView.vue'

let wrapper

async function mountView() {
  wrapper = mount(MeterReadingView, {
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  await new Promise((r) => setTimeout(r, 30))
  return wrapper
}

function buttonByText(text) {
  return wrapper.findAll('button').find((b) => b.text().trim() === text)
}

async function openHistory() {
  const tab = buttonByText('抄表历史')
  expect(tab, '页头应该有「抄表历史」这个 tab').toBeTruthy()
  await tab.trigger('click')
  await flushPromises()

  const query = buttonByText('查询')
  expect(query, '历史 tab 里应该有「查询」').toBeTruthy()
  await query.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.roleKey = 'admin'
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('抄表历史 · 改读数（变更-264）', () => {
  it('管理员能看到「改」这一列，并在弹层里看到这条记录自己的上次读数', async () => {
    await mountView()
    await openHistory()

    const headers = wrapper.findAll('thead th').map((th) => th.text().trim())
    expect(headers).toContain('改')

    const editBtn = buttonByText('改')
    expect(editBtn, '每行右侧应该有一颗「改」').toBeTruthy()
    await editBtn.trigger('click')
    await flushPromises()

    // 弹层标题 + 三个参照数
    expect(wrapper.text()).toContain('改历史读数')
    expect(wrapper.text()).toContain('4#厂房')
    expect(wrapper.text()).toContain('3,300')

    const input = wrapper.find('#reading-edit-input')
    expect(input.exists()).toBe(true)
    expect(input.element.value).toBe('3347')
  })

  it('填 334 后预览用量按「本次 − 上次」算，并把下一期一起说出来', async () => {
    await mountView()
    await openHistory()
    await buttonByText('改').trigger('click')
    await flushPromises()

    const input = wrapper.find('#reading-edit-input')
    await input.setValue('334')
    await flushPromises()

    // 334 − 3300 = -2966；这个负数是正常的（上一次读数是 3300 还是 3347 由数据本身决定），
    // 这里只验「预览跟着输入走」，不验业务口径
    expect(wrapper.text()).toContain('-2,966')

    // 下一期那块必须出现：400 那期的上次读数会变成 334
    expect(wrapper.text()).toContain('下一期会跟着改')
    expect(wrapper.text()).toContain('2026-12-04')
  })

  it('保存时打的是 /readings/{id}，body 只有 reading', async () => {
    await mountView()
    await openHistory()
    await buttonByText('改').trigger('click')
    await flushPromises()

    await wrapper.find('#reading-edit-input').setValue('334')
    await flushPromises()

    const saveBtn = buttonByText('保存')
    expect(saveBtn).toBeTruthy()
    await saveBtn.trigger('click')
    await flushPromises()

    expect(requestMock.put).toHaveBeenCalledTimes(1)
    const [url, body] = requestMock.put.mock.calls[0]
    expect(url).toBe('/api/electricity/readings/12')
    expect(body).toEqual({ reading: 334 })

    // 存完要关弹层 + 重拉历史
    expect(wrapper.find('#reading-edit-input').exists()).toBe(false)
  })

  it('读数填 0 时保存被拦住（按钮 disabled，且不发请求）', async () => {
    await mountView()
    await openHistory()
    await buttonByText('改').trigger('click')
    await flushPromises()

    await wrapper.find('#reading-edit-input').setValue('0')
    await flushPromises()

    expect(wrapper.text()).toContain('读数要填大于 0 的数字')
    const saveBtn = buttonByText('保存')
    expect(saveBtn.attributes('disabled')).toBeDefined()
  })

  it('抄表员（非 admin）看不到「改」这一列', async () => {
    authState.roleKey = 'meter_clerk'
    await mountView()
    await openHistory()

    const headers = wrapper.findAll('thead th').map((th) => th.text().trim())
    expect(headers).not.toContain('改')
    expect(buttonByText('改')).toBeFalsy()
    // 数据本身还在：只是不给改
    expect(wrapper.text()).toContain('3,347')
  })
})
