<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useToast } from 'wot-design-uni'
import request from '../api/request'
import { hasPerm } from '../api/auth'
import { copyRowField } from '../utils/clipboard'
import { uploadFile } from '../api/upload'
import { resolveAssetUrl } from '../api/config'
import { chooseImages } from '../utils/chooseImages'

/*
 * 采购需求（手机端，2026-10-23，变更-164）
 *
 * 与 PC 的差异（都是因为屏幕小，不是功能缺失）：
 *   · 表格 → **卡片**。PC 上 8 列能一眼扫完，手机上横向滚表格没法看；
 *   · 列顺序/列显隐 → **不做**（使用方 2026-10-23 明确"手机上不需要"；
 *     卡片布局只有一种顺序，做了只是给人添麻烦）；
 *   · 点单元格复制 → **长按**（手机上"点一下"是进详情，两者抢手势）。
 *
 * 与 PC 完全一致的两条关键行为：
 *   ① 新增保存后**不关表单**：清空物料名称/编码/规格 + 数量复位 1，
 *      保留需求人/提出日期/类别/用途/要求到货日期 —— 同一批需求连着录几条物料；
 *   ② 长按行号复制三样（Tab 分隔）、长按物料名称/编码/规格复制单项，且**不弹详情**。
 */

const toast = useToast()
const canEdit = computed(() => hasPerm('purchase:edit') || hasPerm('admin'))

// ===== 列表 =====
const rows = ref([])
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loadError = ref('')
const keyword = ref('')
const statusFilter = ref('')
const pageNum = ref(1)
const PAGE_SIZE = 200

/** 与后端 PurchaseTrackingVO 的状态枚举一致（超期/临期/待提单/等货/已到货/部分到货） */
const STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: 'OVERDUE', label: '超期' },
  { value: 'DUE_SOON', label: '临期' },
  { value: 'PENDING_OA', label: '待提单' },
  { value: 'WAITING', label: '等货' },
  { value: 'ARRIVED', label: '已到货' },
  { value: 'PARTIAL', label: '部分到货' },
]

const STATUS_TEXT = {
  OVERDUE: '超期',
  DUE_SOON: '临期',
  PENDING_OA: '待提单',
  WAITING: '等货',
  ARRIVED: '已到货',
  PARTIAL: '部分到货',
}

const hasMore = computed(() => rows.value.length < total.value)

let listSeq = 0

function buildParams(page) {
  const params = { pageNum: page, pageSize: PAGE_SIZE }
  const kw = keyword.value.trim()
  if (kw) params.keyword = kw
  if (statusFilter.value) params.statuses = statusFilter.value
  return params
}

async function loadList({ append = false } = {}) {
  const seq = ++listSeq
  if (append) loadingMore.value = true
  else loading.value = true
  loadError.value = ''

  try {
    const res = await request.get('/api/purchase/list', { params: buildParams(append ? pageNum.value : 1) })
    // 打字停顿就连发几次，先发的后回会把新结果盖掉（与 PC 同一套序号护栏）
    if (seq !== listSeq) return

    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '采购需求接口返回异常。')

    const list = Array.isArray(body.dataList) ? body.dataList : []
    rows.value = append ? [...rows.value, ...list] : list
    total.value = Number(body.total) || 0
    if (!append) pageNum.value = 1
  } catch (e) {
    if (seq !== listSeq) return
    loadError.value = e?.response?.data?.msg || e?.message || '加载失败'
  } finally {
    if (seq === listSeq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function applyFilters() {
  pageNum.value = 1
  loadList()
}

function pickStatus(value) {
  statusFilter.value = value
  applyFilters()
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return
  pageNum.value += 1
  await loadList({ append: true })
}

// ===== 2026-11-18 改成「一件事一张卡」 =====
/*
 * 使用方的四个真实用途（原话）：
 *   1. 临时记录车间主任或领导口头交代的采购需求；
 *   2. 看哪些还没提单；
 *   3. 看哪些提了单还没到货，去催；
 *   4. 看哪些还没验收。
 *
 * 所以列表不再一行一卡：先把同 OA 单号的行聚成一张卡（没有单号的口头记录按
 * 「谁要的 + 提出日期」聚），再按 待提单 / 等货 / 待验收 三段排。
 * 段内顺序：口头卡置顶（按记录时间近→远），其余按单号里的日期近→远
 * —— 使用方的查看习惯是「显示单号，按单号后面的日期由近到远」。
 */
const SECTION_DEFS = [
  { key: 'pending', title: '待提单', hint: '还没 OA 单号' },
  { key: 'waiting', title: '等货', hint: '已提单，还没到货' },
  { key: 'accept', title: '待验收', hint: '货到了，等确认' },
]

/** 哪一段展开着（默认全展开：三段加起来也就十来个数字，收起反而要多点一次） */
const openSections = reactive({ pending: true, waiting: true, accept: true })

/** 「已完成」默认收起（办完的事不该占屏幕，但要能翻回去看） */
const doneOpen = ref(false)

function cardKeyOf(row) {
  const oa = String(row.oaNo || '').trim()
  if (oa) return `oa:${oa}`
  return `v:${row.requester || ''}|${row.requestDate || ''}`
}

/** 这张卡最早的要求到货日（多行时取最紧的那个） */
function earliestDue(items) {
  let best = ''
  for (const row of items) {
    const due = row.requiredArrivalDate || ''
    if (due && (!best || due < best)) best = due
  }
  return best
}

function buildCards(list) {
  const map = new Map()
  for (const row of list) {
    const key = cardKeyOf(row)
    let card = map.get(key)
    if (!card) {
      card = {
        key,
        oaNo: String(row.oaNo || '').trim(),
        requester: row.requester || '',
        requestDate: row.requestDate || '',
        sortDate: row.sortDate || row.requestDate || '',
        items: [],
        followCount: 0,
        lastFollowAt: '',
      }
      map.set(key, card)
    }
    card.items.push(row)
    // 催货按卡记（每行各写一条留痕），卡面只显示「催过几次」——
    // 取最大值而不是求和，否则三行的卡点一次催会显示「催 3 次」。
    card.followCount = Math.max(card.followCount, Number(row.followUpCount) || 0)
    if (row.lastFollowUpAt && row.lastFollowUpAt > card.lastFollowAt) {
      card.lastFollowAt = row.lastFollowUpAt
    }
    if ((row.sortDate || '') > card.sortDate) card.sortDate = row.sortDate
    if (!card.requester && row.requester) card.requester = row.requester
  }

  const cards = []
  for (const card of map.values()) {
    const allArrived = card.items.every((row) => !!row.actualArrivalDate)
    const allConfirmed = card.items.every((row) => !!row.acceptConfirmedAt)
    const missingAcceptanceNo = card.items.some((row) => !row.acceptanceNo)
    const overdue = card.items.some((row) => row.status === 'OVERDUE')

    let section = 'waiting'
    if (!card.oaNo) section = 'pending'
    else if (allConfirmed) section = 'done'
    else if (allArrived) section = 'accept'

    const first = card.items[0]
    card.section = section
    card.allArrived = allArrived
    card.allConfirmed = allConfirmed
    card.missingAcceptanceNo = missingAcceptanceNo
    card.overdue = overdue
    card.nameText = first.materialName || '（没写物料名）'
    card.extraNames = card.items.slice(1).map((row) => row.materialName).filter(Boolean)
    // 数量只报第一条的量：条目数已经由名称后面的「另 N 项」说了，这里再说一遍是重复
    card.qtyText = quantityText(first)
    card.dueDate = earliestDue(card.items)
    card.dueText = card.dueDate ? `要求 ${card.dueDate.slice(5)}` : '没定到货日'
    card.followText = card.followCount
      ? `催 ${card.followCount} 次 · ${String(card.lastFollowAt).slice(5, 10)}`
      : ''
    cards.push(card)
  }
  return cards
}

const cards = computed(() => buildCards(rows.value))

const sectionCards = computed(() => {
  const bucket = { pending: [], waiting: [], accept: [], done: [] }
  for (const card of cards.value) bucket[card.section].push(card)
  // 口头卡：记录日期近→远；有单号的：单号里的日期近→远
  bucket.pending.sort((a, b) => String(b.requestDate).localeCompare(String(a.requestDate)))
  for (const key of ['waiting', 'accept', 'done']) {
    bucket[key].sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)))
  }
  return bucket
})

