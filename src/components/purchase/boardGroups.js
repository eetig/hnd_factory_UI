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
/*
 * 四列 = 四种处理状态（2026-11-02 加配色，与设备看板同一套语言）。
 *
 * 颜色只表达"卡在哪个环节"：
 *   待提单 靛（还没动，等人去提）· 等货 青（在流程里，等时间）
 *   超期   橙（最急，已经晚了）  · 已到货 苔绿（完成）
 * 都压着饱和度；文字用深版、底色用 14% 淡版 —— 全部过 AA。
 */
export const BOARD_COLUMNS = [
  { key: 'pendingOa', label: '待提单', hint: '还没提交 OA，要人去提单', keys: ['PENDING_OA'], color: '#4A5A7B' },
  { key: 'waiting', label: '等货', hint: '已提单，在等到货', keys: ['WAITING', 'DUE_SOON'], color: '#3F6E6A' },
  { key: 'overdue', label: '超期', hint: '过了要求到货日还没到', keys: ['OVERDUE'], color: '#B45309' },
  { key: 'arrived', label: '已到货', hint: '到货了（含部分到货）', keys: ['ARRIVED', 'PARTIAL'], color: '#5B6E4F' },
]

/** 未到货的四个状态 —— 看板默认只看这些（"今天该催谁"） */
export const OPEN_STATUSES = ['PENDING_OA', 'WAITING', 'DUE_SOON', 'OVERDUE']

const KEY_TO_COLUMN = new Map()
for (const col of BOARD_COLUMNS) {
  for (const k of col.keys) KEY_TO_COLUMN.set(k, col.key)
}

/** 状态 → 列 key；认不出来的状态返回 null（卡片会被丢掉并在控制台可查） */
/** 需要验收的单据类型：服务采购申请 / 资产申购（CGSQ 采购申请没有验收单） */
export const ACCEPTANCE_ORDER_TYPES = ['FWCGSQ', 'ZCSG']

/** 已到货的状态（含部分到货） */
const ARRIVED_STATUSES = ['ARRIVED', 'PARTIAL']

/**
 * 这条需求是否"待验收"（2026-11-10）。
 *
 * 口径只有这一处：已到货 且 验收单号为空 且 单据类型不是 CGSQ。
 * 看板的筛选胶囊、卡片徽标都用它 —— 两处各写一遍迟早不一致。
 *
 * 单据类型没填的老数据不算待验收（判不了），这是刻意的：宁可漏，不要误报。
 */
export function needsAcceptance(row = {}) {
  const status = String(row.status || '').toUpperCase()
  if (!ARRIVED_STATUSES.includes(status)) return false
  if (row.acceptanceNo) return false
  const type = String(row.orderType || '').toUpperCase()
  // 明确是采购申请（CGSQ）的没有验收单；没填类型的按"可能需要"算 ——
  // 宁可多提醒一条，也不要因为历史数据没填类型而整列看不见（2026-11-10）
  return type !== 'CGSQ'
}

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
    // 状态色（2026-11-02）：列头色条与卡片左边都用它 —— groupLedger 上次就是漏了这行
    color: c.color,
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

/**
 * 「这需求提了多久」——卡片底部右侧用。
 *
 * 为什么用它、而不是显示 "OA 已提 / 待提单"：
 * 那两个字**每一列都知道**（待提单列里全是待提单、等货列里全是已提单），
 * 在卡片上再写一遍是纯噪音。这一格换上"提出 N 天"，回答的是另一个问题：
 * **这件事拖了多久**。看板上其他位置都没有这个信息。
 *
 * 日期按**本地日**比较：后端给的是 `YYYY-MM-DD`（没有时区），
 * 用 Date.UTC 拼出来再相减，避免夏令时/时区把天数算成 0.99 天。
 *
 * @param {object} row 采购行
 * @param {Date} [today] 注入"今天"，便于单测
 */
