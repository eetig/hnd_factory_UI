// 巡检接口（2026-11-19）
//
// 清单（模板）与每次巡检结果都存服务端：
//   · 换手机不丢 —— 谁都能接着查历史；
//   · 模板在 App 里自己编，运营不用等发版；
//   · 只手机看（使用方明确不做 PC 页面与导出），所以接口按"列表 + 详情"两档给足即可。
//
// 离线提交不走这里：没网时先落到 utils/inspectOffline.js 的本地队列，
// 联网后由队列补传（同样调 submitRecord，靠 clientUuid 去重）。
import request from './request'
import { uploadFile } from './upload'

const BASE = '/api/inspect'

/** 清单列表（含检查项，页面直接用） */
export function listTemplates() {
  return request.get(BASE + '/templates')
}

export function getTemplate(id) {
  return request.get(BASE + '/templates/' + id)
}

export function createTemplate(payload) {
  return request.post(BASE + '/templates', payload)
}

export function updateTemplate(id, payload) {
  return request.put(BASE + '/templates/' + id, payload)
}

export function deleteTemplate(id) {
  return request.delete(BASE + '/templates/' + id)
}

/** 提交一次巡检（服务端按 clientUuid 幂等，重传不会多出一条） */
export function submitRecord(payload) {
  return request.post(BASE + '/records', payload)
}

export function listRecords(limit = 50) {
  return request.get(BASE + '/records', { params: { limit } })
}

export function getRecord(id) {
  return request.get(BASE + '/records/' + id)
}

/**
 * 上传一张巡检照片。
 *
 * 单独成函数而不是在页面里调 uploadFile：离线队列补传时也要用同一套，
 * 且以后若后端换字段名（现在是 file / 返回 {path}），只改这一处。
 */
export function uploadRecordPhoto(filePath) {
  return uploadFile({ url: BASE + '/photo', filePath, name: 'file' })
}
