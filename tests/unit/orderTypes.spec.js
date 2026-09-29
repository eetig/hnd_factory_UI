import { describe, it, expect } from 'vitest'
import { REPORT_ORDER_TYPES, getReportOrderType } from '../../src/constants/orderTypes'

describe('getReportOrderType：按工单号前缀识别工单类型', () => {
  it('四类前缀都能识别', () => {
    expect(getReportOrderType('1000001')).toBe('操作工单')
    expect(getReportOrderType('2000002')).toBe('包装工单')
    expect(getReportOrderType('3000003')).toBe('转桶工单')
    expect(getReportOrderType('4000004')).toBe('返工工单')
  })

  it('非字符串工单号容错（后端可能返回数字）', () => {
    expect(getReportOrderType(1000001)).toBe('操作工单')
  })

  it('前缀不匹配时返回空串（报工汇总据此跳过该行）', () => {
    expect(getReportOrderType('9000001')).toBe('')
    expect(getReportOrderType('')).toBe('')
    expect(getReportOrderType(null)).toBe('')
  })

  it('前缀顺序即展示顺序，改动需谨慎', () => {
    expect(REPORT_ORDER_TYPES.map((type) => type.prefix)).toEqual(['1000', '2000', '3000', '4000'])
  })
})
