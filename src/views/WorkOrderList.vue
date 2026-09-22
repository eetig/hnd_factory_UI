<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import request from '../api/request'
import ProductSelectDialog from '../components/ProductSelectDialog.vue'
import WorkOrderImport from './WorkOrderImport.vue'
import vesselImageUrl from '../assets/vessel.png'
import vesselProduct150ImageUrl from '../assets/vessel-product150.png'
import 'dayjs/locale/zh-cn'
import updateLocale from 'dayjs/plugin/updateLocale'
import {
  ElButton,
  ElConfigProvider,
  ElDatePicker,
  ElDialog,
  ElMessage,
  ElMessageBox,
  ElPagination,
} from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'

dayjs.extend(updateLocale)
dayjs.updateLocale('zh-cn', { weekStart: 1 })
dayjs.locale('zh-cn')

const tabs = [
  { key: 'workOrder', label: '工单汇总' },
  { key: 'material', label: '领料汇总' },
  { key: 'inbound', label: '入库汇总' },
  { key: 'report', label: '工单报工' },
  { key: 'costing', label: '工单核算' },
  { key: 'materialCosting', label: '原辅料核算' },
  { key: 'weekly', label: '周统计' },
  { key: 'daily', label: '日报表记录' },
  { key: 'vessel', label: '压力容器体积计算' },
  { key: 'import', label: '文件导入' },
]

// 工单报工表格列
const reportColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'orderType', label: '工单类型', width: 'w-40' },
  { key: 'materialDesc', label: '产成品', width: 'w-[200px]' },
  { key: 'orderQty', label: '订单数量', width: 'w-28', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-32', align: 'right' },
]

// 工单类型：按单号前缀识别
const REPORT_ORDER_TYPES = [
  { prefix: '1000', label: '操作工单' },
  { prefix: '2000', label: '包装工单' },
  { prefix: '3000', label: '转桶工单' },
  { prefix: '4000', label: '返工工单' },
]

function getReportOrderType(orderNo) {
  const matched = REPORT_ORDER_TYPES.find((type) => String(orderNo ?? '').startsWith(type.prefix))
  return matched?.label ?? ''
}

// 数量求和后去掉浮点误差（保留至多 3 位小数）
function formatQty(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0
}
const activeTab = ref('workOrder')

const tableData = ref([])
const tableDataAll = ref([])
const allWorkOrders = ref([])
const pageNum = ref(1)
const pageSize = ref(10)
const total = ref(0)
const loading = ref(false)
const errorMessage = ref('')
const startDate = ref(getFirstDayOfCurrentMonth())
const endDate = ref(getToday())
const imageList = ref([])
const currentIndex = ref(0)
const currentMaterialDesc = ref('')
const currentConfirmedQty = ref('')
const currentOrderNo = ref('')
const imageDialogVisible = ref(false)
const imageFileInput = ref(null)
const imageUploading = ref(false)
const imageDeleting = ref(false)
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

// 工单报工数据：取工单汇总页当前查出的数据，按 工单类型 + 产成品 分组，数量与产量按组求和
const reportRows = computed(() => {
  const rows = new Map()

  for (const order of tableDataAll.value) {
    const orderType = getReportOrderType(order?.orderNo)
    if (!orderType) continue

    const materialDesc = String(order.materialDesc ?? '').trim()
    if (!materialDesc) continue

    const key = `${orderType}|${materialDesc}`
    let row = rows.get(key)

    if (!row) {
      row = { orderType, materialDesc, orderQty: 0, confirmedQty: 0 }
      rows.set(key, row)
    }

    row.orderQty += Number(order.orderQty) || 0
    row.confirmedQty += Number(order.confirmedQty) || 0
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      orderQty: formatQty(row.orderQty),
      confirmedQty: formatQty(row.confirmedQty),
    }))
    .sort((left, right) => {
      const byType = REPORT_ORDER_TYPES.findIndex((type) => type.label === left.orderType) -
        REPORT_ORDER_TYPES.findIndex((type) => type.label === right.orderType)

      if (byType !== 0) return byType

      return left.materialDesc.localeCompare(right.materialDesc, 'zh-CN')
    })
})

const columns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'planStartDate', label: '基本开始日期', width: 'w-36' },
  { key: 'orderNo', label: '工单号', width: 'w-40' },
  { key: 'orderType', label: '工单类型', width: 'w-32' },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'materialDesc', label: '产成品', width: 'w-[180px]' },
  { key: 'orderQty', label: '订单数量', width: 'w-28', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-32', align: 'right' },
  { key: 'deliveredQty', label: '已交货数量', width: 'w-32', align: 'right' },
]

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getToday() {
  return formatDate(new Date())
}

function getFirstDayOfCurrentMonth() {
  const date = new Date()
  date.setDate(1)
  return formatDate(date)
}

// 上周一（周统计默认起始）
function getLastWeekMonday() {
  const date = new Date()
  const dayOfWeek = (date.getDay() + 6) % 7 // 周一=0 ... 周日=6
  date.setDate(date.getDate() - dayOfWeek - 7)
  return formatDate(date)
}

// 上周日（周统计默认截止）
function getLastWeekSunday() {
  const date = new Date()
  const dayOfWeek = (date.getDay() + 6) % 7 // 周一=0 ... 周日=6
  date.setDate(date.getDate() - dayOfWeek - 1)
  return formatDate(date)
}

// yyyy-MM-dd → M月D日
function formatMonthDay(dateString) {
  const [, month, day] = String(dateString ?? '').split('-')
  if (!month || !day) return dateString ?? ''
  return `${Number(month)}月${Number(day)}日`
}

function normalizeImage(image) {
  if (typeof image === 'string') {
    return { imageId: image, url: image }
  }

  return {
    imageId: image?.imageId ?? image?.id ?? '',
    url: image?.url ?? image?.imageUrl ?? image?.fileUrl ?? image?.path ?? '',
  }
}

function normalizeImageList(images) {
  let imageValues = images

  if (typeof imageValues === 'string') {
    try {
      imageValues = JSON.parse(imageValues)
    } catch {
      imageValues = imageValues ? [imageValues] : []
    }
  }

  if (!Array.isArray(imageValues)) {
    imageValues = imageValues ? [imageValues] : []
  }

  return imageValues.map(normalizeImage).filter((image) => image.url)
}

async function refreshImageList(order) {
  if (!currentOrderNo.value) {
    imageList.value = normalizeImageList(order?.imageList)
    return
  }

  const res = await request.get('/api/work-order/image/list', {
    params: { orderNo: currentOrderNo.value },
  })
  imageList.value = normalizeImageList(res.data?.data || [])
}

function updateCurrentOrderImages(images) {
  const normalizedImages = normalizeImageList(images)
  const updateImages = (order) => {
    if (String(order.orderNo) === String(currentOrderNo.value)) {
      order.imageList = normalizedImages
    }
  }

  allWorkOrders.value.forEach(updateImages)
  tableDataAll.value.forEach(updateImages)
  imageList.value = normalizedImages
  filterWorkOrders()
}

async function openImageDialog(order) {
  currentMaterialDesc.value = order?.materialDesc || '-'
  currentConfirmedQty.value = order?.confirmedQty ?? '-'
  currentOrderNo.value = order?.orderNo || ''
  imageList.value = normalizeImageList(order?.imageList)
  currentIndex.value = 0
  imageDialogVisible.value = true

  await refreshImageList(order)
}

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

function openFilePicker() {
  imageFileInput.value?.click()
}

function handleImportCancel() {
  activeTab.value = 'workOrder'
}

function handleImportBack() {
  activeTab.value = 'workOrder'
  fetchWorkOrders()
}

function showPreviousImage() {
  if (!imageList.value.length) return
  currentIndex.value =
    (currentIndex.value - 1 + imageList.value.length) % imageList.value.length
}

function showNextImage() {
  if (!imageList.value.length) return
  currentIndex.value = (currentIndex.value + 1) % imageList.value.length
}

async function handleImageSelected(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''

  if (!files.length || !currentOrderNo.value) return

  imageUploading.value = true

  try {
    const formData = new FormData()
    formData.append('orderNo', currentOrderNo.value)
    files.forEach((file) => formData.append('files', file))

    const res = await request.post('/api/work-order/image/upload', formData)
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '图片上传失败。')
    }

    const uploadedImages = normalizeImageList(res.data?.data || [])
    if (uploadedImages.length) {
      updateCurrentOrderImages([...imageList.value, ...uploadedImages])
      currentIndex.value = imageList.value.length - 1
    } else {
      await fetchWorkOrders()
      const currentOrder = allWorkOrders.value.find(
        (order) => String(order.orderNo) === String(currentOrderNo.value),
      )
      await refreshImageList(currentOrder)
    }
    ElMessage.success('图片上传成功')
  } catch (error) {
    ElMessage.error(error.response?.data?.msg || error.message || '图片上传失败，请重试。')
  } finally {
    imageUploading.value = false
  }
}

async function deleteImage(image) {
  if (!currentOrderNo.value || !image?.imageId) return

  try {
    await ElMessageBox.confirm(
      '删除后将无法在当前工单中查看该图片，是否继续？',
      '确认删除图片',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  imageDeleting.value = true

  try {
    const res = await request.delete('/api/work-order/image/delete', {
      params: { imageId: image.imageId },
      data: { imageId: image.imageId },
    })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '图片删除失败。')
    }

    const remainingImages = imageList.value.filter(
      (item) => String(item.imageId) !== String(image.imageId),
    )
    updateCurrentOrderImages(remainingImages)
    if (currentIndex.value >= imageList.value.length) {
      currentIndex.value = Math.max(0, imageList.value.length - 1)
    }
    ElMessage.success('图片已删除')
  } catch (error) {
    ElMessage.error(error.response?.data?.msg || error.message || '图片删除失败，请重试。')
  } finally {
    imageDeleting.value = false
  }
}

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

// ===== 领料汇总 =====
const pickColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'pickDate', label: '领料时间', width: 'w-36' },
  { key: 'materialName', label: '物料名称', width: 'w-[200px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'pickQty', label: '领料数量', width: 'w-28', align: 'right' },
  { key: 'unit', label: '单位', width: 'w-24' },
  { key: 'imageUrl', label: '线下单据', width: 'w-24' },
]

