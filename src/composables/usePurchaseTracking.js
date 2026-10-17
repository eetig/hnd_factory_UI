import { ref } from 'vue'
import request from '../api/request'

// ===== 采购需求详情（2026-10-16，变更-091；2026-10-17，变更-096）=====
//
// 这一页记的是「谁、哪天提出要什么料、要求哪天到、提了哪张 OA 单、到的哪张送货单」——
// 需求登记 → 提 OA 单 → 到货，一条线的流水台账。
//
// 与后端 `PurchaseTrackingSaveDTO` **一一对应**（那份是白名单：多传的字段会被忽略）。
// 保存时后端会把物料编码登记进 material_stock 的采购登记档（1503 / 0000 / 采购登记（无库存）），
// 前端**不需要**关心那件事 —— 它是后端的职责，也不该由界面决定怎么写总表。
//
// 分页 / 筛选一律在服务端（2026-10-10 统一整改的既定口径），所以：
//   · 页码、每页条数、关键字、日期区间、状态、类别都发给服务端；
//   · 写完必须重新取当前页 —— 本地那份不会有新行。
//
// ⚠️ 保存/删除**不要**自己判断 success：`api/request.js` 已把「HTTP 200 + success:false」
// 拦成 Promise 拒绝（变更-085）。调用方只需要 try/catch 并把 msg 显示出来。
//
// ⚠️ **不要在本地重算「超期/临期」**：口径（提前几天算临期、到货后还算不算超期）只写在
// 后端 `PurchaseTrackingStatus` 一处，这里只消费 `row.status` / `row.statusLabel` /
// `row.overdueDays` / `row.daysToDue`。前端照抄一份判断，迟早和后端对不上。

const rows = ref([]) // 当前页
const total = ref(0) // **筛选后**的总条数（服务端给的）
/**
 * 顶部汇总栏的计数（变更-096）。
 *
 * ⚠️ 必须走 `/api/purchase/summary` 由服务端算：用当前页 group by 只会得到
 * "前 10 条的合计"，而这一栏要的是全量（ADR-0003 那条口径）。
 */
const summary = ref({ total: 0, pendingOa: 0, waiting: 0, dueSoon: 0, overdue: 0, arrived: 0, partial: 0 })
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const pageNum = ref(1)
/** 默认 10 行：与维护页同口径（10 行在 1080p 与 768px 高的窗口都放得下，默认视图里不出现滚动条） */
const pageSize = ref(10)
/** 关键字：模糊匹配 需求人/物料名称/物料编码/规格型号/OA 单号/送货单号 */
const keyword = ref('')
/** 提出需求日期区间（yyyy-MM-dd，空串 = 不限） */
const rangeStart = ref('')
const rangeEnd = ref('')
/** 派生状态筛选（PENDING_OA/WAITING/DUE_SOON/OVERDUE/ARRIVED/PARTIAL；空串 = 不限） */
const statusFilter = ref('')
/** 类别筛选（备件/五金/原料/设备/其他；空串 = 不限） */
const categoryFilter = ref('')

/** 列表只发分页与筛选；汇总不分页（后端那个端点也不收 pageNum/pageSize） */
function buildQuery(withPaging = true) {
  const params = {}
  if (withPaging) {
    params.pageNum = pageNum.value
    params.pageSize = pageSize.value
  }
  const kw = keyword.value.trim()
  if (kw) params.keyword = kw
  const start = rangeStart.value
  if (start) params.startDate = start
  const end = rangeEnd.value
  if (end) params.endDate = end
  const status = statusFilter.value
  if (status) params.status = status
  const category = categoryFilter.value
  if (category) params.category = category
  return params
}

/**
 * 请求序号护栏（与维护页同一套）。
 *
 * 打字停顿就发一次请求，接着再敲一下又发一次；先发的那次如果后回来，
 * 会把新结果盖掉 —— 屏上的行与输入框里的词对不上，而且不报错。
 */
let purchaseRequestSeq = 0

