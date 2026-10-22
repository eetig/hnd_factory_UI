import { computed, ref } from 'vue'

/**
 * 采购需求详情的列定义 + 显隐持久化（2026-10-18，变更-117）。
 *
 * ## 为什么默认只开 8 列
 *
 * 使用方的验收标准是「**零横向滚动**」。原来 15 列 + 操作列的总宽 1870px，
 * 1280 的视口必横滚 —— 横滚意味着"看数量时看不到物料名称"，台账里最难受的一种。
 *
 * 所以默认只开「录一条需求时需要看的」8 列，其余 7 列（编码 / 用途 / OA / 送货单 /
 * 实际到货 / 备注 / 提出日期）**默认关、可勾开**。这不是删功能，是换默认值。
 *
 * ## 宽度预算（8 列必须 ≤ 1100px）
 *
 *   序号 56 + 进度 92 + 规格 150 + 类别 76 + 数量 92 + 要求到货 116 + 需求人 84
 *   = **666px 固定**，剩下的 434px 全部给「物料名称」（唯一不自定宽的列）。
 *
 * ⚠️ **只让一列自适应，别给每列都写死宽度**：`table-fixed` + 每列固定宽 + `w-full`
 * 时，浏览器会把剩余宽度**按比例摊给所有列**，于是数字列右对齐、左边一片空白 ——
 * 这个坑本会话已经踩过两次（变更-111 / 112）。
 */

/** 8 个默认列（顺序即表格顺序）。`width` 缺省 = 自适应列，全表只许有一个 */
export const DEFAULT_COLUMNS = [
  { key: 'index', label: '序号', width: 'w-[56px]' },
  { key: 'status', label: '进度', width: 'w-[92px]' },
  { key: 'materialName', label: '物料名称' },
  { key: 'spec', label: '规格型号', width: 'w-[150px]' },
  { key: 'category', label: '类别', width: 'w-[76px]' },
  { key: 'quantity', label: '数量', width: 'w-[92px]', align: 'right' },
  { key: 'requiredArrivalDate', label: '要求到货日期', width: 'w-[116px]' },
  { key: 'requester', label: '需求人', width: 'w-[84px]' },
]

/** 可选列（默认关）。顺序 = 勾开后它们出现的顺序 */
export const OPTIONAL_COLUMNS = [
  { key: 'requestDate', label: '提出需求日期', width: 'w-[116px]' },
  { key: 'materialCode', label: '物料编码', width: 'w-[128px]' },
  { key: 'purpose', label: '用途', width: 'w-[140px]' },
  { key: 'oaNo', label: 'OA 单号', width: 'w-[104px]' },
  { key: 'deliveryNote', label: '送货单', width: 'w-[76px]' },
  { key: 'actualArrival', label: '实际到货', width: 'w-[140px]' },
  { key: 'remark', label: '备注', width: 'w-[160px]' },
]

export const ALL_COLUMNS = [...DEFAULT_COLUMNS, ...OPTIONAL_COLUMNS]

export const COLUMNS_STORAGE_KEY = 'hnd-purchase-columns'

/** 列顺序的存储键（2026-10-22，变更-142：使用方要求"显示的列可以调整顺序"） */
export const COLUMN_ORDER_KEY = 'hnd-purchase-column-order'

/** 不许参与拖拽的列：序号固定在第一位，否则"第几行"会跑到表中间 */
export const PINNED_COLUMN_KEYS = ['index']

/** 默认可见的列 key（顺序无关，渲染顺序由 ALL_COLUMNS 决定） */
export const DEFAULT_VISIBLE_KEYS = DEFAULT_COLUMNS.map((c) => c.key)

const KNOWN_KEYS = new Set(ALL_COLUMNS.map((c) => c.key))

/**
 * 从 localStorage 读可见列。
 *
 * 三条校验，缺一条都会出怪事：
 *   ① 不是数组 / 解析失败 → 用默认（别让一条坏数据把表格变成空表）
 *   ② **不认识的 key 直接丢掉** —— 以后删列/改名后，老浏览器里会残留旧 key，
 *      留着它会让"可见列数"和"实际渲染列数"对不上
 *   ③ 过滤后一个都不剩 → 用默认（全不勾等于表格没了，不允许落到这个状态）
 */
export function loadVisibleKeys(storage) {
  const store = storage ?? globalThis.localStorage
  if (!store) return [...DEFAULT_VISIBLE_KEYS]
  let raw
  try {
    raw = store.getItem(COLUMNS_STORAGE_KEY)
  } catch {
    return [...DEFAULT_VISIBLE_KEYS]
  }
  if (!raw) return [...DEFAULT_VISIBLE_KEYS]
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [...DEFAULT_VISIBLE_KEYS]
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_VISIBLE_KEYS]
  const kept = parsed.filter((k) => typeof k === 'string' && KNOWN_KEYS.has(k))
  if (!kept.length) return [...DEFAULT_VISIBLE_KEYS]
  return [...new Set(kept)]
}

/**
 * 从 localStorage 读列顺序。
 *
 * 校验口径和显隐那套同源（坏数据不能把表格搞坏），另外多两条：
 *   ① **不认识的 key 丢掉** —— 删列/改名后老浏览器里会残留旧 key；
 *   ② **缺的 key 补在末尾**（按 ALL_COLUMNS 的顺序）—— 以后新增一列，老用户的顺序里
 *      没有它，不补的话新列会**永远不显示**，这才是真正的坑；
 *   ③ **固定列（序号）永远排第一** —— 存储被手改成别的样子也不认。
 */