// 领料汇总字段别名容错（后端字段名有出入时自动适配）
const PICK_FIELD_MAP = {
  materialName: ['materialName', 'materialDesc'],
  materialCode: ['materialCode', 'materialNo'],
  pickDate: ['pickDate', 'pickTime'],
  pickQty: ['pickQty', 'pickQuantity', 'quantity'],
  unit: ['unit'],
  imageUrl: ['imageUrl', 'image', 'imagePath', 'fileUrl'],
}

const pickStartDate = ref(getFirstDayOfCurrentMonth())
const pickEndDate = ref(getToday())
const allPickRecords = ref([])
const pickFiltered = ref([])
const pickTableData = ref([])
const pickPageNum = ref(1)
const pickPageSize = ref(10)
const pickTotal = ref(0)
const pickLoading = ref(false)
const pickError = ref('')
const pickImageDialogVisible = ref(false)
const currentPickImage = ref('')

function openPickImageDialog(record) {
  if (!record?.imageUrl) return
  currentPickImage.value = record.imageUrl
  pickImageDialogVisible.value = true
}

function pickField(item, aliases) {
  for (const alias of aliases) {
    const value = item?.[alias]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return ''
}

function normalizePickRecord(item) {
  if (!item) return null
  return Object.fromEntries(
    Object.entries(PICK_FIELD_MAP).map(([key, aliases]) => [key, pickField(item, aliases)]),
  )
}

function getPickDate(record) {
  return String(record?.pickDate ?? '').slice(0, 10)
}

// 领料时间由近到远排序
function sortPickRecords(records) {
  return [...records].sort((left, right) => {
    const leftTime = new Date(getPickDate(left) || 0).getTime()
    const rightTime = new Date(getPickDate(right) || 0).getTime()
    return rightTime - leftTime
  })
}

function getPickPageData(page = pickPageNum.value) {
  pickPageNum.value = page
  const startIndex = (pickPageNum.value - 1) * pickPageSize.value
  const endIndex = startIndex + pickPageSize.value
  pickTableData.value = pickFiltered.value.slice(startIndex, endIndex)
}

function filterPickRecords() {
  pickFiltered.value = sortPickRecords(
    allPickRecords.value.filter((record) => {
      const pickDate = getPickDate(record)
      if (!pickDate) return false
      return pickDate >= pickStartDate.value && pickDate <= pickEndDate.value
    }),
  )

  pickTotal.value = pickFiltered.value.length
  pickPageNum.value = 1
  getPickPageData()
}

async function fetchPickRecords() {
  pickLoading.value = true
  pickError.value = ''

  try {
    const res = await request.get('/api/pick/list')

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '领料汇总接口返回异常，请稍后重试。')
    }

    const dataList = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    allPickRecords.value = dataList.map(normalizePickRecord).filter(Boolean)
    filterPickRecords()
  } catch (error) {
    allPickRecords.value = []
    pickFiltered.value = []
    pickTableData.value = []
    pickTotal.value = 0

    if (error?.response?.status === 404) {
      pickError.value = '领料汇总接口不存在，请确认后端服务已实现该接口。'
    } else {
      pickError.value =
        error.response?.data?.msg || error.message || '领料汇总数据加载失败，请稍后重试。'
    }
  } finally {
    pickLoading.value = false
  }
}

// ===== 入库汇总 =====
const inboundColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'inboundDate', label: '入库时间', width: 'w-36' },
  { key: 'materialName', label: '物料名称', width: 'w-[200px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'inboundQty', label: '领料数量', width: 'w-28', align: 'right' },
  { key: 'unit', label: '单位', width: 'w-24' },
  { key: 'imageUrl', label: '线下单据', width: 'w-24' },
]

// 入库汇总字段别名容错（后端字段名有出入时自动适配）
const INBOUND_FIELD_MAP = {
  materialName: ['materialName', 'materialDesc'],
  materialCode: ['materialCode', 'materialNo'],
  inboundDate: ['inboundDate', 'inboundTime'],
  inboundQty: ['inboundQty', 'inboundQuantity', 'quantity'],
  unit: ['unit'],
  imageUrl: ['imageUrl', 'image', 'imagePath', 'fileUrl'],
}

const inboundStartDate = ref(getFirstDayOfCurrentMonth())
const inboundEndDate = ref(getToday())
const allInboundRecords = ref([])
const inboundFiltered = ref([])
const inboundTableData = ref([])
const inboundPageNum = ref(1)
const inboundPageSize = ref(10)
const inboundTotal = ref(0)
const inboundLoading = ref(false)
const inboundError = ref('')
const inboundImageDialogVisible = ref(false)
const currentInboundImage = ref('')

function openInboundImageDialog(record) {
  if (!record?.imageUrl) return
  currentInboundImage.value = record.imageUrl
  inboundImageDialogVisible.value = true
}

function normalizeInboundRecord(item) {
  if (!item) return null
  return Object.fromEntries(
    Object.entries(INBOUND_FIELD_MAP).map(([key, aliases]) => [key, pickField(item, aliases)]),
  )
}

function getInboundDate(record) {
  return String(record?.inboundDate ?? '').slice(0, 10)
}

// 入库时间由近到远排序
function sortInboundRecords(records) {
  return [...records].sort((left, right) => {
    const leftTime = new Date(getInboundDate(left) || 0).getTime()
    const rightTime = new Date(getInboundDate(right) || 0).getTime()
    return rightTime - leftTime
  })
}

function getInboundPageData(page = inboundPageNum.value) {
  inboundPageNum.value = page
  const startIndex = (inboundPageNum.value - 1) * inboundPageSize.value
  const endIndex = startIndex + inboundPageSize.value
  inboundTableData.value = inboundFiltered.value.slice(startIndex, endIndex)
}

function filterInboundRecords() {
  inboundFiltered.value = sortInboundRecords(
    allInboundRecords.value.filter((record) => {
      const inboundDate = getInboundDate(record)
      if (!inboundDate) return false
      return inboundDate >= inboundStartDate.value && inboundDate <= inboundEndDate.value
    }),
  )

  inboundTotal.value = inboundFiltered.value.length
  inboundPageNum.value = 1
  getInboundPageData()
}

async function fetchInboundRecords() {
  inboundLoading.value = true
  inboundError.value = ''

  try {
    const res = await request.get('/api/inbound/list')

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '入库汇总接口返回异常，请稍后重试。')
    }

    const dataList = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    allInboundRecords.value = dataList.map(normalizeInboundRecord).filter(Boolean)
    filterInboundRecords()
  } catch (error) {
    allInboundRecords.value = []
    inboundFiltered.value = []
    inboundTableData.value = []
    inboundTotal.value = 0

    if (error?.response?.status === 404) {
      inboundError.value = '入库汇总接口不存在，请确认后端服务已实现该接口。'
    } else {
      inboundError.value =
        error.response?.data?.msg || error.message || '入库汇总数据加载失败，请稍后重试。'
    }
  } finally {
    inboundLoading.value = false
  }
}

// ===== 工单核算 =====
const costingColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialName', label: '已入库产成品', width: 'w-[240px]', wrap: true },
  { key: 'materialCode', label: '产成品编码', width: 'w-36' },
  { key: 'inboundQty', label: '入库数', width: 'w-32', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-32', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-32', align: 'right' },
]

// 产成品名称归一化：忽略空格/下划线差异，用于跨系统（入库数据与工单数据）名称匹配
function normalizeMaterialName(name) {
  return String(name ?? '').replace(/[\s_]/g, '').toLowerCase()
}

// 已报工数量：按归一化产成品名称汇总工单的确认产量
const reportedQtyMap = computed(() => {
  const map = new Map()

  for (const order of tableDataAll.value) {
    const key = normalizeMaterialName(order.materialDesc)
    if (!key) continue

    map.set(key, (map.get(key) || 0) + (Number(order.confirmedQty) || 0))
  }

  return map
})

// 工单核算：以已入库产成品（入库汇总的物料名称去重）为行，入库数与已报工数汇总，差额为未报工数
const costingRows = computed(() => {
  const rows = new Map()

  // 入库数：来自入库汇总数据，按物料名称去重
  for (const record of allInboundRecords.value) {
    const materialName = String(record.materialName ?? '').trim()
    const key = normalizeMaterialName(materialName)
    if (!key) continue

    if (!rows.has(key)) {
      rows.set(key, {
        materialName,
        materialCode: String(record.materialCode ?? '').trim(),
        inboundQty: 0,
        reportedQty: 0,
      })
    }

    rows.get(key).inboundQty += Number(record.inboundQty) || 0
  }

  // 已报工数：按产成品名称匹配工单报工数据
  for (const row of rows.values()) {
    row.reportedQty = reportedQtyMap.value.get(normalizeMaterialName(row.materialName)) || 0
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      inboundQty: formatQty(row.inboundQty),
      reportedQty: formatQty(row.reportedQty),
      unreportedQty: formatQty(row.inboundQty - row.reportedQty),
    }))
    .sort((left, right) => left.materialName.localeCompare(right.materialName, 'zh-CN'))
})

// ===== 原辅料核算 =====
// 暂照搬工单核算的列与计算逻辑，后续按原辅料规则单独调整（不影响工单核算）
const materialCostingColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialName', label: '已领物料名称', width: 'w-[240px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'pickQty', label: '领料数', width: 'w-32', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-32', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-32', align: 'right' },
]

// 领料数换算系数（按物料编码，如 HND-V150_辅料包 ×3.2）
const MATERIAL_COSTING_QTY_FACTORS = {
  '112004292': 3.2,
}

// 货物移动：按物料编码汇总移动数量（原辅料核算的「已报工数」来源）
const GOODS_MOVE_FIELD_MAP = {
  materialCode: ['materialCode', 'materialNo'],
  moveQty: ['moveQty', 'quantity', 'moveQuantity', 'qty'],
  moveDate: ['moveDate', 'postingDate', 'postDate'],
  moveType: ['moveType', 'movementType', 'type'],
}

const goodsMoveRecords = ref([])
const goodsMoveError = ref('')
// 货物移动查询时间范围（默认当月初至今天）
const goodsMoveStartDate = ref(getFirstDayOfCurrentMonth())
const goodsMoveEndDate = ref(getToday())

