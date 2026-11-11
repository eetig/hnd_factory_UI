/*
 * 桌面端（Tauri）专用的小能力集合。
 *
 * 全部按「网页版里也能安全 import」来写：IS_DESKTOP 为 false 时直接返回默认值，
 * 不会去调用 Tauri 的 IPC（网页里调会抛 "__TAURI_INTERNALS__ is not defined"）。
 * 这样组件不需要到处判断环境，只在真正要用结果的地方判断。
 */
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { IS_DESKTOP } from '../api/base'

/** 当前 exe 的版本号（来自 tauri.conf.json 的 version），网页版返回空串 */
export async function desktopVersion() {
  if (!IS_DESKTOP) return ''
  try {
    return await getVersion()
  } catch {
    return ''
  }
}

/** 开机自启现在开着吗 */
export async function autostartOn() {
  if (!IS_DESKTOP) return false
  try {
    return await isEnabled()
  } catch {
    return false
  }
}

/**
 * 开/关开机自启。返回操作后的真实状态（不以入参为准 —— 注册表可能被安全软件拦下）。
 * 写的是当前用户的 Run 键，不需要管理员权限。
 */
export async function setAutostart(on) {
  if (!IS_DESKTOP) return false
  try {
    if (on) await enable()
    else await disable()
  } catch {
    // 被安全软件拦或权限不足时保持原状，由调用方提示
  }
  return autostartOn()
}

/**
 * 问一次更新服务器（https://hbhnd.cloud/desktop/latest.json）。
 * 返回 null＝已是最新；返回对象＝有新版；返回 {error}＝连不上/签名对不上。
 *
 * 为什么把错误也当返回值而不是抛出：更新检查是"锦上添花"，
 * 服务器挂了不该让整个界面弹红框，只要静默地告诉用户"暂时查不到"。
 */
export async function checkUpdate() {
  if (!IS_DESKTOP) return null
  try {
    const update = await check()
    if (!update) return null
    return { version: update.version, notes: update.body || '', date: update.date || '' }
  } catch (error) {
    return { error: String(error?.message || error) }
  }
}

/**
 * 下载并安装，装完自动重启到新版。onProgress 收到 0–1（拿不到总大小时给 null）。
 * 重启用 process 插件 —— 不用 relaunch 的话用户会同时开着新旧两个进程。
 */
export async function installUpdate(onProgress) {
  if (!IS_DESKTOP) return false
  const update = await check()
  if (!update) return false

  let total = 0
  let received = 0
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength || 0
    } else if (event.event === 'Progress') {
      received += event.data.chunkLength || 0
      onProgress?.(total ? Math.min(received / total, 1) : null)
    }
  })
  await relaunch()
  return true
}
