/*
 * 桌面端上传 / 表单提交的 Content-Type（2026-11-17，1.0.31）
 *
 * 事故回顾：桌面端在「资料归档」里选文件上传，报
 *   Request failed with status code 415（https://hbhnd.cloud/api/archive/upload）
 * 网页版同样的操作是好的。
 *
 * 根因：axios 给 post 预置了 `Content-Type: application/x-www-form-urlencoded`；
 * 浏览器自带的 xhr adapter 遇到 FormData 会把这个头删掉，让 Request 自己写
 * `multipart/form-data; boundary=...`；而我们的 desktopAdapter 原样转发了，
 * 后端收到「声明是表单、内容却不是」的请求，直接 415。
 *
 * 这条测试就是钉住"这类请求体不带 Content-Type"，免得以后又被人加回来。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn(async () => ({
  status: 200,
  statusText: 'OK',
  headers: new Headers({ 'content-type': 'application/json' }),
  text: async () => '{"success":true}',
}))

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args) => fetchMock(...args) }))

describe('桌面端请求通道：请求体的 Content-Type', () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  it('FormData 上传时不带 Content-Type，交给 Request 自己写 boundary', async () => {
    const { desktopAdapter } = await import('../../src/api/desktopHttp')

    const form = new FormData()
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'probe.txt')

    // axios 实际就是带着这个头进来的（probe-adapter.mjs 实测）
    await desktopAdapter({
      url: '/api/archive/upload',
      baseURL: 'https://hbhnd.cloud',
      method: 'post',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      data: form,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1]
    const keys = Object.keys(init.headers).map((k) => k.toLowerCase())
    expect(keys).not.toContain('content-type')
    // 别的头要留着，不能连带删掉
    expect(keys).toContain('accept')
    // 请求体还是那个 FormData，没被序列化成字符串
    expect(init.body).toBe(form)
  })

  it('大小写不同的 Content-Type 一样会被删掉', async () => {
    const { desktopAdapter } = await import('../../src/api/desktopHttp')

    const form = new FormData()
    form.append('file', new Blob(['x']), 'a.txt')

    await desktopAdapter({
      url: '/api/x',
      baseURL: 'https://hbhnd.cloud',
      method: 'put',
      headers: { 'content-type': 'multipart/form-data', 'X-Trace': 'a' },
      data: form,
    })

    const keys = Object.keys(fetchMock.mock.calls[0][1].headers).map((k) => k.toLowerCase())
    expect(keys).not.toContain('content-type')
    expect(keys).toContain('x-trace')
  })

  it('普通 JSON 提交仍然带 application/json（别把这条修坏了）', async () => {
    const { desktopAdapter } = await import('../../src/api/desktopHttp')

    await desktopAdapter({
      url: '/api/archive/save',
      baseURL: 'https://hbhnd.cloud',
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      data: '{"a":1}',
    })

    const headers = fetchMock.mock.calls[0][1].headers
    const hit = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')
    expect(hit && hit[1]).toBe('application/json')
  })
})
