import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ElementPlus from 'element-plus'

/**
 * 采购看板挂载冒烟（变更-148）。
 *
 * 守三件事：
 *   ① 默认只请求"未到货"（OPEN_STATUSES），不把已到货的历史一起拉回来
 *   ② 四列都渲染，卡片落在对应列里（状态 → 列的映射错了，看板就失去意义）
 *   ③ 点卡片能打开抽屉（录入页那套抽屉，看板复用）
 *
 * 不测样式、不测排序细节 —— 排序在 `tests/unit/purchaseBoard.spec.js` 里用纯函数测，
 * 这里只确认"接上了"。
 */

vi.mock('../../src/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))
vi.mock('../../src/api/auth', () => ({
  hasPerm: vi.fn(() => true),
  isLoggedIn: vi.fn(() => true),
}))

const request = (await import('../../src/api/request')).default

const ROWS = [
  {
    id: 1,
    materialName: '电磁隔膜计量泵',
    spec: '流量 120L/h',
    category: '五金',
    quantity: 1,
    unit: '台',
    status: 'WAITING',
    statusLabel: '等货',
    requiredArrivalDate: '2026-10-29',
    daysToDue: 7,
    requester: '段佳林',
  },
  {
    id: 2,
    materialName: '立式长杆泥浆泵',
    spec: '扬程 8m',
    category: '五金',
    quantity: 1,
    unit: '台',
    status: 'OVERDUE',
    statusLabel: '超期',
    requiredArrivalDate: '2026-10-20',
    overdueDays: 2,
    requester: '谭主任',
  },
  {
    id: 3,
    materialName: '法兰弹簧全启式安全阀',
    category: '五金',
    quantity: 1,
    unit: '台',
    status: 'PENDING_OA',
    statusLabel: '待提单',
    requiredArrivalDate: '2026-10-26',
    daysToDue: 4,
    requester: '章主任',
  },
]

async function mountBoard() {
  const mod = await import('../../src/components/purchase/PurchaseBoard.vue')
  // 抽屉里有 ElSelect 等真实 EP 组件，必须挂真插件（只上 stub 会触发递归更新）
  const wrapper = mount(mod.default, {
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  request.get.mockImplementation((url) => {
    if (url === '/api/purchase/list') {
      return Promise.resolve({ data: { success: true, dataList: ROWS, total: ROWS.length } })
    }
    return Promise.resolve({ data: { success: true, data: {} } })
  })
  request.post.mockResolvedValue({ data: { success: true } })
  request.delete.mockResolvedValue({ data: { success: true } })
})

describe('采购看板', () => {
  it('默认只拉未到货的四个状态（不带已到货）', async () => {
    await mountBoard()
    const call = request.get.mock.calls.find(([u]) => u === '/api/purchase/list')
    expect(call).toBeTruthy()
    expect(call[1].params.statuses).toBe('PENDING_OA,WAITING,DUE_SOON,OVERDUE')
    // 一次拉满 200（后端 MAX_PAGE_SIZE），不靠翻页
    expect(call[1].params.pageSize).toBe(200)
  })

  it('默认三列（已到货列关掉时不渲染，免得白占 1/4 宽度），卡片落在对应列里', async () => {
    const wrapper = await mountBoard()
    const heads = wrapper.findAll('section h3').map((h) => h.text())
    expect(heads.some((t) => t.startsWith('待提单'))).toBe(true)
    expect(heads.some((t) => t.startsWith('等货'))).toBe(true)
    expect(heads.some((t) => t.startsWith('超期'))).toBe(true)
    // 默认不请求已到货，所以那一列必然是空的 —— 不渲染
    expect(heads.some((t) => t.startsWith('已到货'))).toBe(false)

    // 超期那张卡必须出现在「超期」列里，而不是「等货」列
    const sections = wrapper.findAll('section')
    const overdue = sections.find((s) => (s.find('h3').text() || '').startsWith('超期'))
    expect(overdue.text()).toContain('立式长杆泥浆泵')
    const waiting = sections.find((s) => (s.find('h3').text() || '').startsWith('等货'))
    expect(waiting.text()).toContain('电磁隔膜计量泵')
    expect(waiting.text()).not.toContain('立式长杆泥浆泵')
  })

  it('关掉「显示已到货」时不渲染永远空的已到货列（列数跟着开关走）', async () => {
    const wrapper = await mountBoard()
    const labelOf = (s) => (s.find('h3') ? s.find('h3').text() : '')
    const heads = wrapper.findAll('section').map(labelOf)
    expect(heads.some((t) => t.startsWith('已到货'))).toBe(false)
    expect(heads).toHaveLength(3)
  })

  it('点卡片打开抽屉（复用录入页的抽屉）', async () => {
    const wrapper = await mountBoard()
    // 卡片根已从 <button> 改成 div[role=button]（变更-167：里面要放 OA 链接）
  const firstCard = wrapper.find('section [role="button"][aria-label]')
    expect(firstCard.exists()).toBe(true)
    await firstCard.trigger('click')
    await nextTick()
    // 抽屉打开后，DOM 里会出现抽屉的标题区（含"保存"按钮）
    expect(document.body.innerHTML + wrapper.html()).toContain('保存')
  })
})