const goodsMoveQtyMap = computed(() => {
  const map = new Map()

  for (const record of goodsMoveRecords.value) {
    const code = String(record.materialCode ?? '').trim()
    if (!code) continue

    map.set(code, (map.get(code) || 0) + (Number(record.moveQty) || 0))
  }

  return map
})

function normalizeGoodsMoveRecord(item) {
  if (!item) return null
  return Object.fromEntries(
    Object.entries(GOODS_MOVE_FIELD_MAP).map(([key, aliases]) => [key, pickField(item, aliases)]),
  )
}

async function fetchGoodsMoveRecords() {
  goodsMoveError.value = ''

  try {
    const res = await request.get('/api/goods-move/list', {
      params: {
        startDate: goodsMoveStartDate.value,
        endDate: goodsMoveEndDate.value,
      },
    })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '货物移动接口返回异常。')
    }

    const dataList = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    goodsMoveRecords.value = dataList
      .map(normalizeGoodsMoveRecord)
      .filter((record) => {
        if (!record) return false

        const moveDate = String(record.moveDate ?? '').slice(0, 10)
        // 无日期字段时不过滤（避免后端未返回该字段导致数据全空）
        if (!moveDate) return true

        return moveDate >= goodsMoveStartDate.value && moveDate <= goodsMoveEndDate.value
      })
  } catch (error) {
    goodsMoveRecords.value = []
    goodsMoveError.value = error?.response?.status === 404
      ? '货物移动接口不存在，请确认后端服务已实现该接口。'
      : error.response?.data?.msg || error.message || '货物移动数据加载失败。'
  }
}

// 原辅料核算：以领料汇总的物料名称去重为行，领料数按物料累加，已报工数取货物移动数量合计
const materialCostingRows = computed(() => {
  const rows = new Map()

  // 领料数：来自领料汇总数据，按物料名称去重
  for (const record of allPickRecords.value) {
    const materialName = String(record.materialName ?? '').trim()
    const key = normalizeMaterialName(materialName)
    if (!key) continue

    if (!rows.has(key)) {
      rows.set(key, {
        materialName,
        materialCode: String(record.materialCode ?? '').trim(),
        pickQty: 0,
        reportedQty: 0,
      })
    }

    rows.get(key).pickQty += Number(record.pickQty) || 0
  }

  // 领料数换算系数 + 已报工数：按物料编码处理
  for (const row of rows.values()) {
    const code = String(row.materialCode ?? '').trim()

    // 领料数乘以该物料的换算系数（无配置则为 1）
    row.pickQty *= MATERIAL_COSTING_QTY_FACTORS[code] ?? 1
    // 已报工数按物料编码汇总货物移动数量，先求和再取绝对值
    row.reportedQty = Math.abs(goodsMoveQtyMap.value.get(code) || 0)
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      pickQty: formatQty(row.pickQty),
      reportedQty: formatQty(row.reportedQty),
      unreportedQty: formatQty(row.pickQty - row.reportedQty),
    }))
    .sort((left, right) => left.materialName.localeCompare(right.materialName, 'zh-CN'))
})

// ===== 周统计 =====
// 表头（固定展示项，内容暂为固定值，后续再接入实际数据）
const weeklyColumns = [
  { key: 'name', label: '名称' },
  { key: 'pickQty', label: '原料领用', align: 'right' },
  { key: 'remainingQty', label: '车间剩余', align: 'right' },
  { key: 'actualQty', label: '实际使用', align: 'right' },
  { key: 'unitConsumption', label: '单耗' },
]

// 周统计固定展示项定义（materialCode 为隐藏属性，仅用于查询，不展示）
// unitLabel 为单耗单位；unitFactor 为单耗换算系数（氯铂酸按克计，需 ×1000）；qtyFactor 为领用数量换算系数
const WEEKLY_ROW_DEFINITIONS = [
  { materialCode: '111001787', name: '三氯氢硅（kg）', unitLabel: '吨/吨', unitFactor: 1, qtyFactor: 1 },
  { materialCode: '111001786', name: '电石（kg）', unitLabel: '吨/吨', unitFactor: 1, qtyFactor: 1 },
  { materialCode: '112004292', name: '氯铂酸（g）', unitLabel: '克/吨', unitFactor: 1000, qtyFactor: 20 },
]

// 车间剩余：手动填写（按物料编码存放），默认全部为空，不填显示 /
const weeklyRemaining = ref(
  Object.fromEntries(WEEKLY_ROW_DEFINITIONS.map((row) => [row.materialCode, ''])),
)

// 150产品（HND-V150）物料编码
const WEEKLY_INBOUND_MATERIAL_CODE = '114001897'

// 150产品入库数：按物料编码 + 时间范围，累计入库汇总的数量
const weeklyInboundQty = computed(() => {
  const sum = allInboundRecords.value
    .filter((record) => {
      if (String(record.materialCode ?? '').trim() !== WEEKLY_INBOUND_MATERIAL_CODE) return false

      const inboundDate = getInboundDate(record)
      if (!inboundDate) return true

      return inboundDate >= weeklyStartDate.value && inboundDate <= weeklyEndDate.value
    })
    .reduce((total, record) => total + (Number(record.inboundQty) || 0), 0)

  return formatQty(sum)
})

const weeklyInboundRow = computed(() => ({
  materialCode: WEEKLY_INBOUND_MATERIAL_CODE,
  name: '150产品入库数（kg）',
  value: weeklyInboundQty.value,
}))

// 原料领用：按时间范围 + 物料编码，从领料汇总数据求和
function getWeeklyPickQty(materialCode) {
  const code = String(materialCode ?? '').trim()
  if (!code) return 0

  const sum = allPickRecords.value
    .filter((record) => {
      if (String(record.materialCode ?? '').trim() !== code) return false

      const pickDate = getPickDate(record)
      if (!pickDate) return true

      return pickDate >= weeklyStartDate.value && pickDate <= weeklyEndDate.value
    })
    .reduce((total, record) => total + (Number(record.pickQty) || 0), 0)

  return formatQty(sum)
}

const weeklyRows = computed(() => {
  const inboundQty = weeklyInboundQty.value

  return WEEKLY_ROW_DEFINITIONS.map((row) => {
    // 原料领用：领料汇总求和后乘以该物料的换算系数
    const pickQty = formatQty(getWeeklyPickQty(row.materialCode) * (row.qtyFactor ?? 1))
    // 实际使用 = 原料领用 − 车间剩余（车间剩余未填按 0 计）
    const remainingQty = Number(weeklyRemaining.value[row.materialCode]) || 0
    const actualQty = formatQty(pickQty - remainingQty)

    // 单耗 = 实际使用 / 150产品入库数 × 换算系数（固定保留 2 位小数）
    const unitConsumption = inboundQty > 0
      ? ((actualQty * (row.unitFactor ?? 1)) / inboundQty).toFixed(2)
      : '0.00'

    return {
      ...row,
      pickQty,
      actualQty,
      unitConsumption,
    }
  })
})

const weeklyTableData = ref([])
const weeklyTableDataAll = ref([])
const allWeeklyOrders = ref([])
const weeklyPageNum = ref(1)
const weeklyPageSize = ref(10)
const weeklyTotal = ref(0)
const weeklyLoading = ref(false)
const weeklyError = ref('')
const weeklyStartDate = ref(getLastWeekMonday())
const weeklyEndDate = ref(getLastWeekSunday())

// 标题：按所选日期范围生成，如「9月7日-9月13日周统计（截止9月13日晚8点）」
const weeklyTitle = computed(() => {
  const start = formatMonthDay(weeklyStartDate.value)
  const end = formatMonthDay(weeklyEndDate.value)
  return `${start}-${end}周统计（截止${end}晚8点）`
})
const weeklyImageList = ref([])
const weeklyCurrentIndex = ref(0)
const weeklyCurrentMaterialDesc = ref('')
const weeklyCurrentConfirmedQty = ref('')
const weeklyCurrentOrderNo = ref('')
const weeklyImageDialogVisible = ref(false)
const weeklyImageFileInput = ref(null)
const weeklyImageUploading = ref(false)
const weeklyImageDeleting = ref(false)
const weeklyProductDialogVisible = ref(false)
const weeklyProductFilter = ref('')

const weeklyProductOptions = computed(() => {
  const names = allWeeklyOrders.value
    .filter(matchesWeeklyDateRange)
    .map((order) => String(order.materialDesc ?? '').trim())
    .filter(Boolean)

  return [...new Set(names)].sort((left, right) => left.localeCompare(right, 'zh-CN'))
})

function normalizeWeeklyImage(image) {
  if (typeof image === 'string') {
    return { imageId: image, url: image }
  }

  return {
    imageId: image?.imageId ?? image?.id ?? '',
    url: image?.url ?? image?.imageUrl ?? image?.fileUrl ?? image?.path ?? '',
  }
}

function normalizeWeeklyImageList(images) {
  let imageValues = images

  if (typeof imageValues === 'string') {
    try {
      imageValues = JSON.parse(imageValues)
    } catch {
      imageValues = imageValues ? [imageValues] : []
    }
  }

  if (!Array.isArray(imageValues)) {
    imageValues = imageValues ? [imageValues] : []
  }

  return imageValues.map(normalizeWeeklyImage).filter((image) => image.url)
}

async function refreshWeeklyImageList(order) {
  if (!weeklyCurrentOrderNo.value) {
    weeklyImageList.value = normalizeWeeklyImageList(order?.imageList)
    return
  }

  const res = await request.get('/api/work-order/image/list', {
    params: { orderNo: weeklyCurrentOrderNo.value },
  })
  weeklyImageList.value = normalizeWeeklyImageList(res.data?.data || [])
}

function updateWeeklyOrderImages(images) {
  const normalizedImages = normalizeWeeklyImageList(images)
  const updateImages = (order) => {
    if (String(order.orderNo) === String(weeklyCurrentOrderNo.value)) {
      order.imageList = normalizedImages
    }
  }

  allWeeklyOrders.value.forEach(updateImages)
  weeklyTableDataAll.value.forEach(updateImages)
  weeklyImageList.value = normalizedImages
  filterWeeklyOrders()
}

