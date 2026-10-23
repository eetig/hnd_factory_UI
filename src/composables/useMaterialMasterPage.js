import { computed, ref } from 'vue'
import request from '../api/request'

/*
 * 物料主数据页的数据层（2026-10-23，变更-159）。
 *
 * 三层形状与 useMaterialStockData 一致：
 *   1) 组件里改条件 → applyFilters()/goPage()；
 *   2) 本文件负责请求 + 过期响应护栏（pageSeq / detailSeq）；
 *   3) 后端分页与筛选（3 万行，不能拉回前端过滤）。
 *
 * ⚠️ 为什么「一个物料一行」：主表里罐类物料一个编码有 8 行（主档 + 7 个评估类型），
 *    后端用 valuation_type='' 过滤掉了评估行，所以这里的 rows 天然是一码一行；
 *    评估类型条数由后端带回来（valuationCount），详情接口才展开。
 */

const keyword = ref('')
const typeCode = ref('')
const statusFilter = ref('') // '' = 默认（不含停用）；'1'/'2'/'0'
const hasPrice = ref(false)

const rows = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(50)
const loading = ref(false)
const error = ref('')

const facets = ref({ total: 0, types: [], statuses: [] })

const selectedCode = ref('')
const detail = ref(null)
const detailLoading = ref(false)

let pageSeq = 0
let detailSeq = 0

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const refining = computed(() => loading.value && rows.value.length > 0)

async function fetchFacets() {
  try {
    const res = await request.get('/api/material/facets')
    const data = res.data?.data
    if (data) {
      facets.value = data
    }
  } catch {
    // 左栏计数是辅助信息：取不到就不显示数字，不影响搜索
  }
}

async function fetchPage({ reset = false } = {}) {
  const seq = ++pageSeq
  if (reset) {
    pageNum.value = 1
  }
  loading.value = true
  error.value = ''

  const params = {
    pageNum: pageNum.value,
    pageSize: pageSize.value,
  }
  const kw = keyword.value.trim()
  if (kw) params.keyword = kw
  if (typeCode.value) params.type = typeCode.value
  if (statusFilter.value !== '') params.status = Number(statusFilter.value)
  if (hasPrice.value) params.hasPrice = true

  try {
    const res = await request.get('/api/material/page', { params })
    if (seq !== pageSeq) return // 过期响应整段丢弃
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '物料接口返回异常。')
    }
    rows.value = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    total.value = Number(res.data?.total) || 0
  } catch (e) {
    if (seq !== pageSeq) return
    error.value = e?.response?.data?.msg || e?.message || '物料主数据加载失败。'
    rows.value = []
    total.value = 0
  } finally {
    if (seq === pageSeq) {
      loading.value = false
    }
  }
}

/** 条件变了：回第 1 页再查（否则会停在越界页码上看到空表） */
function applyFilters() {
  return fetchPage({ reset: true })
}

function goPage(page) {
  const next = Math.min(Math.max(1, page), pageCount.value)
  if (next === pageNum.value) return Promise.resolve()
  pageNum.value = next
  return fetchPage()
}

/** 左栏点类型：再点一次取消（等于「全部」） */
function toggleType(code) {
  typeCode.value = typeCode.value === code ? '' : code
  return applyFilters()
}

/** 左栏点状态：再点一次回到默认（不含停用） */
function toggleStatus(code) {
  statusFilter.value = statusFilter.value === code ? '' : code
  return applyFilters()
}

async function openDetail(code) {
  if (!code) return
  selectedCode.value = code
  const seq = ++detailSeq
  detailLoading.value = true
  try {
    const res = await request.get('/api/material/detail', { params: { code } })
    if (seq !== detailSeq) return
    detail.value = res.data?.data ?? null
  } catch {
    if (seq === detailSeq) {
      detail.value = null
    }
  } finally {
    if (seq === detailSeq) {
      detailLoading.value = false
    }
  }
}

function closeDetail() {
  detailSeq += 1
  selectedCode.value = ''
  detail.value = null
  detailLoading.value = false
}

export function useMaterialMasterPage() {
  return {
    keyword,
    typeCode,
    statusFilter,
    hasPrice,
    rows,
    total,
    pageNum,
    pageSize,
    pageCount,
    loading,
    refining,
    error,
    facets,
    selectedCode,
    detail,
    detailLoading,
    fetchFacets,
    fetchPage,
    applyFilters,
    goPage,
    toggleType,
    toggleStatus,
    openDetail,
    closeDetail,
  }
}
