import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 抽屉/对话框必须挂到 body（2026-10-22，变更-141）。
 *
 * ## 那次事故
 *
 * 使用方截图：「新增需求被上面挡住了」—— 打开采购需求的抽屉后，抽屉顶部的标题
 * （新增采购需求）和下面一截表单被**页面头卡**盖住，标题只剩半行。
 *
 * 根因不是 z-index 数值不够，而是**层叠上下文**：抽屉的遮罩 z-index 是 2008，
 * 但它被渲染在 `.page-mount`（一个 overflow:auto 的容器）里面，而页头卡片在
 * **另一个兄弟容器**里、那层自己有更高的层叠层级。于是 2008 只在它自己那一层里算数，
 * 整块抽屉被页头压住。
 *
 * `append-to-body` 把遮罩 teleport 到 <body>，彻底跳出那层上下文 —— 这也是本仓
 * 所有 el-dialog 一直在用的写法（ProductSelectDialog / WorkOrderDetailDialog / …）。
 * 三个抽屉当时漏了，且只有"页面头卡比较高 + 抽屉开在滚动容器里"时才看得出来。
 *
 * ## 这条测试钉什么
 *
 * 任何 `.vue` 里出现 `<el-drawer>`，它的开标签内必须有 `append-to-body`。
 * 加回来一个漏写的抽屉，这条会立刻红 —— 不用等到有人截图来报。
 */

const SRC = join(process.cwd(), 'src')

function vueFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      vueFiles(full, out)
    } else if (entry.endsWith('.vue')) {
      out.push(full)
    }
  }
  return out
}

/** 取出每个 <el-drawer ...> 开标签（到第一个 `>`），连同它所在的行号 */
function drawerTags(text) {
  const tags = []
  const pattern = /<el-drawer\b[^>]*>/g
  let match = pattern.exec(text)
  while (match) {
    const line = text.slice(0, match.index).split('\n').length
    tags.push({ tag: match[0], line })
    match = pattern.exec(text)
  }
  return tags
}

describe('抽屉必须挂到 body：否则会被页面头卡那一层盖住（变更-141）', () => {
  it('每个 <el-drawer> 都带 append-to-body', () => {
    const offenders = []

    for (const file of vueFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const { tag, line } of drawerTags(text)) {
        if (!tag.includes('append-to-body')) {
          offenders.push(`${relative(SRC, file)}:${line}`)
        }
      }
    }

    expect(
      offenders,
      '这些 <el-drawer> 没写 append-to-body：它们的遮罩会被渲染进页面容器里，' +
        '页面头卡所在的兄弟层叠上下文就能把抽屉压住（2026-10-22 采购需求抽屉的标题' +
        '就是这样被吃掉的）。加上 append-to-body，写法与仓里所有 el-dialog 一致。',
    ).toEqual([])
  })

  it('确实扫到了抽屉 —— 防止正则写错后这条测试变成永远绿', () => {
    const total = vueFiles(SRC).reduce((sum, file) => sum + drawerTags(readFileSync(file, 'utf8')).length, 0)
    expect(total, '一个 <el-drawer> 都没扫到，说明这条护栏已经失效了，先修匹配规则').toBeGreaterThan(0)
  })
})