async function openWeeklyImageDialog(order) {
  weeklyCurrentMaterialDesc.value = order?.materialDesc || '-'
  weeklyCurrentConfirmedQty.value = order?.confirmedQty ?? '-'
  weeklyCurrentOrderNo.value = order?.orderNo || ''
  weeklyImageList.value = normalizeWeeklyImageList(order?.imageList)
  weeklyCurrentIndex.value = 0
  weeklyImageDialogVisible.value = true

  await refreshWeeklyImageList(order)
}

function openWeeklyProductDialog() {
  weeklyProductDialogVisible.value = true
}

function handleWeeklyProductSelected(materialDesc) {
  weeklyProductFilter.value = materialDesc
  weeklyProductDialogVisible.value = false
  filterWeeklyOrders()
}

function clearWeeklyProductFilter() {
  weeklyProductFilter.value = ''
  filterWeeklyOrders()
}

function openWeeklyFilePicker() {
  weeklyImageFileInput.value?.click()
}

function showWeeklyPreviousImage() {
  if (!weeklyImageList.value.length) return
  weeklyCurrentIndex.value =
    (weeklyCurrentIndex.value - 1 + weeklyImageList.value.length) % weeklyImageList.value.length
}

function showWeeklyNextImage() {
  if (!weeklyImageList.value.length) return
  weeklyCurrentIndex.value = (weeklyCurrentIndex.value + 1) % weeklyImageList.value.length
}

async function handleWeeklyImageSelected(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''

  if (!files.length || !weeklyCurrentOrderNo.value) return

  weeklyImageUploading.value = true

  try {
    const formData = new FormData()
    formData.append('orderNo', weeklyCurrentOrderNo.value)
    files.forEach((file) => formData.append('files', file))

    const res = await request.post('/api/work-order/image/upload', formData)
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '图片上传失败。')
    }

    const uploadedImages = normalizeWeeklyImageList(res.data?.data || [])
    if (uploadedImages.length) {
      updateWeeklyOrderImages([...weeklyImageList.value, ...uploadedImages])
      weeklyCurrentIndex.value = weeklyImageList.value.length - 1
    } else {
      await fetchWeeklyOrders()
      const currentOrder = allWeeklyOrders.value.find(
        (order) => String(order.orderNo) === String(weeklyCurrentOrderNo.value),
      )
      await refreshWeeklyImageList(currentOrder)
    }
    ElMessage.success('图片上传成功')
  } catch (error) {
    ElMessage.error(error.response?.data?.msg || error.message || '图片上传失败，请重试。')
  } finally {
    weeklyImageUploading.value = false
  }
}

async function deleteWeeklyImage(image) {
  if (!weeklyCurrentOrderNo.value || !image?.imageId) return

  try {
    await ElMessageBox.confirm(
      '删除后将无法在当前工单中查看该图片，是否继续？',
      '确认删除图片',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  weeklyImageDeleting.value = true

  try {
    const res = await request.delete('/api/work-order/image/delete', {
      params: { imageId: image.imageId },
      data: { imageId: image.imageId },
    })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '图片删除失败。')
    }

    const remainingImages = weeklyImageList.value.filter(
      (item) => String(item.imageId) !== String(image.imageId),
    )
    updateWeeklyOrderImages(remainingImages)
    if (weeklyCurrentIndex.value >= weeklyImageList.value.length) {
      weeklyCurrentIndex.value = Math.max(0, weeklyImageList.value.length - 1)
    }
    ElMessage.success('图片已删除')
  } catch (error) {
    ElMessage.error(error.response?.data?.msg || error.message || '图片删除失败，请重试。')
  } finally {
    weeklyImageDeleting.value = false
  }
}

function getWeeklyPageData(page = weeklyPageNum.value) {
  weeklyPageNum.value = page
  const startIndex = (weeklyPageNum.value - 1) * weeklyPageSize.value
  const endIndex = startIndex + weeklyPageSize.value
  weeklyTableData.value = weeklyTableDataAll.value.slice(startIndex, endIndex)
}

function getWeeklyCellValue(row, columnKey, index) {
  if (columnKey === 'index') {
    return (weeklyPageNum.value - 1) * weeklyPageSize.value + index + 1
  }
  return row?.[columnKey] ?? ''
}

function normalizeWeeklyOrder(item) {
  if (!item) return null
  const order = item.workOrder
    ? { ...item.workOrder, ...item }
    : { ...item }
  order.imageList = normalizeWeeklyImageList(order.imageList)
  return order
}

function getWeeklyOrderDate(order) {
  return String(order?.planStartDate || '').slice(0, 10)
}

