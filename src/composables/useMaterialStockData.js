import { ref } from 'vue'
import request from '../api/request'
import { pickField } from '../utils/format'

// ===== 物料库存（SAP 库存导出汇总）=====
// 数据由「文件导入 → 库存汇总」写入（后端 material_stock 表），「物料查询」面板只读展示。
// 筛选 / 分页都在本地做 —— 与领料汇总、入库汇总的口径一致。
//
// 口径（与使用方确认，见《前后端改动统筹》变更-008）：
//   同一 (工厂+物料编码+存储地点) 的多行在**后端**相加成一条；
//   再次导入视为当前库存快照 —— 本次文件里没有的物料数量清零但行保留，
//   所以页面上会出现数量为 0 的物料行（「只看有库存」默认把它们收起来）。
const allStockRecords = ref([])
const stockFiltered = ref([])
const stockTableData = ref([])
const stockPageNum = ref(1)
const stockPageSize = ref(10)
const stockTotal = ref(0)
const stockLoading = ref(false)
const stockError = ref('')
/** 关键词：物料编码 / 物料名称 / 规格，本地过滤 */
const stockKeyword = ref('')
/**
 * 只看有库存。
 *
 * ⚠️ 默认 **false**（列出全部，含数量为 0 的物料）—— 这一页的用法是「按编码/名称/规格
 * 查物料信息」，不是「看还有多少货」：快照语义下文件里消失的物料会被清零但保留行，
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

/** 数量列要参与数值比较（「只看有库存」）与排序，统一在此转成数字 */
function toStockQty(record) {
  const value = Number(String(record?.stockQty ?? '').replace(/,/g, ''))
  return Number.isFinite(value) ? value : 0
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

async function fetchStockRecords() {
  stockLoading.value = true
  stockError.value = ''

  try {
    const res = await request.get('/api/stock/list')

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '库存接口返回异常。')
    }

    const dataList = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    allStockRecords.value = dataList.map(normalizeStockRecord).filter(Boolean)
    applyStockFilter()
  } catch (error) {
    stockError.value = error?.response?.data?.msg || error?.message || '库存数据加载失败。'
    allStockRecords.value = []
    applyStockFilter()
  } finally {
    stockLoading.value = false
  }
}

/** 关键词（物料编码 / 物料名称 / 规格）+「只看有库存」→ 过滤后回到第 1 页 */
function applyStockFilter() {
  const keyword = stockKeyword.value.trim().toLowerCase()
  let list = allStockRecords.value

  if (keyword) {
    // 三列都能搜：编码、名称、规格 —— 使用方就是按这三样找物料的
    list = list.filter((record) =>
      `${record.materialCode ?? ''} ${record.materialName ?? ''} ${record.spec ?? ''}`
        .toLowerCase()
        .includes(keyword),
    )
  }
  if (stockOnlyInStock.value) {
    list = list.filter((record) => toStockQty(record) > 0)
  }

  stockFiltered.value = list
  stockTotal.value = list.length
  getStockPageData(1)
}

function getStockPageData(page = stockPageNum.value) {
  stockPageNum.value = page
  const start = (stockPageNum.value - 1) * stockPageSize.value
  stockTableData.value = stockFiltered.value.slice(start, start + stockPageSize.value)
}

export function useMaterialStockData() {
  return {
    allStockRecords,
    stockFiltered,
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
