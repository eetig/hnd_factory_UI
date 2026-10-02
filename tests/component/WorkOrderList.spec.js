import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElAutocomplete, ElSelect } from 'element-plus'

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
import { authState } from '../../src/api/auth'
import WorkOrderList from '../../src/views/WorkOrderList.vue'
import OrderImageDialog from '../../src/components/OrderImageDialog.vue'
import StatsTable from '../../src/components/StatsTable.vue'
import TankLevelPanel from '../../src/components/TankLevelPanel.vue'
import TankLevelImageDialog from '../../src/components/TankLevelImageDialog.vue'

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
 * 变更-011 起图据是数组（一条记录可多张）。
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
  images: [],
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
    // 「所属(产品/原料)」「物料」「容器编号」三列已从界面撤掉（字段仍在数据层，
    // 编辑老记录不会被清空），所以这里不再断言这三个表头，改为断言它们确实不出现
    for (const label of [
      '记录日期',
      '属地',
      '容器名称',
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
    expect(text).toContain('1250')
    expect(text).toContain('1500')

    // 撤掉的三列在页面上一个值都不该露出来（容器编号 / 物料）
    expect(text).not.toContain('V150-A')
    expect(text).not.toContain('HND-V150')

    // 表尾记录说明与线下台账一致
    expect(text).toContain('实际重量与理论计算可能存在差异，以实际测量为准')
    expect(text).toContain('记录时间为每月月底下午3点')
  })

  it('月底储罐液位记录：默认（未登录只读）无编辑入口，数据照常可见', async () => {
    request.get.mockImplementation((url) =>
      Promise.resolve({
        data:
          url === '/api/tank-level/list'
            ? { success: true, dataList: [TANK_LEVEL_ROW], data: [] }
            : { success: true, dataList: [], data: [] },
      }),
    )

    const tab = findTabLabel(wrapper, '月底储罐液位记录')
    await tab.trigger('click')
    await flushPromises()

    const panel = wrapper.findComponent(TankLevelPanel)
    expect(panel.exists()).toBe(true)
    // 决策-002：未登录默认只读浏览 —— 数据看得见，写入口一律不渲染
    expect(panel.text()).toContain('V150储罐A')
    expect(panel.text()).not.toContain('新增一行')
    expect(panel.text()).not.toContain('操作')
  })

  it('月底储罐液位记录：拿到 tank_level:* 权限后才出现增删改入口', async () => {
    request.get.mockImplementation((url) =>
      Promise.resolve({
        data:
          url === '/api/tank-level/list'
            ? { success: true, dataList: [TANK_LEVEL_ROW], data: [] }
            : { success: true, dataList: [], data: [] },
      }),
    )

    const tab = findTabLabel(wrapper, '月底储罐液位记录')
    await tab.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(TankLevelPanel).text()).not.toContain('新增一行')

    // 模拟登录后后端下发的权限集合（hasPerm 读的就是这份 reactive 镜像）
    authState.permissions = ['tank_level:edit', 'tank_level:delete']
    await nextTick()

    const text = wrapper.findComponent(TankLevelPanel).text()
    expect(text).toContain('新增一行')
    expect(text).toContain('操作')
    expect(text).toContain('编辑')
    expect(text).toContain('删除')

    // 复位：authState 是模块级单例，不还原会污染同文件里后面的用例
    authState.permissions = []
  })

  it('月底储罐液位记录：图据多张时列上显示首张缩略图与数量角标', async () => {
    const withImages = {
      ...TANK_LEVEL_ROW,
      images: [
        { imageId: 11, url: '/files/a.png', thumbnailUrl: '/thumbs/a.png' },
        { imageId: 12, url: '/files/b.png', thumbnailUrl: '/thumbs/b.png' },
      ],
    }
    request.get.mockImplementation((url) =>
      Promise.resolve({
        data:
          url === '/api/tank-level/list'
            ? { success: true, dataList: [withImages], data: [] }
            : { success: true, dataList: [], data: [] },
      }),
    )

    const tab = findTabLabel(wrapper, '月底储罐液位记录')
    await tab.trigger('click')
    await flushPromises()

    // tankLevelLoaded 是模块级单例、跨用例共享：本文件靠前的用例已经加载过，
    // 切 Tab 不会再打接口。这里点「查询」显式重拉一次，拿到本用例自己那份数据
    const searchButton = wrapper.findAll('button').find((node) => node.text().trim() === '查询')
    expect(searchButton).toBeTruthy()
    await searchButton.trigger('click')
    await flushPromises()

    const panel = wrapper.findComponent(TankLevelPanel)
    // 看图/加图/删图都在弹窗里（变更-011），所以它必须挂在面板上
    expect(panel.findComponent(TankLevelImageDialog).exists()).toBe(true)

    const thumb = panel.find('img[alt="图据缩略图"]')
    expect(thumb.exists()).toBe(true)
    // 画的是缩略图而不是原图
    expect(thumb.attributes('src')).toBe('/thumbs/a.png')

    // 角标写的是总张数（用 aria-label 断言，比在整页文本里找数字可靠）
    expect(panel.html()).toContain('查看图据（共 2 张）')
  })

  it('月底储罐液位记录：库里一条都没有时，「新增一行」入口仍然在', async () => {
    // 空列表：这正是「新库/清空后第一次使用」的样子
    request.get.mockImplementation(() =>
      Promise.resolve({ data: { success: true, dataList: [], data: [] } }),
    )
    authState.permissions = ['tank_level:edit', 'tank_level:delete']
    await nextTick()

    const tab = findTabLabel(wrapper, '月底储罐液位记录')
    await tab.trigger('click')
    await flushPromises()
    // tankLevelLoaded 是模块级单例，前面的用例已经加载过，这里显式重拉
    const searchButton = wrapper.findAll('button').find((node) => node.text().trim() === '查询')
    await searchButton.trigger('click')
    await flushPromises()

    const panel = wrapper.findComponent(TankLevelPanel)
    expect(panel.text()).toContain('暂无储罐液位记录')

    // 空态提示写的是「点下方『新增一行』开始录入」—— 那句话下面就必须真有这个按钮。
    // 早先按钮和表格绑在同一个分支里，空表时两个都不渲染，提示就成了空指
    const addButton = panel.findAll('button').find((node) => node.text().trim() === '新增一行')
    expect(addButton).toBeTruthy()

    // 点它能真的开出草稿行
    await addButton.trigger('click')
    await nextTick()
    // 草稿行的图据格子是「选择图片」：选好的图随保存一起提交，
    // 不再要求「先保存数据、再回来传图」两步
    expect(panel.text()).toContain('选择图片')

    authState.permissions = []
  })

  it('月底储罐液位记录：新增行可以先选好图，保存时数据与图据一次提交', async () => {
    request.get.mockImplementation(() =>
      Promise.resolve({ data: { success: true, dataList: [], data: [] } }),
    )
    request.post.mockImplementation((url) => {
      if (url === '/api/tank-level/save') {
        return Promise.resolve({ data: { success: true, data: { id: 77 } } })
      }
      if (url === '/api/tank-level/image/upload') {
        return Promise.resolve({
          data: { success: true, data: [{ imageId: 1, url: '/files/a.png' }] },
        })
      }
      return Promise.resolve({ data: { success: true, data: [] } })
    })

    authState.permissions = ['tank_level:edit', 'tank_level:delete']
    await nextTick()

    const tab = findTabLabel(wrapper, '月底储罐液位记录')
    await tab.trigger('click')
    await flushPromises()

    const panel = wrapper.findComponent(TankLevelPanel)

    // editingId 是组件内状态、跨用例不重置：上一个用例点开的那条草稿行还在，先收掉
    const leftoverCancel = panel.findAll('button').find((node) => node.text().trim() === '取消')
    if (leftoverCancel) {
      await leftoverCancel.trigger('click')
      await nextTick()
    }

    const addButton = panel.findAll('button').find((node) => node.text().trim() === '新增一行')
    await addButton.trigger('click')
    await nextTick()

    // 此刻面板里只该有一个 file input（图据弹窗没打开，它里头那个还没渲染）
    const fileInputs = panel.findAll('input[type="file"]')
    expect(fileInputs).toHaveLength(1)

    // 记录还没保存，先把两张图选好
    Object.defineProperty(fileInputs[0].element, 'files', {
      value: [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })],
      configurable: true,
    })
    await fileInputs[0].trigger('change')
    expect(panel.text()).toContain('再加一张')

    const saveButton = panel.findAll('button').find((node) => node.text().trim() === '保存')
    await saveButton.trigger('click')
    await flushPromises()

    // 顺序是关键：先存数据拿到 id，再拿这个 id 传图 —— 图据接口挂在 record id 上
    expect(request.post.mock.calls.map((call) => call[0])).toEqual([
      '/api/tank-level/save',
      '/api/tank-level/image/upload',
    ])

    const uploadForm = request.post.mock.calls[1][1]
    expect(uploadForm.get('recordId')).toBe('77')
    expect(uploadForm.getAll('files')).toHaveLength(2)

    authState.permissions = []
  })

  it('月底储罐液位记录：新增行的属地与容器名称给的是下拉/可搜候选，不是裸文本框', async () => {
    request.get.mockImplementation(() =>
      Promise.resolve({ data: { success: true, dataList: [], data: [] } }),
    )

    authState.permissions = ['tank_level:edit']
    await nextTick()

    const tab = findTabLabel(wrapper, '月底储罐液位记录')
    await tab.trigger('click')
    await flushPromises()

    const panel = wrapper.findComponent(TankLevelPanel)

    // editingId 是组件内状态、跨用例不重置：先收掉前面用例留下的草稿行，计数才有意义
    const leftoverCancel = panel.findAll('button').find((node) => node.text().trim() === '取消')
    if (leftoverCancel) {
      await leftoverCancel.trigger('click')
      await nextTick()
    }

    // 查询区本来就有两个下拉（属地 / 所属），草稿行要再加一个属地下拉
    const selectsBefore = panel.findAllComponents(ElSelect).length
    const addButton = panel.findAll('button').find((node) => node.text().trim() === '新增一行')
    await addButton.trigger('click')
    await nextTick()

    expect(panel.findAllComponents(ElSelect).length).toBe(selectsBefore + 1)
    // 容器名称是「可自由输入 + 远程候选」：台账里没有的设备也录得进去，
    // 用死的 select 会把「台账没有」变成「填不进去」
    expect(panel.findAllComponents(ElAutocomplete)).toHaveLength(1)

    authState.permissions = []
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

  it('Tab 条：装不下时横向滚动，滚轮可左右滑动，滚到头放行给页面', () => {
    const nav = wrapper.find('nav[aria-label="页面切换"]')
    expect(nav.exists()).toBe(true)
    // 按钮不许折行（这就是「工单汇总」被压成两行的原因），装不下靠滚动解决
    expect(nav.classes()).toContain('overflow-x-auto')
    expect(nav.find('button').classes()).toContain('shrink-0')
    expect(nav.find('button').classes()).toContain('whitespace-nowrap')

    // jsdom 里 scrollWidth/clientWidth 恒为 0，手工造出「装不下」的几何
    const el = nav.element
    Object.defineProperty(el, 'scrollWidth', { value: 1200, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true })

    // 滚到中间：拦截滚轮，把它转成左右滚动
    el.scrollLeft = 200
    const inner = new WheelEvent('wheel', { deltaY: 100, cancelable: true })
    el.dispatchEvent(inner)
    expect(el.scrollLeft).toBe(300)
    expect(inner.defaultPrevented).toBe(true)

    // 已经滚到最右：不拦截，页面还能继续往下滚（否则指针停在 Tab 条上整页都动不了）
    el.scrollLeft = 800
    const atEnd = new WheelEvent('wheel', { deltaY: 100, cancelable: true })
    el.dispatchEvent(atEnd)
    expect(atEnd.defaultPrevented).toBe(false)
  })

  it('Tab 条：本来就装得下时不拦截滚轮', () => {
    const el = wrapper.find('nav[aria-label="页面切换"]').element
    Object.defineProperty(el, 'scrollWidth', { value: 300, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true })

    const event = new WheelEvent('wheel', { deltaY: 100, cancelable: true })
    el.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})
