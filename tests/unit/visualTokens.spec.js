import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATUS_TONE, STATUS_ICON_TONE, STATUS_TEXT } from '../../src/constants/statusTones'

/**
 * 视觉回归护栏。
 *
 * 这里只钉两类东西：**已经做过全仓扫描才定下来的类名**，和**靠人眼看不出来的
 * 对比度**。两者都会在有人把旧代码块粘进新页签时静默回归 —— 今天看起来对，
 * 明天多一个面板就退回去了。
 *
 * 刻意不做的事（都是过度工程）：
 *   · axe / pa11y —— 新依赖，且要真浏览器，跑不进 verify 的 jsdom。
 *   · 组件级对比度断言 —— jsdom 不算样式，解析不出文字背后到底是哪一层背景，
 *     而那恰恰是这件事唯一有意思的部分。那部分留在人工目视。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = join(ROOT, 'src')

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const SOURCE_FILES = walk(SRC).filter((f) => /\.(vue|js|css)$/.test(f))
const read = (file) => readFileSync(file, 'utf8')
const rel = (file) => relative(ROOT, file).replace(/\\/g, '/')

/** 逐行扫描，返回 `路径:行号` 列表（便于断言失败时直接跳过去） */
function scan(re) {
  const hits = []
  for (const file of SOURCE_FILES) {
    read(file)
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (re.test(line)) hits.push(`${rel(file)}:${index + 1}`)
      })
  }
  return hits
}

// ---------------------------------------------------------------------------
// 1. 禁用类名
// ---------------------------------------------------------------------------

