import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATUS_TONE, STATUS_ICON_TONE, STATUS_TEXT } from '../../src/constants/statusTones'
import tailwindConfig from '../../tailwind.config.js'
// 走 `tailwindcss/colors.js` 而不是 `tailwindcss/colors`：后者在 Node 的原生解析下
// 找不到（这个版本的包没有 exports 映射），本文件要能在 vitest 里直接跑。
import tailwindColors from 'tailwindcss/colors.js'

/**
 * 视觉回归护栏 —— 变更-043 版（中性清水玻璃）。
 *
 * 这里只钉两类东西：**已经做过全仓扫描才定下来的类名**，和**靠人眼看不出来的
 * 对比度**。两者都会在有人把旧代码块粘进新页签时静默回归 —— 今天看起来对，
 * 明天多一个面板就退回去了。
 *
 * 变更-043 使用方看过 042 的蓝 Liquid Glass 后一句「不要蓝色，做成透明」，
 * 整套配色换成「桌面（desk）→ 中性柔光场（canvas + .glass-field）→
 * 轻纱侧栏 + 霜面两栏（两档清水玻璃）+ 石墨黑主色」，这份契约跟着整体重写。
 * 三条读法，读之前先看：
 *
 *   ① **数值全部由本文件自己的 luminance/contrast/composite 复算。**
 *      文件里引用到的每一个比值（16.83 / 13.8 / 1.046 / 1.08 …）在断言里都
 *      找得到对应的实算 —— 注释抄错了、取值被改了，先红的会是断言，不是屏幕。
 *   ② **两档玻璃是逐 token 锚定的**（轻纱侧栏 / 霜面两栏）。039~043 之间出过
 *      "只调一块" 的回归，就是在这条上冒出来的。
 *   ③ **场配方从 glass-effects.css 里解析出来用**：底停必须逐位等于
 *      colors.canvas；两团光斑的 α 有硬上限。这是 spec 与 CSS 之间唯一的
 *      跨文件约束 —— 改一边就必须改另一边。
 *
 * 刻意不做的事（都是过度工程）：
 *   · axe / pa11y —— 新依赖，且要真浏览器，跑不进 verify 的 jsdom。
 *   · 组件级对比度断言 —— jsdom 不算样式，解析不出文字背后到底是哪一层背景，
 *     而那恰恰是这件事唯一有意思的部分。那一半留在人工目视 +
 *     `_runlogs/liquid-cdp.mjs`（无头 Chrome 真像素采样，与这份静态契约互补）。
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

/**
 * 剥注释 —— **色值字面量的扫描必须先过这一道**。
 *
 * 本仓的注释大量引用色值与类名（「旧值 #fdfaf4 已退役」「白压 #0071E3 是 4.70」
 * 「`:class=text-emerald-700` 换成 brand」），那些是**记录，不是用法**。把注释
 * 算进字面量护栏，等于逼着人把最该保留的取值论证删掉 —— 040 那轮就发生过：
 * 往注释里补算账数字，护栏先红。
 *
 * 剥法是**保持行号不变**的：注释内容替换成等量空白（块注释）或整行清空
 * （行注释，`$` 前的替换不动换行符），所以报出来的 `路径:行号` 仍能直接跳。
 * 只认三种形态：模板 `<!-- -->`、块注释、以及**整行**的 `//`（行尾注释与
 * URL 里的 `//` 不动 —— 前者在当前代码里没出现过，后者一旦剥错会把真代码删掉）。
 */
const stripComments = (src) =>
  src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '')

// ---------------------------------------------------------------------------
// 0. 共用工具：对比度 / 混色 / 类名解析
// ---------------------------------------------------------------------------

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

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const hx = (n) => Math.round(n).toString(16).padStart(2, '0')

/** 半透明填充压在底色上，实际看到的是这个颜色（浮点截断，够用） */
const composite = (fill, alpha, under) =>
  '#' +
  rgbOf(fill)
    .map((c, i) => hx(c * alpha + rgbOf(under)[i] * (1 - alpha)))
    .join('')

/*
 * 项目自己的 token（tailwind.config.js 的 `colors`）**不往 HEX 表里抄**。
 *
 * HEX 表是 **Tailwind 内置调色板**的副本，用来校验 statusTones 这类把色阶写死的
 * 字符串 —— 那些值不会变，抄一份是安全的。本项目自己的 token 不一样：它们是
 * **一串决定**，随时会被下一轮调色改掉。抄进表里就意味着 config 改了、护栏还在
 * 拿旧值算，**照样全绿** —— 036 / 037 的调色正是这样绕过了一批注释里的数字。
 * 所以现读。
 *
 * ⚠️ 041 修过一处：带连字符的 key 在 config 里是**带引号**写的（`'brand-deep':`），
 *    旧正则只认裸 key，这一类 key 会一个都读不出来（读到 undefined 后
 *    算出来是 NaN —— NaN ≥ 4.5 为 false，但报错信息毫无线索）。正则必须容忍引号。
 */
