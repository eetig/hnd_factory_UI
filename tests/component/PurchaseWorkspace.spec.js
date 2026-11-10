import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'

/**
 * 采购工作台（2026-11-10：把「采购看板」与「采购录入」并成一页两个页签）。
 *
 * 守三件事：
 *   ① 默认落在「看板」页签，且**不会**顺手把录入页那份列表也请求一遍（懒挂载）
 *   ② 切到「录入 / 历史」之后两个视图都在 DOM 里，只切可见性（草稿/滚动位置不能丢）
 *   ③ 页签写进 URL（`?tab=entry`），刷新与分享能回到同一个视图
 */
vi.mock('../../src/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))
vi.mock('../../src/api/auth', () => ({
  hasPerm: vi.fn(() => true),
  isLoggedIn: vi.fn(() => true),
  isAdmin: vi.fn(() => true),
}))

const request = (await import('../../src/api/request')).default

async function mountWorkspace(initialPath = '/purchase/board') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/purchase/board', component: { template: '<div />' } },
      { path: '/purchase/entry', component: { template: '<div />' } },
    ],
  })
  await router.push(initialPath)
  await router.isReady()

  const mod = await import('../../src/components/purchase/PurchaseWorkspace.vue')
  const wrapper = mount(mod.default, {
    attachTo: document.body,
    global: { plugins: [router, ElementPlus] },
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  vi.clearAllMocks()
  request.get.mockImplementation((url) => {
    if (url === '/api/purchase/list') {
      return Promise.resolve({ data: { success: true, dataList: [], total: 0 } })
    }
    if (url === '/api/purchase/summary') {
      return Promise.resolve({ data: { success: true, data: {} } })
    }
    return Promise.resolve({ data: { success: true, data: {} } })
  })
})

describe('采购工作台：看板 + 录入/历史', () => {
  it('默认落在「看板」，且只有一个页签在跑数据（录入页懒挂载）', async () => {
    const { wrapper } = await mountWorkspace()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(tabs[0].text()).toContain('看板')
    expect(tabs[1].text()).toContain('录入')

    // 看板在（列头出来了），录入页还没挂载（"采购需求详情"是那块面板的标题）
    expect(wrapper.text()).toContain('待提单')
    expect(wrapper.text()).not.toContain('采购需求详情')

    // 只发了看板那一次 /list（pageSize 200），没有多打一份录入页的分页请求
    const listCalls = request.get.mock.calls.filter(([u]) => u === '/api/purchase/list')
    expect(listCalls).toHaveLength(1)
    expect(listCalls[0][1].params.pageSize).toBe(200)
  })

  it('切到「录入 / 历史」后两块都在 DOM 里，只切可见性（切回来不重建）', async () => {
    const { wrapper, router } = await mountWorkspace()
    const entryTab = wrapper.findAll('[role="tab"]')[1]

    await entryTab.trigger('click')
    await flushPromises()

    expect(entryTab.attributes('aria-selected')).toBe('true')
    expect(wrapper.text()).toContain('采购需求详情')
    // 看板那块还在（v-show 隐藏），没有卸载
    expect(wrapper.text()).toContain('待提单')
    // 页签进 URL：刷新/分享能回到同一个视图
    expect(router.currentRoute.value.query.tab).toBe('entry')

    // 切回看板：URL 上的 tab 被清掉（不带空值，保持地址干净）
    await wrapper.findAll('[role="tab"]')[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBeUndefined()
  })

  it('点侧栏回到 /purchase/board 时页签跟着回到「看板」（URL 说了算，不是各说各话）', async () => {
    const { wrapper, router } = await mountWorkspace('/purchase/board?tab=entry')
    await flushPromises()
    expect(wrapper.findAll('[role="tab"]')[1].attributes('aria-selected')).toBe('true')

    await router.push('/purchase/board')
    await flushPromises()
    expect(wrapper.findAll('[role="tab"]')[0].attributes('aria-selected')).toBe('true')
  })

  it('深链 ?tab=entry 直接落在录入页签（旧书签 /purchase/entry 走的就是这条路）', async () => {
    const { wrapper } = await mountWorkspace('/purchase/board?tab=entry')
    await flushPromises()
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
    expect(wrapper.text()).toContain('采购需求详情')
  })

  /*
   * 本批默认值（决策③）：一张 OA 单通常是 5 条物料、同一需求人。
   * 行里留空就继承表头，填了以行为准 —— 这条守的是"别再让人把需求人填 5 遍"。
   */
  it('批量录入：行里留空的需求人/OA 单号，保存时用「本批默认」补上', async () => {
    const { wrapper } = await mountWorkspace('/purchase/board?tab=entry')
    await flushPromises()

    const addRow = wrapper.findAll('button').find((b) => b.text().includes('新增一行'))
    expect(addRow).toBeTruthy()
    await addRow.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('本批默认')

    await wrapper.find('input[aria-label="本批需求人"]').setValue('张三')
    await wrapper.find('input[aria-label="本批 OA 单号"]').setValue('CG-CGSQ-2026110099')
    // 行里只填物料三件套，需求人/日期留空
    await wrapper.find('input[placeholder="物料名称"]').setValue('不锈钢球阀')
    await wrapper.find('input[placeholder="数量"]').setValue('2')
    // 单位是下拉（数量格内并排），走 v-model 的 emit 而不是原生 input
    const unitSelect = wrapper
      .findAllComponents({ name: 'ElSelect' })
      .find((c) => c.props('placeholder') === '单位')
    expect(unitSelect).toBeTruthy()
    unitSelect.vm.$emit('update:modelValue', '个')
    await flushPromises()

    const saveAll = wrapper.findAll('button').find((b) => b.text().includes('保存全部'))
    await saveAll.trigger('click')
    await flushPromises()

    const saveCall = request.post.mock.calls.find(([u]) => u === '/api/purchase/save')
    expect(saveCall).toBeTruthy()
    const payload = saveCall[1]
    expect(payload.materialName).toBe('不锈钢球阀')
    expect(payload.requester).toBe('张三')
    expect(payload.oaNo).toBe('CG-CGSQ-2026110099')
    expect(payload.requestDate).toBeTruthy()
  })
})
