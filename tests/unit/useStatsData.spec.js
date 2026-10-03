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
describe('useStatsData：核算表跟随汇总面板的当前筛选', () => {
  const workOrder = useWorkOrderData()
  const inbound = useInboundData()
  const pick = usePickData()
  const goodsMove = useGoodsMoveData()
  const { costingRows, materialCostingRows } = useStatsData()

  const EMPTY_RANGE = { start: '2026-10-01', end: '2026-10-03' }

  beforeEach(() => {
    // 模块级单例：每个用例先把状态清干净
    workOrder.allWorkOrders.value = []
    workOrder.tableDataAll.value = []
    workOrder.startDate.value = EMPTY_RANGE.start
    workOrder.endDate.value = EMPTY_RANGE.end
    workOrder.productFilter.value = ''
    workOrder.orderTypeFilter.value = ''
    workOrder.orderNoFilter.value = ''

    inbound.allInboundRecords.value = []
    inbound.inboundFiltered.value = []
    inbound.inboundStartDate.value = EMPTY_RANGE.start
    inbound.inboundEndDate.value = EMPTY_RANGE.end
    inbound.inboundMaterialFilter.value = ''

    pick.allPickRecords.value = []
    pick.pickFiltered.value = []
    pick.pickStartDate.value = EMPTY_RANGE.start
    pick.pickEndDate.value = EMPTY_RANGE.end
    pick.pickMaterialFilter.value = ''

    goodsMove.goodsMoveRecords.value = []
  })

  it('工单核算：区间内没有入库记录时为空行（读全量会在空区间显示历史数据）', () => {
    inbound.allInboundRecords.value = [
      { materialName: 'HND-V150', materialCode: 'C1', inboundQty: 100, inboundDate: '2026-09-10' },
    ]
    inbound.filterInboundRecords()

    expect(costingRows.value).toEqual([])
  })

  it('工单核算：区间内的入库记录入行，已报工数只算工单汇总筛选后的工单', () => {
    inbound.allInboundRecords.value = [
      { materialName: 'HND-V150', materialCode: 'C1', inboundQty: 100, inboundDate: '2026-10-02' },
      { materialName: 'HND-V171', materialCode: 'C2', inboundQty: 50, inboundDate: '2026-09-10' },
    ]
    inbound.filterInboundRecords()

    workOrder.allWorkOrders.value = [
      { orderNo: '1000001', materialDesc: 'HND-V150', confirmedQty: 40, planStartDate: '2026-10-02' },
      // 区间外的工单不计入已报工数
      { orderNo: '1000002', materialDesc: 'HND-V150', confirmedQty: 999, planStartDate: '2026-09-10' },
    ]
    workOrder.filterWorkOrders()

    expect(costingRows.value).toEqual([
      {
        materialName: 'HND-V150',
        materialCode: 'C1',
        inboundQty: 100,
        reportedQty: 40,
        unreportedQty: 60,
      },
    ])
  })

  it('工单核算：入库汇总的物料筛选也传导过来（与工单报工同一口径）', () => {
    inbound.allInboundRecords.value = [
      { materialName: 'HND-V150', materialCode: 'C1', inboundQty: 100, inboundDate: '2026-10-02' },
      { materialName: 'HND-V171', materialCode: 'C2', inboundQty: 50, inboundDate: '2026-10-02' },
    ]
    inbound.inboundMaterialFilter.value = 'HND-V171'
    inbound.filterInboundRecords()

    expect(costingRows.value.map((row) => row.materialName)).toEqual(['HND-V171'])
  })

  it('原辅料核算：区间内没有领料记录时为空行（派生行也留不下来）', () => {
    pick.allPickRecords.value = [
      { materialName: '电石', materialCode: 'X1', pickQty: 100, pickDate: '2026-09-10' },
    ]
    pick.filterPickRecords()

    expect(materialCostingRows.value).toEqual([])
  })

  it('原辅料核算：区间内的领料记录入行，已报工数取货物移动', () => {
    pick.allPickRecords.value = [
      { materialName: '电石', materialCode: 'X1', pickQty: 100, pickDate: '2026-10-02' },
      { materialName: '三氯氢硅', materialCode: 'X2', pickQty: 7, pickDate: '2026-09-30' },
    ]
    pick.filterPickRecords()

    goodsMove.goodsMoveRecords.value = [{ materialCode: 'X1', moveQty: -60, moveDate: '2026-10-02' }]

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
