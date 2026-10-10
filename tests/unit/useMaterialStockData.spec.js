import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/api/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import request from '../../src/api/request'
import { useMaterialStockData } from '../../src/composables/useMaterialStockData'

// 这一页的用法是「按 物料编码 / 物料名称 / 规格 查物料信息」，所以：
//   · 默认列出**全部**（含数量为 0 的物料）—— 快照语义下文件里消失的物料会被清零但保留行；
//   · 关键词要能命中编码、名称、规格三列；
//   · 名称/规格是「主数据优先、回退库存表」的联查结果，都没有时显示「/」。
//
// ⚠️ 2026-10-10 起筛选与分页都在**服务端**（列表统一整改），所以本文件的断言重心变了：
// 从「前端 filter/slice 的结果对不对」变成「请求参数发对了没有 + 服务端回什么就显示什么」。
// 三列命中、只看有库存、主数据回退这几条口径现在由后端 SQL 负责
// （见 hnd_factory 的 resources/mapper/MaterialStockMapper.xml），这里只钉住前端这一侧。
const rows = [
  {
    plantCode: '1503',
    materialCode: '111001785',
    materialName: '硅粉',
    spec: '500KG/袋',
    storageLocation: '1001',
    storageDesc: '原材料仓',
    unit: 'KG',
    stockQty: '49482.000',
  },
  {
    // 只有主数据、库存汇总里没有的物料（后端 union 出来的那一类）：
    // 只有编码/名称/规格，库存相关字段全空 —— 页面应显示「/」
    materialCode: '114002501',
    materialName: 'HND-V150_200kg_塑料桶',
    spec: '200kg/桶',
    storageLocation: null,
    storageDesc: null,
    unit: null,
    stockQty: null,
  },
]

