/**
 * 采购看板的分组与排序（2026-10-22，变更-148）。
 *
 * 纯函数，不碰网络、不碰 DOM —— 这样"哪张卡落哪一列、列内谁在上面"能被单测钉住，
 * 而不是靠肉眼看板确认。
 *
 * ## 为什么只有 4 列（而不是 6 个状态各一列）
 *
 * `PurchaseTrackingStatus` 有 6 个值，但 1280 视口下 6 列每列不到 200px，
 * 卡片会被挤成一行字。所以合并成 4 列：
 *
 *   待提单   PENDING_OA                       —— 卡还没提交，要人去提单
 *   等货     WAITING + DUE_SOON               —— 已提单在等，**临期**在列内用标签区分
 *   超期     OVERDUE                          —— 过了要求到货日还没到，要催
 *   已到货   ARRIVED + PARTIAL                —— 到货（部分到货在列内标出来）
 *
 * ⚠️ 状态是**派生**的（后端按 OA 单号 / 送货单 / 距到货天数算），库里没有状态列。
 * 所以看板**不能拖拽改状态** —— 想推进一张卡，正确动作是填 OA 单号 / 上传送货单，
 * 状态自己会变。这条写在这里，是为了不让下一个人"顺手加个拖拽"。
 */

/** 列定义（顺序即渲染顺序；`keys` 是这一列接受的派生状态） */
export const BOARD_COLUMNS = [
  { key: 'pendingOa', label: '待提单', hint: '还没提交 OA，要人去提单', keys: ['PENDING_OA'] },
  { key: 'waiting', label: '等货', hint: '已提单，在等到货', keys: ['WAITING', 'DUE_SOON'] },
  { key: 'overdue', label: '超期', hint: '过了要求到货日还没到', keys: ['OVERDUE'] },
  { key: 'arrived', label: '已到货', hint: '到货了（含部分到货）', keys: ['ARRIVED', 'PARTIAL'] },
]

/** 未到货的四个状态 —— 看板默认只看这些（"今天该催谁"） */
export const OPEN_STATUSES = ['PENDING_OA', 'WAITING', 'DUE_SOON', 'OVERDUE']

const KEY_TO_COLUMN = new Map()
for (const col of BOARD_COLUMNS) {
  for (const k of col.keys) KEY_TO_COLUMN.set(k, col.key)
}

/** 状态 → 列 key；认不出来的状态返回 null（卡片会被丢掉并在控制台可查） */
export function columnOfStatus(status) {
  return KEY_TO_COLUMN.get(String(status || '').toUpperCase()) || null
}

/**
 * 列内排序（Q5 的决定）：**越急越靠上**。
 *
 * 比较顺序：
 *   1. 超期天数大的在前（同列里 overdueDays 只在超期列有值）
 *   2. 要求到货日期早的在前（空日期排最后 —— 没填日期的不该装成最急）
 *   3. id 小的在前（稳定兜底，避免同日期在两次渲染间乱跳）
 */
function compareUrgency(a, b) {
  const overdueA = Number(a.overdueDays) || 0
  const overdueB = Number(b.overdueDays) || 0
  if (overdueA !== overdueB) return overdueB - overdueA

  const da = a.requiredArrivalDate || ''
  const db = b.requiredArrivalDate || ''
  if (da !== db) {
    if (!da) return 1
    if (!db) return -1
    return da < db ? -1 : 1
  }
  return (Number(a.id) || 0) - (Number(b.id) || 0)
}

/**
 * 把行分成 4 列。
 *
 * @param {Array<object>} rows 采购列表行（VO）
 * @returns {{ key: string, label: string, hint: string, rows: object[] }[]}
 */
export function groupBoard(rows) {
  const buckets = new Map(BOARD_COLUMNS.map((c) => [c.key, []]))
  for (const row of rows || []) {
    const key = columnOfStatus(row?.status)
    if (key) buckets.get(key).push(row)
  }
  return BOARD_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    hint: c.hint,
    rows: buckets.get(c.key).slice().sort(compareUrgency),
  }))
}

/**
 * 卡片上的"还剩几天"文案。**不重新计算**超期/临期口径 ——
 * 直接用后端算好的 daysToDue / overdueDays（口径只在后端一处）。
 *
 * @returns {{ text: string, tone: 'overdue' | 'soon' | 'normal' | 'none' }}
 */
export function dueLabel(row = {}) {
  const overdue = Number(row.overdueDays)
  if (Number.isFinite(overdue) && overdue > 0) {
    return { text: `超期 ${overdue} 天`, tone: 'overdue' }
  }
  const days = Number(row.daysToDue)
  if (!Number.isFinite(days)) return { text: '未填到货日', tone: 'none' }
  if (days < 0) return { text: `超期 ${Math.abs(days)} 天`, tone: 'overdue' }
  if (days === 0) return { text: '今天到期', tone: 'soon' }
  if (days <= 3) return { text: `还剩 ${days} 天`, tone: 'soon' }
  return { text: `还剩 ${days} 天`, tone: 'normal' }
}

/** 数量 + 单位（「1 台」「2.5 kg」）；缺单位就只显示数字 */
export function quantityText(row = {}) {
  const q = row.quantity
  const unit = String(row.unit || '').trim()
  if (q === null || q === undefined || q === '') return unit || '—'
  return unit ? `${q} ${unit}` : String(q)
}
