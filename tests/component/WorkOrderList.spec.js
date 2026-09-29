import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

// API 层打桩：挂载时组件会并发拉工单/领料/入库/货物移动四份数据，测试里不发真实请求
vi.mock('../../src/api/request', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { success: true, dataList: [], data: [] } })),
    post: vi.fn(() => Promise.resolve({ data: { success: true, data: [] } })),
    delete: vi.fn(() => Promise.resolve({ data: { success: true } })),
  },
}))

// 页面里 goLogin / handleLogout 用到 router，这里只需要方法存在
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

import WorkOrderList from '../../src/views/WorkOrderList.vue'
import OrderImageDialog from '../../src/components/OrderImageDialog.vue'
import StatsTable from '../../src/components/StatsTable.vue'

const TAB_LABELS = [
  '工单汇总',
  '领料汇总',
  '入库汇总',
  '工单报工',
  '工单核算',
  '原辅料核算',
  '周统计',
  '日报表记录',
  '压力容器体积计算',
  '电费预提',
]

/**
 * 冒烟测试：WorkOrderList.vue 是大页面（11 个 Tab），
 * 拆组件之后最怕的就是「模板里引用了已经删掉的东西」这类低级错误 ——
 * 构建能过、但一打开页面就白屏。这里把整页挂起来跑一遍兜住这种情况。
 */
function mountPage() {
  return mount(WorkOrderList, {
    global: {
      plugins: [ElementPlus],
      stubs: { RouterLink: true },
    },
  })
}

// Tab 标签可能是 button/span/div，取「文本恰好等于标签名的最深节点」
function findTabLabel(wrapper, text) {
  return wrapper
    .findAll('button, a, span, div')
    .find((node) => node.element.children.length === 0 && node.text().trim() === text)
}

describe('WorkOrderList 页面冒烟', () => {
  let wrapper

  beforeEach(() => {
    wrapper = mountPage()
  })

  it('能挂载并列出所有未做权限过滤的 Tab', () => {
    const text = wrapper.text()

    for (const label of TAB_LABELS) {
      expect(text).toContain(label)
    }
  })

  it('三张汇总表都交给 StatsTable 渲染，且列配置与空表文案正确', () => {
    const tables = wrapper.findAllComponents(StatsTable)
    expect(tables).toHaveLength(3)

    const [report, costing, materialCosting] = tables

    expect(report.props('emptyText')).toBe('暂无报工数据')
    expect(report.props('columns')[1].key).toBe('orderType')
    // 长物料名列需要换行限宽
    expect(report.props('columns')[2]).toMatchObject({ key: 'materialDesc', wrap: true })

    expect(costing.props('emptyText')).toBe('暂无核算数据')
    expect(costing.props('columns').map((column) => column.key)).toEqual([
      'index',
      'materialName',
      'materialCode',
      'inboundQty',
      'reportedQty',
      'unreportedQty',
    ])
    // 未报工数需要高亮
    expect(costing.props('columns')[5].emphasis).toBe(true)

    expect(materialCosting.props('columns')[3].key).toBe('pickQty')
  })

  it('空数据时渲染的是空表文案而不是空白', () => {
    expect(wrapper.findAllComponents(StatsTable)[0].text()).toContain('暂无报工数据')
  })

  it('图片弹窗挂在页面里（工单汇总行点击的入口组件）', () => {
    expect(wrapper.findComponent(OrderImageDialog).exists()).toBe(true)
  })

  it('切换 Tab 会切换对应面板的显示（v-show）', async () => {
    const reportPanel = wrapper.findAllComponents(StatsTable)[0].element.parentElement
    expect(reportPanel.style.display).toBe('none')

    const tab = findTabLabel(wrapper, '工单报工')
    expect(tab).toBeTruthy()
    await tab.trigger('click')

    expect(reportPanel.style.display).toBe('')
  })

  it('周统计面板按默认区间（上周一到上周日）生成标题', () => {
    expect(wrapper.text()).toMatch(/\d+月\d+日-\d+月\d+日周统计（截止\d+月\d+日晚8点）/)
  })
})
