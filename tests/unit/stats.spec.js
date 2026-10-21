import { describe, it, expect } from 'vitest'
import {
  buildCostingRows,
  buildMaterialCostingRows,
  buildReportedQtyMap,
  lookupReportedQty,
  buildReportRows,
} from '../../src/composables/useStatsData'

// ⚠️ 2026-10-10 整改：工单报工/工单核算的**分组求和搬到了服务端**
// （`/api/work-order/summary-by-type-material`，按工单号前缀 + 产成品 GROUP BY），
// 因为工单列表改成后端分页后前端只剩当前页，拿它分组求和会得出「前 10 条的合计」。
//
// 所以这几个 build* 的入参从「明细数组」变成了「已分组的行数组」，
// 本文件随之改为钉住**展示口径**（排序、空值兜底、数值格式化、名称归一化匹配）；
// 「分组求和本身对不对」改由后端保证，另有 hnd_factory 的
// WorkOrderServiceSummaryTest 钉住分组维度与前缀→类型名的映射。
describe('buildReportRows：工单报工汇总', () => {
  it('直接展示服务端分好组的行（数量是字符串也要能显示）', () => {
    const rows = buildReportRows([
      { typeKey: 'operate', orderType: '操作工单', materialName: 'HND-V150', orderQty: 15, confirmedQty: 13 },
      { typeKey: 'package', orderType: '包装工单', materialName: 'HND-V150', orderQty: 1, confirmedQty: 1 },
    ])

    expect(rows).toEqual([
      { orderType: '操作工单', typeKey: 'operate', materialDesc: 'HND-V150', orderQty: 15, orderQtyRaw: 15, confirmedQty: 13 },
      { orderType: '包装工单', typeKey: 'package', materialDesc: 'HND-V150', orderQty: 1, orderQtyRaw: 1, confirmedQty: 1 },
    ])
  })

  it('工单类型识别不出的行直接跳过（服务端给空 orderType）', () => {
    const rows = buildReportRows([
      { typeKey: '', orderType: '', materialName: 'HND-V150', orderQty: 10, confirmedQty: 10 },
      { typeKey: 'operate', orderType: '操作工单', materialName: 'HND-V150', orderQty: 1, confirmedQty: 1 },
    ])

    expect(rows).toEqual([
      { orderType: '操作工单', typeKey: 'operate', materialDesc: 'HND-V150', orderQty: 1, orderQtyRaw: 1, confirmedQty: 1 },
    ])
  })

  it('数量字段缺失/非数字按 0 计，浮点误差被消掉', () => {
    const rows = buildReportRows([
      { orderType: '操作工单', materialName: 'A', orderQty: 0.30000000000000004, confirmedQty: undefined },
      { orderType: '操作工单', materialName: 'B', orderQty: 1, confirmedQty: 'x' },
    ])

    expect(rows[0].orderQty).toBe(0.3)
    expect(rows[0].confirmedQty).toBe(0)
    expect(rows[1].confirmedQty).toBe(0)
  })

  it('同类型内按产成品名称排序（工单类型按常量表顺序）', () => {
    const rows = buildReportRows([
      { orderType: '转桶工单', materialName: 'B', orderQty: 1, confirmedQty: 1 },
      { orderType: '操作工单', materialName: 'B', orderQty: 1, confirmedQty: 1 },
      { orderType: '操作工单', materialName: 'A', orderQty: 1, confirmedQty: 1 },
    ])

    expect(rows.map((row) => `${row.orderType}/${row.materialDesc}`)).toEqual([
      '操作工单/A',
      '操作工单/B',
      '转桶工单/B',
    ])
  })

  it('空输入返回空数组', () => {
    expect(buildReportRows([])).toEqual([])
    expect(buildReportRows(undefined)).toEqual([])
  })
})

describe('buildReportedQtyMap：已报工数按【产成品编码】汇总，名称兜底（变更-140）', () => {
  it('名称兜底仍忽略空格/下划线差异', () => {
    const map = buildReportedQtyMap([
      { materialName: '氯铂酸_150', confirmedQty: 2 },
      { materialName: '氯铂酸 150', confirmedQty: 3 },
      { materialName: '', confirmedQty: 9 },
    ])

    expect(map.byName.get('氯铂酸150')).toBe(5)
    expect(map.byName.size).toBe(1)
  })

  it('同样的名称、不同的编码不再混算（这是这次改动的全部理由）', () => {
    const map = buildReportedQtyMap([
      { materialName: '同名产品', materialCode: 'C1', confirmedQty: 10 },
      { materialName: '同名产品', materialCode: 'C2', confirmedQty: 4 },
    ])

    expect(map.byCode.get('C1')).toBe(10)
    expect(map.byCode.get('C2')).toBe(4)
    // 名称维度上仍会合起来（只作兜底，编码在时不会用到）
    expect(map.byName.get('同名产品')).toBe(14)
  })

  it('lookupReportedQty：编码优先，编码缺失才用名称', () => {
    const map = buildReportedQtyMap([
      { materialName: '产品甲', materialCode: 'C1', confirmedQty: 10 },
      { materialName: '产品乙', confirmedQty: 7 },
    ])

    // 编码命中：即使名称写得不一样也认
    expect(lookupReportedQty(map, { materialName: '产品甲(旧写法)', materialCode: 'C1' })).toBe(10)
    // 编码没命中 → 名称兜底
    expect(lookupReportedQty(map, { materialName: '产品乙', materialCode: 'C9' })).toBe(7)
    // 都对不上 → 0（不是"没数据"，是这行确实没有报工）
    expect(lookupReportedQty(map, { materialName: '产品丙', materialCode: 'C8' })).toBe(0)
  })
})

