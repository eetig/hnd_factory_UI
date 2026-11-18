#!/usr/bin/env node
/**
 * 手机 App「打包好就自动上线」（2026-11-17，使用方定的口径：全自动 + 硬拦截）。
 *
 * 谁在盯：Windows 计划任务 `HND-app-auto-publish`，每分钟跑一次这个脚本。
 *   为什么不挂在会话里：2026-11-17 那次就是脚本随会话消失，包落地了没人发，
 *   最后手动补的。计划任务开机就在，不依赖任何人开着窗口。
 *
 * 干三件事：
 *   1. 看 dist/release/apk 里最新那个包，是不是比线上新；
 *   2. 过三道守卫 —— 包必须是"写完的"、版本号必须比线上大（忘了改就拦住不发）、
 *      体积像话；
 *   3. 都过了就跑 publish_app.sh 上传，然后把线上 latest.json 拉回来核对一遍。
 *
 * 提示口径（使用方选的 ②b）：
 *   · 发布成功 —— 不打扰，只写日志；用手机的人在 App 里看到红点就够了；
 *   · 被拦住 / 发失败 —— 弹一条 Windows 通知，否则"没发出去"这件事会静默消失。
 *
 * 手动用法：
 *   node scripts/auto-publish-app.mjs            # 跑一次（计划任务就是这样调的）
 *   node scripts/auto-publish-app.mjs --dry-run  # 只判断、不上传，看它会做什么
 *   node scripts/auto-publish-app.mjs --force    # 忽略"版本没变"，强制重发（排障用）
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
const apkDir = path.resolve(repo, '../hnd_factory_UI_uni_APP/dist/release/apk')
const manifestPath = path.resolve(repo, '../hnd_factory_UI_uni_APP/src/manifest.json')
const stateDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'hnd-app-publish')
const statePath = path.join(stateDir, 'state.json')
const logPath = path.join(repo, 'logs', 'app-publish.log')
const liveUrl = 'https://hbhnd.cloud/desktop/app/latest.json'
const GIT_BASH = 'C:/Program Files/Git/bin/bash.exe'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')

function log(msg) {
  // 用本机时间（toISOString 是 UTC，日志里看起来会"早了 8 小时"，排障时容易误判）
  const line = `[${new Date().toLocaleString('sv-SE')}] ${msg}`
  console.log(line)
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, line + '\n')
  } catch {
    /* 日志写不了也不影响正事 */
  }
}

/** Windows 通知：只在"该人知道"的时候弹（被拦/失败）。WinRT，不需要装模块。 */
function notify(title, body) {
  if (dryRun) return
  const ps = `
$ErrorActionPreference='Stop'
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null
  $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $n = $t.GetElementsByTagName('text')
  $n.Item(0).AppendChild($t.CreateTextNode('${title.replace(/'/g, "''")}')) | Out-Null
  $n.Item(1).AppendChild($t.CreateTextNode('${body.replace(/'/g, "''")}')) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($t)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('HND 发布').Show($toast)
} catch { }
`
  spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true })
}

function readManifest() {
  let raw = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')
  raw = raw.replace(/^\s*\/\/.*$/gm, '') // manifest 首行有注释
  return JSON.parse(raw)
}

/** 文件名里的时间戳：__UNI__xxxx__20261117095256.apk */
function stampOf(fileName) {
  const m = /__(\d{14})\.apk$/.exec(fileName || '')
  return m ? m[1] : ''
}