/**
 * 取顶部汇总（变更-096）。与列表**并行**发，互不阻塞。
 *
 * 失败时**不清零**：留着上一次的数字比显示一排 0 好 —— 0 会被读成"没有超期"，
 * 而事实可能是接口挂了。错误只记在 loadError 之外不单独提示（列表那边已经有一条横幅）。
 */
export async function loadSummary() {
  try {
    const res = await request.get('/api/purchase/summary', { params: buildQuery(false) })
    if (res.data?.success === false) {
      return
    }
    const data = res.data?.data
    if (data) {
      summary.value = {
        total: Number(data.total) || 0,
        pendingOa: Number(data.pendingOa) || 0,
        waiting: Number(data.waiting) || 0,
        dueSoon: Number(data.dueSoon) || 0,
        overdue: Number(data.overdue) || 0,
        arrived: Number(data.arrived) || 0,
        partial: Number(data.partial) || 0,
      }
    }
  } catch {
    // 汇总失败不影响列表可用性，静默保留旧值（见上面的注释）
  }
}

/**
 * 取当前页。
 *
 * **失败不清空已有数据** —— 正查着掉线，把列表清空比报错更糟（使用者会以为数据没了）。
 * 错误落到 loadError，行里留着上一次取到的内容。
 */
export async function loadPurchase() {
  const seq = ++purchaseRequestSeq
  loading.value = true
  loadError.value = ''
  // 汇总与列表并行：汇总失败被吞掉，不会拖累列表
  loadSummary()
  try {
    const res = await request.get('/api/purchase/list', { params: buildQuery() })
    if (seq !== purchaseRequestSeq) return // 过期响应：整段丢弃

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '采购进度接口返回异常。')
    }
    rows.value = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    total.value = Number(res.data?.total) || 0
    pageNum.value = Number(res.data?.pageNum) || pageNum.value
  } catch (error) {
    if (seq !== purchaseRequestSeq) return // 过期请求的失败不算数（条件已经变了）
    loadError.value =
      error?.response?.data?.msg || error?.message || '取不到采购进度（接口不可用）。列表里是上一次取到的数据。'
  } finally {
    if (seq === purchaseRequestSeq) loading.value = false
  }
}

/** 分页器回调：只换页，不重置条件 */
export function loadPurchasePage(page) {
  pageNum.value = page
  return loadPurchase()
}

/** 关键字 / 日期区间变了：回第 1 页重新查 */
export function applyPurchaseFilters() {
  pageNum.value = 1
  return loadPurchase()
}

/** 每页条数变了：也回第 1 页（否则会停在一个已越界的页码上） */
export function setPurchasePageSize(size) {
  pageSize.value = size
  pageNum.value = 1
  return loadPurchase()
}

/**
 * 保存（id 为空则新增）。成功后重新取当前页。
 *
 * @param draft 表单草稿
 * @param options.gotoFirstPage 新增后是否回到第 1 页（变更-096 修的变更-093 遗留问题：
 *   原先保存完**停在当前页**，排序是"提出需求日期倒序"，所以翻在第 2 页时新加的行看不见，
 *   只有一个 toast 一闪而过 —— 使用者会以为没存上、再录一遍）
 */
export async function savePurchase(draft, options = {}) {
  saving.value = true
  try {
    const res = await request.post('/api/purchase/save', buildPurchasePayload(draft))
    if (options.gotoFirstPage) {
      pageNum.value = 1
    }
    await loadPurchase()
    return res.data?.data
  } finally {
    saving.value = false
  }
}

/**
 * 删除一条。
 *
 * 后端**不会**因此回滚 material_stock 里的登记行 —— 登记的是"这个编码存在过"，
 * 与某一条采购记录在不在无关（与「旧编码即使库存为 0 也保留」同一条口径）。
 */
export async function deletePurchase(id) {
  await request.delete('/api/purchase/delete', { params: { id } })
  await loadPurchase()
}

// ===== 送货单图片（变更-094：使用方「送货单是一张图片」）=====

const uploading = ref(false)

