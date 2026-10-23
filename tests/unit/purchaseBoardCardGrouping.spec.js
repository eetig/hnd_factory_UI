import { describe, expect, it } from 'vitest'
import {
  groupBoardByOa,
  groupCardsByOa,
  requesterSummary,
} from '../../src/components/purchase/boardGroups.js'

/*
 * 看板按 OA 单号合并卡片（2026-10-23，变更-168）。
 *
 * 使用方：「通常一个 OA 单号对应多个卡片，这样可以做成一个卡片」。
 * 线上真实数据里 6 条待处理有 5 条共用同一个 OA —— 那本来是一件事。
 *
 * 合并口径（使用方逐条确认）：
 *   · 分组键 = oaNo；没有单号的行各自一张
 *   · 卡片归哪一列 = 组内**最急**那条的状态（超期 > 临期 > 待提单 > 等货 > 已到货）
 *   · 卡面「要求到货」取组内**最早**的日期
 *   · 需求人去重；超过 1 人显示「张主任 等 2 人」
 *   · 列头给 卡片数 · 物料条数
 */

const SAME_OA = 'CG-CGSQ-20261022006'
const OA_URL = 'https://ekp.batf.cn/km/review/km_review_main/kmReviewMain.do?method=view&fdId=abc'

function row(over = {}) {
  return {
    id: 1,
    oaNo: SAME_OA,
    oaUrl: OA_URL,
    materialName: '物料',
    quantity: 1,
    unit: '台',
    status: 'WAITING',
    requiredArrivalDate: '2026-11-01',
    requester: '段佳林',
    requestDate: '2026-10-20',
    ...over,
  }
}

describe('按 OA 合并卡片', () => {
  it('同一个 OA 的多条物料合并成一张卡，条数正确', () => {
    const cards = groupCardsByOa([
      row({ id: 1 }),
      row({ id: 2, materialName: '磁力泵中体' }),
      row({ id: 3, materialName: '防爆磁力起动器' }),
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0].count).toBe(3)
    expect(cards[0].rows.map((r) => r.materialName)).toContain('磁力泵中体')
  })

  it('没有 OA 单号的行各自一张卡（不硬凑）', () => {
    const cards = groupCardsByOa([
      row({ id: 1, oaNo: '', oaUrl: '' }),
      row({ id: 2, oaNo: '', oaUrl: '' }),
      row({ id: 3 }),
    ])
    expect(cards).toHaveLength(3)
  })

  it('组内第一条 = 最急的那条（超期 优先于 等货）', () => {
    const cards = groupCardsByOa([
      row({ id: 1, status: 'WAITING', daysToDue: 6 }),
      row({ id: 2, status: 'OVERDUE', overdueDays: 3, requiredArrivalDate: '2026-10-20' }),
      row({ id: 3, status: 'DUE_SOON', daysToDue: 2 }),
    ])
    expect(cards[0].lead.id).toBe(2)
    expect(cards[0].rows[0].id).toBe(2)
  })

  it('组内"待提单"比"等货"更急（待提单没有到货日期，不能靠日期排序）', () => {
    const cards = groupCardsByOa([
      row({ id: 1, status: 'WAITING', daysToDue: 6, requiredArrivalDate: '2026-10-25' }),
      row({ id: 2, status: 'PENDING_OA', daysToDue: null, requiredArrivalDate: '' }),
    ])
    expect(cards[0].lead.status).toBe('PENDING_OA')
    // 整组因此归到「待提单」列
    const cols = groupBoardByOa([
      row({ id: 1, status: 'WAITING', daysToDue: 6, requiredArrivalDate: '2026-10-25' }),
      row({ id: 2, status: 'PENDING_OA', daysToDue: null, requiredArrivalDate: '' }),
    ])
    expect(cols.find((c) => c.key === 'pendingOa').cardCount).toBe(1)
  })
  it('卡面要求到货取最早的那天（没填日期的排在后面）', () => {
    const cards = groupCardsByOa([
      row({ id: 1, requiredArrivalDate: '2026-11-01' }),
      row({ id: 2, requiredArrivalDate: '' }),
      row({ id: 3, requiredArrivalDate: '2026-10-25' }),
    ])
    expect(cards[0].earliestArrival).toBe('2026-10-25')
  })

  it('同一 OA 里任一条有链接，整张卡就有链接（某条漏填不至于点不开）', () => {
    const cards = groupCardsByOa([row({ id: 1, oaUrl: '' }), row({ id: 2 })])
    expect(cards[0].oaUrl).toBe(OA_URL)
  })

  it('需求人：1 人直接显示，多人显示「张主任 等 2 人」，都没有显示未填', () => {
    expect(requesterSummary(['段佳林'])).toBe('段佳林')
    expect(requesterSummary(['张主任', '段佳林'])).toBe('张主任 等 2 人')
    expect(requesterSummary([])).toBe('未填需求人')
  })

  it('需求人去重（同一人提的多条不重复计数）', () => {
    const cards = groupCardsByOa([row({ id: 1, requester: '张主任' }), row({ id: 2, requester: '张主任' })])
    expect(cards[0].requesters).toEqual(['张主任'])
    expect(requesterSummary(cards[0].requesters)).toBe('张主任')
  })
})

describe('整组归列 + 列头计数', () => {
  it('组内最急那条决定列：混着等货与超期 → 进「超期」列', () => {
    const cols = groupBoardByOa([
      row({ id: 1, status: 'WAITING', daysToDue: 6 }),
      row({ id: 2, status: 'OVERDUE', overdueDays: 3 }),
    ])
    const overdue = cols.find((c) => c.key === 'overdue')
    const waiting = cols.find((c) => c.key === 'waiting')
    expect(overdue.cardCount).toBe(1)
    expect(waiting.cardCount).toBe(0)
  })

  it('列头同时给 卡片数 与 物料条数（1 张卡 3 条料 ≠ 3 张卡）', () => {
    const cols = groupBoardByOa([
      row({ id: 1 }),
      row({ id: 2 }),
      row({ id: 3 }),
    ])
    const waiting = cols.find((c) => c.key === 'waiting')
    expect(waiting.cardCount).toBe(1)
    expect(waiting.rowCount).toBe(3)
  })

  it('多张卡按"组内最急那条"排：超期天数大的卡在前', () => {
    const cols = groupBoardByOa([
      row({ id: 1, oaNo: 'A', status: 'OVERDUE', overdueDays: 1 }),
      row({ id: 2, oaNo: 'B', status: 'OVERDUE', overdueDays: 9 }),
    ])
    const overdue = cols.find((c) => c.key === 'overdue')
    expect(overdue.cards.map((c) => c.oaNo)).toEqual(['B', 'A'])
  })
})
