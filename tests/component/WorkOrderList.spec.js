import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

/**
 * 决策-004：6 张台账明细页只给 admin。
 * 这两组标签就是「谁该看见什么」的清单，前端显隐必须与后端角色闸门同口径。
 */
const ADMIN_ONLY_TAB_LABELS = [
  '工单汇总',
  '领料汇总',
  '入库汇总',
  '工单报工',
  '工单核算',
  '原辅料核算',
]

// 非 admin 也能看见的：台账之外的查询/计算页（不含需要权限位的「文件导入」「图片解析」）
const PUBLIC_TAB_LABELS = [
  '物料查询',
  '周统计',
  '日报表记录',
  '月底储罐液位记录',
  '压力容器体积计算',
  '电费预提',
]

/**
 * 遍历四个大类，收集它们各自的页签标签。
 *
 * ⚠️ 2026-10-07 起页签不再是一条平铺的横条：侧栏是四个大类，横条只显示**当前组**的页。
 * 所以要断言「某一页在不在」得逐个大类点进去看（下面 switchToTab 同理）。
 *
 * 用 [aria-label] 而不是 nav 选择器：横条现在是 div（不是 nav），只有 aria-label 是稳的。
 */
async function allTabLabels(wrapper) {
  const labels = []
  const groups = wrapper.findAll('nav[aria-label="功能分类"] button')
  for (const group of groups) {
    await group.trigger('click')
    labels.push(...wrapper.findAll('[aria-label="页面切换"] button').map((b) => b.text().trim()))
  }
  return labels
}

/** 当前激活的页（卡片上带 aria-current="page"） */
function activeTabKey(wrapper) {
  const active = wrapper.find('[aria-label="页面切换"] button[aria-current="page"]')
  return active.exists() ? active.attributes('data-tab-key') : null
}

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
 * 冒烟测试：WorkOrderList.vue 是大页面（14 个 Tab，其中 6 个只给 admin），
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

/**
 * 切到某一页：先找到它在哪个大类下（逐个点大类、看它的卡片里有没有这一页），再点那张卡片。
 *
 * ⚠️ 2026-10-07 起不能直接点一个不在当前组里的页签 —— 横条只显示当前组的页。
 * 这里照用户的操作顺序来，而不是去读组件内部的 tabs 常量（那样测试就成了实现的白盒复述）。
 */
async function switchToTab(wrapper, text) {
  const groups = wrapper.findAll('nav[aria-label="功能分类"] button')
  for (const group of groups) {
    await group.trigger('click')
    const card = wrapper
      .findAll('[aria-label="页面切换"] button')
      .find((b) => b.text().trim() === text)
    if (card) {
      await card.trigger('click')
      return
    }
  }
  throw new Error(`找不到页签：${text}（四个大类里都没有）`)
}

