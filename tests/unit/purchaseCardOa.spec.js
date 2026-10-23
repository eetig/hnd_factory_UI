import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 采购看板卡片的静态约束（2026-10-23；变更-166 加 OA，变更-167 可点跳转，变更-168 一 OA 一卡）。
 *
 * 这个文件钉的是"改回去就会复发"的三类问题：
 *   ① 卡片上的 OA 单号：必须有，且能点开 EKP（三态：有链接 / 只有单号 / 都没有）
 *   ② 悬停不许用 `-translate-y`：位移会让上边框压到列头、被滚动容器裁掉
 *      （那次的使用方原话：「鼠标放在第一个卡片上时，上边缘的线被覆盖了」）
 *   ③ 卡片根元素必须是 div[role=button]：卡里有 <a>，HTML 不允许按钮嵌交互元素
 *
 * 读源码断言而不是挂载后查 class：这些都是类名/模板级别的事，挂载断言更脆
 * （Tailwind 的 class 合并顺序、组件拆分都会让它抖）。
 */

const root = process.cwd()
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const CARD = 'src/components/purchase/PurchaseCard.vue'
const BOARD = 'src/components/purchase/PurchaseBoard.vue'

describe('采购看板卡片：OA 单号与跳转', () => {
  it('OA 单号在卡上，且有链接时是 <a> 直达 EKP（新标签 + noopener）', () => {
    const src = read(CARD)
    // 三态：有链接 → a；只有单号 → 琥珀虚线提示；都没有 → 整个 <p> 不渲染
    expect(src).toContain('v-if="card.oaUrl"')
    expect(src).toContain(':href="card.oaUrl"')
    expect(src).toContain('target="_blank"')
    expect(src).toContain('rel="noopener noreferrer"')
    expect(src).toContain('v-else-if="card.oaNo"')
  })

  it('点 OA 链接不触发"开抽屉"（@click.stop），键盘也不冒泡', () => {
    const src = read(CARD)
    expect(src).toMatch(/@click\.stop\s*\n?\s*@keydown\.stop/)
  })

  it('卡片根元素是 div[role=button]，不是 <button>（button 里不能嵌 <a>）', () => {
    const src = read(CARD)
    expect(src).toContain('role="button"')
    expect(src).toContain('tabindex="0"')
    // 根不能是 <button：模板里第一个标签必须是 <div
    const firstTag = src.slice(src.indexOf('<template>')).match(/<template>\s*<([a-z]+)/)?.[1]
    expect(firstTag).toBe('div')
    expect(src).toContain('@keydown.enter.self')
    expect(src).toContain('@keydown.space.self.prevent')
  })

  it('卡片不再用 hover:-translate-y，且悬停仍靠 border + shadow', () => {
    const src = read(CARD)
    expect(src).not.toContain('hover:-translate-y')
    expect(src).toContain('hover:shadow-card')
    expect(src).toContain('hover:border-slate-400')
  })

  it('一张卡可以装多条物料：超过 4 条折叠', () => {
    const src = read(CARD)
    expect(src).toContain('FOLD_LIMIT = 4')
    expect(src).toContain('还有 ')
    expect(src).toContain('expanded = true')
  })
})

describe('采购看板列容器', () => {
  it('列内滚动容器给上面的悬停阴影留了内边距', () => {
    const src = read(BOARD)
    const line = src.split('\n').find((l) => l.includes('overflow-y-auto px-2'))
    expect(line, '找不到列内的滚动容器，锚点可能改了').toBeTruthy()
    expect(line, '第一张卡贴着上边缘时，悬停阴影与上边框会被裁掉').toContain('pt-2')
  })
})
