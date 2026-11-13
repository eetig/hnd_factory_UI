import request from './request'

/**
 * 手机端「发到电脑」的领料单队列。
 *
 * 约定与 `request` 一致：非 2xx 走 reject，成功结果包成 `{ data }`。
 * 业务失败仍是 HTTP 200 + `code !== 200`，调用方要自己判。
 */

export async function pendingPickOrders() {
  const res = await request.get('/api/pick-order/pending')
  const body = res.data || {}
  if (body.code !== 200) throw new Error(body.msg || '取手机传上来的单失败')
  return Array.isArray(body.data) ? body.data : []
}

/** 取明细。列表接口不带明细，点「取用」时才拉。 */
export async function pickOrderDetail(id) {
  const res = await request.get('/api/pick-order/detail', { params: { id } })
  const body = res.data || {}
  if (body.code !== 200) throw new Error(body.msg || '这张单已经不在队列里了')
  return body.data || null
}

/** 已经填进核对界面之后再标记，手滑点错不会把单弄丢 */
export async function markPickOrderUsed(id) {
  const res = await request.post('/api/pick-order/used', null, { params: { id } })
  const body = res.data || {}
  if (body.code !== 200) throw new Error(body.msg || '标记失败')
  return true
}

export async function discardPickOrder(id) {
  const res = await request.delete('/api/pick-order/discard', { params: { id } })
  const body = res.data || {}
  if (body.code !== 200) throw new Error(body.msg || '删除失败')
  return true
}
