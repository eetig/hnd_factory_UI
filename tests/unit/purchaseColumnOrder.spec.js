import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALL_COLUMNS,
  COLUMN_ORDER_KEY,
  COLUMNS_STORAGE_KEY,
  DEFAULT_VISIBLE_KEYS,
  loadColumnOrder,
  pinFirst,
  saveColumnOrder,
  usePurchaseColumns,
} from '../../src/components/purchase/usePurchaseColumns.js'

/*
 * 列顺序（2026-10-22，变更-142）：使用方要求「显示的列可以调整顺序」。
 *
 * 顺序与显隐是两个独立的持久化项：
 *   · hnd-purchase-columns      → 哪些列显示（变更-117 就有）
 *   · hnd-purchase-column-order → 列怎么排（本次新增）
 * 分开存的好处：勾掉一列再打开，它回到**用户排过的位置**，而不是表尾。
 */

/** 只实现 get/set 的最小 storage 替身（与列显隐那批用例同一套写法） */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const DEFAULT_ORDER = ALL_COLUMNS.map((c) => c.key)

describe('列顺序：读取与校验', () => {
  it('没存过 → 默认顺序就是 ALL_COLUMNS 的声明顺序', () => {
    expect(loadColumnOrder(fakeStorage())).toEqual(DEFAULT_ORDER)
  })

  it('存的不是 JSON / 不是数组 → 退回默认', () => {
    expect(loadColumnOrder(fakeStorage({ [COLUMN_ORDER_KEY]: '{oops' }))).toEqual(DEFAULT_ORDER)
    expect(loadColumnOrder(fakeStorage({ [COLUMN_ORDER_KEY]: '{"a":1}' }))).toEqual(DEFAULT_ORDER)
  })

  it('不认识的 key 丢掉，重复 key 去重', () => {
    const order = loadColumnOrder(
      fakeStorage({ [COLUMN_ORDER_KEY]: JSON.stringify(['status', 'status', 'nope', 'spec']) }),
    )
    expect(order).not.toContain('nope')
    expect(order.filter((k) => k === 'status')).toHaveLength(1)
  })

  it('缺的列补在末尾 —— 以后新增一列，老用户的顺序里没有它，不补就永远不显示', () => {
    const order = loadColumnOrder(fakeStorage({ [COLUMN_ORDER_KEY]: JSON.stringify(['status']) }))
    expect(order[0]).toBe('index')
    expect(order.slice(0, 2)).toEqual(['index', 'status'])
    // 其余列一个不少
    expect(new Set(order)).toEqual(new Set(DEFAULT_ORDER))
  })

  it('序号列永远第一：即便存储里把它排到中间', () => {
    const order = loadColumnOrder(
      fakeStorage({ [COLUMN_ORDER_KEY]: JSON.stringify(['status', 'index', 'spec']) }),
    )
    expect(order[0]).toBe('index')
  })

  it('pinFirst 只挪固定列，其余相对顺序不变', () => {
    expect(pinFirst(['b', 'index', 'a'])).toEqual(['index', 'b', 'a'])
  })

  it('storage 抛错时不炸（隐私模式）', () => {
    const store = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadColumnOrder(store)).toEqual(DEFAULT_ORDER)
    expect(() => saveColumnOrder(DEFAULT_ORDER, store)).not.toThrow()
  })
})