describe('buildCostingRows：按编码把报工数挂到入库行上', () => {
  it('入库行有编码、工单汇总有同名不同码时，按编码各归各的', () => {
    const rows = buildCostingRows(
      [{ materialName: '产品甲', materialCode: 'C1', inboundQty: 100 }],
      [
        { materialName: '产品甲', materialCode: 'C1', confirmedQty: 60 },
        { materialName: '产品甲', materialCode: 'C2', confirmedQty: 40 },
      ],
    )

    expect(rows[0].reportedQty).toBe(60)
    expect(rows[0].unreportedQty).toBe(40)
  })
})

describe('buildCostingRows：工单核算（入库口径）', () => {
  it('以入库物料为行，未报工数 = 入库数 − 已报工数', () => {
    const rows = buildCostingRows(
      [{ materialName: 'HND-V150', materialCode: 'C1', inboundQty: 100 }],
      [{ materialName: 'HND-V150', confirmedQty: 40 }],
    )

    // 行上多了一个 drill（钻取配方，变更-140），数值口径没变 —— 用 toMatchObject 钉数值那几项
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      materialName: 'HND-V150',
      materialCode: 'C1',
      inboundQty: 100,
      reportedQty: 40,
      unreportedQty: 60,
    })
    expect(rows[0].drill.inbound).toMatchObject({ materialCode: 'C1', materialName: 'HND-V150' })
    expect(rows[0].drill.workorder).toMatchObject({ materialName: 'HND-V150' })
  })

  it('名称归一化只忽略空格/下划线，连字符差异匹配不上（对不上就是 0）', () => {
    const rows = buildCostingRows(
      [{ materialName: 'HND-V150', inboundQty: 10 }],
      [{ materialName: 'HND V150', confirmedQty: 40 }],
    )

    expect(rows[0].reportedQty).toBe(0)
  })

  it('同名物料多行入库会累加，产成品名为空的行跳过', () => {
    const rows = buildCostingRows(
      [
        { materialName: 'A', materialCode: 'C1', inboundQty: 1 },
        { materialName: 'A', materialCode: 'C1', inboundQty: 2 },
        { materialName: '  ', materialCode: 'C2', inboundQty: 99 },
      ],
      [],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].inboundQty).toBe(3)
  })

  it('没有对应报工数据时已报工数为 0，未报工数为负也照实展示', () => {
    const rows = buildCostingRows(
      [{ materialName: 'A', inboundQty: 10 }],
      [{ materialName: 'A', confirmedQty: 15 }],
    )

    expect(rows[0].reportedQty).toBe(15)
    expect(rows[0].unreportedQty).toBe(-5)
  })
})

describe('buildMaterialCostingRows：原辅料核算（领料口径）', () => {
  it('领料数按物料名去重累加，已报工数取货物移动合计的绝对值', () => {
    const rows = buildMaterialCostingRows({
      pickRecords: [
        { materialName: '三氯氢硅', materialCode: 'X1', pickQty: 10 },
        { materialName: '三氯氢硅', materialCode: 'X1', pickQty: 5 },
      ],
      goodsMoveQtyMap: new Map([['X1', -12]]),
      goodsMoveRecords: [],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      materialName: '三氯氢硅',
      materialCode: 'X1',
      pickQty: 15,
      reportedQty: 12,
      unreportedQty: 3,
    })
  })

  it('配置了换算系数的物料（辅料包 ×3.2）领料数会被放大', () => {
    const rows = buildMaterialCostingRows({
      pickRecords: [{ materialName: 'HND-V150_辅料包', materialCode: '112004292', pickQty: 2 }],
      goodsMoveQtyMap: new Map(),
      goodsMoveRecords: [],
    })

    const row = rows.find((item) => item.materialName === 'HND-V150_辅料包')
    expect(row.pickQty).toBe(6.4)
  })

  it('派生行：领料数取自源物料 ×20，报工数按来源库位筛选货物移动 ×1000', () => {
    const rows = buildMaterialCostingRows({
      pickRecords: [{ materialName: 'HND-V150_辅料包', materialCode: '112004292', pickQty: 2 }],
      goodsMoveQtyMap: new Map(),
      goodsMoveRecords: [
        { materialCode: '111001792', fromLocation: '5003', moveQty: 0.002 },
        { materialCode: '111001792', fromLocation: '9999', moveQty: 100 }, // 库位不符，忽略
        { materialCode: '111001792', fromLocation: '5002', moveQty: 5 }, // 属于 _171 派生行
      ],
    })

    const row150 = rows.find((row) => row.materialName === '氯铂酸_150')
    const row171 = rows.find((row) => row.materialName === '氯铂酸_171')

    // 注意：源物料的换算系数（辅料包 ×3.2）先作用，再乘派生倍数 20，
    // 即 2 → 6.4 → 128。这是沿用原实现的行为，若要改成「原始领料数 ×20」
    // 需要先和业务确认口径（不改动逻辑的前提下这里把它固化成测试）。
    expect(row150.pickQty).toBe(128)
    expect(row150.reportedQty).toBe(2) // 0.002 × 1000
    // 没有 V171 辅料包领料 → 派生行领料数为 0，只剩报工数
    expect(row171.pickQty).toBe(0)
    expect(row171.reportedQty).toBe(5000)
  })

  it('领料数与报工数都为 0 的行不展示', () => {
    const rows = buildMaterialCostingRows({
      pickRecords: [],
      goodsMoveQtyMap: new Map([['X9', 0]]),
      goodsMoveRecords: [],
    })

    expect(rows).toEqual([])
  })

  it('空输入不抛异常', () => {
    expect(buildMaterialCostingRows()).toEqual([])
  })
})