describe('禁用类名不得回流', () => {
  const BANNED = [
    [
      'text-slate-400',
      '对白底 2.56:1、对 slate-50 2.45:1，都不过 AA。弱化文字一律 slate-500（例外：压在带色调的玻璃面板上要用 slate-600，见磨砂玻璃那一组）',
    ],
    ['placeholder:text-slate-300', '占位符也是文字，1.48:1。用 slate-500'],
    ['text-red-', '错误色一律 rose。同一个语义不允许两种色相'],
    ['bg-sky-600', '天蓝是上一代主色。再出现说明有代码块从旧版本被粘回来，不是新写的'],
    ['rgb(0, 0, 0)', '全站墨色是 slate-900 #0f172a，不用纯黑'],
    ['text-[10px]', '10px 太小。角标用 text-xs（12px）'],
  ]

  for (const [token, why] of BANNED) {
    it(`不存在 ${token}（${why}）`, () => {
      expect(scan(new RegExp(token.replace(/[[\]()]/g, '\\$&')))).toEqual([])
    })
  }

  it('text-slate-300 只允许出现在 disabled: 形式里', () => {
    // WCAG 1.4.3 明确豁免「失效控件」。停用的「清空」按钮、停用的输入底
    // 都走 disabled: 前缀 —— 改它们没有可测量的收益，只增 diff 噪音。
    // 但裸写的 text-slate-300 是内容不是提示，按正文阈值走，必须归零。
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/text-slate-300/.test(line.replace(/disabled:text-slate-300/g, ''))) {
            offenders.push(`${rel(file)}:${index + 1}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. 对比度护栏
// ---------------------------------------------------------------------------

// Tailwind v3 调色板。加新色相时这里会先炸（见下面 parseTone 的断言），
// 这是有意的 —— 比悄悄放行一个没算过比值的组合好。
const HEX = {
  white: '#ffffff',
  'rose-50': '#fff1f2',
  'rose-100': '#ffe4e6',
  'rose-600': '#e11d48',
  'rose-700': '#be123c',
  'emerald-50': '#ecfdf5',
  'emerald-100': '#d1fae5',
  'emerald-600': '#059669',
  'emerald-700': '#047857',
  'emerald-800': '#065f46',
  'amber-50': '#fffbeb',
  'amber-100': '#fef3c7',
  'amber-700': '#b45309',
  'amber-800': '#92400e',
  'sky-50': '#f0f9ff',
  'sky-100': '#e0f2fe',
  'sky-600': '#0284c7',
  'sky-700': '#0369a1',
  'slate-50': '#f8fafc',
  'slate-100': '#f1f5f9',
  'slate-500': '#64748b',
  'slate-600': '#475569',
  'slate-700': '#334155',
}

/** WCAG 2.x 相对亮度 */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (hi + 0.05) / (lo + 0.05)
}

/** 从 'bg-rose-50 text-rose-700' 里取出底色与字色的 hex */
function parseTone(classString) {
  const bg = classString.match(/\bbg-([a-z]+-\d+)\b/)
  const text = classString.match(/\btext-([a-z]+-\d+)\b/)
  return {
    bg: bg ? HEX[bg[1]] : null,
    text: text ? HEX[text[1]] : null,
    bgName: bg ? bg[1] : null,
    textName: text ? text[1] : null,
  }
}

describe('语义状态色必须过 AA（4.5:1）', () => {
  for (const [name, tone] of Object.entries(STATUS_TONE)) {
    it(`STATUS_TONE.${name} = ${tone}`, () => {
      const { bg, text, bgName, textName } = parseTone(tone)
      // 先证明调色板认得这两个类名 —— 否则下面的断言会拿 undefined 去算，
      // 算出来是 NaN，NaN >= 4.5 为 false 但报错信息毫无线索
      expect(bg, `未知底色 bg-${bgName}，请补进 HEX 表并重算比值`).toBeTruthy()
      expect(text, `未知字色 text-${textName}，请补进 HEX 表并重算比值`).toBeTruthy()
      expect(contrast(text, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }

  for (const [name, tone] of Object.entries(STATUS_ICON_TONE)) {
    it(`STATUS_ICON_TONE.${name} = ${tone}`, () => {
      const { bg, text, bgName, textName } = parseTone(tone)
      expect(bg, `未知底色 bg-${bgName}`).toBeTruthy()
      expect(text, `未知字色 text-${textName}`).toBeTruthy()
      expect(contrast(text, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }

  for (const [name, tone] of Object.entries(STATUS_TEXT)) {
    it(`STATUS_TEXT.${name} = ${tone}（白底）`, () => {
      const { text, textName } = parseTone(tone)
      expect(text, `未知字色 text-${textName}`).toBeTruthy()
      expect(contrast(text, HEX.white)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

describe('HEX 表与 statusTones.js 注释里的比值一致', () => {
  /*
   * 只有上面那条「≥ 4.5」是不够的：HEX 表里任何一格抄错（把 rose-700 写成
   * rose-600 的 #e11d48），断言照样绿 —— 它只是从此开始守着一个错的颜色，
   * 而模块注释里的数字还是对的，两处对不上也没人会发现。
   *
   * 逐条比对注释里的数字，三种情况都会红：HEX 抄错、色阶被挪档、注释本身过期。
   * 容差 0.05 —— 挪一档色阶的差值在 0.2 以上，抓得住。
   */
  const DOCUMENTED = {
    'bg-rose-50 text-rose-700': 5.72,
    'bg-emerald-50 text-emerald-700': 5.21,
    'bg-amber-50 text-amber-800': 6.84,
    'bg-sky-50 text-sky-700': 5.57,
    'bg-slate-100 text-slate-600': 6.92,
    'bg-rose-100 text-rose-700': 5.24,
    'bg-emerald-100 text-emerald-700': 4.84,
    'bg-amber-100 text-amber-800': 6.37,
    'bg-sky-100 text-sky-700': 5.17,
    'text-rose-600': 4.7,
    'text-emerald-700': 5.48,
    'text-amber-700': 5.02,
  }

  const ALL = { ...STATUS_TONE, ...STATUS_ICON_TONE, ...STATUS_TEXT }

  for (const [name, tone] of Object.entries(ALL)) {
    it(`${name}：${tone} → ${DOCUMENTED[tone] ?? '（注释里没有记比值）'}`, () => {
      const documented = DOCUMENTED[tone]
      expect(
        documented,
        `新加了 ${tone}，请把实算比值写进 statusTones.js 的注释与本表`,
      ).toBeTruthy()
      const { bg, text } = parseTone(tone)
      // STATUS_TEXT 是白底内联文字，没有 bg- 前缀
      expect(contrast(text, bg ?? HEX.white)).toBeCloseTo(documented, 1)
    })
  }
})

describe('主按钮填充色', () => {
  it('emerald-700 压白字过 AA', () => {
    expect(contrast(HEX['emerald-700'], HEX.white)).toBeGreaterThanOrEqual(4.5)
  })

  it('emerald-600 压白字不过 —— 这就是主按钮为什么不能停在 -600', () => {
    // 钉住这条，是为了让日后「统一调成 emerald-600 更鲜亮」的改动直接失败。
    // 翡翠绿色阶里只有 -700 这一档的白字过 AA。
    expect(contrast(HEX['emerald-600'], HEX.white)).toBeLessThan(4.5)
  })
})

// ---------------------------------------------------------------------------
// 3. 两条「全仓缺席」类的问题
// ---------------------------------------------------------------------------

describe('全局排版底线（src/style.css）', () => {
  const style = read(join(SRC, 'style.css'))

  it('表格数字用等宽字形', () => {
    // Inter 默认是比例数字，'1' 比 '9' 窄。缺了这条，工单/领料/入库/体积/金额
    // 这些右对齐数字列上下两行的个位就对不齐。
    expect(style).toMatch(/table\s*\{[^}]*font-variant-numeric:\s*tabular-nums/)
  })

  it('table 的 tabular-nums 只限定 table，不上 :root', () => {
    // Intro.vue 受保护（整页无 <table>）。限定到 table 之后，这条规则在
    // 物理上不可能波及那一页 —— 别为了「更彻底」改成 body 或 :root。
    expect(style).not.toMatch(/:root\s*\{[^}]*font-variant-numeric/)
    expect(style).not.toMatch(/\nbody\s*\{[^}]*font-variant-numeric/)
  })
})

describe('prefers-reduced-motion', () => {
  it('每一处无限循环动画，都必须在**同一个文件**里有减弱动效的逃逸', () => {
    /*
     * 「同一个文件」是关键，不是形式主义。
     *
     * 组件的 <style scoped> 编译后是 `.loader-bar[data-v-xxx]`（特异性 0,2,0），
     * 全局的 `.loader-bar`（0,1,0）**压不过它**，且媒体查询不增加特异性。
     * 曾把这条规则写在 src/style.css，产物里两条规则并存、grep 也能找到，
     * 实际从未生效 —— 对明确在系统里关掉动效的用户等于什么都没做。
     *
     * 所以：动画在哪，逃逸就必须在哪。写在同一个 scoped 块里与之同特异性，
     * 靠源码顺序在后取胜，无需 !important。
     */
    const offenders = SOURCE_FILES.filter(
      (file) =>
        /animation:[^;]*\binfinite\b/.test(read(file)) &&
        !/prefers-reduced-motion/.test(read(file)),
    ).map(rel)
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. 可访问名
// ---------------------------------------------------------------------------

describe('可访问名', () => {
  it('每个 el-date-picker 都必须有 aria-label', () => {
    /*
     * placeholder **不是**可访问名。已实测：el-date-picker 渲染出的
     * <input role="combobox"> 有值之后，读屏只会念出一个光秃秃的日期，
     * 没有任何线索说明它是起始还是结束日期。
     * aria-label 会落到内层 input 上（不是外层 div），能覆盖掉这个空白。
     */
    const offenders = []
    for (const file of SOURCE_FILES.filter((f) => f.endsWith('.vue'))) {
      const text = read(file)
      for (const match of text.matchAll(/<el-date-picker\b[\s\S]*?>/g)) {
        // 认属性本身（含 :aria-label 绑定形式），不是「标签里提到过这个词」
        if (!/(^|\s):?aria-label\s*=/.test(match[0])) {
          offenders.push(`${rel(file)}:${text.slice(0, match.index).split(/\r?\n/).length}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. 主色的唯一性：天蓝只允许作为「信息」语义色存在
// ---------------------------------------------------------------------------

describe('天蓝已不是主色，只留作「信息」语义色', () => {
  /*
   * 变更-028 把主色从天蓝换成了翡翠绿。天蓝**没有**被淘汰 —— 它仍是
   * STATUS_TONE.info 的语义色（提示、说明那类中性信息）。所以不能一并扫掉：
   * 绿只能有一个含义，主色若是绿，状态色里的绿就必须只剩「成功/正常」。
   *
   * 这条护栏守的是这个边界，两侧都要钉住：主色侧必须归零，语义侧必须留着。
   */
  it('除 statusTones.js 外，src 里不应再出现 sky-', () => {
    const offenders = []
    for (const file of SOURCE_FILES) {
      if (file.endsWith('statusTones.js')) continue
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/sky-/.test(line)) offenders.push(`${rel(file)}:${index + 1}`)
        })
    }
    expect(offenders).toEqual([])
  })

  it('statusTones 的 info 必须仍是 sky —— 别跟着主色一起换', () => {
    // 换成绿就与 success 同色相，「提示」和「正常」再也分不开。
    expect(STATUS_TONE.info).toContain('sky')
    expect(STATUS_ICON_TONE.info).toContain('sky')
  })

  it('天蓝的色值字面量也不得回流 —— 类名护栏漏得过 scoped CSS', () => {
    /*
     * 上一条只认 `sky-` 类名。变更-033 之前 `.vessel-select` 的聚焦环是
     * `rgb(14 165 233)`（sky-500）—— 一行 scoped CSS 里的裸 rgb，就在
     * 护栏底下活了一整轮，靠人工审计才抓出来。这里把天蓝家族常用的色值
     * 按字面量再钉一道：`rgb(r g b)` 与 `rgb(r, g, b)` 两种写法都算。
     */
    const SKY_LITERALS = [
      /rgb\(\s*14[\s,]+165[\s,]+233\s*\)/, // sky-500 #0ea5e9
      /rgb\(\s*2[\s,]+132[\s,]+199\s*\)/, // sky-600 #0284c7
      /rgb\(\s*3[\s,]+105[\s,]+161\s*\)/, // sky-700 #0369a1
      /rgb\(\s*56[\s,]+189[\s,]+248\s*\)/, // sky-400 #38bdf8
      /rgb\(\s*125[\s,]+211[\s,]+252\s*\)/, // sky-300 #7dd3fc
      /rgb\(\s*224[\s,]+242[\s,]+254\s*\)/, // sky-100 #e0f2fe
      /rgb\(\s*240[\s,]+249[\s,]+255\s*\)/, // sky-50 #f0f9ff
      /#(0ea5e9|0284c7|0369a1|38bdf8|7dd3fc|e0f2fe|f0f9ff)\b/i,
    ]
    const offenders = []
    for (const file of SOURCE_FILES) {
      if (file.endsWith('statusTones.js')) continue
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          for (const re of SKY_LITERALS) {
            if (re.test(line)) offenders.push(`${rel(file)}:${index + 1}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 6. Element Plus 主色与它的 6 个派生色必须同步
// ---------------------------------------------------------------------------

describe('Element Plus 主色与派生色同步', () => {
  /*
   * theme.css 的 6 个派生色是照 EP 自己的混色规则算出来的。改主色而忘了改派生色，
   * 表现是「分页当前页、下拉选中项还是上一代颜色」—— 要刚好点到那个组件才会撞见。
   * 所以不靠肉眼：拿公式实算比一遍，改一半立刻红。
   */
  const themeSrc = read(join(SRC, 'theme.css'))
  const primary = (themeSrc.match(/--el-color-primary\s*:\s*(#[0-9a-fA-F]{6})/) || [])[1]
  const declared = (suffix) => {
    const m = themeSrc.match(new RegExp(`--el-color-primary-${suffix}\\s*:\\s*(#[0-9a-fA-F]{6})`))
    return m ? m[1].toLowerCase() : null
  }

  /** light-N = 主色与白色按 (10-N)/10 混合，例如 light-9 = 10% 主色 + 90% 白 */
  const lighten = (hex, frac) =>
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - frac) + 255 * frac)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')

  it('主色已定义', () => {
    expect(primary, 'theme.css 里找不到 --el-color-primary').toBeTruthy()
  })

  it('公式与 Element Plus 一致（拿 EP 自己的默认主色自证）', () => {
    // EP 默认主色 #409eff 的 light-3 是 #79bbff。这条不过，说明下面几条
    // 全都在拿一条错的公式做校验 —— 该修的是公式，不是 theme.css。
    expect(lighten('#409eff', 0.3)).toBe('#79bbff')
  })

  for (const n of [3, 5, 7, 8, 9]) {
    it(`light-${n} 与主色同步`, () => {
      expect(declared(`light-${n}`), `theme.css 缺 --el-color-primary-light-${n}`).toBeTruthy()
      expect(declared(`light-${n}`)).toBe(lighten(primary, n / 10))
    })
  }

  it('dark-2 与主色同步（主色混 20% 黑）', () => {
    const darken =
      '#' +
      [1, 3, 5]
        .map((i) =>
          Math.round(parseInt(primary.slice(i, i + 2), 16) * 0.8)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    expect(declared('dark-2')).toBe(darken)
  })
})

// ---------------------------------------------------------------------------
// 7. 焦点环白名单
// ---------------------------------------------------------------------------

describe('焦点环必须过 1.4.11 的 3:1', () => {
  /*
   * 待办-002 §1 登记的 7 处（ring-sky-300 1.67:1、ring-slate-400 2.56:1）
   * 已在 变更-028 修掉，期间还挖出审计漏掉的 ring-rose-300（1.89:1）。
   *
   * 与其逐个钉「不许出现某某类」，不如反过来：**只许出现算过比值的这几个**。
   * 加新环色时必须先把比值算出来补进本表 —— 当初漏掉 rose-300，
   * 正是因为那份审计是逐个数出来的，而不是拿白名单卡出来的。
   *
   * 只匹配**颜色** token：`focus:ring-2`（粗细）与 `focus:ring-offset-2`（偏移）
   * 不含色名，靠 `[a-z]+-\d{2,3}` 这个形态自然排除。
   */
  const RING_OK = {
    'focus-visible:ring-emerald-600': '3.77（压白底）/ 3.58（压选中项的 emerald-50）',
    'focus:ring-emerald-600': '3.77',
    'focus:ring-slate-500': '4.76（实心主按钮，环画在 ring-offset 之外的白底上）',
    'focus-visible:ring-slate-500': '4.76（收起侧栏按钮）',
    'focus-visible:ring-rose-600': '4.70（退出登录）',
    // 软晕，不承载指示：这些输入框真正的指示者是同一行的 focus:border-emerald-600（3.77）
    'focus:ring-emerald-100': '(略)',
  }

  const RING_RE = /\bfocus(-visible)?:ring-([a-z]+-\d{2,3})\b/g

  it('emerald-600 只许做纯图形，不得当文字底', () => {
    /*
     * 这一条**不是**「不许出现某个类」—— emerald-600 出现在进度条、大图标上是
     * 正确的（纯图形阈值 3:1，它压白底 3.77 过）。错的是拿它垫白字：
     * 那一下阈值就从 3:1 升到 4.5，3.77 立刻不达标。
     *
     * 所以规则是「不许这样搭配」，而不是「不许用这个类」。BANNED 那套是逐 token
     * 匹配的，表达不了这个条件，单独写一条。
     */
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/\bbg-emerald-600\b/.test(line) && /\btext-white\b/.test(line)) {
            offenders.push(`${rel(file)}:${index + 1}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })

  it('全仓只允许出现白名单里的焦点环', () => {
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          for (const m of line.matchAll(RING_RE)) {
            const full = `focus${m[1] ?? ''}:ring-${m[2]}`
            if (!(full in RING_OK)) offenders.push(`${rel(file)}:${index + 1}  ${full}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })

  it('白名单里每个色都真的够 3:1（软晕那条除外）', () => {
    for (const [ring, why] of Object.entries(RING_OK)) {
      if (ring === 'focus:ring-emerald-100') continue
      const color = ring.match(/ring-([a-z]+-\d{2,3})/)[1]
      expect(HEX[color], `${ring} 用到的 ${color} 不在 HEX 表里，先补上再算比值`).toBeTruthy()
      expect(contrast(HEX[color], HEX.white), `${ring} → ${why}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('侧栏宽度必须装得下最长的那条分组提示', () => {
  /*
   * 这条护栏是**从一次真实回归里长出来的**，不是预防性想象：
   *
   * 2026-10-07 给分组块加了 36px 图标之后，224px 的侧栏里留给文字那一列只剩 92px，
   * 而「工单、领料、入库与核算」在 text-xs 下要 132px —— 于是四条提示两条折行、
   * 两条不折，行高 74/58 交替。类名一个没写错，对比度一条没过不了，verify 全绿，
   * **只有在浏览器里真量一遍才会发现**。使用方看到的正是这个参差（「排版不美观」）。
   *
   * 所以钉的是**宽度关系**：侧栏内容宽 − 按钮左右内边距 − 图标块 − 间距
   * 必须 ≥ 最长提示的文字宽。字宽按 CJK 全角 1em、ASCII 半角 0.55em 估
   * （jsdom 不排版，拿不到真实字宽；这个估法对纯中文提示是准的，对混排偏保守）。
   *
   * 加宽侧栏（w-56 → w-72）或用更小的图标块都会让这条重新通过；
   * 有人把某条提示写长了则会变红 —— 那时要么改提示，要么再调宽度，别让它悄悄折行。
   */
  const CJK_EM = 1
  const ASCII_EM = 0.55
  const HINT_PX = 12 // text-xs
  const TILE_PX = 36 // h-9 w-9
  const GAP_PX = 12 // gap-3
  const PADDING_PX = 10 // px-2.5

  // Tailwind 宽度 → px。只列侧栏用得到的几档，要加档位就补这里（不补会直接失败，不会静默放过）
  const WIDTH_PX = { 'w-56': 224, 'w-72': 288 }

  const textWidth = (s) =>
    [...s].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? CJK_EM : ASCII_EM) * HINT_PX, 0)

  it('展开态宽度 − 内边距 − 图标块 − 间距 ≥ 最长提示宽', () => {
    const source = read(join(SRC, 'views', 'WorkOrderList.vue'))

    // 侧栏内容宽 = aside 宽 − m-4(16×2) − p-4(16×2)
    const widthClass = source.match(/collapsed \? 'w-\[88px\]' : '([\w-]+)'/)
    expect(widthClass, '没找到展开态宽度类，匹配式要跟着 markup 一起改').toBeTruthy()
    const aside = WIDTH_PX[widthClass[1]]
    expect(aside, `${widthClass[1]} 不在 WIDTH_PX 表里，先补上它的像素值再算`).toBeTruthy()
    const content = aside - 16 * 2 - 16 * 2

    // GROUPS 里的 hint 文案
    const hints = [...source.matchAll(/hint:\s*'([^']+)'/g)].map((m) => m[1])
    expect(hints.length, '一条 hint 都没扫到，正则多半和 GROUPS 的写法脱节了').toBeGreaterThan(0)

    const available = content - PADDING_PX * 2 - TILE_PX - GAP_PX
    const longest = hints.reduce((a, b) => (textWidth(a) >= textWidth(b) ? a : b))
    expect(
      available,
      `文字列只有 ${available}px，装不下最长提示「${longest}」（约 ${Math.round(textWidth(longest))}px）。` +
        `要么加宽侧栏，要么缩短这条提示 —— 不要让它折行：四条里两条两行会让行高参差。`,
    ).toBeGreaterThanOrEqual(Math.round(textWidth(longest)))
  })
})

// ---------------------------------------------------------------------------
// 暖白：是卡片，不是底色
// ---------------------------------------------------------------------------

describe('暖白只能当卡片，不能当页面底色', () => {
  /*
   * 这一组是**从使用方的一次纠正里长出来的**，不是预防性想象。
   *
   * 2026-10-07 使用方指着工作台主区说「做一个底框，暖白色」。第一版把整个**页面
   * 的底色**改成了暖白，使用方看到的是整屏泛黄，于是纠正：
   *   「不是把背景变成暖白，是添加一个暖白的底层卡片，
   *     整个项目看上去就是运行在这张卡片上」
   *
   * 两者只差一层嵌套，观感却是两回事：底色变暖是「整屏泛黄」，
   * 卡片是「有一张纸，东西都放在纸上」。
   *
   * 而这个区别**在类名层面根本看不出来** —— bg-canvas 写在 <main> 上还是写在
   * 它里面的 <div> 上都编译得出来，对比度一条不欠，verify 全绿。
   * 所以只能显式钉住：根元素必须是冷底 bg-slate-50，暖白只准出现在带圆角的卡片上。
   */
  const config = read(join(ROOT, 'tailwind.config.js'))

  // 暖白的值在 tailwind.config.js 的 colors.canvas，不在 style.css —— 它只有
  // bg-canvas 这一个消费者，不必也不该另立一个 CSS 变量（两个来源必然会分叉）。
  const canvasHex = (config.match(/canvas:\s*'(#[0-9a-fA-F]{6})'/) || [])[1]

  /*
   * 下面三条都只认 `class="..."` 里的类名，不认整行文本。
   *
   * 这一层不是洁癖，是**证伪探针抓出来的漏洞**：最初这三条用的是朴素行正则，
   * 于是把 Login.vue 里那张暖白卡片整个删掉、只留下注释里的一句
   * 「暖白纸（rounded-card bg-canvas）」，三条护栏**全绿**。
   * 而这一页正是最该有纸的那几页之一。
   *
   * 取 class 属性还顺带修掉另一个毛病：`bg-slate-50/85` 与 `bg-slate-50`
   * 在朴素正则下是同一个东西，而它们是两种底色。这里改成整词比对。
   */
  const classTokens = (line) =>
    [...line.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].trim().split(/\s+/))
  const hasToken = (line, token) => classTokens(line).includes(token)
  // bg-canvas 与它的透明度写法 bg-canvas/85 都算「用了暖白」
  const usesCanvas = (line) =>
    classTokens(line).some((t) => t === 'bg-canvas' || t.startsWith('bg-canvas/'))
  const CARD_RADIUS = /^rounded-(card|[tblr]-card|(?:tl|tr|bl|br)-card)$/

  it('暖白不比它取代的冷底暗 —— 暗了就会把二次文字一起拖下水', () => {
    /*
     * 这条不是预防性想象，是 变更-029 真踩到的：
     *
     * 使用方最初的暖白 #faf7f1 比它取代的 slate-50 更**暗**。原因不是配色失误：
     * 暖色为了保暖必须压蓝通道，而 WCAG 亮度里绿占 0.7152、蓝只占 0.0722 ——
     * 蓝一压，亮度就掉。于是 slate-500 压上去从 4.548 掉到 **4.450，跌破 AA 的 4.5**。
     *
     * 而 slate-500 是全站**唯一**的弱化文字色（见上面禁用 slate-400 那条），
     * 凡是有浅色底的地方都靠它。它一旦在这张卡片上不达标，规矩就变成
     * 「同一个类名在别处合规、在这儿不合规」—— 这种不成文的边界没人记得住。
     *
     * 现在取的是同一色相（40°）、同一暖度（R−B = +9）、只整体提亮 3 级的 #fdfaf4：
     * 亮度 0.9579 > slate-50 的 0.9536，slate-500 回到 4.568，比改造前还高一点。
     * **暖度一分没减，只是提亮到不欠对比度的程度。** 想再调暗之前先看这里：
     * 每通道降 1 级 = 4.53，降 2 级 = 4.49。
     */
    expect(canvasHex, '没在 tailwind.config.js 里解析出 colors.canvas 的十六进制值').toBeTruthy()
    expect(
      luminance(canvasHex),
      `暖白 ${canvasHex} 比 slate-50 还暗。暖白可以调暖，但不能调暗 ——` +
        `再暗下去压在上面的二次文字（slate-500）就要欠对比度了。`,
    ).toBeGreaterThanOrEqual(luminance(HEX['slate-50']))
    expect(
      contrast(HEX['slate-500'], canvasHex),
      `slate-500 压这张暖白卡片 ${canvasHex} 不到 4.5。要么提亮卡片，` +
        `要么把压在它上面的二次文字改成 slate-600。`,
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('页面根元素一律 bg-slate-50 —— 暖白不许拿来当页面底色', () => {
    // 判据是 min-h-screen，全站只有四个页面根元素用（工作台 / 登录 / 404 / 落地页）。
    //
    // 两个方向都要钉：
    //   ① 漏了冷底 —— 那一页没有底色，页脚外露或回弹时露出浏览器默认白；
    //   ② 写成 bg-canvas —— 这一页整屏泛黄，而别页是冷的，来回跳正是最常见的动作
    //（登录 → 工作台 → 退出）。使用方看到的第一版就是这个样子。
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (!hasToken(line, 'min-h-screen')) return
          const at = `${rel(file)}:${index + 1}`
          if (usesCanvas(line)) {
            offenders.push(`${at} 把暖白当成了页面底色`)
          } else if (!hasToken(line, 'bg-slate-50')) {
            offenders.push(`${at} 没有底色`)
          }
        })
    }
    expect(
      offenders,
      '页面根元素要用 bg-slate-50 当底色；暖白是**卡片**，不是背景 —— ' +
        '「整屏泛黄」和「有一张纸」只差一层嵌套，别把主意打到根元素上。',
    ).toEqual([])
  })

  it('每一处 bg-canvas 都带卡片圆角 —— 有圆角才是卡片', () => {
    /*
     * 上一条挡的是「暖白跑到根元素上」，这条挡的是它被挪到中间某层：
     * 一个不带圆角、四边贴死的暖白块，观感就是「这块区域泛黄」，
     * 和使用方否掉的第一版没有区别。圆角是「这是一张纸」的唯一视觉凭据。
     *
     * 收 `rounded-card` 与它的单向变体（`rounded-t-card` 等）：Intro 那个吸顶头部
     * 只需要圆上面两个角 —— 下面两个角一圆，它那条 border-b 就会在两端翘起来。
     * 这不是放水，是这条规则本来就该按「有没有卡片圆角」判，而不是按字面写法判。
     *
     * 反面也成立：rounded-card 在全站有几十处（都是白卡片 / 面板），
     * 它们不需要也不该都变成暖白 —— 所以这里只单向要求 bg-canvas ⇒ 圆形角。
     */
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (!usesCanvas(line)) return
          if (!classTokens(line).some((t) => CARD_RADIUS.test(t))) {
            offenders.push(`${rel(file)}:${index + 1}`)
          }
        })
    }
    expect(
      offenders,
      'bg-canvas 必须与 rounded-card（或 rounded-t-card 这类单向变体）同行；' +
        '想要一块没有圆角的浅色区域，用 bg-slate-50 —— 冷底才是「区域」。',
    ).toEqual([])
  })

  it('四个页面每一个里面都有一张暖白卡片 —— 缺一个就少一张纸', () => {
    /*
     * 上两条管的是「暖白别乱跑」，这条管的是反面：**该有的地方有没有**。
     *
     * 使用方 2026-10-07 的原话是「整个项目看上去就是运行在这张卡片上」，
     * 随后又补了一句「登录、404、落地页都要加」。所以口径是**四页一致**，
     * 不是只有工作台 —— 从登录跳到工作台再退出，是这套系统里最频繁的一组动作，
     * 中间有一页没有那张纸，来回一跳就看得出来。
     *
     * 判据与上一条同源：`min-h-screen` 是页面根元素的标记，全站恰好四个。
     * 数量写死是有意的 —— 将来多出第五个页面时这条会红，提醒把它一起包进纸里；
     * 那时把 4 改成 5，**顺手确认新页面也有卡片**。
     */
    const roots = new Set()
    const carded = new Set()
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line) => {
          if (hasToken(line, 'min-h-screen')) roots.add(file)
          if (usesCanvas(line)) carded.add(file)
        })
    }
    expect(
      [...roots].map(rel).sort(),
      '带 min-h-screen 的页面根元素数量变了 —— 新页面也要包一张暖白卡片，确认后改这里的 4',
    ).toHaveLength(4)
    expect(
      [...roots].filter((f) => !carded.has(f)).map(rel),
      '这些页面里没有暖白卡片（只认 class 属性，写在注释里不算）。' +
        '四页都要「跑在那张纸上」，别漏',
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 磨砂玻璃：侧栏面板与顶部导航条
// ---------------------------------------------------------------------------

describe('磨砂玻璃与固定大小（侧栏面板 / 顶部导航条 / 主区玻璃栏）', () => {
  /*
   * 使用方 2026-10-07 圈着侧栏和顶部标题条指定了三个值：
   * **背景半透明、模糊 24 像素、边缘用亮白描边**。两块同一套。
   *
   * ⚠️ **第一版只照这三个值做，使用方上线看到的是「没效果」** —— 当场补了第四条：
   * **玻璃带一点色调**。这不是口味问题，是量出来的：75% 白压在 `#fdfaf4` 的暖白纸上
   * 出来是 `#fffefc`，跟纸差 2~8 级、跟纯白差 0~3 级，肉眼分不出；模糊更无从表现 ——
   * **模糊一张纯色的纸，出来还是那张纸**（侧栏底下永远是那张纸，表格滑不过来）。
   *
   * ⚠️ **色调后来又改过一次**（2026-10-07 用完的当天：「液态玻璃染成浅绿色」）：
   * 由暖中性 `#e7e4de` 改成浅绿 `#d2e6d8`，压出来 `#e5efe5`、与纸的亮度比 **1.132**。
   * 这一组护栏是**贴着值算的**（下面每一条都写着具体数字），所以换色调之后**里面的数
   * 全都要重算一遍** —— 数字不对不只是注释过期，会让人以为门槛达标了。
   * 这次的数变化见 ② ③ 与图标块那条，另加了一条新的（emerald-700 定「能染多深」的上限）。
   *
   * 这一组钉的不是「好不好看」，是几条**改坏了也看不出来**的机制：
   *
   * ① 填充必须**带色调**（`bg-glass/xx`，不是 `bg-white/xx`），**且三块是同一块料**。
   *    这条防的是「顺手改回白的 / 只调一块」：改回去之后别的断言全绿，
   *    只有使用方再来看一眼才会发现「又没效果了」。
   * ② **必须看得出来** —— 填充压在纸上实际是什么颜色，实算出来与纸的**亮度比**
   *    至少 1.08:1（第一版白玻璃 1.034:1 / 暖中性 1.112:1 / 现行浅绿 1.132:1）。
   *    毛玻璃好不好看没法测，但它**有没有跟纸分开**可以实算。
   *    ⚠️ **改浅绿时差点又栽在这里**：Tailwind 自带的 `emerald-50` 压出来只有
   *    **1.003:1**（比第一版白玻璃还看不见），`emerald-100` 也只有 1.049 ——
   *    **「浅绿」在浅色底上天生更危险**（绿占亮度 0.7152，一提亮就跟纸跑）。
   *    所以这个门槛不是摆设，两个官方浅绿都实打实地被它拦下。
   * ③ 面板上的文字必须在**实际压出来的颜色**上过 AA。色调是连带项：`slate-500`
   *    压旧的 `#fffefc` 是 4.72，压现在这块玻璃只剩 **4.04** —— 所以侧栏里一律不许
   *    再出现 `text-slate-500`。
   * ④ 描边必须**不透明**。边框画在这块**自己背景之上**，`border-white/70` 压在填充上
   *    就是同一个像素 —— 等于没有描边（色调定案之前，白描边压白填充也是这个下场）。
   * ⑤ 两块的吸顶线必须是**同一个值**。sticky 的吸附基准是 border box（实测：
   *    面板 `top-4 m-4` 滚到 900 时 top = 16，不是 16 + 16 = 32），所以两块的
   *    `top-*` 一旦不同步，滚动起来两块顶边就差一截 —— 而**静止态完全正常**，
   *    只有滚起来那一瞬间才露，正是最不容易被发现的那类回归。
   * ⑥ 吸顶必须落在 `top-0`。主区内容不裁剪，钉在 16px 处，上面那 16px 就会漏出
   *    正在滚的表格行（实测截图里能看见半行「再沸器 17 号」悬在导航条上方）——
   *    与 `/intro` 吸顶头部踩过的是**同一个坑**，那边已经吃过一次亏。
   * ⑦ **主区固定大小**（使用方 2026-10-07 圈着主区追加：「红色框选区域固定大小，
   *    也做成液态玻璃栏」）—— 这条只管**机制**，不在这一组里算颜色：
   *    纸定高 → 列是纵向 flex → 导航条 `shrink-0` → 栏 `flex-1 min-h-0 overflow-y-auto`，
   *    **四级缺一级整条就退化**成「栏跟着内容长、页面恢复滚动」。
   *
   *    ⚠️ 这不是推演出来的，是**先量后补的**：第一版只给栏加了 `flex-1 min-h-0`，
   *    verify 全绿、观感也对（内容短的时候栏高正好等于剩下的空间），
   *    但把内容换成 8 份之后实测 **619 → 3157 → 3381px**，页面 scrollHeight 3346（视口 808）——
   *    根因在最顶上那层：外层暖白纸写的是 `min-h-[calc(100vh-2rem)]`，
   *    **那是一个下限不是一个高度**，纸跟着内容长，下面几级再怎么写都白搭。
   *    把 `min-` 去掉之后三种内容下栏高恒为 619，内容在栏内部滚。
   *    所以底下的护栏直接钉**整条链**，不钉单点 —— 单点看着是对的。
   *
   * 另外：模糊值写成 `backdrop-blur-[24px]` 而不是等价的 `backdrop-blur-xl`，
   * 因为 24 是使用方给的**规格数字** —— 写成数字，Tailwind 哪天调了档位，
   * 它不会跟着一块儿飘走。
   */
  const workbench = read(join(SRC, 'views', 'WorkOrderList.vue'))
  const tokensOf = (classAttr) => classAttr.trim().split(/\s+/)

  // 侧栏面板：`id="app-sidebar"` 就在它 class 属性的上一行
  const SIDEBAR = tokensOf(
    (workbench.slice(workbench.indexOf('id="app-sidebar"')).match(/class="([^"]*)"/) || [
      '',
      '',
    ])[1],
  )
  // 导航条：页标题 <h2> 往前数第二个 class 属性 —— 第一个是 h2 自己的，再往前就是包着它的卡片
  const h2At = workbench.indexOf('{{ activeTabLabel }}')
  const cardClassAt = workbench.lastIndexOf('class="', workbench.lastIndexOf('class="', h2At) - 1)
  const NAV = tokensOf(workbench.slice(cardClassAt + 7, workbench.indexOf('"', cardClassAt + 7)))

  const BLUR = 'backdrop-blur-[24px]'
  /*
   * 主区玻璃栏：唯一同时带 `min-h-0` 与 24px 模糊的那个 class 属性
   * （走 class 属性、不走行文本 —— 主区那段注释里也写着 `min-h-0`，
   * 按行扫会把它算进来，就是变更-029 那个探针踩过的坑）。
   */
  const MAIN = tokensOf(
    [...workbench.matchAll(/:?class="([^"]*)"/g)]
      .map((m) => m[1])
      .find((c) => c.includes('min-h-0') && c.includes(BLUR)) || '',
  )
  const PANELS = [
    ['侧栏面板', SIDEBAR],
    ['顶部导航条', NAV],
  ]
  // 三块**同一种料**：材质那几条在 GLASS 上跑。吸顶那条只在 PANELS 上跑 ——
  // 主区栏不吸顶，它自己就是那个滚动的东西，吸顶对它没有意义。
  const GLASS = [...PANELS, ['主区玻璃栏', MAIN]]
  const glassFillOf = (tokens) => tokens.find((t) => /^bg-glass\/\d{1,3}$/.test(t))
  const stickyTopOf = (tokens) => tokens.find((t) => /^top-/.test(t))

  // 玻璃的值与暖白纸的值都只在 tailwind.config.js 里 —— 这里读真值再实算，
  // 不把「#d2e6d8 压出 #e5efe5」这种结论抄成常数（抄了就没人知道它是怎么来的了）
  const config = read(join(ROOT, 'tailwind.config.js'))
  const hexOf = (key) => (config.match(new RegExp(`${key}:\\s*'(#[0-9a-fA-F]{6})'`)) || [])[1]
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const hx = (n) => Math.round(n).toString(16).padStart(2, '0')
  /** 半透明填充压在底色上，实际看到的是这个颜色 */
  const composite = (fill, alpha, under) =>
    '#' +
    rgb(fill)
      .map((c, i) => hx(c * alpha + rgb(under)[i] * (1 - alpha)))
      .join('')
  /** 两块面板「实际压出来」的颜色，测试里所有对比度都该拿它算，不是拿 token 算 */
  const shownOf = (tokens) => {
    const fill = glassFillOf(tokens)
    const alpha = fill ? Number(fill.split('/')[1]) / 100 : null
    return fill ? composite(hexOf('glass'), alpha, hexOf('canvas')) : null
  }

  it('三块玻璃都解析出来了 —— 锚点失效时先在这里红', () => {
    // 上面几个锚点都是从源码文本里「就近取 class」，元素挪了位置或换了写法就会解析空。
    // 与其让后面几条报出莫名其妙的失败，不如在这里说清楚是解析断了。
    expect(SIDEBAR.length, '没从 id="app-sidebar" 后面解析出侧栏面板的 class').toBeGreaterThan(1)
    expect(
      NAV.length,
      '没从「{{ activeTabLabel }}」往前解析出导航条那张卡片的 class',
    ).toBeGreaterThan(1)
    expect(
      MAIN.length,
      '没在源码里找到同时带 min-h-0 与 backdrop-blur-[24px] 的 class —— 主区玻璃栏的锚点断了',
    ).toBeGreaterThan(1)
  })

  it('三个值都在：半透明填充 + 24px 模糊 + **不透明**的白描边', () => {
    for (const [name, tokens] of GLASS) {
      expect(
        tokens,
        `${name}没有 ${BLUR}（模糊必须是 24px 这个数，不用 backdrop-blur-xl）`,
      ).toContain(BLUR)
      expect(
        glassFillOf(tokens),
        `${name}的填充不是带色调的半透明（bg-glass/xx）。写成不透的 bg 它就不是玻璃；` +
          '写回 bg-white/xx 就是第一版那个「没效果」—— 白压在近白的纸上，什么都看不出来。',
      ).toBeTruthy()
      expect(
        tokens,
        `${name}的描边不是**不透明**的 border-white。边框画在它自己背景之上，` +
          'border-white/70 压在填充上就是同一个像素，等于没描边。',
      ).toContain('border-white')
    }
  })

  it('三块是同一块料（同一个填充 token）', () => {
    // 侧栏、导航条、主区栏是同一种材质的三处用法 —— 主区栏最大，占的像素最多，
    // 它一旦跟另外两块不是一个值，整屏立刻分成两种料。
    // 只调一块 → 一块灰一块白，三块不在同一个视线上，静止态很难同时注意到，
    // 但并排看就是坏的。
    for (const [name, tokens] of GLASS) {
      expect(glassFillOf(tokens), `${name}没有填充`).toBeTruthy()
      expect(
        glassFillOf(tokens),
        `${name}用的填充与侧栏不是同一个：${name} ${glassFillOf(tokens)} / 侧栏 ${glassFillOf(SIDEBAR)}。` +
          '它们是同一层材质，要一起改。',
      ).toBe(glassFillOf(SIDEBAR))
    }
  })

  it('玻璃必须看得出来：压在纸上的实际亮度与纸至少差一档（1.08:1）', () => {
    /*
     * 这条是这组磨砂玻璃的**正题**（使用方 2026-10-07 上线看出来的那条）。
     * 第一版三个值全在、verify 全绿，使用方看到的是「没效果」——
     * 75% 白压在 #fdfaf4 上出来是 #fffefc，与纸只差 1.034:1。
     *
     * 「毛玻璃好不好看」测不了，但「它到底有没有跟纸分开」可以实算。
     *
     * ⚠️ **量的是亮度比，不是单通道色差**。第一版给这条护栏写的是「≥ 8 级」
     * （通道差最大值），而白玻璃 75% 的蓝色通道差**正好就是 8** —— 也就是说
     * 这个门槛根本拦不住它要拦的那一版。亮度才是眼睛看的量：冷色纸的蓝通道
     * 差再大，亮度权重里蓝只占 0.0722。三个版本实算：白玻璃 1.034（红）、
     * 暖中性 1.112、**现行浅绿 1.132**，门槛取 1.08 ——
     * 第一版红、现行绿。这不是 WCAG 的阈值（装饰性的材质分层没有阈值），
     * 是为了让「看不出来」这件事**能被测**。调色时可以往浅里调，但调过 1.08
     * 这条就红 —— **改浅绿时它已经拦下过两个官方浅绿**（emerald-50 只有 1.003）。
     */
    const canvasHex = hexOf('canvas')
    expect(canvasHex, '没在 tailwind.config.js 里解析出 colors.canvas').toBeTruthy()
    expect(hexOf('glass'), '没在 tailwind.config.js 里解析出 colors.glass').toBeTruthy()
    for (const [name, tokens] of GLASS) {
      const shown = shownOf(tokens)
      // 没有半透明填充时算不出「压出来是什么颜色」——先说清是这条的前置条件断了，
      // 免得抛一个 TypeError 出来（上面那条已经为它报过一次红，这里只是别把话说糊）
      expect(shown, `${name}没有 bg-glass/xx 填充，这条算不了`).toBeTruthy()
      const ratio = contrast(shown, canvasHex)
      expect(
        ratio,
        `${name}压在纸上算出来是 ${shown}（纸 ${canvasHex}），亮度比 ${ratio.toFixed(3)}:1 —— ` +
          '第一版「上线看不出效果」就是 1.034:1 这个量级。要么把色调调深、要么把' +
          '透明度调低，让它与纸拉开距离（≥ 1.08:1）。',
      ).toBeGreaterThanOrEqual(1.08)
    }
  })

  it('面板上的文字在玻璃上过 AA —— 侧栏里不许再出现 slate-500', () => {
    /*
     * 色调是**连带项**，这条是它的账：全站唯一的弱化文字色 slate-500 压纸是 4.72，
     * 面板一带色调就往下掉 —— 暖中性那版 4.11，**现行浅绿只剩 4.04**，都跌破 AA 的 4.5。
     * 所以侧栏里所有 slate-500 都改成了 slate-600（现行 6.43），
     * 分类标签从 slate-600 提到 slate-700（8.78）保住两级层次。
     *
     * 规则写成「侧栏里一律不许出现 text-slate-500」，而不是逐处判断
     * 「这个 span 里是文字还是图标」：后者要靠人读上下文，护栏判不了。
     * 图标本可以留在 500（走非文字元素的 3:1），但一条不许的规则好守得多。
     *
     * 只认 class 属性里的类名，不认行文本 —— 侧栏的注释里就写着 slate-500，
     * 按行扫会把它也算进来（变更-029 的探针踩过这个坑）。
     */
    const asideBlock = workbench.slice(workbench.indexOf('<aside'), workbench.indexOf('</aside>'))
    const classAttrs = [...asideBlock.matchAll(/:?class="([^"]*)"/g)].map((m) => m[1])
    expect(
      classAttrs.length,
      '没在 <aside> 里解析出 class 属性 —— 锚点断了，先修这条',
    ).toBeGreaterThan(5)
    const tokens = classAttrs.flatMap((a) => a.split(/[\s'"]+/)).filter(Boolean)
    expect(
      tokens.filter((t) => t === 'text-slate-500'),
      '侧栏里还有 text-slate-500：面板带色调之后它压上去只剩 4.04，文字欠 AA。' +
        '文字改成 slate-600（6.43），名字/标签那两级用 slate-600 + slate-700。',
    ).toEqual([])

    // 再实算一遍那两处实际用的颜色 —— 上面扫的是「不许 500」，这里管「600/700 够不够」
    const shown = shownOf(SIDEBAR)
    expect(
      contrast(HEX['slate-600'], shown),
      `slate-600 压在侧栏玻璃 ${shown} 上不到 4.5（提示行、只读浏览用的就是它）`,
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(HEX['slate-700'], shown),
      `slate-700 压在侧栏玻璃 ${shown} 上不到 4.5（分类标签、角色名用的就是它）`,
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('面板上的图标块一律用白 —— 别再用 slate-100', () => {
    /*
     * 这一条是**色调的又一笔连带账**，而且是量出来的：
     *
     *   图标块 `slate-100`（#f1f5f9）与面板的亮度比
     *     改色调之前（白玻璃 #fffefc）  1.087
     *     暖中性那版（#f1eee8）         1.057   ← 面板沉下去，追上了图标块
     *     现行浅绿（#e5efe5）           1.076   ← 其实**低于 1.08 那条线**了
     *
     * 图标块是「这块面板上抬起来的一层」，与**描边**、与导航条的**白药丸**是
     * 同一件事。那两处都是白（`#ffffff` 压现行玻璃 = **1.179**），图标块却留着一个
     * 冷灰色的旧值 —— 一来压在这块带色调的面板上分不开，二来冷灰配绿调面板也打架。
     * 改成白之后三者是**同一个关系**：这块料上，抬起来的一律是白。
     * （绿这一版里这条更硬：slate-100 已经掉到玻璃与纸那条 1.132 之下。）
     *
     * 留着的 `hover:bg-slate-200` 不动：那是**按下**的反馈，要的就是明显变一下，
     * 两级的差比白→白更读得出来。
     */
    const shown = shownOf(SIDEBAR)
    const asideBlock = workbench.slice(workbench.indexOf('<aside'), workbench.indexOf('</aside>'))
    const tokens = [...asideBlock.matchAll(/:?class="([^"]*)"/g)]
      .flatMap((m) => m[1].split(/[\s'"]+/))
      .filter(Boolean)
    expect(
      tokens.filter((t) => t === 'bg-slate-100'),
      '侧栏里还有 bg-slate-100：压在这块带色调的面板上只有 1.076:1，图标块跟面板分不开。' +
        '图标块、收起态的按钮一律用 bg-white —— 与描边、与导航条的白药丸同一套（1.179:1）。',
    ).toEqual([])
    expect(
      contrast('#ffffff', shown),
      `白压在面板 ${shown} 上不到 1.08:1 —— 图标块与描边会一起糊进面板里`,
    ).toBeGreaterThanOrEqual(1.08)
  })

  it('玻璃上直接压的 emerald-700 是这块料的**紧的一头** —— 它定这个绿能染多深', () => {
    /*
     * 玻璃上不带自己底色的东西里，只有 `emerald-700` 这一处文字（品牌那句英文小字）
     * 是贴着线过的：压现行玻璃 4.65，余量 0.15 —— 比 slate-600 的 6.43 紧得多。
     * 换句话说，**往深里染玻璃，先破的是它**（再深一档 #c8e3cf 只剩 4.53）。
     *
     * 上面那条「玻璃必须看得出来」管的是**下限**（别浅到看不见），这条管**上限**
     * （别深到文字跌破 AA）—— 一个色调能取的范围就是这两条之间。少一条，调色
     * 时只会朝一个方向试。
     *
     * 这里的门槛没写成 4.5（那就是上面那条「面板上的文字在玻璃上过 AA」在做的事，
     * 但它扫的是 slate），而是留 0.1 的余量写成 4.6：**4.65 这个实算值本身就是
     * 结论**，写成 4.5 等于把「只剩 0.15」这条信息丢掉 —— 下次有人把玻璃调深
     * 一点点，4.51 也会绿，而那已经紧到不该再动了。
     */
    const shown = shownOf(SIDEBAR)
    const asideBlock = workbench.slice(workbench.indexOf('<aside'), workbench.indexOf('</aside>'))
    const hasEm700 = [...asideBlock.matchAll(/:?class="([^"]*)"/g)].some((m) =>
      m[1].split(/[\s'"]+/).includes('text-emerald-700'),
    )
    expect(
      hasEm700,
      '侧栏里找不到 text-emerald-700 了 —— 这条守的那个「最紧处」没了。' +
        '若是有意改色，请连同这条一起改；别让它守着一个不存在的场景。',
    ).toBe(true)
    const ratio = contrast(HEX['emerald-700'], shown)
    expect(
      ratio,
      `emerald-700 压在侧栏玻璃 ${shown} 上是 ${ratio.toFixed(2)}:1 —— 余量不到 0.1。` +
        '这是全站最紧的一处（现值 4.65），说明这个色调已经深到不能再深：' +
        '要么把玻璃调浅，要么把剩下的这处文字改成 emerald-800（压玻璃 6.52）。',
    ).toBeGreaterThanOrEqual(4.6)
  })

  it('填充的不透明度落在 50~90 之间', () => {
    /*
     * 这条是**通透度**，管的是「玻璃还剩几成通透感」，不是对比度 ——
     * 对比度那条由上面「与纸至少差一档（1.08:1）」管着，两者是两个方向：
     * 透明度往高调（更透）→ 越接近纸；往低调（更实）→ 越接近一块灰板子。
     *
     * 所以它是有意写死的**设计区间**：低于 50 面板与纸趋同、整块发闷，
     * 上一轮「纸是底、卡片才是内容」那层分层就塌了；高于 90 基本是不透明色块，
     * 毛玻璃只剩名字（模糊也无从表现 —— 底下透上来的东西太少）。
     */
    for (const [name, tokens] of GLASS) {
      const fill = glassFillOf(tokens)
      // 先单独判一次「有没有半透明填充」，免得下面 split 出个 TypeError 把话说糊
      expect(fill, `${name}没有带色调的半透明填充（bg-glass/xx）`).toBeTruthy()
      const alpha = Number(fill.split('/')[1])
      expect(
        alpha,
        `${name}的填充不透明度 ${alpha}% 落在 50~90 之外 —— 这是设计区间，` +
          '理由见这条用例上面那段注释（不是对比度算出来的）。',
      ).toBeGreaterThanOrEqual(50)
      expect(alpha, `${name}的填充不透明度 ${alpha}% 落在 50~90 之外`).toBeLessThanOrEqual(90)
    }
  })

  it('两块都吸顶，且吸在同一条线上（都 top-0）', () => {
    expect(SIDEBAR, '侧栏面板没吸顶').toContain('sticky')
    expect(
      NAV,
      '导航条没吸顶 —— 不吸顶它滚过去就没了，那块 24px 模糊底下永远没有东西经过，等于白写。',
    ).toContain('sticky')
    expect(
      stickyTopOf(NAV),
      '导航条的吸顶落点不是 top-0。钉在 top-4 会让它上方空出 16px，正在滚的表格行' +
        '就从那条缝里划过去（/intro 的吸顶头部踩过同一个坑，实测截图里能看见半行内容悬在它上方）。',
    ).toBe('top-0')
    expect(
      stickyTopOf(SIDEBAR),
      `两块的吸顶线不同（侧栏 ${stickyTopOf(SIDEBAR)} / 导航条 ${stickyTopOf(NAV)}）：` +
        '滚动起来两块顶边会差一截，而静止态完全正常 —— 只有滚起来才看得出来。',
    ).toBe(stickyTopOf(NAV))
  })

  it('导航条带 z 轴 —— 别让底下的卡片盖住它', () => {
    // 吸顶元素本身就会盖住非定位流内容；但只要有**任何**一张内容卡片加了
    // position: relative（给角标、给浮层都会加），它就会反过来盖住导航条。
    expect(
      NAV.some((t) => /^z-\d+$/.test(t)),
      '导航条没有 z-*：底下任意一张卡片加个 position: relative 就会盖在它上面。',
    ).toBe(true)
  })

  /*
   * —— 固定大小那条链上的四个元素 ——
   * 全部走 class 属性取，不走行文本：这几段的注释里就写着 `min-h-0`、`flex-col`、
   * `h-[calc(100vh-…)]`，按行扫会把注释当成代码（变更-029 的探针踩过这个坑）。
   */
  const MAIN_EL = tokensOf((workbench.match(/<main class="([^"]*)"/) || ['', ''])[1])
  // 暖白纸：`<main>` 之后的第一个 <div class="…">（中间那段注释里没有 class=）
  const PAPER = tokensOf(
    (workbench.slice(workbench.indexOf('<main class="')).match(/<div class="([^"]*)"/) || [
      '',
      '',
    ])[1],
  )
  // 主区列：`</aside>` 之后的第一个 class 属性
  const COLUMN = tokensOf(
    (workbench.slice(workbench.indexOf('</aside>')).match(/:?class="([^"]*)"/) || ['', ''])[1],
  )

  it('固定大小的四个元素都解析出来了 —— 锚点失效时先在这里红', () => {
    expect(MAIN_EL.length, '没解析出 <main> 的 class').toBeGreaterThan(0)
    expect(PAPER.length, '没解析出暖白纸的 class').toBeGreaterThan(0)
    expect(COLUMN.length, '没从 </aside> 后面解析出主区列的 class').toBeGreaterThan(0)
  })

  it('固定大小：纸定高 + 列是纵向 flex + 导航条 shrink-0 + 栏 flex-1/min-h-0/overflow-y-auto', () => {
    /*
     * 使用方 2026-10-07 圈着主区：「红色框选区域**固定大小**，也做成液态玻璃栏」。
     *
     * 这条钉的是**整条链**，不是某一点 —— 因为「只写对一半」的时候观感**完全正常**：
     * 内容短的时候，栏高正好等于剩下的空间，怎么量都对。
     *
     * 实测（无头 Chrome，内容 8 份 vs 现状，视口 808）：
     *   只给栏加 flex-1 min-h-0（纸还是 min-h-）  619 → 3157 → 3381px，页面 scrollHeight 3346 ✗
     *   把纸的 min- 去掉                       619 →  619 →  619px，页面 scrollHeight  808 ✓
     * 根因在最上面那层：`min-h-[calc(100vh-2rem)]` 是**下限不是高度**，纸跟着内容长，
     * 下面几级再怎么写都白搭。
     *
     * 另外两条写进护栏的理由：
     * - **`min-h-0` 不能省**：flex 项默认 `min-height: auto`，意思是「不许比内容矮」，
     *   栏会被内容顶开、`overflow-y-auto` 永远不触发。
     * - **不给栏手算 `h-[calc(100vh-…)]`**：导航条的高度不是常数（页签换行、字体回退都会变），
     *   把它减进 calc 里，改天导航条长高一行，主区就跟着错位。交给 flex 分配，
     *   导航条占它该占的，剩下的全归栏。
     */
    expect(
      PAPER,
      '暖白纸不是定高：写的是 min-h-* 之类。**下限不是高度** —— 纸会跟着内容长，' +
        '主区栏就退回「跟着内容长」，实测 619 → 3381px、整页多出一条滚动条。',
    ).toContain('h-[calc(100vh-2rem)]')
    expect(
      PAPER.filter((t) => /^min-h-/.test(t)),
      '暖白纸同时挂着 min-h-* 与定高 —— 下限会把定高顶开，等于没有定高。',
    ).toEqual([])

    expect(COLUMN, '主区列不是 flex 容器').toContain('flex')
    expect(COLUMN, '主区列不是 flex-col —— 导航条与栏要纵向分配高度，这个方向不能省。').toContain(
      'flex-col',
    )
    expect(COLUMN, '主区列少了 min-w-0：表格宽的时候会把侧栏挤走').toContain('min-w-0')

    expect(
      NAV,
      '导航条没有 shrink-0：空间不够时 flex 会先压它，导航条被压扁、栏反而拿多了高度。',
    ).toContain('shrink-0')

    expect(MAIN, '主区栏没有 flex-1 —— 它就拿不到「导航条之外剩下的」那份高度').toContain('flex-1')
    expect(
      MAIN,
      '主区栏没有 min-h-0：flex 项默认 min-height:auto（不许比内容矮），' +
        '栏会被内容顶开，overflow-y-auto 永远不触发。',
    ).toContain('min-h-0')
    expect(MAIN, '主区栏没有 overflow-y-auto —— 内容超出时就没得滚了').toContain('overflow-y-auto')
  })

  it('纸上那个数必须与 main 的上下内边距对得上（100vh − 上下 p-*）', () => {
    /*
     * 静态外壳的算术（原注释在暖白纸那一处）：
     *   main 的 p-4 (16) + 纸 + main 的 p-4 (16) = 100vh   ⇒ 纸 = 100vh − 32px
     * 纸正好是一整屏，页面才不会凭空多出一条滚动条。
     * 这条把它算出来比对：谁改了 main 的上下内边距而没同步改纸上的数，这里就红。
     */
    const padToken = MAIN_EL.find((t) => /^p-\d/.test(t)) ?? MAIN_EL.find((t) => /^py-\d/.test(t))
    const steps = padToken ? Number(padToken.replace(/^py?-/, '')) : NaN
    expect(
      Number.isFinite(steps),
      `没从 <main class="…"> 里认出上下内边距（现在的写是 ${padToken}）`,
    ).toBe(true)
    // Tailwind 一档 = 0.25rem，上下两边合起来就是 0.5rem × 档数
    const expected = `h-[calc(100vh-${steps * 0.5}rem)]`
    expect(
      PAPER,
      `main 的 ${padToken} 意味着纸应当是 ${expected}，实际是 ${
        PAPER.find((t) => /^h-\[calc/.test(t)) ?? '（没有定高）'
      } —— 两者不等，纸就不再是一整屏，多出来或少掉的那几像素会变成一条页面滚动条。`,
    ).toContain(expected)
  })
})

// ---------------------------------------------------------------------------
// 12. 键盘可达：可点的非按钮元素必须有键盘通路
// ---------------------------------------------------------------------------

describe('可点的非按钮元素必须有键盘通路（变更-033）', () => {
  /*
   * 守的是一类静态扫描查不出来、只有真按键盘走一遍才会撞见的问题：
   * 元素拿 @click 当按钮使，对键盘却完全不可达（tab 不到、回车没反应）。
   * 判据不钉具体文件，而是「有 @click 就必须配 tabindex + 键盘处理」，
   * 新写的可点元素也会被拦下。
   *
   * 顺带统一的两点，回归时也按这个纠：
   *   · <tr> 的焦点圈用 outline + 负偏移 —— table-row 上的 box-shadow/ring
   *     不可靠，且在 overflow-x-auto 容器里会被裁掉；
   *   · 行内小图标按钮的焦点圈用 ring-emerald-600（在 RING_OK 白名单里）。
   */
  const VUE_FILES = SOURCE_FILES.filter((f) => f.endsWith('.vue'))

  /** 收集某标签的全部开始标签（含跨行属性），带上它的字符偏移 */
  function openTags(text, tag) {
    const tags = []
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?>`, 'g')
    for (const m of text.matchAll(re)) tags.push({ tag: m[0], index: m.index })
    return tags
  }

  const locationOf = (text, index) => text.slice(0, index).split(/\r?\n/).length

  it('@drop 的 <section> 必须同时是键盘可达的「按钮」（拖拽要有单指针替代）', () => {
    const offenders = []
    for (const file of VUE_FILES) {
      const text = read(file)
      for (const { tag, index } of openTags(text, 'section')) {
        if (!/@drop\b/.test(tag)) continue
        const at = `${rel(file)}:${locationOf(text, index)}`
        if (!/role="button"/.test(tag)) offenders.push(`${at} 缺 role="button"`)
        if (!/:?tabindex=/.test(tag)) offenders.push(`${at} 缺 tabindex`)
        if (!/@keydown\.enter/.test(tag)) offenders.push(`${at} 缺 @keydown.enter`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('整行可点的 <tr> 必须同时能被键盘激活', () => {
    const offenders = []
    for (const file of VUE_FILES) {
      const text = read(file)
      for (const { tag, index } of openTags(text, 'tr')) {
        if (!/@click\b/.test(tag)) continue
        const at = `${rel(file)}:${locationOf(text, index)}`
        if (!/:?tabindex=/.test(tag)) offenders.push(`${at} 缺 tabindex`)
        if (!/@keydown\.enter/.test(tag)) offenders.push(`${at} 缺 @keydown.enter`)
        if (!/focus-visible:outline/.test(tag)) offenders.push(`${at} 缺 focus-visible 焦点样式`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('可点的 <span> 必须带 role 与键盘通路', () => {
    const offenders = []
    for (const file of VUE_FILES) {
      const text = read(file)
      for (const { tag, index } of openTags(text, 'span')) {
        if (!/@click\b/.test(tag)) continue
        const at = `${rel(file)}:${locationOf(text, index)}`
        if (!/:?role=/.test(tag)) offenders.push(`${at} 缺 role`)
        if (!/:?tabindex=/.test(tag)) offenders.push(`${at} 缺 tabindex`)
        if (!/@keydown\.enter/.test(tag)) offenders.push(`${at} 缺 @keydown.enter`)
      }
    }
    expect(offenders).toEqual([])
  })
})
