import { ref } from 'vue'
import request from '../api/request'
import { REPORT_ORDER_TYPES, getReportOrderType, getReportOrderTypeKey } from '../constants/orderTypes'
import { getToday, getFirstDayOfCurrentMonth } from '../utils/format'
import { normalizeImageList } from '../utils/image'

// ===== 工单数据（模块级单例）=====
//
// ⚠️ 改造要点（2026-10-10 统一整改）：**筛选与分页都在服务端**。
//
// 改造前是「拉全表 → 四个筛选条件与分页全在前端内存里做」，前端因此持有一份
// 「页面打开那一刻」的快照：库里新增的工单，无论怎么改筛选条件都看不到，非重启不可。
//
// 连带影响（本次一并改掉）：
//   · 工单汇总面板与工单报工面板原先共用这份全量数据（报工页是对它做 group by），
//     现在报工页改读 /api/work-order/summary-by-type-material；
//   · 三个筛选弹窗的候选（产成品 / 工单号）原先从前端全量里 new Set 现算，
//     现在由 /api/work-order/filter-options 提供；
//   · 工单类型候选仍由前端从**工单号候选**的前缀推出来 —— 那是四个固定前缀的字典
//     （REPORT_ORDER_TYPES），不值得为它多开一个「固定字典由服务端下发」的口子。
const tableData = ref([]) // 当前页
const pageNum = ref(1)
const pageSize = ref(10)
const total = ref(0) // **筛选后**的总条数
const loading = ref(false)
const errorMessage = ref('')
const startDate = ref(getFirstDayOfCurrentMonth())
const endDate = ref(getToday())

// 三个筛选条件及其弹窗开关
const productDialogVisible = ref(false)
const productFilter = ref('')
const orderTypeDialogVisible = ref(false)
const orderTypeFilter = ref('')
const orderNoDialogVisible = ref(false)
const orderNoFilter = ref('')

/** 候选（按日期区间取，不带另外两个筛选项 —— 否则选中一个之后就改选不了） */
const productOptions = ref([])
const orderNoOptions = ref([])

/** 按「工单类型 + 产成品」汇总：工单报工页与工单核算页共用（见后端 /summary-by-type-material） */
const workOrderSummaryRows = ref([])

/** 工单类型候选：从工单号候选的前缀推出来，按固定字典的顺序（操作→包装→转桶→返工） */
function orderTypeOptionsFrom(orderNos) {
  const present = new Set(orderNos.map((orderNo) => getReportOrderType(orderNo)).filter(Boolean))
  return REPORT_ORDER_TYPES.map((type) => type.label).filter((label) => present.has(label))
}

// 下拉候选是响应式的，但 template 里当数组用；用 ref + 取值时算，避免每次渲染都算一遍
const orderTypeOptions = ref([])

function normalizeWorkOrder(item) {
  if (!item) return null
  const order = item.workOrder
    ? { ...item.workOrder, ...item }
    : { ...item }
  order.imageList = normalizeImageList(order.imageList)
  return order
}

function dateRangeParams() {
  const params = {}
  if (startDate.value) params.startDate = startDate.value
  if (endDate.value) params.endDate = endDate.value
  return params
}

function buildWorkOrderQuery() {
  const params = { ...dateRangeParams(), pageNum: pageNum.value, pageSize: pageSize.value }
  if (productFilter.value) params.materialDesc = productFilter.value
  if (orderNoFilter.value) params.orderNo = orderNoFilter.value
  // 类型筛选：界面上存的是中文标签，发给后端的是 typeKey（服务端认 typeKey）
  const typeKey = getReportOrderTypeKey(orderTypeFilter.value)
  if (typeKey) params.type = typeKey
  return params
}

