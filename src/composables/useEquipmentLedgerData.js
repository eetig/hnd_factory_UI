import { ref } from 'vue'
import request from '../api/request'

// ===== 设备数据维护（2026-10-06）=====
//
// 台账 `equipment_ledger` 原先「只读、手工维护、不提供管理接口」，这个模块是它的维护入口。
// 使用方要逐个设备对着图纸核对参数，所以列表要一次拿全（92 行，不分页），
// 并且**停用的行也要显示**（要能重新启用）。
//
// 与 uni-app 仓那份是**同一套语义**（两边各自维护）：字段、容器类型口径、上传返回的处理保持一致，
// 免得同一台设备在两端显示成两个样子。

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

const rows = ref([])
const loading = ref(false)
const saving = ref(false)
let loaded = false

/**
 * 拉台账全表。**失败不清空已有数据** —— 维护到一半掉线，把列表清空比报错更糟
 * （使用者会以为数据没了）。
 */
export async function loadLedger(force = false) {
  if (loaded && !force) return rows.value
  loading.value = true
  try {
    const res = await request.get('/api/equipment/ledger/list')
    const list = Array.isArray(res.data?.data) ? res.data.data : []
    rows.value = list
    loaded = true
  } catch {
    // 保留 rows 原样；由调用方按 loading/错误态提示
    throw new Error('load failed')
  } finally {
    loading.value = false
  }
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
    await loadLedger(true)
    return res.data?.data
  } finally {
    saving.value = false
  }
}

/** 停用 / 启用。**不提供删除** —— 台账是历史依据，删了就查不到「某一行是怎么来的」 */
export async function setLedgerEnabled(id, enabled) {
  await request.post('/api/equipment/ledger/enable', null, { params: { id, enabled } })
  await loadLedger(true)
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
  return { rows, loading, saving, loadLedger, saveLedger, setLedgerEnabled, uploadVesselDrawing }
}
