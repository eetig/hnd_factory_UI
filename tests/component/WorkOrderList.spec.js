import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElAutocomplete, ElSelect } from 'element-plus'

// API 层打桩：挂载时组件会并发拉工单/领料/入库/货物移动四份数据，测试里不发真实请求
vi.mock('../../src/api/request', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { success: true, dataList: [], data: [] } })),
    post: vi.fn(() => Promise.resolve({ data: { success: true, data: [] } })),
    delete: vi.fn(() => Promise.resolve({ data: { success: true } })),
  },
}))

import request from '../../src/api/request'
import { authState } from '../../src/api/auth'
import { routes } from '../../src/router'
import App from '../../src/App.vue'
import OrderImageDialog from '../../src/components/OrderImageDialog.vue'
import StatsTable from '../../src/components/StatsTable.vue'
import TankLevelPanel from '../../src/components/TankLevelPanel.vue'
import TankLevelImageDialog from '../../src/components/TankLevelImageDialog.vue'

/**
 * 决策-004：台账明细页只给 admin。
 * 这两组标签就是「谁该看见什么」的清单，前端显隐必须与后端角色闸门同口径。
 *
 * ⚠️ 2026-10 路由化改造：原先 6 个 admin 页签里的「工单报工 / 工单核算 / 原辅料核算」
 * 已**合成一页**（`/orders/costing`，页内三个只读视图），所以清单从 6 项变成 4 项 + 采购。
 * 合并的是入口，不是权限：那三张表背后的接口一个都没变，仍然只给 admin。
 */
