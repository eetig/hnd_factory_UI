import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { authState } from '../../src/api/auth'

/**
 * 设备数据维护面板（2026-10-18，变更-118）—— 冒烟 + 三条结构性验收。
 *
 * 这一条是"模板跑得起来"的兜底：抽屉自身的 12 条用例测的是抽屉内部，
 * 但**面板把列配置、筛选条、抽屉接起来**这段只有挂载才验得到
 * （历史上模板里少一个 import 就是这样漏的：eslint 不查模板标识符，
 * 单测又不挂载，只有人肉点到那一页才发现白屏）。
 */
const LEDGER_ROWS = [
  {
    id: 1,
    equipmentCode: 'V-150',
    equipmentName: 'HND-V150 合成釜',
    nickname: '',
    workshop: '合成车间',
    spec: 'Φ1200×3000',
    containerType: 1,
    innerDiameter: 1200,
    shellLength: 3000,
    straightFlange: 40,
    topHeadDepth: 300,
    bottomHeadDepth: null,
    volumePerMm: 1.13,
    density: 1.2,
    medium: '三氯氢硅',
    remark: '',
    imageFile: '',
    imageBounds: '',
    enabled: 1,
    enableBlockReason: '',
  },
  {
    id: 2,
    equipmentCode: 'V-151',
    equipmentName: '精馏塔',
    nickname: '',
    workshop: '精馏车间',
    spec: '',
    containerType: 2,
    innerDiameter: 800,
    shellLength: 6000,
    straightFlange: 30,
    topHeadDepth: 200,
    bottomHeadDepth: 200,
    volumePerMm: null,
    density: null,
    medium: 'HND-V150',
    remark: '',
    imageFile: '',
    imageBounds: '',
    enabled: 0,
    enableBlockReason: '不能启用：未配置容器底图',
  },
]

vi.mock('../../src/api/request', () => ({
  default: {
    get: vi.fn(() =>
      Promise.resolve({
        data: { success: true, data: { records: [], total: 0, dataList: [], list: [] } },
      }),
    ),
    post: vi.fn(() => Promise.resolve({ data: { success: true, data: null } })),
    delete: vi.fn(() => Promise.resolve({ data: { success: true } })),
  },
}))

// 数据层整块打桩：这一测的是面板的接线与渲染，不是取数
vi.mock('../../src/composables/useEquipmentLedgerData', async () => {
  const { ref, computed } = await import('vue')
  const rows = ref([])
  return {
    CONTAINER_TYPES: [
      { value: 1, label: '立式圆筒' },
      { value: 2, label: '卧式圆筒' },
      { value: 3, label: '球形' },
    ],
    containerTypeLabel: (v) => ({ 1: '立式圆筒', 2: '卧式圆筒', 3: '球形' })[v] ?? '—',
    uploadVesselDrawing: vi.fn(() => Promise.resolve('/files/x.png')),
    buildPayload: (d) => d,
    saveLedger: vi.fn(() => Promise.resolve()),
    setLedgerEnabled: vi.fn(() => Promise.resolve()),
    useEquipmentLedgerData: () => ({
      rows,
      total: computed(() => rows.value.length),
      loading: ref(false),
      saving: ref(false),
      loadError: ref(''),
      pageNum: ref(1),
      pageSize: ref(10),
      keyword: ref(''),
      onlyEnabled: ref(false),
      loadLedger: vi.fn(async () => {
        rows.value = LEDGER_ROWS
      }),
      loadLedgerPage: vi.fn(),
      applyLedgerFilters: vi.fn(),
      setLedgerPageSize: vi.fn(),
      __rows: rows,
    }),
  }
})

import EquipmentMaintenancePanel from '../../src/components/EquipmentMaintenancePanel.vue'

let wrapper

async function mountPanel() {
  wrapper = mount(EquipmentMaintenancePanel, {
    attachTo: document.body,
    global: {
      plugins: [ElementPlus],
      stubs: { VesselCalibrateDialog: true },
    },
  })
  await flushPromises()
  await new Promise((r) => setTimeout(r, 30))
  return wrapper
}

function headers() {
  return wrapper.findAll('thead th').map((th) => th.text().trim())
}

beforeEach(() => {
  authState.permissions = ['equipment:edit']
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('默认视图', () => {
  it('默认就是 8 列，且没有「操作」列（启停挪进了状态格）', async () => {
    await mountPanel()
    const h = headers()
    expect(h).toHaveLength(8)
    expect(h).toEqual(['序号', '位号', '名称', '车间装置', '容器类型', '规格', '介质', '状态'])
    expect(h, '又出现了「操作」列 —— 启停应该落在状态格里').not.toContain('操作')
  })

  it('表格上限 1100px + table-fixed（1280 视口下不横滚的前提）', async () => {
    await mountPanel()
    const cls = wrapper.find('table').classes().join(' ')
    expect(cls).toContain('max-w-[1100px]')
    expect(cls).toContain('table-fixed')
  })

  it('两行数据都渲染出来了；停用的行带「已停用」和原因入口', async () => {
    await mountPanel()
    expect(wrapper.text()).toContain('HND-V150 合成釜')
    expect(wrapper.text()).toContain('精馏塔')
    expect(wrapper.text()).toContain('已停用')
    expect(wrapper.text()).toContain('为何不能启用')
  })

  it('筛选条与列按钮都在（一行不换行的那几个控件）', async () => {
    await mountPanel()
    expect(wrapper.text()).toContain('停用·本页')
    expect(wrapper.find('[aria-label="列配置：选择这张表显示哪些列"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="搜索设备"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="按容器类型筛选（只过滤当前页）"]').exists()).toBe(true)
  })
})

describe('点行开抽屉', () => {
  it('点第一行 → 抽屉打开，标题是「设备详情」，字段是这一行', async () => {
    await mountPanel()
    await wrapper.findAll('tbody tr')[0].trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 80))
    expect(document.body.textContent).toContain('设备详情')
    expect(document.body.textContent).toContain('V-150')
  })

  it('点「新增设备」→ 抽屉是空白模式（标题「新增设备」）', async () => {
    await mountPanel()
    const add = wrapper.findAll('button').find((b) => b.text().includes('新增设备'))
    expect(add, '找不到「新增设备」按钮').toBeTruthy()
    await add.trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 80))
    expect(document.body.textContent).toContain('新增设备')
  })

  it('无 equipment:edit → 抽屉里没有保存按钮（权限门接在面板上）', async () => {
    authState.permissions = []
    await mountPanel()
    await wrapper.findAll('tbody tr')[0].trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 80))
    const save = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.replace(/\s/g, '') === '保存',
    )
    expect(save, '无权限却出现了保存按钮').toBeFalsy()
  })
})
