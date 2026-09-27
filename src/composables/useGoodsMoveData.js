import { computed, ref } from 'vue'
import request from '../api/request'
import { getToday, getFirstDayOfCurrentMonth, pickField } from '../utils/format'

// ===== 货物移动数据（模块级单例）=====
// 按物料编码汇总移动数量，作为原辅料核算的「已报工数」来源。
const goodsMoveRecords = ref([])
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

export function useGoodsMoveData() {
  return {
    goodsMoveRecords,
    goodsMoveError,
    goodsMoveStartDate,
    goodsMoveEndDate,
    goodsMoveQtyMap,
    fetchGoodsMoveRecords,
  }
}
