import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  formatDate,
  formatMonthDay,
  formatQty,
  formatFileSize,
  getLastWeekMonday,
  getLastWeekSunday,
  normalizeMaterialName,
  pickField,
} from '../../src/utils/format'

describe('formatQty：数量求和去浮点误差', () => {
  it('保留至多 3 位小数', () => {
    expect(formatQty(1.23456)).toBe(1.235)
    expect(formatQty(1.2)).toBe(1.2)
  })

  it('消掉浮点误差（0.1 + 0.2）', () => {
    expect(formatQty(0.1 + 0.2)).toBe(0.3)
  })

  it('非有限数一律归零', () => {
    expect(formatQty(Number.NaN)).toBe(0)
    expect(formatQty(Number.POSITIVE_INFINITY)).toBe(0)
    // 字符串不参与数值计算 —— 汇总前必须由调用方 Number() 转换
    expect(formatQty('12')).toBe(0)
  })
})

describe('normalizeMaterialName：跨系统物料名匹配', () => {
  it('忽略空格、下划线差异并忽略大小写', () => {
    expect(normalizeMaterialName('HND-V150 辅料包')).toBe(normalizeMaterialName('hnd-v150辅料包'))
    expect(normalizeMaterialName('氯铂酸_150')).toBe(normalizeMaterialName('氯铂酸150'))
  })

  it('空值安全', () => {
    expect(normalizeMaterialName(null)).toBe('')
    expect(normalizeMaterialName(undefined)).toBe('')
  })
})

describe('pickField：按别名顺序取值', () => {
  it('取第一个非 undefined / null 的字段', () => {
    expect(pickField({ b: 'x' }, ['a', 'b'])).toBe('x')
  })

  it('0 与 false 是有效值，不能当空值跳过', () => {
    expect(pickField({ a: 0, b: 5 }, ['a', 'b'])).toBe(0)
    expect(pickField({ a: false, b: true }, ['a', 'b'])).toBe(false)
  })

  it('全都不存在时返回空串', () => {
    expect(pickField(undefined, ['a'])).toBe('')
  })
})

describe('日期工具', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formatDate 输出 yyyy-MM-dd', () => {
    expect(formatDate(new Date(2025, 8, 7))).toBe('2025-09-07')
  })

  it('formatMonthDay 输出 M月D日', () => {
    expect(formatMonthDay('2025-09-07')).toBe('9月7日')
    expect(formatMonthDay('')).toBe('')
  })

  it('周统计默认区间为「上周一 ~ 上周日」（周三视角）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 0, 3)) // 2024-01-03 周三

    expect(getLastWeekMonday()).toBe('2023-12-25') // 周一
    expect(getLastWeekSunday()).toBe('2023-12-31') // 周日
  })

  it('周日属于「本周最后一天」，因此与同一周内的其他日子算出的区间一致', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 0, 7)) // 2024-01-07 周日（与 01-03 同属 01-01~01-07 这一周）

    expect(getLastWeekMonday()).toBe('2023-12-25')
    expect(getLastWeekSunday()).toBe('2023-12-31')
  })

  it('周统计默认区间（周一视角：正好指向上一周的周一到周日）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 0, 8)) // 2024-01-08 周一

    expect(getLastWeekMonday()).toBe('2024-01-01')
    expect(getLastWeekSunday()).toBe('2024-01-07')
  })
})

describe('formatFileSize', () => {
  it('按 B / KB / MB 分级', () => {
    expect(formatFileSize(0)).toBe('')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
