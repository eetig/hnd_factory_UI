#!/usr/bin/env node
/**
 * 落地页预览图：一条命令把「截图 → webp → 替换 → 提交 →（可选）发布」做完。
 *
 * 为什么有它（2026-11-13）：换一张图手工要 30+ 分钟，真正花在图上只有 2 分钟，
 * 其余都在「PIL 转格式 / 找对文件名 / 记得提交 / 记得发布」这些碎步上。
 * 这个脚本只做碎步，截那张图仍然由 Agent 用浏览器工具拍（需要真实数据 + 登录态）。
 *
 * 用法：
 *   node scripts/apply-landing-shot.mjs <截图路径> [--deploy]
 *
 * 截图要求：1440×900（或同比例），带真实数据、桌面外壳（?desktop=1）。
 * 建议拍摄时把页面 zoom 调到 1.3 —— 落地页里这张图只显示 434px 宽，
 * 原尺寸缩下去 12px 的字会糊。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
const asset = path.join(repo, 'src/assets/landing/purchase-board.webp')

const [shot, ...flags] = process.argv.slice(2)
const deploy = flags.includes('--deploy')

if (!shot || !existsSync(shot)) {
  console.error('用法: node scripts/apply-landing-shot.mjs <截图路径> [--deploy]')
  process.exit(1)
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: repo, stdio: 'inherit', ...opts })

// 1) 转 1440×900 webp（PIL 在本机 python 里，质量 90 和现有资源一致）
const before = existsSync(asset) ? statSync(asset).size : 0
run('python', [
  '-c',
  [
    'import sys',
    'from PIL import Image',
    'src, dst = sys.argv[1], sys.argv[2]',
    'im = Image.open(src).convert("RGB").resize((1440, 900), Image.LANCZOS)',
    'im.save(dst, "WEBP", quality=90, method=6)',
    'print("  webp:", im.size)',
  ].join('\n'),
  shot,
  asset,
])

const after = statSync(asset).size
console.log(`  资源: ${path.relative(repo, asset)}  ${before} → ${after} bytes`)

// 2) 守卫测试只跑与资源相关的那几个文件（全量留给发版）
//    Windows 上直接调 node + vitest.mjs，避免 npx.cmd 需要 shell
run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit/visualTokens.spec.js'])

// 3) 提交
run('git', ['add', 'src/assets/landing/purchase-board.webp'])
try {
  run('git', ['commit', '-m', '落地页：更新采购看板预览图（真实数据、桌面外壳）'])
} catch {
  console.log('  （没有变化或提交失败，跳过提交）')
}

// 4) 可选：整站发布（会比较久：build + scp + 原子切换 + 验收）
if (deploy) {
  console.log('== 发布网页（deploy-web.ps1）')
  run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'scripts/deploy-web.ps1',
    '-SkipVerify',
  ])
  // 发布完立刻确认桌面更新通道没被抹（历史事故，见 变更-211）
  run('bash', [
    '-c',
    'curl -s -o /dev/null -w "desktop/latest.json %{http_code} %{content_type}\\n" https://hbhnd.cloud/desktop/latest.json',
  ])
} else {
  console.log('  未加 --deploy：只替换了本地资源，线上要等下次网页发布')
}

const bytes = readFileSync(asset).length
console.log(`完成：src/assets/landing/purchase-board.webp (${bytes} bytes)`)
