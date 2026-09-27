import { computed, ref } from 'vue'
import request from '../api/request'
import { REPORT_ORDER_TYPES, getReportOrderType } from '../constants/orderTypes'
import { getToday, getFirstDayOfCurrentMonth } from '../utils/format'
import { normalizeImageList } from '../utils/image'

// ===== 工单数据（模块级单例）=====
// 工单汇总面板与工单报工面板共用同一份数据：
// 工单报工的统计基于「工单汇总当前筛选后」的结果（tableDataAll）。
const tableData = ref([]) // 当前页数据
const tableDataAll = ref([]) // 筛选后的全量数据
const allWorkOrders = ref([]) // 接口返回的全量数据
const pageNum = ref(1)
const pageSize = ref(10)
const total = ref(0)
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

// 工单号可选项（当前日期范围内的工单号，倒序）
const orderNoOptions = computed(() => {
  const orderNos = allWorkOrders.value
    .filter(matchesDateRange)
    .map((order) => String(order.orderNo ?? '').trim())
    .filter(Boolean)

  return [...new Set(orderNos)].sort((left, right) =>
    String(right).localeCompare(String(left), undefined, { numeric: true }),
  )
})

// 工单类型可选项（按 操作→包装→转桶→返工 固定顺序）
const orderTypeOptions = computed(() => {
  const types = new Set(
    allWorkOrders.value
      .filter(matchesDateRange)
      .map((order) => getReportOrderType(order.orderNo))
      .filter(Boolean),
  )

  return REPORT_ORDER_TYPES.map((type) => type.label).filter((label) => types.has(label))
})

const productOptions = computed(() => {
  const names = allWorkOrders.value
    .filter(matchesDateRange)
    .map((order) => String(order.materialDesc ?? '').trim())
    .filter(Boolean)

  return [...new Set(names)].sort((left, right) => left.localeCompare(right, 'zh-CN'))
})

// ----- 筛选弹窗操作 -----

function openProductDialog() {
  productDialogVisible.value = true
}

function handleProductSelected(materialDesc) {
  productFilter.value = materialDesc
  productDialogVisible.value = false
  filterWorkOrders()
}

function clearProductFilter() {
  productFilter.value = ''
  filterWorkOrders()
}

function openOrderTypeDialog() {
  orderTypeDialogVisible.value = true
}

function handleOrderTypeSelected(orderType) {
  orderTypeFilter.value = orderType
  orderTypeDialogVisible.value = false
  filterWorkOrders()
}

function clearOrderTypeFilter() {
  orderTypeFilter.value = ''
  filterWorkOrders()
}

function openOrderNoDialog() {
  orderNoDialogVisible.value = true
}

function handleOrderNoSelected(orderNo) {
  orderNoFilter.value = orderNo
  orderNoDialogVisible.value = false
  filterWorkOrders()
}

function clearOrderNoFilter() {
  orderNoFilter.value = ''
  filterWorkOrders()
}

// ----- 列表与筛选 -----

function getPageData(page = pageNum.value) {
  pageNum.value = page
  const startIndex = (pageNum.value - 1) * pageSize.value
  const endIndex = startIndex + pageSize.value
  tableData.value = tableDataAll.value.slice(startIndex, endIndex)
}

function normalizeWorkOrder(item) {
  if (!item) return null
  const order = item.workOrder
    ? { ...item.workOrder, ...item }
    : { ...item }
  order.imageList = normalizeImageList(order.imageList)
  return order
}

function getOrderDate(order) {
  return String(order?.planStartDate || '').slice(0, 10)
}

function sortWorkOrders(workOrders) {
  return [...workOrders].sort((left, right) => {
    const leftDate = new Date(left.planStartDate || 0).getTime()
    const rightDate = new Date(right.planStartDate || 0).getTime()

    if (leftDate !== rightDate) {
      return rightDate - leftDate
    }

    return String(right.orderNo ?? '').localeCompare(
      String(left.orderNo ?? ''),
      undefined,
      { numeric: true },
    )
  })
}

function matchesDateRange(order) {
  const planStartDate = getOrderDate(order)
  if (!planStartDate) return false
  return planStartDate >= startDate.value && planStartDate <= endDate.value
}

function matchesProductFilter(order) {
  if (!productFilter.value) return true
  return String(order.materialDesc ?? '').trim() === productFilter.value
}

function matchesOrderTypeFilter(order) {
  if (!orderTypeFilter.value) return true
  return getReportOrderType(order.orderNo) === orderTypeFilter.value
}

function matchesOrderNoFilter(order) {
  if (!orderNoFilter.value) return true
  return String(order.orderNo ?? '').trim() === orderNoFilter.value
}

function filterWorkOrders() {
  tableDataAll.value = allWorkOrders.value.filter(
    (order) =>
      matchesDateRange(order) &&
      matchesProductFilter(order) &&
      matchesOrderTypeFilter(order) &&
      matchesOrderNoFilter(order),
  )

  total.value = tableDataAll.value.length
  pageNum.value = 1
  getPageData()
}

async function fetchWorkOrders() {
  loading.value = true
  errorMessage.value = ''

  try {
    const res = await request.get('/api/work-order/list')
    if (res.data.success === true) {
      const dataList = Array.isArray(res.data.dataList)
        ? res.data.dataList.map(normalizeWorkOrder).filter(Boolean)
        : []

      allWorkOrders.value = sortWorkOrders(dataList)
      filterWorkOrders()
    } else {
      allWorkOrders.value = []
      tableDataAll.value = []
      tableData.value = []
      total.value = 0
      errorMessage.value = res.data.msg || '工单接口返回异常，请稍后重试。'
    }
  } catch (error) {
    allWorkOrders.value = []
    tableDataAll.value = []
    tableData.value = []
    total.value = 0
    errorMessage.value = error.response?.data?.msg || '工单数据加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

export function useWorkOrderData() {
  return {
    // 数据
    tableData,
    tableDataAll,
    allWorkOrders,
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
    getPageData,
    filterWorkOrders,
    fetchWorkOrders,
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