async function fetchLive() {
  const res = await fetch(`${liveUrl}?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`latest.json HTTP ${res.status}`)
  return res.json()
}

function newestApk() {
  if (!fs.existsSync(apkDir)) return null
  const files = fs
    .readdirSync(apkDir)
    .filter((f) => f.toLowerCase().endsWith('.apk'))
    .map((f) => {
      const full = path.join(apkDir, f)
      const stat = fs.statSync(full)
      return { name: f, full, size: stat.size, mtimeMs: stat.mtimeMs, stamp: stampOf(f) }
    })
    .filter((f) => f.stamp)
  if (!files.length) return null
  files.sort((a, b) => (a.stamp < b.stamp ? 1 : -1))
  return files[0]
}

function readState() {  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(next) {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify(next, null, 2))
  } catch {
    /* 状态写不了就退化成"每次都判断"，不影响正确性 */
  }
}

/*
 * 并发锁：计划任务是 1 分钟一跑，而一次上传要 30~40 秒，很容易两轮撞在一起
 * 同时往服务器塞同一个包。锁只防重复上传，不参与业务判断。
 */
const lockPath = path.join(stateDir, 'publish.lock')
const LOCK_TTL_MS = 5 * 60_000

function acquireLock() {
  try {
    const stat = fs.statSync(lockPath)
    if (Date.now() - stat.mtimeMs < LOCK_TTL_MS) return false
  } catch {
    /* 没有锁文件 = 可以上 */
  }
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(lockPath, String(process.pid))
  } catch {
    /* 写不了锁就别拦着自己 */
  }
  return true
}

function releaseLock() {
  try {
    fs.unlinkSync(lockPath)
  } catch {
    /* 锁已经没了 */
  }
}

function block(reason, detail, file) {
  log(`⛔ 没发：${reason}${detail ? `（${detail}）` : ''}`)
  /*
   * 同一件事只提醒一次（2026-11-18）。
   *
   * 任务 1 分钟一跑，被拦下的包会一直躺在打包目录里 —— 不记住"已经提醒过这个包"，
   * 用户就每分钟收到一条一模一样的系统通知（真实案例：连打两个 1.0.7 的包，
   * 第二个因版本号没涨被拒收，之后每分钟弹一次，桌面右下角堆了 7 条）。
   *
   * 记住包名而不是只记原因：换了新包（哪怕原因相同）说明用户又动手了，值得再提醒一次。
   */
  const prev = readState()
  const already = prev.lastBlocked?.file === file && prev.lastBlocked?.reason === reason
  if (already) log('（同一个包已经提醒过，这次只记日志）')
  else notify('手机端没有自动发布', `${reason}${detail ? `：${detail}` : ''}`)
  writeState({ ...prev, lastBlocked: { at: Date.now(), reason, file } })
  process.exit(0)
}

async function main() {
  const apk = newestApk()
  if (!apk) {
    log('没找到可用的 apk（目录为空或文件名没有时间戳），跳过')
    return
  }

  // 守卫 1：包必须是"写完的"。云打包先写临时文件再改名，1 分钟一跑很容易撞上 20% 的半包。
  const ageSec = (Date.now() - apk.mtimeMs) / 1000
  if (ageSec < 60) {
    log(`包刚落地 ${Math.round(ageSec)}s，等它写完（<60s 不碰）`)
    return
  }

  // 守卫 2：体积像话（正常 14~16MB；几百 KB 说明是坏包/空包）
  if (apk.size < 5 * 1024 * 1024) block('包太小，像坏包', `${apk.name} ${apk.size} 字节`, apk.name)

  const manifest = readManifest()
  const manifestCode = parseInt(manifest.versionCode, 10) || 0
  const manifestName = String(manifest.versionName || '')

  let live = null
  try {
    live = await fetchLive()
  } catch (error) {
    log(`拉线上 latest.json 失败（${error.message}），这次先不动，等下一分钟`)
    return
  }
  const liveCode = parseInt(live?.versionCode, 10) || 0
  const liveStamp = stampOf(live?.fileName)

  // 没有新包：安静退出（每分钟都会走到这里，不能刷日志刷到满）
  if (!force && liveStamp && apk.stamp <= liveStamp) {
    return
  }

  // 守卫 3：版本号必须比线上大 —— 忘了改版本号是这条链路最容易犯的错，
  // 上传了也等于没发（服务器版本号没变，手机永远收不到更新）。
  if (!force && manifestCode <= liveCode) {
    block(
      '版本号没改',
      `线上 ${live.version}(${liveCode}) / manifest ${manifestName}(${manifestCode})，请先改 versionName/versionCode`,
      apk.name,
    )
  }
  if (!manifestName) block('manifest 里没有 versionName', '', apk.name)

  log(
    `准备发布 ${apk.name}（${(apk.size / 1048576).toFixed(1)} MB）` +
      ` → v${manifestName}(${manifestCode})，线上 v${live?.version}(${liveCode})${force ? ' [force]' : ''}`,
  )
  if (dryRun) {
    log('--dry-run：到此为止，没有上传')
    return
  }

  if (!acquireLock()) {
    log('上一轮还在上传中（锁未释放），这轮跳过')
    return
  }
  try {
    await publishAndVerify(apk, manifestName, manifestCode)
  } finally {
    releaseLock()
  }
}

async function publishAndVerify(apk, manifestName, manifestCode) {
  const run = spawnSync(GIT_BASH, ['scripts/publish_app.sh'], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true, // 子进程不要再开一个控制台窗口
  })
  if (run.status !== 0) {
    log(`publish_app.sh 失败（exit ${run.status}）`)
    log((run.stderr || run.stdout || '').slice(-1200))
    notify('手机端发布失败', `publish_app.sh 退出码 ${run.status}，看 logs/app-publish.log`)
    process.exit(0)
  }

  // 收尾核对：别信"脚本跑完了"，去线上读一遍，号码对不上就当没发
  let after = null
  for (let i = 0; i < 5 && !after; i += 1) {
    try {
      after = await fetchLive()
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (parseInt(after?.versionCode, 10) !== manifestCode) {
    log(`⚠ 上传完成但线上号码不对：线上 ${after?.version}(${after?.versionCode})，期望 ${manifestName}(${manifestCode})`)
    notify('手机端发布可能没生效', `线上仍是 ${after?.version}，请查 logs/app-publish.log`)
    process.exit(0)
  }

  writeState({ lastPublished: { at: Date.now(), version: manifestName, versionCode: manifestCode, file: apk.name } })
  log(`✅ 已上线：手机端 v${after.version} · ${after.sizeText} · ${apk.name}`)
}

main().catch((error) => {
  log(`脚本异常：${error?.stack || error}`)
  notify('手机端自动发布出错', String(error?.message || error))
})