/** 顶部三段数字（等货那格额外带「其中超期 N」） */
const counts = computed(() => ({
  pending: sectionCards.value.pending.length,
  waiting: sectionCards.value.waiting.length,
  waitingLate: sectionCards.value.waiting.filter((card) => card.overdue).length,
  accept: sectionCards.value.accept.length,
  done: sectionCards.value.done.length,
}))

function toggleSection(key) {
  openSections[key] = !openSections[key]
}

/**
 * 点顶部数字：只展开那一段。
 *
 * 不滚动定位 —— 手机里滚动定位要算 scroll-view 的 offsetTop，容易差半屏；
 * 收起另外两段后目标段自然就顶到眼前了。
 */
function focusSection(key) {
  const only = !openSections[key] || SECTION_DEFS.some((sec) => sec.key !== key && openSections[sec.key])
  for (const sec of SECTION_DEFS) openSections[sec.key] = only ? sec.key === key : true
}

// ----- 记一句（极简新建）-----
const quickOpen = ref(false)
const quickText = ref('')
const quickRequester = ref('')
const quickSaving = ref(false)

function openQuick() {
  quickText.value = ''
  quickRequester.value = ''
  quickOpen.value = true
}

async function saveQuick() {
  const text = quickText.value.trim()
  if (!text) {
    toast.show('先写一句话，比如「车间要 20 个密封圈」')
    return
  }
  if (quickSaving.value) return
  quickSaving.value = true
  try {
    const res = await request.post('/api/purchase/quick', {
      text,
      requester: quickRequester.value.trim(),
    })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '没记上')
    quickOpen.value = false
    await loadList()
    toast.show('记下了')
  } catch (e) {
    toast.show(e?.response?.data?.msg || e?.message || '没记上')
  } finally {
    quickSaving.value = false
  }
}

// ----- 详情抽屉：物料全列 + 催痕全部 + 三个动作 -----
const detailCard = ref(null)
const detailFollowUps = ref([])
const detailBusy = ref(false)
const acceptNo = ref('')

async function openDetail(card) {
  detailCard.value = card
  detailFollowUps.value = []
  acceptNo.value = card.items.find((row) => row.acceptanceNo)?.acceptanceNo || ''
  await loadFollowUps()
}

function closeDetail() {
  detailCard.value = null
  detailFollowUps.value = []
}

async function loadFollowUps() {
  const card = detailCard.value
  if (!card) return
  const id = card.items[0]?.id
  if (!id) return
  try {
    const res = await request.get('/api/purchase/follow-ups', { params: { id } })
    const body = res.data || {}
    detailFollowUps.value = Array.isArray(body.data) ? body.data : []
  } catch (e) {
    detailFollowUps.value = []
  }
}

/** 催一下：给这张卡的每行各记一条留痕（卡可能是多行），再刷新列表与详情 */
async function doFollowUp() {
  const card = detailCard.value
  if (!card || detailBusy.value) return
  detailBusy.value = true
  try {
    for (const row of card.items) {
      await request.post('/api/purchase/follow-up', undefined, { params: { id: row.id } })
    }
    toast.show('记下这次催货了')
    await loadList()
    const fresh = cards.value.find((item) => item.key === card.key)
    detailCard.value = fresh || null
    await loadFollowUps()
  } catch (e) {
    toast.show(e?.response?.data?.msg || e?.message || '没记上')
  } finally {
    detailBusy.value = false
  }
}

async function doAccept() {
  const card = detailCard.value
  if (!card || detailBusy.value) return
  const no = acceptNo.value.trim()
  if (!no && card.missingAcceptanceNo) {
    toast.show('先填验收单号，再点确认')
    return
  }
  detailBusy.value = true
  try {
    for (const row of card.items) {
      await request.post('/api/purchase/accept', undefined, {
        params: { id: row.id, acceptanceNo: row.acceptanceNo || no },
      })
    }
    toast.show('验收确认好了')
    await loadList()
    const fresh = cards.value.find((item) => item.key === card.key)
    detailCard.value = fresh || null
  } catch (e) {
    toast.show(e?.response?.data?.msg || e?.message || '没确认上')
  } finally {
    detailBusy.value = false
  }
}

async function doVoid() {
  const card = detailCard.value
  if (!card || detailBusy.value) return
  const res = await new Promise((resolve) => {
    uni.showModal({
      title: '作废这张卡？',
      content: '记错了或者重复的才作废。作废后不在列表显示，库里留着。',
      confirmText: '作废',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    })
  })
  if (!res) return
  detailBusy.value = true
  try {
    for (const row of card.items) {
      await request.post('/api/purchase/void', undefined, { params: { id: row.id } })
    }
    closeDetail()
    await loadList()
    toast.show('作废了')
  } catch (e) {
    toast.show(e?.response?.data?.msg || e?.message || '没作废成')
  } finally {
    detailBusy.value = false
  }
}

/** 详情里的「编辑」：交给原有的整行表单（规格、编码、编码这些长字段在那边补） */
function editFromDetail() {
  const card = detailCard.value
  if (!card) return
  const row = card.items[0]
  closeDetail()
  openEdit(row)
}

onMounted(() => {
  loadList()
})

