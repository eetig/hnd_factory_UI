#!/usr/bin/env node
/*
 * 桌面版发版脚本（2026-11-11）。
 *
 * 做的事：改版本号 → 构建（含签名）→ 把 exe/更新包/latest.json 传到 MinIO。
 *
 * 用法：
 *   node scripts/publish-desktop.mjs --version 1.0.1        # 改版本并构建
 *   node scripts/publish-desktop.mjs                        # 用当前版本构建
 *   node scripts/publish-desktop.mjs --no-upload            # 只构建，不传
 *
 * 前置（一次性，别写进仓库）：
 *   1. 私钥：D:\keys\hnd-desktop.key（丢了就再也发不了更新，务必另存一份）
 *   2. 环境变量：
 *        TAURI_SIGNING_PRIVATE_KEY=D:\keys\hnd-desktop.key
 *        TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<生成时的密码>
 *   3. MinIO 客户端 mc 配好别名（示例里叫 hnd），桶 hnd-desktop 公开读：
 *        mc alias set hnd https://hbbhnd.cloud <ACCESS_KEY> <SECRET_KEY>
 *        mc anonymous set download hnd/hnd-desktop
 *
 * 为什么用 mc 而不是自己签 S3 请求：这个脚本只给一个人用，装个客户端比在仓库里
 * 塞一段 SigV4 签名代码省事；哪天换成 nginx 静态目录，把 upload() 改成 fs.copyFile 即可。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const CONF = path.join(ROOT, 'src-tauri', 'tauri.conf.json')
const PKG = path.join(ROOT, 'package.json')
const BUNDLE = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const BUCKET = 'hnd-desktop'
const MC_ALIAS = 'hnd'

const args = process.argv.slice(2)
const nextVersion = valueOf('--version')
const skipUpload = args.includes('--no-upload')

function valueOf(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : ''
}

function log(msg) {
  console.log(`[publish-desktop] ${msg}`)
}

function bumpVersion(version) {
  if (!version) return
  const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'))
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'))
  conf.version = version
  pkg.version = version
  fs.writeFileSync(CONF, `${JSON.stringify(conf, null, 2)}\n`)
  fs.writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`)
  log(`版本改为 ${version}`)
}

function build() {
  const env = { ...process.env }
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    console.error('缺少 TAURI_SIGNING_PRIVATE_KEY（私钥路径或内容），没有它打不出可更新的安装包。')
    process.exit(1)
  }
  log('开始构建（首次会编译 Rust，5–10 分钟）…')
  execFileSync('npx', ['tauri', 'build'], { cwd: ROOT, stdio: 'inherit', env, shell: true })
}

function artifacts() {
  if (!fs.existsSync(BUNDLE)) {
    console.error(`没找到构建产物目录：${BUNDLE}`)
    process.exit(1)
  }
  const files = fs.readdirSync(BUNDLE)
  const installer = files.find((f) => /_x64-setup\.exe$/.test(f))
  const sig = files.find((f) => /_x64-setup\.exe\.sig$/.test(f))
  if (!installer || !sig) {
    console.error(`产物不全：installer=${installer} sig=${sig}`)
    process.exit(1)
  }
  return [installer, sig].map((f) => path.join(BUNDLE, f))
}

/*
 * latest.json 由这里生成，不是 tauri 给的。
 *
 * tauri 只产出安装包和 .sig（签名），"去哪下、这版更新了什么"这份清单要发布方自己写。
 * 三个字段最容易写错：① version 必须和安装包里的版本一致，否则客户端会一直提示更新；
 * ② url 必须是客户端能直接 GET 的地址（这里指到 MinIO 反代目录，文件名要 URL 编码，
 *    因为安装包名带中文）；③ signature 是 .sig 文件的**全文**，不是路径。
 */
function writeLatest(version, installerPath, sigPath) {
  const latestPath = path.join(BUNDLE, 'latest.json')
  const fileName = path.basename(installerPath)
  const payload = {
    version,
    notes: process.env.DESKTOP_NOTES || '',
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: fs.readFileSync(sigPath, 'utf8').trim(),
        url: `https://hbbhnd.cloud/desktop/${encodeURIComponent(fileName)}`,
      },
    },
  }
  fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`)
  log(`latest.json：${latestPath}`)
  return latestPath
}

function upload(files) {
  const latest = files.find((f) => f.endsWith('latest.json'))
  const others = files.filter((f) => f !== latest)
  log(`上传到 ${MC_ALIAS}/${BUCKET} …`)
  try {
    // 安装包 + .sig 原样传；latest.json 必须声明 application/json，
    // 否则 Tauri 按字节流读、解析失败，表现是"永远显示已是最新"。
    execFileSync('mc', ['cp', ...others, `${MC_ALIAS}/${BUCKET}/`], { stdio: 'inherit' })
    execFileSync('mc', ['cp', '--attr', 'content-type=application/json', latest, `${MC_ALIAS}/${BUCKET}/latest.json`], {
      stdio: 'inherit',
    })
  } catch {
    console.error('上传失败。可以手工把这几个文件传到桶 hnd-desktop（latest.json 需 application/json）：')
    files.forEach((f) => console.error(`  ${f}`))
    process.exit(1)
  }
  log('完成。客户端下次启动会读到 latest.json。')
}

bumpVersion(nextVersion)
build()
const files = artifacts()
const installer = files.find((f) => f.endsWith('.exe'))
const sig = files.find((f) => f.endsWith('.sig'))
const version = JSON.parse(fs.readFileSync(CONF, 'utf8')).version
const latest = writeLatest(version, installer, sig)
files.forEach((f) => log(`产物：${f}`))
if (skipUpload) {
  log('按 --no-upload 跳过上传')
} else {
  upload([...files, latest])
}