function sortWeeklyOrders(orders) {
  return [...orders].sort((left, right) => {
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

function matchesWeeklyDateRange(order) {
  const planStartDate = getWeeklyOrderDate(order)
  if (!planStartDate) return false
  return planStartDate >= weeklyStartDate.value && planStartDate <= weeklyEndDate.value
}

function matchesWeeklyProductFilter(order) {
  if (!weeklyProductFilter.value) return true
  return String(order.materialDesc ?? '').trim() === weeklyProductFilter.value
}

function filterWeeklyOrders() {
  weeklyTableDataAll.value = allWeeklyOrders.value.filter(
    (order) => matchesWeeklyDateRange(order) && matchesWeeklyProductFilter(order),
  )

  weeklyTotal.value = weeklyTableDataAll.value.length
  weeklyPageNum.value = 1
  getWeeklyPageData()
}

async function fetchWeeklyOrders() {
  weeklyLoading.value = true
  weeklyError.value = ''

  try {
    const res = await request.get('/api/work-order/list')
    if (res.data.success === true) {
      const dataList = Array.isArray(res.data.dataList)
        ? res.data.dataList.map(normalizeWeeklyOrder).filter(Boolean)
        : []

      allWeeklyOrders.value = sortWeeklyOrders(dataList)
      filterWeeklyOrders()
    } else {
      allWeeklyOrders.value = []
      weeklyTableDataAll.value = []
      weeklyTableData.value = []
      weeklyTotal.value = 0
      weeklyError.value = res.data.msg || '工单接口返回异常，请稍后重试。'
    }
  } catch (error) {
    allWeeklyOrders.value = []
    weeklyTableDataAll.value = []
    weeklyTableData.value = []
    weeklyTotal.value = 0
    weeklyError.value = error.response?.data?.msg || '工单数据加载失败，请稍后重试。'
  } finally {
    weeklyLoading.value = false
  }
}

// ===== 储罐体积计算 =====
// 储罐配置：新增储罐只需在数组里加一项
// imageBounds 为底图中罐体的像素边界（由图像分析 + 轮廓叠加验证得出）
const VESSELS = [
  {
    key: 'silane',
    type: 'horizontal',
    label: '三氯氢硅储罐A/B示意图',
    diameter: 2800, // 筒体内径 φ2.8m
    cylinderLength: 5500, // 筒体长度 l=5.5m
    straightFlange: 40, // 封头直边 0.04m
    headDepth: 700, // 封头曲面内高度 hi=0.7m
    image: vesselImageUrl,
    imageBounds: { width: 2150, height: 1060, left: 75, right: 2069, top: 131, bottom: 931 },
    displayWidth: 680,
    liquid: { fill: 'rgba(208, 226, 128, 0.28)', line: '#a6cb3c' }, // 浅黄绿（氯系介质特征色，柔和不刺眼）
  },
  {
    key: 'product150',
    type: 'vertical',
    label: '150产品储罐示意图',
    diameter: 3600, // 筒体内径 φ3.6m
    cylinderHeight: 4800, // 筒体高度 4.8m
    headDepth: 900, // 顶部封头曲面内高度 0.9m
    image: vesselProduct150ImageUrl,
    imageBounds: { width: 1760, height: 1938, left: 131, right: 1351, top: 63, tangent: 310, bottom: 1930 },
    displayWidth: 420,
    liquid: { fill: 'rgba(0, 255, 255, 0.4)', line: '#00ffff' },
  },
]

const vesselKey = ref(VESSELS[0].key)
const selectedVessel = computed(
  () => VESSELS.find((item) => item.key === vesselKey.value) ?? VESSELS[0],
)

// 当前储罐的几何参数（统一两种罐型的字段）
const vesselGeometry = computed(() => {
  const vessel = selectedVessel.value

  if (vessel.type === 'vertical') {
    return {
      type: 'vertical',
      diameter: vessel.diameter,
      radius: vessel.diameter / 2,
      cylinderHeight: vessel.cylinderHeight,
      headDepth: vessel.headDepth,
      maxLevel: vessel.cylinderHeight + vessel.headDepth,
      imageBounds: vessel.imageBounds,
      displayWidth: vessel.displayWidth ?? 680,
      liquid: vessel.liquid,
    }
  }

  const headTotal = vessel.straightFlange + vessel.headDepth
  return {
    type: 'horizontal',
    diameter: vessel.diameter,
    radius: vessel.diameter / 2,
    cylinderLength: vessel.cylinderLength,
    straightFlange: vessel.straightFlange,
    headDepth: vessel.headDepth,
    headTotal,
    totalLength: vessel.cylinderLength + 2 * headTotal,
    maxLevel: vessel.diameter,
    imageBounds: vessel.imageBounds,
      displayWidth: vessel.displayWidth ?? 680,
      liquid: vessel.liquid,
  }
})

const vesselLevel = ref(1400)
const vesselDisplayLevel = ref(1400) // 动画中的实时液位
const vesselCanvas = ref(null)
const vesselImage = ref(null)

// 液体体积（mm³）—— 闭式解，依据工艺核算公式：
//   V(h) = L[ πr²/2 − (r−h)√(2rh−h²) − r²·arcsin((r−h)/r) ]
//        + (π·hi)/(3r) · [ 3r²h − r³ + (r−h)³ ]
// 第一项为筒体（含两端直边）内液体体积，第二项为两端椭圆封头曲面内液体体积合计
function liquidVolumeMm3(depth, geometry) {
  const r = geometry.radius
  const h = Math.max(0, Math.min(geometry.maxLevel, Number(depth) || 0))
  if (h <= 0) return 0

  // 立式储罐：筒体为等径圆柱，顶部为半椭球封头
  //   V = πr²h（筒体段） + πr²[ t − t³/(3hi²) ]（封头段，t = h − 筒体高度）
  if (geometry.type === 'vertical') {
    const cylinderPart = Math.PI * r * r * Math.min(h, geometry.cylinderHeight)
    if (h <= geometry.cylinderHeight) return cylinderPart

    const t = h - geometry.cylinderHeight
    const hi = geometry.headDepth
    const headPart = Math.PI * r * r * (t - Math.pow(t, 3) / (3 * hi * hi))
    return cylinderPart + headPart
  }

  // 卧式储罐：闭式解，依据工艺核算公式
  const straightLength = geometry.cylinderLength + 2 * geometry.straightFlange
  const sqrtTerm = Math.sqrt(Math.max(0, 2 * r * h - h * h))
  const asinTerm = Math.asin(Math.max(-1, Math.min(1, (r - h) / r)))

  const cylinder =
    straightLength * ((Math.PI * r * r) / 2 - (r - h) * sqrtTerm - r * r * asinTerm)
  const heads =
    ((Math.PI * geometry.headDepth) / (3 * r)) *
    (3 * r * r * h - Math.pow(r, 3) + Math.pow(r - h, 3))

  return cylinder + heads
}

const vesselVolume = computed(
  () => liquidVolumeMm3(vesselDisplayLevel.value, vesselGeometry.value) / 1e9,
)
const vesselCapacity = computed(
  () => liquidVolumeMm3(vesselGeometry.value.maxLevel, vesselGeometry.value) / 1e9,
)

// 规格说明（随所选储罐变化）
const vesselDescription = computed(() => {
  const g = vesselGeometry.value
  const m = (value) => (value / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  const capacity = vesselCapacity.value.toFixed(1)

  if (g.type === 'vertical') {
    return `筒体 φ${m(g.diameter)}m，筒体高度 ${m(g.cylinderHeight)}m，封头内高度 ${m(g.headDepth)}m，总容积 ${capacity} m³`
  }

  return `筒体 l=${m(g.cylinderLength)}m，φ${m(g.diameter)}m，直边 ${m(g.straightFlange)}m，封头内高度 hi=${m(g.headDepth)}m，总容积 ${capacity} m³`
})

// 水波纹参数
const VESSEL_WAVE = {
  amplitude: 3.5, // 波幅（画布像素）
  wavelength: 120, // 波长（画布像素）
  speed: 0.04, // 相位推进速度（弧度 / 60fps 帧），约 2.6 秒一个周期
}

let vesselFrameId = null
let vesselWavePhase = 0
let vesselLastFrameTime = 0
let vesselTransition = null // 液位缓动过渡状态

function stopVesselLoop() {
  if (vesselFrameId !== null) {
    cancelAnimationFrame(vesselFrameId)
    vesselFrameId = null
  }
  vesselLastFrameTime = 0
}

// 单帧：推进液位缓动 + 波纹相位，然后重绘
function vesselFrame(now) {
  // 按真实时间推进，避免不同刷新率下速度不一致
  const deltaMs = vesselLastFrameTime ? Math.min(50, now - vesselLastFrameTime) : 16.7
  vesselLastFrameTime = now

  if (vesselTransition) {
    const progress = Math.min(1, (now - vesselTransition.startTime) / vesselTransition.duration)
    const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic：起步快、接近目标时放缓

    vesselDisplayLevel.value = vesselTransition.from + vesselTransition.delta * eased

    if (progress >= 1) {
      vesselDisplayLevel.value = vesselTransition.from + vesselTransition.delta
      vesselTransition = null
    }
  }

  vesselWavePhase += VESSEL_WAVE.speed * (deltaMs / 16.7)
  renderVessel()

  // 切到其他 Tab 时自动停帧，不浪费性能
  if (activeTab.value === 'vessel') {
    vesselFrameId = requestAnimationFrame(vesselFrame)
  } else {
    vesselFrameId = null
  }
}

function startVesselLoop() {
  if (vesselFrameId === null && activeTab.value === 'vessel') {
    vesselFrameId = requestAnimationFrame(vesselFrame)
  }
}

// 液位平滑过渡到目标值（时长随变化幅度自适应，700~2000ms）
function animateVesselTo(target) {
  const from = vesselDisplayLevel.value
  const delta = target - from

  if (Math.abs(delta) < 0.5) {
    vesselDisplayLevel.value = target
    vesselTransition = null
    renderVessel()
    return
  }

  vesselTransition = {
    from,
    delta,
    duration: 700 + (Math.abs(delta) / vesselGeometry.value.maxLevel) * 1300,
    startTime: performance.now(),
  }

  startVesselLoop()
}

// 底图：卧式椭圆封头储罐图纸
// 罐体在底图中的像素边界（由图像分析 + 轮廓叠加验证得出，横纵比例尺一致：0.28567 px/mm）

// 绘制罐体底图与液位填充
function renderVessel() {
  const canvas = vesselCanvas.value
  if (!canvas) return

  const image = vesselImage.value
  if (!image) return

  const geometry = vesselGeometry.value
  const bounds = geometry.imageBounds
  const dpr = window.devicePixelRatio || 1

  // 画布尺寸按底图比例自适应
  const W = 1075
  const H = Math.round((W * bounds.height) / bounds.width)

  canvas.width = W * dpr
  canvas.height = H * dpr

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(image, 0, 0, W, H)

  const s = W / bounds.width
  const vesselPath = new Path2D()
  let tankLeft
  let tankRight
  let bottomY
  let levelY

  if (geometry.type === 'vertical') {
    // 立式罐：顶部半椭球封头 + 等径筒体
    const left = bounds.left * s
    const right = bounds.right * s
    const tangentY = bounds.tangent * s
    const bottom = bounds.bottom * s
    const cx = (left + right) / 2
    const rx = (right - left) / 2
    const ry = tangentY - bounds.top * s

    vesselPath.moveTo(left, tangentY)
    vesselPath.ellipse(cx, tangentY, rx, ry, 0, Math.PI, Math.PI * 2)
    vesselPath.lineTo(right, bottom)
    vesselPath.lineTo(left, bottom)
    vesselPath.closePath()

    tankLeft = left
    tankRight = right
    bottomY = bottom

    // 液位映射：筒体段、封头段分别对应底图中各自的高度
    // （底图封头绘制得比实际略扁，分段映射可保证液面始终贴合图纸结构）
    const level = vesselDisplayLevel.value
    const apexY = bounds.top * s

    if (level <= geometry.cylinderHeight) {
      levelY = bottom - (level / geometry.cylinderHeight) * (bottom - tangentY)
    } else {
      const t = Math.min(geometry.headDepth, level - geometry.cylinderHeight)
      levelY = tangentY - (t / geometry.headDepth) * (tangentY - apexY)
    }
  } else {
    // 卧式罐：椭圆封头曲面 + 直边 + 圆筒
    const R = ((bounds.bottom - bounds.top) / 2) * s
    const cy = ((bounds.top + bounds.bottom) / 2) * s
    const hiPx = (geometry.headDepth / geometry.diameter) * 2 * R // 曲面深度
    const flangePx = (geometry.straightFlange / geometry.diameter) * 2 * R // 直边
    const xEllipseLeft = bounds.left * s + hiPx
    const xEllipseRight = bounds.right * s - hiPx
    const xCylLeft = xEllipseLeft + flangePx
    const bottom = bounds.bottom * s

    vesselPath.moveTo(xCylLeft, cy - R)
    vesselPath.lineTo(xEllipseRight, cy - R)
    vesselPath.ellipse(xEllipseRight, cy, hiPx, R, 0, -Math.PI / 2, Math.PI / 2)
    vesselPath.lineTo(xEllipseLeft, cy + R)
    vesselPath.ellipse(xEllipseLeft, cy, hiPx, R, 0, Math.PI / 2, Math.PI * 1.5)
    vesselPath.closePath()

    tankLeft = bounds.left * s
    tankRight = bounds.right * s
    bottomY = bottom
    levelY = bottom - (vesselDisplayLevel.value / geometry.diameter) * 2 * R
  }

  // 液位填充：以正弦波纹作为液面，裁剪到罐体内腔轮廓
  if (vesselDisplayLevel.value > 0) {
    const span = tankRight - tankLeft
    const steps = 140
    const wavePoints = []

    for (let i = 0; i <= steps; i += 1) {
      const x = tankLeft + (span * i) / steps
      const phase = ((x - tankLeft) / VESSEL_WAVE.wavelength) * Math.PI * 2 + vesselWavePhase
      wavePoints.push([x, levelY + Math.sin(phase) * VESSEL_WAVE.amplitude])
    }

    // 填充区：波纹 + 下边界闭合
    const fillPath = new Path2D()
    wavePoints.forEach(([x, y], i) => (i === 0 ? fillPath.moveTo(x, y) : fillPath.lineTo(x, y)))
    fillPath.lineTo(tankRight, bottomY + 6)
    fillPath.lineTo(tankLeft, bottomY + 6)
    fillPath.closePath()

    // 液面线：只描波纹本身
    const surfacePath = new Path2D()
    wavePoints.forEach(([x, y], i) =>
      (i === 0 ? surfacePath.moveTo(x, y) : surfacePath.lineTo(x, y)),
    )

    ctx.save()
    ctx.clip(vesselPath)
    ctx.fillStyle = geometry.liquid.fill
    ctx.fill(fillPath)

    ctx.strokeStyle = geometry.liquid.line
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke(surfacePath)
    ctx.restore()
  }
}

watch(vesselLevel, (value) => {
  const maxLevel = vesselGeometry.value.maxLevel
  const clamped = Math.max(0, Math.min(maxLevel, Number(value) || 0))
  if (clamped !== value) {
    vesselLevel.value = clamped
    return
  }
  animateVesselTo(clamped)
})

// 切换储罐：液位按新罐径钳制、底图按需重载
let loadedVesselImageUrl = ''

function loadVesselImage() {
  const url = selectedVessel.value.image
  if (loadedVesselImageUrl === url && vesselImage.value) {
    renderVessel()
    return
  }

  loadedVesselImageUrl = url
  const image = new Image()
  image.onload = () => {
    vesselImage.value = image
    renderVessel()
  }
  image.src = url
}

watch(vesselKey, () => {
  const maxLevel = vesselGeometry.value.maxLevel
  if (vesselLevel.value > maxLevel) vesselLevel.value = maxLevel
  if (vesselDisplayLevel.value > maxLevel) {
    vesselDisplayLevel.value = maxLevel
    vesselTransition = null
  }
  loadVesselImage()
})

onMounted(() => {
  fetchWorkOrders()
  fetchPickRecords()
  fetchInboundRecords()
  fetchGoodsMoveRecords()

  // 加载罐体底图后再绘制液位
  loadVesselImage()
})

onUnmounted(stopVesselLoop)

// 切到压力容器 Tab 时启动波纹动画，离开时停帧
watch(activeTab, (tab) => {
  if (tab === 'vessel') {
    startVesselLoop()
  } else {
    stopVesselLoop()
  }
})
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-7xl">
      <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">Factory Operations</p>
          <h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">工单汇总</h1>
          <p class="mt-2 text-sm text-slate-500">查看当前所有生产工单及处理状态</p>
        </div>
        <div class="text-sm text-slate-500">
          共 <span class="font-semibold text-slate-900">{{ total }}</span> 条工单
        </div>
      </header>

      <nav class="mb-6 flex gap-8 border-b border-slate-200" aria-label="页面切换">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="relative pb-3 pt-1 text-sm font-medium transition focus:outline-none"
          :class="activeTab === tab.key ? 'text-sky-600' : 'text-slate-500 hover:text-slate-700'"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span
            v-if="activeTab === tab.key"
            class="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-sky-600"
            aria-hidden="true"
          ></span>
        </button>
      </nav>

      <div v-show="activeTab === 'workOrder'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
            <el-date-picker
              v-model="startDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="起始日期"
              :first-day-of-week="1"
              @change="filterWorkOrders"
            />
            <span class="text-sm text-slate-500">至</span>
            <el-date-picker
              v-model="endDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              :first-day-of-week="1"
              @change="filterWorkOrders"
            />
          </div>

          <div class="relative">
            <div v-if="loading" class="loading-mask" aria-label="正在加载工单">
          <div class="loader" role="status" aria-label="正在加载">
            <div class="loader-text">Loading...</div>
            <div class="loader-bar"></div>
          </div>
        </div>

        <div v-else-if="errorMessage" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">!</div>
          <h2 class="text-base font-semibold text-slate-900">暂时无法获取工单</h2>
          <p class="mt-2 text-sm text-slate-500">{{ errorMessage }}</p>
          <button
            type="button"
            class="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            @click="fetchWorkOrders"
          >
            重新加载
          </button>
        </div>

        <div v-else-if="tableData.length === 0 && !productFilter && !orderTypeFilter && !orderNoFilter" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600">∅</div>
          <h2 class="text-base font-semibold text-slate-900">暂无工单数据</h2>
          <p class="mt-2 text-sm text-slate-500">当前没有可展示的工单记录</p>
        </div>

        <div v-else>
          <div class="overflow-x-auto">
            <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
              <colgroup>
                <col v-for="column in columns" :key="column.key" :class="column.width" />
              </colgroup>
              <thead class="bg-slate-50">
                <tr>
                  <th
                    v-for="column in columns"
                    :key="column.key"
                    scope="col"
                    class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                  >
                    <template v-if="column.key === 'orderNo'">
                      <span class="inline-flex items-center gap-1">
                        <button
                          type="button"
                          class="inline-flex max-w-[130px] items-center gap-1 rounded transition hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                          :class="orderNoFilter ? 'text-sky-600' : ''"
                          :title="orderNoFilter ? `已筛选：${orderNoFilter}` : '点击选择工单号'"
                          @click="openOrderNoDialog"
                        >
                          <span class="truncate">{{ orderNoFilter || column.label }}</span>
                          <svg
                            class="h-3.5 w-3.5 shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                          </svg>
                        </button>
                        <button
                          v-if="orderNoFilter"
                          type="button"
                          class="rounded px-1 text-slate-400 transition hover:text-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                          aria-label="清除工单号筛选"
                          @click="clearOrderNoFilter"
                        >
                          ×
                        </button>
                      </span>
                    </template>
                    <template v-else-if="column.key === 'orderType'">
                      <span class="inline-flex items-center gap-1">
                        <button
                          type="button"
                          class="inline-flex max-w-[110px] items-center gap-1 rounded transition hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                          :class="orderTypeFilter ? 'text-sky-600' : ''"
                          :title="orderTypeFilter ? `已筛选：${orderTypeFilter}` : '点击选择工单类型'"
                          @click="openOrderTypeDialog"
                        >
                          <span class="truncate">{{ orderTypeFilter || column.label }}</span>
                          <svg
                            class="h-3.5 w-3.5 shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                          </svg>
                        </button>
                        <button
                          v-if="orderTypeFilter"
                          type="button"
                          class="rounded px-1 text-slate-400 transition hover:text-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                          aria-label="清除工单类型筛选"
                          @click="clearOrderTypeFilter"
                        >
                          ×
                        </button>
                      </span>
                    </template>
                    <template v-else-if="column.key === 'materialDesc'">
                      <span class="inline-flex items-center gap-1">
                        <button
                          type="button"
                          class="inline-flex max-w-[110px] items-center gap-1 rounded transition hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                          :class="productFilter ? 'text-sky-600' : ''"
                          :title="productFilter ? `已筛选：${productFilter}` : '点击选择产成品'"
                          @click="openProductDialog"
                        >
                          <span class="truncate">{{ productFilter || column.label }}</span>
                          <svg
                            class="h-3.5 w-3.5 shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                          </svg>
                        </button>
                        <button
                          v-if="productFilter"
                          type="button"
                          class="rounded px-1 text-slate-400 transition hover:text-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                          aria-label="清除产成品筛选"
                          @click="clearProductFilter"
                        >
                          ×
                        </button>
                      </span>
                    </template>
                    <template v-else>{{ column.label }}</template>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 bg-white">
                <tr v-if="tableData.length === 0">
                  <td :colspan="columns.length" class="px-3 py-16 text-center text-sm text-slate-400">
                    没有符合筛选条件的工单
                  </td>
                </tr>
                <tr v-for="(order, index) in tableData" :key="`${order.orderNo}-${index}`" class="transition hover:bg-slate-50">
                  <td class="whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ (pageNum - 1) * pageSize + index + 1 }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ order.planStartDate }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ order.orderNo }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ getReportOrderType(order.orderNo) }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ order.materialCode }}</td>
                  <td class="max-w-[180px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                    {{ order.materialDesc }}
                  </td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ order.orderQty }}</td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ order.confirmedQty }}</td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ order.deliveredQty }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex justify-end border-t border-slate-100 px-6 py-4">
            <el-pagination
              v-model:current-page="pageNum"
              :page-size="pageSize"
              :total="total"
              layout="total, prev, pager, next"
              background
              @current-change="getPageData"
            />
          </div>
        </div>
          </div>
        </section>

      <el-dialog
        v-model="imageDialogVisible"
        width="80vw"
        class="image-preview-dialog"
        align-center
      >
        <template #header>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-1 pr-6 text-sm text-slate-700">
            <span>物料描述：{{ currentMaterialDesc }}</span>
            <span>确认的产量：{{ currentConfirmedQty }}</span>
          </div>
        </template>

        <div class="flex min-h-[520px] items-center gap-4 overflow-x-auto rounded-lg bg-slate-50 p-6">
          <div v-if="imageList.length" class="relative flex w-full items-center justify-center">
            <el-button
              v-if="imageList.length > 1"
              circle
              class="absolute left-2 z-10"
              aria-label="上一张"
              @click="showPreviousImage"
            >
              ‹
            </el-button>
            <img
              :src="imageList[currentIndex].url"
              alt="物料原图"
              class="max-h-[70vh] max-w-[85%] rounded-lg object-contain"
            />
            <el-button
              v-if="imageList.length > 1"
              circle
              class="absolute right-2 z-10"
              aria-label="下一张"
              @click="showNextImage"
            >
              ›
            </el-button>
            <el-button
              type="danger"
              size="small"
              class="absolute bottom-2 left-1/2 -translate-x-1/2"
              :loading="imageDeleting"
              @click="deleteImage(imageList[currentIndex])"
            >
              删除当前图片
            </el-button>
          </div>
          <span v-if="!imageList.length" class="w-full text-center text-sm text-slate-400">
            暂无图片
          </span>
        </div>

        <div v-if="imageList.length" class="mt-3 text-center text-sm text-slate-500">
          第 {{ currentIndex + 1 }} 张 / 共 {{ imageList.length }} 张
        </div>

        <template #footer>
          <div class="flex justify-end gap-3">
            <input
              ref="imageFileInput"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="handleImageSelected"
            />
            <el-button :loading="imageUploading" @click="openFilePicker">
              添加图片
            </el-button>
          </div>
        </template>
      </el-dialog>

      <ProductSelectDialog
        v-model="productDialogVisible"
        :options="productOptions"
        :selected="productFilter"
        @select="handleProductSelected"
      />

      <ProductSelectDialog
        v-model="orderTypeDialogVisible"
        :options="orderTypeOptions"
        :selected="orderTypeFilter"
        label="工单类型"
        @select="handleOrderTypeSelected"
      />

      <ProductSelectDialog
        v-model="orderNoDialogVisible"
        :options="orderNoOptions"
        :selected="orderNoFilter"
        label="工单号"
        @select="handleOrderNoSelected"
      />
      </div>

      <div v-show="activeTab === 'material'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-2.5">
            <el-date-picker
              v-model="pickStartDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="起始日期"
              :first-day-of-week="1"
              @change="filterPickRecords"
            />
            <span class="text-sm text-slate-500">至</span>
            <el-date-picker
              v-model="pickEndDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              :first-day-of-week="1"
              @change="filterPickRecords"
            />
            <span class="ml-auto text-sm text-slate-500">
              共 <span class="font-semibold text-slate-900">{{ pickTotal }}</span> 条记录
            </span>
          </div>

          <div class="relative">
            <div v-if="pickLoading" class="loading-mask" aria-label="正在加载领料汇总">
              <div class="loader" role="status" aria-label="正在加载">
                <div class="loader-text">Loading...</div>
                <div class="loader-bar"></div>
              </div>
            </div>

            <div v-else-if="pickError" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">!</div>
              <h2 class="text-base font-semibold text-slate-900">暂时无法获取领料汇总</h2>
              <p class="mt-2 text-sm text-slate-500">{{ pickError }}</p>
              <button
                type="button"
                class="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                @click="fetchPickRecords"
              >
                重新加载
              </button>
            </div>

            <div v-else-if="pickTableData.length === 0" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600">∅</div>
              <h2 class="text-base font-semibold text-slate-900">暂无领料数据</h2>
              <p class="mt-2 text-sm text-slate-500">当前没有可展示的领料记录</p>
            </div>

            <div v-else>
              <div class="overflow-x-auto">
                <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
                  <colgroup>
                    <col v-for="column in pickColumns" :key="column.key" :class="column.width" />
                  </colgroup>
                  <thead class="bg-slate-50">
                    <tr>
                      <th
                        v-for="column in pickColumns"
                        :key="column.key"
                        scope="col"
                        class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                        :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                      >
                        {{ column.label }}
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 bg-white">
                    <tr
                      v-for="(record, index) in pickTableData"
                      :key="`${record.materialCode}-${record.pickDate}-${index}`"
                      class="transition hover:bg-slate-50"
                    >
                      <td class="whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ (pickPageNum - 1) * pickPageSize + index + 1 }}</td>
                      <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.pickDate }}</td>
                      <td class="max-w-[200px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                        {{ record.materialName }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.materialCode }}</td>
                      <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ record.pickQty }}</td>
                      <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.unit }}</td>
                      <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
                        <span
                          v-if="record.imageUrl"
                          class="inline-block cursor-pointer"
                          @click="openPickImageDialog(record)"
                        >
                          <img
                            :src="record.imageUrl"
                            alt="领料单据"
                            class="h-5 w-5 rounded border border-slate-200 object-cover transition hover:opacity-80"
                          />
                        </span>
                        <span
                          v-else
                          class="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-slate-400"
                          aria-label="暂无图片"
                        >
                          <svg
                            class="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            aria-hidden="true"
                          >
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="m21 15-5-5L5 21" />
                          </svg>
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="flex justify-end border-t border-slate-100 px-6 py-2.5">
                <el-pagination
                  v-model:current-page="pickPageNum"
                  :page-size="pickPageSize"
                  :total="pickTotal"
                  layout="total, prev, pager, next"
                  background
                  @current-change="getPickPageData"
                />
              </div>
            </div>
          </div>
        </section>

        <el-dialog
          v-model="pickImageDialogVisible"
          width="70vw"
          align-center
        >
          <div class="flex min-h-[400px] items-center justify-center rounded-lg bg-slate-50 p-6">
            <img
              v-if="currentPickImage"
              :src="currentPickImage"
              alt="领料单据大图"
              class="max-h-[70vh] max-w-full rounded-lg object-contain"
            />
          </div>
        </el-dialog>
      </div>

      <div v-show="activeTab === 'inbound'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-2.5">
            <el-date-picker
              v-model="inboundStartDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="起始日期"
              :first-day-of-week="1"
              @change="filterInboundRecords"
            />
            <span class="text-sm text-slate-500">至</span>
            <el-date-picker
              v-model="inboundEndDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              :first-day-of-week="1"
              @change="filterInboundRecords"
            />
            <span class="ml-auto text-sm text-slate-500">
              共 <span class="font-semibold text-slate-900">{{ inboundTotal }}</span> 条记录
            </span>
          </div>

          <div class="relative">
            <div v-if="inboundLoading" class="loading-mask" aria-label="正在加载入库汇总">
              <div class="loader" role="status" aria-label="正在加载">
                <div class="loader-text">Loading...</div>
                <div class="loader-bar"></div>
              </div>
            </div>

            <div v-else-if="inboundError" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">!</div>
              <h2 class="text-base font-semibold text-slate-900">暂时无法获取入库汇总</h2>
              <p class="mt-2 text-sm text-slate-500">{{ inboundError }}</p>
              <button
                type="button"
                class="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                @click="fetchInboundRecords"
              >
                重新加载
              </button>
            </div>

            <div v-else-if="inboundTableData.length === 0" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600">∅</div>
              <h2 class="text-base font-semibold text-slate-900">暂无入库数据</h2>
              <p class="mt-2 text-sm text-slate-500">当前没有可展示的入库记录</p>
            </div>

            <div v-else>
              <div class="overflow-x-auto">
                <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
                  <colgroup>
                    <col v-for="column in inboundColumns" :key="column.key" :class="column.width" />
                  </colgroup>
                  <thead class="bg-slate-50">
                    <tr>
                      <th
                        v-for="column in inboundColumns"
                        :key="column.key"
                        scope="col"
                        class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                        :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                      >
                        {{ column.label }}
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 bg-white">
                    <tr
                      v-for="(record, index) in inboundTableData"
                      :key="`${record.materialCode}-${record.inboundDate}-${index}`"
                      class="transition hover:bg-slate-50"
                    >
                      <td class="whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ (inboundPageNum - 1) * inboundPageSize + index + 1 }}</td>
                      <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.inboundDate }}</td>
                      <td class="max-w-[200px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                        {{ record.materialName }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.materialCode }}</td>
                      <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ record.inboundQty }}</td>
                      <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.unit }}</td>
                      <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">
                        <span
                          v-if="record.imageUrl"
                          class="inline-block cursor-pointer"
                          @click="openInboundImageDialog(record)"
                        >
                          <img
                            :src="record.imageUrl"
                            alt="入库单据"
                            class="h-5 w-5 rounded border border-slate-200 object-cover transition hover:opacity-80"
                          />
                        </span>
                        <span
                          v-else
                          class="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-slate-400"
                          aria-label="暂无图片"
                        >
                          <svg
                            class="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            aria-hidden="true"
                          >
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="m21 15-5-5L5 21" />
                          </svg>
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="flex justify-end border-t border-slate-100 px-6 py-2.5">
                <el-pagination
                  v-model:current-page="inboundPageNum"
                  :page-size="inboundPageSize"
                  :total="inboundTotal"
                  layout="total, prev, pager, next"
                  background
                  @current-change="getInboundPageData"
                />
              </div>
            </div>
          </div>
        </section>

        <el-dialog
          v-model="inboundImageDialogVisible"
          width="70vw"
          align-center
        >
          <div class="flex min-h-[400px] items-center justify-center rounded-lg bg-slate-50 p-6">
            <img
              v-if="currentInboundImage"
              :src="currentInboundImage"
              alt="入库单据大图"
              class="max-h-[70vh] max-w-full rounded-lg object-contain"
            />
          </div>
        </el-dialog>
      </div>

      <div v-show="activeTab === 'report'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
              <colgroup>
                <col v-for="column in reportColumns" :key="column.key" :class="column.width" />
              </colgroup>
              <thead class="bg-slate-50">
                <tr>
                  <th
                    v-for="column in reportColumns"
                    :key="column.key"
                    scope="col"
                    class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                  >
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 bg-white">
                <tr v-if="reportRows.length === 0">
                  <td :colspan="reportColumns.length" class="px-3 py-16 text-center text-sm text-slate-400">
                    暂无报工数据
                  </td>
                </tr>
                <tr
                  v-for="(item, index) in reportRows"
                  :key="`${item.orderType}-${item.materialDesc}-${index}`"
                  class="transition hover:bg-slate-50"
                >
                  <td class="whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ index + 1 }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ item.orderType }}</td>
                  <td class="max-w-[200px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                    {{ item.materialDesc }}
                  </td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.orderQty }}</td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.confirmedQty }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'costing'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
              <colgroup>
                <col v-for="column in costingColumns" :key="column.key" :class="column.width" />
              </colgroup>
              <thead class="bg-slate-50">
                <tr>
                  <th
                    v-for="column in costingColumns"
                    :key="column.key"
                    scope="col"
                    class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                  >
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 bg-white">
                <tr v-if="costingRows.length === 0">
                  <td :colspan="costingColumns.length" class="px-3 py-16 text-center text-sm text-slate-400">
                    暂无核算数据
                  </td>
                </tr>
                <tr
                  v-for="(item, index) in costingRows"
                  :key="`${item.materialName}-${index}`"
                  class="transition hover:bg-slate-50"
                >
                  <td class="whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ index + 1 }}</td>
                  <td class="max-w-[240px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                    {{ item.materialName }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ item.materialCode }}</td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.inboundQty }}</td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.reportedQty }}</td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm font-semibold text-sky-700">{{ item.unreportedQty }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'materialCosting'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
              <colgroup>
                <col v-for="column in materialCostingColumns" :key="column.key" :class="column.width" />
              </colgroup>
              <thead class="bg-slate-50">
                <tr>
                  <th
                    v-for="column in materialCostingColumns"
                    :key="column.key"
                    scope="col"
                    class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                  >
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 bg-white">
                <tr v-if="materialCostingRows.length === 0">
                  <td :colspan="materialCostingColumns.length" class="px-3 py-16 text-center text-sm text-slate-400">
                    暂无核算数据
                  </td>
                </tr>
                <tr
                  v-for="(item, index) in materialCostingRows"
                  :key="`${item.materialName}-${index}`"
                  class="transition hover:bg-slate-50"
                >
                  <td class="whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ index + 1 }}</td>
                  <td class="max-w-[240px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                    {{ item.materialName }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ item.materialCode }}</td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.pickQty }}</td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.reportedQty }}</td>
                  <td class="whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm font-semibold text-sky-700">{{ item.unreportedQty }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'weekly'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
            <el-date-picker
              v-model="weeklyStartDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="起始日期"
              :first-day-of-week="1"
              @change="filterWeeklyOrders"
            />
            <span class="text-sm text-slate-500">至</span>
            <el-date-picker
              v-model="weeklyEndDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              :first-day-of-week="1"
              @change="filterWeeklyOrders"
            />
          </div>

          <div class="p-6">
            <div class="overflow-x-auto">
              <table class="w-full table-fixed border-collapse text-center">
                <colgroup>
                  <col class="w-[220px]" />
                  <col class="w-32" />
                  <col class="w-32" />
                  <col class="w-32" />
                  <col class="w-32" />
                </colgroup>
                <thead>
                  <tr>
                    <th colspan="5" class="border border-slate-300 px-3 py-2 text-base font-bold tracking-wide text-slate-800">
                      {{ weeklyTitle }}
                    </th>
                  </tr>
                  <tr>
                    <th
                      v-for="column in weeklyColumns"
                      :key="column.key"
                      scope="col"
                      class="border border-slate-300 bg-cyan-100 py-3 text-sm font-semibold text-slate-700"
                      :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                    >
                      {{ column.label }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in weeklyRows" :key="row.name">
                    <td class="border border-slate-300 px-3 py-2 text-sm text-slate-700">{{ row.name }}</td>
                    <td class="border border-slate-300 py-2 pl-3 pr-5 text-right text-sm text-slate-700">{{ row.pickQty }}</td>
                    <td class="border border-slate-300 p-0">
                      <input
                        v-model="weeklyRemaining[row.materialCode]"
                        type="text"
                        placeholder="/"
                        aria-label="车间剩余"
                        class="w-full bg-transparent py-2 pl-3 pr-5 text-right text-sm text-slate-700 outline-none transition placeholder:text-slate-400 hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-sky-300"
                      />
                    </td>
                    <td class="border border-slate-300 py-2 pl-3 pr-5 text-right text-sm text-slate-700">{{ row.actualQty }}</td>
                    <td class="border border-slate-300 px-3 py-2 text-sm text-slate-700">{{ row.unitConsumption }} {{ row.unitLabel }}</td>
                  </tr>
                  <tr>
                    <td class="border border-slate-300 px-3 py-2 text-sm text-slate-700">{{ weeklyInboundRow.name }}</td>
                    <td colspan="4" class="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800">
                      {{ weeklyInboundRow.value }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <el-dialog
          v-model="weeklyImageDialogVisible"
          width="80vw"
          class="image-preview-dialog"
          align-center
        >
          <template #header>
            <div class="flex flex-wrap items-center gap-x-5 gap-y-1 pr-6 text-sm text-slate-700">
              <span>物料描述：{{ weeklyCurrentMaterialDesc }}</span>
              <span>确认的产量：{{ weeklyCurrentConfirmedQty }}</span>
            </div>
          </template>

          <div class="flex min-h-[520px] items-center gap-4 overflow-x-auto rounded-lg bg-slate-50 p-6">
            <div v-if="weeklyImageList.length" class="relative flex w-full items-center justify-center">
              <el-button
                v-if="weeklyImageList.length > 1"
                circle
                class="absolute left-2 z-10"
                aria-label="上一张"
                @click="showWeeklyPreviousImage"
              >
                ‹
              </el-button>
              <img
                :src="weeklyImageList[weeklyCurrentIndex].url"
                alt="物料原图"
                class="max-h-[70vh] max-w-[85%] rounded-lg object-contain"
              />
              <el-button
                v-if="weeklyImageList.length > 1"
                circle
                class="absolute right-2 z-10"
                aria-label="下一张"
                @click="showWeeklyNextImage"
              >
                ›
              </el-button>
              <el-button
                type="danger"
                size="small"
                class="absolute bottom-2 left-1/2 -translate-x-1/2"
                :loading="weeklyImageDeleting"
                @click="deleteWeeklyImage(weeklyImageList[weeklyCurrentIndex])"
              >
                删除当前图片
              </el-button>
            </div>
            <span v-if="!weeklyImageList.length" class="w-full text-center text-sm text-slate-400">
              暂无图片
            </span>
          </div>

          <div v-if="weeklyImageList.length" class="mt-3 text-center text-sm text-slate-500">
            第 {{ weeklyCurrentIndex + 1 }} 张 / 共 {{ weeklyImageList.length }} 张
          </div>

          <template #footer>
            <div class="flex justify-end gap-3">
              <input
                ref="weeklyImageFileInput"
                type="file"
                accept="image/*"
                multiple
                class="hidden"
                @change="handleWeeklyImageSelected"
              />
              <el-button :loading="weeklyImageUploading" @click="openWeeklyFilePicker">
                添加图片
              </el-button>
            </div>
          </template>
        </el-dialog>

        <ProductSelectDialog
          v-model="weeklyProductDialogVisible"
          :options="weeklyProductOptions"
          :selected="weeklyProductFilter"
          @select="handleWeeklyProductSelected"
        />
      </div>

      <div v-show="activeTab === 'daily'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
            <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600">∅</div>
            <h2 class="text-base font-semibold text-slate-900">日报表记录</h2>
            <p class="mt-2 text-sm text-slate-500">功能建设中，敬请期待</p>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'vessel'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="p-6">
            <canvas ref="vesselCanvas" class="mx-auto block h-auto w-full"
            :style="{ maxWidth: `${vesselGeometry.displayWidth}px` }"></canvas>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-6 py-4">
            <div>
              <select
                v-model="vesselKey"
                aria-label="选择储罐"
                class="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-semibold text-slate-900 outline-none transition hover:border-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option v-for="vessel in VESSELS" :key="vessel.key" :value="vessel.key">
                  {{ vessel.label }}
                </option>
              </select>
              <p class="mt-1.5 text-xs text-slate-500">{{ vesselDescription }}</p>
            </div>

            <label class="flex items-center gap-3 text-sm text-slate-700">
              液位高度（mm）
              <input
                v-model.number="vesselLevel"
                type="number"
                min="0"
                :max="vesselGeometry.maxLevel"
                step="10"
                class="w-28 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-right text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100"
              />
            </label>
          </div>

          <div class="flex flex-wrap items-center gap-x-10 gap-y-3 border-t border-slate-100 px-6 py-4">
            <div class="text-sm text-slate-500">
              当前液位：<span class="text-lg font-semibold text-slate-900">{{ Math.round(vesselDisplayLevel) }}</span> mm
            </div>
            <div class="text-sm text-slate-500">
              当前液体体积：<span class="text-lg font-semibold text-sky-600">{{ vesselVolume.toFixed(2) }}</span> m³
            </div>
            <div class="text-sm text-slate-500">
              充满率：<span class="font-semibold text-slate-700">{{ ((vesselDisplayLevel / vesselGeometry.maxLevel) * 100).toFixed(1) }}</span>%
            </div>
          </div>

          <div class="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
            <div class="mx-auto max-w-[820px] overflow-x-auto">
              <p class="mb-3 text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                液体体积计算公式
              </p>

              <div v-if="vesselGeometry.type === 'vertical'" class="math-formula text-center text-slate-700">
                <div>
                  <i>V</i>(<i>h</i>) = π<i>r</i>²<i>h</i>
                  <span class="ml-3 text-xs text-slate-400">（<i>h</i> ≤ <i>H</i>，筒体段）</span>
                </div>
                <div class="mt-2">
                  = π<i>r</i>²<i>H</i> + π<i>r</i>²[ <i>t</i> −
                  <span class="frac"><span><i>t</i>³</span><span>3<i>h</i><sub>i</sub>²</span></span> ]
                  <span class="ml-3 text-xs text-slate-400">（<i>h</i> &gt; <i>H</i>，<i>t</i> = <i>h</i> − <i>H</i>）</span>
                </div>
              </div>

              <div v-else class="math-formula text-center text-slate-700">
                <div>
                  <i>V</i>(<i>h</i>) = <i>L</i> [
                  <span class="frac"><span>π<i>r</i>²</span><span>2</span></span>
                  − (<i>r</i> − <i>h</i>)<span class="sqrt">√<span>2<i>rh</i> − <i>h</i>²</span></span>
                  − <i>r</i>² · arcsin<span class="paren">(</span><span class="frac"><span><i>r</i> − <i>h</i></span><span><i>r</i></span></span><span class="paren">)</span> ]
                </div>
                <div class="mt-2">
                  +
                  <span class="frac"><span>π · <i>h</i><sub>i</sub></span><span>3<i>r</i></span></span>
                  · [ 3<i>r</i>²<i>h</i> − <i>r</i>³ + (<i>r</i> − <i>h</i>)³ ]
                </div>
              </div>

              <p v-if="vesselGeometry.type === 'vertical'" class="mt-3 text-center text-xs leading-relaxed text-slate-500">
                <i>r</i> 筒体内半径　<i>h</i> 液位高度　<i>H</i> 筒体高度　<i>h</i><sub>i</sub> 封头曲面内高度
                <span class="text-slate-400">｜</span>
                程序按此式实时计算液体体积
              </p>
              <p v-else class="mt-3 text-center text-xs leading-relaxed text-slate-500">
                <i>L</i> 筒体长度（含两端直边）　<i>r</i> 筒体内半径　<i>h</i> 液位高度　<i>h</i><sub>i</sub> 封头曲面内高度
                <span class="text-slate-400">｜</span>
                程序按此式实时计算液体体积
              </p>
            </div>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'import'">
        <WorkOrderImport @cancel="handleImportCancel" @back="handleImportBack" />
      </div>
    </div>
    </main>
  </el-config-provider>
</template>

<style scoped>
/* 公式排版：衬线斜体变量 + 真分数 + 根号上划线 */
.math-formula {
  font-family: Cambria, 'Cambria Math', 'Times New Roman', 'Songti SC', serif;
  font-size: 16px;
  line-height: 2.1;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.math-formula i {
  font-style: italic;
}

.math-formula sub {
  font-size: 0.7em;
}

.math-formula .frac {
  display: inline-flex;
  flex-direction: column;
  margin: 0 4px;
  vertical-align: middle;
  font-size: 0.85em;
  line-height: 1.25;
  text-align: center;
}

.math-formula .frac > span:first-child {
  border-bottom: 1px solid currentColor;
  padding: 0 5px;
}

.math-formula .frac > span:last-child {
  padding: 0 5px;
}

.math-formula .sqrt > span {
  border-top: 1px solid currentColor;
  padding: 0 4px 0 2px;
  margin-left: -1px;
}

.math-formula .paren {
  display: inline-block;
  transform: scaleY(1.35);
  margin: 0 2px;
}

.loading-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.72);
}

.loader {
  display: flex;
  width: min(360px, 80%);
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.loader-text {
  align-self: center;
  margin-bottom: 20px;
  color: rgb(0, 0, 0);
  font-size: 24px;
}

.loader-bar {
  width: 30%;
  min-width: 110px;
  height: 10px;
  overflow: hidden;
  border-radius: 5px;
  background-color: rgb(0, 0, 0);
  animation: loader-bar-animation 2s ease-in-out infinite;
}

@keyframes loader-bar-animation {
  0% {
    transform: translateX(-100%);
  }

  50% {
    transform: translateX(100%);
  }

  100% {
    transform: translateX(-100%);
  }
}
</style>