/**
 * 上传一张送货单图片，返回存进 `deliveryNote` 的值。
 *
 * 按 ADR-0004 的固定拼接规则存 **`/files/<fileName>`**（不存裸文件名、也不存 img-service
 * 给的 URL）—— 缩略图由 storedImageThumb 换成 `/thumbs/…` 拼出来，前端只记一条规则。
 *
 * 上传打到本服务转发（img-service 不对外、那边也没有鉴权）；权限位在服务端那一层。
 */
export async function uploadDeliveryNote(file) {
  uploading.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await request.post('/api/purchase/upload-delivery-note', form)
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '上传失败')
    }
    const fileName = res.data?.data
    if (!fileName) {
      throw new Error('上传未返回文件名')
    }
    return `/files/${fileName}`
  } finally {
    uploading.value = false
  }
}

/**
 * 这个值是不是我们存的图片路径。
 *
 * ⚠️ `delivery_note` 这一列**原本是文本**（送货单号），老数据里可能是任意文字、也可能是空串
 * （空串 = 还没到货）。所以判断只看形态，不看"有没有值" —— 一段文字要照文本显示，
 * 不能当坏数据，更不能拿它去拼图片地址。
 */
export function isStoredImage(value) {
  return typeof value === 'string' && value.trim().startsWith('/files/')
}

/** `/files/abc.png` → `/thumbs/abc.png`（img-service 两个前缀都提供）；不是图片则原样返回 */
export function storedImageThumb(value) {
  return isStoredImage(value) ? value.trim().replace('/files/', '/thumbs/') : value
}

/**
 * 后端要的字段与类型（与 `PurchaseTrackingSaveDTO` 一一对应）。
 *
 * 空串 → null：可空的列（规格/备注/日期/类别/数量/单位）交给后端写 NULL；
 * 两个必填列（需求人/物料名称）原样传，由后端校验并给出人能看懂的话。
 * 日期用 `yyyy-MM-dd` 字符串 —— 后端是 `LocalDate`，Jackson 按 ISO 解析。
 *
 * ⚠️ 数量类字段（quantity / receivedQuantity）发**数字或 null**，不要发空串：
 * 后端是 `BigDecimal`，`""` 会被当成解析失败。空输入框一律转 null（"没填"，不是 0）。
 */
export function buildPurchasePayload(draft) {
  const text = (v) => {
    const s = (v ?? '').toString().trim()
    return s === '' ? null : s
  }
  const date = (v) => {
    const s = (v ?? '').toString().trim()
    return s === '' ? null : s
  }
  const decimal = (v) => {
    const s = (v ?? '').toString().trim()
    if (s === '') {
      return null
    }
    const n = Number(s)
    // 非数字不发：宁可让后端收 null（等于没填），也不要发一个 NaN 让整次保存 400
    return Number.isFinite(n) ? n : null
  }
  return {
    id: draft.id ?? null,
    requester: (draft.requester ?? '').toString().trim(),
    requestDate: date(draft.requestDate),
    materialName: (draft.materialName ?? '').toString().trim(),
    materialCode: text(draft.materialCode),
    spec: text(draft.spec),
    category: text(draft.category),
    quantity: decimal(draft.quantity),
    unit: text(draft.unit),
    requiredArrivalDate: date(draft.requiredArrivalDate),
    oaNo: text(draft.oaNo),
    deliveryNote: text(draft.deliveryNote),
    receivedQuantity: decimal(draft.receivedQuantity),
    actualArrivalDate: date(draft.actualArrivalDate),
    remark: text(draft.remark),
  }
}

export function usePurchaseTracking() {
  return {
    rows,
    total,
    summary,
    loading,
    saving,
    uploading,
    loadError,
    pageNum,
    pageSize,
    keyword,
    rangeStart,
    rangeEnd,
    statusFilter,
    categoryFilter,
    loadPurchase,
    loadSummary,
    loadPurchasePage,
    applyPurchaseFilters,
    setPurchasePageSize,
    savePurchase,
    deletePurchase,
  }
}
