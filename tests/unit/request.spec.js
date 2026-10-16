import { describe, it, expect, vi } from 'vitest'

// 这两个模块在 request.js 里被 import，但本测试不需要它们的真实实现
// （router 会连带拉进视图组件、auth 依赖 localStorage）
vi.mock('../../src/router', () => ({
  default: { currentRoute: { value: { path: '/equipment' } }, replace: vi.fn() },
}))
vi.mock('../../src/api/auth', () => ({ getToken: () => 'tok', clearAuth: vi.fn() }))

const { default: request } = await import('../../src/api/request')

/** 直接取响应拦截器的成功分支 —— axios 把拦截器挂在 handlers 上 */
function fulfil(response) {
  const handler = request.interceptors.response.handlers.find((h) => h && h.fulfilled)
  return handler.fulfilled(response)
}

/**
 * 响应拦截器：业务失败必须变成 Promise 拒绝（变更-085）。
 *
 * 为什么值得单测：后端把**业务失败也发成 HTTP 200**（统一返回体
 * `Result{code,msg,data,success}`），前端原先在成功分支原样放行 ——
 * 于是「保存被拒」在界面上表现为**弹窗关闭、毫无提示**，使用者以为存进去了。
 * 2026-10-16 使用方就是这么被坑的（台账 92 行的位号/车间都是空串，被后端逐行拒掉）。
 */
describe('request 响应拦截器：success:false 必须当失败', () => {
  it('业务失败 → 拒绝，并带上后端的原话', async () => {
    const body = { code: 500, msg: '设备位号不能为空', data: null, success: false }
    await expect(fulfil({ status: 200, data: body })).rejects.toThrow('设备位号不能为空')
  })

  it('拒绝出来的错误仍然能按 e.response.data.msg 读（调用方现有写法不变）', async () => {
    const body = { code: 500, msg: '设备名称不能为空', data: null, success: false }
    await expect(fulfil({ status: 200, data: body })).rejects.toMatchObject({
      response: { data: { msg: '设备名称不能为空' } },
      businessError: true,
    })
  })

  it('没有 msg 时给一句兜底文案，而不是空错误', async () => {
    await expect(fulfil({ status: 200, data: { success: false } })).rejects.toThrow('操作失败')
  })

  it('成功响应原样放行', () => {
    const response = { status: 200, data: { code: 200, msg: 'success', data: 680, success: true } }
    expect(fulfil(response)).toBe(response)
  })

  it('非 Result 形状（blob / 字符串 / 没有 success 字段）一律不受影响', () => {
    for (const data of [new Blob(['x']), 'plain text', { foo: 1 }, null, undefined]) {
      const response = { status: 200, data }
      expect(fulfil(response)).toBe(response)
    }
  })
})
