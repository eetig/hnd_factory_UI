import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALL_COLUMNS,
  COLUMNS_STORAGE_KEY,
  DEFAULT_COLUMNS,
  DEFAULT_VISIBLE_KEYS,
  OPTIONAL_COLUMNS,
  TABLE_MAX_WIDTH,
  loadVisibleKeys,
  saveVisibleKeys,
  useEquipmentColumns,
} from '../../src/components/equipment/useEquipmentColumns.js'
import {
  containerFilter,
  hasClientFilter,
  matchesClientFilters,
  resetEquipmentFilters,
  statusScope,
} from '../../src/components/equipment/useEquipmentFilters.js'

/**
 * 设备台账的列配置 + 前端筛选（2026-10-18，变更-118）。
 *
 * 验收标准只有两句：**刷新后勾选还在**、**默认 8 列在 1280 视口下不横滚**。
 * 后者靠宽度预算钉住：固定列合计 + 唯一那一列自适应 ≤ 表格上限。
 */

/** 一个最小的 storage 替身：可以指定读出错、也可以断言写入了什么 */
function fakeStorage(initial) {
  const map = new Map(initial ? [[COLUMNS_STORAGE_KEY, initial]] : [])
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    dump: () => map.get(COLUMNS_STORAGE_KEY),
  }
}

function brokenStorage() {
  return {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('QuotaExceeded')
    },
  }
}

const pxOf = (width) => {
  const m = /^w-\[(\d+)px\]$/.exec(width || '')
  return m ? Number(m[1]) : null
}

describe('列定义', () => {
  it('默认 8 列、可选 7 列，key 不重复', () => {
    expect(DEFAULT_COLUMNS).toHaveLength(8)
    expect(OPTIONAL_COLUMNS).toHaveLength(7)
    const keys = ALL_COLUMNS.map((c) => c.key)
    expect(new Set(keys).size, '列 key 有重复 —— 渲染时 v-for 的 :key 会撞').toBe(keys.length)
  })

  it('刚好一列不自定宽（自适应列只能有一个）', () => {
    const auto = DEFAULT_COLUMNS.filter((c) => !c.width)
    expect(auto, '自适应列不是刚好一个：多于一列会互相抢宽度，一个都没有就把剩余宽度摊给所有列').toHaveLength(1)
    expect(auto[0].key).toBe('equipmentName')
  })

  it('默认 8 列的固定宽度合计 + 名称自适应 ≤ 表格上限（1280 视口不横滚）', () => {
    const fixed = DEFAULT_COLUMNS.reduce((sum, c) => sum + (pxOf(c.width) ?? 0), 0)
    expect(fixed, '默认列的固定宽度已经超过上限了').toBeLessThan(TABLE_MAX_WIDTH)
    const autoWidth = TABLE_MAX_WIDTH - fixed
    expect(autoWidth, '留给「名称」的宽度不足 200px，中文名会挤成两行').toBeGreaterThanOrEqual(200)
  })

  it('模板里的表格上限与常量是同一个数（改了常量忘改模板就红）', () => {
    const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const panel = readFileSync(
      join(ROOT, 'src', 'components', 'EquipmentMaintenancePanel.vue'),
      'utf8',
    )
    expect(panel, `模板里没有 max-w-[${TABLE_MAX_WIDTH}px]`).toContain(`max-w-[${TABLE_MAX_WIDTH}px]`)
    expect(panel, '表格丢了 table-fixed（列宽就不再按 colgroup 走）').toContain('table-fixed')
  })
})

