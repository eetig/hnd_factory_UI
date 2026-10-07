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
    ['text-slate-400', '对白底 2.56:1、对 slate-50 2.45:1，都不过 AA。弱化文字一律 slate-500'],
    ['placeholder:text-slate-300', '占位符也是文字，1.48:1。用 slate-500'],
    ['text-red-', '错误色一律 rose。同一个语义不允许两种色相'],
    ['bg-sky-600', '白字压 sky-600 只有 4.10:1。实心主按钮一律 sky-700（5.93）'],
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
  'emerald-700': '#047857',
  'amber-50': '#fffbeb',
  'amber-100': '#fef3c7',
  'amber-700': '#b45309',
  'amber-800': '#92400e',
  'sky-50': '#f0f9ff',
  'sky-100': '#e0f2fe',
  'sky-600': '#0284c7',
  'sky-700': '#0369a1',
  'slate-100': '#f1f5f9',
  'slate-600': '#475569',
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
      expect(documented, `新加了 ${tone}，请把实算比值写进 statusTones.js 的注释与本表`).toBeTruthy()
      const { bg, text } = parseTone(tone)
      // STATUS_TEXT 是白底内联文字，没有 bg- 前缀
      expect(contrast(text, bg ?? HEX.white)).toBeCloseTo(documented, 1)
    })
  }
})

describe('主按钮填充色', () => {
  it('sky-700 压白字过 AA', () => {
    expect(contrast(HEX['sky-700'], HEX.white)).toBeGreaterThanOrEqual(4.5)
  })

  it('sky-600 压白字不过 —— 这就是主按钮为什么不能停在 -600', () => {
    // 钉住这条，是为了让日后「统一调成 sky-600 更好看」的改动直接失败。
    // sky 色阶里只有 -700 这一档的白字过 AA。
    expect(contrast(HEX['sky-600'], HEX.white)).toBeLessThan(4.5)
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
      (file) => /animation:[^;]*\binfinite\b/.test(read(file)) && !/prefers-reduced-motion/.test(read(file)),
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
