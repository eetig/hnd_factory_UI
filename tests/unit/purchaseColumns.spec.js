import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  ALL_COLUMNS,
  COLUMNS_STORAGE_KEY,
  DEFAULT_VISIBLE_KEYS,
  loadVisibleKeys,
  saveVisibleKeys,
  usePurchaseColumns,
} from '../../src/components/purchase/usePurchaseColumns.js'

/**
 * 列配置的持久化（变更-117）。
 *
 * 验收标准（使用方原话的机器版）：
 *   ① 勾掉两列 → 刷新 → 仍然是勾掉的状态；
 *   ② 存的 key 在列定义里不存在时**忽略**（以后删列/改名，老浏览器里会残留旧 key）；
 *   ③ 存坏了（不是 JSON / 不是数组 / 空数组）→ 回到默认 8 列，绝不能变成空表。
 *
 * 用内存 storage 而不是真 localStorage：用例之间不互相污染，也不用清 jsdom 环境。
 */
function memoryStorage(seed) {
  const map = new Map()
  if (seed !== undefined) map.set(COLUMNS_STORAGE_KEY, seed)
  return {
    getItem: vi.fn((k) => (map.has(k) ? map.get(k) : null)),
    setItem: vi.fn((k, v) => map.set(k, String(v))),
    dump: () => map,
  }
}

beforeEach(() => {
  // 模块级单例在用例之间共享，开头先归位到"默认 8 列"
  usePurchaseColumns().resetToDefault()
})

describe('默认列', () => {
  it('默认 8 列，且就是那 8 个 key（顺序即表格顺序）', () => {
    expect(DEFAULT_VISIBLE_KEYS).toEqual([
      'index',
      'status',
      'materialName',
      'spec',
      'category',
      'quantity',
      'requiredArrivalDate',
      'requester',
    ])
    expect(DEFAULT_VISIBLE_KEYS).toHaveLength(8)
  })

  it('8 列的固定宽度合计 + 唯一自适应列 ≤ 1100px（1280 视口不横滚的前提）', () => {
    const px = (cls) => {
      const m = /w-\[(\d+)px\]/.exec(cls ?? '')
      return m ? Number(m[1]) : 0
    }
    const defs = ALL_COLUMNS.filter((c) => DEFAULT_VISIBLE_KEYS.includes(c.key))
    const fixed = defs.reduce((sum, c) => sum + px(c.width), 0)
    const auto = defs.filter((c) => !c.width)
    expect(auto, '必须有且只有一列自适应（其余列写死，否则剩余宽度会被摊成空白）').toHaveLength(1)
    expect(fixed, `固定列合计 ${fixed}px 已超过预算`).toBeLessThanOrEqual(1100)
    // 自适应那一列至少还要剩 200px 才有意义
    expect(1100 - fixed).toBeGreaterThanOrEqual(200)
  })
})

describe('持久化', () => {
  it('勾掉两列后写回 storage，再读就是勾掉的状态', () => {
    const storage = memoryStorage()
    const { toggle } = usePurchaseColumns()
    toggle('spec')
    toggle('requester')
    saveVisibleKeys(['index', 'status', 'materialName', 'category', 'quantity'], storage)

    const restored = loadVisibleKeys(storage)
    expect(restored).not.toContain('spec')
    expect(restored).not.toContain('requester')
    expect(restored).toContain('materialName')
  })

  it('存的 key 不存在于列定义里 → 忽略（不认识的 key 不许混进来）', () => {
    const storage = memoryStorage(JSON.stringify(['index', 'materialName', '已经删掉的列', 'status']))
    expect(loadVisibleKeys(storage)).toEqual(['index', 'materialName', 'status'])
  })

  it('不是 JSON / 不是数组 / 空数组 → 全部回到默认 8 列', () => {
    expect(loadVisibleKeys(memoryStorage('{坏数据'))).toEqual(DEFAULT_VISIBLE_KEYS)
    expect(loadVisibleKeys(memoryStorage('"index"'))).toEqual(DEFAULT_VISIBLE_KEYS)
    expect(loadVisibleKeys(memoryStorage('[]'))).toEqual(DEFAULT_VISIBLE_KEYS)
    expect(loadVisibleKeys(memoryStorage(JSON.stringify(['未知列'])))).toEqual(DEFAULT_VISIBLE_KEYS)
  })

  it('storage 抛错（隐私模式）→ 读回默认、写入不抛异常', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadVisibleKeys(broken)).toEqual(DEFAULT_VISIBLE_KEYS)
    expect(() => saveVisibleKeys(['index'], broken)).not.toThrow()
  })
})

describe('勾选行为', () => {
  it('最后一列点不掉（不允许把表格勾成空的）', () => {
    const { toggle, visibleKeys } = usePurchaseColumns()
    for (const key of ALL_COLUMNS.map((c) => c.key)) {
      if (visibleKeys.value.includes(key)) toggle(key)
    }
    expect(visibleKeys.value.length).toBe(1)
  })

  it('关掉再打开，列回到设计好的位置（不跑到表尾）', () => {
    const { toggle, orderedColumns } = usePurchaseColumns()
    toggle('spec')
    toggle('spec')
    const keys = orderedColumns.value.map((c) => c.key)
    expect(keys.indexOf('spec')).toBe(3)
  })

  it('可选列勾开后排在默认列之后', () => {
    const { toggle, orderedColumns } = usePurchaseColumns()
    toggle('purpose')
    const keys = orderedColumns.value.map((c) => c.key)
    expect(keys.indexOf('purpose')).toBeGreaterThan(keys.indexOf('requester'))
  })
})