describe('列配置持久化', () => {
  it('没有存过 → 用默认 8 列', () => {
    expect(loadVisibleKeys(fakeStorage())).toEqual(DEFAULT_VISIBLE_KEYS)
  })

  it('存的不是 JSON / 不是数组 / 是空数组 → 都退回默认（坏数据不能把表格变成空表）', () => {
    expect(loadVisibleKeys(fakeStorage('{oops'))).toEqual(DEFAULT_VISIBLE_KEYS)
    expect(loadVisibleKeys(fakeStorage('{"a":1}'))).toEqual(DEFAULT_VISIBLE_KEYS)
    expect(loadVisibleKeys(fakeStorage('[]'))).toEqual(DEFAULT_VISIBLE_KEYS)
  })

  it('不认识的 key 被丢掉（删列改名后老浏览器里会残留）', () => {
    const stored = JSON.stringify(['equipmentCode', 'brandNewColumn', 'spec'])
    expect(loadVisibleKeys(fakeStorage(stored))).toEqual(['equipmentCode', 'spec'])
  })

  it('全是未知 key → 退回默认；重复 key 去重', () => {
    expect(loadVisibleKeys(fakeStorage(JSON.stringify(['x', 'y'])))).toEqual(DEFAULT_VISIBLE_KEYS)
    expect(loadVisibleKeys(fakeStorage(JSON.stringify(['spec', 'spec', 'medium'])))).toEqual([
      'spec',
      'medium',
    ])
  })

  it('storage 读/写都抛错时不炸（隐私模式、配额满）', () => {
    expect(() => loadVisibleKeys(brokenStorage())).not.toThrow()
    expect(loadVisibleKeys(brokenStorage())).toEqual(DEFAULT_VISIBLE_KEYS)
    expect(() => saveVisibleKeys(['spec'], brokenStorage())).not.toThrow()
  })

  it('勾掉两列 → 写回 → 读回一致（刷新后还在，这是使用方要的那一条）', () => {
    const store = fakeStorage()
    saveVisibleKeys(DEFAULT_VISIBLE_KEYS.filter((k) => k !== 'spec' && k !== 'medium'), store)
    expect(loadVisibleKeys(store)).toEqual(
      DEFAULT_VISIBLE_KEYS.filter((k) => k !== 'spec' && k !== 'medium'),
    )
  })

  it('toggle 增删；最后一列点不掉；resetToDefault 回 8 列', () => {
    const { isVisible, toggle, resetToDefault, reloadFromStorage, visibleKeys } =
      useEquipmentColumns()
    const store = fakeStorage()
    reloadFromStorage(store)

    toggle('spec')
    expect(isVisible('spec')).toBe(false)
    toggle('spec')
    expect(isVisible('spec')).toBe(true)

    // 一列一列全点掉，最后必须还剩一列
    for (const key of [...visibleKeys.value]) toggle(key)
    expect(visibleKeys.value.length, '允许把列全关掉 —— 表格会变成一片空白').toBeGreaterThanOrEqual(1)

    resetToDefault()
    expect([...visibleKeys.value].sort()).toEqual([...DEFAULT_VISIBLE_KEYS].sort())
  })

  it('未知 key 的 toggle 被忽略（不会写进可见列）', () => {
    const { toggle, visibleKeys, reloadFromStorage } = useEquipmentColumns()
    reloadFromStorage(fakeStorage())
    const before = [...visibleKeys.value]
    toggle('notAColumn')
    expect(visibleKeys.value).toEqual(before)
  })
})

describe('前端筛选（后端没有这两个参数）', () => {
  beforeEach(() => {
    resetEquipmentFilters()
  })

  it('默认什么条件都没有 → 每一行都通过，且不提示"本页内过滤"', () => {
    expect(matchesClientFilters({ enabled: 1, containerType: 3 })).toBe(true)
    expect(hasClientFilter()).toBe(false)
  })

  it('只看停用：停用的行通过、启用的行被挡掉', () => {
    statusScope.value = 'off'
    expect(matchesClientFilters({ enabled: 0, containerType: 3 })).toBe(true)
    expect(matchesClientFilters({ enabled: 1, containerType: 3 })).toBe(false)
    expect(hasClientFilter()).toBe(true)
  })

  it('容器类型：只留相同类型；类型为 null 的行不被误留', () => {
    containerFilter.value = '2'
    expect(matchesClientFilters({ enabled: 1, containerType: 2 })).toBe(true)
    expect(matchesClientFilters({ enabled: 1, containerType: 1 })).toBe(false)
    expect(matchesClientFilters({ enabled: 1, containerType: null })).toBe(false)
  })

  it('两个条件叠加时取交集', () => {
    statusScope.value = 'off'
    containerFilter.value = '1'
    expect(matchesClientFilters({ enabled: 0, containerType: 1 })).toBe(true)
    expect(matchesClientFilters({ enabled: 1, containerType: 1 })).toBe(false)
    expect(matchesClientFilters({ enabled: 0, containerType: 2 })).toBe(false)
  })
})
