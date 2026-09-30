import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
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

import request from '../../src/api/request'
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
  '月底储罐液位记录',
  '压力容器体积计算',
  '电费预提',
]

/**
 * 月底储罐液位记录（变更-004）的一行样例：字段与后端 TankLevelVO 对齐。
 * 用它验证「接口返回数据 → 表格渲染」这一段是通的（列、数值格式、图据列）。
 */
const TANK_LEVEL_ROW = {
  id: 1,
  recordDate: '2026-08-31',
  location: '一车间',
  category: '产品',
  materialCode: '114001897',
  materialName: 'HND-V150',
  tankName: 'V150储罐A',
  tankCode: 'V150-A',
  levelValue: 1250,
  theoreticalWeight: 1500,
  imageUrl: null,
  thumbnailUrl: null,
}

/**
 * 冒烟测试：WorkOrderList.vue 是大页面（12 个 Tab），
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

  it('月底储罐液位记录：进入 Tab 走接口，表格按台账列渲染返回行', async () => {
    // 只让 /api/tank-level/list 返回一行样例，其余接口维持空数据
    request.get.mockImplementation((url) =>
      Promise.resolve({
        data:
          url === '/api/tank-level/list'
            ? { success: true, dataList: [TANK_LEVEL_ROW], data: [] }
            : { success: true, dataList: [], data: [] },
      }),
    )

    const tab = findTabLabel(wrapper, '月底储罐液位记录')
    expect(tab).toBeTruthy()
    await tab.trigger('click')
    await flushPromises()

    expect(request.get).toHaveBeenCalledWith('/api/tank-level/list', expect.any(Object))

    const text = wrapper.text()
    // 台账标题与表头逐列对应
    expect(text).toContain('月底车间各储罐液位记录')
    for (const label of [
      '记录日期',
      '属地',
      '所属(产品/原料)',
      '物料',
      '容器名称',
      '容器编号',
      // 数值列表头带单位（表头优化）：单位写进列标签，避免与体积单位混读
      '容器液位 (mm)',
      '理论质量 (kg)',
      '图据',
    ]) {
      expect(text).toContain(label)
    }

    // 接口返回的行已渲染，数值按展示格式（1250.0000 → 1250）
    expect(text).toContain('2026-08-31')
    expect(text).toContain('V150储罐A')
    expect(text).toContain('V150-A')
    expect(text).toContain('HND-V150')
    expect(text).toContain('1250')
    expect(text).toContain('1500')

    // 表尾记录说明与线下台账一致
    expect(text).toContain('实际重量与理论计算可能存在差异，以实际测量为准')
    expect(text).toContain('记录时间为每月月底下午2点')
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
