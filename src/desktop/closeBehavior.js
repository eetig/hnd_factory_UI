/*
 * 桌面版的关闭行为（2026-11-11，两轮）：
 *
 * 第一轮（用户要求）：点一次 ✕ 先问「退出程序 / 最小化到托盘」。
 * 第二轮（用户原话：「还是没搞懂… 记住选择，最小化到后台，点击关闭就是直接最小化，
 *   不弹出提示窗口。这个设置可在设置中修改」）：
 *   · 默认 = 直接最小化到托盘，**不弹窗**（车间电脑上这是"挂机"，多一次点击就是噪音）；
 *   · 想"每次问我"或"直接退出"，去桌面版设置面板改（src/desktop/closePreference.js）。
 *
 * 分工：
 *   · Rust 侧（src-tauri/src/lib.rs）拦下 CloseRequested 并发 `app://close-requested`；
 *   · 这里只读偏好、执行动作。改文案/加选项不用重编 Rust。
 *
 * ⚠️ 1.0.2 教训：`hide()` 和弹框的 reject 不要写在同一个 try 里 ——
 * 隐藏失败会被误判成"用户取消"而静默吞掉，表现是"点了没反应"。
 * 现在选择与执行分开，执行失败必须说出来。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/plugin-process'
import { IS_DESKTOP } from '../api/base'
import { getCloseAction } from './closePreference'

async function askChoice() {
  try {
    await ElMessageBox.confirm('退出程序，还是收到托盘继续挂着？', '关闭 HND 生产助手', {
      confirmButtonText: '最小化到托盘',
      cancelButtonText: '退出程序',
      distinguishCancelAndClose: true,
      type: 'info',
    })
    return 'hide'
  } catch (action) {
    // 点「退出程序」= cancel；点询问框右上角 ✕ = close → 什么都不做，回到原界面
    return action === 'cancel' ? 'exit' : 'none'
  }
}

/**
 * 执行"收进托盘"。失败要喊出来，否则使用者只会看到"窗口没动"。
 */
export async function hideToTray() {
  const win = getCurrentWindow()
  try {
    await win.hide()
    return true
  } catch (e) {
    ElMessage.error(`收不到托盘：${e?.message || e}`)
    return false
  }
}

export async function quitApp() {
  try {
    await exit(0)
    return true
  } catch (e) {
    ElMessage.error(`退不出去：${e?.message || e}`)
    return false
  }
}

/** 按偏好执行一次关闭。抽出来是为了能单测（不依赖 Tauri 事件）。 */
export async function performClose(action = getCloseAction()) {
  if (action === 'minimize') return hideToTray()
  if (action === 'quit') return quitApp()

  const choice = await askChoice()
  if (choice === 'hide') return hideToTray()
  if (choice === 'exit') return quitApp()
  return false
}

export async function installDesktopCloseBehavior() {
  if (!IS_DESKTOP) return
  await listen('app://close-requested', () => {
    performClose()
  })
}
