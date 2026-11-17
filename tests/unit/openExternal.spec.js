/**
 * 「在 OA 里打开」的护栏（2026-11-17）
 *
 * 用户反馈：桌面版点这张单右上角的「在 OA 里打开」，没有任何反应 ——
 * 因为桌面页面在 tauri.localhost 里，`<a target="_blank">` 被 WebView2 拦掉了。
 * 修法是全部走 src/utils/openExternal.js：桌面端 IPC 给 Rust 打开，网页端 window.open。
 *
 * 这几条测试钉住三件事：
 *   1. 只放行 http/https（防止 javascript:/file: 混进来）；
 *   2. 网页端走 window.open，地址不合法时**不开**窗口；
 *   3. 桌面端走 Rust 命令 `open_external`，不再依赖 target="_blank"。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDesktopShell, isOpenableUrl, openExternal } from '../../src/utils/openExternal'

describe('openExternal', () => {
  const originalOpen = window.open

  beforeEach(() => {
    delete window.__TAURI_INTERNALS__
    window.open = vi.fn(() => ({}))
  })

  afterEach(() => {
    window.open = originalOpen
    delete window.__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  it('只认 http/https', () => {
    expect(isOpenableUrl('https://ekp.batt.cn/km/review/x')).toBe(true)
    expect(isOpenableUrl('http://192.168.1.9:8080/a')).toBe(true)
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false)
    expect(isOpenableUrl('file:///C:/a.txt')).toBe(false)
    expect(isOpenableUrl('   ')).toBe(false)
    expect(isOpenableUrl(undefined)).toBe(false)
  })

  it('网页端：合法链接用 window.open 打开新页', async () => {
    expect(isDesktopShell()).toBe(false)
    const ok = await openExternal('https://ekp.batt.cn/km/review/x')
    expect(ok).toBe(true)
    expect(window.open).toHaveBeenCalledWith(
      'https://ekp.batt.cn/km/review/x',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('网页端：非法链接一个窗口都不开', async () => {
    const ok = await openExternal('javascript:alert(1)')
    expect(ok).toBe(false)
    expect(window.open).not.toHaveBeenCalled()
  })

  it('桌面端：走 Rust 的 open_external 命令', async () => {
    window.__TAURI_INTERNALS__ = { invoke: () => {} }
    expect(isDesktopShell()).toBe(true)
    const invoke = vi.fn(async () => null)
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    const ok = await openExternal('https://ekp.batt.cn/km/review/x')
    expect(ok).toBe(true)
    expect(invoke).toHaveBeenCalledWith('open_external', { url: 'https://ekp.batt.cn/km/review/x' })
    // 桌面端不应该再走 window.open（那条路被 WebView2 拦掉）
    expect(window.open).not.toHaveBeenCalled()
  })
})
