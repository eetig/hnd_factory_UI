<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import {
  ElAutocomplete,
  ElButton,
  ElDatePicker,
  ElDialog,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
} from 'element-plus'
import request from '../../api/request'
import { STATUS_TONE } from '../../constants/statusTones'
import { useMaterialLookup } from '../../composables/useMaterialLookup'
import DeliveryNoteUpload from '../DeliveryNoteUpload.vue'
import { CATEGORY_OPTIONS, UNIT_OPTIONS, blankDraft } from './fields.js'

const CATEGORY_STORE_KEY = 'hnd-purchase-categories'

/**
 * 采购需求：一张 OA 单 = 一张可编辑的单据（2026-11-10 变更-184）。
 *
 * ## 使用方这次的诉求（原话）
 *
 *   「最上面固定信息是 OA 单号，下面就是序号、物料名称、物料编码、规格型号、数量、
 *     类别、用途、要求到货日期、实际到货数量、实际到货日期、备注、送货单图片。
 *     为什么要加序号呢，因为一个 OA 单号一般不会只买一种物料。
 *     所以之前很多输入框占一行就不行，它没必要占一行，太占位置了。」
 *
 * 所以这一版把「一行一个表单」换成**一张可编辑的台账**：抬头是整单只一份的东西
 * （OA 单号/链接、单据类型、采购单/验收单号与链接），表体是一条物料一行，
 * 底部一次存完整单。原来点定单里的某一行只能改那一条，改完还得退出去再点下一条。
 *
 * ## 两层
 *
 *   docket —— 只读单据视图（有 OA 单号时默认进入）。认单、看全貌。
 *   edit   —— 可编辑台账。新增/编辑都走它；行可增删，一次保存全部。
 *
 * 没有 OA 单号的老数据照样能编：直接进台账，抬头留空，不会伪造单号。
 *
 * ## 为什么列宽都写死
 *
 * 14 列挤在一张桌上，靠 `table-fixed` + 明确列宽才能保证「序号列不抖、物料名列吃掉
 * 剩余宽度」。改列宽只改 `<colgroup>` 一处，不要在单元格里加 padding 猜宽度。
 */

const props = defineProps({
  /* 遮罩要不要挂到 body（默认 true，2026-10-22 变更-141） */
  appendToBody: { type: Boolean, default: true },
  modelValue: { type: Boolean, default: false },
  mode: { type: String, default: 'edit' }, // 'create' | 'edit'
  row: { type: Object, default: null },
  canEdit: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
  /** 「从某张单里新加一条」的预填值（父组件切 create 时一起给） */
  seed: { type: Object, default: null },
  /** 新建时的默认单据类型：采购看板 CGSQ、费用申请 ZCSG */
  defaultOrderType: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'save', 'delete'])

const { fetchMaterialSuggestions, cancelMaterialSearch } = useMaterialLookup()

/* ─────────── 单据视图的数据 ─────────── */

const orderRows = ref([])
const orderLoading = ref(false)
const orderError = ref('')

const STATUS_TEXT = {
  OVERDUE: '超期',
  DUE_SOON: '临期',
  PENDING_OA: '待提单',
  WAITING: '等货',
  ARRIVED: '已到货',
  PARTIAL: '部分到货',
}

const TYPE_TEXT = {
  CGSQ: '采购申请',
  FWCGSQ: '服务采购申请',
  ZCSG: '资产申购',
}

function statusClass(key) {
  switch (key) {
    case 'OVERDUE':
      return STATUS_TONE.error
    case 'DUE_SOON':
      return STATUS_TONE.warning
    case 'ARRIVED':
      return STATUS_TONE.success
    case 'PARTIAL':
      return STATUS_TONE.info
    default:
      return STATUS_TONE.neutral
  }
}

function oaNoOf(row) {
  return String(row?.oaNo || '').trim()
}

/** 单号本身带类型码（CG-CGSQ-… / F-FWCGSQ-… / F-ZCSG-…），老数据 order_type 是空的，按单号认 */
function inferOrderType(oaNo) {
  const no = String(oaNo || '').toUpperCase()
  if (!no) return ''
  if (no.includes('FWCGSQ')) return 'FWCGSQ'
  if (no.includes('ZCSG')) return 'ZCSG'
  if (no.includes('CGSQ')) return 'CGSQ'
  return ''
}

function todayIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function md(value) {
  const raw = String(value || '').trim()
  const m = raw.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}-${m[2]}` : raw || '—'
}

function dueHint(row) {
  const status = String(row?.status || '').toUpperCase()
  if (status === 'OVERDUE' && row.overdueDays) return `超 ${row.overdueDays} 天`
  if (status === 'DUE_SOON') {
    const d = row?.daysToDue
    if (d === null || d === undefined) return ''
    return d === 0 ? '今天到期' : `剩 ${d} 天`
  }
  return ''
}

function quantityText(row) {
  const q = String(row?.quantity ?? '').trim()
  const u = String(row?.unit ?? '').trim()
  return q ? `${q}${u}` : '—'
}

/** 同单明细：按提出日期正序（早提的在上），同日按 id 兜底保证顺序稳定 */
const sortedRows = computed(() => {
  const rows = orderRows.value.length ? orderRows.value : props.row ? [props.row] : []
  return [...rows].sort((a, b) => {
    const x = String(a?.requestDate || '')
    const y = String(b?.requestDate || '')
    if (x !== y) return x < y ? -1 : 1
    return (a?.id ?? 0) - (b?.id ?? 0)
  })
})

const docket = computed(() => {
  const rows = sortedRows.value
  const distinct = (key) => {
    const out = []
    for (const r of rows) {
      const v = String(r?.[key] ?? '').trim()
      if (v && !out.includes(v)) out.push(v)
    }
    return out
  }
  const dates = rows
    .map((r) => String(r?.requestDate || '').trim())
    .filter(Boolean)
    .sort()
  const poNos = distinct('poNo')
  const acceptanceNos = distinct('acceptanceNo')
  const types = distinct('orderType')
  const oaNo = oaNoOf(props.row) || String(rows[0]?.oaNo || '').trim()

  return {
    rows,
    oaNo,
    oaUrl: distinct('oaUrl')[0] || '',
    orderType: types[0] || inferOrderType(oaNo),
    orderTypeExtra: types.length > 1,
    poNo: poNos[0] || '',
    poUrl: distinct('poUrl')[0] || '',
    poExtra: poNos.length > 1,
    acceptanceNo: acceptanceNos[0] || '',
    acceptanceUrl: distinct('acceptanceUrl')[0] || '',
    acceptanceExtra: acceptanceNos.length > 1,
    people: distinct('requester'),
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
  }
})

const docketMeta = computed(() => {
  const d = docket.value
  const count = `${d.rows.length} 条需求`
  const people =
    d.people.length > 3 ? `${d.people.slice(0, 3).join('、')} 等 ${d.people.length} 人` : d.people.join('、')
  let when = ''
  if (d.firstDate && d.lastDate && d.firstDate !== d.lastDate) {
    when = `提出 ${d.firstDate} 至 ${d.lastDate}`
  } else if (d.firstDate) {
    when = `提出 ${d.firstDate}`
  }
  return [count, people, when].filter(Boolean).join(' · ')
})

const typeLabel = computed(() => {
  const t = docket.value.orderType
  if (!t) return ''
  return TYPE_TEXT[t] ? `${TYPE_TEXT[t]} ${t}` : t
})

/* ─────────── 视图切换 ─────────── */

/** 'docket'（整张单，只读）| 'edit'（整张单，可编辑台账） */
const view = ref('edit')
/** 是不是从只读单据点进台账的：决定 Esc / 「返回单据」回哪里 */
const cameFromDocket = ref(false)
const isDocket = computed(() => view.value === 'docket')
const isCreate = computed(() => props.mode === 'create' && !docket.value.oaNo)

const title = computed(() => {
  if (isDocket.value) return docket.value.oaNo || '采购需求'
  if (isCreate.value) return '新增采购需求'
  return docket.value.oaNo ? `编辑 ${docket.value.oaNo}` : '编辑采购需求'
})

/* ─────────── 台账（编辑层） ─────────── */

/** 整单只一份的字段（抬头那两行） */
const header = ref({
  oaNo: '',
  oaUrl: '',
  orderType: '',
  poNo: '',
  poUrl: '',
  acceptanceNo: '',
  acceptanceUrl: '',
})

/**
 * 链接小窗：三个链接字段共用一个小弹窗。
 * 使用方要的是「单号留在桌面上，链接点开再填」——所以在单号框右边挂一个小按钮，
 * 不占表头格子，也让表头能塞进一行四格。
 */
const linkDialog = ref({ open: false, field: '', label: '', hint: '', draft: '' })

function openLink(field, label, hint = '') {
  linkDialog.value = {
    open: true,
    field,
    label,
    hint,
    draft: String(header.value[field] || ''),
  }
}

function saveLink() {
  const { field } = linkDialog.value
  if (!field) return
  const value = String(linkDialog.value.draft || '').trim()
  if (value && !/^https?:\/\//i.test(value)) {
    ElMessage.warning('链接要以 http:// 或 https:// 开头')
    return
  }
  header.value[field] = value
  linkDialog.value.open = false
}

function clearLink() {
  const { field } = linkDialog.value
  if (field) header.value[field] = ''
  linkDialog.value.open = false
}

function openLinkTarget() {
  const value = String(linkDialog.value.draft || '').trim()
  if (!/^https?:\/\//i.test(value)) {
    ElMessage.warning('链接要以 http:// 或 https:// 开头')
    return
  }
  window.open(value, '_blank', 'noopener')
}

/** 表体：一条物料一行。`id` 有值 = 库里已存在；`key` 只给 v-for 用 */
const lines = ref([])
/** 每行的错误提示，索引对齐 lines */
const lineErrors = ref([])
/** 自动聚焦物料名用：行索引 → 组件实例 */
const nameRefs = new Map()
let tmpSeq = 0

let snapshot = ''

function newLine(seed = {}) {
  tmpSeq += 1
  return { ...blankDraft(), ...seed, _key: `tmp-${tmpSeq}` }
}

function lineOf(row) {
  const base = { ...blankDraft(), ...(row || {}) }
  tmpSeq += 1
  return { ...base, _key: `row-${row?.id ?? tmpSeq}` }
}

/** 抬头从同单各行里取第一个非空值 */
function headerOf(rows) {
  const first = (key) => {
    for (const r of rows) {
      const v = String(r?.[key] ?? '').trim()
      if (v) return v
    }
    return ''
  }
  const oaNo = first('oaNo')
  return {
    oaNo,
    oaUrl: first('oaUrl'),
    orderType: first('orderType') || inferOrderType(oaNo),
    poNo: first('poNo'),
    poUrl: first('poUrl'),
    acceptanceNo: first('acceptanceNo'),
    acceptanceUrl: first('acceptanceUrl'),
  }
}

const dirty = computed(() => JSON.stringify({ h: header.value, l: lines.value }) !== snapshot)

/**
 * 单据类型只读、跟着单号自动走（使用方 2026-11-11 定口径）。
 *
 * 单号认得出就以单号为准；认不出（或还没填单号）才用打开时给的默认值 ——
 * 费用申请页新增时默认 ZCSG，这样不填单号也能先把明细录进去。
 */
const effectiveType = computed(
  () => inferOrderType(header.value.oaNo) || header.value.orderType || '',
)

/** 只读单据里要不要留「验收单」这一行：该类型会有，或者老数据已经填过 */
const docketShowsAcceptance = computed(
  () => ['ZCSG', 'FWCGSQ'].includes(docket.value.orderType) || !!docket.value.acceptanceNo,
)

/** 只有资产申购 / 服务采购申请才产生验收单，CGSQ 后面就没有了 */
const hasAcceptance = computed(() => ['ZCSG', 'FWCGSQ'].includes(effectiveType.value))

function typeLabelOf(t) {
  if (!t) return ''
  return TYPE_TEXT[t] ? `${TYPE_TEXT[t]} ${t}` : t
}

// 单号一敲完就把类型定下来，抬头即时跟着变
watch(
  () => header.value.oaNo,
  (value) => {
    const inferred = inferOrderType(value)
    if (inferred) header.value.orderType = inferred
  },
)

const filledCount = computed(
  () => lines.value.filter((l) => String(l.materialName || '').trim()).length,
)

/** 打开台账：seed 行排在最前（新加的、还没 id） */
function openEditor(rows, extraSeed = null, fromDocket = false) {
  cameFromDocket.value = fromDocket
  const list = Array.isArray(rows) ? rows.filter(Boolean) : []
  header.value = list.length ? headerOf(list) : { ...header.value }
  if (!list.length && props.defaultOrderType && !header.value.orderType) {
    header.value.orderType = props.defaultOrderType
  }
  if (!header.value.orderType && header.value.oaNo) {
    header.value.orderType = inferOrderType(header.value.oaNo)
  }
  const draft = list.map(lineOf)
  // 老数据里出现过的类别也收进下拉，换个词就知道能不能选
  mergeCategories(draft.map((l) => l.category))
  const seedLine = extraSeed ? newLine({ ...extraSeed, requester: extraSeed.requester || '' }) : null
  lines.value = seedLine ? [seedLine, ...draft] : draft.length ? draft : [newLine()]
  lineErrors.value = []
  snapshot = JSON.stringify({ h: header.value, l: lines.value })
  view.value = 'edit'
  playEnterAnimation()
  nextTick(() => {
    if (!list.length) setTimeout(() => nameRefs.get(0)?.focus?.(), 80)
  })
}

function addLine() {
  lines.value.push(
    newLine({
      requester: lines.value[lines.value.length - 1]?.requester || '',
      // 同一批通常同一天提的：日期也一起带下来，别让人每行点一次日历
      requestDate: todayIso(),
    }),
  )
  lineErrors.value = []
  nextTick(() => {
    const idx = lines.value.length - 1
    setTimeout(() => nameRefs.get(idx)?.focus?.(), 40)
  })
}

async function removeLine(index) {
  const line = lines.value[index]
  if (line?.id) {
    try {
      await ElMessageBox.confirm(
        `从这张单里删掉「${line.materialName || '这条物料'}」？删除后不可恢复，送货单图片也会一起删。`,
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    emit('delete', { ...line })
  }
  lines.value.splice(index, 1)
  lineErrors.value = []
  if (!lines.value.length) lines.value = [newLine()]
  snapshot = JSON.stringify({ h: header.value, l: lines.value })
}

/**
 * 必填：需求人 / 提出日期 / 物料名称 / 数量。
 *
 * 数量只对**新加的行**强制：老数据里有一批（如资产申购）当初就没填数量，
 * 编辑这类单子时若还逼着补数量，等于「改个备注都存不了」
 * （2026-11-12 用户报的「编辑了后不能保存」就是这个）。
 * 已有 id 的行照旧保存，空就存空。
 */
function problemOf(line) {
  if (!String(line.requester || '').trim()) return '需求人空着'
  if (!String(line.requestDate || '').trim()) return '提出日期空着'
  if (!String(line.materialName || '').trim()) return '物料名称空着'
  if (!line?.id && !String(line.quantity || '').trim()) return '数量空着'
  return ''
}

/**
 * 「这一行其实还没填」—— 只加了一行就放着没动，不该拦住整单。
 *
 * 判据只看物料三件套：需求人和提出日期是**自动带出来的**（复制上一行/今天），
 * 所以它们有值不代表这一行要保存。已经存进库的行（有 id）永远不算空。
 */
function isBlank(line) {
  if (line?.id) return false
  return !String(line.materialName || '').trim() && !String(line.materialCode || '').trim()
}

const problemText = computed(() => {
  const out = []
  lines.value.forEach((line, i) => {
    if (isBlank(line)) return
    const p = problemOf(line)
    if (p) out.push(`第 ${i + 1} 行${p}`)
  })
  return out
})

/** 组装交给父组件的行：抬头字段逐行冗余存（库里按行存）+ 行自己的字段 */
function buildRows() {
  return lines.value
    .filter((l) => !isBlank(l) && problemOf(l) === '')
    .map((l) => {
      const { _key, ...rest } = l
      const row = { ...rest, ...header.value, orderType: effectiveType.value || rest.orderType || '' }
      // 后端不需要前端算出来的状态与天数
      delete row.status
      delete row.statusLabel
      delete row.overdueDays
      delete row.daysToDue
      delete row.partial
      delete row.accepted
      return row
    })
}

function submit() {
  if (!props.canEdit || props.saving) return
  /*
   * 判断顺序（变更-199）：
   *   1) 一行都没填 → 才说「先填一条」；
   *   2) 有行但没填全 → 直接说是哪一行哪个字段空着。
   * 反过来写会踩坑：`buildRows()` 会把没填全的行过滤掉，于是
   * 「数量空着」这种行会先触发「一行物料都没填」，把真正的原因藏起来
   * （用户 2026-11-12 报的「编辑后保存不了」就是这个）。
   */
  if (!lines.value.some((l) => !isBlank(l))) {
    ElMessage.error('一行物料都没填，先填一条再保存')
    return
  }
  const problems = problemText.value
  if (problems.length) {
    lineErrors.value = lines.value.map((l) => problemOf(l))
    ElMessage.error(
      problems.length === 1 ? `${problems[0]}，补齐再保存` : `${problems[0]} 等 ${problems.length} 行没填全`,
    )
    return
  }
  const rows = buildRows()
  mergeCategories(rows.map((r) => r.category))
  emit('save', { header: { ...header.value }, rows })
}

/** 物料联想：选中名称/编码后把另一半补齐（一行一套） */
/* ─────────── 类别：内置几个 + 自己填过的 ───────────
   类别没有主数据表，就在浏览器里记住用户填过的值，
   下次打开下拉能直接选；后端 /api/purchase/categories 上线后再并进来。 */
const categoryOptions = ref([...CATEGORY_OPTIONS])

function loadRememberedCategories() {
  try {
    const raw = localStorage.getItem(CATEGORY_STORE_KEY)
    const saved = raw ? JSON.parse(raw) : []
    if (Array.isArray(saved)) mergeCategories(saved)
  } catch {
    // 存储被禁或内容坏了都不影响填表
  }
}

function mergeCategories(values) {
  const set = new Set(categoryOptions.value)
  let changed = false
  for (const raw of values) {
    const v = String(raw ?? '').trim()
    if (v && !set.has(v)) {
      set.add(v)
      changed = true
    }
  }
  if (changed) {
    categoryOptions.value = [...set]
    try {
      localStorage.setItem(CATEGORY_STORE_KEY, JSON.stringify(categoryOptions.value))
    } catch {
      // 存不进去也无所谓，本次会话里照样能选
    }
  }
}

loadRememberedCategories()

/* 点一下就复制：单号、编码、规格这些都要拿去别处粘贴，尤其手机/截图对账时 */
async function copyText(text, label) {
  const value = String(text ?? '').trim()
  if (!value || value === '—') return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      const ta = document.createElement('textarea')
      ta.value = value
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success(`已复制${label}`)
  } catch {
    ElMessage.warning('复制失败，手动选中吧')
  }
}

function pickMaterial(option, index, source) {
  if (!option) return
  const line = lines.value[index]
  if (!line) return
  if (source === 'name') {
    line.materialName = option.name || option.code
    line.materialCode = option.code
  } else {
    line.materialCode = option.code
    if (option.name) line.materialName = option.name
  }
  // 规格跟着物料走：换物料就得换规格，不能留着上一条的（只有物料本身没规格时才保留已填内容）
  if (option.spec) line.spec = option.spec
}

function setNameRef(el, index) {
  if (el) nameRefs.set(index, el)
  else nameRefs.delete(index)
}

function fillAllDelivered(index) {
  const line = lines.value[index]
  line.receivedQuantity = line.quantity
  line.actualArrivalDate = todayIso()
}

/* ─────────── 取同单明细 ─────────── */

async function loadOrder(oaNo) {
  if (!oaNo) return
  orderLoading.value = true
  orderError.value = ''
  try {
    const res = await request.get('/api/purchase/list', {
      params: { keyword: oaNo, pageNum: 1, pageSize: 200 },
    })
    if (res.data?.success === false) throw new Error(res.data.msg || '取不到这张单的其它明细。')
    const all = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    const exact = all.filter((r) => oaNoOf(r) === oaNo)
    orderRows.value = exact.length ? exact : props.row ? [props.row] : []
  } catch (error) {
    orderRows.value = props.row ? [props.row] : []
    orderError.value =
      error?.response?.data?.msg || error?.message || '取不到这张单的其它明细，下面只显示当前这一条。'
  } finally {
    orderLoading.value = false
  }
}

/* ─────────── 打开 / 关闭 ─────────── */

const entering = ref(false)
let enterTimer = null

function playEnterAnimation() {
  entering.value = false
  clearTimeout(enterTimer)
  requestAnimationFrame(() => {
    entering.value = true
    enterTimer = setTimeout(() => {
      entering.value = false
    }, 460)
  })
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      cancelMaterialSearch()
      orderRows.value = []
      nameRefs.clear()
      return
    }
    if (props.mode === 'edit' && props.row) {
      const oaNo = oaNoOf(props.row)
      if (oaNo) {
        view.value = 'docket'
        orderRows.value = [props.row]
        playEnterAnimation()
        await loadOrder(oaNo)
        return
      }
      openEditor([props.row])
      return
    }
    // 新增：有 seed（从某张单里加一条）就带着单据级字段，没有就空单
    header.value = {
      oaNo: '',
      oaUrl: '',
      orderType: props.seed?.orderType || props.defaultOrderType || '',
      poNo: props.seed?.poNo || '',
      poUrl: props.seed?.poUrl || '',
      acceptanceNo: props.seed?.acceptanceNo || '',
      acceptanceUrl: props.seed?.acceptanceUrl || '',
    }
    if (!header.value.oaNo && props.seed?.oaNo) header.value.oaNo = props.seed.oaNo
    if (!header.value.oaUrl && props.seed?.oaUrl) header.value.oaUrl = props.seed.oaUrl
    openEditor([], {
      requester: props.seed?.requester || '',
      requestDate: props.seed?.requestDate || todayIso(),
    })
  },
  { immediate: true },
)

watch(
  () => props.mode,
  (mode) => {
    if (!props.modelValue) return
    if (mode === 'create' && view.value === 'docket') {
      // 换到「新建」就是一张新单：抬头不能带着上一张单的单号
      header.value = {
        oaNo: '',
        oaUrl: '',
        orderType: props.seed?.orderType || props.defaultOrderType || '',
        poNo: props.seed?.poNo || '',
        poUrl: props.seed?.poUrl || '',
        acceptanceNo: props.seed?.acceptanceNo || '',
        acceptanceUrl: props.seed?.acceptanceUrl || '',
      }
      openEditor([], { requester: props.seed?.requester || '', requestDate: todayIso() })
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

async function requestClose() {
  if (isDocket.value || !dirty.value) {
    close()
    return
  }
  try {
    await ElMessageBox.confirm('关闭后未保存的改动会丢失，确定关闭？', '未保存的改动', {
      confirmButtonText: '关闭',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
  } catch {
    return
  }
  close()
}

function beforeClose(done) {
  if (isDocket.value || !dirty.value) {
    done()
    return
  }
  requestClose()
}

/** 从只读单据进编辑台 */
function editOrder() {
  if (!props.canEdit) return
  openEditor(sortedRows.value, null, true)
}

/** 编辑台回到只读单据 */
async function backToDocket() {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('这张单还有改动没保存，返回单据会丢掉，继续吗？', '未保存的改动', {
        confirmButtonText: '丢改返回',
        cancelButtonText: '继续编辑',
        type: 'warning',
      })
    } catch {
      return
    }
  }
  view.value = 'docket'
  await loadOrder(docket.value.oaNo)
}

/**
 * 保存成功后"接着录下一条"（父组件在 create 模式保存成功后调）。
 * 抬头留着（同一张 OA 单继续补行），表体清成一行空白。
 */
function resetForNextEntry() {
  const keepHeader = { ...header.value }
  lines.value = [newLine({ requestDate: todayIso() })]
  header.value = keepHeader
  lineErrors.value = []
  snapshot = JSON.stringify({ h: header.value, l: lines.value })
  cancelMaterialSearch()
  if (view.value === 'docket') view.value = 'edit'
  nextTick(() => setTimeout(() => nameRefs.get(0)?.focus?.(), 60))
}

/** 兼容老调用：保存完回到只读单据并刷新 */
async function afterLineAdded() {
  view.value = 'docket'
  await loadOrder(docket.value.oaNo)
}

defineExpose({ resetForNextEntry, afterLineAdded })
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :append-to-body="appendToBody"
    width="min(1560px, 98vw)"
    top="10vh"
    :close-on-press-escape="false"
    :close-on-click-modal="false"
    :before-close="beforeClose"
    :show-close="false"
    class="purchase-dialog"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <template #header>
      <div class="flex w-full items-start justify-between gap-6">
        <div class="min-w-0">
          <div v-if="isDocket" class="flex flex-wrap items-center gap-2">
            <span
              v-if="typeLabel"
              class="rounded border border-line px-1.5 py-0.5 text-[11px] tracking-wide text-slate-600"
            >
              {{ typeLabel }}<template v-if="docket.orderTypeExtra"> 等</template>
            </span>
            <span v-else class="text-[11px] tracking-wide text-slate-500">单据类型未填</span>
            <span class="text-[11px] tabular-nums text-slate-500">{{ docketMeta }}</span>
          </div>
          <h2
            class="mt-1.5 truncate text-[22px] leading-tight font-semibold tracking-tight text-slate-900"
            :class="isDocket ? 'tabular-nums text-[26px]' : ''"
          >
            {{ title }}
          </h2>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <a
            v-if="isDocket && docket.oaUrl"
            :href="docket.oaUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
          >
            在 OA 里打开
            <span aria-hidden="true">↗</span>
          </a>
          <button
            type="button"
            class="shrink-0 rounded-full p-1.5 text-slate-500 transition-colors hover:bg-region hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
            aria-label="关闭"
            @click="requestClose"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
    </template>

    <div
      class="drawer-enter"
      :class="{ 'is-entering': entering }"
      @keydown.esc.stop.prevent="isDocket ? requestClose() : cameFromDocket ? backToDocket() : requestClose()"
    >
      <p
        v-if="errorMessage"
        role="alert"
        class="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
      >
        {{ errorMessage }}
      </p>

      <!-- ══════════ 只读单据视图 ══════════ -->
      <div v-if="isDocket" class="flex flex-col">
        <!--
          单据级信息只剩「验收单」一行：采购单号就是 OA 单号（使用方 2026-11-11 明确
          「OA单号就是采购单号，这不是重复了吗」），再摆一格只会让人以为还差一个号。
          CGSQ 不产生验收单，整块不出现；老数据里已经填了验收单的仍然显示。
        -->
        <dl
          v-if="docketShowsAcceptance"
          class="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line"
        >
          <div class="flex min-w-0 items-baseline gap-2 bg-raised px-3 py-2">
            <dt class="shrink-0 text-[11px] tracking-wide text-slate-500">验收单</dt>
            <dd class="min-w-0 truncate text-xs">
              <a
                v-if="docket.acceptanceNo && docket.acceptanceUrl"
                :href="docket.acceptanceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="tabular-nums text-brand-ink hover:underline"
              >{{ docket.acceptanceNo }} ↗</a>
              <span v-else-if="docket.acceptanceNo" class="tabular-nums text-slate-700">{{ docket.acceptanceNo }}</span>
              <span v-else class="text-slate-500">未关联</span>
              <span v-if="docket.acceptanceExtra" class="ml-1 text-slate-500">（同单有多个单号）</span>
            </dd>
          </div>
        </dl>

        <div class="mt-3 overflow-hidden rounded-md border border-line">
          <table class="w-full table-fixed border-collapse text-left">
            <colgroup>
              <col style="width: 74px" />
              <col style="width: 62px" />
              <col style="width: 25%" />
              <col style="width: 104px" />
              <col />
              <col style="width: 118px" />
              <col style="width: 92px" />
              <col style="width: 64px" />
              <col style="width: 62px" />
            </colgroup>
            <thead>
              <tr class="bg-region text-[11px] tracking-wide text-slate-500">
                <th scope="col" class="px-2.5 py-1.5 font-normal">状态</th>
                <th scope="col" class="px-1 py-1.5 font-normal">提出</th>
                <th scope="col" class="px-2 py-1.5 font-normal">物料名称</th>
                <th scope="col" class="px-2 py-1.5 font-normal">物料编码</th>
                <th scope="col" class="px-2 py-1.5 font-normal">规格型号</th>
                <th scope="col" class="px-2 py-1.5 font-normal">用途</th>
                <th scope="col" class="px-2 py-1.5 font-normal">要求到货</th>
                <th scope="col" class="px-2 py-1.5 font-normal">需求人</th>
                <th scope="col" class="px-2 py-1.5 text-right font-normal">数量</th>
              </tr>
            </thead>
            <tbody class="text-xs">
              <tr
                v-for="line in sortedRows"
                :key="line.id"
                class="border-t border-line align-top"
              >
                <td class="px-2.5 py-2">
                  <span class="rounded-full px-1.5 py-0.5 text-[11px]" :class="statusClass(line.status)">
                    {{ STATUS_TEXT[line.status] || '等货' }}
                  </span>
                </td>
                <td class="px-1 py-2 tabular-nums text-slate-500">{{ md(line.requestDate) }}</td>
                <td class="px-2 py-2">
                  <button
                    type="button"
                    class="line-clamp-2 text-left font-medium leading-snug text-slate-900 hover:underline focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                    :title="`点击复制：${line.materialName || ''}`"
                    @click.stop="copyText(line.materialName, '物料名称')"
                  >
                    {{ line.materialName || '未填物料' }}
                  </button>
                </td>
                <td class="truncate px-2 py-2 tabular-nums text-slate-600">
                  <button
                    type="button"
                    class="tabular-nums hover:underline focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                    :title="`点击复制：${line.materialCode || ''}`"
                    @click.stop="copyText(line.materialCode, '物料编码')"
                  >
                    {{ line.materialCode || '—' }}
                  </button>
                </td>
                <td class="px-2 py-2 text-slate-600">
                  <button
                    type="button"
                    class="line-clamp-2 text-left leading-snug hover:underline focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                    :title="`点击复制：${line.spec || ''}`"
                    @click.stop="copyText(line.spec, '规格型号')"
                  >
                    {{ line.spec || '—' }}
                  </button>
                </td>
                <td class="px-2 py-2 text-slate-600" :title="line.purpose || ''">
                  <span class="line-clamp-2 leading-snug">{{ line.purpose || '—' }}</span>
                </td>
                <td class="px-2 py-2">
                  <span class="tabular-nums text-slate-600">{{ md(line.requiredArrivalDate) }}</span>
                  <span
                    v-if="dueHint(line)"
                    class="mt-0.5 block text-[11px] tabular-nums"
                    :class="line.status === 'OVERDUE' ? 'text-rose-700' : 'text-amber-700'"
                  >
                    {{ dueHint(line) }}
                  </span>
                </td>
                <td class="truncate px-2 py-2 text-slate-600" :title="line.requester || ''">
                  {{ line.requester || '—' }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums text-slate-600">{{ quantityText(line) }}</td>
              </tr>
            </tbody>
          </table>

          <p v-if="orderLoading" class="border-t border-line bg-raised px-3 py-2 text-xs text-slate-500">
            正在取这张单的其它明细…
          </p>
          <p
            v-else-if="orderError"
            class="border-t border-line bg-raised px-3 py-2 text-xs text-amber-700"
            role="status"
          >
            {{ orderError }}
            <button
              type="button"
              class="ml-1 underline underline-offset-2 hover:text-amber-800"
              @click="loadOrder(docket.oaNo)"
            >
              重试
            </button>
          </p>
        </div>

      </div>

      <!-- ══════════ 可编辑台账 ══════════ -->
      <div v-else class="flex flex-col gap-3">
        <!--
          抬头：整单只一份的字段，一行之内解决。

          使用方 2026-11-11 把口径说清了（原话）：
            「OA单号如果是包含cgsq，单据类型自动识别为采购申请，后面就没有了。
              如果包含ZCSG或者是fwcgsq，自动识别对应的单据类型，并且后面显示验收单号。」
          以及：「采购单号不要了呀。OA单号就是采购单号，这不是重复了吗」。

          所以：OA 单号是唯一的号；单据类型只读、跟着单号自动走；
          只有 ZCSG / FWCGSQ 才出现「验收单号」（CGSQ 不产生验收单）。
          采购单号/链接字段从界面撤掉，但状态里仍保留（老数据带值的保存时不会被抹）。
        -->
        <section class="rounded-md border border-line bg-region/40 p-2.5">
          <div class="flex flex-wrap items-end gap-3">
            <label class="block w-[300px]">
              <span class="mb-0.5 block text-[11px] text-slate-500">OA 单号</span>
              <el-input
                v-model="header.oaNo"
                size="small"
                placeholder="CG-CGSQ-…"
                aria-label="OA 单号"
                :disabled="!canEdit"
                class="tabular-nums"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="link-chip"
                    :class="{ 'is-on': header.oaUrl }"
                    :title="header.oaUrl || '给这张单加一个 OA 链接'"
                    :aria-label="header.oaUrl ? 'OA 链接已填，点击修改' : '给这张单加 OA 链接'"
                    @click.prevent.stop="openLink('oaUrl', 'OA 链接', '在 OA 里能直接打开这张单')"
                  >
                    链接
                  </button>
                </template>
              </el-input>
            </label>

            <div class="block w-[200px]">
              <span class="mb-0.5 block text-[11px] text-slate-500">单据类型</span>
              <div
                class="flex h-6 items-center gap-2 rounded border border-line bg-raised px-2 text-xs"
                aria-label="单据类型"
                :aria-readonly="true"
                data-test="order-type-readonly"
              >
                <span v-if="effectiveType" class="truncate font-medium text-slate-900">
                  {{ typeLabelOf(effectiveType) }}
                </span>
                <span v-else class="text-slate-500">单号里没写类型</span>
              </div>
            </div>

            <label v-if="hasAcceptance" class="block w-[240px]">
              <span class="mb-0.5 block text-[11px] text-slate-500">验收单号</span>
              <el-input
                v-model="header.acceptanceNo"
                size="small"
                placeholder="YS-…"
                aria-label="验收单号"
                :disabled="!canEdit"
                class="tabular-nums"
              >
                <template #suffix>
                  <button
                    type="button"
                    class="link-chip"
                    :class="{ 'is-on': header.acceptanceUrl }"
                    :title="header.acceptanceUrl || '给验收单加一个链接'"
                    :aria-label="header.acceptanceUrl ? '验收单链接已填，点击修改' : '给验收单加链接'"
                    @click.prevent.stop="openLink('acceptanceUrl', '验收单链接', '验收单在 OA 里的地址')"
                  >
                    链接
                  </button>
                </template>
              </el-input>
            </label>
          </div>
        </section>

        <!-- 表体：一条物料一行 -->
        <div class="overflow-x-auto rounded-md border border-line">
          <table class="w-full min-w-[1516px] table-fixed border-collapse text-left">
            <colgroup>
              <col style="width: 34px" />
              <col style="width: 88px" />
              <col style="width: 112px" />
              <col style="width: 180px" />
              <col style="width: 104px" />
              <col style="width: 150px" />
              <col style="width: 64px" />
              <col style="width: 72px" />
              <col style="width: 88px" />
              <col style="width: 120px" />
              <col style="width: 112px" />
              <col style="width: 60px" />
              <col style="width: 112px" />
              <col style="width: 110px" />
              <col style="width: 76px" />
              <col style="width: 34px" />
            </colgroup>
            <thead>
              <tr class="bg-region text-[11px] tracking-wide text-slate-500">
                <th scope="col" class="px-1 py-1.5 text-right font-normal">#</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">需求人</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">提出</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">物料名称</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">物料编码</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">规格型号</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">数量</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">单位</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">类别</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">用途</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">要求到货</th>
                <th scope="col" class="px-1.5 py-1.5 text-right font-normal">实收</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">实到日期</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">备注</th>
                <th scope="col" class="px-1.5 py-1.5 font-normal">送货单</th>
                <th scope="col" class="px-1 py-1.5"><span class="sr-only">删除</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(line, index) in lines"
                :key="line._key"
                class="border-t border-line align-middle"
                :class="lineErrors[index] ? 'bg-rose-50/40' : ''"
              >
                <td class="px-1 py-1 text-right text-[11px] tabular-nums text-slate-500">
                  {{ index + 1 }}
                </td>
                <td class="px-1 py-1">
                  <el-input
                    v-model="line.requester"
                    size="small"
                    placeholder="需求人"
                    :aria-label="`第 ${index + 1} 行需求人`"
                    :disabled="!canEdit"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-date-picker
                    v-model="line.requestDate"
                    type="date"
                    size="small"
                    value-format="YYYY-MM-DD"
                    placeholder="提出"
                    :aria-label="`第 ${index + 1} 行提出需求日期`"
                    :disabled="!canEdit"
                    class="!w-full"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-autocomplete
                    :ref="(el) => setNameRef(el, index)"
                    v-model="line.materialName"
                    size="small"
                    :fetch-suggestions="fetchMaterialSuggestions"
                    placeholder="打字搜物料名称"
                    :aria-label="`第 ${index + 1} 行物料名称`"
                    :disabled="!canEdit"
                    value-key="label"
                    class="w-full"
                    @select="(opt) => pickMaterial(opt, index, 'name')"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-autocomplete
                    v-model="line.materialCode"
                    size="small"
                    :fetch-suggestions="fetchMaterialSuggestions"
                    placeholder="编码"
                    :aria-label="`第 ${index + 1} 行物料编码`"
                    :disabled="!canEdit"
                    value-key="label"
                    class="w-full tabular-nums"
                    @select="(opt) => pickMaterial(opt, index, 'code')"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-input
                    v-model="line.spec"
                    size="small"
                    placeholder="规格型号"
                    :aria-label="`第 ${index + 1} 行规格型号`"
                    :disabled="!canEdit"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-input
                    v-model="line.quantity"
                    size="small"
                    inputmode="decimal"
                    placeholder="数量"
                    :aria-label="`第 ${index + 1} 行数量`"
                    :disabled="!canEdit"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-select
                    v-model="line.unit"
                    size="small"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="单位"
                    :aria-label="`第 ${index + 1} 行单位`"
                    :disabled="!canEdit"
                    class="w-full"
                  >
                    <el-option v-for="u in UNIT_OPTIONS" :key="u" :label="u" :value="u" />
                  </el-select>
                </td>
                <td class="px-1 py-1">
                  <el-select
                    v-model="line.category"
                    size="small"
                    filterable
                    allow-create
                    default-first-option
                    clearable
                    placeholder="类别"
                    :aria-label="`第 ${index + 1} 行类别`"
                    :disabled="!canEdit"
                    class="w-full"
                  >
                    <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
                  </el-select>
                </td>
                <td class="px-1 py-1">
                  <el-input
                    v-model="line.purpose"
                    size="small"
                    placeholder="用途"
                    :aria-label="`第 ${index + 1} 行用途`"
                    :disabled="!canEdit"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-date-picker
                    v-model="line.requiredArrivalDate"
                    type="date"
                    size="small"
                    value-format="YYYY-MM-DD"
                    placeholder="要求到货"
                    :aria-label="`第 ${index + 1} 行要求到货日期`"
                    :disabled="!canEdit"
                    class="!w-full"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-input
                    v-model="line.receivedQuantity"
                    size="small"
                    inputmode="decimal"
                    placeholder="实收"
                    :aria-label="`第 ${index + 1} 行实际到货数量`"
                    :disabled="!canEdit"
                    class="text-right"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-date-picker
                    v-model="line.actualArrivalDate"
                    type="date"
                    size="small"
                    value-format="YYYY-MM-DD"
                    placeholder="实到"
                    :aria-label="`第 ${index + 1} 行实际到货日期`"
                    :disabled="!canEdit"
                    class="!w-full"
                  />
                </td>
                <td class="px-1 py-1">
                  <el-input
                    v-model="line.remark"
                    size="small"
                    placeholder="备注"
                    :aria-label="`第 ${index + 1} 行备注`"
                    :disabled="!canEdit"
                  />
                </td>
                <td class="px-1 py-1">
                  <DeliveryNoteUpload
                    :value="line.deliveryNote"
                    @update:value="(v) => (line.deliveryNote = v)"
                  />
                </td>
                <td class="px-1 py-1 text-center">
                  <button
                    v-if="canEdit"
                    type="button"
                    class="rounded p-1 text-slate-500 transition-colors hover:bg-raised hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                    :aria-label="`删掉第 ${index + 1} 行`"
                    :title="line.id ? '从这张单里删掉这条' : '去掉这一行'"
                    @click="removeLine(index)"
                  >
                    <svg
                      class="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="canEdit"
              type="button"
              class="rounded-md border border-dashed border-slate-400 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:border-brand-ink hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
              @click="addLine"
            >
              ＋ 加一行
            </button>
            <button
              v-if="canEdit && !isCreate"
              type="button"
              class="rounded-md border border-line px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
              title="把第一行的实收数量填成需求数量、实到日期填成今天"
              @click="fillAllDelivered(0)"
            >
              首行全部到货
            </button>
            <span v-if="problemText.length" data-testid="line-problems" class="text-[11px] text-rose-700">
              {{ problemText.slice(0, 2).join('、') }}{{ problemText.length > 2 ? ` 等 ${problemText.length} 行` : '' }}
            </span>
          </div>
          <p v-if="lines.length && filledCount < lines.length" class="text-[11px] text-slate-500">
            空行不保存
          </p>
        </div>
      </div>
    </div>

    <template #footer>
      <div v-if="isDocket" class="flex w-full items-center justify-between gap-3">
        <span class="text-[11px] tabular-nums text-slate-500">
          共 {{ docket.rows.length }} 条 · 最早提出 {{ docket.firstDate || '—' }}
        </span>
        <div class="flex items-center gap-2">
          <el-button @click="requestClose">关闭</el-button>
          <el-button v-if="canEdit" type="primary" @click="editOrder">编辑</el-button>
        </div>
      </div>

      <div v-else class="flex w-full items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <el-button v-if="cameFromDocket" plain @click="backToDocket">← 返回单据</el-button>
          <span class="text-[11px] tabular-nums text-slate-500">
            已填 {{ filledCount }}/{{ lines.length }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <el-button :disabled="saving" @click="requestClose">取消</el-button>
          <el-button
            v-if="canEdit"
            type="primary"
            :loading="saving"
            @click="submit"
          >
            保存整单
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <!-- 链接小窗：只装一个网址输入框 -->
  <el-dialog
    v-model="linkDialog.open"
    :append-to-body="true"
    width="min(520px, 92vw)"
    :title="linkDialog.label || '链接'"
    class="link-dialog"
  >
    <p v-if="linkDialog.hint" class="mb-2 text-xs text-slate-500">{{ linkDialog.hint }}</p>
    <el-input
      v-model="linkDialog.draft"
      size="small"
      placeholder="https://…"
      aria-label="链接地址"
      @keyup.enter="saveLink"
    />
    <p class="mt-2 text-xs text-slate-500">
      贴一次就够了：这张单下的每一行都用同一个链接。
    </p>
    <template #footer>
      <div class="flex items-center justify-between">
        <button
          type="button"
          class="text-xs text-slate-500 underline decoration-dotted hover:text-slate-900"
          @click="clearLink"
        >
          清掉
        </button>
        <div class="flex items-center gap-2">
          <el-button size="small" :disabled="!linkDialog.draft" @click="openLinkTarget">先打开看看</el-button>
          <el-button size="small" type="primary" @click="saveLink">存下来</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 单号框右边的小链接按钮：没填是描边，填了变实心，一眼看出这张单挂没挂链接 */
.link-chip {
  margin-left: 2px;
  border: 1px solid var(--line, #eaeaea);
  border-radius: 4px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 16px;
  color: #5b6472;
  background: #fff;
  white-space: nowrap;
}
.link-chip:hover {
  border-color: #111;
  color: #111;
}
.link-chip.is-on {
  border-color: #111;
  background: #111;
  color: #fff;
}
.link-chip:focus-visible {
  outline: 2px solid #111;
  outline-offset: 1px;
}

.drawer-enter.is-entering {
  animation: purchase-dialog-enter 160ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes purchase-dialog-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .drawer-enter.is-entering {
    animation-duration: 1ms;
  }
}
</style>

<style>
/*
 * 详情不套白色底板（使用方 2026-11-12）。
 *
 * el-dialog 默认是「白卡 + 阴影 + 圆角」，压在页面彩色弥散上像一块贴纸。
 * 这里只把"卡"拆掉：容器透明、无阴影、无圆角；遮罩改成薄白（让渐变透上来，
 * 又保证字压得住彩色）。标题区留一条发丝线，其余靠留白与字号分层。
 */
.purchase-dialog.el-dialog {
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  max-height: 92vh;
  overflow-y: auto;
  padding: 4px 6px 8px;
}

.purchase-dialog .el-dialog__header {
  margin-right: 0;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(16, 24, 40, 0.08);
}

.purchase-dialog .el-dialog__body {
  padding-top: 16px;
  color: rgba(16, 24, 40, 0.82);
}

.purchase-dialog .el-dialog__headerbtn {
  display: none;
}

/* 遮罩：薄白，让彩色壁纸透上来，正文不被花纹干扰 */
.el-overlay:has(.purchase-dialog) {
  background-color: rgba(250, 251, 253, 0.92);
}
/* el-dialog 的根节点是 Element Plus 渲染的，拿不到本组件的 scope 标记，
   所以「弹窗内部」的覆盖只能写在非 scoped 样式里，否则一条都不生效。 */
.purchase-dialog .el-date-editor.el-input,
.purchase-dialog .el-date-editor .el-input__wrapper {
  width: 100%;
  min-width: 0;
}

/* 全局 style.css 把单日期框钉成 150px !important（筛选条要窄），
   表格里必须覆盖回来，否则它比列还宽、压住隔壁格子。 */
.purchase-dialog .el-date-editor.el-input.el-date-editor--date {
  width: 100% !important;
}

.purchase-dialog .el-autocomplete {
  width: 100%;
  min-width: 0;
}

.purchase-dialog .el-input__wrapper {
  min-width: 0;
}

.purchase-dialog .el-dialog__body {
  overscroll-behavior: contain;
}

/* 台账里的输入框压扁一点：一行十几个控件，默认 32px 高会把表拉成两层楼 */
.purchase-dialog .el-input--small .el-input__wrapper,
.purchase-dialog .el-select--small .el-select__wrapper {
  padding-left: 6px;
  padding-right: 6px;
}

.purchase-dialog .el-input--small .el-input__inner {
  font-size: 12px;
}
</style>