async function fetchWorkOrders() {
  loading.value = true
  errorMessage.value = ''

  try {
    const res = await request.get('/api/work-order/list', { params: buildWorkOrderQuery() })
    if (res.data?.success !== true) {
      throw new Error(res.data?.msg || '工单接口返回异常，请稍后重试。')
    }

    const dataList = Array.isArray(res.data.dataList)
      ? res.data.dataList.map(normalizeWorkOrder).filter(Boolean)
      : []

    tableData.value = dataList
    total.value = Number(res.data?.total) || 0
    // 页码以后端归一化后的值为准（后端会把越界页码归一到第 1 页）
    pageNum.value = Number(res.data?.pageNum) || pageNum.value
  } catch (error) {
    tableData.value = []
    total.value = 0
    errorMessage.value = error.response?.data?.msg || error.message || '工单数据加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

/** 取「按类型 + 产成品」汇总（工单报工 / 工单核算用），筛选条件与列表一致 */
async function fetchWorkOrderSummary() {
  try {
    const res = await request.get('/api/work-order/summary-by-type-material', {
      params: dateRangeParams(),
    })
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '工单接口返回异常。')
    }
    workOrderSummaryRows.value = Array.isArray(res.data?.data) ? res.data.data : []
  } catch {
    workOrderSummaryRows.value = []
  }
}

async function fetchWorkOrderOptions() {
  try {
    const res = await request.get('/api/work-order/filter-options', { params: dateRangeParams() })
    productOptions.value = Array.isArray(res.data?.data?.productNames)
      ? res.data.data.productNames
      : []
    orderNoOptions.value = Array.isArray(res.data?.data?.orderNos) ? res.data.data.orderNos : []
    orderTypeOptions.value = orderTypeOptionsFrom(orderNoOptions.value)
  } catch {
    productOptions.value = []
    orderNoOptions.value = []
    orderTypeOptions.value = []
  }
}

/** 筛选条件变了：回到第 1 页再查，并重取候选与汇总 */
function reloadWorkOrders() {
  pageNum.value = 1
  return Promise.all([fetchWorkOrders(), fetchWorkOrderOptions(), fetchWorkOrderSummary()])
}

/** 分页器回调：只换页，不重置条件，也不重取候选/汇总（它们与页码无关） */
function loadWorkOrderPage(page) {
  pageNum.value = page
  return fetchWorkOrders()
}

// ----- 筛选弹窗操作 -----
//
// 三个弹窗都在**打开时**才取候选：候选随日期区间变化，预热或缓存都会给出过期选项。

function openProductDialog() {
  productDialogVisible.value = true
  fetchWorkOrderOptions()
}

function handleProductSelected(materialDesc) {
  productFilter.value = materialDesc
  productDialogVisible.value = false
  reloadWorkOrders()
}

function clearProductFilter() {
  productFilter.value = ''
  reloadWorkOrders()
}

function openOrderTypeDialog() {
  orderTypeDialogVisible.value = true
  // 类型候选是从工单号候选的前缀推出来的，得先把候选取回来
  fetchWorkOrderOptions()
}

function handleOrderTypeSelected(orderType) {
  orderTypeFilter.value = orderType
  orderTypeDialogVisible.value = false
  reloadWorkOrders()
}

function clearOrderTypeFilter() {
  orderTypeFilter.value = ''
  reloadWorkOrders()
}

function openOrderNoDialog() {
  orderNoDialogVisible.value = true
  fetchWorkOrderOptions()
}

function handleOrderNoSelected(orderNo) {
  orderNoFilter.value = orderNo
  orderNoDialogVisible.value = false
  reloadWorkOrders()
}

function clearOrderNoFilter() {
  orderNoFilter.value = ''
  reloadWorkOrders()
}

export function useWorkOrderData() {
  return {
    // 数据
    tableData,
    workOrderSummaryRows,
    // 分页
    pageNum,
    pageSize,
    total,
    // 加载状态
    loading,
    errorMessage,
    // 筛选条件
    startDate,
    endDate,
    productFilter,
    orderTypeFilter,
    orderNoFilter,
    productDialogVisible,
    orderTypeDialogVisible,
    orderNoDialogVisible,
    productOptions,
    orderTypeOptions,
    orderNoOptions,
    // 操作
    loadWorkOrderPage,
    reloadWorkOrders,
    fetchWorkOrders,
    fetchWorkOrderSummary,
    fetchWorkOrderOptions,
    openProductDialog,
    handleProductSelected,
    clearProductFilter,
    openOrderTypeDialog,
    handleOrderTypeSelected,
    clearOrderTypeFilter,
    openOrderNoDialog,
    handleOrderNoSelected,
    clearOrderNoFilter,
  }
}
