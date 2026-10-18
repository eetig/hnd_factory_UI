import { computed, ref } from 'vue'

/**
 * 设备台账的列定义 + 显隐持久化（2026-10-18，变更-118）。
 *
 * 与采购页 `purchase/usePurchaseColumns.js` 同一套口径（那里有完整论证，
 * 这里只记设备页特有的几条）。
 *
 * ## 为什么默认 8 列
 *
 * 原来 15 列（位号/名称/昵称/规格/类型/内径/筒长/直边/封头/介质/密度/底图/状态/操作）
 * 总宽上千，使用方要的是「逐个设备对着图纸核对」—— 而横着滚的时候，
 * 看"筒体长度"就看不到"位号"，对不上号是最要命的。
 *
 * 默认 8 列选的是**核对时一眼要看的东西**：序号（他要按序号逐个数）、位号、
 * 名称、车间装置、容器类型、规格、介质、状态。几何尺寸（内径/筒长/直边/封头深度）
 * 与密度、底图、昵称默认收起来 —— 那几列是"要细看时才展开"的。
 *
 * ## 宽度预算（8 列必须 ≤ 1100px）
 *
 *   序号 56 + 位号 104 + 车间装置 104 + 容器类型 92 + 规格 132 + 介质 88 + 状态 132
 *   = **708px 固定**，剩下 392px 全部给「名称」（唯一不自定宽的列）。
 *
 * ⚠️ **只让一列自适应**：`table-fixed` + 每列固定宽 + `w-full` 时浏览器会把
 * 剩余宽度按比例摊给所有列，数字列右对齐、左边一片空白（变更-111/112 踩过两次）。
 */

/** 8 个默认列（顺序即表格顺序）。`width` 缺省 = 自适应列，全表只许有一个 */
export const DEFAULT_COLUMNS = [
  { key: 'index', label: '序号', width: 'w-[56px]', align: 'right' },
  { key: 'equipmentCode', label: '位号', width: 'w-[104px]' },
  { key: 'equipmentName', label: '名称' },
  { key: 'workshop', label: '车间装置', width: 'w-[104px]' },
  { key: 'containerType', label: '容器类型', width: 'w-[92px]' },
  { key: 'spec', label: '规格', width: 'w-[132px]' },
  { key: 'medium', label: '介质', width: 'w-[88px]' },
  { key: 'status', label: '状态', width: 'w-[132px]' },
]

/** 可选列（默认关）。顺序 = 勾开后它们出现的顺序 */
export const OPTIONAL_COLUMNS = [
  { key: 'nickname', label: '昵称', width: 'w-[96px]' },
  { key: 'innerDiameter', label: '内径', width: 'w-[88px]', align: 'right' },
  { key: 'shellLength', label: '筒体长度', width: 'w-[96px]', align: 'right' },
  { key: 'straightFlange', label: '直边', width: 'w-[76px]', align: 'right' },
  { key: 'headDepth', label: '封头深度(上/下)', width: 'w-[116px]', align: 'right' },
  { key: 'density', label: '介质密度', width: 'w-[96px]', align: 'right' },
  { key: 'imageFile', label: '底图', width: 'w-[80px]' },
]

export const ALL_COLUMNS = [...DEFAULT_COLUMNS, ...OPTIONAL_COLUMNS]

export const COLUMNS_STORAGE_KEY = 'hnd-equipment-columns'

/** 表格宽度上限（与模板里的 `max-w-[1100px]` 是同一个数，测试会交叉核对） */
export const TABLE_MAX_WIDTH = 1100

export const DEFAULT_VISIBLE_KEYS = DEFAULT_COLUMNS.map((c) => c.key)

const KNOWN_KEYS = new Set(ALL_COLUMNS.map((c) => c.key))

/**
 * 从 localStorage 读可见列。四条校验，缺一条都会出怪事：
 *   ① storage 不可用 / 抛错 → 默认
 *   ② 不是合法 JSON / 不是数组 → 默认
 *   ③ **不认识的 key 丢掉**（删列改名后老浏览器里会残留旧 key）
 *   ④ 过滤后一个都不剩 → 默认（全不勾等于表格没了）
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

export function saveVisibleKeys(keys, storage) {
  const store = storage ?? globalThis.localStorage
  if (!store) return
  try {
    store.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // 隐私模式 / 配额满：静默放弃持久化，功能照用
  }
}

/** 模块级单例：一张表只有一份列配置 */
const visibleKeys = ref(loadVisibleKeys())

export function useEquipmentColumns() {
  const orderedColumns = computed(() =>
    ALL_COLUMNS.filter((c) => visibleKeys.value.includes(c.key)),
  )

  function isVisible(key) {
    return visibleKeys.value.includes(key)
  }

  function toggle(key) {
    if (!KNOWN_KEYS.has(key)) return
    const next = isVisible(key)
      ? visibleKeys.value.filter((k) => k !== key)
      : [...visibleKeys.value, key]
    if (!next.length) return
    visibleKeys.value = next
    saveVisibleKeys(next)
  }

  function resetToDefault() {
    visibleKeys.value = [...DEFAULT_VISIBLE_KEYS]
    saveVisibleKeys(visibleKeys.value)
  }

  /** 只给测试用：把内存状态对齐到某个 storage */
  function reloadFromStorage(storage) {
    visibleKeys.value = loadVisibleKeys(storage)
  }

  return { visibleKeys, orderedColumns, isVisible, toggle, resetToDefault, reloadFromStorage }
}
