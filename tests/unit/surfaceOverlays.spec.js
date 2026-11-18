import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/*
 * 浮层不许透（变更-233）。
 *
 * 2026-11-18 使用方：「你看这些弹窗，是不是不太美观……颜色也区分不明显」，
 * 追问后确认他指的是「弹窗和背后页面糊在一起：纸面太透，背后卡片文字透上来」。
 * 根因是浮层用了卡片那套 0.32 半透明白（bg-raised / --ds-card），
 * 背后的单号、列表项会像重影浮在弹窗内容上。
 *
 * 这条钉子只钉「浮层一律用实心纸 + 厚遮罩」这一个决定，
 * 免得以后又有人顺手把弹窗改回 bg-raised。
 */
const root = resolve(__dirname, '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

const TOKENS = 'src/styles/dsh.css'
const PALETTE = 'src/components/shell/CommandPalette.vue'
const DRAWER = 'src/components/purchase/PurchaseDetailDrawer.vue'

describe('浮层用实心纸，不透出背后页面（变更-233）', () => {
  it('token 里备好实心纸、厚落影、近乎不透明的遮罩', () => {
    const css = read(TOKENS)
    expect(css).toContain('--ds-sheet:')
    expect(css).toContain('--ds-sheet-shadow:')
    expect(css).toContain('--ds-scrim:')
    // 遮罩要够实：alpha 必须 ≥ 0.95，否则背后正文又能透出来
    const scrim = css.match(/--ds-scrim:\s*rgba\([^)]*?,\s*([\d.]+)\s*\)/)
    expect(scrim, '找不到 --ds-scrim 的定义').toBeTruthy()
    expect(Number(scrim[1]), '遮罩太透，背后正文会透上来').toBeGreaterThanOrEqual(0.95)
  })

  it('命令面板：实心纸 + 厚落影，不再用半透明卡片', () => {
    const src = read(PALETTE)
    expect(src).toContain('cmdk-sheet')
    expect(src).toContain('var(--ds-sheet')
    expect(src).toContain('var(--ds-scrim')
    // 不许回退到半透明的卡片底
    expect(src, '命令面板不能再用 bg-raised（半透明，会透出背后页面）').not.toContain(
      'rounded-card border border-line bg-raised',
    )
  })

  it('单据详情：编辑态与只读态都是实心纸，遮罩用 scrim', () => {
    const src = read(DRAWER)
    // 两个选择器都必须是实心底
    const solidBlocks = src.match(/\.purchase-dialog[^{]*\{[^}]*background:\s*var\(--ds-sheet/g)
    expect(solidBlocks, '单据详情的对话框没有用实心纸').toBeTruthy()
    expect(src).not.toContain('background: transparent;\n  box-shadow: none;')
    expect(src).toContain('background-color: var(--ds-scrim')
  })

  it('“未关联”这类空态给一块浅色说明条，不跟正文混成一片', () => {
    const src = read(DRAWER)
    expect(src).toContain('class="docket-note"')
    expect(src).toMatch(/\.docket-note\s*\{[^}]*background-color:/)
    expect(src).toMatch(/\.docket-note\s*\{[^}]*font-size:\s*11px/)
  })
})
