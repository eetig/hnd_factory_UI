import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 护栏：`saving` 这类"composable 返回对象里的 ref"不许当成模块级具名导出 import
 * （2026-10-22，变更-150）。
 *
 * ## 为什么值得单开一条
 *
 * 同一晚踩了两次：采购看板、设备看板都写了
 * `import { savePurchase, saving } from '../../composables/useX.js'`。
 *
 * 这个错误**特别难发现**，因为两边的反应完全不同：
 *   · `vitest run`  → 绿（vite 的 ESM 转换把它当 undefined，不会报）
 *   · `vite build`  → 红（rollup 严格校验 "saving is not exported"）
 * 也就是说：**只跑测试的人永远看不到它，直到部署前的构建才炸**。
 *
 * 正确写法是 `const { saving } = useX()` —— 从返回对象里取，那才是唯一真源。
 *
 * 这条守卫扫源码，而不是靠"记得跑 build"。
 */

const SRC = path.join(process.cwd(), 'src')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|js)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 收集所有 `import { a, saving } from '<...>/useX.js'` 里的越界名字 */
function offenders() {
  const bad = []
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]*composables\/[^'"]+)['"]/g)) {
      const names = m[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0])
        .filter(Boolean)
      // 这几个 ref 在各自的 composable 里都是**返回对象**的字段，不是模块级 export
      const forbidden = names.filter((n) => ['saving', 'loading', 'uploading'].includes(n))
      if (forbidden.length) {
        bad.push(`${path.relative(SRC, file)}: import { ${forbidden.join(', ')} } from '${m[2]}'`)
      }
    }
  }
  return bad
}

describe('composable 的 saving/loading 不许当具名导出 import', () => {
  it('源码里没有这种写法（正确写法是 const { saving } = useX()）', () => {
    const bad = offenders()
    expect(
      bad,
      '这些 import 会在 vitest 里静默通过、在 vite build 时报 "not exported"。\n' +
        '改成：const { saving } = useX()\n' +
        bad.join('\n'),
    ).toEqual([])
  })
})
