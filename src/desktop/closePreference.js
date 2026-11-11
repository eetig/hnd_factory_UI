/*
 * 「点关闭时做什么」这条偏好（2026-11-11，第二轮）。
 *
 * 使用方的原话：「记住选择，最小化到后台，点击关闭就是直接最小化，不弹出提示窗口。
 * 这个设置可在设置中修改。」
 *
 * 所以默认值就是 minimize —— 点 ✕ 直接收进托盘，不问。想改成"每次问"或"直接退出"，
 * 去桌面版设置面板里改（桌面版 → 关闭按钮）。
 *
 * 存在 localStorage：这是每台机器、每个 Windows 账户自己的习惯，不该跟服务器同步，
 * 也不该被"换个人登录"带走。桌面版的页面来源固定（tauri.localhost），存储不会串。
 */
const KEY = 'hnd-desktop-close-action'

export const CLOSE_ACTIONS = [
  { value: 'minimize', label: '最小化到托盘', hint: '点 ✕ 直接收起，不弹窗（默认）' },
  { value: 'quit', label: '直接退出', hint: '点 ✕ 立刻结束程序' },
  { value: 'ask', label: '每次问我', hint: '点 ✕ 弹出「退出 / 最小化」' },
]

const VALID = CLOSE_ACTIONS.map((item) => item.value)

export function getCloseAction() {
  try {
    const saved = localStorage.getItem(KEY)
    return VALID.includes(saved) ? saved : 'minimize'
  } catch {
    // 隐私模式/存储被禁时不要因此打不开窗口
    return 'minimize'
  }
}

export function setCloseAction(value) {
  const next = VALID.includes(value) ? value : 'minimize'
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // 存不进去也不影响本次选择生效
  }
  return next
}
