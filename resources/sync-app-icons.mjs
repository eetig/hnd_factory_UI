/**
 * 把 App 图标同步进 App 构建产物。
 *
 * 为什么需要这一步：
 *   manifest.json 里 app-plus.distribute.icons 写的是相对路径（resources/icons/…），
 *   而 uni-app 的 App 构建**不会**把项目根目录下的 resources/ 复制进 dist/build/app。
 *   打包时 HBuilderX 导入的正是 dist/build/app 这个目录，图标不在那里就会指空。
 *
 * 为什么不干脆把图标放进 src/static/：
 *   static/ 会被打进每一个端的包体。小程序主包已经逼近 2MB 上限，
 *   再塞进 1MB 多的图标直接超限；而 App 图标本来就是原生打包用的，与包体无关。
 *
 * 用法：由 package.json 的 build:app / dev:app 自动调用，一般不用手跑。
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const srcIcons = join(here, 'icons')

const target = process.argv[2] || 'build'
const outDir = join(repoRoot, 'dist', target, 'app')

if (!existsSync(outDir)) {
  console.error(`[sync-app-icons] 构建产物不存在，跳过：${outDir}`)
  process.exit(0)
}

if (!existsSync(srcIcons)) {
  console.error(`[sync-app-icons] 图标目录不存在：${srcIcons}`)
  console.error('  先运行 python resources/generate-icons.py 生成')
  process.exit(1)
}

const dest = join(outDir, 'resources', 'icons')
rmSync(dest, { recursive: true, force: true })
mkdirSync(dirname(dest), { recursive: true })
cpSync(srcIcons, dest, { recursive: true })

console.log(`[sync-app-icons] 已同步图标 → ${dest}`)