describe('WorkOrderList 页面冒烟', () => {
  let wrapper

  beforeEach(() => {
    wrapper = mountPage()
  })

  it('侧栏按大类分组，只列出**有可见页**的组；遍历各组，admin 专属的 6 页都不出现', async () => {
    const groupText = wrapper
      .findAll('nav[aria-label="功能分类"] button')
      .map((g) => g.text())
      .join('|')

    // 「工单报工」那 6 页全是 adminOnly、「数据维护」三页都要权限位：
    // 匿名时这两组整组都不可见 —— 列出来就是点了没反应的死按钮，用户会以为页面卡了
    expect(groupText).not.toContain('工单报工')
    expect(groupText).not.toContain('数据维护')
    for (const name of ['数据统计', '工具']) {
      expect(groupText).toContain(name)
    }

    // 页签按大类分开了，不能再只看横条 —— 要逐个大类进去看它的页签
    const labels = await allTabLabels(wrapper)
    for (const label of PUBLIC_TAB_LABELS) {
      expect(labels).toContain(label)
    }
    for (const label of ADMIN_ONLY_TAB_LABELS) {
      expect(labels).not.toContain(label)
    }
  })

  it('非 admin 首屏落在可见的第一个 Tab 上，不会停在隐藏面板', () => {
    // 默认 Tab 是「工单汇总」，非 admin 看不见它 —— 停在上面会是一片空白。
    // 现在用 aria-current 取激活项（横条从下划线改成了卡片态，类名不再是稳定的断言点）
    expect(activeTabKey(wrapper)).toBe('stock')
  })

  it('admin 登录后 6 张台账 Tab 才出现', async () => {
    authState.roleKey = 'admin'
    await nextTick()

    const labels = await allTabLabels(wrapper)
    for (const label of ADMIN_ONLY_TAB_LABELS) {
      expect(labels).toContain(label)
    }

    // 复位：authState 是模块级单例，不还原会污染同文件里后面的用例
    authState.roleKey = ''
    await nextTick()
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

    await switchToTab(wrapper, '月底储罐液位记录')
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

    await switchToTab(wrapper, '月底储罐液位记录')
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

    await switchToTab(wrapper, '月底储罐液位记录')
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

    await switchToTab(wrapper, '月底储罐液位记录')
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

    await switchToTab(wrapper, '月底储罐液位记录')
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

    await switchToTab(wrapper, '月底储罐液位记录')
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

    await switchToTab(wrapper, '月底储罐液位记录')
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
    // 「工单报工」是 admin 专属（决策-004），先切到 admin 身份，Tab 才在条上
    authState.roleKey = 'admin'
    await nextTick()

    const reportPanel = wrapper.findAllComponents(StatsTable)[0].element.parentElement
    expect(reportPanel.style.display).toBe('none')

    await switchToTab(wrapper, '工单报工')

    expect(reportPanel.style.display).toBe('')

    authState.roleKey = ''
    await nextTick()
  })

  it('周统计面板按默认区间（上周一到上周日）生成标题', () => {
    expect(wrapper.text()).toMatch(/\d+月\d+日-\d+月\d+日周统计（截止\d+月\d+日晚8点）/)
  })

  it('周统计：进 Tab 调公开汇总接口取数（明细接口只给 admin，这条给所有人）', async () => {
    request.get.mockImplementation(() =>
      Promise.resolve({
        data: {
          success: true,
          data: {
            pickQty: { 111001787: 12.5, 111001786: 300, 112004292: 1 },
            inboundQty: { 114001897: 1000 },
          },
        },
      }),
    )

    await switchToTab(wrapper, '周统计')
    await flushPromises()

    // 物料编码由前端传，后端不硬编码业务常量
    const call = request.get.mock.calls.find(([url]) => url === '/api/stats/weekly')
    expect(call).toBeTruthy()
    expect(call[1].params.pickMaterials).toBe('111001787,111001786,112004292')
    expect(call[1].params.inboundMaterials).toBe('114001897')
    expect(call[1].params.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const table = wrapper.findAll('table').find((node) => node.text().includes('150产品入库数'))
    expect(table).toBeTruthy()
    // 接口回的数已经进了表：领用 = 接口值 × 换算系数（氯铂酸 1 × 20）
    expect(table.text()).toContain('12.5')
    expect(table.text()).toContain('1000')
    expect(table.text()).toContain('20')
  })

  it('周统计：接口失败时报错，而不是把表默默显示成全 0', async () => {
    request.get.mockImplementation((url) =>
      url === '/api/stats/weekly'
        ? Promise.resolve({ data: { success: false, msg: '统计失败' } })
        : Promise.resolve({ data: { success: true, dataList: [], data: [] } }),
    )

    await switchToTab(wrapper, '周统计')
    await flushPromises()

    expect(wrapper.text()).toContain('暂时无法获取周统计数据')
    expect(wrapper.text()).toContain('统计失败')
  })

  it('页签卡片行：装不下时横向滚动，滚轮可左右滑动，滚到头放行给页面', () => {
    const nav = wrapper.find('[aria-label="页面切换"]')
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

    // 已经滚到最右：不拦截，页面还能继续往下滚（否则指针停在卡片行上整页都动不了）
    el.scrollLeft = 800
    const atEnd = new WheelEvent('wheel', { deltaY: 100, cancelable: true })
    el.dispatchEvent(atEnd)
    expect(atEnd.defaultPrevented).toBe(false)
  })

  it('页签卡片行：本来就装得下时不拦截滚轮', () => {
    const el = wrapper.find('[aria-label="页面切换"]').element
    Object.defineProperty(el, 'scrollWidth', { value: 300, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true })

    const event = new WheelEvent('wheel', { deltaY: 100, cancelable: true })
    el.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})

/**
 * 侧栏收起 / 展开（使用方 2026-10-07）。
 *
 * 单开一个 describe，不塞进上面那个冒烟块：收起状态会写进 localStorage，
 * 而 jsdom 的 localStorage 是按**文件**共享的 —— 沾上就会让之后挂载的页面
 * 一开始就是收起态（一个测试污染一整份文件，且症状是别处的断言莫名其妙地红）。
 * 这里进出一律清掉。
 */
describe('侧栏收起 / 展开', () => {
  let wrapper

  const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed'
  const toggle = () => wrapper.find('button[aria-controls="app-sidebar"]')

  beforeEach(() => {
    window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY)
    wrapper = mountPage()
  })

  afterEach(() => {
    window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY)
  })

  it('点收起：aside 收窄、品牌区让位（不是被盖住），再点一次复原', async () => {
    const aside = wrapper.find('aside')
    // 展开态宽度 2026-10-07 由 w-56(224px) 加到 w-72(288px)：
    // 分组块加了 36px 图标后，224px 放不下最长的那条分组提示，四条提示折行不一致。
    expect(aside.classes()).toContain('w-72')
    expect(toggle().attributes('aria-expanded')).toBe('true')
    expect(toggle().attributes('aria-label')).toBe('收起侧栏')

    await toggle().trigger('click')

    // 收窄 = 把宽度让给主区。主区是 flex-1，自己会把那 200px 拿回去
    expect(aside.classes()).toContain('w-[88px]')
    expect(aside.classes()).not.toContain('w-72')
    expect(toggle().attributes('aria-expanded')).toBe('false')
    expect(toggle().attributes('aria-label')).toBe('展开侧栏')

    // 品牌区是**让位**（display:none），不是被浮层压住 —— 使用方选的就是「内容让位、不重叠」。
    // 三条都要断：收起态只剩图标，任何一条没让位都会在 40px 里挤成一团
    const brand = ['Factory Operations', 'HND生产助手', '生产工单与物料数据查询助手'].map((text) =>
      wrapper.findAll('p').find((p) => p.text() === text),
    )
    expect(brand.map((p) => p.element.style.display)).toEqual(['none', 'none', 'none'])

    await toggle().trigger('click')
    expect(aside.classes()).toContain('w-72')
    expect(brand.map((p) => p.element.style.display)).toEqual(['', '', ''])
  })

  it('收起态点分组图标照样切组（不能只剩开关、把导航丢了）', async () => {
    await toggle().trigger('click')

    const groups = wrapper.findAll('nav[aria-label="功能分类"] button')

    // 图标条**只列有可见页的组**：匿名时「工单报工」「数据维护」整组不可见，
    // 列出来就是点了没反应的死按钮。
    // 收起后按钮没有可见文字，可访问名就是组名 —— 缺了它读屏只剩一个无名图标
    expect(groups.map((b) => b.attributes('aria-label'))).toEqual(['数据统计', '工具'])

    // 匿名态当前在「工具」组（visibleTabs[0] 是物料查询），所以点「数据统计」才测得出「切」
    expect(activeTabKey(wrapper)).toBe('stock')
    const stats = groups.find((b) => b.attributes('aria-label') === '数据统计')
    await stats.trigger('click')

    // 落到该组第一个可见页；侧栏高亮与主区页签都由 activeTab 推导，天然同步
    expect(activeTabKey(wrapper)).toBe('weekly')

    // 收起态**没有**「块底」—— 那层 emerald-50 + 光晕只在展开态有（40px 里套环会糊）。
    // 当前组的标记落在图标块上：实心 emerald-700 + 白图标。
    // 顺带确认选中的确**转移**了，而不是两块一起亮
    const tools = groups.find((b) => b.attributes('aria-label') === '工具')
    expect(stats.find('span').classes()).toContain('bg-emerald-700')
    expect(tools.find('span').classes()).not.toContain('bg-emerald-700')
  })

  it('展开态只有当前组带绿光晕（使用方 2026-10-07 提的「绿色光晕」）', () => {
    // 光晕是这轮的需求本身，所以要有护栏：四块一样亮就分不出当前在哪一组了。
    // 匿名态在「工具」组（visibleTabs[0] 是物料查询）
    const groups = wrapper.findAll('nav[aria-label="功能分类"] button')
    const glowing = groups.filter((b) => b.classes().includes('shadow-glow'))

    expect(glowing).toHaveLength(1)
    expect(glowing[0].text()).toContain('工具')
    expect(glowing[0].classes()).toContain('bg-emerald-50')
  })

  it('收起状态写进 localStorage，重新挂载（≈刷新）还是收起的', async () => {
    // 收起的动机是「把 224px 让回给表格」，刷新一次就自己弹回去，等于每次打开都要重收
    await toggle().trigger('click')
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1')

    const reopened = mountPage()
    expect(reopened.find('aside').classes()).toContain('w-[88px]')
    reopened.unmount()

    await toggle().trigger('click')
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('0')
  })
})
