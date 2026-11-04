#!/usr/bin/env node
// 给 esbuild 打小补丁：不让它把大 payload 写成临时文件（2026-11-04）
//
// ── 症状 ────────────────────────────────────────────────────────────────
// 只有 app-plus 构建失败，h5 / 小程序都正常：
//   [vite:esbuild-transpile] remove C:\...\Temp\esbuild-<hash>: Access is denied
// 退出火绒、换临时目录（C → D）、清残留文件，全都无效。
//
// ── 原因 ────────────────────────────────────────────────────────────────
// esbuild 的 JS 侧有一条捷径：输入超过 1 MB 时，先把内容写进系统临时目录，
// 再让 Go 端读那个文件、读完删除：
//   if (input.length > 1024 * 1024) { start = () => fs3.writeFile(input, next) }
// app-plus 的单个 chunk 有几 MB ⇒ 必然走这条路 ⇒ 删除那一瞬间被 Windows 拒绝。
// h5 的 chunk 都在 1 MB 以下 ⇒ 从不产生临时文件 ⇒ 一直正常。
//
// ⚠️ 真正被用到的是 **vite 自己内嵌的那份** esbuild
//    （node_modules/vite/node_modules/esbuild），不是根目录那份。
//    第一次我只补了根目录，构建照样失败 —— 这是踩过的坑，所以本脚本会把
//    所有 esbuild 副本一起扫、一起补。
//
// ── 改法 ────────────────────────────────────────────────────────────────
// 阈值 1 MB → 64 MB：内容直接走 stdin（异步协议是 socket，没有这个限制），
// 从此不产生临时文件，也就不存在"删不掉"。
//
// 挂在 package.json 的 postinstall 上：重新 npm install 之后会自动再打一次。
// 之所以不改依赖版本：项目锁在 esbuild 0.20.x（vite 5 要 ^0.20），
// 本机升级跑不通（Node 24 + 内网源）。

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(ROOT, '..')
const NM = join(APP_ROOT, 'node_modules')

const ORIGINAL = 'input.length > 1024 * 1024'
const PATCHED = 'input.length > 64 * 1024 * 1024'

/** 递归找出所有 esbuild/lib/main.js（含 vite 内嵌的那份） */
function findEsbuildMains() {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 6 || !existsSync(dir)) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const p = join(dir, entry.name)
      if (entry.name === 'esbuild') {
        const main = join(p, 'lib', 'main.js')
        if (existsSync(main)) out.push(main)
      }
      // 只往 node_modules / @scope 里钻，避免把整个项目走一遍
      if (entry.name === 'node_modules' || entry.name.startsWith('@') || entry.name === 'vite') {
        walk(p, depth + 1)
      }
    }
  }
  walk(NM, 0)
  return [...new Set(out)]
}

let patched = 0
let skipped = 0

for (const main of findEsbuildMains()) {
  let code
  try {
    code = readFileSync(main, 'utf8')
  } catch {
    continue
  }
  const where = main.split(sep).slice(-4).join('/')
  if (code.includes(PATCHED)) {
    skipped += 1
    console.log(`[patch-esbuild] 已是最新：${where}`)
    continue
  }
  if (!code.includes(ORIGINAL)) {
    console.log(`[patch-esbuild] 版本不同，跳过：${where}`)
    continue
  }
  writeFileSync(main, code.replace(ORIGINAL, PATCHED))
  patched += 1
  console.log(`[patch-esbuild] 已补：${where}（1 MB → 64 MB，不再写临时文件）`)
}

console.log(`[patch-esbuild] 完成：新补 ${patched} 个，已是 ${skipped} 个`)
