import request from '../api/request'
import { computed, ref } from 'vue'
import { REPORT_ORDER_TYPES } from '../constants/orderTypes'
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
 * 原先它们散在拆分前那个单文件页面（views/WorkOrderList.vue，已拆成
 * 「壳 + 14 个路由页」）里，只能靠手点页面验证。现在三张表是同一页的三个只读视图
 * （views/orders/CostingView.vue），这一份仍然是它们唯一的派生逻辑来源。
 */

/**
 * 工单报工：按 工单类型 + 产成品 分组，订单数量与确认产量按组求和。
 *
 * ⚠️ 2026-10-10 整改：入参从「全量工单数组」换成**服务端已经分好组的结果**
 * （`/api/work-order/summary-by-type-material` 返回的 [{typeKey, orderType, materialName,
 * orderQty, confirmedQty}]）。
 *
 * 为什么必须换：工单汇总改后端分页之后，前端手里只剩当前页的 10 条 ——
 * 拿它分组求和会得出「前 10 条的合计」，而这页的语义是「整个筛选区间的合计」。
 * 分组求和因此搬到了服务端（按工单号前缀 + 产成品 GROUP BY），
 * 前端只剩「类型识别不出的行不进表」与排序这两条展示口径（与改造前一致）。
 */
export function buildReportRows(groupRows) {
  return (groupRows || [])
    // 工单号前缀认不出类型的行不进表（改造前在这里 continue 掉的也是它们）
    .filter((row) => row?.orderType)
    .map((row) => ({
      orderType: row.orderType,
      typeKey: row.typeKey,
      orderQtyRaw: Number(row.orderQty) || 0,
      materialDesc: row.materialName,
      orderQty: formatQty(Number(row.orderQty) || 0),
      confirmedQty: formatQty(Number(row.confirmedQty) || 0),
    }))
    .sort((left, right) => {
      const byType =
        REPORT_ORDER_TYPES.findIndex((type) => type.label === left.orderType) -
        REPORT_ORDER_TYPES.findIndex((type) => type.label === right.orderType)

      if (byType !== 0) return byType

      return left.materialDesc.localeCompare(right.materialDesc, 'zh-CN')
    })
}

/**
 * 已报工数量：**按产成品编码**汇总确认产量，名称作为兜底（2026-10-21 变更-140）。
 *
 * <p>为什么改：原先只按归一化名称匹配。名称里带 `_`、空格、中英混排，入库侧和工单侧
 * 写差一个字符（`HND-2171_5KG方形塑料桶_华耐德外部贸易_白色_华耐德外贸桶` 这种），
 * 报工数就被算成 0 —— 表里看着像"这批货没报工"，其实是键对不上。
 * 编码是主键级别的键。名称只在编码缺失时才用（老数据可能没有编码）。
 *
 * @returns {{ byCode: Map<string, number>, byName: Map<string, number> }}
 */
export function buildReportedQtyMap(groupRows) {
  const byCode = new Map()
  const byName = new Map()

  for (const row of groupRows || []) {
    const qty = Number(row.confirmedQty) || 0
    const code = String(row.materialCode ?? '').trim()
    const name = normalizeMaterialName(row.materialName)

    if (code) {
      byCode.set(code, (byCode.get(code) || 0) + qty)
    }
    if (name) {
      byName.set(name, (byName.get(name) || 0) + qty)
    }
  }

  return { byCode, byName }
}

/** 取某一行应得的已报工数：先编码、后名称、都没有就是 0 */
export function lookupReportedQty(map, row) {
  if (!map) return 0
  const code = String(row?.materialCode ?? '').trim()
  if (code && map.byCode?.has(code)) return map.byCode.get(code)

  const name = normalizeMaterialName(row?.materialName)
  if (name && map.byName?.has(name)) return map.byName.get(name)

  return 0
}

