import { ref } from 'vue'
import request from '../api/request'
import { uploadFile } from '../api/upload'

// ===== 设备数据维护（2026-10-06）=====
//
// 台账 `equipment_ledger` 原先「只读、手工维护、不提供管理接口」，这个模块是它的维护入口。
// 手机端的使用场景是「拿着手机对着设备/图纸逐个核对」，所以做成**搜索 → 卡片 → 弹窗**，
// 而不是电脑端那种表格（见 components/EquipmentFormDialog.vue 的说明）。
//
// 与 PC 仓那份是**同一套语义**（两边各自维护）：字段、容器类型口径、上传返回的处理保持一致。

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

const rows = ref([])
const loading = ref(false)
let loaded = false

/** 拉台账全表。失败**不清空**已有数据（维护到一半掉线，清空比报错更吓人） */
export async function loadLedger(force = false) {
  if (loaded && !force) return rows.value
  loading.value = true
  try {
    const res = await request.get('/api/equipment/ledger/list')
    rows.value = Array.isArray(res.data?.data) ? res.data.data : []
    loaded = true
    return rows.value
  } finally {
    loading.value = false
  }
}

export async function saveLedger(draft) {
  const res = await request.post('/api/equipment/ledger/save', buildPayload(draft))
  await loadLedger(true)
  return res.data?.data
}

/** 停用 / 启用。**不提供删除**（台账是历史依据） */
export async function setLedgerEnabled(id, enabled) {
  await request.post('/api/equipment/ledger/enable', null, { params: { id, enabled } })
  await loadLedger(true)
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
  }
}

export function useEquipmentLedgerData() {
  return { rows, loading, loadLedger, saveLedger, setLedgerEnabled, uploadVesselDrawing }
}
