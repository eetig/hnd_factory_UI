import { computed } from 'vue'
import { REPORT_ORDER_TYPES, getReportOrderType } from '../constants/orderTypes'
import { formatQty, normalizeMaterialName } from '../utils/format'
import { useWorkOrderData } from './useWorkOrderData'
import { usePickData } from './usePickData'
import { useInboundData } from './useInboundData'
import { useGoodsMoveData } from './useGoodsMoveData'

/**
 * 工单报工 / 工单核算 / 原辅料核算 三张汇总表的派生逻辑。
 *
 * 这里的 build* 都是纯函数（输入数组 → 输出行数组），不依赖 Vue，
 * 因此可以脱离组件直接单测（见 tests/unit/stats.spec.js）。
 * 原先它们散在 WorkOrderList.vue 里，只能靠手点页面验证。
 */

/**
 * 工单报工：按 工单类型 + 产成品 分组，订单数量与确认产量按组求和。
 * 只统计工单号前缀能识别出工单类型（1000/2000/3000/4000）的行。
 */
export function buildReportRows(orders) {
  const rows = new Map()

  for (const order of orders || []) {
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
      const byType =
        REPORT_ORDER_TYPES.findIndex((type) => type.label === left.orderType) -
        REPORT_ORDER_TYPES.findIndex((type) => type.label === right.orderType)

      if (byType !== 0) return byType

      return left.materialDesc.localeCompare(right.materialDesc, 'zh-CN')
    })
}

/** 已报工数量：按归一化产成品名称汇总工单的确认产量 */
export function buildReportedQtyMap(orders) {
  const map = new Map()

  for (const order of orders || []) {
    const key = normalizeMaterialName(order.materialDesc)
    if (!key) continue

    map.set(key, (map.get(key) || 0) + (Number(order.confirmedQty) || 0))
  }

  return map
}

/**
 * 工单核算：以已入库产成品（入库汇总**当前筛选后**的物料名称去重）为行，
 * 入库数与已报工数汇总（已报工数取工单汇总当前筛选后的工单），差额为未报工数。
 */
export function buildCostingRows(inboundRecords, orders) {
  const rows = new Map()

  // 入库数：来自入库汇总数据，按物料名称去重
  for (const record of inboundRecords || []) {
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
  const reportedQtyMap = buildReportedQtyMap(orders)
  for (const row of rows.values()) {
    row.reportedQty = reportedQtyMap.get(normalizeMaterialName(row.materialName)) || 0
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      inboundQty: formatQty(row.inboundQty),
      reportedQty: formatQty(row.reportedQty),
      unreportedQty: formatQty(row.inboundQty - row.reportedQty),
    }))
    .sort((left, right) => left.materialName.localeCompare(right.materialName, 'zh-CN'))
}

// 领料数换算系数（按物料编码，如 HND-V150_辅料包 ×3.2）
export const MATERIAL_COSTING_QTY_FACTORS = {
  112004292: 3.2,
}

// 派生行：领料数由其他物料折算，报工数取指定库位的货物移动
export const MATERIAL_COSTING_DERIVED = [
  {
    materialCode: '111001792',
    materialName: '氯铂酸_150',
    sourceMaterialCode: '112004292', // HND-V150_辅料包
    qtyMultiplier: 20, // 领料数 = 辅料包领料数 × 20
    fromLocation: '5003', // 报工数仅统计来源库位 5003 的氯铂酸
    reportedMultiplier: 1000, // 报工数 = 该库位氯铂酸数量合计 × 1000
  },
  {
    materialCode: '111001792',
    materialName: '氯铂酸_171',
    sourceMaterialName: 'HND-V171_辅料包',
    qtyMultiplier: 20, // 领料数 = V171 辅料包领料数 × 20
    fromLocation: '5002', // 报工数仅统计来源库位 5002 的氯铂酸
    reportedMultiplier: 1000, // 报工数 = 该库位氯铂酸数量合计 × 1000
  },
]

/**
 * 原辅料核算：以领料汇总**当前筛选后**的物料名称去重为行，领料数按物料累加，
 * 已报工数取货物移动数量合计（按物料编码）。
 */
export function buildMaterialCostingRows({ pickRecords, goodsMoveQtyMap, goodsMoveRecords } = {}) {
  const rows = new Map()

  // 领料数：来自领料汇总数据，按物料名称去重
  for (const record of pickRecords || []) {
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
    row.reportedQty = Math.abs(goodsMoveQtyMap?.get(code) || 0)
  }

  // 派生行：领料数由源物料折算；报工数按物料编码 + 来源库位筛选货物移动后求和取绝对值
  for (const derived of MATERIAL_COSTING_DERIVED) {
    const sourceRow = [...rows.values()].find((row) => {
      if (
        derived.sourceMaterialCode &&
        String(row.materialCode ?? '').trim() === derived.sourceMaterialCode
      ) {
        return true
      }
      if (derived.sourceMaterialName) {
        return (
          normalizeMaterialName(row.materialName) ===
          normalizeMaterialName(derived.sourceMaterialName)
        )
      }
      return false
    })
    const pickQty = (sourceRow?.pickQty ?? 0) * derived.qtyMultiplier

    const moveSum = (goodsMoveRecords || [])
      .filter((record) => {
        if (String(record.materialCode ?? '').trim() !== derived.materialCode) return false
        if (!derived.fromLocation) return true
        return String(record.fromLocation ?? '').trim() === derived.fromLocation
      })
      .reduce((sum, record) => sum + (Number(record.moveQty) || 0), 0)

    rows.set(`derived:${derived.materialName}`, {
      materialName: derived.materialName,
      materialCode: derived.materialCode,
      pickQty,
      reportedQty: Math.abs(moveSum) * (derived.reportedMultiplier ?? 1),
    })
  }

  return (
    [...rows.values()]
      .map((row) => ({
        ...row,
        pickQty: formatQty(row.pickQty),
        reportedQty: formatQty(row.reportedQty),
        unreportedQty: formatQty(row.pickQty - row.reportedQty),
      }))
      // 领料数与报工数都为 0 的行不展示（如派生行缺少对应数据）
      .filter((row) => row.pickQty !== 0 || row.reportedQty !== 0)
      .sort((left, right) => left.materialName.localeCompare(right.materialName, 'zh-CN'))
  )
}

/**
 * 三张汇总表的响应式包装。数据源仍是各 composable 的模块级单例，
 * 所以面板组件自己调用本函数即可拿到同一份数据，无需层层传 props。
 *
 * 三张表喂的都是各来源面板「当前筛选后」的数据（与工单报工同一口径）：
 * 汇总面板把日期/物料筛掉之后，核算表跟着空 —— 核算是对当前所见明细的核算，
 * 不能拿接口全量现算（否则汇总为空的区间，核算表还在显示全量数字）。
 */
export function useStatsData() {
  const { tableDataAll } = useWorkOrderData()
  const { inboundFiltered } = useInboundData()
  const { pickFiltered } = usePickData()
  const { goodsMoveRecords, goodsMoveQtyMap } = useGoodsMoveData()

  const reportRows = computed(() => buildReportRows(tableDataAll.value))

  const costingRows = computed(() => buildCostingRows(inboundFiltered.value, tableDataAll.value))

  const materialCostingRows = computed(() =>
    buildMaterialCostingRows({
      pickRecords: pickFiltered.value,
      goodsMoveQtyMap: goodsMoveQtyMap.value,
      goodsMoveRecords: goodsMoveRecords.value,
    }),
  )

  return { reportRows, costingRows, materialCostingRows }
}
