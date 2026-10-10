import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkOrderData } from '../../src/composables/useWorkOrderData'
import { useInboundData } from '../../src/composables/useInboundData'
import { usePickData } from '../../src/composables/usePickData'
import { useGoodsMoveData } from '../../src/composables/useGoodsMoveData'
import { useStatsData } from '../../src/composables/useStatsData'

// 变更-021：工单核算 / 原辅料核算喂的是各汇总面板「当前筛选后」的数据。
// 这里钉住的是接线（composable 之间），纯函数口径见 stats.spec.js。
// 回归场景：区间内汇总为空时，核算表必须是空的 —— 曾经它读接口全量，
// 空区间下还在显示历史数字。
//
// ⚠️ 2026-10-10 整改：喂进来的不再是「前端过滤后的全量明细数组」，而是**服务端按同一套
// 筛选条件分好组的结果**（四张明细表都改后端分页了，前端手里只剩当前页）。
// 口径没变 —— 仍然是「汇总面板当前筛选后」的那批数据，只是聚合动作从浏览器搬到了服务端。
// 「空区间不给历史数字」这条现在是**服务端**保证的（同一套条件过滤 + GROUP BY），
// 所以下面的用例改成往汇总数组里塞数据，验的是接线本身。
describe('useStatsData：核算表跟随汇总面板的当前筛选结果', () => {
  const workOrder = useWorkOrderData()
  const inbound = useInboundData()
  const pick = usePickData()
  const goodsMove = useGoodsMoveData()
  const { reportRows, costingRows, materialCostingRows } = useStatsData()

  beforeEach(() => {
    // 模块级单例：每个用例先把状态清干净
    workOrder.workOrderSummaryRows.value = []
    inbound.inboundSummaryRows.value = []
    pick.pickSummaryRows.value = []
    goodsMove.goodsMoveSummaryRows.value = []
  })

  it('工单报工：直接吃服务端按「类型 + 产成品」分好组的结果', () => {
    workOrder.workOrderSummaryRows.value = [
      { typeKey: 'operate', orderType: '操作工单', materialName: 'HND-V150', orderQty: 100, confirmedQty: 40 },
      // 前缀认不出类型的行不进表（服务端给的是空 typeKey/orderType）
      { typeKey: '', orderType: '', materialName: '脏数据', orderQty: 9, confirmedQty: 9 },
    ]

    expect(reportRows.value).toEqual([
      { orderType: '操作工单', materialDesc: 'HND-V150', orderQty: 100, confirmedQty: 40 },
    ])
  })

  it('工单核算：汇总为空时核算表为空（空区间不能显示历史数字）', () => {
    expect(costingRows.value).toEqual([])
  })

  it('工单核算：以入库汇总的行为行，已报工数取工单汇总的确认产量', () => {
    inbound.inboundSummaryRows.value = [
      { materialName: 'HND-V150', materialCode: 'C1', inboundQty: 100 },
      { materialName: 'HND-V171', materialCode: 'C2', inboundQty: 50 },
    ]
    workOrder.workOrderSummaryRows.value = [
      { typeKey: 'operate', orderType: '操作工单', materialName: 'HND-V150', orderQty: 60, confirmedQty: 40 },
    ]

    expect(costingRows.value).toEqual([
      {
        materialName: 'HND-V150',
        materialCode: 'C1',
        inboundQty: 100,
        reportedQty: 40,
        unreportedQty: 60,
      },
      // 没有对应报工的那一行：已报工数 0，未报工数就是入库数
      {
        materialName: 'HND-V171',
        materialCode: 'C2',
        inboundQty: 50,
        reportedQty: 0,
        unreportedQty: 50,
      },
    ])
  })

  it('原辅料核算：汇总为空时为空行（派生行也留不下来）', () => {
    expect(materialCostingRows.value).toEqual([])
  })

  it('原辅料核算：领料汇总为行，已报工数取货物移动汇总', () => {
    pick.pickSummaryRows.value = [{ materialName: '电石', materialCode: 'X1', pickQty: 100 }]
    goodsMove.goodsMoveSummaryRows.value = [{ materialCode: 'X1', fromLocation: '5001', moveQty: -60 }]

    expect(materialCostingRows.value).toEqual([
      {
        materialName: '电石',
        materialCode: 'X1',
        pickQty: 100,
        reportedQty: 60,
        unreportedQty: 40,
      },
    ])
  })
})
