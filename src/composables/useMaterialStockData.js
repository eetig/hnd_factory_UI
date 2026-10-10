import { ref } from 'vue'
import request from '../api/request'
import { pickField } from '../utils/format'

// ===== 物料库存（SAP 库存导出汇总）=====
//
// ⚠️ 改造要点（2026-10-10 统一整改）：**筛选与分页都在服务端**。
//
// 改造前是「整表拉回来 → 关键词与「只看有库存」在前端 filter、分页在本地 slice」。
// 数据源本身也特殊：物料名称与规格是**主数据优先、回退库存表那一份**的联查结果，
// 「只有主数据、库存里没有」的物料也要能搜到 —— 所以服务端那条 SQL 是双源 UNION，
// 见 hnd_factory 的 resources/mapper/MaterialStockMapper.xml。
//
// ⚠️ 关键词因此**只能按回车 / 键盘搜索键触发**（模板里是 @confirm）：逐字实时过滤
// 会把「敲一个字打一次接口」做实了。储罐液位页早就是「回车才发请求」的做法。
const stockTableData = ref([]) // 当前页
const stockPageNum = ref(1)
const stockPageSize = ref(10)
const stockTotal = ref(0) // **筛选后**的总条数
const stockLoading = ref(false)
const stockError = ref('')
/** 关键词：物料编码 / 物料名称 / 规格（服务端过滤，回车才发请求） */
const stockKeyword = ref('')
/**
 * 只看有库存。
 *
 * ⚠️ 默认 **false**（列出全部，含数量为 0 的物料）—— 这一页按使用方的要求是
 * 「查物料信息」，不是「看还有多少货」：快照语义下文件里消失的物料会被清零但保留行，
 * 默认藏起来就查不到它们了。
 */
const stockOnlyInStock = ref(false)

// 库存汇总字段别名容错（后端字段名有出入时自动适配）
const STOCK_FIELD_MAP = {
  plantCode: ['plantCode', 'plant', 'factoryCode'],
  materialCode: ['materialCode', 'materialNo'],
  // 物料名称与规格由后端联查 material_master 带出（主数据没有则回退库存表那份）
  materialName: ['materialName', 'materialDesc', 'material_name'],
  spec: ['spec', 'specModel'],
  storageLocation: ['storageLocation', 'storagePlace'],
  storageDesc: ['storageDesc', 'storageLocationDesc'],
  unit: ['unit'],
  stockQty: ['stockQty', 'stockQuantity', 'qty'],
}

function normalizeStockRecord(item) {
  if (!item) return null
  return Object.fromEntries(
    Object.entries(STOCK_FIELD_MAP).map(([key, aliases]) => [key, pickField(item, aliases)]),
  )
}

/**
 * 单元格显示值：没有值显示「/」（使用方口径）。
 *
 * 两种行都靠它兜底：
 *   · 库存里没有、只有主数据的物料 —— 存储地点/单位/数量/存储地点描述 全是空的；
 *   · 连名称规格都没有的 —— 名称与规格是「主数据优先、回退库存表」的联查结果，
 *     两边都没有时后端返回 null。
 */
function displayText(value) {
  const text = value === null || value === undefined ? '' : String(value).trim()
  return text || '/'
}

/**
 * 数量显示：49482 而不是 49482.000。
 * 库里是 decimal(18,3)（源数据就是三位小数），直接显示会拖一串没意义的零。
 *
 * ⚠️ 空值要先挡掉再 Number()：`Number('')` 是 **0** 不是 NaN，
 * 不挡的话缺失的数量会显示成「0」，看着像「这个物料真的没库存」。
 */
function formatStockQty(value) {
  const text = String(value ?? '').replace(/,/g, '').trim()
  if (!text) return ''
  const num = Number(text)
  return Number.isFinite(num) ? num.toLocaleString('zh-CN', { maximumFractionDigits: 3 }) : ''
}

function buildStockQuery() {
  const params = { pageNum: stockPageNum.value, pageSize: stockPageSize.value }
  const keyword = stockKeyword.value.trim()
  if (keyword) params.keyword = keyword
  if (stockOnlyInStock.value) params.onlyInStock = true
  return params
}

async function fetchStockRecords() {
  stockLoading.value = true
  stockError.value = ''

  try {
    const res = await request.get('/api/stock/list', { params: buildStockQuery() })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '库存接口返回异常。')
    }

    const dataList = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    stockTableData.value = dataList.map(normalizeStockRecord).filter(Boolean)
    stockTotal.value = Number(res.data?.total) || 0
    stockPageNum.value = Number(res.data?.pageNum) || stockPageNum.value
  } catch (error) {
    stockError.value = error?.response?.data?.msg || error?.message || '库存数据加载失败。'
    stockTableData.value = []
    stockTotal.value = 0
  } finally {
    stockLoading.value = false
  }
}

/** 关键词 / 「只看有库存」变了：**回到第 1 页**再查（否则会停在越界页码上看到空表） */
function applyStockFilter() {
  stockPageNum.value = 1
  return fetchStockRecords()
}

/** 分页器回调：只换页，不重置条件 */
function getStockPageData(page = stockPageNum.value) {
  stockPageNum.value = page
  return fetchStockRecords()
}

export function useMaterialStockData() {
  return {
    stockTableData,
    stockPageNum,
    stockPageSize,
    stockTotal,
    stockLoading,
    stockError,
    stockKeyword,
    stockOnlyInStock,
    fetchStockRecords,
    applyStockFilter,
    getStockPageData,
    formatStockQty,
    displayText,
  }
}
