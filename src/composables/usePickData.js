import { ref } from 'vue'
import request from '../api/request'
import { getToday, getFirstDayOfCurrentMonth, pickField } from '../utils/format'

// ===== 领料汇总数据（模块级单例）=====
//
// ⚠️ 改造要点（2026-10-10 统一整改）：**筛选与分页都在服务端**。
//
// 改造前这里是「onMounted 一次性拉全表 → 全部筛选/排序/分页在内存里做」。
// 后端接口是全量返回，前端 hold 着一份「页面打开那一刻」的快照，于是：
// 图片解析确认入库后再回到本页，无论怎么改筛选日期都看不到新记录（只有重启 App
// 重新挂载才会重拉）。现在每一个筛选条件、每一次翻页、每一次下拉刷新都是一次真实查询。
//
// 因此本地**不再保留** allPickRecords / pickFiltered / sortPickRecords / matchesPickFilters
// 这一整套内存管道；保留下来的只有「当前页 + 总数 + 当前筛选条件」。
// 字段别名容错（PICK_FIELD_MAP）继续保留 —— 后端字段名有出入时还要靠它兜。
const pickTableData = ref([]) // 当前页
const pickPageNum = ref(1)
const pickPageSize = ref(10)
const pickTotal = ref(0) // **筛选后**的总条数，来自接口的 total
const pickLoading = ref(false)
const pickError = ref('')
const pickStartDate = ref(getFirstDayOfCurrentMonth())
const pickEndDate = ref(getToday())

// 物料名称筛选
const pickMaterialDialogVisible = ref(false)
const pickMaterialFilter = ref('')
/** 物料名称候选：由接口给（分页之后前端不再持有全量数据，算不出候选） */
const pickMaterialOptions = ref([])

/**
 * 原辅料核算用的**按物料汇总**结果。
 *
 * 那一页不是列表，是「以领料汇总当前筛选后的物料名称去重为行、领料数按物料累加」的聚合表 ——
 * 分页数据喂不了它（拿第 1 页做 group by 只会得到前 10 条的合计），所以后端另开了
 * {@code /api/pick/summary-by-material}。报表口径的换算与派生仍在前端。
 */
const pickSummaryRows = ref([])

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

/** 日期区间参数：空白不传（后端把「未传」当作不限制） */
function dateRangeParams() {
  const params = {}
  if (pickStartDate.value) params.startDate = pickStartDate.value
  if (pickEndDate.value) params.endDate = pickEndDate.value
  return params
}

/** 当前筛选条件 + 当前页码（列表接口用，分页参数必传） */
function buildPickQuery() {
  const params = { ...dateRangeParams(), pageNum: pickPageNum.value, pageSize: pickPageSize.value }
  if (pickMaterialFilter.value) params.materialName = pickMaterialFilter.value
  return params
}

function describePickError(error) {
  if (error?.response?.status === 404) {
    return '领料汇总接口不存在，请确认后端服务已实现该接口。'
  }
  return error.response?.data?.msg || error.message || '领料汇总数据加载失败，请稍后重试。'
}

/** 取当前页。翻页、下拉刷新、以及错误面板的「重新加载」都走它 */
async function fetchPickRecords() {
  pickLoading.value = true
  pickError.value = ''

  try {
    const res = await request.get('/api/pick/list', { params: buildPickQuery() })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '领料汇总接口返回异常，请稍后重试。')
    }

    const dataList = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    pickTableData.value = dataList.map(normalizePickRecord).filter(Boolean)
    pickTotal.value = Number(res.data?.total) || 0
    // 页码以后端归一化后的值为准：后端会把越界/非法页码归一到第 1 页，
    // 不同步回来的话分页器会停在一个空页上
    pickPageNum.value = Number(res.data?.pageNum) || pickPageNum.value
  } catch (error) {
    pickTableData.value = []
    pickTotal.value = 0
    pickError.value = describePickError(error)
  } finally {
    pickLoading.value = false
  }
}

/** 取「按物料汇总」结果（原辅料核算用），筛选条件与列表完全一致 */
async function fetchPickSummary() {
  try {
    const res = await request.get('/api/pick/summary-by-material', { params: dateRangeParams() })
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '领料汇总接口返回异常。')
    }
    pickSummaryRows.value = Array.isArray(res.data?.data) ? res.data.data : []
  } catch {
    // 汇总失败只把这一份清空，不去动列表 —— 两边的错误提示分开，
    // 免得列表明明好好的却跟着报错
    pickSummaryRows.value = []
  }
}

/**
 * 筛选条件变了：**回到第 1 页**再查。
 *
 * 不回第 1 页的话，用户在第 5 页改条件后很可能落在一个已经越界的页码上，
 * 看到的是一张空表 —— 会被当成「筛出来没数据」。
 */
function reloadPickRecords() {
  pickPageNum.value = 1
  return Promise.all([fetchPickRecords(), fetchPickSummary()])
}

/** 分页器回调：只换页，不重置条件 */
function loadPickPage(page) {
  pickPageNum.value = page
  return fetchPickRecords()
}

/** 物料名称候选：取当前日期区间内出现过的名称（选中一个之后要能改选，所以不带物料条件） */
async function fetchPickMaterialOptions() {
  try {
    const res = await request.get('/api/pick/material-options', { params: dateRangeParams() })
    pickMaterialOptions.value = Array.isArray(res.data?.data) ? res.data.data : []
  } catch {
    pickMaterialOptions.value = []
  }
}

/**
 * 打开弹窗前才取候选：候选随日期区间变化，缓存在内存里会在改完日期后给出过期选项。
 * 一次请求换来「看到的候选一定是对的」。
 */
function openPickMaterialDialog() {
  pickMaterialDialogVisible.value = true
  fetchPickMaterialOptions()
}

function handlePickMaterialSelected(materialName) {
  pickMaterialFilter.value = materialName
  pickMaterialDialogVisible.value = false
  reloadPickRecords()
}

function clearPickMaterialFilter() {
  pickMaterialFilter.value = ''
  reloadPickRecords()
}

export function usePickData() {
  return {
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
    pickSummaryRows,
    fetchPickRecords,
    fetchPickSummary,
    reloadPickRecords,
    loadPickPage,
    openPickMaterialDialog,
    handlePickMaterialSelected,
    clearPickMaterialFilter,
  }
}
