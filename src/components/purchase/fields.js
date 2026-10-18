/**
 * 采购需求的字段元数据（从 `PurchaseTrackingPanel.vue` 提出来，变更-117）。
 *
 * 为什么提出来：抽屉（`PurchaseDetailDrawer`）与列配置都要读同一份字段表。
 * 如果留两份，"保存时发了哪些字段"与"界面渲染了哪些字段"迟早写歪 ——
 * 上一版就是靠 `EDIT_FIELDS` 单表驱动才没歪，这里继续守着这条。
 *
 * ⚠️ **kind 决定控件**，不要按字段名写 if 分支：
 *   text          普通输入框
 *   date          el-date-picker
 *   select        el-select（category 走 CATEGORY_OPTIONS）
 *   materialName  el-autocomplete（远程检索物料名称，选中后带出编码/规格）
 *   materialCode  el-autocomplete（同上，方向相反）
 *   quantity      **一格两个控件**（数量 + 单位）
 *   number        纯数字输入（实际到货数量）
 *   oaNoWithLink  **一格两个控件**（OA 单号 + 表单链接）
 *   image         送货单图片上传控件
 */

/** 类别枚举（与后端约定一致；统计时这是第一个会切的维度） */
export const CATEGORY_OPTIONS = ['备件', '五金', '原料', '设备', '其他']

/**
 * 常见单位候选（`allow-create` 允许自己敲）：
 * 固定清单会挡住"公斤/桶/卷"这类，自由输入又会写成 个/只/件 三种并存 ——
 * 折中成"给常用值、也能自填"。
 */
export const UNIT_OPTIONS = ['个', '台', '套', '件', '只', '米', '公斤', '桶', '卷', '张']

/** 一条空的需求。空着的字段就按"没有"处理（buildPurchasePayload 会把空串转成 null） */
export function blankDraft() {
  return {
    requester: '',
    requestDate: '',
    materialName: '',
    materialCode: '',
    spec: '',
    purpose: '',
    category: '',
    quantity: '',
    unit: '',
    requiredArrivalDate: '',
    oaNo: '',
    oaUrl: '',
    deliveryNote: '',
    receivedQuantity: '',
    actualArrivalDate: '',
    remark: '',
  }
}

/**
 * 可编辑字段表 —— 新建与编辑共用一份。
 * **顺序即抽屉里的顺序**（分组见 DRAWER_GROUPS）。
 */
export const EDIT_FIELDS = [
  { key: 'requester', kind: 'text', placeholder: '需求人', aria: '需求人' },
  { key: 'requestDate', kind: 'date', aria: '提出需求日期' },
  { key: 'materialName', kind: 'materialName', placeholder: '打字搜物料名称', aria: '物料名称' },
  { key: 'materialCode', kind: 'materialCode', placeholder: '打字搜物料编码', aria: '物料编码' },
  { key: 'spec', kind: 'text', placeholder: '规格型号', aria: '规格型号' },
  { key: 'category', kind: 'select', aria: '类别' },
  { key: 'purpose', kind: 'text', placeholder: '用途（这料拿去干嘛）', aria: '用途' },
  { key: 'quantity', kind: 'quantity', aria: '数量与单位' },
  { key: 'requiredArrivalDate', kind: 'date', aria: '要求到货日期' },
  { key: 'receivedQuantity', kind: 'number', placeholder: '实际到货数量', aria: '实际到货数量' },
  { key: 'actualArrivalDate', kind: 'date', aria: '实际到货日期' },
  { key: 'oaNo', kind: 'oaNoWithLink', placeholder: 'OA 单号', aria: 'OA 单号' },
  // 送货单是一张图片（变更-094，使用方：「送货单是一张图片」）—— 不再是文本框，
  // 换成上传控件（选图即传、显示缩略图、可重传/删除）。
  { key: 'deliveryNote', kind: 'image', aria: '送货单图片' },
  { key: 'remark', kind: 'text', placeholder: '备注', aria: '备注' },
]

const BY_KEY = new Map(EDIT_FIELDS.map((f) => [f.key, f]))

/** 取一条字段元数据（抽屉渲染用；key 不存在返回 undefined） */
export function fieldByKey(key) {
  return BY_KEY.get(key)
}

/**
 * 抽屉里的语义分组（2026-10-18，变更-117）。
 *
 * 分组的依据是**填表时的心理顺序**，不是数据库列顺序：
 *   ① 这是什么料（基本信息）→ ② 要多少、什么时候要（数量与到货）→ ③ 单据与备注
 * 15 个字段平铺在一列里，人会找不到"到货日期"在哪。
 */
export const DRAWER_GROUPS = [
  {
    title: '基本信息',
    keys: ['requester', 'requestDate', 'materialName', 'materialCode', 'spec', 'category', 'purpose'],
  },
  {
    title: '数量与到货',
    keys: ['quantity', 'requiredArrivalDate', 'receivedQuantity', 'actualArrivalDate'],
  },
  {
    title: '单据与备注',
    keys: ['oaNo', 'deliveryNote', 'remark'],
  },
]

/**
 * 抽屉里 **新建模式下必须自动聚焦** 的字段。
 * 选物料名称是因为它是整条记录的主体（且第一次打断字就是要搜料）。
 */
export const FOCUS_FIELD_ON_CREATE = 'materialName'
