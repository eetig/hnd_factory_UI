import { describe, expect, it } from 'vitest'
import {
  BOARD_COLUMNS,
  requestAgeLabel,
  OPEN_STATUSES,
  columnOfStatus,
  dueLabel,
  groupBoard,
  quantityText,
} from '../../src/components/purchase/boardGroups.js'

/**
 * 采购看板的分组与排序（变更-148）。
 *
 * 看板的价值在于"一眼看出今天该催谁"，所以这里守的是**归位**与**顺序**：
 * 一张超期的卡跑到「等货」列里、或者最急的卡排在列表最下面，看板就废了 ——
 * 而这两种错误在界面上都不显眼（图看着挺正常）。
 */

const row = (over = {}) => ({
  id: 1,
  materialName: '球阀',
  status: 'WAITING',
  quantity: 1,
  unit: '台',
  requiredArrivalDate: '2026-10-20',
  overdueDays: null,
  daysToDue: 5,
  ...over,
})

describe('状态 → 列的映射', () => {
  it('6 个派生状态都归到 4 列里，没有落单的', () => {
    const map = {
      PENDING_OA: 'pendingOa',
      WAITING: 'waiting',
      DUE_SOON: 'waiting',
      OVERDUE: 'overdue',
      ARRIVED: 'arrived',
      PARTIAL: 'arrived',
    }
    for (const [status, col] of Object.entries(map)) {
      expect(columnOfStatus(status), `${status} 应该落在 ${col} 列`).toBe(col)
    }
  })

  it('大小写/空值/脏值不会报错，只返回 null', () => {
    expect(columnOfStatus('waiting')).toBe('waiting')
    expect(columnOfStatus('')).toBeNull()
    expect(columnOfStatus(undefined)).toBeNull()
    expect(columnOfStatus('不存在的状态')).toBeNull()
  })

  it('看板只有 4 列（6 列在 1280 下每列不到 200px，卡片会被挤成一行）', () => {
    expect(BOARD_COLUMNS).toHaveLength(4)
    expect(BOARD_COLUMNS.map((c) => c.label)).toEqual(['待提单', '等货', '超期', '已到货'])
  })

  it('默认只拉未到货的四个状态', () => {
    expect(OPEN_STATUSES).toEqual(['PENDING_OA', 'WAITING', 'DUE_SOON', 'OVERDUE'])
    expect(OPEN_STATUSES).not.toContain('ARRIVED')
    expect(OPEN_STATUSES).not.toContain('PARTIAL')
  })
})

describe('分组', () => {
  it('把行分到对应的列，空列也保留（列不能消失）', () => {
    const groups = groupBoard([
      row({ id: 1, status: 'PENDING_OA' }),
      row({ id: 2, status: 'OVERDUE', overdueDays: 3 }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['pendingOa', 'waiting', 'overdue', 'arrived'])
    expect(groups.find((g) => g.key === 'pendingOa').rows).toHaveLength(1)
    expect(groups.find((g) => g.key === 'waiting').rows).toHaveLength(0)
    expect(groups.find((g) => g.key === 'overdue').rows).toHaveLength(1)
  })

  it('认不出状态的行被丢掉（而不是塞进某一列冒充）', () => {
    const groups = groupBoard([row({ status: '???' }), row({ id: 2, status: 'WAITING' })])
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(1)
  })

  it('入参为空/非数组时不炸', () => {
    expect(groupBoard(null).every((g) => g.rows.length === 0)).toBe(true)
    expect(groupBoard(undefined).every((g) => g.rows.length === 0)).toBe(true)
  })
})

describe('列内排序：越急越靠上', () => {
  it('超期天数大的在前', () => {
    const groups = groupBoard([
      row({ id: 1, status: 'OVERDUE', overdueDays: 2, requiredArrivalDate: '2026-10-18' }),
      row({ id: 2, status: 'OVERDUE', overdueDays: 9, requiredArrivalDate: '2026-10-11' }),
    ])
    const ids = groups.find((g) => g.key === 'overdue').rows.map((r) => r.id)
    expect(ids).toEqual([2, 1])
  })

  it('同一天要求到货的，按 id 稳定排序（避免两次渲染乱跳）', () => {
    const groups = groupBoard([
      row({ id: 7, status: 'WAITING', requiredArrivalDate: '2026-10-20' }),
      row({ id: 3, status: 'WAITING', requiredArrivalDate: '2026-10-20' }),
    ])
    expect(groups.find((g) => g.key === 'waiting').rows.map((r) => r.id)).toEqual([3, 7])
  })

  it('没填到货日期的排最后（不能因为空串排到最前面装成最急）', () => {
    const groups = groupBoard([
      row({ id: 1, status: 'WAITING', requiredArrivalDate: '' }),
      row({ id: 2, status: 'WAITING', requiredArrivalDate: '2026-11-01' }),
    ])
    expect(groups.find((g) => g.key === 'waiting').rows.map((r) => r.id)).toEqual([2, 1])
  })
})

describe('卡片文案', () => {
  it('超期用 overdueDays，还剩几天用 daysToDue（不自己重算口径）', () => {
    expect(dueLabel({ overdueDays: 3 }).tone).toBe('overdue')
    expect(dueLabel({ overdueDays: 3 }).text).toBe('超期 3 天')
    expect(dueLabel({ overdueDays: null, daysToDue: 0 })).toEqual({ text: '今天到期', tone: 'soon' })
    expect(dueLabel({ overdueDays: null, daysToDue: 2 }).tone).toBe('soon')
    expect(dueLabel({ overdueDays: null, daysToDue: 20 })).toEqual({
      text: '还剩 20 天',
      tone: 'normal',
    })
  })

  it('没有日期信息时明确说「未填」，不显示 0 天', () => {
    expect(dueLabel({}).tone).toBe('none')
    expect(dueLabel({}).text).toBe('未填到货日')
  })

  it('数量 + 单位；缺单位只显示数字；都缺显示破折号', () => {
    expect(quantityText({ quantity: 2.5, unit: 'kg' })).toBe('2.5 kg')
    expect(quantityText({ quantity: 1, unit: '' })).toBe('1')
    expect(quantityText({})).toBe('—')
  })
})

describe('"提了多久"（卡片底部那一格）', () => {
  const today = new Date(2026, 9, 22) // 2026-10-22 本地日

  it('按本地日算天数，不因时区/夏令时差一天', () => {
    expect(requestAgeLabel({ requestDate: '2026-10-22' }, today)).toBe('今天提出')
    expect(requestAgeLabel({ requestDate: '2026-10-21' }, today)).toBe('昨天提出')
    expect(requestAgeLabel({ requestDate: '2026-10-19' }, today)).toBe('提出 3 天')
  })

  it('缺日期/格式不对时明说「未填」，不显示 0 天', () => {
    expect(requestAgeLabel({}, today)).toBe('未填提出日期')
    expect(requestAgeLabel({ requestDate: '2026/10/19' }, today)).toBe('未填提出日期')
  })

  it('未来日期（手误）不显示成负数', () => {
    expect(requestAgeLabel({ requestDate: '2026-12-01' }, today)).toBe('今天提出')
  })
})