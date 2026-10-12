import request from '../api/request'

// ===== 图片识别「确认入库」（变更-047 起含「载入编辑 / 整单跳过」）=====
//
// 落库规则全在后端（复用 Excel 导入那条管线），前端只负责：
//   ① 提交前本地预检（与后端必填项一致，提前拦住而不是等报错）
//   ② 合并同一「物料编码 + 日期」的多行（数量相加）
//   ③ 查一张单据在库中的全部明细（「载入编辑」的数据源，变更-047）
//
// ⚠️ 前端【不】做校验规则的二次实现 —— 预检只是「提前告知」，
// 真正的闸门始终是后端的 XxxImportUtil.validate。

/** 单据大类，取值与后端 / 文件导入一致 */
export const BILL_TYPE_PICK = 'material_pick_summary'
export const BILL_TYPE_INBOUND = 'production_inbound'

/**
 * 查一张单据在库中的全部明细（变更-047）。
 *
 * <p>「单据号已存在 → 载入库中数据来编辑」这条路的唯一数据源。
 * 不走 /api/pick/list 与 /api/inbound/list：那两个接口的日期区间**必传**
 * （变更-035），而且返回体里**没有行 id** —— 没有 id 就按不了行做差量保存（D2）。
 *
 * <p>不存在不是错误：返回 { exists:false, rowCount:0, rows:[] }（HTTP 200）。
 *
 * @param {object} params
 * @param {string} params.billType   BILL_TYPE_PICK | BILL_TYPE_INBOUND
 * @param {string} params.documentNo 单据号
 * @returns {Promise<object>} { billType, documentNo, exists, rowCount, imageUrl, thumbnailUrl, rows }
 */
export async function fetchDocumentDetail({ billType, documentNo }) {
  const res = await request.get('/api/work-order/document/detail', {
    params: { billType, documentNo },
  })
  const body = res.data || {}

  // 业务失败也是 HTTP 200（统一返回体），必须自判；真正的 4xx/5xx 已在请求层 reject
  if (isBusinessFailure(body)) {
    throw businessError(body, '查询单据失败')
  }
  return body.data || {}
}

/** 统一返回体 { code, msg, data, success } 的业务失败判定（与 confirmDocument 同口径） */
function isBusinessFailure(body) {
  return body?.success === false || (body?.code != null && body.code !== 200)
}

/**
 * 业务错误 → Error，并把 body.code 挂在 businessCode 上。
 *
 * <p>调用方靠它区分 409（单据被他人改动 / 行已不存在 → 重新载入）与普通失败：
 * 统一返回体下 409 也是 HTTP 200，只靠 try/catch 是分不出来的。
 */
function businessError(body, fallback) {
  const error = new Error(body?.msg || body?.message || fallback)
  error.businessCode = body?.code
  return error
}

/**
 * 提交确认入库。
 *
 * <p>⚠️ 接口是 **multipart**（后端 `@RequestParam("payload")` +
 * `@RequestPart(value = "file", required = false)`）：payload 是**一个** JSON 字符串，
 * 图片作为 file 单独一段。浏览器里 `FormData` + axios 就是它的原生态，不必换请求方式
 * （手机端 `uni.request` 发不出 multipart，那边才必须走 `uni.uploadFile`）。
 *
 * <p>**edit 模式也照传 file**（变更-047 实现时定的口径，与计划里「edit 不传」相反）：
 * 后端是**惰性**的 —— 只在「确有新增行」或「更新行原本没有图」时才会要一次图片，
 * 已有 `file_name` 的行绝不覆写（见 `DocumentImportSaveServiceImpl.saveDocRows`）。
 * 所以「没有写入时一张图都不落」这条已经由后端保证，前端省掉它只省下那一次传输，
 * 换来的是「载入编辑时新增的行**静默**拿不到线下单据图」（`imageUploadFailed` 还是
 * false，界面上看不出任何异常）—— 传与不传的代价不对等。
 *
 * @param {object} params
 * @param {string} params.billType    BILL_TYPE_PICK | BILL_TYPE_INBOUND
 * @param {string} params.documentNo  单据号
 * @param {string} [params.date]      单据级日期 yyyy-MM-dd（legacy 调用方传）；
 *                                    document 模式不传 —— 日期已下沉到行（D4），
 *                                    整单共用一个值没有意义
 * @param {'document'} [params.mode]  保存模式（变更-047）。'document' = 按行差量
 *                                    （行 id 保身份、可删除）；缺省 = legacy 增量 upsert，
 *                                    老客户端行为逐字不变
 * @param {number} [params.expectedRowCount] 严格模式的并发闸门：客户端**载入时**的库中行数。
 *                                    传了 = 严格模式（行数不符 → 409；允许删除）；
 *                                    不传 = append（只增改跳，**永不删除**）
 * @param {boolean} [params.allowEmpty] 严格模式下 rows=[] 时的整单删除显式确认
 * @param {Array}  params.rows        [{ id?, seqNo, materialName, materialCode, qty, unit, date? }]
 *                                    id = 库中行主键（新行不传）；date = 行日期（缺省回退 date）
 * @param {File}   [params.file]      单据图片；会存入记录的 file_name
 * @returns {Promise<object>} { addCount, updateCount, deleteCount, skipCount, imageUploaded, imageUploadFailed }
 */
