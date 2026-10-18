import { CONTAINER_TYPES } from '../../composables/useEquipmentLedgerData'

/**
 * 设备台账的字段元数据（2026-10-18，变更-118）。
 *
 * 与采购页 `purchase/fields.js` 同一套口径：**一张字段表驱动抽屉渲染**，
 * 面板、抽屉、校验都读这里，不许在别处再抄一份字段顺序或中文名。
 *
 * ## 与采购页的差别（业务上真实存在的差别，不是没对齐）
 *
 *   ① 设备台账**没有删除**：`useEquipmentLedgerData` 里写得很清楚 ——
 *      「台账是历史依据，删了就查不到某一行是怎么来的」，接口也只提供
 *      `enable/disable`。所以抽屉底部左侧不是「删除」，而是空的。
 *   ② 有一个**只读的状态行**：`enabled` 只表示"在台账里启用"，而体积计算页
 *      还要求「底图 + 坐标 + 几何齐全」。两者不一致时显示「启用 · 仅台账」
 *      并给出原因入口（变更-087 的口径，不能因为换成抽屉就丢）。
 *   ③ 容器类型是 1/2/3 的数字枚举，中文名走 `containerTypeLabel`。
 */

/** 抽屉里"打开就把光标放这里"的字段：新增一台设备时最常先填名称 */
export const FOCUS_FIELD_ON_CREATE = 'equipmentName'

/**
 * 数值类字段（键 → 中文名）。
 *
 * 只做「像不像数字」的粗校验：这些值会直接喂给容器体积计算，一旦混进 "350O"
 * （字母 O）这类值，保存时不报错，计算页却算出一个 NaN（变更-033）。
 * 留空一律放行 —— 表示"还没量"。
 */
export const NUMERIC_FIELDS = [
  ['innerDiameter', '内径'],
  ['shellLength', '筒体长度'],
  ['straightFlange', '直边'],
  ['topHeadDepth', '上封头深度'],
  ['bottomHeadDepth', '下封头深度'],
  ['volumePerMm', '每毫米体积'],
  ['density', '介质密度'],
]

/**
 * 字段表。`kind` 决定用哪个控件：
 *   text / number → el-input（number 带 inputmode=decimal）
 *   select        → el-select（容器类型）
 *   status        → 只读状态行（带"为何不能启用/不能算"的入口）
 *   image         → 底图：缩略图 + 上传 + 标定 + 清除（沿用 VesselCalibrateDialog）
 */
export const FIELDS = [
  { key: 'equipmentCode', label: '设备位号', kind: 'text', placeholder: '如 V-150' },
  { key: 'equipmentName', label: '设备名称', kind: 'text', placeholder: '如 HND-V150 合成釜' },
  { key: 'nickname', label: '设备昵称', kind: 'text', placeholder: '现场习惯叫法（可空）' },
  { key: 'workshop', label: '车间装置', kind: 'text', placeholder: '如 合成车间' },
  { key: 'spec', label: '设备规格', kind: 'text', placeholder: '如 Φ1200×3000' },
  { key: 'containerType', label: '容器类型', kind: 'select' },
  { key: 'status', label: '状态', kind: 'status' },
  { key: 'medium', label: '介质', kind: 'text', placeholder: '如 三氯氢硅' },
  { key: 'density', label: '介质密度', kind: 'number', unit: 'g/cm³', placeholder: '可空' },
  { key: 'volumePerMm', label: '每毫米体积', kind: 'number', unit: 'm³/mm', placeholder: '可空' },
  { key: 'innerDiameter', label: '内径', kind: 'number', unit: 'mm' },
  { key: 'shellLength', label: '筒体长度', kind: 'number', unit: 'mm', hint: '不含两端直边' },
  { key: 'straightFlange', label: '直边', kind: 'number', unit: 'mm' },
  { key: 'topHeadDepth', label: '上封头深度', kind: 'number', unit: 'mm' },
  {
    key: 'bottomHeadDepth',
    label: '下封头深度',
    kind: 'number',
    unit: 'mm',
    hint: '留空表示平底',
  },
  { key: 'imageFile', label: '容器底图', kind: 'image' },
  { key: 'remark', label: '备注', kind: 'text', placeholder: '可空' },
]

/**
 * 抽屉内的分组。顺序 = 从上到下；缺一组会让 17 个字段平铺成一长条，
 * 对着图纸核对时找不到"筒体长度"在哪（上一版弹窗就是靠分组才好用）。
 */
export const DRAWER_GROUPS = [
  {
    title: '台账信息',
    hint: '对着图纸核对时，这组是设备的"身份证"',
    keys: ['equipmentCode', 'equipmentName', 'nickname', 'workshop', 'spec', 'containerType', 'status'],
  },
  {
    title: '介质参数',
    hint: '介质密度参与重量换算；每毫米体积用于由液位反算体积',
    keys: ['medium', 'density', 'volumePerMm'],
  },
  {
    title: '容器尺寸',
    hint: '单位 mm；筒体长度不含两端直边，下封头留空表示平底',
    keys: ['innerDiameter', 'shellLength', 'straightFlange', 'topHeadDepth', 'bottomHeadDepth'],
  },
  {
    title: '底图与备注',
    hint: '体积计算页只收「已启用 + 已标定 + 几何齐全」的设备',
    keys: ['imageFile', 'remark'],
  },
]

const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]))

export function fieldByKey(key) {
  return BY_KEY.get(key) ?? null
}

/** 容器的下拉选项（中文名也走同一处换算，别在模板里再写一遍） */
export const CONTAINER_OPTIONS = CONTAINER_TYPES

/**
 * 空表单。⚠️ `containerType` 默认 3（立式圆筒）而不是空 —— 与改造前一致：
 * 台账里绝大多数是这个形状，空着逼人每次都选一遍没有意义。
 */
export function blankDraft(source = {}) {
  return {
    id: source.id ?? null,
    equipmentCode: source.equipmentCode ?? '',
    equipmentName: source.equipmentName ?? '',
    nickname: source.nickname ?? '',
    workshop: source.workshop ?? '',
    spec: source.spec ?? '',
    containerType: source.containerType ?? 3,
    innerDiameter: source.innerDiameter ?? null,
    shellLength: source.shellLength ?? null,
    straightFlange: source.straightFlange ?? null,
    topHeadDepth: source.topHeadDepth ?? null,
    bottomHeadDepth: source.bottomHeadDepth ?? null,
    volumePerMm: source.volumePerMm ?? null,
    density: source.density ?? null,
    medium: source.medium ?? '',
    remark: source.remark ?? '',
    imageFile: source.imageFile ?? '',
    /*
     * 底图坐标（变更-081 起后端可写、变更-082 起有标定界面）。
     * 带上它是为了「抽屉里刚标完就保存」这条路径；没标定的行是空串，
     * 提交时转成 null，后端的默认更新策略会跳过这一列 —— 普通保存不会清掉已有标定。
     */
    imageBounds: source.imageBounds ?? '',
  }
}

/** 返回第一个「填了但不是数字」的字段中文名；全部合法返回空串 */
export function firstNonNumericField(draft) {
  for (const [key, label] of NUMERIC_FIELDS) {
    const raw = draft[key]
    if (raw === null || raw === undefined) continue
    const text = String(raw).trim()
    if (!text) continue
    if (!Number.isFinite(Number(text))) return label
  }
  return ''
}