export function requestAgeLabel(row = {}, today = new Date()) {
  const raw = String(row.requestDate || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '未填提出日期'

  const [y, m, d] = raw.split('-').map(Number)
  const [ty, tm, td] = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
  const a = Date.UTC(y, m - 1, d)
  const b = Date.UTC(ty, tm - 1, td)
  const days = Math.round((b - a) / 86400000)

  if (!Number.isFinite(days)) return '未填提出日期'
  if (days <= 0) return '今天提出'
  if (days === 1) return '昨天提出'
  return `提出 ${days} 天`
}

/*
 * ===== 按 OA 单号合并卡片（2026-10-23，变更-168）=====
 *
 * 使用方：「通常一个 OA 单号对应多个卡片，这样可以做成一个卡片」。
 * 实测线上 6 条待处理里，**5 条共用 CG-CGSQ-20261022006** —— 也就是同一个 OA
 * 批一次采购了 5 种料，看板上却是 5 张卡，把「一件事」摊成了「五件事」，
 * 列里根本看不出"这张 OA 到底催几次"。
 *
 * 合并口径（使用方逐条定过）：
 *   · 分组键 = oaNo；**没有单号的行不参与分组**，各自一张（不能硬凑）
 *   · 卡片归哪一列 = 组内**最急**那条的状态（超期 > 临期 > 待提单 > 等货 > 已到货）
 *   · 卡上的「要求到货 / 还剩 N 天」取组内**最早**的那个要求到货日
 *   · 需求人取去重后的集合，超过 1 人时显示「张主任 等 2 人」
 *   · 列头数量 = 卡片数 · 物料条数
 */

/** 紧急度排名：数字越小越急。用于"整组归哪一列""组内谁排第一" */
const URGENCY_RANK = { OVERDUE: 0, DUE_SOON: 1, PENDING_OA: 2, WAITING: 3, ARRIVED: 4, PARTIAL: 4 }

/** 状态 → 紧急度（认不出来的排最后） */
function rankOf(row) {
  const rank = URGENCY_RANK[String(row?.status || '').toUpperCase()]
  return rank === undefined ? 5 : rank
}

/**
 * 组内排序 / 选"这条卡的代表行"用的比较器。
 *
 * ⚠️ 与 `compareUrgency` 的区别，别合并：
 *   · `compareUrgency` 只比"超期天数 → 到货日期" —— 它不知道"待提单比等货更急"，
 *     因为**待提单的行根本没有到货日期/剩余天数**（还没提单），会被排到后面；
 *   · 这里先比**状态紧急度**（超期 > 临期 > 待提单 > 等货 > 已到货），
 *     再比超期天数、到货日期、id。
 *   使用方 2026-10-23 的口径是「一张卡归到最急那条的列」，所以这张卡的代表行
 *   必须按状态判，否则一个"待提单 + 等货"混着的 OA 会跑到等货列去。
 */
function compareGroupLead(a, b) {
  const ra = rankOf(a)
  const rb = rankOf(b)
  if (ra !== rb) return ra - rb
  return compareUrgency(a, b)
}


/**
 * 把采购行按 OA 单号合并成"卡片组"。
 *
 * @param {Array<object>} rows
 * @returns {Array<{key: string, oaNo: string, oaUrl: string, rows: object[], lead: object,
 *                  count: number, earliestArrival: string, requesters: string[]}>}
 */
export function groupCardsByOa(rows = []) {
  const byOa = new Map()
  const singles = []

  for (const row of rows || []) {
    const oaNo = String(row?.oaNo || '').trim()
    if (!oaNo) {
      singles.push({ key: `row-${row.id}`, oaNo: '', oaUrl: row.oaUrl || '', rows: [row] })
      continue
    }
    let group = byOa.get(oaNo)
    if (!group) {
      group = { key: `oa-${oaNo}`, oaNo, oaUrl: '', rows: [] }
      byOa.set(oaNo, group)
    }
    group.rows.push(row)
    // 同一 OA 的链接应该一样；取第一个非空，避免某条漏填导致整组没链接
    if (!group.oaUrl && row.oaUrl) group.oaUrl = row.oaUrl
  }

  return [...byOa.values(), ...singles].map((group) => {
    const sorted = group.rows.slice().sort(compareGroupLead)
    const arrivals = sorted
      .map((r) => String(r.requiredArrivalDate || '').trim())
      .filter(Boolean)
      .sort()
    const requesters = [...new Set(sorted.map((r) => String(r.requester || '').trim()).filter(Boolean))]

    return {
      ...group,
      rows: sorted,
      count: sorted.length,
      lead: sorted[0],
      earliestArrival: arrivals[0] || '',
      /** 最急那条的"还剩几天"—— 卡面底部用它，口径仍在后端（dueLabel 不自己算） */
      requesters,
    }
  })
}

/** 需求人文案：「张主任」/「张主任 等 2 人」/「未填需求人」 */
export function requesterSummary(requesters = []) {
  const list = requesters.filter(Boolean)
  if (!list.length) return '未填需求人'
  if (list.length === 1) return list[0]
  return `${list[0]} 等 ${list.length} 人`
}

/**
 * 按"组内最急那条"的状态分列，并给出列头要的 卡片数 / 物料条数。
 *
 * @returns {{ key: string, label: string, hint: string,
 *             cards: object[], cardCount: number, rowCount: number }[]}
 */
export function groupBoardByOa(rows = []) {
  const buckets = new Map(BOARD_COLUMNS.map((c) => [c.key, []]))
  for (const card of groupCardsByOa(rows)) {
    const key = columnOfStatus(card.lead?.status)
    if (key) buckets.get(key).push(card)
  }

  return BOARD_COLUMNS.map((col) => {
    const cards = buckets.get(col.key).slice().sort((a, b) => compareGroupLead(a.lead, b.lead))
    return {
      key: col.key,
      label: col.label,
      hint: col.hint,
      // 状态色（2026-11-02）：列头色条与卡片左边都用它
      color: col.color,
      cards,
      cardCount: cards.length,
      rowCount: cards.reduce((sum, card) => sum + card.count, 0),
    }
  })
}

/*
 * ===== 费用申请看板（2026-11-10，变更-182）=====
 *
 * 使用方的分法（原话）：「如果是采购申请，就是在采购看板下。如果是资产申购或是
 * 服务采购申请，就是在费用申请下」。
 *
 * 三列的口径是他逐条定的：
 *   待提单  没有 OA 单号（还没提）
 *   待验收  有 OA 单号、验收单号空着 —— **到没到货都算**（他要的是"该去要验收单了"）
 *   已关联验收  验收单号非空，只放最近 30 天，更早的折叠成一行提示
 *
 * 这三列合起来 = 全部行，不丢任何一条；采购买板里那套「超期」在这里**不存在**
 * （原话：「待提单 / 待验收 / 已验收，这个不存在超期」；2026-11-10 使用方把列名改成「已关联验收」），所以列色与卡片都不带急慢语义。
 */
export const EXPENSE_COLUMNS = [
  { key: 'pendingOa', label: '待提单', hint: '还没提交 OA，要人去提单', color: '#4A5A7B' },
  { key: 'toAccept', label: '待验收', hint: 'OA 已提，验收单还没录', color: '#3F6E6A' },
  { key: 'accepted', label: '已关联验收', hint: '验收单已关联（近 30 天）', color: '#5B6E4F' },
]

/** 费用申请 = 资产申购 + 服务采购申请（顺序即新增时的默认值优先顺序） */
export const EXPENSE_ORDER_TYPES = ['ZCSG', 'FWCGSQ']

/** 已关联验收列的时间窗口（天） */
export const EXPENSE_ACCEPTED_WINDOW_DAYS = 30

/**
 * 从 OA 单号推断单据类型（2026-11-10）。
 *
 * 为什么要有：历史数据里有 `order_type` 空着、单号却明明白白带 `CGSQ` 的行。
 * 使用方 2026-11-10 确认「按单号推断，认不出才归采购」——
 * 不推断的话这些行会从两个看板里**同时消失**（谁都不认），那是数据静默丢失。
 */
export function inferOrderType(oaNo = '') {
  const s = String(oaNo || '').toUpperCase()
  if (s.includes('FWCGSQ')) return 'FWCGSQ'
  if (s.includes('ZCSG')) return 'ZCSG'
  if (s.includes('CGSQ')) return 'CGSQ'
  return ''
}

/** 这条记录真正的类型：填了就用填的，没填就按单号推断（推断不出给空串） */
export function effectiveOrderType(row = {}) {
  return String(row.orderType || '').toUpperCase() || inferOrderType(row.oaNo)
}

/** 把 `2026-10-19` / `2026-10-19T10:00:00` / `2026-10-19 10:00:00` 统一成日期串 */
function isoDay(value) {
  const s = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''
}

/** 距今多少天（正 = 过去）。日期非法返回 NaN —— 调用方按「不确定」处理 */
function daysSince(iso, today = new Date()) {
  if (!iso) return Number.NaN
  const [y, m, d] = iso.split('-').map(Number)
  const a = Date.UTC(y, m - 1, d)
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((b - a) / 86400000)
}

/*
 * 已关联验收列的排序与 30 天窗口都用这个日期：**到货日 → 更新时间 → 提出日**。
 * 库里没有"验收单录入时间"这一列（有单号即已验收，刻意不加冗余列），
 * 到货日是最接近"这件事办完"的时间；再退就不是时间，只是个兜底。
 */
function acceptanceDayOf(row = {}) {
  return isoDay(row.actualArrivalDate) || isoDay(row.updateTime) || isoDay(row.requestDate)
}

function idOf(row) {
  return Number(row?.id) || 0
}

/** 待提单列：提得越早越靠上（这批单等最久） */
function byRequestDateAsc(a, b) {
  const da = isoDay(a.requestDate)
  const db = isoDay(b.requestDate)
  if (da !== db) {
    if (!da) return 1
    if (!db) return -1
    return da < db ? -1 : 1
  }
  return idOf(a) - idOf(b)
}

/** 待验收列：要求到货日早的靠上（该来的先到），没填的排最后 */
function byArrivalAsc(a, b) {
  const da = isoDay(a.requiredArrivalDate)
  const db = isoDay(b.requiredArrivalDate)
  if (da !== db) {
    if (!da) return 1
    if (!db) return -1
    return da < db ? -1 : 1
  }
  return idOf(a) - idOf(b)
}

/** 已关联验收列：最近办完的靠上 */
function byAcceptedDesc(a, b) {
  const da = acceptanceDayOf(a)
  const db = acceptanceDayOf(b)
  if (da !== db) {
    if (!da) return 1
    if (!db) return -1
    return da > db ? -1 : 1
  }
  return idOf(b) - idOf(a)
}

/**
 * 费用申请：分三列 + 已关联验收 30 天窗口。
 *
 * @param {Array<object>} rows 采购行（VO）
 * @param {Date} [today] 注入"今天"，便于单测
 * @returns {{ columns: Array<{key,label,hint,color,cards,cardCount,rowCount}>, staleCount: number }}
 *          `staleCount` = 已关联验收但早于窗口的**条数**（不是卡片数），界面底部用它提示
 */
export function groupExpenseBoardByOa(rows = [], today = new Date()) {
  const pending = []
  const toAccept = []
  const accepted = []
  let staleCount = 0

  for (const row of rows || []) {
    const oa = String(row?.oaNo || '').trim()
    if (!oa) {
      pending.push(row)
      continue
    }
    if (!String(row?.acceptanceNo || '').trim()) {
      toAccept.push(row)
      continue
    }
    const age = daysSince(acceptanceDayOf(row), today)
    // 日期不可解析（NaN）也算"近期"：宁可多显示一条，也不要因为脏数据把已办完的藏起来
    if (Number.isFinite(age) && age > EXPENSE_ACCEPTED_WINDOW_DAYS) {
      staleCount += 1
      continue
    }
    accepted.push(row)
  }

  /** 先按 OA 合并，再按各列自己的口径排（行序与卡序都要重排） */
  function cardsOf(list, rowCmp) {
    return groupCardsByOa(list)
      .map((card) => {
        const sorted = card.rows.slice().sort(rowCmp)
        return { ...card, rows: sorted, lead: sorted[0] }
      })
      .sort((a, b) => rowCmp(a.lead, b.lead))
  }

  const definitions = [
    { ...EXPENSE_COLUMNS[0], cards: cardsOf(pending, byRequestDateAsc) },
    { ...EXPENSE_COLUMNS[1], cards: cardsOf(toAccept, byArrivalAsc) },
    { ...EXPENSE_COLUMNS[2], cards: cardsOf(accepted, byAcceptedDesc) },
  ]

  return {
    columns: definitions.map((col) => ({
      ...col,
      cardCount: col.cards.length,
      rowCount: col.cards.reduce((sum, card) => sum + card.count, 0),
    })),
    staleCount,
  }
}
