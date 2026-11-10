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

  /*
   * 2026-11-10：看板补了「新增」入口 —— 以前想登记只能切到录入页，
   * 看到缺料还得换页，是使用方这次要把两页并回一页的直接原因。
   */
  it('点「＋ 新增需求」开的是新建抽屉（不是编辑某条）', async () => {
    const wrapper = await mountBoard()
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('新增需求'))
    expect(addBtn).toBeTruthy()
    await addBtn.trigger('click')
    await nextTick()
    expect(document.body.textContent).toContain('新增采购需求')
  })

  /*
   * 2026-11-10 事故回归：抽屉里填的单据类型 / 验收单 / 采购单，保存时被白名单丢掉。
   *
   * 看板这一层只负责「原样往下传」，错不在它 —— 但整条链是从这里开始的，
   * 所以在这里钉一句：抽屉交出来的 payload，POST 体里必须一项不少。
   */
  it('抽屉保存 → POST 体里带着单据类型与验收单（白名单漏字段的回归）', async () => {
    const wrapper = await mountBoard()
    wrapper.findComponent({ name: 'PurchaseDetailDrawer' }).vm.$emit('save', {
      ...ROWS[0],
      orderType: 'ZCSG',
      acceptanceNo: 'YS-001',
      poNo: 'PO-001',
    })
    await flushPromises()

    const post = request.post.mock.calls.find(([u]) => u === '/api/purchase/save')
    expect(post, '保存没有发出去').toBeTruthy()
    const body = post[1]
    expect(body.orderType).toBe('ZCSG')
    expect(body.acceptanceNo).toBe('YS-001')
    expect(body.poNo).toBe('PO-001')
  })

  /*
   * 删除是物理删除（后端 deleteById，连送货单图片一起删，没有回收站）。
   * 所以"先问一句"必须真的发生 —— 这条守的是"不能点一下就删"。
   */
  it('删除先弹确认：取消就不发请求，确认才真删', async () => {
    const { ElMessageBox } = await import('element-plus')
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')

    const wrapper = await mountBoard()
    wrapper.findComponent({ name: 'PurchaseDetailDrawer' }).vm.$emit('delete', ROWS[0])
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalled()
    // 文案里要能看出删的是哪条，且写明不可恢复
    const text = confirmSpy.mock.calls.at(-1)[0]
    expect(text).toContain('电磁隔膜计量泵')
    expect(text).toContain('不可恢复')
    expect(request.delete).not.toHaveBeenCalled()

    // 确认之后才发 DELETE
    confirmSpy.mockResolvedValue('confirm')
    wrapper.findComponent({ name: 'PurchaseDetailDrawer' }).vm.$emit('delete', ROWS[0])
    await flushPromises()
    expect(request.delete).toHaveBeenCalledWith('/api/purchase/delete', { params: { id: 1 } })
    confirmSpy.mockRestore()
  })
})