// ===== 长按复制（不弹详情）=====
/**
 * 长按复制与"点一下看详情"共存的办法。
 *
 * 原来名称 / 编码 / 规格都写了 `@click.stop`，只为了长按复制时别把弹窗点开 ——
 * 结果是卡片上最大的一块地方（物料名称那一行）点上去毫无反应，使用方报
 * 「点击卡片不能展开信息」就是这个。现在改成：
 *   · 这些格子只拦长按（@longpress.stop），点击照常冒泡到卡片；
 *   · 长按复制成功时记一个时间戳，紧接着冒上来的那次 click 直接忽略，
 *     免得「刚复制完，弹窗自己开了」。
 */
let lastCopyAt = 0
async function onLongPress(row, key) {
  lastCopyAt = Date.now()
  await copyRowField(row, key)
}

// ===== 表单 =====
const formOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const isCreate = ref(true)
const savedCount = ref(0)
const lastSavedText = ref('')

/*
 * 送货单图片（变更-207，使用方 2026-11-12：「我记得有保存送货单的功能的，这里我没找到」）
 *
 * 与 PC 同一条口径（变更-094）：`delivery_note` 存的是 `/files/<fileName>` 这种相对路径，
 * 不是裸文件名、也不是图片 URL。列本来就是 varchar(64)，装得下，不用改表。
 *
 * ⚠️ 保存时必须把这个值原样带上：后端 save 走的是
 * `row.setDeliveryNote(blankIfNull(dto.getDeliveryNote()))`，
 * 也就是「没传 = 空串 = 把已有图片抹掉」。第一次接这块时最容易漏的就是这里。
 */
const deliverySheetOpen = ref(false)
const deliveryUploading = ref(false)
const deliveryImage = computed(() => (form.deliveryNote ? resolveAssetUrl(form.deliveryNote) : ''))

function blankDraft() {
  return {
    id: null,
    requester: '',
    requestDate: '',
    materialName: '',
    materialCode: '',
    spec: '',
    purpose: '',
    category: '',
    quantity: 1,
    unit: '',
    requiredArrivalDate: '',
    actualArrivalQuantity: '',
    actualArrivalDate: '',
    oaNo: '',
    deliveryNote: '',
    remark: '',
  }
}

const form = reactive(blankDraft())

function resetForm(draft = null) {
  const next = { ...blankDraft(), ...(draft || {}) }
  Object.keys(form).forEach((key) => {
    form[key] = next[key] ?? ''
  })
  form.quantity = next.quantity ?? 1
  form.id = next.id ?? null
}

function openCreate() {
  isCreate.value = true
  formError.value = ''
  savedCount.value = 0
  lastSavedText.value = ''
  resetForm()
  formOpen.value = true
}

function openEdit(row) {
  // 刚长按复制过就别开弹窗（长按之后浏览器还会补一次 click）
  if (Date.now() - lastCopyAt < 600) return
  isCreate.value = false
  formError.value = ''
  savedCount.value = 0
  lastSavedText.value = ''
  resetForm(row)
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

// ===== 送货单图片 =====

function openDeliverySheet() {
  if (deliveryUploading.value) return
  deliverySheetOpen.value = true
}

/**
 * 选一张图并上传。
 *
 * 相册一定要走 chooseImages（手机自带相册），不能用 uni.chooseImage 的 album 分支 ——
 * 那个分支是框架自绘的绿色选图页，与 App 完全不搭（2026-11-12 使用方明确要求换掉）。
 * 拍照仍交给 uni.chooseImage，它调的就是系统相机。
 */
async function pickDeliverySource(source) {
  deliverySheetOpen.value = false
  const options = {
    count: 1,
    sizeType: ['compressed'],
    sourceType: [source],
    success: (res) => {
      const path = (res.tempFilePaths || [])[0]
      if (path) uploadDeliveryPhoto(path)
    },
    fail: () => {},
  }
  if (source === 'album') chooseImages(options)
  else uni.chooseImage(options)
}

async function uploadDeliveryPhoto(filePath) {
  if (deliveryUploading.value) return
  deliveryUploading.value = true
  try {
    const res = await uploadFile({
      url: '/api/purchase/upload-delivery-note',
      filePath,
      name: 'file',
    })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '上传失败')
    const fileName = body.data
    if (!fileName) throw new Error('上传未返回文件名')

    // ADR-0004：前端固定拼 `/files/<fileName>`，缩略图由显示端换 /thumbs/
    form.deliveryNote = `/files/${fileName}`
    toast.success('送货单已上传')
  } catch (error) {
    toast.error(error?.message || '送货单上传失败')
  } finally {
    deliveryUploading.value = false
  }
}

function clearDeliveryNote() {
  form.deliveryNote = ''
}

function previewDeliveryNote() {
  if (!deliveryImage.value) return
  uni.previewImage({ urls: [deliveryImage.value], current: deliveryImage.value })
}

