// 打包环境自检：确认产物里没有内联「开发机的局域网地址」，并且已切到线上域名。
//
// 为什么需要这道闸：
//   src/api/env.js 的 API_ORIGIN 是**构建期内联的常量**，改后端 / 改 hosts / 重装 App 都无效；
//   打错一次环境，包就是错的，而且症状是「装得上、打得开、就是连不上后端」，现场极难判断。
//   已经真实踩过一次，复盘见 `UNIAPP迁移说明.md` 第 10.5 节。
//
// 为什么扫四个产物、而不是只扫一个：
//   真正装到手机上的是 dist/release/apk/*.apk，热更新用 dist/cache/wgt，
//   dist/build/app 只是「编译结果」。只查 dist/build/app 会出现
//   「检查通过、但错包照样发出去」—— 这正是上一版检查的漏洞。
//
// 用法：
//   npm run check:app-env      独立复验（装上手机前最后一道闸）
//   npm run build:app          构建后自动跑（见 package.json）
//
// 退出码：0 = 通过；1 = remote 环境下产物里仍有私网地址或缺线上域名；2 = 脚本自身出错。

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { APP_ENV, ACTIVE_ENV } from '../src/api/env.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const rel = (p) => relative(ROOT, p).split(sep).join('/')

// RFC1918 私网地址：产物里出现即说明开发机地址被内联进去了
const LAN_RE =
  /(?<![0-9.])(?:10[.][0-9]{1,3}|172[.](?:1[6-9]|2[0-9]|3[01])|192[.]168)[.][0-9]{1,3}[.][0-9]{1,3}(?![0-9])/g

const isRemote = APP_ENV === 'remote'
const expectedHost = ACTIVE_ENV.apiOrigin ? new URL(ACTIVE_ENV.apiOrigin).hostname : ''

function walk(dir, hit) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, hit))
    else if (hit(e.name)) out.push(p)
  }
  return out
}

async function readApk(file) {
  const zip = await JSZip.loadAsync(readFileSync(file))
  const names = Object.keys(zip.files).filter((n) => n.endsWith('www/app-service.js'))
  const parts = []
  for (const n of names) parts.push(await zip.files[n].async('string'))
  return parts.join('\u000a')
}

function collect() {
  const list = []
  const fileCase = (label, file) => {
    if (existsSync(file)) list.push({ label, file, text: readFileSync(file, 'utf8') })
    else list.push({ label, file, text: null })
  }
  fileCase('App 产物', join(ROOT, 'dist/build/app/app-service.js'))
  fileCase('App-Plus 产物', join(ROOT, 'dist/build/app-plus/app-service.js'))
  for (const f of walk(join(ROOT, 'dist/cache/wgt'), (n) => n === 'app-service.js')) fileCase('wgt 缓存', f)
  return { list, apkDir: join(ROOT, 'dist/release/apk') }
}

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n)

async function main() {
  const fresh = join(ROOT, 'dist/build/app/app-service.js')
  const freshTime = existsSync(fresh) ? statSync(fresh).mtimeMs : 0

  const { list, apkDir } = collect()
  for (const f of walk(apkDir, (n) => n.endsWith('.apk'))) {
    list.push({ label: 'APK', file: f, text: await readApk(f) })
  }

  const lines = []
  const bad = []
  const warn = []

  lines.push('──── 打包环境自检 ────')
  lines.push('当前 APP_ENV = ' + APP_ENV + '    生效预设 = ' + ACTIVE_ENV.label)
  lines.push('期望域名 = ' + (expectedHost || '(空)') + '    禁止出现 = RFC1918 私网地址（10.x / 172.16-31.x / 192.168.x）')
  lines.push('')

  for (const c of list) {
    const shown = rel(c.file)
    if (c.text === null) {
      lines.push('  – ' + pad(c.label, 14) + shown + '   （未找到，跳过）')
      continue
    }
    const ips = [...new Set(c.text.match(LAN_RE) || [])]
    const hasHost = expectedHost ? c.text.includes(expectedHost) : true
    const ok = ips.length === 0 && (!isRemote || hasHost)
    lines.push((ok ? '  ✔ ' : (isRemote ? '  ✘ ' : '  ! ')) + pad(c.label, 14) + shown)
    lines.push('      私网地址: ' + (ips.length ? ips.join(', ') : '无') + '        线上域名: ' + (expectedHost ? (hasHost ? '命中' : '缺失') : '不适用'))

    if (ips.length && !isRemote) warn.push(shown)
    if (isRemote && (ips.length || (expectedHost && !hasHost)) && !bad.includes(shown)) bad.push(shown)

    if (c.label === 'APK' || c.label === 'wgt 缓存') {
      if (freshTime && statSync(c.file).mtimeMs < freshTime) {
        lines.push('      ! 该产物比本次编译结果旧：它不是刚打出来的')
      }
    }
  }

  lines.push('')
  if (!isRemote) {
    lines.push('! APP_ENV = local（本机联调）：产物里内联开发机地址是预期行为，')
    lines.push('  但这个包只能自己联调用，不能发给别人、更不能上架。')
    if (warn.length) lines.push('  含私网地址的产物：' + warn.join(' / '))
  } else if (bad.length) {
    lines.push('❌ 打包环境自检未通过：' + bad.length + ' 个产物里仍是开发机地址或缺线上域名。')
    lines.push('   原因：API_ORIGIN 是构建期内联的常量 —— 改后端、改 hosts、重装 App 都无效，')
    lines.push('         只有「用 APP_ENV=remote 重新编译 + 重新打包」才能真正修好。')
    lines.push('   修法：')
    lines.push('     1) 删掉 dist（至少删 dist/build、dist/cache/wgt、dist/release/apk）')
    lines.push('     2) npm run build:app        （构建后会自动再跑本自检）')
    lines.push('     3) HBuilderX → 发行 → 原生App-云打包，重新打 APK（CLI 不能打 APK）')
    lines.push('     4) npm run check:app-env    （装上手机前的最后一道闸）')
    lines.push('   涉及产物：' + bad.join(' / '))
  } else {
    lines.push('✅ 通过：所有产物都不含开发机地址，且带线上域名。')
  }

  for (const l of lines) console.log(l)
  process.exit(isRemote && bad.length ? 1 : 0)
}

main().catch((e) => {
  console.error('打包环境自检自身出错：' + (e && e.stack ? e.stack : e))
  process.exit(2)
})