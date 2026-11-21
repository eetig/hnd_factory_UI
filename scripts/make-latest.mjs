#!/usr/bin/env node
/*
 * 生成 Tauri 更新清单 latest.json。
 *
 * 为什么单独抽出来：2026-11-21 踩过一次 —— publish_desktop.sh 原样把
 * bundle/nsis/latest.json 传上去，没人重新生成，结果 1.0.44 的安装包配着
 * 1.0.43 的清单上线，客户端一直显示"已是最新"（exe 明明换了）。
 * 现在发版脚本每次都会先跑这个，版本对不上直接停。
 *
 * 用法：node scripts/make-latest.mjs <version> [notes]
 *   notes 也可以用环境变量 DESKTOP_NOTES 传。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const BUNDLE = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')

const version = process.argv[2]
const notes = process.argv[3] || process.env.DESKTOP_NOTES || ''

if (!version) {
  console.error('用法：node scripts/make-latest.mjs <version> [notes]')
  process.exit(1)
}

const exe = `HND生产助手_${version}_x64-setup.exe`
const exePath = path.join(BUNDLE, exe)
const sigPath = `${exePath}.sig`

if (!fs.existsSync(exePath)) {
  console.error(`缺少安装包：${exePath}`)
  process.exit(1)
}
if (!fs.existsSync(sigPath)) {
  console.error(`缺少签名：${sigPath}（构建时没设 TAURI_SIGNING_PRIVATE_KEY？）`)
  process.exit(1)
}

const payload = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      // signature 必须是 .sig 的全文，不是路径
      signature: fs.readFileSync(sigPath, 'utf8').trim(),
      // 安装包名带中文，url 必须 URL 编码
      url: `https://hbhnd.cloud/desktop/${encodeURIComponent(exe)}`,
    },
  },
}

const latest = path.join(BUNDLE, 'latest.json')
// 不带 BOM、LF 结尾：Tauri 按 application/json 解析，BOM 会让它读不出来
fs.writeFileSync(latest, `${JSON.stringify(payload, null, 2)}\n`)

console.log(`latest.json → ${version}（${fs.statSync(latest).size} bytes）`)
