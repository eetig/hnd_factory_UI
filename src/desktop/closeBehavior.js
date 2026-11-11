/*
 * 桌面版的关闭行为（2026-11-11，用户要求）：
 *   点右上角 ✕ 不直接退出，先问一句"退出程序 / 最小化到托盘"。
 *   选最小化：窗口藏起来，任务栏右下角留一个小图标，点一下回来；
 *   选退出：真的结束进程（托盘图标一起消失）。
 *
 * 分工：
 *   · Rust 侧（src-tauri/src/lib.rs）在窗口收到 CloseRequested 时 prevent_close，
 *     然后 emit 一个 `app://close-requested` 事件 —— 它不自己决定退出还是隐藏；
 *   · 这个文件只负责"弹框 + 执行选择"。
 * 这样以后想换文案或加"记住我的选择"，只改这里，不用重编 Rust。
 */
import { ElMessageBox } from 'element-plus'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/plugin-process'
import { IS_DESKTOP } from '../api/base'

export async function installDesktopCloseBehavior() {
  if (!IS_DESKTOP) return

  const win = getCurrentWindow()

  await listen('app://close-requested', async () => {
    try {
      await ElMessageBox.confirm('退出程序，还是收到托盘继续挂着？', '关闭 HND 生产助手', {
        confirmButtonText: '最小化到托盘',
        cancelButtonText: '退出程序',
        distinguishCancelAndClose: true,
        type: 'info',
      })
      // 点「最小化到托盘」：藏窗口，托盘图标还在（Rust 侧建的）
      await win.hide()
    } catch (action) {
      // 点「退出程序」= cancel；点右上角 ✕ 关掉这个询问框 = 'close'，什么都不做
      if (action === 'cancel') {
        await exit(0)
      }
    }
  })
}
