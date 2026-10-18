import { beforeEach, describe, expect, it } from 'vitest'
import { hydrateOrderFilterFromQuery } from '../../src/composables/useOrderFilterUrl.js'
import { readQuery } from '../../src/composables/urlQuery.js'
import { orderEndDate, orderStartDate, orderTypeFilter } from '../../src/composables/useOrderFilter.js'

/**
 * 工单组筛选 ⇄ 地址栏（变更-116）。
 *
 * 使用方的原话是"我不太懂…用大白话" —— 所以这条功能的验收标准也只有一句大白话：
 * **条件改好，按 F5 刷新，条件还在。**
 *
 * 这里测的是"地址栏 → 状态"那半条链路（`hydrateOrderFilterFromQuery`）：
 * 它是刷新后能不能恢复条件的唯一决定点。反方向（状态 → 地址栏）由
 * `useOrderFilterUrl` 的 watch 完成，行为在用浏览器验收，没有在这里重复造路由。
 */

const at = (path, query = {}) => ({ path, query })

beforeEach(() => {
  // 模块作用域的状态是跨用例共享的，每个用例开头先归零
  orderStartDate.value = '2026-10-01'
  orderEndDate.value = '2026-10-18'
  orderTypeFilter.value = ''
})

describe('地址栏里的筛选条件', () => {
  it('URL 三个参数齐全 → 三个状态全部还原（刷新不丢条件）', () => {
    hydrateOrderFilterFromQuery(
      at('/orders', { start: '2026-09-01', end: '2026-09-30', type: '包装工单' }),
    )
    expect(orderStartDate.value).toBe('2026-09-01')
    expect(orderEndDate.value).toBe('2026-09-30')
    expect(orderTypeFilter.value).toBe('包装工单')
  })

  it('URL 只带日期、没带类型 → 类型保持原样（不被清空）', () => {
    orderTypeFilter.value = '操作工单'
    hydrateOrderFilterFromQuery(at('/orders/picking', { start: '2026-08-01', end: '2026-08-31' }))
    expect(orderStartDate.value).toBe('2026-08-01')
    expect(orderTypeFilter.value).toBe('操作工单')
  })

  it('不在工单组的页面 → 一概不动（粘错链接不污染工单组）', () => {
    hydrateOrderFilterFromQuery(at('/materials', { start: '2020-01-01', end: '2020-01-02' }))
    expect(orderStartDate.value).toBe('2026-10-01')
    expect(orderEndDate.value).toBe('2026-10-18')
  })

  it('四个工单页共享同一份条件（切页不重置）', () => {
    for (const p of ['/orders', '/orders/picking', '/orders/inbound', '/orders/costing']) {
      hydrateOrderFilterFromQuery(at(p, { start: '2026-07-01', end: '2026-07-31' }))
      expect(orderStartDate.value, `${p} 没接住 URL 里的起始日期`).toBe('2026-07-01')
    }
  })
})

describe('readQuery', () => {
  it('缺参数 / 空串 / 数组 → 都退回默认值', () => {
    expect(readQuery(at('/orders'), 'start', 'x')).toBe('x')
    expect(readQuery(at('/orders', { start: '' }), 'start', 'x')).toBe('x')
    // vue-router 把重复参数解析成数组，这里也必须退回默认值而不是拿数组去当日期
    expect(readQuery(at('/orders', { start: ['a', 'b'] }), 'start', 'x')).toBe('x')
  })

  it('有值就原样返回', () => {
    expect(readQuery(at('/orders', { start: '2026-10-01' }), 'start')).toBe('2026-10-01')
  })
})
