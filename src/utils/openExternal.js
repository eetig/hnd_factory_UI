/**
 * 打开外部链接（OA 单据、采购单…）——2026-11-17
 *
 * 为什么要单独一个函数：桌面版的页面跑在 `tauri.localhost` 里，`<a target="_blank">`
 * 会被 WebView2 拦掉，点了**一点反应都没有**（用户反馈的「点击不能跳转」就是这个）。
 * 桌面端只能通过 IPC 让 Rust 去调系统默认浏览器（命令 `open_external`）。
 *
 * 网页版照旧走 window.open；两边行为一致：点一下 → 系统默认浏览器打开。
 */

/** 当前是不是跑在桌面端（Tauri 会把内部对象挂到 window 上） */
export function isDesktopShell() {
  if (typeof window === 'undefined') return false
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)
}

/** 只放行 http/https —— 别让 `javascript:`、`file:` 这类地址混进来 */
export function isOpenableUrl(raw) {
  const url = String(raw ?? '').trim()
  if (!url) return false
  return /^https?:\/\/[^\s]+$/i.test(url)
}

/**
 * 在系统浏览器里打开一个链接。
 * @returns {Promise<boolean>} 是否真的发起了一次打开（用于给失败提示）
 */
export async function openExternal(rawUrl) {
  const url = String(rawUrl ?? '').trim()
  if (!isOpenableUrl(url)) return false

  if (isDesktopShell()) {
    try {
      // 动态 import：网页版不必把桌面端 API 打进包里
      const { invoke } = await import('@tauri-apps/api/core')
      // Rust 侧 open_external（src-tauri/src/lib.rs）：校验协议后交给系统默认浏览器
      await invoke('open_external', { url })
      return true
    } catch {
      return false
    }
  }

  const win = window.open(url, '_blank', 'noopener,noreferrer')
  return Boolean(win)
}
