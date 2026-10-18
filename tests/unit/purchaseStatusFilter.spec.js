import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildPurchaseQuery,
  usePurchaseTracking,
} from '../../src/composables/usePurchaseTracking.js'

// 状态是**模块作用域**的 ref（四个页面共用一份），通过 composable 取出来：
// 直接 import 不行 —— 它只暴露在 usePurchaseTracking() 的返回对象里。
const { statusFilters, toggleStatus } = usePurchaseTracking()

/**
 * 采购需求的状态筛选**多选**（变更-118）。
 *
 * 使用方的原话是"状态筛选做多选"，验收标准一句话：
 * **点「超期」再点「临期」，两张状态的行一起出来。**
 *
 * 这里守两件事：
 *   ① 状态集合的增删语义（点一次加、再点一次减、「全部」清空）
 *   ② 发出去的参数形态 —— 必须是 `statuses=A,B`，
 *      **不能**是 `statuses[]=A`（Spring 绑不上，筛选会静默失效），
 *      也不能还发老的 `status=B`（后端兼容它，但前端不该再依赖）
 */

beforeEach(() => {
  statusFilters.value = []
})

describe('状态多选的集合语义', () => {
  it('点一次加入，再点一次移除', () => {
    toggleStatus('OVERDUE')
    expect(statusFilters.value).toEqual(['OVERDUE'])
    toggleStatus('DUE_SOON')
    expect(statusFilters.value).toEqual(['OVERDUE', 'DUE_SOON'])
    toggleStatus('OVERDUE')
    expect(statusFilters.value).toEqual(['DUE_SOON'])
  })

  it('「全部」（空字符串）清空所有已选', () => {
    toggleStatus('OVERDUE')
    toggleStatus('ARRIVED')
    toggleStatus('')
    expect(statusFilters.value).toEqual([])
  })

  it('重复点同一个状态不会重复入列', () => {
    toggleStatus('WAITING')
    toggleStatus('WAITING')
    toggleStatus('WAITING')
    expect(statusFilters.value).toEqual(['WAITING'])
  })
})

describe('发出去的参数', () => {
  it('多选发 statuses 逗号串，且不再发单值 status', () => {
    toggleStatus('OVERDUE')
    toggleStatus('DUE_SOON')
    const params = buildPurchaseQuery(false)
    expect(params.statuses).toBe('OVERDUE,DUE_SOON')
    // 关键：不能是数组（axios 会序列化成 statuses[]=…，Spring 绑不上）
    expect(Array.isArray(params.statuses)).toBe(false)
    expect(params).not.toHaveProperty('status')
  })

  it('一个都不选时压根不带 statuses 参数（空 = 不限，后端唯一入口）', () => {
    const params = buildPurchaseQuery(false)
    expect(params).not.toHaveProperty('statuses')
  })

  it('分页参数只在要分页时出现（汇总端点不收 pageNum/pageSize）', () => {
    expect(buildPurchaseQuery(true)).toHaveProperty('pageNum')
    const noPaging = buildPurchaseQuery(false)
    expect(noPaging).not.toHaveProperty('pageNum')
    expect(noPaging).not.toHaveProperty('pageSize')
  })
})