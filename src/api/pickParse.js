import request from './request'

/*
 * 领料解析（变更-190，2026-11-12）。
 *
 * 两段能力：
 * 1) 识别 —— 直连本服务的 OCR 代理 `/api/ocr/recognize`（转发给 myocr 容器）。
 *    注意 myocr 的业务失败是 HTTP 200 + code≠200，axios 不会 reject，必须自己判 code。
 * 2) 模板与导出 —— `/api/pick-template/*`，模板文件（SAP 导出的空 xlsx）存在库里，
 *    导出时后端克隆模板 sheet、按部门分页、单与单之间空一行。
 */

/** 识别一张单据照片；返回 myocr 的 data（documentType/documentNo/docDate/department/requester/items…） */
export async function recognizePickDoc(file, fileName) {
  const form = new FormData()
  form.append('file', file)
  if (fileName) form.append('fileName', fileName)
  const res = await request.post('/api/ocr/recognize', form)
  const body = res.data || {}
  if (body.code !== 200) {
    throw new Error(body.message || body.msg || '识别失败')
  }
  return body.data || {}
}

/** 模板列表；dept 有值时后端会连「通用模板（dept 为空）」一起返回 */
export async function listPickTemplates(dept) {
  const res = await request.get('/api/pick-template/list', { params: dept ? { dept } : {} })
  return res.data?.data || []
}

/** 上传一张 SAP 导出的空模板（.xlsx ≤5MB） */
export async function uploadPickTemplate({ file, name, docType, dept }) {
  const form = new FormData()
  form.append('file', file)
  if (name) form.append('name', name)
  if (docType) form.append('docType', docType)
  if (dept) form.append('dept', dept)
  const res = await request.post('/api/pick-template/upload', form)
  const body = res.data || {}
  if (body.success === false) throw new Error(body.msg || '上传失败')
  return body.data
}

/** 导出 Excel（返回 Blob 与建议文件名） */
export async function exportPickExcel(payload) {
  const res = await request.post('/api/pick-template/export', payload, { responseType: 'blob' })
  const dispo = res.headers?.['content-disposition'] || ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(dispo)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(dispo)?.[1]
  let name = '领料单.xlsx'
  if (encoded) {
    try {
      name = decodeURIComponent(encoded)
    } catch {
      name = encoded
    }
  } else if (plain) {
    name = plain
  }
  return { blob: res.data, name }
}
