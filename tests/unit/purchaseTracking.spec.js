import { describe, it, expect, vi, beforeEach } from 'vitest'

// 数据层直接调 request，本测试只关心「发出去的东西对不对」，所以整个模块替身掉
vi.mock('../../src/api/request', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const { default: request } = await import('../../src/api/request')
const { buildPurchasePayload, usePurchaseTracking } = await import(
  '../../src/composables/usePurchaseTracking'
)
const { useMaterialLookup } = await import('../../src/composables/useMaterialLookup')

const { materialOptions, searchMaterials } = useMaterialLookup()

const {
  rows,
  total,
  keyword,
  rangeStart,
  rangeEnd,
  loadError,
  loadPurchase,
  savePurchase,
  deletePurchase,
} = usePurchaseTracking()

/**
 * 采购进度跟踪数据层单测（变更-091）。
 *
 * 这里守的是**跨端契约**：字段名与参数名必须与后端
 * `PurchaseTrackingSaveDTO` / `PurchaseTrackingQueryDTO` 一字不差 ——
 * 名字错了不会报错，只会静默把某个字段存成空（最难发现的那类）。
 * 另有两条行为约定：查询失败**不清空已有数据**；成功响应才写 rows/total。
 */
describe('采购进度跟踪数据层', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rows.value = []
    total.value = 0
    keyword.value = ''
    rangeStart.value = ''
    rangeEnd.value = ''
    loadError.value = ''
  })

  it('buildPurchasePayload：字段名与后端 DTO 一一对应（多一个少一个都算错）', () => {
    const payload = buildPurchasePayload({
      id: 7,
      requester: ' 张三 ',
      requestDate: '2026-10-16',
      materialName: ' 硅粉 ',
      materialCode: ' 111001785 ',
      spec: '500kg/袋',
      requiredArrivalDate: '2026-11-01',
      purchaseOrderNo: 'PO-2026-001',
      deliveryNote: 'DN-9',
      remark: '急',
    })

    expect(Object.keys(payload).sort()).toEqual(
      [
        'id',
        'requester',
        'requestDate',
        'materialName',
        'materialCode',
        'spec',
        'requiredArrivalDate',
        'purchaseOrderNo',
        'deliveryNote',
        'remark',
      ].sort(),
    )
    // 需求人与物料名称是必填：原样（去空白）传给后端，由后端给业务文案
    expect(payload.requester).toBe('张三')
    expect(payload.materialName).toBe('硅粉')
    // 日期保持 yyyy-MM-dd 字符串：后端是 LocalDate，Jackson 按 ISO 解析
    expect(payload.requestDate).toBe('2026-10-16')
    expect(payload.requiredArrivalDate).toBe('2026-11-01')
    expect(payload.materialCode).toBe('111001785')
    expect(payload.id).toBe(7)
  })

  it('buildPurchasePayload：空值一律 null（可空列交给后端写 NULL），不是空串', () => {
    const payload = buildPurchasePayload({ requester: '李四', materialName: '泵' })
    expect(payload.id).toBeNull()
    expect(payload.requestDate).toBeNull()
    expect(payload.materialCode).toBeNull()
    expect(payload.spec).toBeNull()
    expect(payload.requiredArrivalDate).toBeNull()
    expect(payload.purchaseOrderNo).toBeNull()
    expect(payload.deliveryNote).toBeNull()
    expect(payload.remark).toBeNull()
  })

  it('loadPurchase：页码与每页条数必带；关键字/日期只在填了时才带（空串不发）', async () => {
    request.get.mockResolvedValue({ data: { success: true, dataList: [], total: 0 } })
    await loadPurchase()

    let params = request.get.mock.calls.at(-1)[1].params
    expect(request.get.mock.calls.at(-1)[0]).toBe('/api/purchase/list')
    expect(params.pageNum).toBe(1)
    expect(params.pageSize).toBe(10)
    expect('keyword' in params).toBe(false)
    expect('startDate' in params).toBe(false)

    keyword.value = ' 硅粉 '
    rangeStart.value = '2026-10-01'
    rangeEnd.value = '2026-10-31'
    await loadPurchase()
    params = request.get.mock.calls.at(-1)[1].params
    expect(params.keyword).toBe('硅粉')
    expect(params.startDate).toBe('2026-10-01')
    expect(params.endDate).toBe('2026-10-31')
  })

  it('loadPurchase：成功才写 rows/total/pageNum', async () => {
    request.get.mockResolvedValue({
      data: { success: true, dataList: [{ id: 1, materialName: '硅粉' }], total: 1, pageNum: 1 },
    })
    await loadPurchase()
    expect(rows.value).toHaveLength(1)
    expect(total.value).toBe(1)
    expect(loadError.value).toBe('')
  })

  it('★ loadPurchase：查询失败**不清空已有数据**，只把错误说出来', async () => {
    rows.value = [{ id: 9, materialName: '上一次取到的行' }]
    request.get.mockRejectedValue({ response: { data: { msg: '接口不可用' } } })

    await loadPurchase()

    expect(rows.value).toHaveLength(1) // 关键：不清空（正查着掉线，清空比报错更糟）
    expect(loadError.value).toBe('接口不可用')
  })

  it('savePurchase：POST /save 带上 payload，成功后重新取当前页', async () => {
    request.post.mockResolvedValue({ data: { success: true, data: 12 } })
    request.get.mockResolvedValue({ data: { success: true, dataList: [], total: 0 } })

    const id = await savePurchase({ requester: '张三', materialName: '硅粉', materialCode: '111001785' })

    expect(id).toBe(12)
    const [url, body] = request.post.mock.calls.at(-1)
    expect(url).toBe('/api/purchase/save')
    expect(body.materialCode).toBe('111001785')
    // 写完必须重新取页：列表数据在服务端，本地那份不会有新行
    expect(request.get.mock.calls.at(-1)[0]).toBe('/api/purchase/list')
  })

  it('deletePurchase：DELETE 带 id，且之后重新取页', async () => {
    request.delete.mockResolvedValue({ data: { success: true } })
    request.get.mockResolvedValue({ data: { success: true, dataList: [], total: 0 } })

    await deletePurchase(3)

    expect(request.delete.mock.calls.at(-1)[0]).toBe('/api/purchase/delete')
    expect(request.delete.mock.calls.at(-1)[1].params).toEqual({ id: 3 })
    expect(request.get.mock.calls.at(-1)[0]).toBe('/api/purchase/list')
  })
})

