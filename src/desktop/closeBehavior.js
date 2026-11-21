/*
 * 桌面版的关闭行为（2026-11-11，两轮）：
 *
 * 第一轮（用户要求）：点一次 ✕ 先问「退出程序 / 最小化到托盘」。
 * 第二轮（用户原话：「还是没搞懂… 记住选择，最小化到后台，点击关闭就是直接最小化，
 *   不弹出提示窗口。这个设置可在设置中修改」）：
 *   · 默认 = 直接最小化到托盘，**不弹窗**（车间电脑上这是"挂机"，多一次点击就是噪音）；
 *   · 想"每次问我"或"直接退出"，去桌面版设置面板改（src/desktop/closePreference.js）。
 *
 * 第三轮（2026-11-21，1.0.44）：窗口没了但程序还在，对车间用户就是"点了没反应"。
 *   所以第一次真的收进托盘前，解释一次「收到右下角托盘了、左键点图标回来」，
 *   localStorage 记住只解释一次，之后照旧安静收起。
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

const TRAY_HINT_KEY = 'hnd-desktop-tray-hint-shown'

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

/** 托盘说明是否已经看过（读不出来就当没看过：宁可多解释一次）。 */
function trayHintShown() {
  try {
    return localStorage.getItem(TRAY_HINT_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 第一次收进托盘前解释一次。弹框被 Esc / ✕ 关掉也算看过 ——
 * 否则每次点 ✕ 都挡一层，又变成"点了没反应"。
 */
async function explainTrayOnce() {
  try {
    await ElMessageBox.alert(
      '窗口收进右下角托盘了，程序还在后台挂着。左键单击托盘图标就能把窗口叫回来；' +
        '想改成点 ✕ 直接退出，去「桌面版」设置里改。',
      '收到托盘，不是退出',
      { confirmButtonText: '知道了', type: 'info' },
    )
  } catch {
    /* 用户关掉说明框也要继续收起，不能因为关框就什么都不做 */
  } finally {
    try {
      localStorage.setItem(TRAY_HINT_KEY, '1')
    } catch {
      /* 写不进去（隐私模式）就每次都解释，不影响关闭本身 */
    }
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
  if (action === 'minimize') {
    if (!trayHintShown()) await explainTrayOnce()
    return hideToTray()
  }
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
