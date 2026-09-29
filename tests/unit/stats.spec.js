import { describe, it, expect } from 'vitest'
import {
  buildCostingRows,
  buildMaterialCostingRows,
  buildReportedQtyMap,
  buildReportRows,
} from '../../src/composables/useStatsData'

describe('buildReportRows：工单报工汇总', () => {
  it('按 工单类型 + 产成品 分组求和', () => {
    const rows = buildReportRows([
      { orderNo: '1000001', materialDesc: 'HND-V150', orderQty: 10, confirmedQty: 8 },
      { orderNo: '1000002', materialDesc: 'HND-V150', orderQty: 5, confirmedQty: 5 },
      { orderNo: '2000003', materialDesc: 'HND-V150', orderQty: 1, confirmedQty: 1 },
    ])

    expect(rows).toEqual([
      { orderType: '操作工单', materialDesc: 'HND-V150', orderQty: 15, confirmedQty: 13 },
      { orderType: '包装工单', materialDesc: 'HND-V150', orderQty: 1, confirmedQty: 1 },
    ])
  })

  it('前缀识别不出工单类型、或产成品为空的行直接跳过', () => {
    const rows = buildReportRows([
      { orderNo: '9000001', materialDesc: 'HND-V150', orderQty: 10, confirmedQty: 10 },
      { orderNo: '1000001', materialDesc: '   ', orderQty: 10, confirmedQty: 10 },
    ])

    expect(rows).toEqual([])
  })

  it('数量字段缺失/非数字按 0 计，浮点误差被消掉', () => {
    const rows = buildReportRows([
      { orderNo: '1000001', materialDesc: 'A', orderQty: 0.1, confirmedQty: undefined },
      { orderNo: '1000002', materialDesc: 'A', orderQty: 0.2, confirmedQty: 'x' },
    ])

    expect(rows[0].orderQty).toBe(0.3)
    expect(rows[0].confirmedQty).toBe(0)
  })

  it('同类型内按产成品名称排序（工单类型按常量表顺序）', () => {
    const rows = buildReportRows([
      { orderNo: '3000001', materialDesc: 'B', orderQty: 1, confirmedQty: 1 },
      { orderNo: '1000001', materialDesc: 'B', orderQty: 1, confirmedQty: 1 },
      { orderNo: '1000002', materialDesc: 'A', orderQty: 1, confirmedQty: 1 },
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

describe('buildReportedQtyMap：已报工数按归一化产成品名汇总', () => {
  it('忽略空格/下划线差异', () => {
    const map = buildReportedQtyMap([
      { materialDesc: '氯铂酸_150', confirmedQty: 2 },
      { materialDesc: '氯铂酸 150', confirmedQty: 3 },
      { materialDesc: '', confirmedQty: 9 },
    ])

    expect(map.get('氯铂酸150')).toBe(5)
    expect(map.size).toBe(1)
  })
})

describe('buildCostingRows：工单核算（入库口径）', () => {
  it('以入库物料为行，未报工数 = 入库数 − 已报工数', () => {
    const rows = buildCostingRows(
      [{ materialName: 'HND-V150', materialCode: 'C1', inboundQty: 100 }],
      [{ materialDesc: 'HND-V150', confirmedQty: 40 }],
    )

    expect(rows).toEqual([
      {
        materialName: 'HND-V150',
        materialCode: 'C1',
        inboundQty: 100,
        reportedQty: 40,
        unreportedQty: 60,
      },
    ])
  })

  it('名称归一化只忽略空格/下划线，连字符差异匹配不上（对不上就是 0）', () => {
    const rows = buildCostingRows(
      [{ materialName: 'HND-V150', inboundQty: 10 }],
      [{ materialDesc: 'HND V150', confirmedQty: 40 }],
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
      [{ orderNo: '1000001', materialDesc: 'A', confirmedQty: 15 }],
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

    expect(rows).toEqual([
      {
        materialName: '三氯氢硅',
        materialCode: 'X1',
        pickQty: 15,
        reportedQty: 12,
        unreportedQty: 3,
      },
    ])
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
