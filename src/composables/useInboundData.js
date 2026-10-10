import { ref } from 'vue'
import request from '../api/request'
import { getToday, getFirstDayOfCurrentMonth, pickField } from '../utils/format'

// ===== 入库汇总数据（模块级单例）=====
//
// ⚠️ 改造要点（2026-10-10 统一整改）：**筛选与分页都在服务端**。理由与
// usePickData 那份的长注释同源（前端全量快照 → 库里的新增在筛选时永远看不到），
// 这里不再重复。本地只保留「当前页 + 总数 + 当前筛选条件」。
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
const inboundMaterialOptions = ref([])

/** 工单核算的「入库数」来源：按物料汇总（见 usePickData 里对 pickSummaryRows 的说明） */
const inboundSummaryRows = ref([])

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

function dateRangeParams() {
  const params = {}
  if (inboundStartDate.value) params.startDate = inboundStartDate.value
  if (inboundEndDate.value) params.endDate = inboundEndDate.value
  return params
}

function buildInboundQuery() {
  const params = {
    ...dateRangeParams(),
    pageNum: inboundPageNum.value,
    pageSize: inboundPageSize.value,
  }
  if (inboundMaterialFilter.value) params.materialName = inboundMaterialFilter.value
  return params
}

function describeInboundError(error) {
  if (error?.response?.status === 404) {
    return '入库汇总接口不存在，请确认后端服务已实现该接口。'
  }
  return error.response?.data?.msg || error.message || '入库汇总数据加载失败，请稍后重试。'
}

async function fetchInboundRecords() {
  inboundLoading.value = true
  inboundError.value = ''

  try {
    const res = await request.get('/api/inbound/list', { params: buildInboundQuery() })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '入库汇总接口返回异常，请稍后重试。')
    }

    const dataList = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    inboundTableData.value = dataList.map(normalizeInboundRecord).filter(Boolean)
    inboundTotal.value = Number(res.data?.total) || 0
    inboundPageNum.value = Number(res.data?.pageNum) || inboundPageNum.value
  } catch (error) {
    inboundTableData.value = []
    inboundTotal.value = 0
    inboundError.value = describeInboundError(error)
  } finally {
    inboundLoading.value = false
  }
}

/** 取「按物料汇总」结果（工单核算用），筛选条件与列表一致 */
async function fetchInboundSummary() {
  try {
    const res = await request.get('/api/inbound/summary-by-material', { params: dateRangeParams() })
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '入库汇总接口返回异常。')
    }
    inboundSummaryRows.value = Array.isArray(res.data?.data) ? res.data.data : []
  } catch {
    inboundSummaryRows.value = []
  }
}

/** 筛选条件变了：回到第 1 页再查 */
function reloadInboundRecords() {
  inboundPageNum.value = 1
  return Promise.all([fetchInboundRecords(), fetchInboundSummary()])
}

/** 分页器回调：只换页，不重置条件 */
function loadInboundPage(page) {
  inboundPageNum.value = page
  return fetchInboundRecords()
}

async function fetchInboundMaterialOptions() {
  try {
    const res = await request.get('/api/inbound/material-options', { params: dateRangeParams() })
    inboundMaterialOptions.value = Array.isArray(res.data?.data) ? res.data.data : []
  } catch {
    inboundMaterialOptions.value = []
  }
}

function openInboundMaterialDialog() {
  inboundMaterialDialogVisible.value = true
  fetchInboundMaterialOptions()
}

function handleInboundMaterialSelected(materialName) {
  inboundMaterialFilter.value = materialName
  inboundMaterialDialogVisible.value = false
  reloadInboundRecords()
}

function clearInboundMaterialFilter() {
  inboundMaterialFilter.value = ''
  reloadInboundRecords()
}

export function useInboundData() {
  return {
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
    inboundSummaryRows,
    fetchInboundRecords,
    fetchInboundSummary,
    reloadInboundRecords,
    loadInboundPage,
    openInboundMaterialDialog,
    handleInboundMaterialSelected,
    clearInboundMaterialFilter,
  }
}
