import { describe, expect, it } from 'vitest'
import {
  buildPurchaseQuery,
  usePurchaseTracking,
} from '../../src/composables/usePurchaseTracking.js'
import {
  EXPENSE_COLUMNS,
  EXPENSE_ORDER_TYPES,
  effectiveOrderType,
  groupExpenseBoardByOa,
  inferOrderType,
} from '../../src/components/purchase/boardGroups.js'

/*
 * 费用申请看板（2026-11-10，变更-182）。
 *
 * 使用方逐条定的口径，全部钉在这里：
 *   · 采购申请(CGSQ) 留采购看板；资产申购(ZCSG) + 服务采购申请(FWCGSQ) 归这一页
 *   · 三列 = 待提单(没 OA 单号) / 待验收(有单号、验收单号空) / 已验收(验收单号非空)
 *   · 已验收只展开最近 30 天，更早的折叠成一句提示（staleCount）
 *   · 没有"超期"这一列，也不按急慢排序（待提单按提出日、待验收按到货日、已验收按办完日倒序）
 *   · 单号带 CGSQ/FWCGSQ/ZCSG 而 order_type 空着的老数据，按单号推断，不能两边都不认
 */

const TODAY = new Date(2026, 10, 10) // 2026-11-10，本地日

function row(over = {}) {
  return {
    id: 1,
    oaNo: 'F-ZCSG-20261100001',
    oaUrl: '',
    orderType: 'ZCSG',
    requester: '章主任',
    requestDate: '2026-11-01',
    requiredArrivalDate: '2026-11-15',
    materialName: '物料',
    quantity: 1,
    unit: '台',
    status: 'WAITING',
    acceptanceNo: '',
    ...over,
  }
}

describe('费用申请：三列口径', () => {
  it('三列就是待提单 / 待验收 / 已验收，且没有超期列', () => {
    expect(EXPENSE_COLUMNS.map((c) => c.label)).toEqual(['待提单', '待验收', '已验收'])
    expect(EXPENSE_COLUMNS.some((c) => c.label.includes('超期'))).toBe(false)
  })

  it('没 OA 单号 → 待提单；有单号没验收单号 → 待验收；有验收单号 → 已验收', () => {
    const { columns, staleCount } = groupExpenseBoardByOa(
      [
        row({ id: 1, oaNo: '', orderType: '' }),
        row({ id: 2, oaNo: 'CG-CGSQ-20261022006' }),
        row({ id: 3, oaNo: 'F-ZCSG-20261000002', acceptanceNo: 'YS-001' }),
      ],
      TODAY,
    )
    expect(columns.map((c) => c.key)).toEqual(['pendingOa', 'toAccept', 'accepted'])
    expect(columns[0].rowCount).toBe(1)
    expect(columns[1].rowCount).toBe(1)
    expect(columns[2].rowCount).toBe(1)
    expect(staleCount).toBe(0)
  })

  it('三列合计 = 输入行数（不丢行）：到没到货都算待验收', () => {
    const rows = [
      row({ id: 1, oaNo: '', orderType: '' }),
      row({ id: 2, status: 'ARRIVED' }),
      row({ id: 3, status: 'PARTIAL', oaNo: 'F-ZCSG-20261000003' }),
      row({ id: 4, acceptanceNo: 'YS-1', status: 'ARRIVED' }),
    ]
    const { columns } = groupExpenseBoardByOa(rows, TODAY)
    expect(columns.reduce((n, c) => n + c.rowCount, 0)).toBe(rows.length)
  })

  it('同一张 OA 的多条物料只算一张卡', () => {
    const { columns } = groupExpenseBoardByOa(
      [
        row({ id: 1, oaNo: 'F-ZCSG-20261100001' }),
        row({ id: 2, oaNo: 'F-ZCSG-20261100001', materialName: '第二种料' }),
      ],
      TODAY,
    )
    const toAccept = columns.find((c) => c.key === 'toAccept')
    expect(toAccept.cardCount).toBe(1)
    expect(toAccept.rowCount).toBe(2)
    expect(toAccept.cards[0].count).toBe(2)
  })
})