describe('列顺序：移动与落点', () => {
  it('moveColumn 上移/下移；固定列与越界不动', () => {
    const columns = usePurchaseColumns()
    columns.reloadFromStorage(fakeStorage())

    const before = [...columns.columnOrder.value]
    columns.moveColumn('spec', -1)
    expect(columns.columnOrder.value.indexOf('spec')).toBe(before.indexOf('spec') - 1)

    // 序号列不动
    const snapshot = [...columns.columnOrder.value]
    columns.moveColumn('index', 1)
    expect(columns.columnOrder.value).toEqual(snapshot)

    // 已经在第一位（index 之后）再上移 → 不许插到固定列前面
    const second = columns.columnOrder.value[1]
    columns.moveColumn(second, -1)
    expect(columns.columnOrder.value[0]).toBe('index')
    expect(columns.columnOrder.value[1]).toBe(second)
  })

  it('dropColumn 把被拖的列放到目标列前面', () => {
    const columns = usePurchaseColumns()
    columns.reloadFromStorage(fakeStorage())

    columns.dropColumn('remark', 'status')
    const order = columns.columnOrder.value
    expect(order.indexOf('remark')).toBe(order.indexOf('status') - 1)
    expect(order[0]).toBe('index')
  })

  it('dropColumn：拖到固定列上 → 落在它后面，不会跑到第一位', () => {
    const columns = usePurchaseColumns()
    columns.reloadFromStorage(fakeStorage())

    columns.dropColumn('remark', 'index')
    expect(columns.columnOrder.value[0]).toBe('index')
    expect(columns.columnOrder.value[1]).toBe('remark')
  })

  it('固定列不能被拖动（dropColumn 直接忽略）', () => {
    const columns = usePurchaseColumns()
    columns.reloadFromStorage(fakeStorage())

    const before = [...columns.columnOrder.value]
    columns.dropColumn('index', 'remark')
    expect(columns.columnOrder.value).toEqual(before)
  })
})

describe('列顺序：与显隐、持久化的关系', () => {
  /*
   * ⚠️ 这一组必须把 globalThis.localStorage 换成替身：
   * composable 里的 toggle / moveColumn / dropColumn 写的是**模块单例**的状态，
   * 落盘固定走 globalThis.localStorage（它们不接 storage 参数）。只传替身给
   * reloadFromStorage 而不同时替换全局，写回就落在真 localStorage 里、替身永远是空的。
   */
  /*
   * jsdom 里 `globalThis.localStorage` 只有一个 getter（直接赋值抛
   * "Cannot set property localStorage"），所以用 vi.stubGlobal 换掉，
   * 用完 unstubAllGlobals 还原。
   */
  const originalStorage = globalThis.localStorage

  afterEach(() => {
    vi.unstubAllGlobals()
    usePurchaseColumns().reloadFromStorage(originalStorage)
  })

  function withFakeGlobalStorage(run) {
    const store = fakeStorage()
    vi.stubGlobal('localStorage', store)
    usePurchaseColumns().reloadFromStorage(store)
    run(store, usePurchaseColumns())
  }

  it('orderedColumns 按用户顺序，且只含可见列', () => {
    withFakeGlobalStorage((store, columns) => {
      columns.dropColumn('remark', 'status')

      // 顺序在 columnOrder 上生效（remark 默认隐藏，所以它不在 orderedColumns 里）
      const order = columns.columnOrder.value
      expect(order.indexOf('remark')).toBe(order.indexOf('status') - 1)

      const keys = columns.orderedColumns.value.map((c) => c.key)
      expect(keys).not.toContain('remark')
      expect(keys[0]).toBe('index')

      // 把 remark 打开之后，它就回到被拖到的位置（而不是表尾）——这是分开存顺序的意义
      columns.toggle('remark')
      const withRemark = columns.orderedColumns.value.map((c) => c.key)
      expect(withRemark.indexOf('remark')).toBe(withRemark.indexOf('status') - 1)
    })
  })

  it('拖动后写回 storage，刷新读回一致', () => {
    withFakeGlobalStorage((store, columns) => {
      columns.dropColumn('remark', 'status')

      const saved = JSON.parse(store.getItem(COLUMN_ORDER_KEY))
      expect(saved.indexOf('remark')).toBe(saved.indexOf('status') - 1)
      expect(loadColumnOrder(store)).toEqual(saved)
    })
  })

  it('恢复默认同时重置显隐与顺序', () => {
    withFakeGlobalStorage((store, columns) => {
      columns.dropColumn('remark', 'status')
      columns.toggle('remark')
      columns.resetToDefault()

      expect([...columns.visibleKeys.value].sort()).toEqual([...DEFAULT_VISIBLE_KEYS].sort())
      expect(columns.columnOrder.value).toEqual(DEFAULT_ORDER)
    })
  })

  it('显隐与顺序是两个独立的键，互不覆盖', () => {
    withFakeGlobalStorage((store, columns) => {
      columns.toggle('materialCode')
      columns.dropColumn('remark', 'status')

      const keys = Object.keys(store.dump())
      expect(keys).toContain(COLUMNS_STORAGE_KEY)
      expect(keys).toContain(COLUMN_ORDER_KEY)
    })
  })
})
