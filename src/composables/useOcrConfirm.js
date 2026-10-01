import { uploadFile } from '../api/upload'

// ===== 图片识别「确认入库」=====
//
// 落库规则全在后端（复用 Excel 导入那条管线），前端只负责：
//   ① 提交前本地预检（与后端必填项一致，提前拦住而不是等报错）
//   ② 合并同一物料编码的多行（数量相加）
//
// ⚠️ 前端【不】做校验规则的二次实现 —— 预检只是「提前告知」，
// 真正的闸门始终是后端的 XxxImportUtil.validate。

/** 单据大类，取值与后端 / 文件导入一致 */
export const BILL_TYPE_PICK = 'material_pick_summary'
export const BILL_TYPE_INBOUND = 'production_inbound'

/**
 * 提交确认入库。
 *
 * <p>⚠️ 这个接口是 **multipart**（后端 `consumes = MULTIPART_FORM_DATA_VALUE`：
 * `@RequestParam("payload")` + `@RequestPart(value = "file", required = false)`），
 * 而 `uni.request` 在**任何端**都发不出 multipart 请求体。改造前这里是
 * `new FormData()` + `request.post`，H5 实测服务端实收的是
 * `Content-Type: application/json` + body `{}` —— payload 与图片被**静默丢弃**，
 * 前端还拿到成功响应，表现成「提示入库完成、库里没有数据」。所以必须走 `uni.uploadFile`。
 *
 * <p>代价：`uni.uploadFile` 必须带一个文件，发不了「只有 payload」的请求。
 * 本流程的图片一定存在（单据图就是识别的输入），故 `filePath` 按必填处理；
 * 缺了就直接抛错，**不要**退化成「塞一个空文件」—— 那会在库里落下一张假图，
 * 而且 file_name 会让汇总列表的「线下单据」列显示成一张打不开的图。
 *
 * @param {object} params
 * @param {string} params.billType    BILL_TYPE_PICK | BILL_TYPE_INBOUND
 * @param {string} params.documentNo  单据号
 * @param {string} params.date        日期 yyyy-MM-dd
 * @param {Array}  params.rows        [{ seqNo, materialName, materialCode, qty, unit }]
 * @param {string} params.filePath    单据图片的本地路径（chooseImage 临时路径 / H5 blob URL）
 * @returns {Promise<object>} { addCount, updateCount, skipCount, imageUploaded, imageUploadFailed }
 */
export async function confirmDocument({ billType, documentNo, date, rows, filePath }) {
  if (!filePath) {
    throw new Error('没有可上传的单据图片，无法入库')
  }

  const res = await uploadFile({
    url: '/api/work-order/ocr/confirm',
    filePath,
    // 字段名必须叫 file —— 后端按 @RequestPart("file") 取；改名就是拿不到图片
    name: 'file',
    // payload 是**一个** JSON 字符串（后端签名是 String，不是对象）
    formData: { payload: JSON.stringify({ billType, documentNo, date, rows }) },
  })

  const body = res.data || {}

  // 后端统一返回体 { code, msg, data, success }，业务失败也是 HTTP 200，必须自判
  if (body.success === false || (body.code != null && body.code !== 200)) {
    throw new Error(body.msg || body.message || '入库失败')
  }
  return body.data || {}
}

/**
 * 合并同一物料编码的多行：数量相加。
 *
 * 业务表唯一键是「单据号 + 物料编码」，同一单据同一物料只能存一条，
 * 因此两行必须合并。**这也会掩盖识别错误** —— 模型有把一行拆成两行的情况，
 * 相加后会变成双倍数量，所以调用方要把合并明细显式报给用户看。
 *
 * @returns {{ rows: Array, merges: Array }}
 */
export function mergeRowsByMaterialCode(rows) {
  const byCode = new Map()
  const merges = []

  for (const row of rows) {
    const code = String(row.materialCode ?? '').trim()
    const qty = parseQty(row.quantity)

    const existing = byCode.get(code)
    if (existing) {
      const before = existing.qty
      // 按 4 位小数取整 —— 与库列 decimal(18,4) 一致，避免浮点误差累积出 0.30000000000000004
      existing.qty = round4(before + qty)
      existing.count += 1
      merges.push({ code, name: row.materialName, before, add: qty, after: existing.qty })
    } else {
      byCode.set(code, {
        seqNo: row.index,
        materialName: row.materialName,
        materialCode: code,
        qty,
        unit: row.unit,
        count: 1,
      })
    }
  }

  return { rows: [...byCode.values()], merges }
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