export async function confirmDocument({
  billType,
  documentNo,
  date,
  mode,
  expectedRowCount,
  allowEmpty,
  rows,
  file,
}) {
  // undefined 字段会被 JSON.stringify 丢掉 —— 老调用方不传 mode / expectedRowCount 时，
  // payload 与改造前逐字一致（后端按 legacy 分支处理），这是「老客户端零影响」的落点
  const payload = { billType, documentNo, date, mode, expectedRowCount, allowEmpty, rows }

  const formData = new FormData()
  formData.append('payload', JSON.stringify(payload))
  if (file) {
    // 文件名原样带上：后端据此推断扩展名
    formData.append('file', file, file.name)
  }

  const res = await request.post('/api/work-order/ocr/confirm', formData)
  const body = res.data || {}

  // 后端统一返回体 { code, msg, data, success }，业务失败也是 HTTP 200，必须自判
  if (isBusinessFailure(body)) {
    throw businessError(body, '入库失败')
  }
  return body.data || {}
}

/**
 * 库中行（detail 接口的 rows）→ 可编辑表格行，**保留 id**（变更-047 / D2）。
 *
 * <p>返回的只是行数据字段；:key / 序号 / 物料候选等本地字段由调用方用 blankRow() 补齐
 * （rowUid 是组件内的循环计数，不属于这里）。
 */
export function documentRowsToTableRows(rows) {
  return (rows || []).map((row) => ({
    // 行主键原样保留：保存时随 payload 回传，后端据此保住行身份
    id: row.id ?? null,
    materialName: row.materialName || '',
    materialCode: row.materialCode || '',
    quantity: qtyText(row.qty),
    unit: row.unit || '',
    date: row.date || '',
  }))
}

/** 库中数量（decimal(18,4) → number / 数字串）→ 可编辑文本：去掉尾部零（6000.0000 → 6000） */
function qtyText(value) {
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : String(value ?? '')
}

/**
 * 合并同一「物料编码 + 日期」的多行：数量相加（变更-047 起日期进分组键）。
 *
 * <p>业务表唯一键是「单据号 + 物料编码 + 日期」（D4），同一单据同一物料**同一天**
 * 只能存一条，因此这种行才要合并；同物料不同日期是两条合法数据，不再合并。
 * **合并会掩盖识别错误** —— 模型有把一行拆成两行的情况，相加后会变成双倍数量，
 * 所以调用方要把合并明细显式报给用户看。
 *
 * <p>合并后的行保留第一条非空 id：「载入编辑」时用户在库中行之外又加了同名同日期
 * 的一行，差量保存仍认得出既有行。
 *
 * @returns {{ rows: Array, merges: Array }}
 */
export function mergeRowsByMaterialCode(rows) {
  const byKey = new Map()
  const merges = []

  for (const row of rows) {
    const code = String(row.materialCode ?? '').trim()
    // 与后端 DocMaterialDateKey 同口径：日期 trim，NULL / 空归空串
    const date = String(row.date ?? '').trim()
    const key = `${code}\u0001${date}`
    const qty = parseQty(row.quantity)

    const existing = byKey.get(key)
    if (existing) {
      const before = existing.qty
      // 按 4 位小数取整 —— 与库列 decimal(18,4) 一致，避免浮点误差累积出 0.30000000000000004
      existing.qty = round4(before + qty)
      existing.count += 1
      if (existing.id == null && row.id != null) {
        existing.id = row.id
      }
      merges.push({ code, date, name: row.materialName, before, add: qty, after: existing.qty })
    } else {
      byKey.set(key, {
        id: row.id ?? null,
        seqNo: row.index,
        materialName: row.materialName,
        materialCode: code,
        qty,
        unit: row.unit,
        date,
        count: 1,
      })
    }
  }

  return { rows: [...byKey.values()], merges }
}

/** 数量文本 → 数字；解析不出返回 null（与后端 ImportUtil 的容忍度一致：去千分位与空白） */
export function parseQty(text) {
  const cleaned = String(text ?? '').replace(/[,，\s]/g, '')
  if (!cleaned) {
    return null
  }
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function round4(value) {
  return Math.round(value * 10000) / 10000
}