const CONFIG_SRC = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8')
const tokenHex = (key) =>
  (CONFIG_SRC.match(new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]?(#[0-9a-fA-F]{6})['"]?`)) || [])[1]

/** 颜色名 → hex：先 HEX（内置调色板），再 tokenHex（本项目 token） */
const hexOfColor = (name) => HEX[name] ?? tokenHex(name)

/*
 * 场与两档玻璃的**最坏底色** —— 好几组的账都要在「文字实际压在哪」上算，而那个
 * 颜色不是任何一个 token：是「纸 → 玻璃（半透明 + blur）」叠出来的。
 *
 * .glass-field 的三段渐变从 CSS 里**解析**（不抄）：配方一改，下面所有
 * 「压在场上 / 轻纱上 / 霜面上的字与卡片」的账全部跟着变，不会有一组还守着旧值。
 * 解析失败时 FIELD_STOPS 为空 → 场组里那条锚点测试先红，别处不会拿 NaN 硬算。
 */
const GLASS_CSS = read(join(SRC, 'glass-effects.css'))
const fieldBlock = (GLASS_CSS.match(/\.glass-field\s*\{([\s\S]*?)\}/) || ['', ''])[1]
const FIELD_STOPS = [...fieldBlock.matchAll(/#([0-9a-fA-F]{6})\s+(\d+)%/g)].map((m) => `#${m[1]}`)
/** 两团光斑：主色 + 同色 0 α 收尾各一条，所以「第 N 团」= 第 2N-1 条（α > 0 那条） */
const FIELD_BLOBS = [...fieldBlock.matchAll(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/g)].map((m) => ({
  hex: '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join(''),
  alpha: Number(m[4]),
}))
const FIELD_WHITE_ALPHA = FIELD_BLOBS[0] ? FIELD_BLOBS[0].alpha : NaN

/**
 * 代表点：三段渐变的三个停点 + 白斑最亮处（白斑在纸的左上，40% 白压在首停上）。
 * 白斑处是**所有文字/卡片的共同最坏情况** —— 压得越亮，深字的对比度越低。
 * （分离比那两对判定时**不用**白斑点，理由写在 describe 11 / 12 的两条上。）
 */
const underlayList =
  FIELD_STOPS.length === 3
    ? [
        ['最亮端', FIELD_STOPS[0]],
        ['中间', FIELD_STOPS[1]],
        ['最深端', FIELD_STOPS[2]],
        [
          '白斑处',
          composite(
            '#FFFFFF',
            Number.isFinite(FIELD_WHITE_ALPHA) ? FIELD_WHITE_ALPHA : 0,
            FIELD_STOPS[0],
          ),
        ],
      ]
    : []
/** 分离比判定用的三个点（不含白斑 —— 它是个角落尖峰，另有探针专测） */
const gradientPoints = underlayList.filter(([name]) => name !== '白斑处')

const WORKBENCH = read(join(SRC, 'views', 'WorkOrderList.vue'))
const tokensOf = (classAttr) => classAttr.trim().split(/\s+/).filter(Boolean)

// 侧栏面板：`id="app-sidebar"` 就在它 class 属性的上一行
const SIDEBAR = tokensOf(
  (WORKBENCH.slice(WORKBENCH.indexOf('id="app-sidebar"')).match(/class="([^"]*)"/) || ['', ''])[1],
)
// 导航条：页标题 <h2> 往前数第二个 class 属性 —— 第一个是 h2 自己的，再往前就是它
const h2At = WORKBENCH.indexOf('{{ activeTabLabel }}')
const navClassAt = WORKBENCH.lastIndexOf('class="', WORKBENCH.lastIndexOf('class="', h2At) - 1)
const NAV = tokensOf(WORKBENCH.slice(navClassAt + 7, WORKBENCH.indexOf('"', navClassAt + 7)))
// 主区玻璃栏：唯一同时带 `min-h-0` 与 30px 模糊的那个 class 属性（走 class 属性、
// 不走行文本 —— 主区那段注释里也写着 min-h-0，按行扫会把它算进来）
const MAIN = tokensOf(
  [...WORKBENCH.matchAll(/:?class="([^"]*)"/g)]
    .map((m) => m[1])
    .find((c) => c.includes('min-h-0') && c.includes('backdrop-blur-[30px]')) || '',
)

const fillOf = (tokens, kind) => tokens.find((t) => new RegExp(`^bg-${kind}/\\d{1,3}$`).test(t))
const alphaOf = (fill) => (fill ? Number(fill.split('/')[1]) / 100 : null)
const stickyTopOf = (tokens) => tokens.find((t) => /^top-/.test(t))

const VEIL_HEX = tokenHex('veil')
/** 轻纱料实际压出来的颜色（alpha 从侧栏自己的 class 里读，不抄常量） */
const VEIL_SHOWN =
  VEIL_HEX && underlayList.length
    ? underlayList.map(([name, under]) => [
        name,
        composite(VEIL_HEX, alphaOf(fillOf(SIDEBAR, 'veil')) ?? 0.55, under),
      ])
    : []
/** 霜面料实际压出来的颜色（同上，/55） */
const FROST_ALPHA = alphaOf(fillOf(NAV, 'white')) ?? 0.55
const FROST_SHOWN = underlayList.length
  ? underlayList.map(([name, under]) => [name, composite('#ffffff', FROST_ALPHA, under)])
  : []
/** 卡片（raised/95 压霜面）实际压出来的颜色 —— 内联状态文字、弱化文字的基线 */
const CARD_SHOWN = FROST_SHOWN.map(([name, frost]) => [name, composite('#ffffff', 0.95, frost)])
const CARD_WORST = (CARD_SHOWN.find(([name]) => name === '白斑处') || [])[1]

/*
 * `class="…"` / `:class="…"` 的通用解析。两条分开的规矩：
 *   · lineClassTokens —— **逐行**取静态 class 属性（页面根、纸这类单行标记用）；
 *   · classAttrsOf    —— 收**整个属性**（不跨行丢引号），:class 里是 JS 表达式，
 *     类名两头贴着引号，所以按 `[\s'"]+` 拆（沿用 037 那轮量过的写法）。
 */
const lineClassTokens = (line) =>
  [...line.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].trim().split(/\s+/))
const lineHasToken = (line, token) => lineClassTokens(line).includes(token)

const classAttrsOf = (text) =>
  [...text.matchAll(/:?class="([^"]*)"/g)].map((m) => ({
    tokens: m[1].split(/[\s'"]+/).filter(Boolean),
    line: text.slice(0, m.index).split(/\r?\n/).length,
  }))

const CARD_RADIUS = /^rounded-(card|[tblr]-card|(?:tl|tr|bl|br)-card)$/

// ---------------------------------------------------------------------------
// 1. 禁用类名
// ---------------------------------------------------------------------------

describe('禁用类名不得回流', () => {
  const BANNED = [
    [
      'text-slate-400',
      '对白底 2.56:1，都不过 AA。弱化文字一律 slate-500（字号更小的用 slate-600）',
    ],
    ['placeholder:text-slate-300', '占位符也是文字，1.48:1。用 slate-500'],
    ['text-red-', '错误色一律 rose。同一个语义不允许两种色相'],
    ['bg-sky-600', '天蓝是上一代主色。再出现说明有代码块从旧版本被粘回来，不是新写的'],
    [
      'bg-cyan-',
      '青色是更早一代的遗留。全仓曾只剩一处（周统计表表头 bg-cyan-100），' +
        '变更-036 已清掉。它就在上面那条 sky 的眼皮底下活了一整轮 —— 那条只认 `sky-`，' +
        '**认不出 `cyan-`**，而这正是它需要的护栏：同一个「上一代底色」有两个色相的名字，' +
        '只堵一个等于没堵',
    ],
    ['rgb(0, 0, 0)', '全站墨色是 slate-900 #0f172a，不用纯黑'],
    ['text-[10px]', '10px 太小。角标用 text-xs（12px）'],
    [
      'bg-glass',
      '`glass` 色在变更-041 退役（两代基底 smoke → 043 的 veil 都没让这个名字复活）——' +
        ' Tailwind 对未知类静默不生成，`bg-glass` 不会报错、只会什么都不画。' +
        '见到它就说明有旧代码块被粘回来',
    ],
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

  it('emerald 类名只许作为「成功」语义存在（statusTones + 三处数据/成功文字）', () => {
    /*
     * 变更-041 把主色换成苹果蓝、043 又换成石墨黑之后，emerald 从 chrome（按钮、
     * 选中态、焦点环、链接、品牌小字）里整体退场 —— 绿只剩「成功 / 正常」一个含义。
     *
     * 扫的是 **class 属性里的 token**（注释先剥掉 —— 历史论证里会提到
     * emerald-700/800，那是记录不是用法），但**白名单认整行**：
     * WorkOrderImport 的「解析完成」在正文文本里、ImageParse 的 successCount
     * 在插值里，都不在 class 属性内 —— 拿属性当白名单载体，这两处合法的
     * 成功语义会被误判成回流（第一版就是这么红的）。
     *
     * 白名单是三处**数据/成功语义**（各自有行内论证）：
     *   · WorkOrderList 体积增减 `vesselVolumeDelta` —— 数据本身的符号色；
     *   · WorkOrderImport「解析完成」、ImageParse 成功条数 —— 成功态文字。
     * statusTones.js 整份豁免（success 语义色的唯一定义处）。
     */
    const SEMANTIC = /vesselVolumeDelta|解析完成|successCount/
    const offenders = []
    for (const file of SOURCE_FILES) {
      if (file.endsWith('statusTones.js')) continue
      const stripped = stripComments(read(file))
      const lines = stripped.split(/\r?\n/)
      for (const { tokens, line } of classAttrsOf(stripped)) {
        const hit = tokens.filter((t) => /(?:^|:)text-emerald-\d{2,3}$|^bg-emerald-/.test(t))
        if (!hit.length) continue
        if (SEMANTIC.test(lines[line - 1] ?? '')) continue
        offenders.push(`${rel(file)}:${line} ${hit.join(' ')}`)
      }
    }
    expect(
      offenders,
      'emerald 类名回流了。主色历经苹果蓝（041）到石墨黑（043），绿只留「成功/正常」' +
        '一个含义：chrome 用 brand、数据/成功的那三处有白名单，别处出现就是旧代码块被粘回来。',
    ).toEqual([])
  })

  it('旧三代的色值字面量不得回流 —— 类名护栏漏得过 scoped CSS', () => {
    /*
     * 类名护栏（上面几条）只认 token 形态。变更-033 就吃过一次亏：`.vessel-select`
     * 的聚焦环是一行 scoped CSS 里的裸 `rgb(14 165 233)`（天蓝），在护栏底下活了
     * 一整轮；037~041 两代换色又留下过暖白与翡翠绿的字面量。这里把三代旧值的
     * 常用写法按字面量一起钉死：
     *   · 037 暖白体系的四个值（纸 #fdfaf4、表头 #f7f4ee、玻璃 #e0ddd7、绿 #047857）；
     *   · emerald 全族的十六进制；
     *   · 翡翠绿两处 scoped 聚焦环的裸 rgb（emerald-600 / emerald-100）。
     */
    const OLD_LITERALS = [
      /#(fdfaf4|f7f4ee|e0ddd7|047857|059669|065f46|10b981|34d399|6ee7b7|a7f3d0|d1fae5|ecfdf5)\b/i,
      /rgba?\(\s*224[\s,]+221[\s,]+215\s*\)/i, // 037 的玻璃色调（探针在 computed 里抓到过）
      /rgba?\(\s*5[\s,]+150[\s,]+105\s*\)/i, // emerald-600 裸 rgb
      /rgba?\(\s*16[\s,]+185[\s,]+129\s*\)/i, // emerald-500 裸 rgb
      /rgba?\(\s*209[\s,]+250[\s,]+229\s*\)/i, // emerald-100 裸 rgb
    ]
    /*
     * 图上 Δ 的**数据色**是唯一例外：rose=降 / emerald=升 是数据语义（液位差
     * 剖面线、引线标注），041 的验收口径也把它划在配色改动之外 —— 改它会改变
     * 读数，不是改样式。046 把这两支色收进 VESSEL_DELTA_COLOR 常量（画布剖面线、
     * 引线标注、滑块钮间色带三处共用），于是放行的精确串就是**常量定义那一行**
     * —— 写死它同样能防顺手把两支颜色都换掉，且裸字面量收敛到只剩这一处
     * （§18 再钉它的唯一性）。
     */
    const DATA_COLOR = /VESSEL_DELTA_COLOR = \{ consume: '#e11d48', increase: '#059669' \}/
    const offenders = []
    for (const file of SOURCE_FILES) {
      stripComments(read(file))
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (DATA_COLOR.test(line)) return
          for (const re of OLD_LITERALS) {
            if (re.test(line)) offenders.push(`${rel(file)}:${index + 1}`)
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
  // 043 补两档：轻纱侧栏的深字族（slate-900 主标题）与场组「深字压场」的账
  'slate-800': '#1e293b',
  'slate-900': '#0f172a',
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
    /*
     * ⚠️ **基线在 037 从 `#ffffff` 锚到暖白卡，041 起锚在「卡片实压色」上。**
     * 这几行内联状态文字是压在**卡片**上的，而卡片 = `raised/95` 压霜面玻璃。
     * 基线不取常量白、也不取 token raised，取 **CARD_WORST**（白斑处叠出来的
     * 最坏值）—— 拿一个屏幕上不存在的底色去验，全绿但与屏幕无关。
     *
     * 这条基线随场配方联动（CARD_WORST 从 CSS 解析来的渐变推出来）：场调浅、
     * 卡片调透，压在上面的 rose-600 都会跟着动。043 的实算**回到了白底那一列**：
     * 浅场 + 55% 白玻璃把白斑处的霜面推到 ~#fbfbfc，再叠 95% 白卡就（四舍五入）
     * 是纯白 —— rose-600 4.70 / emerald-700 5.48 / amber-700 5.02，全过，rose 余量最小。
     */
    it(`STATUS_TEXT.${name} = ${tone}（卡片实压底色上）`, () => {
      const { text, textName } = parseTone(tone)
      expect(text, `未知字色 text-${textName}，请补进 HEX 表并重算比值`).toBeTruthy()
      const baseline = CARD_WORST ?? tokenHex('raised')
      expect(baseline, '没解析出卡片实压底色（场配方或 raised 断了），先修场/霜面组').toBeTruthy()
      expect(contrast(text, baseline)).toBeGreaterThanOrEqual(4.5)
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
    /*
     * 下面三行锚在**卡片实压底色**上（白斑处的 raised/95）。
     * 041 的雾白把三行从白底一列拉低了 0.04（4.70→4.66）；043 的清水玻璃又推回来：
     * 浅场 + 55% 白玻璃 + 95% 白卡在白斑处叠出来（四舍五入）就是纯白，
     * 三行回到白底那一列 —— statusTones.js 的注释同步写得也是这一列。
     */
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
      /*
       * STATUS_TEXT 是没有 bg- 前缀的内联文字 —— 它压在**卡片**上。
       * 兜底值在 041 起是卡片实压色（同上一组的理由）：留在纯白就是拿一个
       * 屏幕上不存在的底色去验，数字全对、也全绿，只是与屏幕无关 ——
       * 正是这个文件最该避免的那种绿。
       */
      expect(contrast(text, bg ?? CARD_WORST ?? tokenHex('raised'))).toBeCloseTo(documented, 1)
    })
  }
})

// ---------------------------------------------------------------------------
// 3. 品牌色的阈值账（主按钮 / hover / 浅底文字）
// ---------------------------------------------------------------------------

describe('主按钮与品牌色的阈值账（变更-043）', () => {
  /*
   * 使用方 2026-10-11 拍的第二代主色：**石墨黑 #1D1D1F**（macOS 风）。
   * 与 041 的苹果蓝最大的区别是**余量**：白字压 #0071E3 只有 4.70（贴线），
   * 压石墨是 16.83 —— 041 时代靠「拆三档 + vivid 只做图形」绕开的那些阈值
   * 问题，在石墨下全部消失，所以 brand-vivid 整键退役
   *（tailwind.config.js 里已经没有它）。
   *
   *   brand       #1D1D1F  实心按钮 / 选中胶囊 / 焦点环（白字 16.83 ✓✓）
   *   brand-deep  #171719  浅底文字 / hover（白底 17.90；= EP dark-2，同源）
   *   浅底三档     #E8E8E9 / #D2D2D2 / #BBBBBC（= EP light-9/8/7 同源值）
   *
   * 这一组钉两件事：①白字在 brand / brand-deep 上都过（余量很大）；
   * ②深字压三档浅底都过 —— 041 时代「brand-200 上不许垫文字」的禁令随之退役。
   */
  const brand = tokenHex('brand')
  const deep = tokenHex('brand-deep')

  it('brand 压白字过 AA（16.83 —— 石墨主色自己的余量）', () => {
    expect(brand, 'tailwind.config.js 里没有 colors.brand').toBeTruthy()
    expect(contrast(brand, HEX.white)).toBeGreaterThanOrEqual(4.5)
  })

  it('brand-deep 也过（17.90）—— hover 态不许把白字拖破', () => {
    // 实心按钮的 hover 是 bg-brand-deep：白字在**两个状态**上都要过，
    // 否则鼠标准星移上去的那一瞬间文字就欠对比度了。
    expect(deep, 'tailwind.config.js 里没有 colors.brand-deep').toBeTruthy()
    expect(contrast(deep, HEX.white)).toBeGreaterThanOrEqual(4.5)
  })

  it('brand-vivid 整键退役 —— 它存在的理由（白字过不了主档）在石墨下不成立', () => {
    /*
     * 041 的 #0A84FF 是拆出来做「光晕 / 浅底图形」的第三档。043 换石墨之后：
     * 白字余量 16.83、图形不再需要单独一档（选中胶囊用实底 + 白描边环），
     * 它连一个用例都没有了 —— 配置里删掉，类名侧也不许回流。
     */
    expect(
      tokenHex('brand-vivid'),
      'tailwind.config.js 里又出现了 colors.brand-vivid —— 它已随蓝系整键退役' +
        '（详见 tailwind.config.js 的注释）',
    ).toBeUndefined()
    const offenders = []
    for (const file of SOURCE_FILES) {
      for (const { tokens, line } of classAttrsOf(stripComments(read(file)))) {
        const hit = tokens.filter((t) => t.includes('brand-vivid'))
        if (hit.length) offenders.push(`${rel(file)}:${line} ${hit.join(' ')}`)
      }
    }
    expect(
      offenders,
      'brand-vivid 的类名回流了 —— 这个 token 已经不存在，Tailwind 会静默不生成',
    ).toEqual([])
  })

  it('浅底上的文字用 brand-deep：压 brand-50 / brand-100 都过（14.62 / 11.84）', () => {
    const b50 = tokenHex('brand-50')
    const b100 = tokenHex('brand-100')
    expect(b50, 'tailwind.config.js 里没有 colors.brand-50').toBeTruthy()
    expect(b100, 'tailwind.config.js 里没有 colors.brand-100').toBeTruthy()
    expect(contrast(deep, b50)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(deep, b100)).toBeGreaterThanOrEqual(4.5)
  })

  it('brand-200 上的文字账翻面：brand-deep 压它 9.33 过 —— 旧「禁文字」规则退役', () => {
    /*
     * 041 的 brand-200（#B3D4F7 蓝浅档）上不许垫 brand-deep 文字：4.36 破 AA。
     * 043 的三档是 EP 石墨派生（light-7 #BBBBBC 系），brand-deep 压它实算 9.33 ——
     * 同一条禁令的前提（「最深浅档压得住深字」）反过来成立了，于是删掉那条
     * 「bg-brand-200 与 text-brand-deep 不许同行」的扫描：浅底三档现在都能
     * 托住 brand-deep 文字。
     */
    const b200 = tokenHex('brand-200')
    expect(b200, 'tailwind.config.js 里没有 colors.brand-200').toBeTruthy()
    expect(contrast(deep, b200)).toBeGreaterThanOrEqual(4.5)
  })
})

// ---------------------------------------------------------------------------
// 4. 旧蓝的边界：三个时代的蓝全部禁入，sky 语义例外保留
// ---------------------------------------------------------------------------

describe('旧蓝全面禁入：037 天蓝 / 041 苹果蓝 / 042 天穹蓝（sky 语义例外保留）', () => {
  /*
   * 使用方一句「不要蓝色」之后，蓝在三代里留下的**所有**载体都成了旧值：
   * 028 之前的天蓝（sky 调色板）、041 的苹果蓝（brand 三档 + brand-vivid）、
   * 042 的天穹蓝（.glass-sky 渐变的四个停 + 玫瑰 / 浅蓝光斑）。
   *
   * 唯一的保留：**旧天蓝仍是 STATUS_TONE.info 的语义色**（提示、说明那类中性
   * 信息）—— 语义蓝不是配色，它不能被主色换代带走。护栏守的是这个边界，
   * 两侧都钉住：主色侧归零，语义侧必须留着。
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
    // 换成蓝就与主色同色相、换成绿就与 success 同色相，「提示」和它们再也分不开。
    expect(STATUS_TONE.info).toContain('sky')
    expect(STATUS_ICON_TONE.info).toContain('sky')
  })

  it('旧天蓝的色值字面量也不得回流 —— 类名护栏漏得过 scoped CSS', () => {
    /*
     * 上一条只认 `sky-` 类名。变更-033 之前 `.vessel-select` 的聚焦环是
     * `rgb(14 165 233)`（sky-500）—— 一行 scoped CSS 里的裸 rgb，就在
     * 护栏底下活了一整轮，靠人工审计才抓出来。这里把旧天蓝家族常用的色值
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
      stripComments(read(file))
        .split(/\r?\n/)
        .forEach((line, index) => {
          for (const re of SKY_LITERALS) {
            if (re.test(line)) offenders.push(`${rel(file)}:${index + 1}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })

  it('历代蓝色的字面量与类名全仓禁入（含 rgb 形式）', () => {
    /*
     * 两本旧账并成一本（043 起的口径：蓝色整体退役，不分「哪代的」）：
     *   · 水槽蓝（041 天穹 / 夜 / 深烟）：#1256d6 / #0e3aa8 / #0b2f8f / #0a1730 / #061a3c；
     *   · 苹果蓝与浅底三档：#0071e3 / #005ab6 / #0a84ff / #e6f1fc / #cce3f9 / #b3d4f7；
     *   · 降级实色的蓝白：#f7faff 家族（rgb(247 250 255)）；
     *   · 042 天穹光斑的浅蓝：rgb(120 190 255)；
     *   · 类名：.glass-sky / .glass-smoke / bg-smoke / bg-night。
     *
     * stripComments 先剥 —— 这些值在注释里是**记录**（退役账），剥掉才算「用法」。
     * 例外只有一个方向：statusTones.js 的语义 sky 类名（上面两条单独管），
     * 这里扫的是与主色/底色同源的那些饱和蓝字面量，不在它的范围内。
     */
    const OLD_BLUE_HEX =
      /#(0071e3|005ab6|0a84ff|e6f1fc|cce3f9|b3d4f7|1256d6|0e3aa8|0b2f8f|0a1730|061a3c|f7faff)\b/i
    const OLD_BLUE_RGB =
      /rgba?\(\s*(0[\s,]+113[\s,]+227|204[\s,]+227[\s,]+249|10[\s,]+132[\s,]+255|120[\s,]+190[\s,]+255|247[\s,]+250[\s,]+255)\s*\)/i
    const OLD_BLUE_CLASS = /(glass-sky|glass-smoke|bg-smoke|bg-night)/
    const offenders = []
    for (const file of SOURCE_FILES) {
      stripComments(read(file))
        .split(/\r?\n/)
        .forEach((line, index) => {
          for (const [label, re] of [
            ['字面量', OLD_BLUE_HEX],
            ['rgb', OLD_BLUE_RGB],
            ['类名', OLD_BLUE_CLASS],
          ]) {
            if (re.test(line)) offenders.push(`${rel(file)}:${index + 1}（${label}）`)
          }
        })
    }
    expect(
      offenders,
      '旧蓝回流了。蓝色在 043 整体退役：类名走 veil / frost / field / desk / canvas 这套 token，' +
        '确需字面量的只有 theme.css（EP 变量）、glass-effects.css（场配方）与 ' +
        'WorkOrderList 的 scoped 块 —— 加新文件之前先想清楚为什么 token 不够。',
    ).toEqual([])
  })

  it('现役调色（石墨族 + 场配方）的字面量只许出现在三个文件里', () => {
    /*
     * 白名单就是「定义它」与「实现它」的地方（031 起，机制没变）：
     *   · src/theme.css         —— --el-color-primary 与 6 个派生色（EP 变量只能写字面量）；
     *   · src/glass-effects.css —— 场配方（CSS 渐变里必须写字面量）；
     *   · WorkOrderList.vue     —— 一圈 scoped 拟态控件的聚焦环 / 底（CSS 里够不着 Tailwind 类）。
     * （tailwind.config.js 是 brand 族的定义处，不在 src 扫描范围内；index.html 与
     *   style.css 的 desk 值各有各的账，单独管 —— 与把 night / region 排除在外同一个道理。）
     *
     * 匹配的是石墨族的字面量：brand / brand-deep + 三档浅底 + 场三停 + 对应 rgb。
     * desk（#dedfe5）不在此列 —— 它自有落地处（style.css 的 body 底、index.html 的
     * theme-color），单独管。
     *
     * 注释先剥掉（stripComments）：Intro 与 WorkOrderImport 的文件头注释里就
     * 引用着 #0071E3 / #0A84FF / #1D1D1F 来说明按钮取值的账 —— 那是记录，
     * 正是最该留的，按原始文本扫会把它们误报成「有人手写了一个色」。
     */
    const ALLOWED = ['src/theme.css', 'src/glass-effects.css', 'src/views/WorkOrderList.vue']
    const CURRENT_LITERAL =
      /#(1d1d1f|171719|e8e8e9|d2d2d2|bbbbbc|f1f2f5|ecedf1|e9e9ee)\b|rgba?\(\s*(29[\s,]+29[\s,]+31|210[\s,]+210[\s,]+210)\s*\)/i
    const offenders = []
    for (const file of SOURCE_FILES) {
      if (ALLOWED.includes(rel(file))) continue
      stripComments(read(file))
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (CURRENT_LITERAL.test(line)) offenders.push(`${rel(file)}:${index + 1}`)
        })
    }
    expect(
      offenders,
      '这里出现了现役调色的裸字面量。类名（bg-brand / text-brand-deep / bg-canvas）走 token；' +
        '确需字面量的只有 theme.css（EP 变量）、glass-effects.css（场配方）与 ' +
        'WorkOrderList 的 scoped 块（聚焦环）—— 加新文件之前先想清楚为什么 token 不够。',
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. Element Plus 主色与它的 6 个派生色必须同步（+r 与品牌族的同源交叉）
// ---------------------------------------------------------------------------

describe('Element Plus 主色与派生色同步', () => {
  /*
   * theme.css 的 6 个派生色是照 EP 自己的混色规则算出来的。改主色而忘了改派生色，
   * 表现是「分页当前页、下拉选中项还是上一代颜色」—— 要刚好点到那个组件才会撞见。
   * 所以不靠肉眼：拿公式实算比一遍，改一半立刻红。
   *
   * 041 又加了一层**同源交叉**：品牌族（tailwind.config）与 EP 派生（theme.css）
   * 是两个文件里的两套值，但它们必须指同一个颜色 —— dark-2 就是 brand×0.8、
   * light-9/8/7 就是 brand-50/100/200。两条路径互相验证：只改一边，这里红。
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

  /** dark-2 = 主色混 20% 黑 */
  const darken2 = (hex) =>
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.8)
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

  it('light-3/5/7/8/9 与主色同步', () => {
    for (const n of [3, 5, 7, 8, 9]) {
      expect(declared(`light-${n}`), `theme.css 缺 --el-color-primary-light-${n}`).toBeTruthy()
      expect(declared(`light-${n}`)).toBe(lighten(primary, n / 10))
    }
  })

  it('dark-2 与主色同步（主色混 20% 黑）', () => {
    expect(declared('dark-2')).toBe(darken2(primary))
  })

  it('同源交叉：brand ≡ --el-color-primary，brand-deep ≡ dark-2', () => {
    // 手写 markup（bg-brand）与 EP 组件（--el-color-primary）必须是同一个颜色 ——
    // 「分页当前页比按钮深一点」就是这两边漂移的样子。
    expect((tokenHex('brand') || '').toLowerCase()).toBe(primary.toLowerCase())
    expect(
      (tokenHex('brand-deep') || '').toLowerCase(),
      'brand-deep 与 EP dark-2 不是同一个值 —— 它们该是同一条公式的两个出口',
    ).toBe(declared('dark-2'))
  })

  it('浅底三档就是 EP 的 light-9/8/7（brand-50/100/200 同源）', () => {
    const pairs = [
      ['brand-50', 'light-9'],
      ['brand-100', 'light-8'],
      ['brand-200', 'light-7'],
    ]
    for (const [token, ep] of pairs) {
      expect((tokenHex(token) || '').toLowerCase(), `tailwind.config 里没有 colors.${token}`).toBe(
        declared(ep),
      )
    }
  })

  it('EP 的三档「空白填充」= raised（霜面上的白）', () => {
    /*
     * 037 时使用方圈着工作台的分页行说「很多地方都是白色的」—— 分页那排数字
     * 不是手写的，是 Element Plus 画的（实测 .el-pager li 纯白、.el-checkbox__inner
     * 纯白、.el-pagination button 冷灰）。Tailwind 的类名一个也够不着它们，
     * 只能改 EP 变量。
     *
     * 041 的裁定**正好反过来**（底是蓝的、玻璃上的面是雾白的）；043 保持了
     * 纯白这一档：场是浅的、玻璃是清的，「空白填充」的正确取值仍是纯白
     * —— = Tailwind `raised`。两边必须同值。
     */
    const raised = (tokenHex('raised') || '').toLowerCase()
    const declaredValue = (name) => {
      const m = themeSrc.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`))
      return m ? m[1].toLowerCase() : null
    }
    for (const name of ['--el-bg-color', '--el-bg-color-overlay', '--el-fill-color-blank']) {
      expect(
        declaredValue(name),
        `theme.css 里没有覆盖 ${name}。EP 默认是 #ffffff —— 这个值现在**恰好**也对` +
          '（= raised），但必须显式写出来：raised 一旦重染，弹层/输入框/分页就脱队了。',
      ).toBe(raised)
    }
  })

  it('--el-fill-color = region；纯中性三档的次序不乱（fill < light < lighter）', () => {
    // 分页的上一页/下一页、禁用态用 --el-fill-color —— 它是「压在白面上的垫底」，
    // 与 Tailwind 的 region 同一个角色，必须同值。另外两档是雾白往下垫的过渡色
    //（043 起纯中性：fill #EEEEF1 → light #F2F2F5 → lighter #F7F7F9），
    // 次序（深→浅）不许乱：乱了之后 EP 组件的层次关系整个反过来。
    const declaredValue = (name) => {
      const m = themeSrc.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`))
      return m ? m[1].toLowerCase() : null
    }
    expect(declaredValue('--el-fill-color')).toBe((tokenHex('region') || '').toLowerCase())
    const lighter = declaredValue('--el-fill-color-lighter')
    const light = declaredValue('--el-fill-color-light')
    const fill = declaredValue('--el-fill-color')
    expect(
      lighter && light && fill,
      'theme.css 缺 --el-fill-color-lighter/light/fill 之一',
    ).toBeTruthy()
    expect(luminance(lighter)).toBeGreaterThan(luminance(light))
    expect(luminance(light)).toBeGreaterThan(luminance(fill))
  })
})

// ---------------------------------------------------------------------------
// 6. 焦点环白名单
// ---------------------------------------------------------------------------

describe('焦点环必须过 1.4.11 的 3:1', () => {
  /*
   * 待办-002 §1 登记的 7 处（ring-sky-300 1.67:1、ring-slate-400 2.56:1）在
   * 变更-028 修掉时的做法沿用到现在：与其逐个钉「不许出现某某类」，不如反过来 ——
   * **只许出现算过比值的这几个**。加新环色时必须先把比值算出来补进本表。
   *
   * 043 起**全站一个环色**：brand（石墨，压白底 16.83）。041 留给浅底侧栏的
   * `ring-white/80` 那条豁免随「深侧栏」一起退役 —— 石墨环压轻纱最亮处 ~13.7，
   * 富余得不再需要任何例外。
   *
   * 匹配只认**颜色** token：`focus:ring-2`（粗细，数字打头不匹配）、
   * `focus:ring-offset-2`（偏移，数字打头）与 `focus:ring-inset`（关键字）
   * 靠形态自然排除 —— 前两个靠 `[a-z]+` 的要求，inset/offset 靠显式排除。
   */
  const RING_OK = [
    { ring: 'focus-visible:ring-brand', why: '16.83（压白底；压轻纱最亮处 ~13.7）' },
    { ring: 'focus:ring-brand', why: '16.83（表内可编辑格，环画在卡面上）' },
    { ring: 'focus-visible:ring-rose-600', why: '4.70（清除筛选 / 清空），rose 是它的语义色' },
    { ring: 'focus:ring-slate-500', why: '4.76（实心主按钮，环画在 ring-offset 之外的白底上）' },
    {
      ring: 'focus:ring-brand-100',
      soft: true,
      why: '软晕，不承载指示：这些输入框真正的指示者是同一行的 focus:border-brand（16.83）',
    },
  ]

  const RING_RE = /\bfocus(-visible)?:ring-(?!offset|inset)([a-z]+(?:-\d{2,3})?(?:\/\d{1,3})?)\b/g

  it('全仓只允许出现白名单里的焦点环', () => {
    const known = new Set(RING_OK.map((e) => e.ring))
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          for (const m of line.matchAll(RING_RE)) {
            const full = `focus${m[1] ?? ''}:ring-${m[2]}`
            if (!known.has(full)) offenders.push(`${rel(file)}:${index + 1}  ${full}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })

  it('白名单里每个色都真的够 3:1（软晕那条除外）', () => {
    for (const entry of RING_OK) {
      if (entry.soft) continue
      const color = entry.ring.match(/ring-(.+)$/)[1]
      const name = color.split('/')[0]
      const hex = hexOfColor(name)
      expect(
        hex,
        `${entry.ring} 用到的 ${name} 不在 HEX 表 / token 里，先补上再算比值`,
      ).toBeTruthy()
      expect(contrast(hex, HEX.white), `${entry.ring}：${entry.why}`).toBeGreaterThanOrEqual(3)
      if (name === 'brand') {
        // 043 侧栏翻浅之后 ring-brand 也画在轻纱上 —— 顺带把每一段纱面的账一起算
        expect(VEIL_SHOWN.length, '轻纱压色没算出来（侧栏锚点或场配方断了）').toBeGreaterThan(0)
        for (const [vname, veil] of VEIL_SHOWN) {
          expect(
            contrast(hex, veil),
            `${entry.ring} 压轻纱（${vname}）只有 ${contrast(hex, veil).toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 7. 两条「全仓缺席」类的问题
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

  it('页面底色（:root）是 desk —— 页脚外露/回弹时出的边是桌面，不是纸', () => {
    // 场（canvas）是**页内那张纸**，不是页面底色；style.css 这一行若写成
    // canvas 或白，回弹时露出的边就与 16px 外框对不上（三层颜色各说各话）。
    const desk = (tokenHex('desk') || '').toLowerCase()
    expect(desk, 'tailwind.config.js 里没有 colors.desk').toBeTruthy()
    expect(style).toMatch(new RegExp(`background:\\s*${desk}`, 'i'))
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
// 8. 可访问名
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
// 9. 侧栏宽度必须装得下最长的那条分组提示
// ---------------------------------------------------------------------------

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
    // 侧栏内容宽 = aside 宽 − m-4(16×2) − p-4(16×2)
    const widthClass = WORKBENCH.match(/collapsed \? 'w-\[88px\]' : '([\w-]+)'/)
    expect(widthClass, '没找到展开态宽度类，匹配式要跟着 markup 一起改').toBeTruthy()
    const aside = WIDTH_PX[widthClass[1]]
    expect(aside, `${widthClass[1]} 不在 WIDTH_PX 表里，先补上它的像素值再算`).toBeTruthy()
    const content = aside - 16 * 2 - 16 * 2

    // GROUPS 里的 hint 文案
    const hints = [...WORKBENCH.matchAll(/hint:\s*'([^']+)'/g)].map((m) => m[1])
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
// 10. 场：是那张纸，不是底色（变更-043 从中性清水改名）
// ---------------------------------------------------------------------------

describe('场（变更-043）：桌面框 + 中性浅纸 + 两团极淡光斑', () => {
  /*
   * 这一组的来路要连着 037 讲，不然读不出为什么管得这么宽。
   *
   * 使用方 2026-10-07 的原话是「做一个底框，暖白纸，整个项目看上去就是运行在这张
   * 卡片上」——「纸」这个概念就是那轮立起来的，它的**观感**（有一张纸，东西都在
   * 纸上）比它的**颜色**长寿。041 换成蓝的天穹；043 使用方一句「不要蓝色，做成
   * 透明」之后它变成浅中性柔光场：浅灰渐变 + 两团极淡的中性光斑。
   *
   * 037~040 那几轮玻璃为什么显土，根因就在这层：**一张几乎纯色的纸上，模糊
   * 无物可糊**。043 去掉了**颜色**、但没去掉**亮度变化** —— 光斑不是装饰，
   * 是给玻璃吸的：55% 填充的清水玻璃把背后的渐变与光斑吸进材质里，透明感才立得住。
   *
   * 判据沿用 037 的「纸是页内元素，不是页面底色」：
   *   · 页面根（min-h-screen）一律 bg-desk（浅桌面的外框）；
   *   · bg-canvas 只许出现在带圆角的纸上，且必配 .glass-field；
   *   · 四页口径不变（工作台 / 登录 / 404 是纸，Intro 是**白纸例外**，
   *     长页正文的底色必须浅，spec 白名单表达）。
   */
  it('.glass-field 配方解析出来了 —— 锚点断了先在这里红', () => {
    // 下面几组（文字安全、霜面卡片）都拿解析出来的三段渐变当底色算账。
    // 与其让它们报出莫名其妙的 NaN 失败，不如在这里说清楚是解析断了。
    expect(FIELD_STOPS, '没从 glass-effects.css 里解析出 .glass-field 的渐变停点').toHaveLength(3)
    expect(Number.isFinite(FIELD_WHITE_ALPHA), '没解析出白斑的透明度').toBe(true)
    expect(FIELD_BLOBS, '两团光斑各「主色 + 0 α 收尾」两条，共 4 条 rgb').toHaveLength(4)
    expect(underlayList, '场代表底色没建起来').toHaveLength(4)
  })

  it('配方本身：178deg / 三停由浅到深 / 底停逐位等于 colors.canvas / 两团光斑 α 定档', () => {
    expect(fieldBlock, '没解析到 .glass-field 的样式块').toBeTruthy()
    expect(fieldBlock).toMatch(/linear-gradient\(\s*178deg/)

    const stops = [...fieldBlock.matchAll(/#([0-9a-fA-F]{6})\s+(\d+)%/g)].map((m) => ({
      hex: `#${m[1]}`,
      at: Number(m[2]),
    }))
    expect(stops.map((s) => s.at)).toEqual([0, 46, 100])
    // 三段必须由浅到深（上亮下暗）——043 保留了这条镜头感：光从上方来，
    // 玻璃上缘的白镜面线压在最亮的一档上，整块材质才有「厚度」。
    expect(luminance(stops[0].hex)).toBeGreaterThan(luminance(stops[1].hex))
    expect(luminance(stops[1].hex)).toBeGreaterThan(luminance(stops[2].hex))

    // 底停 = colors.canvas（同一值，两处一起改）：纸的四角是圆的，渐变之外的
    // 兜底色就是 bg-canvas —— 底停有色差，圆角外沿会露出一圈「补丁」。
    const canvas = tokenHex('canvas')
    expect(canvas, 'tailwind.config.js 里没有 colors.canvas').toBeTruthy()
    expect(stops[2].hex.toLowerCase()).toBe(canvas.toLowerCase())

    // 两团光斑：白（顶左）+ 冷灰（中右）。两团都要在，且都必须以「同色 0 α」
    // 收尾（下面一条 `transparent` 禁令）—— 0 也不许，光斑是给玻璃吸的，不是可选项。
    expect(
      FIELD_BLOBS.filter((b) => b.alpha === 0),
      '两团光斑各自的 0 α 收尾',
    ).toHaveLength(2)
    // α 是**硬上限**（详见 glass-effects.css 头注）：再亮，纱与场、霜与场的分离比
    // 会跌破下限（纱/场 1.08、霜/场 1.046，两对都在 describe 12 实算钉着）。
    expect(FIELD_WHITE_ALPHA).toBeGreaterThan(0)
    expect(
      FIELD_WHITE_ALPHA,
      '白斑 α 超过 0.45 —— 霜面与场的分离比会跌破 1.046',
    ).toBeLessThanOrEqual(0.45)
    const gray = FIELD_BLOBS[2]
    expect(gray && gray.alpha).toBeGreaterThan(0)
    expect(gray && gray.alpha, '冷灰斑 α 超过 0.35 —— 它压深的是场的亮度下限').toBeLessThanOrEqual(
      0.35,
    )
    // 光斑收尾用同色的 0 α，不用 transparent 关键字（防某个实现按非预乘插值中途发灰）
    expect(fieldBlock).not.toMatch(/transparent/)

    // 时间线的作用域只能在这一层：侧栏/导航条与主区栏是兄弟/叔侄，
    // 命名时间线默认只对声明者及后代可见 —— 挂错一层，高光永远停在贴顶那一格，
    // 不报错、不警告（038 的机制说明在 glass-effects.css 头注）。
    expect(fieldBlock).toMatch(/timeline-scope:\s*--main-scroll/)
  })

  it('场的中性度硬钉：五个采样点 max−min ≤ 6、B−R < 8（光斑只许给亮度，不许给色偏）', () => {
    /*
     * 「不要蓝色」的字面落点。三停与两团光斑叠出来的每个采样点都必须是**中性**的：
     * 采样点 = 三停 + 白斑 + 冷灰斑本身。判据两条：
     *   · max−min ≤ 6 —— 三个通道的极差（允许一丝极冷的灰，macOS 的中性灰也偏冷）；
     *   · B−R < 8     —— 不许到「看得出是蓝色」的程度（旧天穹的 B−R 是 40+）。
     * 冷灰斑自己的颜色（rgb(186 187 191)）也一并量 —— 它是场里唯一真正
     * 「有色」的一笔，先把它本身的色偏钉死。
     */
    expect(underlayList, '场代表底色没建起来').toHaveLength(4)
    const gray = FIELD_BLOBS[2]
    expect(gray, '没解析到冷灰斑（.glass-field 的第二团）').toBeTruthy()
    const points = [
      ...underlayList.map(([name, hex]) => [name, rgbOf(hex)]),
      ['冷灰斑', gray.hex ? rgbOf(gray.hex) : null],
    ]
    for (const [name, rgb] of points) {
      expect(rgb, `${name} 的色值没解析出来`).toBeTruthy()
      const [r, g, b] = rgb
      const spread = Math.max(r, g, b) - Math.min(r, g, b)
      expect(spread, `${name} 三通道极差 ${spread} > 6 —— 场出现了色偏`).toBeLessThanOrEqual(6)
      expect(
        b - r,
        `${name} 的 B−R = ${b - r} ≥ 8 —— 「不要蓝」之后场里不许再有看得出的蓝`,
      ).toBeLessThan(8)
    }
  })

  it('.glass-refract 的机制三件套还在：@property --glint / 跟随位移 / 300% 高', () => {
    // 043 只改了折射层的**颜色**（底暗从带蓝的黑换成中性深），
    // 几何与 --glint 机制一字未动 —— 这几条防的就是「换色顺手重写折射层」。
    expect(GLASS_CSS).toMatch(/@property --glint\s*\{[^}]*syntax:\s*'<percentage>'/)
    expect(GLASS_CSS).toMatch(/\.glass-refract\s*\{[\s\S]*?background-position:\s*0 var\(--glint\)/)
    expect(GLASS_CSS).toMatch(/background-size:\s*100% 300%/)
    expect(
      GLASS_CSS,
      '底部微暗该是「中性深」—— 纯黑压浅灰会发死，带一点冷调的 22/22/26 正好',
    ).toMatch(/rgb\(22 22 26/)
  })

  it('四个页面根元素一律 bg-desk —— 场是纸，桌面才是底', () => {
    // 判据是 min-h-screen，全站只有四个页面根元素用（工作台 / 登录 / 404 / 落地页）。
    //
    // 两个方向都要钉：
    //   ① 漏了底色 —— 那一页没有底色，页脚外露或回弹时露出浏览器默认白；
    //   ② 写成 bg-canvas —— 场是**页内**那张纸，不是页面底色。
    //      「整屏泛灰」和「有一张纸」只差一层嵌套 —— 037 的暖白吃过同一个亏
    //      （使用方原话「不是把背景变成暖白，是添加一个暖白的底层卡片」）。
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (!lineHasToken(line, 'min-h-screen')) return
          const at = `${rel(file)}:${index + 1}`
          if (lineHasToken(line, 'bg-canvas')) offenders.push(`${at} 把场当成了页面底色`)
          else if (!lineHasToken(line, 'bg-desk')) offenders.push(`${at} 没有底色`)
        })
    }
    expect(
      offenders,
      '页面根元素要用 bg-desk 当底色（浅桌面灰）；场（bg-canvas）是**纸**，不是背景 —— ' +
        '「整屏泛灰」和「有一张纸」只差一层嵌套，别把主意打到根元素上。',
    ).toEqual([])
  })

  it('桌面框与场分得开、深字压场过 AA —— 两层各自的账', () => {
    const desk = tokenHex('desk')
    const canvas = tokenHex('canvas')
    expect(desk, 'tailwind.config.js 里没有 colors.desk').toBeTruthy()
    expect(canvas, 'tailwind.config.js 里没有 colors.canvas').toBeTruthy()
    expect(
      contrast(desk, canvas),
      `桌面框压场只有 ${contrast(desk, canvas).toFixed(3)}:1 —— 16px 外框会与纸糊成一片`,
    ).toBeGreaterThanOrEqual(1.08)
    expect(
      contrast(HEX['slate-900'], canvas),
      `深字（slate-900）压场只有 ${contrast(HEX['slate-900'], canvas).toFixed(2)}:1 —— 纸被调深了`,
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('bg-canvas 必配 rounded-card 与 glass-field；glass-field 只许画在纸上（双向）', () => {
    /*
     * 有圆角才是「一张纸」—— 上面那层的口子（不带圆角的浅色大块 = 「这块区域
     * 泛灰」）037 就堵过，这里原样保留。另一半：场配方（glass-field）必须与纸
     * 同生共死 —— 画到别的元素上就成了浮在屏幕上的光斑。
     * 反面不成立：rounded-card 在全站有几十处（白卡片/面板），不必也不该都变成纸。
     */
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          const tokens = lineClassTokens(line)
          const usesCanvas = tokens.some((t) => t === 'bg-canvas' || t.startsWith('bg-canvas/'))
          const usesField = tokens.includes('glass-field')
          if (!usesCanvas && !usesField) return
          const at = `${rel(file)}:${index + 1}`
          if (usesCanvas && !usesField) offenders.push(`${at} bg-canvas 没配 glass-field`)
          if (usesField && !usesCanvas) offenders.push(`${at} glass-field 没配 bg-canvas`)
          if (usesCanvas && !tokens.some((t) => CARD_RADIUS.test(t))) {
            offenders.push(`${at} bg-canvas 没有卡片圆角`)
          }
        })
    }
    expect(
      offenders,
      'bg-canvas 必须与 rounded-card、glass-field 同行；glass-field 只许出现在纸上。' +
        '想要一块没有圆角的底色区域，用 bg-desk（页面根那层）。',
    ).toEqual([])
  })

  it('四个页面每一个里面都有一张纸 —— 三张柔光场 + 落地页白名单', () => {
    /*
     * 037 的口径（使用方：「登录、404、落地页都要加」）不变：四页一致。
     * 041/043 里 Intro 的处理不变 —— 它是长页正文，底色必须浅，所以纸是**白**的
     * （`rounded-card bg-white`），这是**文档化的例外**，不是漏做。
     *
     * 数量 4 写死是有意的：将来多出第五个页面时这条会红，提醒把它一起包进纸里；
     * 那时把 4 改成 5，顺手确认新页面的纸是哪一种。
     */
    const INTRO = join(SRC, 'views', 'Intro.vue')
    const roots = new Set()
    const fielded = new Set()
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line) => {
          if (lineHasToken(line, 'min-h-screen')) roots.add(file)
          if (lineClassTokens(line).includes('glass-field')) fielded.add(file)
        })
    }
    expect(
      [...roots].map(rel).sort(),
      '带 min-h-screen 的页面根元素数量变了 —— 新页面也要包一张纸，确认后改这里的 4',
    ).toHaveLength(4)
    expect(
      fielded.has(INTRO),
      'Intro 出现了 glass-field —— 它是白纸例外，柔光场只给工作台/登录/404',
    ).toBe(false)
    expect(
      [...roots].filter((f) => !fielded.has(f) && f !== INTRO).map(rel),
      '这些页面里没有场（只认 class 属性，写在注释里不算）。四页都要有纸，别漏',
    ).toEqual([])
    // Intro 的白纸确实在：bg-white 与卡片圆角在同一处 class 属性里
    const hasWhitePaper = classAttrsOf(read(INTRO)).some(
      ({ tokens }) => tokens.includes('bg-white') && tokens.some((t) => CARD_RADIUS.test(t)),
    )
    expect(hasWhitePaper, 'Intro 里没有那张白纸（rounded-card bg-white）—— 长页底色不能裸奔').toBe(
      true,
    )
  })
})

// ---------------------------------------------------------------------------
// 11. 霜面：抬起来的面全是 raised/95（变更-043）
// ---------------------------------------------------------------------------

describe('霜面（变更-043）：卡片走 raised/95，工作台不再有裸 bg-white', () => {
  /*
   * 使用方 2026-10-11 看 037 的成果时说「很多地方都是白色的，看着很刺眼」——
   * 那轮把抬起来的面全换成了暖白。041 换了底（蓝之上，白是雾）；043 又翻回浅底，
   * 但**结论不变**：霜面（白玻璃）是玻璃，它上面抬起来的卡片是霜面的**实心近亲**
   * ——`bg-raised/95` + 不透明感的白描边 + 自己的模糊。
   *
   * 这一组守两件事：
   *   ① **面一律走 token**：工作台里不许裸写不透明的 bg-white（与 raised 同值
   *      纯属现在巧合；raised 一旦重染，它就是脱队的那个），也不许冷灰垫底
   *      （垫底一律 region）；
   *   ② **卡片配方整串锚定**：每一处 bg-raised/95 都必须配上 border-white/60 与
   *      backdrop-blur-xl —— 防「只把一张卡改回实心」这种单点回归。
   *
   * 白名单三页（Login / Intro / NotFound）是**结构不同**，不是懒得管：
   * 它们是「白卡压场/白纸」，卡是实心白且应当实心（白卡压场，落差最宽的一级）；
   * `bg-raised/95` 的配方只对「玻璃上抬卡片」的工作台成立。
   */
  const CARD_ON_PAPER = ['src/views/Login.vue', 'src/views/Intro.vue', 'src/views/NotFound.vue']
  const workbenchFiles = () => SOURCE_FILES.filter((f) => !CARD_ON_PAPER.includes(rel(f)))

  it('工作台里不许出现不透明的 bg-white —— 面一律走 token', () => {
    const offenders = []
    for (const file of workbenchFiles()) {
      for (const { tokens, line } of classAttrsOf(read(file))) {
        if (tokens.includes('bg-white')) offenders.push(`${rel(file)}:${line}`)
      }
    }
    expect(
      offenders,
      '工作台里还有不透明的 bg-white。所有「面」都走 token：卡片 bg-raised/95、' +
        '垫底 bg-region、轻纱 bg-veil、纸 bg-canvas。裸 bg-white 现在与 raised 同值' +
        '纯属巧合，而且它不透 —— 压在玻璃上就把材质盖死了。' +
        '（Login / Intro / NotFound 三页是「白卡压场/白纸」，已排除。）',
    ).toEqual([])
  })

  it('工作台里不许用冷灰垫底 —— 垫底一律 bg-region（中性的一层垫底）', () => {
    /*
     * 037 的原文是「卡片一暖，slate-50 表头就只剩 1.004」。结论一直没变：
     * slate-50/100 是 Tailwind 调色板的灰，压白卡上表头带半死不活；垫底这个角色
     * 已经有值 —— region #EEEEF1，压白卡 1.16（表头带那条 1.046 的底线在下面
     * 「表头带不许消失」一条里实算）。
     */
    const offenders = []
    for (const file of workbenchFiles()) {
      for (const { tokens, line } of classAttrsOf(read(file))) {
        const bad = tokens.filter(
          (t) =>
            t === 'bg-slate-50' ||
            t === 'bg-slate-100' ||
            t.startsWith('bg-slate-50/') ||
            t === 'hover:bg-slate-50' ||
            t === 'hover:bg-slate-100',
        )
        if (bad.length) offenders.push(`${rel(file)}:${line} ${bad.join(' ')}`)
      }
    }
    expect(offenders, '工作台里还有冷灰垫底，改用 bg-region（#EEEEF1）。').toEqual([])
  })

  it('卡片配方：每一处 bg-raised/95 都配上 border-white/60 与 backdrop-blur-xl', () => {
    /*
     * 配方整串锚定而不是逐处点名：041 把「卡片」从一张卡的写法升格成一条材质规则，
     * 全站（工作台 9 张汇总卡 + 各面板的 section 卡）都是同一串。
     * 数量写死是有意的 —— 新增卡片就 +1，**顺手确认它也有白描边与自己的模糊**；
     * 反过来，少一张也会红：卡被改回实心时类名不同，数量会先掉下来。
     */
    const offenders = []
    let count = 0
    for (const file of SOURCE_FILES) {
      for (const { tokens, line } of classAttrsOf(read(file))) {
        if (!tokens.includes('bg-raised/95')) continue
        count += 1
        const missing = ['border-white/60', 'backdrop-blur-xl'].filter((t) => !tokens.includes(t))
        if (missing.length) offenders.push(`${rel(file)}:${line} 缺 ${missing.join(' / ')}`)
      }
    }
    expect(
      offenders,
      'bg-raised/95 必须与 border-white/60 + backdrop-blur-xl 同串出现：' +
        '这是「白霜的实心近亲」配方（描边要可见、模糊要有 —— 卡片下面就是玻璃）。',
    ).toEqual([])
    expect(count, 'bg-raised/95 一扫一处都没了 —— 锚点断了；新增卡片就 +1，顺手确认配方完整').toBe(
      17,
    )
  })

  it('表头带不许消失：region 压白卡 ≥ 1.046（实算 1.16）', () => {
    const raised = tokenHex('raised')
    const region = tokenHex('region')
    expect(raised, 'tailwind.config.js 里没有 colors.raised').toBeTruthy()
    expect(region, 'tailwind.config.js 里没有 colors.region').toBeTruthy()
    expect(luminance(region)).toBeLessThan(luminance(raised))
    expect(
      contrast(region, raised),
      `region 压白卡只有 ${contrast(region, raised).toFixed(3)}:1 —— 表头带会比 037 之前` +
        '（1.046）还淡，等于把表头弄丢了',
    ).toBeGreaterThanOrEqual(1.046)
  })

  it('卡片压霜面至少差一档（1.046）—— 判定走三个渐变停点，白斑除外', () => {
    /*
     * 036 起「浅对浅」的房屋底线是 1.046（表头带那条）。043 的刻度与它同族：
     * 卡是纯白 raised/95、霜是 55% 白，卡与霜就压在这条线上 —— 在**最亮端**
     * 落差最窄（实算 1.05），那里过线，全屏就过线。
     *
     * ⚠️ 白斑点不进这条判定：白斑（40% 白，半径只覆盖纸的左上角）把局部推得
     * 几乎与霜面同亮 —— 把「整块面料还分不分得开」的判断挂在一个角落尖峰上，
     * 等于用最尖的尖峰替掉面的常规读数。白斑在玻璃下**可见**这件事由探针
     * liquid-cdp §4 单独钉（透过主区玻璃 ΔL ≥ 0.01，实测 0.026）。
     */
    expect(FROST_SHOWN.length, '霜面压色没算出来（锚点或场配方断了）').toBeGreaterThan(0)
    for (const [name] of gradientPoints) {
      const frost = (FROST_SHOWN.find(([n]) => n === name) || [])[1]
      const ratio = contrast(HEX.white, frost)
      expect(
        ratio,
        `白卡压霜面（${name}）只有 ${ratio.toFixed(3)}:1 —— ` +
          `低于 1.046 卡片就与玻璃栏糊成一片（${name} 落差最窄的一端）。`,
      ).toBeGreaterThanOrEqual(1.046)
    }
  })

  it('卡片 /95 的账：卡内弱化文字过 AA；/95 与 /80 的差别已经无感（雾度取值）', () => {
    /*
     * 041 时代这条是「/95 是照 rose-600 的余量逼出来的，再透一档就破」。
     * 043 的浅场把那个论证整个消掉了：白斑处的 raised/95 叠出来是纯白，
     * rose-600 / slate-500 的余量都很大 —— /95 现在纯粹是**雾度**取值。
     *
     * 所以这条改成钉两件当时成立、现在仍然成立的事：
     *   ① 卡内 rose-600 与 slate-500 在全场各代表点上都过 AA；
     *   ② 把卡片从 /95 调到 /80，最坏点的对比度变化 < 0.3 —— 几乎无感。
     *      换句话说 043 里「透一点/实一点」不再是个阈值问题（选择它的理由是
     *      质感），日后若要调档，看的是观感不是这条护栏。
     */
    expect(CARD_SHOWN.length, '卡片压色没算出来（锚点或场配方断了）').toBeGreaterThan(0)
    for (const [name, card] of CARD_SHOWN) {
      expect(
        contrast(HEX['rose-600'], card),
        `rose-600 压卡片（${name} 的 raised/95）不到 4.5 —— 卡内错误文字欠对比度`,
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(HEX['slate-500'], card),
        `slate-500 压卡片（${name} 的 raised/95）不到 4.5 —— 卡内弱化文字集体欠对比度`,
      ).toBeGreaterThanOrEqual(4.5)
    }
    // 无感断言：/95 → /80 在最靠近白的一端（白斑处就是全部落点里最亮的那处）
    const card95 = (CARD_SHOWN.find(([name]) => name === '白斑处') || [])[1]
    const frost = (FROST_SHOWN.find(([name]) => name === '白斑处') || [])[1]
    expect(card95 && frost, '没解析到「白斑处」的卡/霜压色').toBeTruthy()
    const card80 = composite('#ffffff', 0.8, frost)
    expect(
      Math.abs(contrast(HEX['rose-600'], card95) - contrast(HEX['rose-600'], card80)),
      '/95 与 /80 的对比度差超过 0.3 —— 卡片透明度的档位变化已经能被读出来了，重新论证取值',
    ).toBeLessThan(0.3)
  })
})

// ---------------------------------------------------------------------------
// 12. 两档液态玻璃与固定大小（轻纱侧栏 / 霜面两栏）
// ---------------------------------------------------------------------------

describe('两档液态玻璃与固定大小（轻纱侧栏 / 霜面两栏，变更-043）', () => {
  /*
   * 病史先记着，不然看不出为什么是「两档」：
   *
   * 使用方 2026-10-07 圈着侧栏和顶部标题条指定了三个值：**背景半透明、模糊 24
   * 像素、边缘用亮白描边**。第一版只照这三个值做，上线看到的是「没效果」——
   * 75% 白压在近白的纸上还是白。使用方当场补了第四条：**玻璃带一点色调**。
   * 036 那代三块是**同一种**中性暖灰；041 拆成深烟 / 白霜两种；043 保留两档，
   * 但都收进**清水档**（填充 55%、模糊升到 32/30、saturate 整条退役）：
   *
   *   侧栏        轻纱 glass-veil   bg-veil/55   blur 32
   *   导航条+主区 霜面 glass-frost  bg-white/55  blur 30
   *
   * 为什么必须两档：三块全做霜面，屏幕就是一片白雾、层级塌掉 —— 侧栏是「比场
   * 深一档」的深伴星（与场 ≥1.08，tailwind.config 的 `veil` 段有定档过程）；
   * 霜面是浅对浅（与场 ≥1.046）。
   *
   * 这一组钉的是几条**改坏了也看不出来**的机制：
   *   ① 两档的 token 组合逐项锚定（防顺手把料搅混）；
   *   ② 两块霜面栏**必须同料**（只调一块 → 一块亮一块暗，并排看就是坏的）；
   *   ③ 侧栏与霜面**必须异料**（改回三块同料就是把两档的决定推翻）；
   *   ④ 描边必须不透明（画在自己背景之上，/70 压上去就是同一个像素）；
   *   ⑤ 吸顶线必须同一条（滚起来才露馅）；导航条带 z；
   *   ⑥ 主区固定大小（038 的整条链，与本组同挂在 WORKBENCH 上）。
   *
   * 另外：模糊值写任意值 `backdrop-blur-[32px]` 而不是档位名，因为 32 / 30 是
   * 规格数字 —— 写成数字，Tailwind 哪天调了档位，它不会跟着一块儿飘。
   */
  const MATERIAL_RE =
    /^(bg-(veil|white)\/\d{1,3}|glass-(refract|veil|frost)|backdrop-blur-\[[^\]]+\]|border-white|shadow-panel)$/
  const materialOf = (tokens) => tokens.filter((t) => MATERIAL_RE.test(t)).sort()
  const EXPECT_VEIL = [
    'backdrop-blur-[32px]',
    'bg-veil/55',
    'border-white',
    'glass-refract',
    'glass-veil',
    'shadow-panel',
  ]
  const EXPECT_FROST = [
    'backdrop-blur-[30px]',
    'bg-white/55',
    'border-white',
    'glass-frost',
    'glass-refract',
    'shadow-panel',
  ]

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
      '没在源码里找到同时带 min-h-0 与 backdrop-blur-[30px] 的 class —— 主区玻璃栏的锚点断了',
    ).toBeGreaterThan(1)
  })

  it('侧栏是轻纱料：token 组合逐项在，且描边不透明', () => {
    expect(
      materialOf(SIDEBAR),
      '侧栏的材质 token 与 043 的定稿不一致（轻纱：veil/55 + blur32，无 saturate）。' +
        '改成霜面就把「深伴星」的基本盘推翻了 —— 三块全白屏会塌成一片雾。',
    ).toEqual(EXPECT_VEIL)
    expect(SIDEBAR, '侧栏没吸顶').toContain('sticky')
    expect(SIDEBAR, '侧栏面板不是圆角卡片').toContain('rounded-card')
  })

  it('导航条与主区栏是霜面料，且**两块完全同料**（防只调一块）', () => {
    expect(materialOf(NAV), '导航条的材质 token 与定稿不一致').toEqual(EXPECT_FROST)
    expect(
      materialOf(MAIN),
      '主区栏与导航条不是同一块料：主区栏占的像素最多，它一旦与导航条不一致，' +
        '整屏立刻分成两种白。两块必须一起改。',
    ).toEqual(materialOf(NAV))
    for (const [name, tokens] of [
      ['导航条', NAV],
      ['主区栏', MAIN],
    ]) {
      expect(tokens, `${name}不是圆角卡片`).toContain('rounded-card')
    }
  })

  it('侧栏与霜面栏是**两种**料 —— 三块同料是被两代一起推翻的版本', () => {
    // 只调一块 → 一块深一块浅，三块不在同一个视线上；但把侧栏也改成霜面是更隐蔽的
    // 倒退：静止看「整齐了」，整屏却退回白雾、层级塌掉。两档是决定，不是巧合。
    expect(fillOf(SIDEBAR, 'veil'), '侧栏的填充不是 bg-veil/xx').toBeTruthy()
    expect(fillOf(SIDEBAR, 'white'), '侧栏出现了白色填充 —— 它是轻纱料').toBeUndefined()
    expect(fillOf(NAV, 'white'), '霜面栏的填充不是 bg-white/xx').toBeTruthy()
    expect(fillOf(SIDEBAR, 'veil') !== fillOf(NAV, 'white'), '侧栏与导航条用了同一种填充').toBe(
      true,
    )
  })

  it('两块都吸顶，且吸在同一条线上；导航条带 z 轴', () => {
    /*
     * 吸顶的吸附基准是 border box（实测：面板 top-4 m-4 滚到 900 时 top = 16，
     * 不是 32），所以两块的 top-* 一旦不同步，滚动起来两块顶边就差一截 ——
     * 而**静止态完全正常**，只有滚起来那一瞬间才露。
     *
     * 吸顶必须落在 top-0：主区内容不裁剪，钉在 16px 处，上面那 16px 就会漏出
     * 正在滚的表格行（实测截图里能看见半行「再沸器 17 号」悬在导航条上方）。
     */
    expect(
      NAV,
      '导航条没吸顶 —— 不吸顶它滚过去就没了，那块模糊底下永远没有东西经过，等于白写。',
    ).toContain('sticky')
    expect(
      stickyTopOf(NAV),
      '导航条的吸顶落点不是 top-0。钉在 top-4 会让它上方空出 16px，正在滚的表格行' +
        '就从那条缝里划过去（/intro 的吸顶头部踩过同一个坑）。',
    ).toBe('top-0')
    expect(
      stickyTopOf(SIDEBAR),
      `两块的吸顶线不同（侧栏 ${stickyTopOf(SIDEBAR)} / 导航条 ${stickyTopOf(NAV)}）：` +
        '滚动起来两块顶边会差一截，而静止态完全正常 —— 只有滚起来才看得出来。',
    ).toBe(stickyTopOf(NAV))
    expect(
      NAV.some((t) => /^z-\d+$/.test(t)),
      '导航条没有 z-*：底下任意一张卡片加个 position: relative 就会盖在它上面。',
    ).toBe(true)
  })

  it('两档都看得出是玻璃 —— 轻纱压场 ≥1.08（深伴星）/ 霜面压场 ≥1.046（浅对浅）', () => {
    /*
     * 037 的第一版「没效果」（使用方原话）就是这么来的：75% 白压在近白纸上
     * 只有 1.0x，玻璃与底在数值上几乎同色 ——「半透明」这个属性在屏幕上不存在。
     * 043 的两档各有一条线（两条都是 tailwind.config 里记的定档依据）：
     *
     *   轻纱（侧栏）是**深伴星** —— 比场深一档，与 desk/canvas 那对同按 1.08 钉，
     *   四个代表点全钉（模型上最窄 1.14，最深端）；
     *   霜面是**浅对浅** —— 白玻璃压浅场，按房屋底线 1.046 钉，最窄 1.06（最亮端）。
     *
     * 白斑点的排除理由与「卡片压霜面」那条相同（角落尖峰，另有探针专测）；
     * 轻纱那对**不排除**：侧栏与白斑同在最左边，「最深端」是它真正的最窄点。
     */
    expect(VEIL_SHOWN.length, '轻纱压色没算出来（侧栏锚点或场配方断了）').toBeGreaterThan(0)
    expect(FROST_SHOWN.length, '霜面压色没算出来（锚点或场配方断了）').toBeGreaterThan(0)
    for (const [name, under] of underlayList) {
      const veil = (VEIL_SHOWN.find(([n]) => n === name) || [])[1]
      expect(
        contrast(veil, under),
        `轻纱压场（${name}）只有 ${contrast(veil, under).toFixed(2)}:1 —— ` +
          '玻璃与底同色时它就只是一块色板，「半透明」这个属性在屏幕上不存在' +
          '（037 使用方看到「没效果」就是这一条塌了）。',
      ).toBeGreaterThanOrEqual(1.08)
    }
    for (const [name, under] of gradientPoints) {
      const frost = (FROST_SHOWN.find(([n]) => n === name) || [])[1]
      expect(
        contrast(frost, under),
        `霜面压场（${name}）只有 ${contrast(frost, under).toFixed(2)}:1 —— ` +
          '低于 1.046 白玻璃与场糊成一片（最亮端最窄）。',
      ).toBeGreaterThanOrEqual(1.046)
    }
  })

  it('填充的不透明度落在 45~65（清水档的设计区间，两档各自量）', () => {
    /*
     * 这条是**通透度**，不是对比度 —— 对比度由上面几组管着，两者是两个方向：
     * 透明度往高调（更透）→ 越接近身后的场；往低调（更实）→ 越接近一块色板。
     *
     * 043 的「透明」把区间整体下移（041 是 50~90、填充 85%/60%）：低于 45
     * 玻璃与身后的场趋同、整块发闷（036 的老结论：平纸上 blur 无物可糊）；
     * 高于 65 又回到「色板」那条老路（模糊无从表现）。55 落在区间里，
     * 是实机定档的取值，不是被某条对比度公式逼出来的。
     */
    for (const [name, tokens, kind] of [
      ['侧栏', SIDEBAR, 'veil'],
      ['导航条', NAV, 'white'],
      ['主区栏', MAIN, 'white'],
    ]) {
      const fill = fillOf(tokens, kind)
      expect(fill, `${name}没有 bg-${kind}/xx 填充`).toBeTruthy()
      const alpha = Number(fill.split('/')[1])
      expect(alpha, `${name}的填充不透明度 ${alpha}% 落在 45~65 之外`).toBeGreaterThanOrEqual(45)
      expect(alpha, `${name}的填充不透明度 ${alpha}% 落在 45~65 之外`).toBeLessThanOrEqual(65)
    }
  })

  it('saturate 整条退役：三块玻璃的类名里不许再出现 backdrop-saturate-*', () => {
    /*
     * 043 的场是**无彩**的：saturate 提不出任何东西，白提。
     * （`.glass-sample` 是唯一的例外 —— 那是 042 的真折射链，saturate(1.4) 在
     * CSS 里、是折射链的一环，不是面板 chrome，类名侧不跟。）
     */
    const offenders = []
    for (const file of SOURCE_FILES) {
      for (const { tokens, line } of classAttrsOf(stripComments(read(file)))) {
        const hit = tokens.filter((t) => t.includes('backdrop-saturate'))
        if (hit.length) offenders.push(`${rel(file)}:${line} ${hit.join(' ')}`)
      }
    }
    expect(
      offenders,
      'backdrop-saturate 回流了。043 的场是无彩的，三块玻璃的 saturate 整条退役 —— ' +
        '只在 .glass-sample（真折射链，CSS 里）保留 saturate(1.4)。',
    ).toEqual([])
  })

  /*
   * —— 固定大小那条链上的四个元素 ——
   * 全部走 class 属性取，不走行文本：这几段的注释里就写着 `min-h-0`、`flex-col`、
   * `h-[calc(100vh-…)]`，按行扫会把注释当成代码（变更-029 的探针踩过这个坑）。
   */
  const MAIN_EL = tokensOf((WORKBENCH.match(/<main class="([^"]*)"/) || ['', ''])[1])
  // 纸：`<main>` 之后的第一个 <div class="…">（中间那段注释里没有 class=）
  const PAPER = tokensOf(
    (WORKBENCH.slice(WORKBENCH.indexOf('<main class="')).match(/<div class="([^"]*)"/) || [
      '',
      '',
    ])[1],
  )
  // 主区列：`</aside>` 之后的第一个 class 属性
  const COLUMN = tokensOf(
    (WORKBENCH.slice(WORKBENCH.indexOf('</aside>')).match(/:?class="([^"]*)"/) || ['', ''])[1],
  )

  it('固定大小的四个元素都解析出来了 —— 锚点失效时先在这里红', () => {
    expect(MAIN_EL.length, '没解析出 <main> 的 class').toBeGreaterThan(0)
    expect(PAPER.length, '没解析出纸的 class').toBeGreaterThan(0)
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
     * - **不给栏手算 `h-[calc(100vh-…)]`**：导航条的高度不是常数（页签换行、字体回退
     *   都会变），把它减进 calc 里，改天导航条长高一行，主区就跟着错位。
     */
    expect(
      PAPER,
      '纸不是定高：写的是 min-h-* 之类。**下限不是高度** —— 纸会跟着内容长，' +
        '主区栏就退回「跟着内容长」，实测 619 → 3381px、整页多出一条滚动条。',
    ).toContain('h-[calc(100vh-2rem)]')
    expect(
      PAPER.filter((t) => /^min-h-/.test(t)),
      '纸同时挂着 min-h-* 与定高 —— 下限会把定高顶开，等于没有定高。',
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
     * 静态外壳的算术（原注释在纸那一处）：
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
// 13. 两档玻璃上的文字安全复算（轻纱上的 slate 深字 / 霜面上的 slate-600）
// ---------------------------------------------------------------------------

describe('两档玻璃上的文字安全复算（轻纱上的 slate 深字 / 霜面上的 slate-600）', () => {
  /*
   * 这一组是「材质决定文字」的账，两档各一本（043 翻面：041 是深底配白字，
   * 现在两档都是浅底配深字）：
   *
   *   · 轻纱侧栏 —— 浅纱上的文字**整批翻深**（043 改动量最大的一处，漏一处就
   *     欠对比度）：主标题 `text-slate-900`（压纱最坏 ~13.8）、正文/身份行
   *     `text-slate-700`（~8.0）、弱化行 `text-slate-600`（~5.8）。白**只留在
   *     选中胶囊 `bg-brand` 实底里面**（16.83）。
   *   · 霜面两栏 —— 压在上面的弱化文字是 `slate-600`（页签未选中态）：
   *     压霜面 ~7.2。`slate-500` 压霜面是 4.4~4.5 的贴线档（最深端 4.37 不过）
   *     —— 所以页签不写 500。
   *
   * 「最坏」= 场的白斑处（压在纱/霜身后最亮的一点），底色从 glass-effects.css
   * 解析出来的三段渐变推出来（见文件头的 underlayList）—— 不是常量。
   */
  it('轻纱侧栏上的文字只有 slate 深字族（+ 白：只在胶囊里；+ 一处退出登录的 rose）', () => {
    /*
     * 规则仍是「侧栏里一律不许出现别的色系」，而不是逐处判断「这个 span 里是
     * 文字还是图标」：后者要靠人读上下文，护栏判不了。图标本可以留在灰系
     * （走非文字元素的 3:1），但一条不许的规则好守得多。
     *
     * 例外收成两处：选中胶囊里的白（压石墨 16.83 —— 它是「反白」，不是浅色字），
     * 与退出登录 hover 的 rose-700（那个动作的语义色）。
     * 只认 class 属性里的类名，不认行文本 —— 侧栏的注释里就写着 slate-*，
     * 按行扫会把它也算进来（变更-029 的探针踩过这个坑）。
     */
    const asideBlock = WORKBENCH.slice(WORKBENCH.indexOf('<aside'), WORKBENCH.indexOf('</aside>'))
    const attrs = classAttrsOf(stripComments(asideBlock))
    expect(attrs.length, '没在 <aside> 里解析出 class 属性 —— 锚点断了，先修这条').toBeGreaterThan(
      5,
    )
    const tokens = attrs.flatMap((a) => a.tokens)

    // 字号/对齐类不是颜色：只认「色系名（+ 档位）」这个形态
    const FAMILY =
      /(?:^|:)text-(white|black|rose|slate|sky|brand|emerald|amber|red|orange|yellow|lime|green|teal|cyan|indigo|violet|purple|fuchsia|pink|gray|zinc|neutral|stone)(-\d{2,3})?(?:\/\d{1,3})?$/
    const offenders = tokens.filter((t) => {
      const m = t.match(FAMILY)
      if (!m) return false
      // 例外一：白（选中胶囊与它里面的图标块 —— 那是反白，只在深底上）
      if (m[1] === 'white') return false
      // 例外二：slate 深字族（043 的整批翻深）
      if (m[1] === 'slate') return false
      // 例外三：退出登录 hover 的 rose-700（那个动作的语义色）
      return !(m[1] === 'rose' && m[2] === '-700')
    })
    expect(
      offenders,
      '侧栏里出现了 slate/白以外的文字色。纱面是浅底 —— 浅色字压它欠对比度' +
        '（slate-500 只有 3.7、白系更浅），深底时代的白字族在 043 全部翻深；' +
        '语义色只有退出登录那处 rose。',
    ).toEqual([])
  })

  it('侧栏深字族的锚点 —— 三档 slate、白透块三档、石墨胶囊串、焦点环都在', () => {
    const asideBlock = WORKBENCH.slice(WORKBENCH.indexOf('<aside'), WORKBENCH.indexOf('</aside>'))
    const tokens = classAttrsOf(stripComments(asideBlock)).flatMap((a) => a.tokens)
    for (const t of ['text-slate-900', 'text-slate-700', 'text-slate-600']) {
      expect(tokens, `侧栏里没有 ${t} —— 深字族的三档没了`).toContain(t)
    }
    // 选中行：石墨胶囊 + 白描边环（043 删了 shadow-glow 光晕 —— 实底自撑）
    expect(
      WORKBENCH.includes("'bg-brand ring-1 ring-white/20'"),
      '侧栏选中行不是「bg-brand + ring-1 + ring-white/20」那串了 —— ' +
        '三段各管一件事（底色/描边粗细/描边色），别拆',
    ).toBe(true)
    for (const t of ['bg-white/40', 'bg-white/15', 'bg-white/45']) {
      // /15 是选中图标块、/40 是未选中图标块、/45 是整行 hover —— 三种前缀都算数
      expect(
        tokens.some((tok) => tok === t || tok === `hover:${t}` || tok === `group-hover:${t}`),
        `侧栏里没有 ${t}（含 hover: / group-hover: 形态）。未选中行底与图标块是白色` +
          '**透块**：纱面是浅的，实白块会刺眼（037 使用方诉状同一个理），靠透明度分层次。',
      ).toBe(true)
    }
    expect(
      tokens,
      '侧栏的焦点环不是 ring-brand —— 043 起它跟全站一个环色（石墨压浅纱 ~13.7，' +
        '041 那种「深底上豁免白环」的理由随深侧栏一起退役）',
    ).toContain('focus-visible:ring-brand')
  })

  it('slate 深字族在轻纱上过 AA（每段场的实算）；slate-500 压纱只有 3.7 —— 这就是最小到 600 的原因', () => {
    expect(VEIL_SHOWN.length, '轻纱压色没算出来（侧栏锚点或场配方断了）').toBeGreaterThan(0)
    for (const level of ['slate-900', 'slate-700', 'slate-600']) {
      const hex = HEX[level]
      expect(hex, `HEX 表里没有 ${level}，先补上再算`).toBeTruthy()
      for (const [name, veil] of VEIL_SHOWN) {
        expect(
          contrast(hex, veil),
          `${level} 压轻纱（${name}）只有 ${contrast(hex, veil).toFixed(2)}:1 —— 侧栏的深字族从这里开始欠`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
    // 反面（tripwire）：slate-500 压纱最亮处只有 3.67 —— 它若哪天被当正文写在纱面上，
    // 先在这里可见（图标块里可以：那是非文字元素，3:1 就够）
    const worst = Math.max(...VEIL_SHOWN.map(([, veil]) => contrast(HEX['slate-500'], veil)))
    expect(
      worst,
      `${worst.toFixed(2)} —— slate-500 在轻纱上竟然过 4.5 了？纱面若被调亮，` +
        '重新决定「纱面上的弱化档」再拆这条',
    ).toBeLessThan(4.5)
  })

  it('选中胶囊上的字：纯白 16.83；白的各档透明度压石墨也全过（041 的贴线账随蓝退役）', () => {
    /*
     * 蓝胶囊时代（041）「白的各档透明度压 brand 全破 AA」—— /95 4.39、/85 3.82，
     * 只有纯白 4.70 过线，所以选中行的提示行必须转纯白。043 的石墨主色把这条
     * 账整个翻面：/85 白压石墨都有 12.39 —— 提示行的纯白现在是**层次手段**
     * （字号 14/12 + 字重 medium/normal），不再是阈值救火。
     *
     * 这条同时是余量哨兵：余量来自「底够深」。brand 若被调浅（往任何亮色走），
     * 最软的 /85 白先跌回 4.5 附近 —— 那时这里红，重新决定提示行的字色。
     */
    const brand = tokenHex('brand')
    expect(brand, 'tailwind.config.js 里没有 colors.brand').toBeTruthy()
    expect(
      contrast(HEX.white, brand),
      '纯白压 brand 不过 4.5 了？先看 brand 是不是被调过，再谈别的',
    ).toBeGreaterThanOrEqual(4.5)
    const softest = composite('#ffffff', 0.85, brand)
    expect(
      contrast(softest, brand),
      `${contrast(softest, brand).toFixed(2)} —— /85 白压 brand 跌到 4.5 以下了：` +
        'brand 被调浅、白字余量收窄，重新决定选中胶囊上的字色再拆这条',
    ).toBeGreaterThanOrEqual(4.5)
    // 版面上的锚：提示行那一串里得有「选中 → 纯白」的分支
    const hi = WORKBENCH.indexOf('block truncate text-xs font-normal')
    expect(hi, '没扫到侧栏提示行的 class 串（锚点断），先修这条').toBeGreaterThan(-1)
    expect(
      WORKBENCH.slice(hi, hi + 240),
      "侧栏提示行没有「选中转 'text-white'」的分支 —— 深浅两态的层次靠它",
    ).toContain("'text-white'")
  })

  it('霜面上的弱化文字用 slate-600（压霜 ~7.2）；slate-500 压霜最深端 4.37 不过', () => {
    expect(FROST_SHOWN.length, '霜面压色没算出来（锚点或场配方断了）').toBeGreaterThan(0)
    for (const [name, frost] of FROST_SHOWN) {
      const six = contrast(HEX['slate-600'], frost)
      expect(
        six,
        `slate-600 压霜面（${name}）只有 ${six.toFixed(2)}:1 —— ` +
          '页签未选中态、霜面上的说明文字用的就是它',
      ).toBeGreaterThanOrEqual(4.5)
    }
    // 反面：slate-500 压霜面最深端不过（4.37）—— 这就是霜面上不写 500 的原因。
    // （白斑处的霜面被推到 ~#fbfbfc，500 在那里贴到 4.5 边缘 —— 最深处才是判定点。）
    const deep = (FROST_SHOWN.find(([name]) => name === '最深端') || [])[1]
    expect(deep, '没解析到「最深端」的霜面压色').toBeTruthy()
    expect(
      contrast(HEX['slate-500'], deep),
      'slate-500 压霜面最深端竟然过 4.5 了？重新决定「霜面上的弱化档」再拆这条',
    ).toBeLessThan(4.5)
  })

  it('页签两串字面量：选中石墨胶囊 / 未选中 slate-600', () => {
    // 页签是三块玻璃上唯一的「一组文字」，两态各钉一串字面量 ——
    // 它同时是「选中 = brand 实底白字」与「未选中 = 压霜面的 slate-600」的锚。
    expect(
      WORKBENCH.includes("'border-brand bg-brand font-medium text-white'"),
      '页签选中态不是「border-brand bg-brand font-medium text-white」',
    ).toBe(true)
    expect(
      WORKBENCH.includes(
        "'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800'",
      ),
      '页签未选中态不是 slate-600 那串（霜面上不许 slate-500，见上一条）',
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 14. Tailwind token 命名：boxShadow / borderRadius 的 key 不许与颜色名撞车
// ---------------------------------------------------------------------------

describe('Tailwind token 命名不得与颜色名撞车', () => {
  /*
   * 变更-036 撞过一次，而且**四道关全绿**：lint、build、253 条单测、
   * 这整个文件，一条都没红。所以这条护栏不是防呆，是补一个**真的漏过东西**的洞。
   *
   * 当时投影 token 起名叫 `glass`（`boxShadow.glass`），而 `colors` 里已经有一个
   * `glass` —— Tailwind 于是**生成了两条同名的 `.shadow-glass`**：
   *
   *   来自 boxShadow  ：.shadow-glass{--tw-shadow: 0 8px 28px rgba(15,23,42,.08), …;
   *                                  box-shadow: …}
   *   来自 shadowColor：.shadow-glass{--tw-shadow-color: #e0ddd7;
   *                                  --tw-shadow: var(--tw-shadow-colored)}
   *
   * `shadow-<色名>` 本来就是「给投影上色」的工具类，所以只要 colors 里有个键叫
   * `glass`，`shadow-glass` 就**同时**是两件事。两条规则**选择器与优先级完全一样**，
   * 后生成的那条赢 —— `--tw-shadow` 被换成「三笔颜色全取 --tw-shadow-color」的版本，
   * 外投影与上下两道内缘统统变成不透明的 `#e0ddd7`，面板周围糊了一圈实色。
   *
   * ⚠️ **这个洞特别值得堵，因为它的失败样子是「看起来还行」**：多出来那圈实色
   * 像个有意的描边，单看一块根本不像坏了，要三块并排、或者拿工具读 computed style
   * 才会露。抓到它的是无头 Chrome 读回来的 `boxShadow`（颜色 `rgb(224, 221, 215)`，
   * 而不是写进去的 `rgba(15, 23, 42, .08)`）。
   *
   * 也就是说 —— **这类问题只有真浏览器能证伪**，静态断言拦不住「已经生成的两条规则
   * 谁赢」。所以这里退一步，只钉住那个可控的因：**别这么起名**。
   * 变更-041/043 先后退役了 `glass` 与 `glow`，但这条规矩不退休 —— 下一个撞名的
   * token 照样不会报错，这条护栏就是为了在那之前把它拦下来。
   *
   * 对照的是**整个 Tailwind 自带调色板**（32 个顶层键，含 slate / white / current
   * 这些），不只是本项目的 `extend.colors`：`shadow-slate` 之类的撞名后果一模一样，
   * 而它连一行自定义配置都不需要就能撞上。
   */
  const ext = tailwindConfig.theme?.extend ?? {}
  const shadowKeys = Object.keys(ext.boxShadow ?? {})
  const radiusKeys = Object.keys(ext.borderRadius ?? {})
  const colorNames = new Set([...Object.keys(tailwindColors), ...Object.keys(ext.colors ?? {})])

  it('这条护栏本身是活的 —— 锚点断了要先在这里红', () => {
    // 下面两条断言的都是**空数组**：配置文件读不到、键名改了、导入形式变了，
    // 它们会**照样绿**。所以先钉住「确实读到了东西」，否则整条护栏就是一句空话。
    expect(shadowKeys.length, '没从 tailwind.config.js 里读到 boxShadow 的 key').toBeGreaterThan(0)
    // 比总数更稳的形状检查：调色板顶层是**色系名**（约 32 个），不是具体色阶。
    // 钉几个一定在的，别钉数字 —— 数字会随 Tailwind 升级变，形状不会。
    expect(
      ['slate', 'emerald', 'white', 'transparent'].filter((n) => !(n in tailwindColors)),
      'Tailwind 自带调色板没读到（导入形式可能变了），这条护栏会变成空转',
    ).toEqual([])
    expect(shadowKeys, '本项目自有的投影 token 一个都没读到').toContain('panel')
    expect(colorNames.has('slate'), '颜色名表里没有 slate —— 对不上调色板').toBe(true)
  })

  it('boxShadow 的 key 不与任何颜色名重名', () => {
    const clash = shadowKeys.filter((k) => colorNames.has(k))
    expect(
      clash,
      `boxShadow 里的 【${clash.join('、')}】 与颜色名重名。Tailwind 会为它生成**两条**\n` +
        '`.shadow-<名>`：一条是投影、一条是「投影色」，后者覆盖前者的 --tw-shadow ——\n' +
        '结果是所有投影被涂成那个颜色（详细后果见本用例上面那段）。换个不撞名的 key。',
    ).toEqual([])
  })

  it('borderRadius 的 key 不与任何颜色名重名', () => {
    // 同一个道理：`rounded-<色名>` 不存在，但 `border-<色名>` / `bg-<色名>` 存在，
    // 而 `rounded-*` 与它们不共享属性 —— 真正的风险是 Tailwind 未来给 borderRadius
    // 也加一个「按颜色出工具类」的插件（boxShadow 就是这么中的招），以及人读
    // `rounded-card` 时误以为 card 是个颜色。这条是廉价的对称保险。
    const clash = radiusKeys.filter((k) => colorNames.has(k))
    expect(clash, `borderRadius 里的 【${clash.join('、')}】 与颜色名重名。`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 15. 卡片内滚页签的定高链（变更-038 四个汇总 + 变更-044 储罐液位）
// ---------------------------------------------------------------------------

describe('卡片内滚的页签（汇总 ×4 + 储罐液位）：卡片撑满玻璃栏、表格区自己滚、分页行钉底（变更-038 / 044）', () => {
  /*
   * 使用方 2026-10-11 拿工单汇总的第 1 / 2 / 4 页截图，圈着分页行说：
   * 「翻页功能每页都不在一个位置，体验很差。」
   *
   * 根因不在分页器身上：分页行是卡片的最后一个子元素，**卡片多高它就多低**；
   * 而「产成品 / 物料名称」那几列是 `whitespace-normal break-words` 的，每页折行
   * 的条数不一样，卡片跟着内容一高一矮 —— 分页行就一上一下。
   *
   * 这条链与上面「固定大小」那条是**同一个坑的两个面**：`flex-1 min-h-0` 分配的是
   * 「父元素给的空间」，父元素自己得先有个定高。所以钉的是整条，不是某一段 ——
   * 少一级 `min-h-0`，卡片就会被内容重新顶高、分页行照旧乱跑，而静止看一屏
   * **完全正常**，只有翻页才看得出来。
   *
   * 041 只动了这四条链上的**卡片那一串**（border/bg/blur 换白霜近亲配方），
   * 布局 token 一字未动 —— 定稿的卡片串在下面写死。
   *
   * 取法照上面那条的规矩：**走 class 属性，不走行文本** —— 这几段源码的注释里就
   * 写着 `min-h-0`、`h-full`、`overflow-y-auto`（讲道理用的），按行扫会把注释当代码。
   *
   * 变更-044：月底储罐液位记录（TankLevelPanel）接上同一张方子 —— 使用方
   * 2026-10-11 对这个页签说的是同一句话「翻页组件位置变化，体验不好」，038 的
   * 台账当时就点名过它「是同一个毛病、同一张方子能治」（另有设备保养、文件导入
   * 预览表，仍未动）。它的链在**面板文件**里，包装层与 `:active` 还在 WorkOrderList
   * —— 所以第三条用例扫的是面板源码，时间线那条账也改成五份对账。
   */
  const TABS = ['workOrder', 'material', 'inbound', 'stock']
  const TANK_PANEL = read(join(SRC, 'components', 'TankLevelPanel.vue'))
  const classAttr = (tab) =>
    WORKBENCH.match(new RegExp(`<div v-show="activeTab === '${tab}'" class="([^"]*)"`))?.[1] ?? ''
  const classAttrsIn = (src) =>
    [...src.matchAll(/(:?)class="([^"]*)"/g)].map((m) => ({
      bound: m[1] === ':',
      value: m[2],
    }))
  const CLASS_ATTRS = classAttrsIn(WORKBENCH)
  const TANK_CLASS_ATTRS = classAttrsIn(TANK_PANEL)
  const countStatic = (text) => CLASS_ATTRS.filter((a) => !a.bound && a.value === text).length
  const countStaticTank = (text) =>
    TANK_CLASS_ATTRS.filter((a) => !a.bound && a.value === text).length

  it('四个页签的定高链一级不少：包装层 h-full → 卡片 flex-1/min-h-0 → 表格区是唯一滚动容器', () => {
    expect(
      TABS.map(classAttr).filter(Boolean).length,
      '没解析出四个汇总页签的包装层 —— 锚点失效（v-show 的写法变了？），先在这里红',
    ).toBe(TABS.length)

    for (const tab of TABS) {
      const wrapper = tokensOf(classAttr(tab))
      expect(
        wrapper,
        `${tab} 的包装层少了 flex/h-full/flex-col：卡片拿不到定高，会把这张卡连带` +
          '分页行一起顶回「跟着内容长」—— 这一轮就白改了（与固定大小那条链同理，' +
          '上面那段注释记着实测：内容短的时候看着完全正常，量了才知道没固定住）。',
      ).toEqual(expect.arrayContaining(['flex', 'h-full', 'flex-col']))
    }

    expect(
      countStatic(
        'flex min-h-0 flex-1 flex-col rounded-card border border-white/60 bg-raised/95 backdrop-blur-xl shadow-card',
      ),
      '不是四张卡片都写着 flex/min-h-0/flex-1/flex-col + 白霜近亲配方：`min-h-0` 是' +
        '这里的关键一笔 —— flex 项默认 min-height:auto（不许比内容矮），不写它卡片' +
        '就被内容顶高，分页行照旧一页一个位置。',
    ).toBe(TABS.length)

    expect(
      countStatic('rounded-card border border-white/60 bg-raised/95 backdrop-blur-xl shadow-card'),
      '不是其余五张 section 卡片（周统计/日统计/储罐/设备/体积）都换成了白霜近亲配方 —— ' +
        '041 的卡片是**一条材质规则**，不是只改四张',
    ).toBe(5)

    expect(
      countStatic('relative flex min-h-0 flex-1 flex-col'),
      '不是四个卡片主体（div.relative）都转成了纵向 flex：高度传不到表格区',
    ).toBe(TABS.length)

    expect(
      countStatic('flex min-h-0 flex-1 flex-col'),
      '不是四个分页行的兄弟层（v-else）都转成了纵向 flex：表格区与分页行分不到高度',
    ).toBe(TABS.length)

    expect(
      countStatic('min-h-0 flex-1 overflow-x-auto overflow-y-auto'),
      '不是四个表格区都成了「自己滚」的那一层：表格区一旦不滚，滚的就是玻璃栏，' +
        '卡片退回跟着内容长，分页行又跑起来了。',
    ).toBe(TABS.length)

    expect(
      countStatic('flex shrink-0 justify-end border-t border-slate-100 px-6 py-3'),
      '不是四个分页行都带 shrink-0：空间不够时 flex 会先压它',
    ).toBe(TABS.length)
  })

  it('储罐液位同一张方子（变更-044）：链在面板文件里，定高由包装层传下来', () => {
    expect(
      tokensOf(classAttr('tankLevel')),
      '储罐液位的包装层少了 flex/h-full/flex-col：卡片拿不到定高，分页行会退回' +
        '「跟着内容跑」—— 使用方 2026-10-11 报的就是它：第 4 页只剩 1 行时，' +
        '分页行从卡底跳到第 31 行下面。',
    ).toEqual(expect.arrayContaining(['flex', 'h-full', 'flex-col']))

    expect(
      countStaticTank(
        'flex min-h-0 flex-1 flex-col rounded-card border border-white/60 bg-raised/95 shadow-card backdrop-blur-xl',
      ),
      '储罐卡片没有转成「撑满 + 纵向 flex + min-h-0」：不写 min-h-0 的后果与' +
        '四个汇总页签同款 —— 卡片被内容顶高，分页行一页一个位置。',
    ).toBe(1)

    expect(
      countStaticTank('relative flex min-h-0 flex-1 flex-col'),
      '储罐卡片主体（div.relative）没有转成纵向 flex：高度传不到表格区',
    ).toBe(1)

    expect(
      countStaticTank('flex min-h-0 flex-1 flex-col'),
      '储罐分页行的兄弟层（v-else）没有转成纵向 flex：表格区与分页行分不到高度',
    ).toBe(1)

    expect(
      countStaticTank('min-h-0 flex-1 overflow-x-auto overflow-y-auto'),
      '储罐表格区不是「自己滚」的那一层：表格区一旦不滚，滚的就是玻璃栏，' +
        '卡片退回跟着内容长，分页行又跑起来了。',
    ).toBe(1)

    expect(
      countStaticTank('flex shrink-0 justify-end border-t border-slate-100 px-6 py-3'),
      '储罐分页行没有带 shrink-0：空间不够时 flex 会先压它',
    ).toBe(1)
  })

  it('滚动时间线的来源跟着滚动容器走 —— 不再挂死在玻璃栏上', () => {
    /*
     * `--main-scroll` 是**三块玻璃边缘高光的来源**（glass-effects.css 里
     * `.glass-scroll` 声明、`.glass-refract` 消费）。它必须挂在「当时真正在滚的
     * 那个元素」上：这四个页签改完之后玻璃栏不再滚了，时间线留在它身上就会
     * **冻住** —— 高光静止不动，不报错、不警告，正是最难发现的那种。
     *
     * 反过来也不行：四个页签是 `v-show` 的，**始终在 DOM 里**，同时挂着 4 条同名
     * 时间线属于未定义行为。所以逐页签绑定，任何时刻只有一处声明。
     */
    const carriers = CLASS_ATTRS.filter((a) => a.value.includes('glass-scroll'))
    expect(
      carriers.filter((a) => !a.bound).map((a) => a.value),
      'glass-scroll 回到了静态 class 上 —— 时间线会挂死在一个不再滚动的元素上，' +
        '三块玻璃的边缘高光从此不跟手（换成 :class 绑定，由 activeTab 决定挂在哪）。',
    ).toEqual([])

    expect(
      carriers.filter((a) => a.bound && a.value.includes('!scrollsInsideCard')).length,
      '玻璃栏上没有「不是那四个页签时由我承担时间线」的那条绑定',
    ).toBe(1)

    const boundTabs = carriers
      .filter((a) => a.bound)
      .map((a) => a.value.match(/activeTab === '(\w+)'/)?.[1])
      .filter(Boolean)
    expect(
      boundTabs,
      '四个汇总页签的表格区没有各自声明滚动时间线 —— 这四个页签上高光会冻住',
    ).toEqual(TABS)

    // 储罐液位（变更-044）：绑定在面板文件里、认的是 `active` prop（子组件拿不到
    // activeTab），由 WorkOrderList 那只 `:active` 把它的页签名对进同一本账。
    expect(
      TANK_CLASS_ATTRS.filter((a) => a.bound && a.value.includes("'glass-scroll': active")).length,
      'TankLevelPanel 的表格区没挂 glass-scroll 的 active 绑定 —— 储罐页签上高光会冻住',
    ).toBe(1)
    expect(
      TANK_CLASS_ATTRS.filter((a) => !a.bound && a.value.includes('glass-scroll')).map(
        (a) => a.value,
      ),
      'glass-scroll 出现在 TankLevelPanel 的静态 class 上 —— v-show 常驻，它会与激活' +
        '页签的声明同时存在，时间线归属成未定义行为。',
    ).toEqual([])

    // 脚本里的名单与模板上的绑定必须对得上（两本平行账，钉在一起）。
    // 变更-044 起名单是五份：四个汇总页签在里面绑、储罐液位在外面绑，靠 `:active` 对账。
    const list = WORKBENCH.match(/const INNER_SCROLL_TABS = \[([^\]]*)\]/)?.[1] ?? ''
    const panelTab = WORKBENCH.match(/<TankLevelPanel :active="activeTab === '(\w+)'"/)?.[1]
    expect(
      [...boundTabs, panelTab],
      'INNER_SCROLL_TABS 与模板上真正挂 glass-scroll 的页签对不上 —— ' +
        '多一个（那个页签其实在玻璃栏里滚，时间线却挂在了不动的表格区上）、' +
        '少一个（那个页签表格区在滚，时间线却留在玻璃栏上），两边都是「高光冻住」。',
    ).toEqual([...list.matchAll(/'(\w+)'/g)].map((m) => m[1]))
  })
})

// ---------------------------------------------------------------------------
// 16. 键盘可达：可点的非按钮元素必须有键盘通路
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
   *   · 行内小图标按钮的焦点圈用 ring-brand（在 RING_OK 白名单里）。
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

// ---------------------------------------------------------------------------
// 17. 边缘光学 + 真折射样张（变更-042）
// ---------------------------------------------------------------------------
describe('边缘光学与真折射样张（变更-042）', () => {
  /*
   * 042 是 WWDC25 物料描述里被 041 明确推迟（并写进「不做」清单）的两件事：
   * **边缘色散** 与 **真实透镜折射**。分两半落地，这份契约各钉一半：
   *
   *   (A) 工作台三块玻璃的「边缘光学」—— 全浏览器，零新技术：
   *       panel token 在基础三笔（外投影 + 顶白镜面 + 底深厚度）上加了四笔
   *       色散线（顶/左冷、底/右暖；043 只换了前三笔的颜色值，四笔色散线
   *       逐字节保留 —— 使用方 042 点名要过，1px 光学不是配色）。
   *       **顺序是载荷**：CSS Backgrounds 3 原文
   *       「the first shadow is on top」—— 列表第一条画在最上，所以 041 的白
   *       镜面线必须仍在顶冷线之前、底深线必须仍在底暖线之前。另一条容易忘的
   *       规范事实：inset 阴影被裁在 **padding box** 内（画在背景之上、描边之下），
   *       三块玻璃都有 1px border-white，所以色散线画在白描边**里侧**。
   *
   *   (B) /intro Hero 图上的真折射样张 —— Chromium-only：
   *       `backdrop-filter: url(#lg-refract)` + feDisplacementMap ×3 逐通道色散。
   *       降级走**级联**不走 @supports（三家引擎对 url() 的 @supports 都答「支持」，
   *       假阳性；真渲染只有 Chromium），所以 .glass-sample 里 blur 行必须写在
   *       url 行之前 —— 这两行的顺序就是降级链本身。
   *
   * 滤镜链的六个坑（region 0/0/1/1、preserveAspectRatio=none、不写 primitiveUnits、
   * sRGB、feColorMatrix 第 4 行保 alpha、容器 h-0/w-0 非 display:none）的「为什么」
   * 写在 Intro.vue 模板注释里；每一条的失败样子都是「不报错、只是没效果」，所以
   * 这里只钉得住属性本身 —— 删一条，下面就会在属性上红。
   *
   * scale 链 28/32/36 与 (c−a)/b=0.25 是**实测定案**（_runlogs/refract-tune.mjs
   * 把 spread 从 0.125 拉到 0.625，虹边信号只从 4 涨到 7/255 —— 底图高频是 1–3px
   * 细线，通道错位超过线宽后色差不再增长；0.25 是平台起点）。改这三个数 =
   * 重新做过那组实测，别在编辑器里顺手调。
   */
  const PANEL = tailwindConfig.theme?.extend?.boxShadow?.panel
  const INTRO = read(join(SRC, 'views', 'Intro.vue'))
  const FILTER_FRAG = (INTRO.match(/<filter[\s\S]*?<\/filter>/) || [''])[0]
  const FILTER_TAG = (FILTER_FRAG.match(/<filter[\s\S]*?>/) || [''])[0]
  const HIDDEN_SVG = (INTRO.match(
    /<svg\s+class="pointer-events-none absolute h-0 w-0 overflow-hidden"[\s\S]*?>/,
  ) || [''])[0]
  const SAMPLE_CLASS =
    (INTRO.match(/id="glass-sample"[\s\S]{0,600}?class="([^"]*)"/) || [])[1] || ''
  const SAMPLE_CSS = (GLASS_CSS.match(/\.glass-sample\s*\{([\s\S]*?)\}/) || [])[1] || ''
  // 切到 `@media` 的**关键帧形式**为止 —— 裸的 'prefers-reduced-transparency' 会先命中
  // 150 行颗粒注释里的同一个词，切出来是空段（这正是它第一次写错并被红掉的样子）
  const SUPPORTS_NOT_BLOCK = GLASS_CSS.slice(
    GLASS_CSS.indexOf('@supports not ('),
    GLASS_CSS.indexOf('@media (prefers-reduced-transparency'),
  )
  const REDUCED_TRANSPARENCY_BLOCK = GLASS_CSS.slice(
    GLASS_CSS.indexOf('@media (prefers-reduced-transparency'),
    GLASS_CSS.indexOf('@media (prefers-reduced-motion'),
  )

  /** 按**括号深度**切 box-shadow 列表 —— rgba(…) 里的逗号不是段界（裸 split(',') 会把颜色切碎） */
  const splitTop = (s) => {
    const out = []
    let depth = 0
    let cur = ''
    for (const ch of s) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        out.push(cur.trim())
        cur = ''
      } else cur += ch
    }
    if (cur.trim()) out.push(cur.trim())
    return out
  }
  const rgbaOf = (seg) => {
    const m = seg.match(/rgba?\(([^)]*)\)/)
    return m ? m[1].split(',').map((n) => Number(n.trim())) : null
  }
  const isInset = (seg) => /(^|\s)inset($|\s)/.test(seg)
  /** 一条影子的三个长度（offset-x / offset-y / blur），颜色元组先剥掉免得混进来 */
  const geomOf = (seg) => (seg.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+/g) || []).map(Number)
  const segIndexOf = (segs, r, g, b, a, inset = true) =>
    segs.findIndex((seg) => {
      const v = rgbaOf(seg)
      return (
        v &&
        Math.abs(v[0] - r) < 0.5 &&
        Math.abs(v[1] - g) < 0.5 &&
        Math.abs(v[2] - b) < 0.5 &&
        Math.abs(v[3] - a) < 0.005 &&
        isInset(seg) === inset
      )
    })

  it('锚点活着 —— panel token / Intro 滤镜段 / 样张 class 都解析出来了', () => {
    // 下面十条断言的全是解析出来的片段：配置读不到、模板改形、正则过时，
    // 它们会**照样绿**（空串对空断言）。所以先钉住「确实拿到了东西」。
    expect(
      typeof PANEL === 'string' && PANEL.length > 0,
      '没从 tailwind.config.js 读到 boxShadow.panel',
    ).toBe(true)
    expect(splitTop('a(b,c),d'), '切分器坏了：rgba(…) 里的逗号被当成了段界').toEqual([
      'a(b,c)',
      'd',
    ])
    expect(FILTER_FRAG, 'Intro.vue 里没找到 <filter>…</filter> 段').toContain('<feImage')
    expect(SAMPLE_CLASS, 'Intro.vue 里没解析到 #glass-sample 的 class').toContain('glass-sample')
    expect(SAMPLE_CSS, 'glass-effects.css 里没解析到 .glass-sample 的基础规则').toContain(
      'backdrop-filter',
    )
  })

  it('panel 恰好 7 段、043 三笔逐位在案（外投影 + 顶白镜面 + 底深厚度）', () => {
    const segs = splitTop(PANEL)
    expect(
      segs,
      `panel 应为 7 段（基础三笔 + 042 四笔色散线），实为 ${segs.length} 段`,
    ).toHaveLength(7)
    const outer = segs[0]
    expect(isInset(outer), '第 1 段应是外投影（不带 inset）').toBe(false)
    expect(
      rgbaOf(outer),
      '外投影的颜色变了 —— 043 起它是中性深（挡的是中性场的光），纯黑压浅灰会发死',
    ).toEqual([18, 18, 22, 0.1])
    expect(geomOf(outer)).toEqual([0, 12, 32])
    const iWhite = segIndexOf(segs, 255, 255, 255, 0.85)
    const iDark = segIndexOf(segs, 24, 24, 30, 0.1)
    expect(
      iWhite,
      '041 的顶缘白镜面线（inset 0 1px rgba(255,255,255,0.85)）不在了',
    ).toBeGreaterThan(-1)
    expect(iDark, '043 的底缘深线（inset 0 -1px rgba(24,24,30,0.10)）不在了').toBeGreaterThan(-1)
    expect(geomOf(segs[iWhite]), '白镜面线必须还是 1px 贴顶').toEqual([0, 1, 0])
    expect(geomOf(segs[iDark]), '底深线必须还是 1px 贴底').toEqual([0, -1, 0])
    // 042 只加在 panel 上，不新开 token —— 新 token 的第一风险是撞颜色名（第 14 节）；
    // 043 又退役了 glow（选中胶囊不再有光晕环，石墨实底自撑）
    expect(
      Object.keys(tailwindConfig.theme.extend.boxShadow).sort(),
      'boxShadow 的 key 集合变了 —— 042 的色散线只许加进 panel，不许新开 token',
    ).toEqual(['card', 'panel'])
  })

  it('顺序是载荷：顶白 1px 必须在顶冷 2px 之前、底深 1px 必须在底暖 2px 之前', () => {
    const segs = splitTop(PANEL)
    const iWhite = segIndexOf(segs, 255, 255, 255, 0.85)
    const iCoolT = segIndexOf(segs, 150, 190, 255, 0.3)
    const iDark = segIndexOf(segs, 24, 24, 30, 0.1)
    const iWarmB = segIndexOf(segs, 255, 180, 175, 0.22)
    expect(iCoolT, '顶缘冷线（inset 0 2px rgba(150,190,255,0.30)）不在了').toBeGreaterThan(-1)
    expect(iWarmB, '底缘暖线（inset 0 -2px rgba(255,180,175,0.22)）不在了').toBeGreaterThan(-1)
    expect(
      iWhite < iCoolT && iDark < iWarmB,
      'panel 的顺序被打乱了。CSS Backgrounds 3 原文「the first shadow is on top」——\n' +
        `列表第一条画在最上：白镜面线（第 ${iWhite + 1} 段）必须在顶冷线（第 ${iCoolT + 1} 段）之前、\n` +
        `底深线（第 ${iDark + 1} 段）必须在底暖线（第 ${iWarmB + 1} 段）之前。\n` +
        '调换 = 静默互换「谁画在最上」：屏幕上是白镜面线变暗、色散线抢戏，没有任何报错。',
    ).toBe(true)
  })

  it('042 四笔色散线：冷暖语义 / 各缘位置 / α ∈ (0.15, 0.5)', () => {
    const segs = splitTop(PANEL)
    const at = {
      顶冷: segIndexOf(segs, 150, 190, 255, 0.3),
      左冷: segIndexOf(segs, 150, 190, 255, 0.35),
      底暖: segIndexOf(segs, 255, 180, 175, 0.22),
      右暖: segIndexOf(segs, 255, 180, 175, 0.28),
    }
    for (const [label, i] of Object.entries(at)) {
      expect(
        i,
        `${label}线不在了（顶/左=rgba(150,190,255)、底/右=rgba(255,180,175) 各一）`,
      ).toBeGreaterThan(-1)
    }
    // 位置：顶/底让出第 1px 给 041 的白/深，色散线落在第 2px；左/右只有一条，落在第 1px
    expect(geomOf(segs[at.顶冷]), '顶冷线该在 y=2px（第 1px 是白镜面线）').toEqual([0, 2, 0])
    expect(geomOf(segs[at.底暖]), '底暖线该在 y=−2px（第 1px 是深线）').toEqual([0, -2, 0])
    expect(geomOf(segs[at.左冷]), '左冷线该在 x=1px').toEqual([1, 0, 0])
    expect(geomOf(segs[at.右暖]), '右暖线该在 x=−1px').toEqual([-1, 0, 0])
    // 语义：冷 = 蓝多于红，暖 = 红多于蓝（光穿过有厚度的玻璃边被掰开的色光方向）
    for (const label of ['顶冷', '左冷']) {
      const [r, , b] = rgbaOf(segs[at[label]])
      expect(b > r, `${label}线的蓝分量必须大于红（现在 R=${r} B=${b}）`).toBe(true)
    }
    for (const label of ['底暖', '右暖']) {
      const [r, , b] = rgbaOf(segs[at[label]])
      expect(r > b, `${label}线的红分量必须大于蓝（现在 R=${r} B=${b}）`).toBe(true)
    }
    // α 档位：低于 0.15 在屏幕上找不到，高于 0.5 会抢 041 镜面线的主次
    for (const [label, i] of Object.entries(at)) {
      const a = rgbaOf(segs[i])[3]
      expect(a > 0.15 && a < 0.5, `${label}线 α=${a} 出了 (0.15, 0.5) 区间`).toBe(true)
    }
  })

  it('滤镜六条硬规矩的载荷属性都在（region / sRGB / PAR=none / 无 primitiveUnits / h-0·w-0 不是 display:none）', () => {
    // 每条的「为什么」在 Intro.vue 模板滤镜注释里；失败样子都是「不报错、只是没效果」
    expect(FILTER_TAG, 'filter 起始标签没解析到').toContain('filterUnits="objectBoundingBox"')
    for (const attr of ['x="0"', 'y="0"', 'width="1"', 'height="1"']) {
      expect(
        FILTER_TAG,
        `滤镜区域缺 ${attr} —— 默认 -10%/120% 外边距会把贴图缩成中间一小块`,
      ).toContain(attr)
    }
    expect(
      FILTER_TAG,
      'color-interpolation-filters="sRGB" 没了 —— linearRGB 会把 128 当 0.216，整块恒定平移（看着是「错位」不是折射）',
    ).toContain('color-interpolation-filters="sRGB"')
    // 剥注释再扫：模板注释里**写着**「也不能出现 primitiveUnits」这句话本身
    // （教训式的注释），裸 toContain 会把这条记录当成用法红掉。
    expect(
      stripComments(INTRO),
      '出现 primitiveUnits —— Blink 对它的百分比解析有坑（svgwg #1012）',
    ).not.toContain('primitiveUnits')
    expect(
      FILTER_FRAG,
      'feImage 缺 preserveAspectRatio="none"（初始值 xMidYMid meet 会等比留白）',
    ).toMatch(/<feImage[^>]*preserveAspectRatio="none"/)
    expect(
      HIDDEN_SVG,
      '隐藏 svg 容器丢了 pointer-events-none absolute h-0 w-0 overflow-hidden 四件套',
    ).toBeTruthy()
    expect(
      HIDDEN_SVG,
      '隐藏容器不许 display:none —— feImage 从 display:none 的树里取图会静默失败',
    ).not.toMatch(/display:\s*none/)
  })

  it('色散链 28/32/36 是实测定案：递增、spread ∈ [0.15,0.3]、褶皱余量 ≥15%', () => {
    // 28/32/36 不是拍的（详见本 describe 注释与 _runlogs/refract-tune.mjs 的实测表）。
    // 改这三个数 = 重新做过那组实测，不在编辑器里顺手调。
    const scales = [...FILTER_FRAG.matchAll(/scale="(\d+)"/g)].map((m) => Number(m[1]))
    expect(scales, '色散链的 scale 值变了 —— 改动前先重跑 _runlogs/refract-tune.mjs').toEqual([
      28, 32, 36,
    ])
    const spread = (scales[2] - scales[0]) / scales[1]
    expect(
      spread >= 0.15 && spread <= 0.3,
      `spread=(c−a)/b=${spread} 出了 [0.15,0.3]（平台起点 0.25）`,
    ).toBe(true)
    // 折叠：位移场最大斜率 = scale × 0.01907（0.03113 编码系数 × 14.7·1.5/36 的贴图最大梯度），
    // 斜率到 1 内容就翻折（scale≈52）。要求余量 ≥15%。
    const fold = Math.max(...scales) * 0.01907
    expect(
      fold <= 0.85,
      `scale 上限 ${Math.max(...scales)} 的位移场斜率 ${fold.toFixed(2)} 逼近褶皱阈值 1`,
    ).toBe(true)
    // 通道选择器：贴图语义 R=x / G=y，三条都要
    expect(
      [...FILTER_FRAG.matchAll(/xChannelSelector="R"/g)],
      'xChannelSelector 不全',
    ).toHaveLength(3)
    expect(
      [...FILTER_FRAG.matchAll(/yChannelSelector="G"/g)],
      'yChannelSelector 不全',
    ).toHaveLength(3)
  })

  it('三条 feColorMatrix 精确隔离单通道（第 4 行 0 0 0 1 0 保 alpha）+ 两次 screen 合成', () => {
    const mats = [...FILTER_FRAG.matchAll(/values="([^"]*)"/g)].map((m) =>
      m[1].replace(/\s+/g, ' ').trim(),
    )
    expect(mats, 'feColorMatrix 数量不是 3').toHaveLength(3)
    expect(mats[0], 'R 通道隔离矩阵变了').toBe('1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0')
    expect(mats[1], 'G 通道隔离矩阵变了').toBe('0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0')
    expect(mats[2], 'B 通道隔离矩阵变了').toBe('0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0')
    for (const [i, v] of mats.entries()) {
      expect(v.split(' ').length, `第 ${i + 1} 条矩阵不是 4×5=20 个数`).toBe(20)
      expect(
        v.endsWith('0 0 0 1 0'),
        `第 ${i + 1} 条矩阵第 4 行必须是 0 0 0 1 0（保 alpha）—— 否则 screen 合成完整块透明`,
      ).toBe(true)
    }
    const blends = [...FILTER_FRAG.matchAll(/<feBlend\b[^>]*mode="([^"]*)"/g)].map((m) => m[1])
    expect(blends, '两次 feBlend 都必须是 screen（通道不相交 → screen≈加）').toEqual([
      'screen',
      'screen',
    ])
  })

  it('?inline 导入 + 两个 id 全仓各恰好一处', () => {
    // feImage 只认 data URL；lg-map.png 是 6.4KB > Vite 默认 4KB 内联阈值，
    // 不吃 ?inline 的话构建后 feImage 拿到的是外部 URL 而不是图片本体。
    // 构建侧证据：dist 里能 grep 到 data:image/png;base64 且没有 lg-map*.png。
    expect(INTRO, 'lg-map 的导入必须带 ?inline 后缀').toMatch(
      /import\s+lgMap\s+from\s+'[^']*lg-map\.png\?inline'/,
    )
    for (const id of ['lg-refract', 'glass-sample']) {
      const hits = scan(new RegExp(`id="${id}"`))
      expect(
        hits.length,
        `id="${id}" 应该在 src/ 里恰好出现 1 次，实为 ${hits.length} 次：${hits.join('、')}`,
      ).toBe(1)
    }
  })

  it('.glass-sample 的级联降级：blur 行必须写在 url 行之前 —— 这两行的顺序就是降级链', () => {
    // 不用 @supports 探测：三家引擎对 `@supports (backdrop-filter: url(#x))` 都答「支持」
    // （假阳性），而真渲染只有 Chromium。顺序调换 = WebKit/Firefox 解析掉不认识的
    // url() 行后没有兜底 —— 整条 backdrop 声明失效，玻璃直接消失。
    const blurAt = SAMPLE_CSS.indexOf('backdrop-filter: blur(10px) saturate(1.4)')
    const urlAt = SAMPLE_CSS.indexOf('url(#lg-refract)')
    expect(blurAt, '.glass-sample 里找不到纯 blur 的兜底行').toBeGreaterThan(-1)
    expect(urlAt, '.glass-sample 里找不到 url(#lg-refract) 的折射行').toBeGreaterThan(-1)
    expect(
      blurAt < urlAt,
      'url() 行排到 blur 兜底行之前了 —— 解析层不认 url() 的引擎会整条丢掉，\n' +
        '玻璃在 WebKit/Firefox 上直接消失（顺序就是降级链，详见 glass-effects.css 第 4 节）',
    ).toBe(true)
    // 两条都带 -webkit- 前缀（WebKit 的级联同样要两行）
    expect(SAMPLE_CSS).toContain('-webkit-backdrop-filter: blur(10px) saturate(1.4)')
    expect(SAMPLE_CSS).toContain(
      '-webkit-backdrop-filter: url(#lg-refract) blur(10px) saturate(1.4)',
    )
  })

  it('样张的三条底线：底填充 α ≤ 0.2、class 不带 glass-refract、两条降级路径都认它', () => {
    // 底填充画在折射结果**之上**（backdrop 滤镜先算、元素背景后画），每加一档 α
    // 就压掉一档折射的可见度 —— 0.2 是硬上限。
    const m = SAMPLE_CSS.match(/background-color:\s*rgb\(255 255 255 \/ ([\d.]+)\)/)
    expect(m, '没解析到 .glass-sample 的底填充（rgb(255 255 255 / α) 形式）').toBeTruthy()
    const alpha = Number(m[1])
    expect(alpha > 0 && alpha <= 0.2, `底填充 α=${alpha} 超过 0.2 —— 折射被压得看不见`).toBe(true)
    // /intro 没有 .glass-scroll 时间线作用域（零 JS、文档级滚动），挂 glass-refract
    // 只会把 --glint 动画声明带进来 —— 纯负债。
    const tokens = SAMPLE_CLASS.split(/\s+/)
    expect(tokens, '样张 class 串不得出现 glass-refract').not.toContain('glass-refract')
    expect(tokens, '样张 class 串必须含 glass-sample（CSS 挂点）').toContain('glass-sample')
    // 样张穿的是 panel token（042-A/B 的交汇点：色散镶边也在样张自己的边缘上）
    expect(tokens, '样张丢了 shadow-panel —— 边缘的冷暖镶边是它的一半观感').toContain(
      'shadow-panel',
    )
    // 两条降级路径都要认它：①不支持 backdrop-filter → 近实心雾白；②「减少透明度」→ 实心 + 关滤镜
    expect(
      SUPPORTS_NOT_BLOCK,
      '①`@supports not (backdrop-filter…)` 块丢了 .glass-sample 的近实心兜底',
    ).toContain('.glass-sample')
    expect(SUPPORTS_NOT_BLOCK).toContain('rgb(248 248 250 / 0.72)')
    expect(
      REDUCED_TRANSPARENCY_BLOCK,
      '②`prefers-reduced-transparency` 块丢了 .glass-sample',
    ).toContain('.glass-sample')
    expect(REDUCED_TRANSPARENCY_BLOCK).toMatch(
      /\.glass-sample\s*\{[^}]*background-color:\s*rgb\(248 248 250\)/,
    )
    expect(REDUCED_TRANSPARENCY_BLOCK).toMatch(/\.glass-sample\s*\{[^}]*backdrop-filter:\s*none/)
  })
})

// ---------------------------------------------------------------------------
// 18. 体积计算的液位控件：一根竖轨两钮（变更-045 起，变更-046 定形）
// ---------------------------------------------------------------------------
describe('体积计算的液位滑块（变更-046）：一根竖轨两钮、拖动即时落位、钮环与色带随语义', () => {
  /*
   * 045 先把「数字框 + −/+ 步进圆钮」改成了两根横放的滑块；使用方拿实机截图看过后
   * 一句话定形：「我希望滑块是竖放的，而且 1 个滑块上有 2 个可以滑的按钮 ——
   * 一个代表起始液位，一个代表终止液位」。
   *
   * 成形是一根 **EP vertical + range** 的竖轨：上高下低（与液面方向一致），
   * 两个钮各代表一个读数；数字框仍并存（865 / 1525 这类实测读数落不到步长格点上，
   * 「扫值」（拖）与「录值」（键入）是两种手势）。
   *
   * 这一节能静默回归的，是四条边：
   *
   *   ① **结构只有一根竖轨**：range 两钮是同一个 el-slider 的两个 button。
   *      若有人把「两根横轨各自 @input」的旧形态搬回来，就是形态倒车 ——
   *      钉精确串，回流即红。
   *   ② **两钮不许交叉 → 映射必须在**：EP range 把下钮的 max 钉在上钮、上钮的
   *      min 钉在下钮，而起始 / 终止是两个**独立读数、允许倒挂**（倒挂 = 消耗）。
   *      所以轨道收的是**排序过的一对** [低, 高]，startIsLower 负责映射回起止；
   *      映射若丢（比如有人直接绑 vesselStartLevel），倒挂态一拖就错位。
   *      setVesselLevelPair 里「方向快照必须在第一次写入之前取定」也要钉住 ——
   *      写第一个 ref 之后 startIsLower 就翻了，中途重判会把两钮的值对调。
   *   ③ **颜色语义三层、与画布共用同一对常量**：钮环 = 该钮代表读数的墨色
   *      （起始虚线 #1e293b = slate-800、终止 vesselGeometry.liquid.line）；
   *      钮间色带 = 消耗玫红 / 增加翡翠（判据 `>= 0` 与画布引线标注同源）。
   *      `#e11d48` / `#059669` 两个裸字面量**只许出现在常量定义那一处** ——
   *      画布剖面线、引线标注、滑块色带三处共用 VESSEL_DELTA_COLOR。
   *   ④ **两条调节路径必须还是两条**（045 的规矩原样）：拖动走
   *      setVesselLevelImmediate 直写、清补间；键入走 watcher 缓动；
   *      vessel-step 家族在 src 全量零残留。
   *
   * 048 又动了一次形态（使用方拿实机截图定：「红色框选部分不要了，相应的信息通过
   * 引线指向滑块按钮」）：**两根读数柱整个撤掉**，读数改成挂在钮上的引线标注。
   * 这一节因此加的第 ⑥ 条边：
   *
   *   ⑥ **标注只许挂在钮上**：两根读数柱的列宽串（min-w-[220px] / min-w-0 flex-1）
   *      与卡片配方（border-slate-200/70 bg-raised）必须零残留 —— 回流就是形态倒车；
   *      标注 top 必须由 vesselCalloutTops 注入（钮心 = 柱高 − 值/量程 × 柱高，
   *      换算在 vesselKnobY），两个标注有下限间距（钮叠一起时不叠字）；
   *      引线（polyline + circle）与标注同场，墨色 = 读数墨（起始 VESSEL_START_INK /
   *      终止 liquid.line）—— 三条一起才叫「引线指向滑块按钮」。
   *
   * 取法照全文件的规矩：**先过 stripComments**（这段注释自己就写着这些精确串），
   * 再按精确串计数；列宽那类走 class 属性。
   */
  const SRC_TEXT = stripComments(WORKBENCH)
  // 唯一的一根竖轨（自闭合、非贪婪；块内不会再嵌滑块）
  const SLIDER_BLOCKS = [...SRC_TEXT.matchAll(/<el-slider[\s\S]*?\/>/g)].map((m) => m[0])

  it('结构：一根竖轨两钮（vertical + range）、值走 model-value + @input、旧的两根横轨无残留', () => {
    expect(
      SLIDER_BLOCKS.length,
      '不是「一根竖轨」—— 解析出 ' +
        SLIDER_BLOCKS.length +
        ' 块 el-slider；锚点失效（写法又变了？）先在这里红',
    ).toBe(1)

    const slider = SLIDER_BLOCKS[0]
    expect(slider, '滑块没竖过来 —— range 一根轨的前提是 vertical').toMatch(/\n\s*vertical\n/)
    expect(slider, '两个钮共轨 —— 必须是 range 模式').toMatch(/\n\s*range\n/)
    expect(slider, '竖轨高度（EP 的 height prop 要求带单位）').toContain('height="260px"')
    expect(slider, '轨道必须收「排序过的一对」，见 startIsLower 映射').toContain(
      ':model-value="vesselLevelPair"',
    )
    expect(slider, '滑块的量程必须跟着罐体几何走').toContain(':max="vesselGeometry.maxLevel"')
    expect(slider, '滑块步长必须是 1 —— 液位是连续实测值，精确录入归数字框').toContain(':step="1"')
    expect(slider, '竖轨的工具提示必须放右侧（默认 top 会顶到钮上）').toContain('placement="right"')
    expect(slider, '工具提示（值 + mm 单位）没了').toContain(
      ':format-tooltip="formatVesselLevelTooltip"',
    )
    expect(slider, '两钮的 aria 名必须按映射走（倒挂时下钮是终止）').toContain(
      ':range-start-label="vesselLevelRangeLabels[0]"',
    )
    expect(slider).toContain(':range-end-label="vesselLevelRangeLabels[1]"')
    expect(slider, '颜色注入（钮环 + 钮间色带）的 :style 没了').toContain(
      ':style="vesselLevelSliderStyle"',
    )
    expect(slider, '拖动的唯一入口').toContain('@input="setVesselLevelPair"')
    expect(
      slider,
      'range 滑块出现了 v-model —— 它会把值送回 watcher、走 clampAndAnimateLevel 的缓动路径，' +
        '拖动就不再跟手（液面拖着尾巴）。必须保持 :model-value + @input 单一写入。',
    ).not.toContain('v-model="')

    // 旧形态无残留：两根横轨各自的 @input、模板里的裸 aria-label
    expect(SRC_TEXT, '旧的两根横轨 @input 回流了 —— 一根竖轨两钮（046）才是定形').not.toContain(
      "setVesselLevelImmediate('start', v)",
    )
    expect(SRC_TEXT).not.toContain("setVesselLevelImmediate('end', v)")
    expect(
      SRC_TEXT,
      '模板里的裸 aria-label 回流了 —— 两钮名现在走 :range-start-label / :range-end-label 映射',
    ).not.toContain('aria-label="起始液位滑块"')

    // 竖轨的定高柱（EP 竖版根是 height:100%，父柱不定高会塌成一条）——
    // 048 起柱宽 = 轨 42 + 标注栏 250：标注入列，柱心才是整组的视觉中心
    expect(
      SRC_TEXT,
      '竖轨的定高柱没了（或宽度丢了标注栏那一份）—— 竖版 el-slider 根是 height:100%，' +
        '父柱不定高就塌成一条；宽度收成只剩轨宽则标注会压到相邻内容上',
    ).toContain('relative flex h-[260px] w-[292px] shrink-0 items-center')
    expect(SRC_TEXT, '旧定高柱（无标注栏宽度的那版）回流了 —— 标注栏是 048 的地基').not.toContain(
      'flex h-[260px] shrink-0 items-center justify-center',
    )
    // 这一行是「竖轨 + 标注」同行：竖版曾是 2×2 grid（三件摆成 L 形，实机踩过）
    expect(
      SRC_TEXT,
      '读数标注与竖轨不在同一行 —— 竖版这一行必须是 flex（旧的 2×2 grid 摆不下）',
    ).toContain("'flex w-full items-center justify-center px-0'")
    expect(
      SRC_TEXT,
      '旧的竖版 2×2 grid 回流了 —— 三件（起始/竖轨/终止）会被摆成 L 形',
    ).not.toContain('grid w-full grid-cols-2 px-0')
    expect(SRC_TEXT, '横向罐型这一行也要 items-center —— 标注栏要对着 260 高的竖轨居中').toContain(
      "'flex flex-1 flex-wrap items-center justify-center gap-x-6'",
    )
    // 048：两根读数柱整个退役（列宽串 + 卡片配方都零残留）——回流即形态倒车
    expect(SRC_TEXT, '读数柱的列宽串回流了 —— 048 起读数只挂在钮上，柱已整个撤掉').not.toContain(
      "isVerticalVessel ? 'min-w-0 flex-1' : 'min-w-[220px] flex-1'",
    )
    expect(
      SRC_TEXT,
      '读数柱的卡片配方（border-slate-200/70 bg-raised）回流了 —— 使用方要撤的就是这两只框',
    ).not.toContain('border-slate-200/70 bg-raised')
  })

  it('读数标注挂在钮上：位置由值换算、同高时不叠字、引线与读数同墨', () => {
    // 标注本体：两个、各带 :style（top 由脚本注入）+ 起止两个修饰类（下划线墨相用）
    expect(SRC_TEXT.split('class="vessel-level-callout ').length - 1, '引线标注不是两个').toBe(2)
    expect(SRC_TEXT).toContain('vessel-level-callout vessel-level-callout-start')
    expect(SRC_TEXT).toContain('vessel-level-callout vessel-level-callout-end')
    expect(SRC_TEXT.split(':style="vesselStartCalloutStyle"').length - 1).toBe(1)
    expect(SRC_TEXT.split(':style="vesselEndCalloutStyle"').length - 1).toBe(1)

    // 引线层：同一只 260 定高柱的坐标系（无 viewBox）+ 折线 + 起点圆点；装饰性、不进可访问树
    expect(SRC_TEXT, '引线层没了 —— 引线是第一诉求').toContain('<svg')
    expect(SRC_TEXT).toContain('class="vessel-level-leader"')
    expect(SRC_TEXT.split('<polyline').length - 1, '两条读数引线').toBe(2)
    // 圆点按绑定计数（模板里另有若干图标 svg 自带 <circle，数标签数会被误伤）
    expect(SRC_TEXT.split(':fill="vesselLeaders.').length - 1, '两个起点圆点').toBe(2)
    expect(SRC_TEXT, '引线层没有 overflow: visible —— 线伸不出定高柱，指不到标注栏').toMatch(
      /\.vessel-level-leader \{[\s\S]{0,200}?overflow: visible/,
    )

    // 位置换算：钮心 = 柱高 − 值/量程 × 柱高（值先夹 0~1）；两钮同高时标注不许叠
    expect(SRC_TEXT, '钮心换算没了 —— 标注位置不再跟着钮走，引线就指不到钮上').toContain(
      'return VESSEL_RAIL_HEIGHT * (1 - ratio)',
    )
    expect(SRC_TEXT, '量的夹取（越界值不许把标注带出柱外）').toContain(
      'const ratio = Math.max(0, Math.min(1, level / maxLevel))',
    )
    expect(
      SRC_TEXT,
      '两个标注的下限间距没了 —— 两个钮叠在一起时（起止等值）标注会互相压字',
    ).toContain('if (Math.abs(start - end) < VESSEL_CALLOUT_GAP)')
    expect(SRC_TEXT, '标注 top 的注入').toContain('top: `${vesselCalloutTops.value[0]}px`')
    expect(SRC_TEXT).toContain('top: `${vesselCalloutTops.value[1]}px`')

    // 墨色：起始 = 起始墨常量、终止 = 液面线色 —— 与钮环、图例三处同源
    expect(SRC_TEXT, '起始引线的墨色脱钩了').toContain(
      'start: leader(vesselStartLevel.value, startTop, VESSEL_START_INK)',
    )
    expect(SRC_TEXT, '终止引线的墨色脱钩了').toContain(
      'end: leader(vesselEndLevel.value, endTop, vesselGeometry.value.liquid.line)',
    )
    expect(SRC_TEXT, '标注内的墨（数字下划线用）没注入').toContain(
      "'--v-callout-ink': VESSEL_START_INK",
    )
    expect(SRC_TEXT).toContain("'--v-callout-ink': vesselGeometry.value.liquid.line")

    // 标注不带过渡：钮与液面都是瞬移，标注自己滑会跟钮错开
    expect(SRC_TEXT, '标注加了过渡 —— 钮瞬移、标注缓动，引线圆点就对不上钮了').toMatch(
      /\.vessel-level-callout \{[\s\S]{0,200}?transform: translateY\(-50%\)/,
    )
    expect(SRC_TEXT.split('left: 76px').length - 1, '标注栏左缘与脚本常量脱钩了').toBe(1)
  })

  it('两钮映射：轨道收 [低, 高] 一对，startIsLower 负责映射回起始/终止，方向快照先于写入', () => {
    expect(SRC_TEXT, 'startIsLower 的判据（等值算「起始在下」）').toContain(
      'const startIsLower = computed(() => vesselStartLevel.value <= vesselEndLevel.value)',
    )
    expect(SRC_TEXT, '升序对（起始更低 —— 常规消耗态）').toContain(
      '[vesselStartLevel.value, vesselEndLevel.value]',
    )
    expect(SRC_TEXT, '升序对（起始更高 —— 倒挂/增加态）').toContain(
      '[vesselEndLevel.value, vesselStartLevel.value]',
    )
    expect(SRC_TEXT, '两钮 aria 名的映射').toContain(
      "startIsLower.value ? ['起始液位滑块', '终止液位滑块'] : ['终止液位滑块', '起始液位滑块']",
    )

    expect(SRC_TEXT, '映射函数的签名（收的是解构出来的一对）').toContain(
      'function setVesselLevelPair([lower, upper])',
    )
    const at = SRC_TEXT.indexOf('function setVesselLevelPair')
    const body = SRC_TEXT.slice(at, SRC_TEXT.indexOf('\n}', at))
    const snapshot = body.indexOf('if (startIsLower.value)')
    expect(snapshot, '方向快照没了').toBeGreaterThan(-1)
    expect(
      snapshot,
      '方向快照必须在第一次 setVesselLevelImmediate 之前取定 —— 写第一个 ref 之后 startIsLower 就翻了，' +
        '中途重判会把两钮的值对调（真实回归：拖起来两钮互换）。',
    ).toBeLessThan(body.indexOf('setVesselLevelImmediate('))
    for (const call of [
      "setVesselLevelImmediate('start', lower)",
      "setVesselLevelImmediate('end', upper)",
      "setVesselLevelImmediate('end', lower)",
      "setVesselLevelImmediate('start', upper)",
    ]) {
      expect(body, `缺了映射分支：${call}`).toContain(call)
    }
    expect(
      body,
      '拖动路径（经映射函数）不得缓动 —— 缓动是键入/切罐型这类「变化事件」的表演，拖动要的是即时；' +
        '两条路径混了，滑块就没法用来扫值。',
    ).not.toContain('animateVesselTo')

    // 045 的两条路径分工原样保留：拖动直写（清补间 + 直写显示值）
    const atImm = SRC_TEXT.indexOf('function setVesselLevelImmediate')
    expect(atImm, 'setVesselLevelImmediate 不见了 —— 拖动路径的入口').toBeGreaterThan(-1)
    const immBody = SRC_TEXT.slice(atImm, SRC_TEXT.indexOf('\n}', atImm))
    expect(
      immBody,
      '补间没清 —— 拖动时 watcher 里现存的缓动会把液面接着往下拖，跟手感就没了',
    ).toContain('vesselTransitions[which] = null')
    expect(immBody, '显示值没直写 —— 液面不会当帧就位').toContain(
      'levelDisplayRef(which).value = clamped',
    )
    // 键入路径原样：两个 watcher 仍过 clampAndAnimateLevel（这条不许被「统一」掉）
    expect(SRC_TEXT).toContain(
      "watch(vesselStartLevel, (value) => clampAndAnimateLevel('start', value))",
    )
    expect(SRC_TEXT).toContain(
      "watch(vesselEndLevel, (value) => clampAndAnimateLevel('end', value))",
    )
    expect(SRC_TEXT, '工具提示的格式（整数 + mm）变了').toContain(
      'const formatVesselLevelTooltip = (value) => `${Math.round(value)} mm`',
    )
  })

  it('颜色语义三层：钮环 = 读数色、色带 = 消耗/增加，与画布共用同一对常量（裸字面量只许一处）', () => {
    expect(SRC_TEXT, '起始墨色的常量没了').toContain("const VESSEL_START_INK = '#1e293b'")
    expect(
      tailwindColors.slate[800].toLowerCase(),
      '起始墨色与 slate-800 脱钩了 —— 图例虚线是 border-slate-800，两处必须同一只墨',
    ).toBe('#1e293b')
    expect(SRC_TEXT, '差值一对墨的常量没了').toContain(
      "const VESSEL_DELTA_COLOR = { consume: '#e11d48', increase: '#059669' }",
    )

    // 裸字面量只许出现在常量定义那一处：画布剖面线 + 画布引线标注 + 滑块钮间色带三处共用常量
    for (const ink of ['#e11d48', '#059669']) {
      expect(
        SRC_TEXT.split(`'${ink}'`).length - 1,
        `${ink} 有裸引用 —— 画布与滑块必须共用 VESSEL_DELTA_COLOR（一处改、三处看）`,
      ).toBe(1)
    }
    expect(
      SRC_TEXT.split('VESSEL_DELTA_COLOR.consume').length - 1,
      '常量的消耗色用点不是 3 处（画布剖面线 + 画布引线标注 + 滑块钮间色带）',
    ).toBe(3)
    expect(
      SRC_TEXT.split('VESSEL_DELTA_COLOR.increase').length - 1,
      '常量的增加色用点不是 3 处（画布剖面线 + 画布引线标注 + 滑块钮间色带）',
    ).toBe(3)

    expect(SRC_TEXT, '钮间色带的语义映射没了（判据须与画布引线标注同源：>= 0 增加）').toContain(
      'vesselVolumeDelta.value >= 0 ? VESSEL_DELTA_COLOR.increase : VESSEL_DELTA_COLOR.consume',
    )
    expect(SRC_TEXT, '下钮环色必须绑 startIsLower（倒挂时低位读数换成终止的液面线色）').toContain(
      "'--v-thumb-lower': startIsLower.value ? VESSEL_START_INK : vesselGeometry.value.liquid.line",
    )
    expect(SRC_TEXT, '上钮环色是下钮的镜像').toContain(
      "'--v-thumb-upper': startIsLower.value ? vesselGeometry.value.liquid.line : VESSEL_START_INK",
    )
  })

  it('竖轨的软拟态配方：凹槽、盖掉 EP 竖版方角、钮座对中量校正、分钮环色走 border', () => {
    expect(SRC_TEXT).toContain('.vessel-level-slider :deep(.el-slider__runway)')
    expect(
      SRC_TEXT,
      '轨道的凹槽光影没了 —— 只剩一条浅灰槽，「实心钮推着凹槽走」的凹凸关系就不成立',
    ).toContain('inset 2px 2px 5px rgba(90, 110, 150, 0.32)')
    expect(
      SRC_TEXT,
      '钮座对中量没校正 —— EP 出厂按（6−36）/2 = −15px 写死，我们的轨厚 10 / 钮座 30 需要' +
        '（10−30）/2 = −10px，写错则钮在轨道上偏心 5px',
    ).toContain('--el-slider-button-wrapper-offset: -10px')
    expect(
      SRC_TEXT,
      '竖版 bar 没盖掉 EP `.is-vertical` 的 `0 0 3px 3px` 方角 —— 凹槽会缺一个圆头',
    ).toMatch(
      /\.vessel-level-slider :deep\(\.el-slider__bar\)\s*\{[\s\S]{0,120}border-radius: 9999px/,
    )
    expect(SRC_TEXT, '圆钮的浮面渐变没了 —— 与全站软拟态按钮的配方脱钩').toContain(
      'linear-gradient(145deg, #fbfbfd, #eaebee)',
    )
    expect(
      SRC_TEXT,
      '钮环没走 border（transparent 基底 + 分钮着色；box-sizing: border-box，几何与 045 一致）',
    ).toContain('border: 2px solid transparent')
    expect(SRC_TEXT, '下钮环（nth-child(2) = 低位钮）没接 --v-thumb-lower').toMatch(
      /nth-child\(2\)[\s\S]{0,80}--v-thumb-lower/,
    )
    expect(SRC_TEXT, '上钮环（nth-child(3) = 高位钮）没接 --v-thumb-upper').toMatch(
      /nth-child\(3\)[\s\S]{0,80}--v-thumb-upper/,
    )
    expect(SRC_TEXT, '钮/轨道没禁 CSS 过渡 —— 钮会自己滑过去而液面是瞬移，肉眼可见地错位').toMatch(
      /\.vessel-level-slider :deep\(\.el-slider__bar\)[\s\S]{0,120}transition: none/,
    )
    expect(SRC_TEXT, '滑块的键盘聚焦环（石墨深）没了 —— EP 默认环被覆写后必须显式补').toContain(
      'outline: 2px solid #171719',
    )
  })

  it('步进圆钮（−/+）继续退役：vessel-step 家族全仓零残留；数字输入框原样保留', () => {
    // 全 src 过 stripComments 后扫：注释里提旧名字（解释为什么删）不红，真代码回流才红
    const LEFTOVER = /vessel-step|stepVesselLevel|startStepHold|stopStepHold/
    const hits = SOURCE_FILES.filter((f) => LEFTOVER.test(stripComments(read(f)))).map(rel)
    expect(
      hits,
      'vessel-step 家族回流了 —— 步进圆钮已整体退役（变更-045），滑块 + 输入框并存就是全部控件；' +
        '旧的样式块/处理函数（含长按连发的定时器那套）一律不许粘回来',
    ).toEqual([])

    expect(
      SRC_TEXT.split('class="vessel-level-input min-w-0 text-right"').length - 1,
      '数字输入框不是两个都在 —— 非整十的实测读数（865 / 1525）要能直接键入，' +
        '这是有意保留、不是漏删（048 撤的是外框，不是「录值」这条路）',
    ).toBe(2)
    // 048：数字框不再画框 —— 静止态是「带下划线的数字」，下划线墨相分起止
    expect(SRC_TEXT, '数字框的软拟态外框回流了 —— 048 起静止态只有下划线').not.toContain(
      'border-radius: 12px',
    )
    expect(SRC_TEXT, '下划线没接 --v-callout-ink（读数墨）').toContain(
      'border-bottom: 1px dashed var(--v-callout-ink)',
    )
    expect(SRC_TEXT, '终止的下划线没改成实线（与图上那根实线液面同相）').toContain(
      '.vessel-level-callout-end .vessel-level-input',
    )
  })
})
