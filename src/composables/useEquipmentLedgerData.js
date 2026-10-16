import { computed, ref } from 'vue'
import request from '../api/request'
import { uploadFile } from '../api/upload'

// ===== 设备数据维护（2026-10-06）=====
//
// 台账 `equipment_ledger` 原先「只读、手工维护、不提供管理接口」，这个模块是它的维护入口。
// 手机端的使用场景是「拿着手机对着设备/图纸逐个核对」，所以做成**搜索 → 卡片 → 弹窗**，
// 而不是电脑端那种表格（见 components/EquipmentFormDialog.vue 的说明）。
//
// 与 PC 仓那份是**同一套语义**（两边各自维护）：字段、容器类型口径、上传返回的处理保持一致。
//
// ⚠️ 改造要点（2026-10-10 统一整改）：**搜索与分页都在服务端**。
//
// 改造前是「一次性拉全表（91 行），搜索在前端 filter，卡片分段渲染」。当时的注释还专门
// 写了理由是「现场网络未必好，敲一个字打一次接口会很难用」—— 那条担心依然成立，
// 所以这里的搜索照储罐液位页的做法：**回车 / 键盘搜索键才发请求**，不做逐字实时过滤。
//
// 「显示更多」也随之改成**取下一页并追加**（原来是本地 slice 出前 N 张卡片）。

/** 容器类型：1卧式 2平底立式 3立式 4再沸器。界面上照这个说法显示 */
export const CONTAINER_TYPES = [
  { value: 1, label: '卧式' },
  { value: 2, label: '平底立式' },
  { value: 3, label: '立式' },
  { value: 4, label: '再沸器' },
]

export function containerTypeLabel(value) {
  return CONTAINER_TYPES.find((t) => t.value === value)?.label ?? '—'
}

/** 每次取多少张卡片：与「显示更多」一次放出的张数一致 */
const PAGE_SIZE = 20

const rows = ref([]) // 已加载的卡片（首页 + 每次「显示更多」追加）
const total = ref(0) // 当前筛选条件下的总条数（服务端给的）
const pageNum = ref(1)
const loading = ref(false)
const keyword = ref('')
const onlyEnabled = ref(false)
const loadError = ref('')

/** 还有没有下一页 —— 「显示更多」按钮的显隐 */
const hasMore = computed(() => rows.value.length < total.value)

function buildQuery() {
  const params = { pageNum: pageNum.value, pageSize: PAGE_SIZE }
  const kw = keyword.value.trim()
  if (kw) params.keyword = kw
  if (onlyEnabled.value) params.onlyEnabled = true
  return params
}

async function requestPage() {
  const res = await request.get('/api/equipment/ledger/list', { params: buildQuery() })
  if (res.data?.success === false) {
    throw new Error(res.data.msg || '设备台账接口返回异常。')
  }
  return {
    list: Array.isArray(res.data?.dataList) ? res.data.dataList : [],
    total: Number(res.data?.total) || 0,
  }
}

/**
 * 取第一页（覆盖已有卡片）。
 *
 * <p>失败**不清空**已有数据（维护到一半掉线，清空比报错更吓人）—— 错误落到 loadError
 * 由面板显示。改造前的 `loaded` 缓存标志已去掉：现在每次进这个 Tab / 每次写完都取首页，
 * 数据本来就是实时的，缓存反而会让刚才改的那行看起来「没保存上」。
 */
async function loadLedger() {
  loading.value = true
  loadError.value = ''
  pageNum.value = 1
  try {
    const { list, total: serverTotal } = await requestPage()
    rows.value = list
    total.value = serverTotal
  } catch (error) {
    loadError.value =
      error?.response?.data?.msg || error?.message || '取不到设备台账（接口不可用），请稍后重试。'
  } finally {
    loading.value = false
  }
}

/** 「显示更多」：取下一页并追加到最后 */
async function loadMoreLedger() {
  if (loading.value || !hasMore.value) return
  loading.value = true
  loadError.value = ''
  try {
    pageNum.value += 1
    const { list, total: serverTotal } = await requestPage()
    rows.value = [...rows.value, ...list]
    total.value = serverTotal
  } catch (error) {
    // 退回去，否则下一次「显示更多」会跳页
    pageNum.value -= 1
    loadError.value = error?.response?.data?.msg || error?.message || '加载更多设备失败。'
  } finally {
    loading.value = false
  }
}

/** 关键字 / 「只看启用的」变了：回第 1 页重新取（在模板里由回车触发） */
function applyLedgerFilters() {
  return loadLedger()
}

export async function saveLedger(draft) {
  const res = await request.post('/api/equipment/ledger/save', buildPayload(draft))
  await loadLedger()
  return res.data?.data
}

/** 停用 / 启用。**不提供删除**（台账是历史依据） */
export async function setLedgerEnabled(id, enabled) {
  await request.post('/api/equipment/ledger/enable', null, { params: { id, enabled } })
  await loadLedger()
}

/**
 * 上传容器底图 → 返回可直接存进 `image_file` 的值。
 *
 * 走 `api/upload.js` 的 `uploadFile`（`uni.uploadFile` 封装）—— `uni.request` 三端都不支持
 * FormData，multipart 只能走它。后端会转成两张（白纸版 + 亮线版），这里只拿白纸版的文件名、
 * 拼成 `/files/xxx.png`：亮线版按 `-dark` 后缀约定自动拼得出来。
 */
export async function uploadVesselDrawing(filePath) {
  const res = await uploadFile({ url: '/api/equipment/ledger/upload-image', filePath })
  // uploadFile 返回 {data: 响应体, status}，而响应体是 Result{success, data:{fileName, darkFileName}}
  const fileName = res?.data?.data?.fileName
  if (!fileName) throw new Error('上传未返回文件名')
  return `/files/${fileName}`
}

/** 后端要的字段与类型（空串 → null：decimal 列收到 "" 会报错） */
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
    // 底图坐标：手机端**不做标定**（在小屏上框选太费劲，标定留在电脑端），
    // 这里只承担一件事 —— 「换图即作废旧坐标」：后端 save 会比对 imageFile 是否变了，
    // 变了又没给新坐标就把旧坐标清成 NULL（变更-083）。留着旧坐标会让液面画在错误位置且不报错。
    imageBounds: text(draft.imageBounds),
  }
}

export function useEquipmentLedgerData() {
  return {
    rows,
    total,
    loading,
    loadError,
    keyword,
    onlyEnabled,
    hasMore,
    loadLedger,
    loadMoreLedger,
    applyLedgerFilters,
    saveLedger,
    setLedgerEnabled,
    uploadVesselDrawing,
  }
}
