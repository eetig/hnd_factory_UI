import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_COLUMNS,
  expireBadge,
  fileSizeText,
} from '../../src/components/archive/useArchiveColumns.js'

/**
 * 资料归档前端的守卫（变更-126）。
 *
 * <p>钉三件"看起来能用、实际会出问题"的事：
 * <ol>
 *   <li><b>列宽预算</b>：`table-fixed` 下只许一列自适应，固定宽合计 ≤1100 ——
 *       否则 1280 视口就横滚（变更-111/112 踩过：每列都写死宽，剩余宽度会被按比例摊给所有列）。</li>
 *   <li><b>到期三档</b>：已过期/今天/临近/正常/无有效期，文案与颜色都由同一处给 ——
 *       前端不自己算日期，天数来自后端 `daysToExpire`。</li>
 *   <li><b>文件大小</b>：0 表示"只有纸质没有电子件"，必须显示空串而不是「0 B」。</li>
 * </ol>
 */
describe('资料归档：列宽预算与到期口径', () => {
  it('只许一列自适应，固定宽合计 ≤1100（1280 视口不横滚）', () => {
    const fixed = ARCHIVE_COLUMNS.filter((c) => c.width)
    const auto = ARCHIVE_COLUMNS.filter((c) => !c.width)

    expect(auto).toHaveLength(1)
    expect(auto[0].key).toBe('name')

    const sum = fixed.reduce((n, c) => n + Number(String(c.width).match(/\d+/)[0]), 0)
    expect(sum, `固定列宽合计 ${sum}px，超过 1100 就会把自适应列挤没`).toBeLessThanOrEqual(1100)
  })

  it('到期：已过期红 / 今天红 / 30 天内琥珀 / 正常灰 / 无有效期显示破折号', () => {
    expect(expireBadge(-3).text).toBe('已过期 3 天')
    expect(expireBadge(-3).className).toContain('rose')

    expect(expireBadge(0).text).toBe('今天到期')
    expect(expireBadge(0).className).toContain('rose')

    expect(expireBadge(7).text).toBe('7 天')
    expect(expireBadge(7).className).toContain('amber')
    expect(expireBadge(30).className).toContain('amber')

    expect(expireBadge(31).className).toContain('slate')
    expect(expireBadge(90).className).toContain('slate')

    expect(expireBadge(null).text).toBe('—')
    // 禁用 token：text-slate-400 对白底 2.56:1 不过 AA（visualTokens.spec 有全站禁令）
    expect(expireBadge(null).className).not.toContain('text-slate-400')
  })

  it('文件大小：0 = 没有电子件 → 空串，不显示「0 B」', () => {
    expect(fileSizeText(0)).toBe('')
    expect(fileSizeText(null)).toBe('')
    expect(fileSizeText(2048)).toBe('2 KB')
    expect(fileSizeText(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
