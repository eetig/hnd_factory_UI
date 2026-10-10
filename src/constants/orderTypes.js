// 工单类型：按工单号前缀识别
//
// typeKey 是**传给后端**的标识（服务端 WorkOrderTypeEnum 的同一套键，见
// WorkOrderTypeEnum.prefixOf）。label 只是给人看的中文。
// 2026-10-10 统一整改：工单列表改后端分页后，工单类型筛选也必须由服务端执行，
// 于是请求里要带 typeKey —— 之前三个筛选条件全在前端内存里比对，只用到 label。
export const REPORT_ORDER_TYPES = [
  { prefix: '1000', typeKey: 'operate', label: '操作工单' },
  { prefix: '2000', typeKey: 'package', label: '包装工单' },
  { prefix: '3000', typeKey: 'transfer', label: '转桶工单' },
  { prefix: '4000', typeKey: 'rework', label: '返工工单' },
]

export function getReportOrderType(orderNo) {
  const matched = REPORT_ORDER_TYPES.find((type) => String(orderNo ?? '').startsWith(type.prefix))
  return matched?.label ?? ''
}

/**
 * 中文标签 → 传给后端的类型标识。
 *
 * 界面上的筛选状态存的是标签（要直接显示给用户），发请求时才转成 typeKey。
 * 认不出的标签返回空串，调用方据此**不带**该参数（而不是传个空值上去）。
 */
export function getReportOrderTypeKey(label) {
  const matched = REPORT_ORDER_TYPES.find((type) => type.label === label)
  return matched?.typeKey ?? ''
}
