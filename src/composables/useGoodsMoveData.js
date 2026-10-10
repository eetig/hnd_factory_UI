import { computed, ref } from 'vue'
import request from '../api/request'
import { getToday, getFirstDayOfCurrentMonth, pickField } from '../utils/format'

// ===== 货物移动（原辅料核算的「已报工数」来源）=====
//
// ⚠️ 改造要点（2026-10-10 统一整改）：这一页**没有列表**，数据只喂原辅料核算的聚合表。
//
// 改造前拉的是明细全表（还顺手白拉一次：前端一直把 startDate/endDate 拼进 query，
// 但后端控制器一个参数都没接，日期条件被静默丢掉），前端再自己按物料累加。
// 现在直接取服务端**按「物料编码 + 来源库位」汇总**的结果：
//   · 明细全表 → 19 行汇总，请求小了三个数量级（本地库实测 3707 行 → 19 行）；
//   · 累加口径（除了取绝对值那一步）搬到了服务端，前端只剩展示规则。
//
// ⚠️ 来源库位必须留在汇总行里：原辅料核算有两行派生数据是按
// 「物料编码 **+ 来源库位**」取数的（如「只统计来源库位 5003 的氯铂酸」）。
const goodsMoveSummaryRows = ref([])
const goodsMoveError = ref('')
// 货物移动查询时间范围（默认当月初至今天）
const goodsMoveStartDate = ref(getFirstDayOfCurrentMonth())
const goodsMoveEndDate = ref(getToday())

// 货物移动字段别名容错（后端字段名有出入时自动适配）
const GOODS_MOVE_FIELD_MAP = {
  materialCode: ['materialCode', 'materialNo'],
  moveQty: ['moveQty', 'quantity', 'moveQuantity', 'qty'],
  moveDate: ['moveDate', 'postingDate', 'postDate'],
  moveType: ['moveType', 'movementType', 'type'],
  fromLocation: ['fromLocation', 'fromStorage', 'sourceLocation'],
}

/** 按物料编码求和 —— 原辅料核算的「已报工数」直接查它（口径与改造前一致） */
const goodsMoveQtyMap = computed(() => {
  const map = new Map()

  for (const record of goodsMoveSummaryRows.value) {
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

async function fetchGoodsMoveSummary() {
  goodsMoveError.value = ''

  try {
    const res = await request.get('/api/goods-move/summary-by-material', {
      params: {
        startDate: goodsMoveStartDate.value,
        endDate: goodsMoveEndDate.value,
      },
    })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '货物移动接口返回异常。')
    }

    // 日期区间已由服务端过滤，这里不再做任何本地筛选
    goodsMoveSummaryRows.value = (Array.isArray(res.data?.data) ? res.data.data : [])
      .map(normalizeGoodsMoveRecord)
      .filter(Boolean)
  } catch (error) {
    goodsMoveSummaryRows.value = []
    goodsMoveError.value = error?.response?.status === 404
      ? '货物移动接口不存在，请确认后端服务已实现该接口。'
      : error.response?.data?.msg || error.message || '货物移动数据加载失败。'
  }
}

export function useGoodsMoveData() {
  return {
    goodsMoveSummaryRows,
    goodsMoveError,
    goodsMoveStartDate,
    goodsMoveEndDate,
    goodsMoveQtyMap,
    fetchGoodsMoveSummary,
  }
}