const ADMIN_ONLY_LABELS = [
  '工单汇总',
  '领料汇总',
  '入库汇总',
  '核算',
  // 变更-096/097：采购需求详情（原「采购进度跟踪」）原先免登录、所有人可见；使用方确认「这页只有管理员能看」，
  // 后端已把 /api/purchase/** 收进 ADMIN_READ_PATTERNS，前端页签同步改成 adminOnly。
  '采购需求详情',
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
 * 遍历侧栏各大类，收集它们各自的页签标签。
 *
 * 侧栏是 N 个大类，横条只显示**当前组**的页 —— 所以「某一页在不在」要逐个大类
 * 点进去看（下面 switchToTab 同理）。点分组会真的走一次路由（换组 = 落到该组
 * 第一个可见页），所以每次点击之后都要等导航落地。
 *
 * 用 [aria-label] 而不是 nav 选择器：横条是 div（不是 nav），只有 aria-label 是稳的。
 */
async function allTabLabels(wrapper) {
  const labels = []
  const groups = wrapper.findAll('nav[aria-label="功能分类"] button')
  for (const group of groups) {
    await group.trigger('click')
    await flushPromises()
    labels.push(...wrapper.findAll('[aria-label="页面切换"] button').map((b) => b.text().trim()))
  }
  return labels
}

/** 当前激活的页（页签上带 aria-current="page"） */
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
 * 挂起整个工作台（壳 + 路由页）。
 *
 * ⚠️ 2026-10 路由化改造后这里挂的**不再是那个单文件页面**：`WorkOrderList.vue` 已拆成
 * 「壳（AppShell）+ 14 个路由页」。挂载入口因此换成 **App.vue**（它只有 `<router-view />`），
 * 页面由路由决定 —— 用 `createMemoryHistory` 建一份和正式路由表同源的测试路由
 * （`routes` 直接从 `src/router/index.js` 导出），再 push 到指定地址。这样测试走的是
 * **真实路由表**，不是手搭的一份影子配置。
 *
 * ⚠️ 不能直接 mount(AppShell)：壳本身就是 `/` 这条路由的 component，
 * 直接挂它会渲染两层（壳里的 `<router-view />` 又把壳建一次）。
 *
 * 拆页之后最怕的还是「模板引用了已经删掉的东西」这类低级错误 —— 构建能过、
 * 一打开页面就白屏。把整屏挂起来跑一遍仍然兜得住。
 */
async function mountPage(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push(path)
  await router.isReady()

  const wrapper = mount(App, {
    global: { plugins: [ElementPlus, router] },
  })
  await flushPromises()
  return wrapper
}

/**
 * 切到某一页：先找到它在哪个大类下（逐个点大类、看它的页签里有没有这一页），再点那张页签。
 *
 * 照用户的操作顺序来，而不是去读 nav 常量（那样测试就成了实现的白盒复述）。
 */
async function switchToTab(wrapper, text) {
  const groups = wrapper.findAll('nav[aria-label="功能分类"] button')
  for (const group of groups) {
    await group.trigger('click')
    await flushPromises()
    const card = wrapper
      .findAll('[aria-label="页面切换"] button')
      .find((b) => b.text().trim() === text)
    if (card) {
      await card.trigger('click')
      await flushPromises()
      return
    }
  }
  throw new Error(`找不到页签：${text}（各个大类里都没有）`)
}

describe('工作台页面冒烟（壳 + 路由页）', () => {
  let wrapper

  beforeEach(async () => {
    wrapper = await mountPage()
  })

  it('侧栏按大类分组，只列出**有可见页**的组；遍历各组，admin 专属的页都不出现', async () => {
    const groupText = wrapper
      .findAll('nav[aria-label="功能分类"] button')
      .map((g) => g.text())
      .join('|')

    // 「工单」组那 4 页全是 admin 专属、「维护」组两页都要权限位、「采购」那页也是 admin：
    // 匿名时这三组整组都不可见 —— 列出来就是点了没反应的死按钮，用户会以为页面卡了
    expect(groupText).not.toContain('工单')
    expect(groupText).not.toContain('采购')
    expect(groupText).not.toContain('维护')
    for (const name of ['物料', '设备', '报表']) {
      expect(groupText).toContain(name)
    }

    // 页签按大类分开了，不能再只看横条 —— 要逐个大类进去看它的页签
    const labels = await allTabLabels(wrapper)
    for (const label of PUBLIC_TAB_LABELS) {
      expect(labels).toContain(label)
    }
    for (const label of ADMIN_ONLY_LABELS) {
      expect(labels).not.toContain(label)
    }
  })

  it('非 admin 首屏落在可见的第一个 Tab 上，不会停在隐藏面板', async () => {
    // `/` 的 redirect 指向「第一个可见页」—— 匿名时「工单汇总」不可见，
    // 停在那里就是一片空白。落地页因此是物料查询。
    expect(activeTabKey(wrapper)).toBe('stock')
    expect(wrapper.find('h2').text()).toBe('物料查询')
  })

  it('admin 登录后那几张台账页才出现', async () => {
    authState.roleKey = 'admin'
    await nextTick()

    const labels = await allTabLabels(wrapper)
    for (const label of ADMIN_ONLY_LABELS) {
      expect(labels).toContain(label)
    }

    // 复位：authState 是模块级单例，不还原会污染同文件里后面的用例
    authState.roleKey = ''
    await nextTick()
  })

  it('三张汇总表都交给 StatsTable 渲染，且列配置与空表文案正确', async () => {
    // 改造前这三张表是三个页签、各自懒挂载；现在是**一页三个只读视图**
    // （`/orders/costing`），所以进这一页就该有三张表 —— 顺序仍是模板顺序
    // （工单报工 → 工单核算 → 原辅料核算），断言与改动前一一对应。
    // 顺带，toHaveLength(3) 还证了一条：三个视图各渲染一次，没有重复建表。
    authState.roleKey = 'admin'
    await nextTick()
    try {
      await switchToTab(wrapper, '核算')

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

      // 三个视图是页内切换（v-show）：只有当前那个可见，另外两个必须藏起来 ——
      // 少一条 v-show，三张表就会上下叠在一起
      expect(tables[0].element.parentElement.style.display).toBe('')
      expect(tables[1].element.parentElement.style.display).toBe('none')
      expect(tables[2].element.parentElement.style.display).toBe('none')
    } finally {
      // authState 是模块级单例：断言失败也必须复位，否则 admin 身份会泄漏给后续用例
      authState.roleKey = ''
      await nextTick()
    }
  })

  it('空数据时渲染的是空表文案而不是空白', async () => {
    authState.roleKey = 'admin'
    await nextTick()
    try {
      await switchToTab(wrapper, '核算')
      expect(wrapper.findComponent(StatsTable).text()).toContain('暂无报工数据')
    } finally {
      authState.roleKey = ''
      await nextTick()
    }
  })

  it('图片弹窗挂在页面里（工单汇总行点击的入口组件）', async () => {
    authState.roleKey = 'admin'
    await nextTick()
    try {
      await switchToTab(wrapper, '工单汇总')
      expect(wrapper.findComponent(OrderImageDialog).exists()).toBe(true)
    } finally {
      authState.roleKey = ''
      await nextTick()
    }
  })

  it('月底储罐液位记录：进入页面走接口，表格按台账列渲染返回行', async () => {
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
    // 进页面不会再打接口。这里点「查询」显式重拉一次，拿到本用例自己那份数据
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
      value: [
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
      ],
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

  it('路由一次只挂一页：进哪一页才建哪一页，切走后从 DOM 里消失（不会叠在一起）', async () => {
    /*
     * 改造前这里是「面板懒挂载」那条用例（变更-076/078）：16 个面板全是 v-show 常驻，
     * 首屏就把 16 个 el-popper、10 个 el-date-editor、15/16 张表全建出来
     * （冷缓存 trace 实测：DOM 2920 个节点里 1379 个属于不可见面板，强制重排 117ms）。
     * 当时的契约是「首次激活才挂载 + 之后一直保留 + 非当前必须隐藏」——
     * 前两条靠 `mountedTabs` 的 v-if、第三条靠 v-show。
     *
     * 路由化之后这三件事都由 `<router-view />` 天然承担，`v-if` / `v-show` 那对写法
     * 已经不需要存在（`mountedTabs` 整个删掉了）。这条因此改钉**新机制**的同一组事实：
     *   ① 没进过的页面不在 DOM 里 —— 这正是首屏省下来的成本；
     *   ② 进去之后在；
     *   ③ 切走之后**整个页面从 DOM 里消失**（不是藏起来）—— 页面再也不会互相叠加，
     *      也不会有 1379 个不可见节点留在树上；
     *   ④ 同一时刻只有一份页面实例（不存在「上一页还挂着」）。
     */
    authState.roleKey = 'admin'
    await nextTick()
    try {
      expect(wrapper.findAllComponents(StatsTable)).toHaveLength(0)

      await switchToTab(wrapper, '核算')
      const active = wrapper.findAllComponents(StatsTable)
      expect(active, '进入后三张汇总表应当都在').toHaveLength(3)

      await switchToTab(wrapper, '物料查询')
      // 物料查询页本身不是 StatsTable：核算页已经卸载，所以是 0
      // （改造前这里是 3 → 1 并断言 display:none；现在是 3 → 0，说明页面连节点都不再保留）
      expect(
        wrapper.findAllComponents(StatsTable),
        '切走后核算页应当整个卸载（漏了这一步就会与当前页叠在一起）',
      ).toHaveLength(0)
      expect(wrapper.text()).toContain('只看有库存')
    } finally {
      authState.roleKey = ''
      await nextTick()
    }
  })

  it('周统计面板按默认区间（上周一到上周日）生成标题', async () => {
    await switchToTab(wrapper, '周统计')
    expect(wrapper.text()).toMatch(/\d+月\d+日-\d+月\d+日周统计（截止\d+月\d+日晚8点）/)
  })

  it('周统计：进页面调公开汇总接口取数（明细接口只给 admin，这条给所有人）', async () => {
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

  it('面包屑写出「组名 › 页面名」，跟着路由走', async () => {
    const crumb = wrapper.find('nav[aria-label="面包屑"]')
    expect(crumb.exists()).toBe(true)
    expect(crumb.text()).toContain('物料')
    expect(crumb.text()).toContain('物料查询')

    // 切页之后两段都换：路由是唯一真源，不靠额外的同步逻辑
    await switchToTab(wrapper, '周统计')
    const after = wrapper.find('nav[aria-label="面包屑"]')
    expect(after.text()).toContain('报表')
    expect(after.text()).toContain('周统计')
  })
})

/**
 * 14 条路由逐个渲染。
 *
 * 这是拆页这一轮**最需要**的一条护栏：4115 行的单文件被切成 14 个页面之后，
 * 每一页都是一个只在自己被访问时才执行的模板 —— 少搬一个变量、少 import 一个组件，
 * `eslint` 与 `vite build` 都发现不了（模板里的标识符在编译期只是字符串），
 * 表现是「点进去白屏 / 半屏错乱」，而只有真点进去才会看见。
 *
 * 判定方式是**听 Vue 的告警**：模板引用了不存在的属性时，Vue 会在渲染期
 * `console.warn('[Vue warn]: Property "xxx" was accessed during render but is not defined')`。
 * 所以这里给每条路由挂一次、断言「没有 Vue 告警」，再核对标题 / 面包屑 / 当前页签
 * 三处高亮是否都指向这一页。
 */
describe('14 条路由逐个渲染（拆页后的白屏护栏）', () => {
  const CASES = [
    { path: '/orders', title: '工单汇总', group: '工单', key: 'workOrder', role: 'admin' },
    { path: '/orders/picking', title: '领料汇总', group: '工单', key: 'material', role: 'admin' },
    { path: '/orders/inbound', title: '入库汇总', group: '工单', key: 'inbound', role: 'admin' },
    { path: '/orders/costing', title: '核算', group: '工单', key: 'costing', role: 'admin' },
    { path: '/materials', title: '物料查询', group: '物料', key: 'stock' },
    { path: '/purchase', title: '采购需求详情', group: '采购', key: 'purchase', role: 'admin' },
    {
      path: '/equipment',
      title: '设备数据维护',
      group: '设备',
      key: 'equipment',
      permissions: ['equipment:edit'],
    },
    { path: '/equipment/vessel', title: '压力容器体积计算', group: '设备', key: 'vessel' },
    { path: '/equipment/electricity', title: '电费预提', group: '设备', key: 'electricity' },
    { path: '/stats/weekly', title: '周统计', group: '报表', key: 'weekly' },
    { path: '/stats/daily', title: '日报表记录', group: '报表', key: 'daily' },
    { path: '/stats/tank-level', title: '月底储罐液位记录', group: '报表', key: 'tankLevel' },
    {
      path: '/maintain/import',
      title: '文件导入',
      group: '维护',
      key: 'import',
      permissions: ['work_order:import'],
    },
    {
      path: '/maintain/image-parse',
      title: '图片解析',
      group: '维护',
      key: 'imageParse',
      permissions: ['work_order:import'],
    },
  ]

  afterEach(() => {
    // 每一轮都可能改身份，复位是必须的（authState 是模块级单例）
    authState.roleKey = ''
    authState.permissions = []
  })

  for (const { path, title, group, key, role, permissions } of CASES) {
    it(`${path} → ${title}`, async () => {
      authState.roleKey = role ?? ''
      authState.permissions = permissions ?? []
      await nextTick()

      const warnings = []
      const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        warnings.push(args.map((a) => String(a)).join(' '))
      })
      let wrapper
      try {
        wrapper = await mountPage(path)
        await flushPromises()

        // 主区标题
        expect(wrapper.find('h2').text()).toBe(title)
        // 面包屑两段
        const crumb = wrapper.find('nav[aria-label="面包屑"]').text()
        expect(crumb).toContain(group)
        expect(crumb).toContain(title)
        // 侧栏高亮的组 + 页签上高亮的页，都指向这一页
        expect(activeTabKey(wrapper)).toBe(key)
        // 主区里真的渲染出了这一页（不是一张空壳）
        expect(
          wrapper.find('.flex-1.min-h-0.overflow-y-auto').element.textContent.trim().length,
          '这一页渲染成了空白 —— 模板里多半引用了不存在的变量/组件',
        ).toBeGreaterThan(0)
      } finally {
        warn.mockRestore()
        wrapper?.unmount()
      }

      expect(
        warnings.filter((line) => line.includes('[Vue warn]')),
        `${title} 渲染时 Vue 报了告警 —— 拆页时模板里的某个标识符没跟着搬过来`,
      ).toEqual([])
    })
  }
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

  beforeEach(async () => {
    window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY)
    wrapper = await mountPage()
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

    // 图标条**只列有可见页的组**：匿名时「工单」「采购」「维护」整组不可见，
    // 列出来就是点了没反应的死按钮。
    // 收起后按钮没有可见文字，可访问名就是组名 —— 缺了它读屏只剩一个无名图标
    expect(groups.map((b) => b.attributes('aria-label'))).toEqual(['物料', '设备', '报表'])

    // 匿名态当前在「物料」组（第一个可见项是物料查询），所以点「报表」才测得出「切」
    expect(activeTabKey(wrapper)).toBe('stock')
    const stats = groups.find((b) => b.attributes('aria-label') === '报表')
    await stats.trigger('click')
    await flushPromises()

    // 落到该组第一个可见页；侧栏高亮与主区页签都由路由推导，天然同步
    expect(activeTabKey(wrapper)).toBe('weekly')

    // 收起态**没有**「块底」—— 那层 bg-brand 胶囊 + 白描边环只在展开态有（40px 里套环会糊）。
    // 当前组的标记落在图标块上：白色透块（bg-white/15）+ 白图标。
    // 顺带确认选中的确**转移**了，而不是两块一起亮
    const tools = groups.find((b) => b.attributes('aria-label') === '物料')
    expect(stats.find('span').classes()).toContain('bg-white/15')
    expect(tools.find('span').classes()).not.toContain('bg-white/15')
  })

  it('展开态只有当前组带胶囊（使用方 2026-10-07 提的选中标记）', () => {
    // 选中标记是这轮的需求本身，所以要有护栏：几块一样亮就分不出当前在哪一组了。
    // 匿名态在「物料」组（第一个可见项是物料查询）
    const groups = wrapper.findAll('nav[aria-label="功能分类"] button')
    const marked = groups.filter((b) => b.classes().includes('ring-white/20'))

    expect(marked).toHaveLength(1)
    expect(marked[0].text()).toContain('物料')
    expect(marked[0].classes()).toContain('bg-brand')
  })

  it('收起状态写进 localStorage，重新挂载（≈刷新）还是收起的', async () => {
    // 收起的动机是「把 224px 让回给表格」，刷新一次就自己弹回去，等于每次打开都要重收
    await toggle().trigger('click')
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1')

    const reopened = await mountPage()
    expect(reopened.find('aside').classes()).toContain('w-[88px]')
    reopened.unmount()

    await toggle().trigger('click')
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('0')
  })
})
