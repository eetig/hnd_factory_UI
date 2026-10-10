import { ref } from 'vue'
import request from '../api/request'

// ===== 设备数据维护（2026-10-06）=====
//
// 台账 `equipment_ledger` 原先「只读、手工维护、不提供管理接口」，这个模块是它的维护入口。
// 使用方要逐个设备对着图纸核对参数。
//
// 与 uni-app 仓那份是**同一套语义**（两边各自维护）：字段、容器类型口径、上传返回的处理保持一致，
// 免得同一台设备在两端显示成两个样子。
//
// ⚠️ 改造要点（2026-10-10 统一整改）：**搜索与分页都在服务端**。
//
// 改造前是「一次拉全表（92 行）+ 前端关键字过滤 + 前端分页」，当时的注释写着
// 「维护的场景是在同一页里比对同类设备，后端分页会让人翻着翻着看不全」。
// 那条理由被统一整改推翻了：列表一律后端分页 + 后端条件查询。界面上仍有分页器，
// 只是页码 / 每页条数 / 关键字都发给服务端；「停用的行也要显示」这条口径**没变**
// （默认不带 enabled 条件，只有勾了「只看启用的」才加）。
//
// 关键字因此改成**回车才查**（面板里的输入框绑 @keyup.enter），不做逐字实时过滤 ——
// 逐字过滤会把「敲一个字打一次接口」做实。

/** 容器类型：1卧式 2平底立式 3立式 4再沸器。**界面上的说法**，与库里列注释一致 */
export const CONTAINER_TYPES = [
  { value: 1, label: '卧式' },
  { value: 2, label: '平底立式' },
  { value: 3, label: '立式' },
  { value: 4, label: '再沸器' },
]

export function containerTypeLabel(value) {
  return CONTAINER_TYPES.find((t) => t.value === value)?.label ?? '—'
}

const rows = ref([]) // 当前页
const total = ref(0) // **筛选后**的总条数（服务端给的，分页器要靠它算页数）
const loading = ref(false)
const saving = ref(false)
const pageNum = ref(1)
const pageSize = ref(20)
/** 关键字（位号/名称/昵称/规格/车间）与「只看启用的」—— 都是服务端条件 */
const keyword = ref('')
const onlyEnabled = ref(false)
const loadError = ref('')

function buildQuery() {
  const params = { pageNum: pageNum.value, pageSize: pageSize.value }
  const kw = keyword.value.trim()
  if (kw) params.keyword = kw
  if (onlyEnabled.value) params.onlyEnabled = true
  return params
}

/**
 * 取当前页。
 *
 * **失败不清空已有数据** —— 维护到一半掉线，把列表清空比报错更糟
 * （使用者会以为数据没了）。错误落到 loadError，行里留着上一次取到的内容。
 */
export async function loadLedger() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await request.get('/api/equipment/ledger/list', { params: buildQuery() })
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '设备台账接口返回异常。')
    }
    rows.value = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    total.value = Number(res.data?.total) || 0
    pageNum.value = Number(res.data?.pageNum) || pageNum.value
  } catch (error) {
    loadError.value =
      error?.response?.data?.msg || error?.message || '取不到设备台账（接口不可用）。列表里是上一次取到的数据。'
  } finally {
    loading.value = false
  }
}

/** 分页器回调：只换页，不重置条件 */
export function loadLedgerPage(page) {
  pageNum.value = page
  return loadLedger()
}

/** 关键字 / 「只看启用的」变了：回第 1 页重新查 */
export function applyLedgerFilters() {
  pageNum.value = 1
  return loadLedger()
}

/** 每页条数变了：也回第 1 页（否则会停在一个已越界的页码上） */
export function setLedgerPageSize(size) {
  pageSize.value = size
  pageNum.value = 1
  return loadLedger()
}

/**
 * 保存一行（id 为空则新增）。
 *
 * ⚠️ 只传**可维护的字段**：后端按 `EquipmentSaveDTO` 的白名单收，多传的会被忽略；
 * 但这里也别把整行原样回传（会把 imageBounds 之类系统列也带上，看着像能改、实际被丢掉）。
 */
export async function saveLedger(draft) {
  saving.value = true
  try {
    const res = await request.post('/api/equipment/ledger/save', buildPayload(draft))
    // 写完重新取当前页：列表数据在服务端，本地那份不会有新行
    await loadLedger()
    return res.data?.data
  } finally {
    saving.value = false
  }
}

/** 停用 / 启用。**不提供删除** —— 台账是历史依据，删了就查不到「某一行是怎么来的」 */
export async function setLedgerEnabled(id, enabled) {
  await request.post('/api/equipment/ledger/enable', null, { params: { id, enabled } })
  await loadLedger()
}

/**
 * 上传容器底图 → 返回可直接存进 `image_file` 的值。
 *
 * 后端会转成两张（白纸版 + 亮线版），这里只拿白纸版的文件名、拼成 `/files/xxx.png`：
 * 亮线版按 `-dark` 后缀约定自动拼得出来（前端别去记第二个名字）。
 * 用绝对路径形态（以 `/` 开头）是为了与「内置底图只写文件名」区分开 ——
 * 详见 `utils/vesselImage.js` 的解析规则。
 */
export async function uploadVesselDrawing(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await request.post('/api/equipment/ledger/upload-image', form)
  const fileName = res.data?.data?.fileName
  if (!fileName) throw new Error('上传未返回文件名')
  return `/files/${fileName}`
}

/** 后端要的字段与类型（空串 → null：不然 decimal 列收到 "" 会报错） */
export function buildPayload(draft) {
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const text = (v) => {
    const s = (v ?? '').toString().trim()
    return s === '' ? null : s
  }
  return {
    id: draft.id ?? null,
    equipmentCode: text(draft.equipmentCode) ?? '',
    equipmentName: (draft.equipmentName ?? '').toString().trim(),
    nickname: text(draft.nickname),
    workshop: text(draft.workshop) ?? '',
    spec: text(draft.spec),
    containerType: num(draft.containerType),
    innerDiameter: num(draft.innerDiameter),
    shellLength: num(draft.shellLength),
    straightFlange: num(draft.straightFlange),
    topHeadDepth: num(draft.topHeadDepth),
    bottomHeadDepth: num(draft.bottomHeadDepth),
    volumePerMm: num(draft.volumePerMm),
    density: num(draft.density),
    medium: text(draft.medium),
    remark: text(draft.remark),
    imageFile: text(draft.imageFile),
  }
}

export function useEquipmentLedgerData() {
  return {
    rows,
    total,
    loading,
    saving,
    loadError,
    pageNum,
    pageSize,
    keyword,
    onlyEnabled,
    loadLedger,
    loadLedgerPage,
    applyLedgerFilters,
    setLedgerPageSize,
    saveLedger,
    setLedgerEnabled,
    uploadVesselDrawing,
  }
}
