import request from './request'

/**
 * 储罐（容器实例）接口（2026-11-09）。
 *
 * 模型：设备台账是**图纸**，储罐是车间按图纸买回来的容器，
 * 每个罐手工指定用哪张图纸（使用方原话「容器我来指定哪张图纸」）。
 */
const BASE = '/api/equipment/tank'

/** 列表（keyword 模糊罐号/罐名/属地/物料） */
export function listTanks(params = {}) {
  return request.get(`${BASE}/list`, { params })
}

/** 新增或更新；返回主键 */
export function saveTank(payload) {
  return request.post(`${BASE}/save`, payload)
}

/** 启用 / 停用 */
export function setTankEnabled(id, enabled) {
  return request.post(`${BASE}/enable`, null, { params: { id, enabled } })
}

/** 删除（有液位记录的罐以后会被挡住，只让你停用） */
export function deleteTank(id) {
  return request.delete(`${BASE}/delete`, { params: { id } })
}
