import { computed, ref } from 'vue'
import request from '../api/request'
import { getToday, getFirstDayOfCurrentMonth, pickField } from '../utils/format'

// ===== 入库汇总数据（模块级单例）=====
// 入库汇总面板、工单核算面板、周统计面板共用同一份数据。
const allInboundRecords = ref([])
const inboundFiltered = ref([])
const inboundTableData = ref([])
const inboundPageNum = ref(1)
const inboundPageSize = ref(10)
const inboundTotal = ref(0)
const inboundLoading = ref(false)
const inboundError = ref('')
const inboundStartDate = ref(getFirstDayOfCurrentMonth())
const inboundEndDate = ref(getToday())

// 物料名称筛选
const inboundMaterialDialogVisible = ref(false)
const inboundMaterialFilter = ref('')

// 入库汇总字段别名容错（后端字段名有出入时自动适配）
const INBOUND_FIELD_MAP = {
  materialName: ['materialName', 'materialDesc'],
  materialCode: ['materialCode', 'materialNo'],
  inboundDate: ['inboundDate', 'inboundTime'],
  inboundQty: ['inboundQty', 'inboundQuantity', 'quantity'],
  unit: ['unit'],
  // 列表缩略图（整改-001 新增）：缺失时前端回退用 imageUrl
  thumbnailUrl: ['thumbnailUrl', 'thumbUrl'],
  imageUrl: ['imageUrl', 'image', 'imagePath', 'fileUrl'],
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

const inboundMaterialOptions = computed(() => {
  const names = allInboundRecords.value
    .filter(matchesInboundDateRange)
    .map((record) => String(record.materialName ?? '').trim())
    .filter(Boolean)

  return [...new Set(names)].sort((left, right) => left.localeCompare(right, 'zh-CN'))
})

function matchesInboundDateRange(record) {
  const inboundDate = getInboundDate(record)
  if (!inboundDate) return false
  return inboundDate >= inboundStartDate.value && inboundDate <= inboundEndDate.value
}

function matchesInboundFilters(record) {
  if (!matchesInboundDateRange(record)) return false
  if (!inboundMaterialFilter.value) return true
  return String(record.materialName ?? '').trim() === inboundMaterialFilter.value
}

function openInboundMaterialDialog() {
  inboundMaterialDialogVisible.value = true
}

function handleInboundMaterialSelected(materialName) {
  inboundMaterialFilter.value = materialName
  inboundMaterialDialogVisible.value = false
  filterInboundRecords()
}

function clearInboundMaterialFilter() {
  inboundMaterialFilter.value = ''
  filterInboundRecords()
}

function filterInboundRecords() {
  inboundFiltered.value = sortInboundRecords(allInboundRecords.value.filter(matchesInboundFilters))

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

export function useInboundData() {
  return {
    allInboundRecords,
    inboundFiltered,
    inboundTableData,
    inboundPageNum,
    inboundPageSize,
    inboundTotal,
    inboundLoading,
    inboundError,
    inboundStartDate,
    inboundEndDate,
    inboundMaterialDialogVisible,
    inboundMaterialFilter,
    inboundMaterialOptions,
    getInboundPageData,
    filterInboundRecords,
    fetchInboundRecords,
    getInboundDate,
    openInboundMaterialDialog,
    handleInboundMaterialSelected,
    clearInboundMaterialFilter,
  }
}
