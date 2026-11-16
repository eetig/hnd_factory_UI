import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

// 历史记录页只读：不新增接口，靠 /api/purchase/list 循环拉全量，再本地筛。
// 测试里把请求与详情抽屉都换掉，只验「筛/排/点开」这三件用户真会做的事。
const get = vi.fn()

vi.mock('../../src/api/request', () => ({
  default: { get: (...args) => get(...args) },
}))

vi.mock('../../src/components/purchase/PurchaseDetailDrawer.vue', () => ({
  default: {
    name: 'PurchaseDetailDrawer',
    props: ['modelValue', 'mode', 'row', 'canEdit'],
    template: '<div data-testid="drawer-stub">{{ row && row.materialName }}</div>',
  },
}))

import PurchaseHistoryView from '../../src/views/purchase/PurchaseHistoryView.vue'

/**
 * 采购 · 历史记录（变更-215）。
 *
 * 使用方原话（2026-11-16）：
 *
 *   「不论是采购看板，还是费用申请里的条目，都会在这个板块显示……
 *     有筛选功能，比如采购类型，提出人，时间范围，物料名称，规格型号等。
 *     这个模块的目的是方便溯源。」
 *
 * 守三件事：
 *   1. 两个来源（采购申请/资产申购、服务采购）混在一张表里，不丢不重；
 *   2. 筛选是**本地立刻生效**的（改一个字就出结果，不再回服务端）；
 *   3. 点一行能打开只读单据（溯源），而不是把它变成一个编辑页。
 */
const ROWS = [
  {
    id: 1,
    status: 'OVERDUE',
    requestDate: '2026-10-19',
    orderType: 'CGSQ',
    requester: '章主任',
    materialName: '法兰弹簧全启式安全阀',
    materialCode: '230016590',
    spec: '公称通径:DN50',
    purpose: '二车间',
    quantity: 1,
    unit: '台',
    requiredArrivalDate: '2026-10-26',
    oaNo: 'CG-CGSQ-1019',
  },
  {
    id: 2,
    status: 'ARRIVED',
    requestDate: '2026-10-22',
    orderType: 'ZCSG',
    requester: '段佳林',
    materialName: '防水断路器箱（成套）',
    materialCode: '230016577',
    spec: '防水断路器箱（成套）',
    purpose: '乙炔车间',
    quantity: 1,
    unit: '台',
    requiredArrivalDate: '2026-10-29',
    oaNo: 'CG-CGSQ-1022',
  },
  {
    id: 3,
    status: 'WAITING',
    requestDate: '2026-11-09',
    orderType: 'FWCGSQ',
    requester: '廖工',
    materialName: '劳务费',
    materialCode: '250000032',
    spec: '—',
    purpose: '清池',
    quantity: 1,
    unit: '个',
    requiredArrivalDate: '2026-11-16',
    oaNo: 'F-FWCGSQ-1109',
  },
]

function mountPage() {
  return mount(PurchaseHistoryView, {
    global: { plugins: [ElementPlus] },
  })
}

describe('采购 · 历史记录', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockResolvedValue({ data: { total: ROWS.length, dataList: ROWS } })
  })

  it('把看板与费用申请的条目合并进同一张表', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(wrapper.text()).toContain('法兰弹簧全启式安全阀')
    expect(wrapper.text()).toContain('防水断路器箱（成套）')
    expect(wrapper.text()).toContain('劳务费')
    // 类型列要把三张单的来源说清楚，否则「溯源」看不出这单当初报的是哪种
    expect(wrapper.text()).toContain('采购申请')
    expect(wrapper.text()).toContain('资产申购')
    expect(wrapper.text()).toContain('服务采购')
  })

  it('按状态筛选是本地立刻生效的，不重新请求', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const callsAfterLoad = get.mock.calls.length

    const overdueChip = wrapper
      .findAll('.chip')
      .find((c) => c.text().includes('超期'))
    await overdueChip.trigger('click')

    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('法兰弹簧全启式安全阀')
    expect(wrapper.text()).not.toContain('劳务费')
    // 关键：本地筛不触发网络请求，否则「改一个字等一下」就没意义了
    expect(get.mock.calls.length).toBe(callsAfterLoad)
  })

  it('物料名称/编码共用一个输入框，两者都能命中', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const input = wrapper.find('input[aria-label="物料名称或编码"]')
    await input.setValue('230016577')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('防水断路器箱')

    await input.setValue('劳务')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('劳务费')
  })

  it('点一行打开只读单据，而不是进入编辑', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('tbody tr')[0].trigger('click')

    const drawer = wrapper.findComponent({ name: 'PurchaseDetailDrawer' })
    expect(drawer.props('canEdit')).toBe(false)
    expect(drawer.props('row').materialName).toBe('法兰弹簧全启式安全阀')
  })
})
