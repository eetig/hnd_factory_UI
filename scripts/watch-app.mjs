#!/usr/bin/env node
/**
 * 看门 APK：HBuilderX 云打包是「排队—打包—落地」，落地才知道文件名。
 * 这个脚本干一件事：盯着 dist/release/apk，一旦出现比上次发布更新的包，
 * 就自动跑 publish_app.sh（挑包 → 上传 → 写「最新版」别名 → 自检），
 * 然后把结果写进日志，人只需要去首页点下载。
 *
 * 用法：
 *   node scripts/watch-app.mjs                  # 默认最多盯 45 分钟，20 秒看一次
 *   node scripts/watch-app.mjs --minutes 90
 *
 * 判定「新包」：文件名里的时间戳（20261112105202）比基线大，且大小连续两次一致
 * （云打包是先写临时文件再改名，大小不稳的时候不碰它）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
const apkDir = path.resolve(repo, '../hnd_factory_UI_uni_APP/dist/release/apk')
const manifestPath = path.resolve(repo, '../hnd_factory_UI_uni_APP/src/manifest.json')
const logPath = path.join(os.tmpdir(), 'hnd-watch-app.log')

const args = process.argv.slice(2)
const minutesArg = args.indexOf('--minutes')
const minutes = minutesArg >= 0 ? Number(args[minutesArg + 1]) || 45 : 45
const INTERVAL_MS = 20_000
const DEADLINE = Date.now() + minutes * 60_000

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`
  console.log(line)
  try {
    fs.appendFileSync(logPath, line + '\n')
  } catch {
    /* 日志写不了也不影响正事 */
  }
}

/** 文件名里的时间戳就是 HBuilderX 的打包完成时间，比 mtime 可靠 */
function stampOf(file) {
  const m = file.match(/__(\d{14})\.apk$/)
  return m ? m[1] : '0'
}

function listApks() {
  if (!fs.existsSync(apkDir)) return []
  return fs
    .readdirSync(apkDir)
    .filter((f) => f.endsWith('.apk'))
    .map((f) => {
      const full = path.join(apkDir, f)
      return { file: f, full, stamp: stampOf(f), size: fs.statSync(full).size }
    })
    .sort((a, b) => a.stamp.localeCompare(b.stamp))
}

function newest() {
  const all = listApks()
  return all.length ? all[all.length - 1] : null
}

function appVersion() {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).versionName || '未知'
  } catch {
    return '未知'
  }
}

function publish(apk) {
  log(`发现新包 ${apk.file}（${apk.size} bytes），开始上传…`)
  const out = execFileSync('bash', ['scripts/publish_app.sh'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  log(out.trim().split('\n').slice(-6).join(' | '))
  return out
}

const base = newest()
if (!base) {
  log(`目录里没有 apk：${apkDir}`)
  process.exit(2)
}
log(`基线 ${base.file}（stamp=${base.stamp}），App 版本 ${appVersion()}；最多盯 ${minutes} 分钟`)

let lastSeen = null
let lastSize = -1

const timer = setInterval(() => {
  if (Date.now() > DEADLINE) {
    log('超时退出，没等到新包')
    clearInterval(timer)
    process.exit(3)
  }
  const cur = newest()
  if (!cur || cur.stamp <= base.stamp) return

  // 大小连续两次一致才动，避免抓到还没写完的文件
  if (cur.file !== lastSeen || cur.size !== lastSize) {
    lastSeen = cur.file
    lastSize = cur.size
    log(`候选 ${cur.file}（${cur.size} bytes），等一次确认`)
    return
  }

  clearInterval(timer)
  try {
    publish(cur)
    log(`✅ 已发布：${cur.file}（App ${appVersion()}）—— 首页「下载 Android 版」现在就是这个包`)
    process.exit(0)
  } catch (err) {
    log(`❌ 上传失败：${err?.message || err}`)
    process.exit(1)
  }
}, INTERVAL_MS)
