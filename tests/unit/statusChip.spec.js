import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { statusChip } from '../../src/constants/statusTones.js'

/*
 * 状态章 + 首页落点（变更-234）。
 *
 * 2026-11-18 使用方：「颜色也区分不明显」→ 确认「状态改成有底色的小色块」；
 * 另一句：「我的工作主要下采购需求单，所以进入客户的首页我要求是采购看板，
 * 紧接着是费用申请。这是我时刻会关注的两个」。
 *
 * 为什么值得钉：状态在两个地方出现过（看板卡片底行、单据抽屉状态列），
 * 原来一处是彩色小字、一处是 `rounded-full` 胶囊——同一个状态两种形状，
 * 眼睛会当成两样东西。首页落点同理，改回"取导航第一项"就会悄悄回到工单汇总。
 */
const root = resolve(__dirname, '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

const CSS = 'src/styles/dsh.css'
const TONES = 'src/constants/statusTones.js'
const CARD = 'src/components/purchase/PurchaseCard.vue'
const DRAWER = 'src/components/purchase/PurchaseDetailDrawer.vue'
const NAV = 'src/nav/index.js'

describe('状态章（变更-234）', () => {
  it('statusChip 拼出基类 + 修饰类，颜色沿用 AA 表，认不出的 tone 退成中性', () => {
    expect(statusChip('error')).toContain('status-chip status-chip--error')
    expect(statusChip('error')).toContain('bg-rose-50')
    expect(statusChip('warning')).toContain('bg-amber-50')
    expect(statusChip('success')).toContain('bg-emerald-50')
    expect(statusChip('info')).toContain('bg-sky-50')
    // 脏数据（后端返回未知 status）不能渲染成透明块
    expect(statusChip('whatever')).toContain('status-chip--neutral')
  })

  it('样式只定义一处：方角 + 11px + 五个色档描边', () => {
    const css = read(CSS)
    expect(css).toContain('.status-chip {')
    // 方角 6px，不是胶囊 —— 与卡片抬头对齐
    expect(css).toMatch(/\.status-chip\s*{[^}]*border-radius:\s*6px/)
    expect(css).toMatch(/\.status-chip\s*{[^}]*font-size:\s*11px/)
    for (const tone of ['error', 'warning', 'success', 'info', 'neutral']) {
      expect(css).toContain(`.status-chip--${tone}`)
    }
  })

  it('看板卡片的徽标与底行都用状态章，不再各写一套颜色', () => {
    const card = read(CARD)
    expect(card).toContain("import { statusChip } from '../../constants/statusTones'")
    expect(card).toContain("statusChip('warning')")
    expect(card).toContain("statusChip('info')")
    expect(card).toContain('const dueChipClass = computed')
    expect(card).toContain(':class="dueChipClass"')
    // 旧写法（硬编码浅底 + 胶囊圆点）不许回来
    expect(card).not.toContain("cls: 'bg-amber-50 text-amber-800'")
    expect(card).not.toContain('const dueToneClass = computed')
  })

  it('单据抽屉的状态列用同一个类，不再用胶囊', () => {
    const drawer = read(DRAWER)
    // 只留 :class —— statusChip() 的返回值里已经带 status-chip，再写一个字面量会渲染成
    // `status-chip status-chip status-chip--error`（重复类名，虽然不影响样式但会让人怀疑）。
    expect(drawer).toContain(':class="statusClass(line.status)"')
    expect(drawer).not.toContain('class="status-chip" :class="statusClass')
    expect(drawer).not.toContain('class="rounded-full px-1.5 py-0.5 text-[11px]')
  })
})

describe('首页落在采购看板（变更-234）', () => {
  it('导航顺序：采购看板紧接费用申请', () => {
    const nav = read(NAV)
    const board = nav.indexOf("key: 'purchaseBoard'")
    const expense = nav.indexOf("key: 'purchaseExpense'")
    expect(board).toBeGreaterThan(-1)
    expect(expense).toBeGreaterThan(board)
    // 两者之间不该再插别的页面（片段里只应出现 purchaseBoard 自己这一个 key）
    expect(nav.slice(board, expense).split("key: '").length).toBe(2)
  })

  it('firstVisiblePath 先试首页落点，再退回第一个可用页', () => {
    const nav = read(NAV)
    expect(nav).toContain("const HOME_KEY = 'purchaseBoard'")
    const fn = nav.slice(nav.indexOf('export function firstVisiblePath'))
    expect(fn).toContain('item.key === HOME_KEY')
    expect(fn).toContain("navItemState(item) === 'available'")
    // 退回逻辑仍在：非 admin 不会因此进不去系统
    expect(fn).toContain('NAV_ITEMS.find((item) => navItemState(item)')
  })
})
