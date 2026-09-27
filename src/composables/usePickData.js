import { computed, ref } from 'vue'
import request from '../api/request'
import { getToday, getFirstDayOfCurrentMonth, pickField } from '../utils/format'

// ===== 领料汇总数据（模块级单例）=====
// 领料汇总面板、原辅料核算面板、周统计面板共用同一份数据。
const allPickRecords = ref([])
const pickFiltered = ref([])
const pickTableData = ref([])
const pickPageNum = ref(1)
const pickPageSize = ref(10)
const pickTotal = ref(0)
const pickLoading = ref(false)
const pickError = ref('')
const pickStartDate = ref(getFirstDayOfCurrentMonth())
const pickEndDate = ref(getToday())

// 物料名称筛选
const pickMaterialDialogVisible = ref(false)
const pickMaterialFilter = ref('')

// 领料汇总字段别名容错（后端字段名有出入时自动适配）
const PICK_FIELD_MAP = {
  materialName: ['materialName', 'materialDesc'],
  materialCode: ['materialCode', 'materialNo'],
  pickDate: ['pickDate', 'pickTime'],
  pickQty: ['pickQty', 'pickQuantity', 'quantity'],
  unit: ['unit'],
  // 列表缩略图（整改-001 新增）：缺失时前端回退用 imageUrl
  thumbnailUrl: ['thumbnailUrl', 'thumbUrl'],
  imageUrl: ['imageUrl', 'image', 'imagePath', 'fileUrl'],
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

const pickMaterialOptions = computed(() => {
  const names = allPickRecords.value
    .filter(matchesPickDateRange)
    .map((record) => String(record.materialName ?? '').trim())
    .filter(Boolean)

  return [...new Set(names)].sort((left, right) => left.localeCompare(right, 'zh-CN'))
})

function matchesPickDateRange(record) {
  const pickDate = getPickDate(record)
  if (!pickDate) return false
  return pickDate >= pickStartDate.value && pickDate <= pickEndDate.value
}

function matchesPickFilters(record) {
  if (!matchesPickDateRange(record)) return false
  if (!pickMaterialFilter.value) return true
  return String(record.materialName ?? '').trim() === pickMaterialFilter.value
}

function openPickMaterialDialog() {
  pickMaterialDialogVisible.value = true
}

function handlePickMaterialSelected(materialName) {
  pickMaterialFilter.value = materialName
  pickMaterialDialogVisible.value = false
  filterPickRecords()
}

function clearPickMaterialFilter() {
  pickMaterialFilter.value = ''
  filterPickRecords()
}

function filterPickRecords() {
  pickFiltered.value = sortPickRecords(allPickRecords.value.filter(matchesPickFilters))

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

export function usePickData() {
  return {
    allPickRecords,
    pickFiltered,
    pickTableData,
    pickPageNum,
    pickPageSize,
    pickTotal,
    pickLoading,
    pickError,
    pickStartDate,
    pickEndDate,
    pickMaterialDialogVisible,
    pickMaterialFilter,
    pickMaterialOptions,
    getPickPageData,
    filterPickRecords,
    fetchPickRecords,
    getPickDate,
    openPickMaterialDialog,
    handlePickMaterialSelected,
    clearPickMaterialFilter,
  }
}