describe('费用申请：已验收 30 天窗口', () => {
  it('30 天内的留在列里，更早的只计数、不进列', () => {
    const { columns, staleCount } = groupExpenseBoardByOa(
      [
        row({ id: 1, oaNo: 'A-1', acceptanceNo: 'YS-1', actualArrivalDate: '2026-11-05' }),
        row({ id: 2, oaNo: 'A-2', acceptanceNo: 'YS-2', actualArrivalDate: '2026-09-01' }),
        row({ id: 3, oaNo: 'A-3', acceptanceNo: 'YS-3', actualArrivalDate: '2026-08-01' }),
      ],
      TODAY,
    )
    const accepted = columns.find((c) => c.key === 'accepted')
    expect(accepted.rowCount).toBe(1)
    expect(staleCount).toBe(2)
  })

  it('恰好 30 天算近期（边界不往"藏起来"那边偏）', () => {
    const { columns, staleCount } = groupExpenseBoardByOa(
      [row({ oaNo: 'A-1', acceptanceNo: 'YS-1', actualArrivalDate: '2026-10-11' })],
      TODAY,
    )
    expect(columns.find((c) => c.key === 'accepted').rowCount).toBe(1)
    expect(staleCount).toBe(0)
  })

  it('没有到货日就退到提出日判断窗口，不因为缺日期被藏起来', () => {
    const { columns } = groupExpenseBoardByOa(
      [row({ oaNo: 'A-1', acceptanceNo: 'YS-1', actualArrivalDate: '', requestDate: '2026-11-08' })],
      TODAY,
    )
    expect(columns.find((c) => c.key === 'accepted').rowCount).toBe(1)
  })
})

describe('费用申请：单据类型归属', () => {
  it('认两种单据类型', () => {
    expect(EXPENSE_ORDER_TYPES).toEqual(['ZCSG', 'FWCGSQ'])
  })

  it('按单号推断类型（老数据 order_type 空着）', () => {
    expect(inferOrderType('F-ZCSG-20261000008')).toBe('ZCSG')
    expect(inferOrderType('F-FWCGSQ-20261109003')).toBe('FWCGSQ')
    expect(inferOrderType('CG-CGSQ-20261022006')).toBe('CGSQ')
    expect(inferOrderType('')).toBe('')
  })

  it('填了类型就用填的，不拿单号去猜', () => {
    expect(effectiveOrderType({ orderType: 'ZCSG', oaNo: 'CG-CGSQ-1' })).toBe('ZCSG')
    expect(effectiveOrderType({ orderType: '', oaNo: 'CG-CGSQ-1' })).toBe('CGSQ')
  })
})

describe('费用申请：列内排序', () => {
  it('待提单按提出日早的在上；待验收按要求到货日早的在上', () => {
    const { columns } = groupExpenseBoardByOa(
      [
        row({ id: 1, oaNo: '', orderType: '', requestDate: '2026-11-05' }),
        row({ id: 2, oaNo: '', orderType: '', requestDate: '2026-10-20' }),
        row({ id: 3, oaNo: 'B-1', requiredArrivalDate: '2026-12-01' }),
        row({ id: 4, oaNo: 'B-2', requiredArrivalDate: '2026-11-12' }),
      ],
      TODAY,
    )
    expect(columns[0].cards.map((c) => c.lead.id)).toEqual([2, 1])
    expect(columns[1].cards.map((c) => c.lead.id)).toEqual([4, 3])
  })
})

describe('费用申请：台账请求口径（页面边界不能被筛选条改掉）', () => {
  /*
   * 费用申请页的「录入 / 历史」也必须只看见这两类单据。
   * 发的是逗号串（`orderTypes=ZCSG,FWCGSQ`），与 `statuses` 同一套写法 ——
   * 数组会被 axios 序列化成 `orderTypes[]=`，Spring 绑不上、筛选静默失效。
   */
  it('锁定两种类型时发 orderTypes 逗号串，且不再发单值 orderType', async () => {
    const { setFixedOrderTypes, orderTypeFilter } = usePurchaseTracking()
    try {
      setFixedOrderTypes(EXPENSE_ORDER_TYPES)
      orderTypeFilter.value = 'CGSQ' // 筛选条里残留的值不该把页面边界改掉
      const params = buildPurchaseQuery(false)
      expect(params.orderTypes).toBe('ZCSG,FWCGSQ')
      expect(params).not.toHaveProperty('orderType')
    } finally {
      setFixedOrderTypes([])
      orderTypeFilter.value = ''
    }
  })

  it('不锁类型（采购工作台）时仍按筛选条发单值', async () => {
    const { setFixedOrderTypes, orderTypeFilter } = usePurchaseTracking()
    try {
      setFixedOrderTypes([])
      orderTypeFilter.value = 'FWCGSQ'
      expect(buildPurchaseQuery(false)).toMatchObject({ orderType: 'FWCGSQ' })
    } finally {
      orderTypeFilter.value = ''
    }
  })
})