/**
 * 工单核算：以已入库产成品（入库汇总**当前筛选后**的物料名称去重）为行，
 * 入库数与已报工数汇总（已报工数取工单汇总当前筛选后的工单），差额为未报工数。
 *
 * ⚠️ 2026-10-10 整改：两个入参都换成**服务端汇总结果**（入库按物料汇总、工单按类型+产成品汇总）——
 * 两张明细表都改后端分页了，前端手里不再有全量，拿当前页做 group by 只会得到前 10 条的合计。
 * 字段名沿用明细那套（materialName / materialCode / inboundQty），所以这里的算法一行没动。
 */
export function buildCostingRows(inboundRecords, groupRows) {
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

  // 已报工数：先按产成品编码匹配，编码对不上再用名称兜底（见 buildReportedQtyMap 的理由）
  const reportedQtyMap = buildReportedQtyMap(groupRows)
  for (const row of rows.values()) {
    row.reportedQty = lookupReportedQty(reportedQtyMap, row)
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      // 钻取配方（变更-140）：告诉弹窗这两段明细各按什么查
      drill: {
        inbound: { materialCode: row.materialCode, materialName: row.materialName, multiplier: 1 },
        // 工单侧也按**编码**查：入库名常是长包材名，工单名是短名，按名称查会一条都查不到
        workorder: { materialCode: row.materialCode, materialName: row.materialName, multiplier: 1 },
      },
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
 *
 * ⚠️ 2026-10-10 整改：三个入参都改成**服务端汇总结果**（领料按物料汇总、
 * 货物移动按「物料 + 来源库位」汇总）—— 那两条明细都改后端分页了，前端手里不再有全量。
 *
 * 字段名刻意沿用明细那套（materialName / materialCode / pickQty / moveQty / fromLocation），
 * 所以**下面这套换算与派生一行没动**：换算系数、派生行、差额与排序都是报表口径，不属于数据源。
 */
/**
 * 投料汇总（按物料）—— 原辅料核算的「投料数」来源（2026-10-31，变更-172 续）。
 *
 * 使用方报的现象：「乙炔工单的报工项里有次氯酸钠和无水氯化钙，但核算里没有」。
 * 查库确认：这两个料 10 月**有 261 投料**、但**没有领料单**（领料只到 9 月），
 * 而这张表原来**由领料汇总驱动** ⇒ 它们根本不出现。
 *
 * 现在改成「领料 ∪ 投料」的并集，并单独给一列投料数 ——
 * 让"投了没领"（账外料）在表上直接可见，这正是对账要抓的。
 */
const issueSummaryRows = ref([])

/** 拉投料汇总（日期区间与其它三张表同一套） */
export async function fetchIssueSummary({ startDate, endDate } = {}) {
  try {
    const res = await request.get('/api/movement/issue-summary', {
      params: {
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      },
    })
    const body = res.data || {}
    const list = Array.isArray(body.data) ? body.data : []
    issueSummaryRows.value = list
  } catch {
    // 投料拿不到就退化成"只按领料"（原行为），不把整张表打空
    issueSummaryRows.value = []
  }
}

export function buildMaterialCostingRows({
  pickRecords,
  goodsMoveQtyMap,
  goodsMoveRecords,
  issueRecords,
} = {}) {
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
    const pickFactor = MATERIAL_COSTING_QTY_FACTORS[code] ?? 1

    // 领料数乘以该物料的换算系数（无配置则为 1）
    row.pickQty *= pickFactor
    // 已报工数按物料编码汇总货物移动数量，先求和再取绝对值
    row.reportedQty = Math.abs(goodsMoveQtyMap?.get(code) || 0)

    /*
     * 钻取配方（变更-140）：基础行的明细就是"按编码查、不换算"。
     * 弹窗要乘的系数必须和这里的算式**同源**，否则明细合计永远对不上行上的数字
     * （2026-10-21 实测踩过：派生行漏了 ×1000 与库位筛选，明细 75 vs 行上 25）。
     */
    row.drill = {
      pick: { materialCode: code, materialName: row.materialName, multiplier: pickFactor },
      move: { materialCode: code, multiplier: 1 },
    }
  }

  /*
   * 投料（变更-172 续）：按物料编码把投料并进同一张表。
   * ① 已有行（这个月领过料）：补上 issueQty；
   * ② 新行（这个月只投料、没领料）：插一行，pickQty=0 —— 这就是"账外料"，
   *    以前它们根本不出现，使用者以为丢了。
   */
  const issueByCode = new Map()
  for (const record of issueRecords || []) {
    const code = String(record.materialCode ?? '').trim()
    if (!code) continue
    issueByCode.set(code, (issueByCode.get(code) || 0) + (Number(record.qty) || 0))
  }

  for (const row of rows.values()) {
    const code = String(row.materialCode ?? '').trim()
    row.issueQty = issueByCode.get(code) || 0
  }

  for (const [code, qty] of issueByCode.entries()) {
    const exists = [...rows.values()].some((row) => String(row.materialCode ?? '').trim() === code)
    if (exists) continue
    const record = (issueRecords || []).find(
      (it) => String(it.materialCode ?? '').trim() === code,
    )
    rows.set(`issue:${code}`, {
      materialName: String(record?.materialDesc ?? code).trim(),
      materialCode: code,
      pickQty: 0,
      reportedQty: Math.abs(goodsMoveQtyMap?.get(code) || 0),
      issueQty: qty,
      // 只有投料、没有领料 ⇒ 领料明细为空，钻取时给空编码（弹窗会显示"没有匹配"）
      drill: {
        pick: { materialCode: '', materialName: '', multiplier: 1 },
        move: { materialCode: code, multiplier: 1 },
      },
    })
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
      // 派生行的明细来自**另一个**物料：领料看源物料 ×系数；报工看派生编码 + 指定库位 ×系数
      drill: {
        pick: {
          materialCode: derived.sourceMaterialCode,
          materialName: derived.sourceMaterialName,
          multiplier: derived.qtyMultiplier ?? 1,
        },
        move: {
          materialCode: derived.materialCode,
          fromLocation: derived.fromLocation,
          multiplier: derived.reportedMultiplier ?? 1,
        },
      },
    })
  }

  return (
    [...rows.values()]
      .map((row) => ({
        ...row,
        pickQty: formatQty(row.pickQty),
        issueQty: formatQty(row.issueQty ?? 0),
        reportedQty: formatQty(row.reportedQty),
        unreportedQty: formatQty(row.pickQty - row.reportedQty),
        // 差额 = 投料 − 领料：负数是"投了没领"（账外料），正数是"领了没投"
        issueDiffQty: formatQty((row.issueQty ?? 0) - row.pickQty),
      }))
      // 领料 / 投料 / 报工三者都为 0 的行不展示（如派生行缺少对应数据）
      .filter(
        (row) => row.pickQty !== 0 || row.reportedQty !== 0 || (row.issueQty ?? 0) !== 0,
      )
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
 *
 * ⚠️ 2026-10-10 整改：喂进来的不再是「全量明细数组」，而是**服务端按同一套筛选条件
 * 分好组的结果**（四张明细表都改后端分页了，前端手里只剩当前页）。口径没变：
 * 仍然是「汇总面板当前筛选后」的那一批数据，只是聚合动作从浏览器搬到了服务端。
 */
export function useStatsData() {
  const { workOrderSummaryRows } = useWorkOrderData()
  const { inboundSummaryRows } = useInboundData()
  const { pickSummaryRows } = usePickData()
  const { goodsMoveSummaryRows, goodsMoveQtyMap } = useGoodsMoveData()

  const reportRows = computed(() => buildReportRows(workOrderSummaryRows.value))

  const costingRows = computed(() =>
    buildCostingRows(inboundSummaryRows.value, workOrderSummaryRows.value),
  )

  const materialCostingRows = computed(() =>
    buildMaterialCostingRows({
      pickRecords: pickSummaryRows.value,
      goodsMoveQtyMap: goodsMoveQtyMap.value,
      goodsMoveRecords: goodsMoveSummaryRows.value,
      issueRecords: issueSummaryRows.value,
    }),
  )

  return { reportRows, costingRows, materialCostingRows }
}
