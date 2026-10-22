/**
 * 设备看板的分组（2026-10-22，变更-150）。
 *
 * ## 为什么按"缺什么"分列，而不是按容器类型
 *
 * 台账有 23 个字段、4 种容器类型。按类型分列（卧式/平底/其他）只是把一张表切成几块，
 * **看完不知道该干什么**。而这套数据天生有"维护待办"的梯子：
 *
 *   缺底图 → 没底图就没法在储罐页标定液位（后续测量全靠它）
 *   缺标定 → 有底图但没有「每毫米体积」，算不出质量/库存
 *   已停用 → 数据完整但被停用（可能是有意的，也可能是被系统拦下的）
 *   就绪   → 启用 + 有底图 + 有标定，能直接用于液位测量
 *
 * 一列就是一类待办，谁该动一眼看得出来。
 *
 * ## 分类优先级（重要）
 *
 * 一台设备可能同时缺底图又停用。取**最靠前的那一环** —— 先补底图，停用与否是后面的事。
 * 所以顺序固定为 缺底图 → 缺标定 → 停用 → 就绪，不允许各列重叠。
 */

export const LEDGER_COLUMNS = [
  { key: 'noImage', label: '缺底图', hint: '没有容器底图，液位没法标定' },
  { key: 'noCalibration', label: '缺标定', hint: '有底图但缺「每毫米体积」，算不出质量' },
  { key: 'disabled', label: '已停用', hint: '数据完整但被停用（含被系统拦下的）' },
  { key: 'ready', label: '已就绪', hint: '启用 + 有底图 + 有标定，可直接测液位' },
]

/** 是否"有底图"：只看文件名，不看坐标 JSON（坐标可以后补） */
export function hasImage(row = {}) {
  return String(row.imageFile || '').trim() !== ''
}

/** 是否"有标定"：每毫米体积是算质量的前提，空值就是没标定 */
export function hasCalibration(row = {}) {
  const v = row.volumePerMm
  return v !== null && v !== undefined && String(v).trim() !== '' && Number(v) > 0
}

export function isEnabled(row = {}) {
  return Number(row.enabled) === 1
}

/**
 * 一台设备落在哪一列。
 *
 * @returns {'noImage'|'noCalibration'|'disabled'|'ready'}
 */
export function columnOfEquipment(row = {}) {
  if (!hasImage(row)) return 'noImage'
  if (!hasCalibration(row)) return 'noCalibration'
  if (!isEnabled(row)) return 'disabled'
  return 'ready'
}

/**
 * 列内排序：**越不完整越靠上**，同组内按位号字典序。
 *
 * 位号（V-150、R-201）是现场叫法，字典序就是使用者的心理顺序；
 * 用 id 排序反而会随录入顺序乱跳。
 */
function compareByCode(a, b) {
  const ca = String(a.equipmentCode || '')
  const cb = String(b.equipmentCode || '')
  if (ca !== cb) {
    if (!ca) return 1
    if (!cb) return -1
    return ca.localeCompare(cb, 'zh-Hans-CN')
  }
  return (Number(a.id) || 0) - (Number(b.id) || 0)
}

/**
 * 把台账行分成 4 列。
 *
 * @param {Array<object>} rows EquipmentLedgerVO 列表
 */
export function groupLedger(rows) {
  const buckets = new Map(LEDGER_COLUMNS.map((c) => [c.key, []]))
  for (const row of rows || []) {
    buckets.get(columnOfEquipment(row)).push(row)
  }
  return LEDGER_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    hint: c.hint,
    rows: buckets.get(c.key).slice().sort(compareByCode),
  }))
}

/**
 * 卡片上那句"为什么还不能用"。
 *
 * 优先用后端算好的 `enableBlockReason`（口径只在后端一处），
 * 没有它时按本文件的规则给一句兜底 —— 但**不猜业务**，只说缺什么。
 */
export function blockReasonText(row = {}) {
  const fromServer = String(row.enableBlockReason || '').trim()
  if (fromServer) return fromServer
  if (!hasImage(row)) return '缺容器底图'
  if (!hasCalibration(row)) return '缺每毫米体积（未标定）'
  if (!isEnabled(row)) return '已停用'
  return ''
}

/** 规格 + 尺寸摘要：「Φ1200×3000」这类，缺就返回空串 */
export function sizeText(row = {}) {
  const spec = String(row.spec || '').trim()
  if (spec) return spec
  const d = row.innerDiameter
  const l = row.shellLength
  if (d && l) return `Φ${d}×${l}`
  return ''
}
