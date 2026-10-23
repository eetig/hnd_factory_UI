import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 采购看板卡片上的 OA 单号（2026-10-23，变更-166）。
 *
 * 使用方原话：「卡片上要加OA单号」。
 * 变更-148 当初是**故意不上卡**的（理由：单号长、只有催单时才需要），
 * 现在这条改动把这句老理由翻过来 —— 所以用文本断言钉住，别让后来人"顺手删回去"。
 *
 * 同时钉住另一件事：hover 不允许再用 `-translate-y`。
 * 那次 bug 的现场是「鼠标放到第一张卡上，上边缘那条线被覆盖了」——
 * 位移把上边框推上去和列头叠在一起，滚动容器又把阴影裁掉；
 * 现在靠 border + shadow 表达悬停，位移取消，容器补了上内边距。
 *
 * 读源码而不是挂载组件：这三条都是**类名/模板字符串**级别的事，
 * 挂载后再断言 class 反而更脆（Tailwind 的 class 会因合并顺序变化）。
 */

const root = process.cwd()
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const CARD = 'src/components/purchase/PurchaseCard.vue'
const BOARD = 'src/components/purchase/PurchaseBoard.vue'

describe('采购看板卡片：OA 单号与悬停', () => {
  it('卡片上有 OA 单号，且空值不渲染（不留一条"—"占位）', () => {
    const src = read(CARD)
    expect(src).toContain('v-if="row.oaNo"')
    expect(src).toMatch(/OA \{\{ row\.oaNo \}\}/)
    // 长单号要能看全：truncate + title
    expect(src).toContain(':title="row.oaNo"')
    expect(src).toContain('truncate')
  })

  it('卡片不再用 hover:-translate-y（位移会让上边框压到列头 / 被容器裁掉）', () => {
    const src = read(CARD)
    expect(src).not.toContain('hover:-translate-y')
    expect(src).toContain('hover:shadow-card')
    expect(src).toContain('hover:border-slate-400')
  })

  it('卡片列容器给上面的悬停阴影留了内边距', () => {
    const src = read(BOARD)
    const line = src.split('\n').find((l) => l.includes('overflow-y-auto px-2'))
    expect(line, '找不到列内的滚动容器，锚点可能改了').toBeTruthy()
    expect(line, '第一张卡贴着上边缘时，悬停阴影与上边框会被裁掉').toContain('pt-2')
  })
})