describe('useMaterialStockData：物料查询（查询条件与分页都发给服务端）', () => {
  let api

  beforeEach(() => {
    api = useMaterialStockData()
    // 模块级单例：每个用例先把状态清干净
    api.stockKeyword.value = ''
    api.stockOnlyInStock.value = false
    api.stockPageNum.value = 1
    api.stockPageSize.value = 10
    request.get.mockReset()
    request.get.mockResolvedValue({ data: { success: true, dataList: rows, total: 799, pageNum: 1 } })
  })

  it('默认不带筛选条件，只发分页参数（「/」不分页是后端的事）', async () => {
    await api.fetchStockRecords()

    expect(request.get).toHaveBeenCalledWith('/api/stock/list', {
      params: { pageNum: 1, pageSize: 10 },
    })
    expect(api.stockOnlyInStock.value).toBe(false)
    // 总数取接口的 total（**筛选后**的总条数），不是本地数组长度 ——
    // 这正是「分页器页数」与「列表条数」能对上的前提
    expect(api.stockTotal.value).toBe(799)
    expect(api.stockTableData.value.map((record) => record.materialCode)).toEqual([
      '111001785',
      '114002501',
    ])
  })

  it('「只看有库存」勾上后作为 onlyInStock 发给服务端，不在前端过滤', async () => {
    api.stockOnlyInStock.value = true
    await api.fetchStockRecords()

    expect(request.get).toHaveBeenCalledWith('/api/stock/list', {
      params: { pageNum: 1, pageSize: 10, onlyInStock: true },
    })
  })

  it('关键词原样发给服务端（编码/名称/规格三列命中由后端 SQL 负责）', async () => {
    api.stockKeyword.value = '  V150  ' // 前后空格由前端去掉，别把空格带进 LIKE
    await api.fetchStockRecords()

    expect(request.get).toHaveBeenCalledWith('/api/stock/list', {
      params: { pageNum: 1, pageSize: 10, keyword: 'V150' },
    })
  })

  it('服务端回什么就显示什么：前端**不再**二次过滤', async () => {
    // 故意回一条「不符合关键词」的数据 —— 若前端偷偷做了本地过滤，这条就没了
    api.stockKeyword.value = 'V150'
    request.get.mockResolvedValue({
      data: { success: true, dataList: [{ materialCode: '999', materialName: '张三丰' }], total: 1 },
    })

    await api.fetchStockRecords()

    expect(api.stockTableData.value.map((r) => r.materialCode)).toEqual(['999'])
    expect(api.stockTotal.value).toBe(1)
  })

  it('换关键词 / 换开关后**回到第 1 页**再查', async () => {
    api.stockPageNum.value = 3

    api.stockKeyword.value = '硅粉'
    await api.applyStockFilter()

    expect(api.stockPageNum.value).toBe(1)
    const [, config] = request.get.mock.calls.at(-1)
    expect(config.params).toEqual({ pageNum: 1, pageSize: 10, keyword: '硅粉' })
  })

  it('翻页只换页码，不重置条件，也不本地切片', async () => {
    api.stockKeyword.value = '硅粉'
    await api.fetchStockRecords()
    request.get.mockResolvedValue({
      data: { success: true, dataList: [{ materialCode: '114002501' }], total: 3, pageNum: 2 },
    })

    await api.getStockPageData(2)

    const [, config] = request.get.mock.calls.at(-1)
    expect(config.params).toEqual({ pageNum: 2, pageSize: 10, keyword: '硅粉' })
    // 页码以后端归一化后的值为准（后端会把越界页码归一到第 1 页）
    expect(api.stockPageNum.value).toBe(2)
    expect(api.stockTableData.value.map((r) => r.materialCode)).toEqual(['114002501'])
  })

  it('页码越界时跟随后端归一到第 1 页', async () => {
    request.get.mockResolvedValue({
      data: { success: true, dataList: rows, total: 799, pageNum: 1 },
    })

    await api.getStockPageData(999)

    expect(api.stockPageNum.value).toBe(1)
  })

  it('只有主数据的物料：编码/名称/规格有值，库存那几列由「/」兜底', async () => {
    request.get.mockResolvedValue({
      data: { success: true, dataList: [rows[1]], total: 1, pageNum: 1 },
    })
    await api.fetchStockRecords()

    const row = api.stockTableData.value[0]
    expect(row.materialCode).toBe('114002501')
    expect(api.displayText(row.materialName)).toBe('HND-V150_200kg_塑料桶')
    expect(api.displayText(row.spec)).toBe('200kg/桶')
    // 库存列全空 -> 一律「/」。这条口径是**展示层**的（后端 union 出来的补行本来就
    // 没有库存那几列），所以仍然钉在前端这一侧
    expect(api.displayText(row.storageLocation)).toBe('/')
    expect(api.displayText(row.unit)).toBe('/')
    expect(api.displayText(api.formatStockQty(row.stockQty))).toBe('/')
    expect(api.displayText(row.storageDesc)).toBe('/')
  })

  it('接口失败：给出可读错误，列表清空（不残留上一次的数据）', async () => {
    await api.fetchStockRecords()
    request.get.mockRejectedValue({ response: { data: { msg: '库存接口 500' } } })

    await api.fetchStockRecords()

    expect(api.stockError.value).toBe('库存接口 500')
    expect(api.stockTableData.value).toEqual([])
    expect(api.stockTotal.value).toBe(0)
  })

  it('业务失败（HTTP 200 + success:false）也算失败', async () => {
    request.get.mockResolvedValue({ data: { success: false, msg: '参数错误' } })

    await api.fetchStockRecords()

    expect(api.stockError.value).toBe('参数错误')
  })

  it('displayText：编码/名称/规格 没值时显示「/」', () => {
    expect(api.displayText('硅粉')).toBe('硅粉')
    expect(api.displayText(null)).toBe('/')
    expect(api.displayText(undefined)).toBe('/')
    expect(api.displayText('   ')).toBe('/')
  })

  it('formatStockQty：去掉没意义的小数零，保留千分位', () => {
    expect(api.formatStockQty('49482.000')).toBe('49,482')
    expect(api.formatStockQty('7.500')).toBe('7.5')
    expect(api.formatStockQty(0)).toBe('0')
    expect(api.formatStockQty(null)).toBe('')
  })
})
