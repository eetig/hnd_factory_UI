import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 采购看板卡片的静态约束（2026-10-23；变更-166 加 OA，变更-167 可点跳转，变更-168 一 OA 一卡，
 * 变更-180 卡面改成「一张 OA 单 = 一张台账」：明细行必须带齐使用方点名的七件事）。
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

  it('悬停效果全部在盒内（不用位移、不靠盒子外的阴影）', () => {
    /*
     * 2026-11-02：这一条从"必须有 hover:shadow-card"改成"不许有盒子外的阴影"。
     * 原因：卡片外层是 overflow-y-auto 的滚动区，盒子外的 shadow / ring 会被裁掉 ——
     * 使用方看到的就是"鼠标移到卡片上，上边缘那条轮廓线被盖住了"。
     * 现在改用 .purchase-card:hover 的 inset 阴影 + 背景 + 边框加深，全部在盒内。
     */
    const src = read(CARD)
    expect(src).not.toContain('hover:-translate-y')
    expect(src).not.toContain('hover:shadow-card')
    expect(src).toContain('.purchase-card:hover')
    expect(src).toContain('box-shadow: inset')
  })

  it('明细行七件事都在：提出日期 / 名称 / 编码 / 规格 / 用途 / 到货 / 需求人', () => {
    /*
     * 2026-11-10（变更-180）使用方的原话：「每张卡片的不同之处是 OA 单号。一张 OA 单号
     * 对应多条物料需求。比如 提出日期-物料名称-物料编码-规格型号-用途-要求到货日期-需求人」。
     * 起因是他每隔一段时间提一张 OA，那张单收的是**不同人、不同时间**的需求 ——
     * 卡上要能直接读出"这一单里都装了什么"，而不是只知道"这单很急"。
     *
     * 钉源码而不是挂载后查文本：这七件事分别落在两行、两个 grid 单元里，
     * 挂载断言要写一堆选择器，改版时最先碎的就是它。这里只钉"字段被读到了"。
     */
    const src = read(CARD)
    for (const field of [
      'row.requestDate',
      'row.materialName',
      'row.materialCode',
      'row.spec',
      'row.purpose',
      'row.requiredArrivalDate',
      'row.requester',
    ]) {
      expect(src, `卡面丢了 ${field}`).toContain(field)
    }
    // 表头只出现一次（每行都重复一遍表头就不叫表了）
    expect(src.match(/>提出</g)?.length || 0).toBe(1)
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
