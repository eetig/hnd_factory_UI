import request from './request'

/**
 * 资料归档的接口层（变更-126）。
 *
 * <p>上传走**本服务转发**（`/api/archive/upload` → file-service），不是前端直连文件服务：
 * 那个服务不对外暴露、也没有鉴权注解（与采购送货单图片同一套）。
 */
export const ARCHIVE_API = '/api/archive'

/** 列表：关键字 / 分类（含子类）/ N 天内到期 */
export function listArchive(params) {
  return request.get(`${ARCHIVE_API}/list`, { params })
}

/** 分类树（两级，带每个分类的资料数） */
export function fetchArchiveCategories() {
  return request.get(`${ARCHIVE_API}/categories`)
}

/** 保存（新增或修改） */
export function saveArchive(data) {
  return request.post(`${ARCHIVE_API}/save`, data)
}

/** 删除（软删；后端只有 admin 能调） */
export function deleteArchive(id) {
  return request.delete(`${ARCHIVE_API}/delete`, { params: { id } })
}

/** 新增/改名分类 */
export function saveArchiveCategory(data) {
  return request.post(`${ARCHIVE_API}/category/save`, data)
}

/** 删除分类（有子类或有资料时后端会拒） */
export function deleteArchiveCategory(id) {
  return request.delete(`${ARCHIVE_API}/category/delete`, { params: { id } })
}

/**
 * 上传文件（原样存，不重编码）。
 *
 * <p>不手写 Content-Type：FormData 交给浏览器带 boundary，手写会把 boundary 写丢，
 * 后端收到的是"不是 multipart"的 400。
 */
export function uploadArchiveFile(file) {
  const form = new FormData()
  form.append('file', file)
  return request.post(`${ARCHIVE_API}/upload`, form)
}

/** 下载地址（带 token 走 axios 拿 blob 更稳，但这里用 <a href> 也能过 —— 见面板里的实现） */
export function downloadArchive(id) {
  return request.get(`${ARCHIVE_API}/download/${id}`, { responseType: 'blob' })
}
