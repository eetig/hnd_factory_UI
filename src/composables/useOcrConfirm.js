import request from '../api/request'

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
 * @param {object} params
 * @param {string} params.billType    BILL_TYPE_PICK | BILL_TYPE_INBOUND
 * @param {string} params.documentNo  单据号
 * @param {string} params.date        日期 yyyy-MM-dd
 * @param {Array}  params.rows        [{ seqNo, materialName, materialCode, qty, unit }]
 * @param {File}   [params.file]      单据图片；会存入记录的 file_name
 * @returns {Promise<object>} { addCount, updateCount, skipCount, imageUploaded, imageUploadFailed }
 */
export async function confirmDocument({ billType, documentNo, date, rows, file }) {
  const formData = new FormData()
  formData.append('payload', JSON.stringify({ billType, documentNo, date, rows }))
  if (file) {
    // 文件名原样带上：后端据此推断扩展名
    formData.append('file', file, file.name)
  }

  const res = await request.post('/api/work-order/ocr/confirm', formData)
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