export function loadColumnOrder(storage) {
  const store = storage ?? globalThis.localStorage
  const fallback = ALL_COLUMNS.map((c) => c.key)
  if (!store) return fallback

  let raw
  try {
    raw = store.getItem(COLUMN_ORDER_KEY)
  } catch {
    return fallback
  }
  if (!raw) return fallback

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (!Array.isArray(parsed)) return fallback

  const kept = []
  for (const key of parsed) {
    if (typeof key === 'string' && KNOWN_KEYS.has(key) && !kept.includes(key)) {
      kept.push(key)
    }
  }
  // 补齐缺失的列（新加的列会走到这里）
  for (const key of fallback) {
    if (!kept.includes(key)) kept.push(key)
  }

  return pinFirst(kept)
}

/** 把固定列挪到最前，其余保持相对顺序 */
export function pinFirst(order) {
  const pinned = PINNED_COLUMN_KEYS.filter((key) => order.includes(key))
  const rest = order.filter((key) => !pinned.includes(key))
  return [...pinned, ...rest]
}

export function saveColumnOrder(order, storage) {
  const store = storage ?? globalThis.localStorage
  if (!store) return
  try {
    store.setItem(COLUMN_ORDER_KEY, JSON.stringify(order))
  } catch {
    // 隐私模式 / 配额满：静默放弃持久化，功能照用
  }
}

export function saveVisibleKeys(keys, storage) {
  const store = storage ?? globalThis.localStorage
  if (!store) return
  try {
    store.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // 隐私模式 / 配额满：静默放弃持久化。功能照用，只是下次打开回到默认
  }
}

/** 模块级单例：一张表只有一份列配置，各组件读同一份 */
const visibleKeys = ref(loadVisibleKeys())
const columnOrder = ref(loadColumnOrder())

/**
 * 列配置。
 *
 * `orderedColumns` 按 ALL_COLUMNS 的声明顺序过滤可见 key —— 所以「先关再开」不会
 * 让那一列跑到表尾，位置永远是设计好的那个。
 */
export function usePurchaseColumns() {
  /**
   * 表格实际渲染的列：**先按用户排的顺序**，再过滤掉隐藏的列。
   *
   * 注意顺序与显隐是两件事：一列被关掉再打开，它回到用户排过的位置，
   * 而不是表尾（这正是改成"用户顺序"之前的行为，使用方当时也提过）。
   */
  const orderedColumns = computed(() => {
    const byKey = new Map(ALL_COLUMNS.map((c) => [c.key, c]))
    return columnOrder.value
      .map((key) => byKey.get(key))
      .filter((column) => column && visibleKeys.value.includes(column.key))
  })

  function isVisible(key) {
    return visibleKeys.value.includes(key)
  }

  function toggle(key) {
    if (!KNOWN_KEYS.has(key)) return
    const next = isVisible(key)
      ? visibleKeys.value.filter((k) => k !== key)
      : [...visibleKeys.value, key]
    // 不允许「一列都不剩」：最后一列点掉时保持原样
    if (!next.length) return
    visibleKeys.value = next
    saveVisibleKeys(next)
  }

  /** 移动一列（拖拽 / ↑↓ 都走这里）。固定列、越界一律不动 */
  function moveColumn(key, delta) {
    if (!KNOWN_KEYS.has(key) || PINNED_COLUMN_KEYS.includes(key)) return
    const order = [...columnOrder.value]
    const from = order.indexOf(key)
    if (from < 0) return
    const to = from + delta
    if (to < 0 || to >= order.length) return
    if (PINNED_COLUMN_KEYS.includes(order[to])) return
    order.splice(from, 1)
    order.splice(to, 0, key)
    columnOrder.value = pinFirst(order)
    saveColumnOrder(columnOrder.value)
  }

  /** 拖拽落点：把 dragKey 放到 targetKey 前面（同位置就什么都不做） */
  function dropColumn(dragKey, targetKey) {
    if (dragKey === targetKey) return
    if (!KNOWN_KEYS.has(dragKey) || !KNOWN_KEYS.has(targetKey)) return
    if (PINNED_COLUMN_KEYS.includes(dragKey)) return

    const order = columnOrder.value.filter((k) => k !== dragKey)
    const at = order.indexOf(targetKey)
    if (at < 0) return
    // 不许插到固定列前面
    const insertAt = PINNED_COLUMN_KEYS.includes(targetKey) ? at + 1 : at
    order.splice(insertAt, 0, dragKey)
    columnOrder.value = pinFirst(order)
    saveColumnOrder(columnOrder.value)
  }

  function resetToDefault() {
    visibleKeys.value = [...DEFAULT_VISIBLE_KEYS]
    saveVisibleKeys(visibleKeys.value)
    columnOrder.value = ALL_COLUMNS.map((c) => c.key)
    saveColumnOrder(columnOrder.value)
  }

  /** 只给测试用：把内存状态对齐到某个 storage（不然用例之间会互相污染） */
  function reloadFromStorage(storage) {
    visibleKeys.value = loadVisibleKeys(storage)
    columnOrder.value = loadColumnOrder(storage)
  }

  return {
    visibleKeys,
    columnOrder,
    orderedColumns,
    isVisible,
    toggle,
    moveColumn,
    dropColumn,
    resetToDefault,
    reloadFromStorage,
  }
}
