// 工单类型：按工单号前缀识别
export const REPORT_ORDER_TYPES = [
  { prefix: '1000', label: '操作工单' },
  { prefix: '2000', label: '包装工单' },
  { prefix: '3000', label: '转桶工单' },
  { prefix: '4000', label: '返工工单' },
]

export function getReportOrderType(orderNo) {
  const matched = REPORT_ORDER_TYPES.find((type) => String(orderNo ?? '').startsWith(type.prefix))
  return matched?.label ?? ''
}
