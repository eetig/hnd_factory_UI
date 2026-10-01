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
    plantCode: '1503',
    materialCode: '110000001',
    materialName: null, // 主数据与库存表都没有名字
    spec: null,
    storageLocation: '1001',
    storageDesc: '原材料仓',
    unit: 'KG',
    stockQty: '0.000',
  },
  {
    plantCode: '1503',
    materialCode: '110000002',
    materialName: '电石渣',
    spec: '槽车',
    storageLocation: '1002',
    storageDesc: '中间仓',
    unit: 'KG',
    stockQty: '7.000',
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

describe('useMaterialStockData：物料查询（库存汇总 + 主数据联查）', () => {
  let api

  beforeEach(() => {
    api = useMaterialStockData()
    // 模块级单例：每个用例先把状态清干净
    api.allStockRecords.value = []
    api.stockKeyword.value = ''
    api.stockOnlyInStock.value = false
    api.stockPageNum.value = 1
    request.get.mockReset()
    request.get.mockResolvedValue({ data: { success: true, dataList: rows } })
  })

  it('默认列出全部（含没有库存的物料，也含只有主数据的物料）', async () => {
    await api.fetchStockRecords()

    expect(request.get).toHaveBeenCalledWith('/api/stock/list')
    expect(api.stockOnlyInStock.value).toBe(false)
    expect(api.stockTotal.value).toBe(4)
    expect(api.stockTableData.value.map((record) => record.materialCode)).toContain('110000001')
    expect(api.stockTableData.value.map((record) => record.materialCode)).toContain('114002501')
  })

  it('勾上「只看有库存」后，数量为 0 的和只有主数据的都被过滤掉', async () => {
    api.stockOnlyInStock.value = true
    await api.fetchStockRecords()

    expect(api.stockTotal.value).toBe(2)
    const codes = api.stockTableData.value.map((record) => record.materialCode)
    expect(codes).not.toContain('110000001')
    expect(codes).not.toContain('114002501')
  })

  it('只有主数据的物料：编码/名称/规格有值，库存那几列由「/」兜底', async () => {
    await api.fetchStockRecords()

    api.stockKeyword.value = 'V150'
    api.applyStockFilter()

    expect(api.stockTotal.value).toBe(1)
    const row = api.stockTableData.value[0]
    expect(row.materialCode).toBe('114002501')
    expect(api.displayText(row.materialName)).toBe('HND-V150_200kg_塑料桶')
    expect(api.displayText(row.spec)).toBe('200kg/桶')
    // 库存列全空 -> 一律「/」
    expect(api.displayText(row.storageLocation)).toBe('/')
    expect(api.displayText(row.unit)).toBe('/')
    expect(api.displayText(api.formatStockQty(row.stockQty))).toBe('/')
    expect(api.displayText(row.storageDesc)).toBe('/')
  })

  it('关键词三列都能命中：物料编码 / 物料名称 / 规格', async () => {
    await api.fetchStockRecords()

    api.stockKeyword.value = '110000002'
    api.applyStockFilter()
    expect(api.stockTotal.value).toBe(1)

    api.stockKeyword.value = '电石渣'
    api.applyStockFilter()
    expect(api.stockTableData.value[0].materialCode).toBe('110000002')

    api.stockKeyword.value = '槽车'
    api.applyStockFilter()
    expect(api.stockTableData.value[0].materialCode).toBe('110000002')
  })

  it('换关键词后回到第 1 页', async () => {
    await api.fetchStockRecords()
    api.stockPageNum.value = 2

    api.stockKeyword.value = '硅粉'
    api.applyStockFilter()

    expect(api.stockPageNum.value).toBe(1)
    expect(api.stockTotal.value).toBe(1)
  })

  it('分页：按页切片', async () => {
    await api.fetchStockRecords()

    api.stockPageSize.value = 3
    api.applyStockFilter()
    expect(api.stockTableData.value).toHaveLength(3)

    api.getStockPageData(2)
    expect(api.stockTableData.value).toHaveLength(1)
    expect(api.stockTableData.value[0].materialCode).toBe('114002501')
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