/** 与 PC 的 buildPurchasePayload 同口径：空串发 null，非数字不发 NaN */
function buildPayload() {
  const text = (v) => {
    const s = String(v ?? '').trim()
    return s === '' ? null : s
  }
  const decimal = (v) => {
    const s = String(v ?? '').trim()
    if (s === '') return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  return {
    id: form.id ?? null,
    requester: String(form.requester ?? '').trim(),
    requestDate: text(form.requestDate),
    materialName: String(form.materialName ?? '').trim(),
    materialCode: text(form.materialCode),
    spec: text(form.spec),
    purpose: text(form.purpose),
    category: text(form.category),
    quantity: decimal(form.quantity),
    unit: text(form.unit),
    requiredArrivalDate: text(form.requiredArrivalDate),
    actualArrivalQuantity: decimal(form.actualArrivalQuantity),
    actualArrivalDate: text(form.actualArrivalDate),
    oaNo: text(form.oaNo),
    deliveryNote: text(form.deliveryNote),
    remark: text(form.remark),
  }
}

async function save() {
  if (saving.value) return
  const payload = buildPayload()

  // 必填口径与后端一致：界面先拦一次，少一趟往返
  if (!payload.requester) {
    formError.value = '需求人不能为空'
    return
  }
  if (!payload.materialName) {
    formError.value = '物料名称不能为空'
    return
  }

  saving.value = true
  formError.value = ''
  try {
    const res = await request.post('/api/purchase/save', payload)
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '保存失败')

    if (isCreate.value) {
      /*
       * 连续录入（与 PC 一致）：不关表单，只清"由物料派生"的三样 + 数量复位 1。
       * 需求人/日期/类别/用途留着 —— 同一批需求连着录时这些是共用的。
       */
      savedCount.value += 1
      lastSavedText.value = `第 ${savedCount.value} 条已保存（${payload.materialName}）`
      form.materialName = ''
      form.materialCode = ''
      form.spec = ''
      form.quantity = 1
      toast.success('已保存，接着录下一条')
      loadList()
    } else {
      toast.success('已保存')
      formOpen.value = false
      loadList()
    }
  } catch (e) {
    // 失败不关表单、不清内容：已填的要留着
    formError.value = e?.response?.data?.msg || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeRow() {
  if (!form.id) return
  const ok = await new Promise((resolve) => {
    uni.showModal({
      title: '删除确认',
      content: `删除「${form.materialName}」这条采购需求？`,
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!ok) return

  try {
    const res = await request.delete('/api/purchase/delete', { params: { id: form.id } })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '删除失败')
    toast.success('已删除')
    formOpen.value = false
    loadList()
  } catch (e) {
    formError.value = e?.response?.data?.msg || e?.message || '删除失败'
  }
}

// ===== 展示辅助 =====
function statusTone(row) {
  if (row.status === 'OVERDUE') return 'is-danger'
  if (row.status === 'DUE_SOON') return 'is-warn'
  if (row.status === 'ARRIVED') return 'is-ok'
  return ''
}

function dayHint(row) {
  if (row.status === 'OVERDUE' && row.overdueDays) return `已超 ${row.overdueDays} 天`
  if (row.status === 'DUE_SOON') {
    const d = row.daysToDue
    if (d === null || d === undefined) return ''
    return d === 0 ? '今天到期' : `还剩 ${d} 天`
  }
  return ''
}

function quantityText(row) {
  const qty = row.quantity ?? ''
  const unit = row.unit ? ` ${row.unit}` : ''
  return qty === '' || qty === null ? '—' : `${qty}${unit}`
}

/*
 * 面板给"确定高度"，不是只有 max-height。
 *
 * 只有 max-height 时，里层 `flex:1` 的滚动区拿不到可用高度，会按内容撑开 ——
 * 于是整块面板比屏幕还高：表单滑不下去、底部按钮停在半空、还会压在最下面几行字上
 * （使用方 2026-11-12 截图报的就是这个）。定成 86vh 之后：
 *   头部 + 胶条 + 提示条（固定）→ 中间 scroll-view（吃掉剩余高度、内部滚动）→ 底部按钮栏（固定）
 */
const popupStyle =
  'height: 86vh; max-height: 86vh; width: 100%; display: flex; flex-direction: column; background-color: var(--ui-sheet-fill); overscroll-behavior: contain; overflow: hidden;'

/*
 * 「记一句」只有两行字，不该占满 86vh —— 高度交给内容，
 * 否则手机上一打开就是半屏空白，像加载失败。
 * 底色用实白（--ui-surface）而不是 sheet 玻璃膜：这几个弹层里没有图层可透，
 * 半透明白压在遮罩上会发灰，字也跟着糊。
 */
const quickStyle =
  'width: 100%; display: flex; flex-direction: column; background-color: var(--ui-surface); border-radius: 28rpx 28rpx 0 0; overflow: hidden;'

/* 详情比表单矮一点：一条需求撑不满 86vh，太高下半屏是空的，像没加载出来 */
const detailStyle =
  'height: 72vh; max-height: 72vh; width: 100%; display: flex; flex-direction: column; background-color: var(--ui-surface); border-radius: 28rpx 28rpx 0 0; overflow: hidden;'
</script>

<template>
  <view class="pd">
    <view class="pd__bar">
      <input
        v-model="keyword"
        class="pd__search"
        placeholder="物料名称 / 编码 / 需求人"
        placeholder-style="color: var(--ui-text-3)"
        confirm-type="search"
        @confirm="applyFilters"
      />
      <view v-if="canEdit" class="pd__add" @click="openQuick">
        <text>＋ 记一句</text>
      </view>
    </view>

    <!-- 三段数字：点一下只展开那一段（再点一下全展开） -->
    <view class="pd__hero">
      <view
        v-for="stat in [
          { key: 'pending', n: counts.pending, label: '待提单' },
          { key: 'waiting', n: counts.waiting, label: '等货', sub: counts.waitingLate ? `超期 ${counts.waitingLate}` : '' },
          { key: 'accept', n: counts.accept, label: '待验收' },
        ]"
        :key="stat.key"
        class="pd__stat"
        :class="{ 'is-zero': !stat.n }"
        @click="focusSection(stat.key)"
      >
        <text class="pd__stat-n">{{ stat.n }}</text>
        <view class="pd__stat-text">
          <text class="pd__stat-l">{{ stat.label }}</text>
          <text v-if="stat.sub" class="pd__stat-sub">{{ stat.sub }}</text>
        </view>
      </view>
    </view>

    <view v-if="loadError" class="pd__error" @click="loadList()">
      <text>{{ loadError }}（点一下重试）</text>
    </view>

    <view class="pd__list">
      <view v-for="sec in SECTION_DEFS" :key="sec.key" class="pd__sect">
        <view class="pd__sect-head" @click="toggleSection(sec.key)">
          <text class="pd__sect-title">{{ sec.title }}</text>
          <text class="pd__sect-count">{{ sectionCards[sec.key].length }}</text>
          <text class="pd__sect-hint">{{ sec.hint }}</text>
          <text class="pd__sect-arrow" :class="{ 'is-open': openSections[sec.key] }">›</text>
        </view>

        <view v-if="openSections[sec.key]" class="pd__sect-body">
          <view v-if="!sectionCards[sec.key].length" class="pd__sect-empty">
            <text>这一段是空的</text>
          </view>
          <view
            v-for="card in sectionCards[sec.key]"
            :key="card.key"
            class="pd__card"
            @click="openDetail(card)"
          >
            <view class="pd__card-head">
              <text v-if="card.oaNo" class="pd__no-text">{{ card.oaNo }}</text>
              <text v-else class="pd__oral">口头</text>
              <view
                class="pd__status"
                :class="card.overdue ? 'is-late' : card.section === 'accept' ? 'is-accept' : 'is-wait'"
              >
                <text>{{ card.section === 'pending' ? '待提单' : card.section === 'accept' ? '待验收' : '等货' }}</text>
              </view>
              <text v-if="card.overdue" class="pd__days">超期</text>
              <text class="pd__requester">{{ card.requester || '—' }}</text>
            </view>

            <view class="pd__name">
              <text>{{ card.nameText }}</text>
              <text v-if="card.extraNames.length" class="pd__extra">另 {{ card.extraNames.length }} 项</text>
            </view>

            <view class="pd__foot">
              <text class="pd__qty">{{ card.qtyText }}</text>
              <text class="pd__date" :class="{ 'is-late': card.overdue }">{{ card.dueText }}</text>
            </view>

            <view v-if="card.followText || (card.section === 'accept' && card.missingAcceptanceNo)" class="pd__tags">
              <text v-if="card.followText" class="pd__tag">{{ card.followText }}</text>
              <text v-if="card.section === 'accept' && card.missingAcceptanceNo" class="pd__tag is-warn">缺验收单</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 已完成的收在最后：办完的事不该占屏幕，但要能翻回去查 -->
      <view v-if="counts.done" class="pd__sect pd__sect--done">
        <view class="pd__sect-head" @click="doneOpen = !doneOpen">
          <text class="pd__sect-title">已完成</text>
          <text class="pd__sect-count">{{ counts.done }}</text>
          <text class="pd__sect-hint">验收确认过的</text>
          <text class="pd__sect-arrow" :class="{ 'is-open': doneOpen }">›</text>
        </view>
        <view v-if="doneOpen" class="pd__sect-body">
          <view v-for="card in sectionCards.done" :key="card.key" class="pd__card is-done" @click="openDetail(card)">
            <view class="pd__card-head">
              <text v-if="card.oaNo" class="pd__no-text">{{ card.oaNo }}</text>
              <text v-else class="pd__oral">口头</text>
              <view class="pd__status is-done"><text>已验收</text></view>
              <text class="pd__requester">{{ card.requester || '—' }}</text>
            </view>
            <view class="pd__name"><text>{{ card.nameText }}</text></view>
            <view class="pd__foot">
              <text class="pd__qty">{{ card.qtyText }}</text>
              <text class="pd__date">{{ card.dueText }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="!rows.length && !loading" class="pd__empty">
        <text>{{ loadError ? '加载失败（点上面错误条重试）' : '还没有采购需求 —— 点右上「记一句」就能记一条' }}</text>
      </view>
      <view v-if="rows.length && !cards.length" class="pd__empty">
        <text>筛选后没有结果</text>
      </view>

      <view class="pd__hint">
        <text>点卡片进详情：催一下 / 填验收单 / 确认验收 / 作废</text>
      </view>
    </view>

    <!-- 记一句：口头交代先落地，编码数量以后再补 -->
    <wd-popup
      v-model="quickOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      :duration="260"
      :custom-style="quickStyle"
      @close="quickOpen = false"
    >
      <view class="qd">
        <view class="qd__grabber"></view>
        <view class="qd__head">
          <text class="qd__title">记一句</text>
          <text class="qd__close" @click="quickOpen = false">关闭</text>
        </view>
        <textarea
          v-model="quickText"
          class="qd__text"
          auto-height
          maxlength="120"
          placeholder="车间要 20 个密封圈"
          placeholder-style="color: var(--ui-text-3)"
        />
        <view class="qd__who">
          <text class="qd__who-label">谁要的</text>
          <input
            v-model="quickRequester"
            class="qd__who-input"
            placeholder="不填就是我自己"
            placeholder-style="color: var(--ui-text-3)"
          />
        </view>
        <view class="qd__foot">
          <view class="qd__btn qd__btn--ghost" @click="quickOpen = false"><text>取消</text></view>
          <view class="qd__btn qd__btn--primary" :class="{ 'is-busy': quickSaving }" @click="saveQuick">
            <text>{{ quickSaving ? '保存中…' : '记下' }}</text>
          </view>
        </view>
      </view>
    </wd-popup>

    <!-- 详情：一张卡 = 一件事，物料全列 + 催痕 + 验收 -->
    <wd-popup
      :model-value="!!detailCard"
      position="bottom"
      round
      safe-area-inset-bottom
      :duration="260"
      :custom-style="detailStyle"
      @close="closeDetail"
    >
      <view v-if="detailCard" class="dd">
        <view class="dd__grabber"></view>
        <view class="dd__head">
          <view class="dd__title-wrap">
            <text class="dd__title">{{ detailCard.oaNo || '口头 · 待提单' }}</text>
            <text class="dd__sub">
              {{ detailCard.requester || '—' }} · {{ detailCard.requestDate || '—' }} · 共 {{ detailCard.items.length }} 项
            </text>
          </view>
          <text class="dd__close" @click="closeDetail">关闭</text>
        </view>

        <scroll-view class="dd__body" scroll-y>
          <view class="dd__items">
            <view v-for="row in detailCard.items" :key="row.id" class="dd__item">
              <view class="dd__item-top">
                <text class="dd__item-name">{{ row.materialName || '—' }}</text>
                <text class="dd__item-qty">{{ quantityText(row) }}</text>
              </view>
              <view class="dd__item-meta">
                <text class="dd__item-code">{{ row.materialCode || '无编码' }}</text>
                <text class="dd__item-spec">{{ row.spec || '无规格' }}</text>
              </view>
              <view class="dd__item-foot">
                <text class="dd__item-date">要求到货 {{ row.requiredArrivalDate || '—' }}</text>
                <text class="dd__item-status">{{ STATUS_TEXT[row.status] || '等货' }}</text>
              </view>
            </view>
          </view>

          <view class="dd__block">
            <text class="dd__block-title">催货记录</text>
            <view v-if="!detailFollowUps.length" class="dd__empty"><text>还没催过</text></view>
            <view v-for="(item, index) in detailFollowUps" :key="index" class="dd__follow">
              <text class="dd__follow-at">{{ item.pushedAt }}</text>
              <text class="dd__follow-by">{{ item.pushedBy || '—' }}</text>
            </view>
          </view>

          <view class="dd__block">
            <text class="dd__block-title">验收</text>
            <input
              v-model="acceptNo"
              class="dd__accept"
              placeholder="验收单号（先关联单据，再点确认）"
              placeholder-style="color: var(--ui-text-3)"
            />
          </view>
        </scroll-view>

        <view class="dd__acts">
          <view class="dd__act" :class="{ 'is-busy': detailBusy }" @click="doFollowUp"><text>催一下</text></view>
          <view class="dd__act" :class="{ 'is-busy': detailBusy }" @click="doAccept"><text>确认验收</text></view>
          <view class="dd__act" @click="editFromDetail"><text>编辑</text></view>
          <view class="dd__act is-danger" :class="{ 'is-busy': detailBusy }" @click="doVoid"><text>作废</text></view>
        </view>
      </view>
    </wd-popup>

    <wd-popup
      v-model="formOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      :duration="280"
      :custom-style="popupStyle"
      @close="closeForm"
    >
      <view class="pf">
        <view class="pf__grabber"></view>
        <view class="pf__head">
          <text class="pf__title">{{ isCreate ? '新增采购需求' : '采购需求详情' }}</text>
          <text class="pf__close" @click="closeForm">关闭</text>
        </view>

        <view v-if="lastSavedText" class="pf__saved">
          <text>{{ lastSavedText }}</text>
        </view>
        <view v-if="formError" class="pf__error">
          <text>{{ formError }}</text>
        </view>

        <scroll-view class="pf__body" scroll-y>
          <view class="pf__group">
            <text class="pf__group-title">基本信息</text>
            <view class="pf__row">
              <text class="pf__label">需求人 *</text>
              <input v-model="form.requester" class="pf__input" placeholder="谁提的" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">提出日期</text>
              <input v-model="form.requestDate" class="pf__input" placeholder="2026-10-23" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">物料名称 *</text>
              <input v-model="form.materialName" class="pf__input" placeholder="打字搜物料名称" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">物料编码</text>
              <input v-model="form.materialCode" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">规格型号</text>
              <input v-model="form.spec" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">类别</text>
              <input v-model="form.category" class="pf__input" placeholder="五金 / 电气…" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">用途</text>
              <input v-model="form.purpose" class="pf__input" placeholder="哪条线 / 哪个车间用" placeholder-style="color: var(--ui-text-3)" />
            </view>
          </view>

          <view class="pf__group">
            <text class="pf__group-title">数量与到货</text>
            <view class="pf__row">
              <text class="pf__label">数量</text>
              <view class="pf__qty">
                <input v-model="form.quantity" class="pf__input pf__input--num" type="digit" placeholder="1" placeholder-style="color: var(--ui-text-3)" />
                <input v-model="form.unit" class="pf__input pf__input--unit" placeholder="单位" placeholder-style="color: var(--ui-text-3)" />
              </view>
            </view>
            <view class="pf__row">
              <text class="pf__label">要求到货</text>
              <input v-model="form.requiredArrivalDate" class="pf__input" placeholder="2026-10-30" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">实到数量</text>
              <input v-model="form.actualArrivalQuantity" class="pf__input" type="digit" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">实到日期</text>
              <input v-model="form.actualArrivalDate" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
          </view>

          <view class="pf__group">
            <text class="pf__group-title">单据与备注</text>
            <view class="pf__row">
              <text class="pf__label">OA 单号</text>
              <input v-model="form.oaNo" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">备注</text>
              <input v-model="form.remark" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>

            <!-- 送货单：一张图。有图显示缩略图 + 更换/删除，没图显示一颗上传按钮 -->
            <view class="pf__row pf__row--file">
              <text class="pf__label">送货单</text>
              <view class="pf__file">
                <template v-if="deliveryImage">
                  <image class="pf__file-thumb" :src="deliveryImage" mode="aspectFill" @click="previewDeliveryNote" />
                  <view class="pf__file-acts">
                    <text class="pf__file-act" @click="openDeliverySheet">更换</text>
                    <text class="pf__file-act pf__file-act--danger" @click="clearDeliveryNote">删除</text>
                  </view>
                </template>
                <view v-else class="pf__file-add" :class="{ 'is-busy': deliveryUploading }" @click="openDeliverySheet">
                  <text>{{ deliveryUploading ? '上传中…' : '＋ 上传送货单' }}</text>
                </view>
              </view>
            </view>
          </view>
        </scroll-view>

        <view class="pf__foot">
          <view v-if="!isCreate && canEdit" class="pf__del" @click="removeRow">
            <text>删除</text>
          </view>
          <view class="pf__btn pf__btn--ghost" @click="closeForm">
            <text>{{ isCreate ? '先不填' : '取消' }}</text>
          </view>
          <view class="pf__btn pf__btn--primary" :class="{ 'is-busy': saving }" @click="save">
            <text>{{ saving ? '保存中…' : isCreate ? '保存并继续' : '保存' }}</text>
          </view>
        </view>
      </view>
    </wd-popup>

    <!-- 送货单来源：与「图片解析」「拍表存证」同一套底部弹层，选完再进系统相机/相册 -->
    <wd-popup
      v-model="deliverySheetOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      custom-style="background-color: var(--ui-sheet-fill);"
    >
      <view class="pf-sheet">
        <text class="pf-sheet__title">上传送货单</text>
        <view class="pf-sheet__item" @click="pickDeliverySource('camera')">
          <view class="pf-sheet__icon">
            <wd-icon name="camera" size="20px" />
          </view>
          <text class="pf-sheet__text">拍摄</text>
        </view>
        <view class="pf-sheet__item" @click="pickDeliverySource('album')">
          <view class="pf-sheet__icon">
            <wd-icon name="picture" size="20px" />
          </view>
          <text class="pf-sheet__text">从相册选择</text>
        </view>
        <view class="pf-sheet__cancel" @click="deliverySheetOpen = false">
          <text>取消</text>
        </view>
      </view>
    </wd-popup>
  </view>
</template>

<style lang="scss" scoped>
/* 面板是「确定高度的三段式」：头部固定 / 中间 scroll-view 自己滚 / 底部按钮栏固定。
   2026-11-12 使用方报「滑到底按钮和页面分离」，根因是原来只写 max-height，
   flex 子项按内容撑开，滚动区拿不到高度。现在高度写死 86vh，滚动区 height:0 + flex:1。 */
.pd {
  padding: 16rpx 20rpx 40rpx;
  box-sizing: border-box;
}

.pd__bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}

.pd__search {
  flex: 1;
  height: 72rpx;
  padding: 0 22rpx;
  border-radius: 36rpx;
  font-size: 26rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
}

.pd__add {
  flex-shrink: 0;
  height: 72rpx;
  padding: 0 26rpx;
  border-radius: 36rpx;
  display: flex;
  align-items: center;
  font-size: 26rpx;
  font-weight: 600;
  color: #fff;
  background-color: var(--ui-brand, #b4551f);
}

.pd__chips {
  white-space: nowrap;
  margin: 16rpx 0 8rpx;
  height: 56rpx;
}

.pd__chip {
  display: inline-flex;
  align-items: center;
  height: 56rpx;
  padding: 0 22rpx;
  margin-right: 12rpx;
  border-radius: 28rpx;
  font-size: 24rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);

  &.is-on {
    color: #fff;
    background-color: var(--ui-brand, #b4551f);
    border-color: transparent;
  }
}

.pd__error {
  flex-shrink: 0;
  margin: 8rpx 0;
  padding: 14rpx 20rpx;
  border-radius: 16rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.pd__list {
  padding-bottom: 24rpx;
}

.pd__card {
  margin-bottom: 16rpx;
  padding: 20rpx 22rpx;
  border-radius: 20rpx;
  background-color: var(--ui-surface);
  border: 2rpx solid var(--ui-border);
}

.pd__card-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.pd__no {
  min-width: 52rpx;
  height: 40rpx;
  padding: 0 10rpx;
  border-radius: 10rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
}

.pd__status {
  height: 40rpx;
  padding: 0 16rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  font-size: 22rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);

  &.is-danger {
    color: #f56c6c;
    background-color: rgba(245, 108, 108, 0.16);
  }

  &.is-warn {
    color: #e6a23c;
    background-color: rgba(230, 162, 60, 0.16);
  }

  &.is-ok {
    color: #3f9d6b;
    background-color: rgba(63, 157, 107, 0.16);
  }
}

.pd__days {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__requester {
  margin-left: auto;
  font-size: 22rpx;
  color: var(--ui-text-2);
}

.pd__name {
  margin-top: 12rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ui-text);
  word-break: break-all;
}

.pd__meta {
  display: flex;
  gap: 20rpx;
  margin-top: 10rpx;
}

.pd__meta-item {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
  min-width: 0;

  &--grow {
    flex: 1;
    min-width: 0;
  }
}

.pd__label {
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__code {
  font-size: 24rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-2);
}

.pd__spec {
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  color: var(--ui-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pd__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
  padding-top: 12rpx;
  border-top: 2rpx solid var(--ui-hairline);
}

.pd__qty {
  font-size: 26rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.pd__date {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__empty,
.pd__more {
  padding: 40rpx 0;
  text-align: center;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.pd__hint {
  padding: 24rpx 8rpx 40rpx;
  text-align: center;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

/* ===== 表单 ===== */
.pf {
  display: flex;
  flex-direction: column;
  /* 高度由 popupStyle 的 86vh 给定；这里只负责"填满并裁掉溢出" */
  height: 100%;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.pf__grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 12rpx auto 0;
  border-radius: 4rpx;
  background-color: var(--ui-border-strong);
}

.pf__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 28rpx 12rpx;
}

.pf__title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.pf__close {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.pf__saved {
  margin: 0 28rpx 8rpx;
  padding: 12rpx 18rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #3f9d6b;
  background-color: rgba(63, 157, 107, 0.12);
}

.pf__error {
  margin: 0 28rpx 8rpx;
  padding: 12rpx 18rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

/*
 * 滚动区：`height:0` + `flex:1` 是让 scroll-view 真正拿到高度的那一手。
 *
 * uni 的 scroll-view 必须有确定高度才会内部滚动（这是老坑，抄表页也踩过）；
 * 只写 `flex:1` 时它在 H5 上常常按内容高度算，滚不动。
 */
.pf__body {
  flex: 1 1 auto;
  height: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 0 28rpx;
}

.pf__group {
  margin-bottom: 20rpx;
}

.pf__group-title {
  display: block;
  margin: 8rpx 0 12rpx;
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: var(--ui-text-3);
}

.pf__row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 10rpx 0;
  /* 行内子项一律不许撑破行宽 */
  min-width: 0;
}

.pf__label {
  flex-shrink: 0;
  width: 148rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

/*
 * 输入框必须 `box-sizing: border-box` + `width: auto`。
 * uni 的 `input` 自带 `width:100%`，再用 content-box 加上左右 20rpx 内边距，
 * 每个格子就比容器宽 40rpx —— 一行行叠起来直接从屏幕右侧探出去（使用方截图）。
 */
.pf__input {
  flex: 1 1 auto;
  width: auto;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: 76rpx;
  padding: 0 20rpx;
  border-radius: 16rpx;
  font-size: 26rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);

  &--num {
    flex: 0 0 168rpx;
    width: 168rpx;
  }

  &--unit {
    flex: 1 1 auto;
    width: auto;
  }
}

.pf__qty {
  flex: 1 1 auto;
  display: flex;
  gap: 12rpx;
  min-width: 0;
}

/* 送货单那行：标签顶对齐，右侧是缩略图或上传按钮 */
.pf__row--file {
  align-items: flex-start;
}

.pf__row--file .pf__label {
  padding-top: 18rpx;
}

.pf__file {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 18rpx;
  min-width: 0;
}

.pf__file-thumb {
  flex-shrink: 0;
  width: 120rpx;
  height: 120rpx;
  border-radius: 14rpx;
  border: 2rpx solid var(--ui-border);
  background-color: var(--ui-surface-2);
}

.pf__file-acts {
  display: flex;
  align-items: center;
  gap: 24rpx;
}

.pf__file-act {
  font-size: 26rpx;
  color: var(--ui-accent);
}

.pf__file-act--danger {
  color: var(--ui-danger, #b4463c);
}

.pf__file-add {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  border-radius: 16rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-surface-2);
  border: 2rpx dashed var(--ui-border-strong);

  &.is-busy {
    opacity: 0.6;
  }
}

/* 送货单来源弹层：视觉与「图片解析」「拍表存证」一致 */
.pf-sheet {
  padding: 20rpx 28rpx 24rpx;
}

.pf-sheet__title {
  display: block;
  padding: 4rpx 4rpx 16rpx;
  font-size: 26rpx;
  color: var(--ui-text-3);
}

.pf-sheet__item {
  display: flex;
  align-items: center;
  gap: 22rpx;
  height: 108rpx;
  margin-bottom: 16rpx;
  padding: 0 26rpx;
  border-radius: 24rpx;
  background-color: var(--ui-surface-2);
}

.pf-sheet__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: 18rpx;
  color: var(--ui-accent);
  background-color: var(--ui-accent-soft);
}

.pf-sheet__text {
  font-size: 30rpx;
  color: var(--ui-text);
}

.pf-sheet__cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96rpx;
  margin-top: 8rpx;
  border-radius: 48rpx;
  font-size: 30rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise-2);
}

/* 底部按钮栏：不参与滚动，实心底色（不能透出下面的表单） */
.pf__foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 28rpx calc(18rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid var(--ui-hairline);
  background-color: var(--ui-surface);
  box-shadow: 0 -8rpx 24rpx rgba(20, 22, 28, 0.06);
}

.pf__del {
  flex-shrink: 0;
  height: 80rpx;
  padding: 0 26rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  font-size: 26rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.pf__btn {
  height: 80rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 600;

  /* 「先不填」是次要操作，但不是"透明的"：给实心底 + 描边，跟主按钮一眼分得开 */
  &--ghost {
    flex: 0 0 180rpx;
    color: var(--ui-text);
    background-color: var(--ui-surface-2);
    border: 2rpx solid var(--ui-border);
  }

  &--primary {
    flex: 1 1 auto;
    min-width: 0;
    color: #fff;
    background-color: var(--ui-brand, #b4551f);

    &.is-busy {
      opacity: 0.6;
    }
  }
}
/* ===== 采购需求：一件事一张卡（2026-11-18 改） ===== */

/* 三段数字：待提单 / 等货 / 待验收 */
.pd__hero {
  display: flex;
  gap: 12rpx;
  margin-bottom: 8rpx;
}

/*
 * 一格一个数：数字大、标签小 —— 一眼看的是「有几件」，
 * 具体是哪几件事在下面按段列着，不靠这一格说清。
 */
.pd__stat {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  padding: 18rpx 16rpx;
  border-radius: 18rpx;
  background-color: var(--ui-raise-2);
}

.pd__stat.is-zero {
  opacity: 0.55;
}

.pd__stat-n {
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.1;
  color: var(--ui-text);
}

.pd__stat-text {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}

.pd__stat-l {
  font-size: 22rpx;
  color: var(--ui-text-2);
}

.pd__stat-sub {
  font-size: 20rpx;
  color: var(--ui-amber-800);
}

/* 分段标题：轻一点，别和三段数字抢 */
.pd__sect {
  margin-top: 18rpx;
}

.pd__sect-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 6rpx 4rpx 12rpx;
}

.pd__sect-title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.pd__sect-count {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__sect-hint {
  flex: 1 1 auto;
  font-size: 21rpx;
  text-align: right;
  color: var(--ui-text-3);
}

.pd__sect-arrow {
  font-size: 30rpx;
  line-height: 1;
  color: var(--ui-text-3);
  transform: rotate(0deg);
  transition: transform 0.18s ease;
}

.pd__sect-arrow.is-open {
  transform: rotate(90deg);
}

.pd__sect-body {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.pd__sect-empty {
  padding: 18rpx 4rpx;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__sect--done {
  opacity: 0.9;
}

/* 卡片里新加的五样 */
.pd__no-text {
  font-size: 24rpx;
  color: var(--ui-text-2);
  letter-spacing: 0.4rpx;
}

.pd__oral {
  padding: 2rpx 12rpx;
  border: 2rpx dashed var(--ui-border-strong);
  border-radius: 999rpx;
  font-size: 21rpx;
  color: var(--ui-text-2);
}

.pd__extra {
  margin-left: 10rpx;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 12rpx;
}

.pd__tag {
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background-color: var(--ui-raise-2);
  font-size: 21rpx;
  color: var(--ui-text-2);
}

.pd__tag.is-warn {
  border: 2rpx solid var(--ui-amber-200);
  color: var(--ui-amber-800);
}

.pd__card.is-done {
  opacity: 0.75;
}

.pd__status.is-late {
  color: var(--ui-amber-800);
  background-color: var(--ui-amber-50);
}

.pd__status.is-accept {
  color: var(--ui-accent);
  background-color: var(--ui-raise-2);
}

.pd__status.is-wait {
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
}

.pd__status.is-done {
  color: var(--ui-text-3);
  background-color: var(--ui-raise-2);
}

.pd__date.is-late {
  color: var(--ui-amber-800);
}

/* ===== 记一句 ===== */
.qd {
  padding: 0 26rpx calc(24rpx + env(safe-area-inset-bottom));
}

.qd__grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 12rpx auto 0;
  border-radius: 4rpx;
  background-color: var(--ui-border-strong);
}

.qd__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 2rpx 16rpx;
}

.qd__title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.qd__close {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.qd__text {
  width: 100%;
  min-height: 150rpx;
  box-sizing: border-box;
  padding: 20rpx;
  border-radius: 18rpx;
  background-color: var(--ui-raise-2);
  font-size: 28rpx;
  line-height: 1.5;
  color: var(--ui-text);
}

.qd__who {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 16rpx;
  padding: 0 20rpx;
  height: 88rpx;
  border-radius: 18rpx;
  background-color: var(--ui-raise-2);
}

/* 竖线分隔：不然「谁要的」和占位文字连成一句，看起来像标签丢了 */
.qd__who-label {
  padding-right: 20rpx;
  border-right: 2rpx solid var(--ui-hairline);
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.qd__who-input {
  flex: 1 1 auto;
  font-size: 27rpx;
  color: var(--ui-text);
}

.qd__foot {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.qd__btn {
  flex: 1 1 0;
  height: 92rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  font-size: 28rpx;
}

.qd__btn--ghost {
  border: 2rpx solid var(--ui-border-strong);
  color: var(--ui-text-2);
}

.qd__btn--primary {
  background-color: var(--ui-accent);
  color: var(--ui-on-accent);
  font-weight: 600;
}

.qd__btn.is-busy {
  opacity: 0.6;
}

/* ===== 详情抽屉 ===== */
.dd {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
}

.dd__grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 12rpx auto 0;
  border-radius: 4rpx;
  background-color: var(--ui-border-strong);
}

.dd__head {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  padding: 20rpx 26rpx 14rpx;
}

.dd__title-wrap {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.dd__title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.dd__sub {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.dd__close {
  padding-top: 6rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

/*
 * 滚动区：`height:0` + `flex:1` 才让 scroll-view 真正拿到高度
 * （uni scroll-view 必须有确定高度才内部滚动，抄表页踩过同一个坑）。
 */
/* 注意：uni 的 scroll-view 会给内层再套一层容器，直接在这个元素上写左右 padding 不生效，
   内容会顶到屏幕边上（实测右侧溢出 17px）⇒ 左右留白写在里面的 .dd__items / .dd__block 上 */
.dd__body {
  flex: 1 1 auto;
  height: 0;
  min-height: 0;
  padding: 0;
}

.dd__items {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  box-sizing: border-box;
  padding: 0 26rpx;
}

.dd__item {
  padding: 18rpx;
  border-radius: 16rpx;
  background-color: var(--ui-raise-2);
}

.dd__item-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
}

/* 规格可能很长（一长串参数），必须允许换行 + 收缩，否则会把右边的量挤出去 */
.dd__item-name {
  flex: 1 1 auto;
  min-width: 0;
  word-break: break-all;
  font-size: 27rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.dd__item-qty {
  flex: 0 0 auto;
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.dd__item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx 14rpx;
  margin-top: 8rpx;
  font-size: 21rpx;
  color: var(--ui-text-3);
  word-break: break-all;
}

.dd__item-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: var(--ui-text-2);
}

.dd__block {
  margin-top: 22rpx;
  padding: 0 26rpx;
}

.dd__block-title {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.dd__empty {
  padding: 12rpx 0;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.dd__follow {
  display: flex;
  justify-content: space-between;
  padding: 12rpx 0;
  font-size: 22rpx;
  color: var(--ui-text-2);
  border-bottom: 2rpx solid var(--ui-hairline);
}

.dd__accept {
  width: 100%;
  box-sizing: border-box;
  margin-top: 12rpx;
  padding: 0 18rpx;
  height: 88rpx;
  border-radius: 16rpx;
  background-color: var(--ui-raise-2);
  font-size: 26rpx;
  color: var(--ui-text);
}

.dd__acts {
  display: flex;
  gap: 12rpx;
  padding: 18rpx 26rpx calc(18rpx + env(safe-area-inset-bottom));
}

.dd__act {
  flex: 1 1 0;
  height: 84rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  background-color: var(--ui-raise-2);
  font-size: 25rpx;
  color: var(--ui-text);
}

.dd__act.is-danger {
  color: var(--ui-amber-800);
}

.dd__act.is-busy {
  opacity: 0.55;
}
</style>