/**
 * 物料检索（变更-092）：采购行里的「物料名称 / 物料编码」两个框靠它做实时搜索与互相带出。
 *
 * 这里守的是**数据源与清洗规则**：走现成的 /api/stock/list（双源合并、关键字同时命中
 * 编码/名称/规格），分页参数必带（缺参 400），且**没有编码的行要滤掉** ——
 * 采购登记靠编码，一个没有编码的候选项点下去等于什么都没选。
 */
describe('物料检索（采购行的下拉）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    materialOptions.value = []
  })

  it('searchMaterials：打 /api/stock/list，分页参数必带，只保留有编码的行', async () => {
    request.get.mockResolvedValue({
      data: {
        success: true,
        dataList: [
          { materialCode: '111001785', materialName: '硅粉', spec: '500kg/袋' },
          { materialCode: '', materialName: '只有名字没有编码' },
        ],
        total: 2,
      },
    })

    const options = await searchMaterials(' 硅 ')

    const [url, config] = request.get.mock.calls.at(-1)
    expect(url).toBe('/api/stock/list')
    expect(config.params.pageNum).toBe(1)
    expect(config.params.pageSize).toBe(20)
    expect(config.params.keyword).toBe('硅')
    expect(options).toHaveLength(1)
    expect(options[0]).toEqual({
      code: '111001785',
      name: '硅粉',
      spec: '500kg/袋',
      label: '硅粉',
    })
  })

  it('searchMaterials：主数据里没有名称时 label 回退成编码（下拉里不许出现空白项）', async () => {
    request.get.mockResolvedValue({
      data: { success: true, dataList: [{ materialCode: '220000469', materialName: null }] },
    })

    const options = await searchMaterials('220000469')

    expect(options[0].name).toBe('')
    expect(options[0].label).toBe('220000469')
  })

  it('searchMaterials：接口失败 → 返回空数组且不抛（下拉是辅助输入，取不到不打断填表）', async () => {
    request.get.mockRejectedValue(new Error('boom'))
    await expect(searchMaterials('硅')).resolves.toEqual([])
    expect(materialOptions.value).toEqual([])
  })
})
