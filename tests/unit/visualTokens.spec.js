import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATUS_TONE, STATUS_ICON_TONE, STATUS_TEXT } from '../../src/constants/statusTones'
import tailwindConfig from '../../tailwind.config.js'
// 走 `tailwindcss/colors.js` 而不是 `tailwindcss/colors`：后者在 Node 的原生解析下
// 找不到（这个版本的包没有 exports 映射），本文件要能在 vitest 里直接跑。
import tailwindColors from 'tailwindcss/colors.js'

/**
 * 视觉回归护栏 —— x-minimalist 版（暖白纸 + 墨色主色 + 发丝线）。
 *
 * 这里只钉两类东西：**已经做过全仓扫描才定下来的类名**，和**靠人眼看不出来的
 * 对比度**。两者都会在有人把旧代码块粘进新页签时静默回归 —— 今天看起来对，
 * 明天多一个面板就退回去了。
 *
 * 变更-050（x-minimalist）把整套**材质**从「中性清水玻璃」换成「编辑式文档感」：
 * 暖骨桌面（desk #F4F3EF）→ 纯白纸（canvas #FFFFFF + `.minimal-field` 的一道
 * 暖径向）→ 不透明的白面 / 侧栏面（raised / veil）+ 1px 发丝线（line #EAEAEA）
 * + 墨色主色（brand #111111）。036~043 那两档液态玻璃整组退役：
 * `src/glass-effects.css` 与 `src/linear-theme.css` 都已删除，材质规则搬进
 * `src/minimal-field.css`。三条读法，读之前先看：
 *
 *   ① **数值全部由本文件自己的 luminance/contrast/composite 复算。**
 *      文件里引用到的每一个比值（1.11 / 1.08 / 1.07 / 18.88 / 4.40 …）在断言里
 *      都找得到对应的实算 —— 注释抄错了、取值被改了，先红的会是断言，不是屏幕。
 *   ② **三块面板是逐 token 锚定的**（侧栏 veil / 导航条与主区栏 raised），
 *      而且都靠 `border-line` 分层。039~043 之间出过 "只调一块" 的回归，
 *      就是在这条上冒出来的。
 *   ③ **纸的配方从 minimal-field.css 里解析出来用**：底色必须逐位等于
 *      colors.canvas，径向的 α 有硬上限（≤ 0.04）。这是 spec 与 CSS 之间唯一的
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
/*
 * 读源码时**统一把 CRLF 折成 LF**。
 *
 * 本仓 `core.autocrlf=true`（提交进库的是 LF，检出到工作区的是 CRLF），于是同一个
 * 文件在不同机器上的**行尾**是不一样的：本文件里有几条断言是拿多行正则钉
 * markup 形状的（§18 的 `/\n\s*vertical\n/` 那类），行尾一旦是 CRLF 就整条不匹配
 * —— 而失败信息看上去像"滑块没竖过来"，与真实原因（这台机器检出成了 CRLF）毫无关系。
 * 变更-053 之后就撞上过这一次。
 *
 * 折叠只去 `\r`：**行号一个都不变**（`\r\n` 与 `\n` 的行数、每个 `\n` 的位置相同），
 * 所以 `scan` 报出来的 `路径:行号` 仍然可以直接跳过去。
 * 这不是放宽任何判据 —— 被断言的字符一个没少，只是不再把"这台机器的行尾"当成契约。
 */
const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

/**
 * 取包含某段标记的那个标签（从它前面的最后一个 `<` 到它后面的第一个 `>`）。
 *
 * 用来做**标签级**的接线断言：原先写 `not.toContain('@input="applyStockFilter"')`，
 * 换个函数名（`onKeywordInput` / `search`）就拦不住了（变更-066）。
 * 现在断言的是"这个输入框的标签里不许出现 @input"，与实际函数名无关。
 */
const inputTagWith = (src, marker) => {
  const at = src.indexOf(marker)
  if (at < 0) return ''
  const start = src.lastIndexOf('<', at)
  const end = src.indexOf('>', at)
  return start < 0 || end < 0 ? '' : src.slice(start, end + 1)
}
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
 * 纸的配方从 CSS 里**解析**（不抄）：α 一改，§10 的硬上限与下游所有「压在纸上
 * 的字与面」的账全部跟着变，不会有一组还守着旧值。解析失败时 fieldBlock 为空
 * → §10 那条锚点测试先红，别处不会拿 NaN 硬算。
 *
 * （043 时代这里是 `.glass-field` 的「三段渐变 + 两团光斑」，从已删除的
 *   glass-effects.css 里读。x-minimalist 只剩 `.minimal-field` 的一道暖径向。）
 */
const FIELD_CSS = read(join(SRC, 'minimal-field.css'))
const fieldBlock = (FIELD_CSS.match(/\.minimal-field\s*\{([\s\S]*?)\}/) || ['', ''])[1]
/**
 * 径向的两个停点：主色（有 α）与**同色 0 α** 收尾。形状照旧留着（hex + alpha），
 * 但语义从「光斑」换成「一道径向的两端」。
 */
const FIELD_BLOBS = [...fieldBlock.matchAll(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/g)].map(
  (m) => ({
    hex: '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join(''),
    alpha: Number(m[4]),
  }),
)
const FIELD_ALPHAS = FIELD_BLOBS.map((b) => b.alpha)
/** 每团弥散的 α —— **硬上限 0.18**（密集后台；详见 minimal-field.css 头注） */
const FIELD_ALPHA = FIELD_ALPHAS.length ? Math.max(...FIELD_ALPHAS) : NaN
/**
 * 有 α 的那半（= 团的颜色）。
 *
 * 2026-10-23（变更-169）：纸从「一道暖径向」改成「三团弥散」，
 * 原来的单一 FIELD_TINT（暖褐）换成集合 FIELD_TINTS；
 * FIELD_TINT 保留指向第一团，别的引用点不必跟着改。
 */
const FIELD_TINTS = FIELD_BLOBS.filter((b) => b.alpha > 0).map((b) => b.hex)

/** 弥散底允许的三色（使用方 2026-10-23 指定：#BBADE6 / #FEC96D / #E2ADB4） */
const FIELD_ALLOWED_TINTS = ['#bbade6', '#fec96d', '#e2adb4']

/**
 * 「面」的**代表底色** —— 纸、侧栏面、白面。
 *
 * 043 时代这里是「纸 → 玻璃（半透明 + blur）叠出来的最坏底色」，配方从 CSS 解析。
 * x-minimalist 之后**半透明面整组退役**：三块面板与所有卡片都是不透明的实底，
 * 文字压在什么颜色上、看到的就是那个颜色 —— 不再需要 composite，底色的来源回归
 * token 本身（tokenHex 现读 tailwind.config.js）。
 *
 * 形状保持不变（`[名字, 颜色]` 数组），§11~§13 的花括号循环照旧能用：
 *   · 纸          —— 单一代表点 #FFFFFF（= colors.canvas）
 *   · 侧栏面      —— colors.veil   #F7F6F3
 *   · 面板/卡片面 —— colors.raised #FFFFFF（与纸同值：这一代分层靠发丝线，不靠色差）
 * 名字仍是「纸」：下游循环按名字取点，改名会断。
 */
const underlayList = tokenHex('canvas') ? [['纸', tokenHex('canvas')]] : []
/**
 * 分离比判定用的代表点。不透明面没有「角落尖峰」要排除（那个概念随渐变一起消失），
 * 这里保留数组形状，让 §11 / §12 的同一个循环继续可用。
 */
const gradientPoints = underlayList

/*
 * 工作台源码的**合集**（2026-10 路由化改造）。
 *
 * 改造前这里只读一个文件：`views/WorkOrderList.vue`（4115 行的单文件巨石）。
 * 那个文件已被拆成「壳 + 14 个路由页 + 两份容器 composable」，于是下面那些
 * 「在工作台源码里找某段 markup / 某串类名 / 某处 scoped CSS」的断言没了唯一入口。
 *
 * ⚠️ 不是放宽判据：**字符一个没少**，只是把范围从「一个文件」换成「同一批文件」。
 * 顺序有意义 —— 复合体放在前面，靠 `indexOf` / `lastIndexOf` 就近取节点的几处
 * 锚点（侧栏 / 导航条 / 纸 / 主区列）才仍然落在壳里。
 */
const WORKBENCH_FILES = [
  'layouts/AppShell.vue',
  'nav/index.js',
  'views/orders/WorkOrderList.vue',
  'views/orders/PickingList.vue',
  'views/orders/InboundList.vue',
  'views/orders/CostingView.vue',
  'views/materials/StockView.vue',
  'views/purchase/PurchaseView.vue',
  'views/equipment/EquipmentView.vue',
  'views/equipment/VesselView.vue',
  'views/equipment/ElectricityView.vue',
  'views/stats/WeeklyView.vue',
  'views/stats/DailyView.vue',
  'views/stats/TankLevelView.vue',
  'views/maintain/ImportView.vue',
  'views/maintain/ImageParseView.vue',
  // 体积计算那一段的脚本搬到了这两个 composable（模板与样式仍在 VesselView.vue）
  'composables/useVesselModel.js',
  'composables/useVesselCanvas.js',
]

const WORKBENCH = WORKBENCH_FILES.map((file) => read(join(SRC, file))).join('\n')
const tokensOf = (classAttr) => classAttr.trim().split(/\s+/).filter(Boolean)

// 侧栏面板：`id="app-sidebar"` 就在它 class 属性的上一行
const SIDEBAR = tokensOf(
  (WORKBENCH.slice(WORKBENCH.indexOf('id="app-sidebar"')).match(/class="([^"]*)"/) || ['', ''])[1],
)
// 导航条：页标题 <h2> 往前数第二个 class 属性 —— 第一个是 h2 自己的，再往前就是它
//（路由化之后标题读 `pageTitle`：当前页由 route 决定，不再是 activeTab）
const h2At = WORKBENCH.indexOf('{{ pageTitle }}')
const navClassAt = WORKBENCH.lastIndexOf('class="', WORKBENCH.lastIndexOf('class="', h2At) - 1)
const NAV = tokensOf(WORKBENCH.slice(navClassAt + 7, WORKBENCH.indexOf('"', navClassAt + 7)))
// 主区栏：唯一同时带 `min-h-0` 与 `bg-raised` 的那个 class 属性（走 class 属性、
// 不走行文本 —— 主区那段注释里也写着 min-h-0，按行扫会把它算进来）。
// 043 的锚点是 `backdrop-blur-[30px]`（主区与导航条同料的那笔模糊）；
// x-minimalist 换成「同料的新标记」：`bg-raised`（白面）+ `min-h-0`。
const MAIN = tokensOf(
  [...WORKBENCH.matchAll(/:?class="([^"]*)"/g)]
    .map((m) => m[1])
    .find((c) => c.includes('min-h-0') && c.includes('bg-raised')) || '',
)

const fillOf = (tokens, kind) => tokens.find((t) => new RegExp(`^bg-${kind}/\\d{1,3}$`).test(t))
const alphaOf = (fill) => (fill ? Number(fill.split('/')[1]) / 100 : null)
const stickyTopOf = (tokens) => tokens.find((t) => /^top-/.test(t))

const VEIL_HEX = tokenHex('veil')
/** 侧栏面实际看到的颜色 —— **不透明**，直接就是 token 值（不再与纸复合 α） */
const VEIL_SHOWN =
  VEIL_HEX && underlayList.length ? underlayList.map(([name]) => [name, VEIL_HEX]) : []
/** 白面（导航条 / 主区栏 / 卡片）实际看到的颜色 —— 同上 */
const RAISED_HEX = tokenHex('raised')
const FROST_SHOWN =
  RAISED_HEX && underlayList.length ? underlayList.map(([name]) => [name, RAISED_HEX]) : []
/**
 * 卡片实压色 —— 与白面**同值**（这一代卡与它所在的面同色，分层交给 1px 发丝线）。
 * 它仍是内联状态文字、弱化文字的基线：§2 的 STATUS_TEXT 与 §11 的卡内文字账
 * 都压在这上面算。名字保留（043 时代它是「白斑处的 raised/95」）。
 */
const CARD_SHOWN = FROST_SHOWN.map(([name, raised]) => [name, raised])
const CARD_WORST = CARD_SHOWN.length ? CARD_SHOWN[0][1] : null

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
// 0.5 工作台源码合集本身（路由化改造后所有「就地取节点」的锚点都落在这批文件里）
// ---------------------------------------------------------------------------

describe('工作台源码合集：文件齐、壳在最前', () => {
  it('WORKBENCH_FILES 里列的文件都存在', () => {
    const missing = WORKBENCH_FILES.filter((file) => !existsSync(join(SRC, file)))
    expect(
      missing,
      '这些工作台文件不见了 —— 页面被移动/改名之后，本文件的 WORKBENCH_FILES 要同步：' +
        '漏一个不会报错，只会让「某段 markup 不存在」的断言莫名其妙地失败。',
    ).toEqual([])
  })

  it('壳排在最前：侧栏 / 导航条 / 纸 / 主区列那几处就近取值才落在壳里', () => {
    expect(WORKBENCH_FILES[0]).toBe('layouts/AppShell.vue')
    // 上面几个锚点全部依赖「壳在最前」这一条，这里把三处一起钉住
    expect(SIDEBAR.length).toBeGreaterThan(0)
    expect(NAV.length).toBeGreaterThan(0)
    expect(MAIN.length).toBeGreaterThan(0)
  })
})

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
     * 这几行内联状态文字是压在**卡片**上的，所以基线取 **CARD_WORST** ——
     * 拿一个屏幕上不存在的底色去验，全绿但与屏幕无关。
     *
     * 这条基线随材质联动。043 时它是「白斑处的 raised/95 压在 55% 白玻璃上」推出来
     * 的最坏值（浅场 + 55% 白玻璃把霜面推到 ~#fbfbfc，再叠 95% 白卡四舍五入就是
     * 纯白）；**x-minimalist 之后卡片是不透明的 `bg-raised`，#FFFFFF 本身就是那个
     * 值** —— 基线不再"实压"于任何东西，与 token raised 同值是这一代的分层方式
     * （色差让位给发丝线，见 tailwind.config 的 raised 段）决定的结果，不是巧合。
     * 实算：rose-600 4.70 / emerald-700 5.48 / amber-700 5.02，全过，rose 余量最小。
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
     * 下面三行锚在**卡片实压底色**上（= 不透明的 `bg-raised` #FFFFFF）。
     * 041 的雾白把三行从白底一列拉低了 0.04（4.70→4.66）；043 的清水玻璃又推回来；
     * x-minimalist 的卡片直接就是纯白 —— 三行仍在白底那一列，
     * statusTones.js 的注释同步写得也是这一列。
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
  const onBrand = tokenHex('on-brand')

  /*
   * 2026-10-18 换太阳橙 #F59E0B 之后，这一组的结论**翻面**了：
   * 白字压亮橙只有 2.15:1 —— 不是「余量小」，是物理上不可能过 AA。
   * 所以这一代钉的不再是「白字够不够」，而是「橙底必须配深墨」：
   *   on-brand(#1C1917) 压 brand     = 8.14
   *   on-brand 压 brand-deep（hover） = 5.9 上下，仍过
   * 另一半也钉住：brand 与白字的比值**必须小于 4.5** —— 否则说明有人把橙
   * 调回了「能吃白字」的深红棕，太阳橙就没保住。
   */
  it('橙底配深墨过 AA（on-brand 8.14）—— 亮橙上白字物理上过不了', () => {
    expect(brand, 'tailwind.config.js 里没有 colors.brand').toBeTruthy()
    expect(onBrand, 'tailwind.config.js 里没有 colors.on-brand').toBeTruthy()
    expect(contrast(onBrand, brand)).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(HEX.white, brand),
      'brand 又能吃白字了？说明它被调回了深红棕 —— 太阳橙这一关是「白字必须不够」',
    ).toBeLessThan(4.5)
  })

  it('hover 填充走**更亮**一档（brand-hover），深墨压它仍过', () => {
    /*
     * 亮橙这类高明度主色不能靠「加深」做 hover：EP 的 dark-2 = 主色×0.8 算出来
     * #B36200，已经暗到深墨压它只剩 3.88（2026-10-18 实测）—— hover 那一瞬间
     * 按钮上的字就欠对比度了。所以 hover 改往**亮**走：brand-hover #E38B1A，6.4:1。
     * brand-deep 仍然保留，只是它的职责只剩「必须与 EP dark-2 同值」那条同源交叉。
     */
    const hover = tokenHex('brand-hover')
    expect(hover, 'tailwind.config.js 里没有 colors.brand-hover').toBeTruthy()
    expect(contrast(onBrand, hover)).toBeGreaterThanOrEqual(4.5)
    expect(
      WORKBENCH.includes('hover:bg-brand-hover'),
      '按钮 hover 又改回 bg-brand-deep 了？那会把 hover 态的文字拖到 3.88',
    ).toBe(true)
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

  it('浅底上的品牌文字用 brand-ink：压 brand-50 / brand-100 都过', () => {
    /*
     * 太阳橙时代（2026-10-18）分了两档：
     *   brand-deep #C47E09 = hover **填充**（= EP dark-2，同源交叉那条要它）；
     *   brand-ink  #92400E = 浅底上的**文字 / 焦点环**（压白底 7.09）。
     * 拿 brand-deep 当文字只有 3.07 / 2.63 —— 正是这条用例抓出来的。
     */
    const ink = tokenHex('brand-ink')
    const b50 = tokenHex('brand-50')
    const b100 = tokenHex('brand-100')
    expect(ink, 'tailwind.config.js 里没有 colors.brand-ink').toBeTruthy()
    expect(b50, 'tailwind.config.js 里没有 colors.brand-50').toBeTruthy()
    expect(b100, 'tailwind.config.js 里没有 colors.brand-100').toBeTruthy()
    expect(contrast(ink, b50)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(ink, b100)).toBeGreaterThanOrEqual(4.5)
  })

  it('brand-200 上的文字账：brand-ink 压它仍过 —— 旧「禁文字」规则退役', () => {
    /*
     * 041 的 brand-200（#B3D4F7 蓝浅档）上不许垫 brand-deep 文字：4.36 破 AA。
     * 043 的三档是 EP 石墨派生（light-7 #BBBBBC 系），brand-deep 压它实算 9.33 ——
     * 同一条禁令的前提（「最深浅档压得住深字」）反过来成立了，于是删掉那条
     * 「bg-brand-200 与 text-brand-deep 不许同行」的扫描：浅底三档现在都能
     * 托住 brand-deep 文字。
     */
    const b200 = tokenHex('brand-200')
    expect(b200, 'tailwind.config.js 里没有 colors.brand-200').toBeTruthy()
    expect(contrast(tokenHex('brand-ink'), b200)).toBeGreaterThanOrEqual(4.5)
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
    const ALLOWED = [
      'src/theme.css',
      'src/glass-effects.css',
      // 体积计算页的 scoped 块（聚焦环 / 底 —— CSS 里够不着 Tailwind 类）。
      // 路由化之前这些字面量在工作台的唯一那个 .vue 里，现在跟着模板搬到了这一页。
      'src/views/equipment/VesselView.vue',
    ]
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
    { ring: 'focus-visible:ring-brand-ink', why: '7.09（压白底；亮橙 ring-brand 只有 2.15，够不到 3:1）' },
    { ring: 'focus:ring-brand-ink', why: '7.09（表内可编辑格，环画在卡面上）' },
    { ring: 'focus-visible:ring-rose-600', why: '4.70（清除筛选 / 清空），rose 是它的语义色' },
    { ring: 'focus:ring-slate-500', why: '4.76（实心主按钮，环画在 ring-offset 之外的白底上）' },
    {
      ring: 'focus-visible:ring-brand-ink/35',
      soft: true,
      why:
        '软环（inset，35% 品牌墨）：表内输入框真正的指示者是同行的 focus:border-brand；' +
        '这条环只是让「键盘焦点落在哪个格子」在 1px 边框之外也看得见（2026-10-18 补）',
    },
    {
      ring: 'focus:ring-brand-100',
      soft: true,
      why: '软晕，不承载指示：这些输入框真正的指示者是同一行的 focus:border-brand（16.83）',
    },
  ]

  const RING_RE = /\bfocus(-visible)?:ring-(?!offset|inset)([a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/\d{1,3})?)\b/g

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
// 10. 纸：纯白 + 一道 α≤0.04 的暖径向 + 发丝线（x-minimalist）
// ---------------------------------------------------------------------------

describe('纸（x-minimalist）：纯白面 + 一道 α≤0.04 的暖径向 + 发丝线', () => {
  /*
   * 这一组的来路要连着 037 讲，不然读不出为什么管得这么宽。
   *
   * 使用方 2026-10-07 的原话是「做一个底框，暖白纸，整个项目看上去就是运行在这张
   * 卡片上」——「纸」这个概念就是那轮立起来的，它的**观感**（有一张纸，东西都在
   * 纸上）比它的**颜色**长寿：037 暖白 → 041 天穹蓝 → 043 浅中性柔光场 →
   * x-minimalist 纯白。换的永远是纸的颜色，不是「有没有纸」。
   *
   * 036~043 那几轮玻璃为什么在 minimalist 这里整组退场：minimalist 把
   * `gradient blobs` 与 `glassmorphism beyond a subtle nav blur` 写进反模式清单
   * ——「一张几乎纯色的纸上，模糊无物可糊」这条 036 的老结论，在这一代不再是缺陷，
   * 而是设计意图。纸因此只剩两笔：
   *   · 一道 α=0.035 的**暖**径向（rgb(120 100 60)，左上）—— 平不等于空
   *     （minimalist: "Minimalism is not emptiness"），让一大片白"是纸"而不是
   *     "没画完"；α 是硬上限，下面实算钉着 ≤ 0.04；
   *   · 底色 #FFFFFF，逐位等于 colors.canvas（圆角外沿靠它兜底）。
   * 分层全部交给 1px 发丝线 `border-line`（#EAEAEA）—— 不再有阴影、不再有玻璃。
   *
   * 判据沿用 037 的「纸是页内元素，不是页面底色」：
   *   · 页面根（min-h-screen）一律 bg-desk（暖骨桌面那圈外框）；
   *   · bg-canvas 只许出现在带圆角的纸上，且必配 .minimal-field；
   *   · 四页口径不变（工作台 / 登录 / 404 是纸，Intro 是**白纸例外**，
   *     长页正文的底色必须浅，spec 白名单表达）。
   */
  it('.minimal-field 配方解析出来了 —— 锚点断了先在这里红', () => {
    // 下面几组（文字安全、白面卡片）都拿解析出来的纸色当面色的底算账。
    // 与其让它们报出莫名其妙的 NaN 失败，不如在这里说清楚是解析断了。
    expect(fieldBlock, '没从 minimal-field.css 里解析到 .minimal-field 的样式块').toBeTruthy()
    // 每团都是「主色 α + 同色 0 α」两停 ⇒ 总数必须偶数；团数 = 有 α 的那一半
    expect(FIELD_BLOBS.length % 2, '每组径向必须「主色 + 同色 0 α」成对出现').toBe(0)
    expect(FIELD_TINTS.length, '至少要有一团弥散').toBeGreaterThanOrEqual(1)
    expect(Number.isFinite(FIELD_ALPHA), '没解析出径向主色的 α').toBe(true)
    expect(underlayList, '纸的代表底色没建起来（colors.canvas 断了？）').toHaveLength(1)
  })

  it('配方本身：radial-gradient、底色逐位等于 colors.canvas、每团 α ≤ 0.18、三色白名单、没有 linear-gradient 与 transparent', () => {
    expect(fieldBlock, '没解析到 .minimal-field 的样式块').toBeTruthy()
    // 纸只剩**一道径向**：036~043 的三段线性渐变 + 斜光带是「给玻璃吸的」，随玻璃退役
    expect(
      fieldBlock,
      '.minimal-field 里没有 radial-gradient —— 纸又变成一块纯色板了',
    ).toMatch(/radial-gradient\(/)
    expect(
      fieldBlock,
      '出现了 linear-gradient —— 那是「给玻璃吸的」那套配方（三段渐变 + 斜带）',
    ).not.toMatch(/linear-gradient/)
    // 收尾停点用**同色 0 α**，不用 transparent 关键字（防某个实现按非预乘插值中途发灰）
    expect(fieldBlock, '不许用 transparent 关键字收尾').not.toMatch(/transparent/)
    expect(
      fieldBlock,
      '没有 background-repeat: no-repeat —— 径向会平铺成四块色斑',
    ).toMatch(/background-repeat:\s*no-repeat/)

    // 底色 = colors.canvas（同一值，两处一起改）：纸的四角是圆的，径向之外的
    // 兜底色就是 bg-canvas —— 两处有色差，圆角外沿会露出一圈「补丁」。
    const canvas = tokenHex('canvas')
    expect(canvas, 'tailwind.config.js 里没有 colors.canvas').toBeTruthy()
    expect(
      fieldBlock,
      `底色不是 colors.canvas（${canvas}）—— 圆角外沿会露出一圈补丁`,
    ).toMatch(new RegExp(`background-color:\\s*${canvas}\\b`, 'i'))

    // α 是**硬上限**：0.035 落在 0.04 以内（minimal-field.css 头注里记的账）。
    // 再亮的后果有两条，都能实算：① 宽表里会看出色斑；② 白卡与纸的分离比
    // （§11 那条）全靠 1px 发丝线，径向一浓就把那条线淹掉。
    expect(FIELD_ALPHA).toBeGreaterThan(0)
    expect(
      FIELD_ALPHA,
      `弥散团 α=${FIELD_ALPHA} 超过 0.18 —— 宽表里会看出色斑，发丝线也会被淹`,
    ).toBeLessThanOrEqual(0.18)
    expect(
      FIELD_ALPHAS.filter((a) => a === 0),
      '径向的收尾停点必须是**同色 0 α**（另一条 rgb(… / 0)）',
    ).toHaveLength(FIELD_TINTS.length)
  })

  it('弥散只用指定的三色（#BBADE6 / #FEC96D / #E2ADB4）—— 换别的颜色就红', () => {
    /*
     * 043 那代这条是「三通道极差 ≤ 6 的中性度」——「不要蓝色」的字面落点。
     * minimalist 换了问题：这一道径向**故意是暖的**（暖褐 rgb(120 100 60)），
     * 中性度那条判据的前提随之消失（直接搬过来会红，而且红得没道理）。
     *
     * 所以换成一条方向相反、同样可复算的断言：
     *   · 三通道必须**递减** R > G > B（暖色，不是冷色/中性灰）；
     *   · B−R 必须 ≤ −30 —— 免得哪天被"顺手换成中性灰"，纸就从"暖骨"
     *     漂成"冷白"，与 desk #F4F3EF 的暖调对不上（两层一起偏冷，
     *     分离比 1.11 还在、观感却已经不是这一代的东西了）。
     * 实算：rgb(120 100 60) → R−G = 20、G−B = 40、B−R = −60。
     */
    expect(FIELD_TINTS.length, '没解析到弥散团的主色（rgb(r g b / α) 形式）').toBeGreaterThan(0)
    /*
     * 2026-10-23（变更-169）：原来的"暖度"断言（R>G>B 且 B−R ≤ −30）钉的是**单一暖褐**。
     * 现在使用方指定三色（含淡紫 #BBADE6，B 明显大于 R），那条暖度规则**作废**，
     * 换成更贴合意图的白名单：只许这三色，多一个都红 —— 免得哪天被顺手换成中性灰。
     */
    for (const tint of FIELD_TINTS) {
      expect(
        FIELD_ALLOWED_TINTS,
        `弥散用了不在白名单里的颜色 ${tint} —— 只许 ${FIELD_ALLOWED_TINTS.join(' / ')}`,
      ).toContain(tint.toLowerCase())
    }
  })

  it('四个页面根元素一律 bg-desk —— 纸是页内元素，桌面才是底', () => {
    // 判据是 min-h-screen，全站只有四个页面根元素用（工作台 / 登录 / 404 / 落地页）。
    //
    // 两个方向都要钉：
    //   ① 漏了底色 —— 那一页没有底色，页脚外露或回弹时露出浏览器默认白；
    //   ② 写成 bg-canvas —— 纸是**页内**那张，不是页面底色。
    //      「整屏泛灰」和「有一张纸」只差一层嵌套 —— 037 的暖白吃过同一个亏
    //      （使用方原话「不是把背景变成暖白，是添加一个暖白的底层卡片」）。
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (!lineHasToken(line, 'min-h-screen')) return
          const at = `${rel(file)}:${index + 1}`
          if (lineHasToken(line, 'bg-canvas')) offenders.push(`${at} 把纸当成了页面底色`)
          else if (!lineHasToken(line, 'bg-desk')) offenders.push(`${at} 没有底色`)
        })
    }
    expect(
      offenders,
      '页面根元素要用 bg-desk 当底色（暖骨桌面）；纸（bg-canvas）是**页内**那张，不是背景 —— ' +
        '「整屏泛灰」和「有一张纸」只差一层嵌套，别把主意打到根元素上。',
    ).toEqual([])
  })

  it('桌面框与纸分得开、深字压纸过 AA —— 两层各自的账', () => {
    const desk = tokenHex('desk')
    const canvas = tokenHex('canvas')
    expect(desk, 'tailwind.config.js 里没有 colors.desk').toBeTruthy()
    expect(canvas, 'tailwind.config.js 里没有 colors.canvas').toBeTruthy()
    expect(
      contrast(desk, canvas),
      `桌面框压纸只有 ${contrast(desk, canvas).toFixed(3)}:1 —— 16px 外框会与纸糊成一片` +
        '（037 使用方原话：「整屏泛白、看不出有一张纸」）',
    ).toBeGreaterThanOrEqual(1.08)
    expect(
      contrast(HEX['slate-900'], canvas),
      `深字（slate-900）压纸只有 ${contrast(HEX['slate-900'], canvas).toFixed(2)}:1 —— 纸被调深了`,
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('bg-canvas 必配 rounded-card 与 minimal-field；minimal-field 只许画在纸上（双向）', () => {
    /*
     * 有圆角才是「一张纸」—— 上面那层的口子（不带圆角的浅色大块 = 「这块区域
     * 泛灰」）037 就堵过，这里原样保留。另一半：纸的配方（minimal-field）必须与纸
     * 同生共死 —— 画到别的元素上就成了浮在屏幕上的色斑。
     * 反面不成立：rounded-card 在全站有几十处（白卡片/面板），不必也不该都变成纸。
     */
    const offenders = []
    for (const file of SOURCE_FILES) {
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          const tokens = lineClassTokens(line)
          const usesCanvas = tokens.some((t) => t === 'bg-canvas' || t.startsWith('bg-canvas/'))
          const usesField = tokens.includes('minimal-field')
          if (!usesCanvas && !usesField) return
          const at = `${rel(file)}:${index + 1}`
          if (usesCanvas && !usesField) offenders.push(`${at} bg-canvas 没配 minimal-field`)
          if (usesField && !usesCanvas) offenders.push(`${at} minimal-field 没配 bg-canvas`)
          if (usesCanvas && !tokens.some((t) => CARD_RADIUS.test(t))) {
            offenders.push(`${at} bg-canvas 没有卡片圆角`)
          }
        })
    }
    expect(
      offenders,
      'bg-canvas 必须与 rounded-card、minimal-field 同行；minimal-field 只许出现在纸上。' +
        '想要一块没有圆角的底色区域，用 bg-desk（页面根那层）。',
    ).toEqual([])
  })

  it('四个页面每一个里面都有一张纸 —— 三张暖径向白纸 + 落地页白名单', () => {
    /*
     * 037 的口径（使用方：「登录、404、落地页都要加」）不变：四页一致。
     * Intro 的处理不变 —— 它是长页正文，底色必须浅，所以纸是**白**的
     * （`rounded-card border border-line bg-white`），这是**文档化的例外**，
     * 不是漏做；而工作台 / 登录 / 404 三页的纸是 `.minimal-field`
     * （纯白 + 一道暖径向），**落地页禁挂**（长页正文上那层径向只会变成色斑）。
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
          if (lineClassTokens(line).includes('minimal-field')) fielded.add(file)
        })
    }
    expect(
      [...roots].map(rel).sort(),
      '带 min-h-screen 的页面根元素数量变了 —— 新页面也要包一张纸，确认后改这里的 4',
    ).toHaveLength(4)
    expect(
      fielded.has(INTRO),
      'Intro 出现了 minimal-field —— 它是白纸例外，暖径向只给工作台/登录/404',
    ).toBe(false)
    expect(
      [...roots].filter((f) => !fielded.has(f) && f !== INTRO).map(rel),
      '这些页面里没有纸（只认 class 属性，写在注释里不算）。四页都要有纸，别漏',
    ).toEqual([])
    // Intro 的白纸确实在：bg-white、发丝线与卡片圆角在同一处 class 属性里
    const hasWhitePaper = classAttrsOf(read(INTRO)).some(
      ({ tokens }) =>
        tokens.includes('bg-white') &&
        tokens.includes('border-line') &&
        tokens.some((t) => CARD_RADIUS.test(t)),
    )
    expect(
      hasWhitePaper,
      'Intro 里没有那张白纸（rounded-card border border-line bg-white）—— 长页底色不能裸奔',
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 11. 面走 token + 发丝线：抬起来的面全是 bg-raised（x-minimalist）
// ---------------------------------------------------------------------------

describe('面走 token + 发丝线：卡片是 bg-raised + border-line，工作台不再有裸 bg-white', () => {
  /*
   * 使用方 2026-10-11 看 037 的成果时说「很多地方都是白色的，看着很刺眼」——
   * 那轮把抬起来的面全换成了暖白。041 换了底（蓝之上，白是雾）；043 又翻回浅底、
   * 卡片是白玻璃的实心近亲（raised/95）；x-minimalist 又翻回**纯白**，
   * 但**结论不变**：面一律走 token。变的是**分层手段** —— 这一代不用色差，
   * 用 1px 发丝线：白纸上的白卡片靠 `border-line`（#EAEAEA）与间距分开，
   * 对应 minimalist 那条「A border/divider replaces a card whenever elevation
   * isn't communicating hierarchy」。
   *
   * 这一组守三件事：
   *   ① **面一律走 token**：工作台里不许裸写不透明的 bg-white（与 raised 同值
   *      纯属现在巧合；raised 一旦重染，它就是脱队的那个），也不许冷灰垫底
   *      （垫底一律 region）；
   *   ② **卡片配方整串锚定**：每一处卡片都必须 `bg-raised` + `border-line` +
   *      `shadow-card` 三者同串 —— 防「只把一张卡改回实心 / 去掉描边」这种单点回归；
   *   ③ **旧玻璃配方整串禁入**：`bg-raised/95`、`border-white/60`、
   *      `backdrop-blur-xl`、`shadow-panel` 是 043 的料，出现就是代码块被粘回来了。
   *
   * 白名单三页（Login / Intro / NotFound）是**结构不同**，不是懒得管：
   * 它们是「白卡压纸」（Login / NotFound）与「白纸 + 页内白分区」（Intro），
   * 卡是实心白且应当实心；上面那条「卡片配方」只对抬在纸上的卡片成立。
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
      '工作台里还有不透明的 bg-white。所有「面」都走 token：卡片 bg-raised、' +
        '垫底 bg-region、侧栏面 bg-veil、纸 bg-canvas。裸 bg-white 现在与 raised 同值' +
        '纯属巧合 —— raised 一旦重染，它就是唯一脱队的那块。' +
        '（Login / Intro / NotFound 三页是「白卡压纸 / 白纸」，已排除。）',
    ).toEqual([])
  })

  it('工作台里不许用冷灰垫底 —— 垫底一律 bg-region（暖中性的一层垫底）', () => {
    /*
     * 037 的原文是「卡片一暖，slate-50 表头就只剩 1.004」。结论一直没变：
     * slate-50/100 是 Tailwind 调色板的灰（冷调），压白卡上表头带半死不活；
     * 垫底这个角色已经有值 —— region #F7F7F5，压白卡实算 **1.073**
     * （表头带那条 1.046 的底线在下面「表头带不许消失」一条里实算）。
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
    expect(offenders, '工作台里还有冷灰垫底，改用 bg-region（#F7F7F5，暖中性一档）。').toEqual([])
  })

  it('卡片配方：bg-raised + border-line + shadow-card 三者同串，且恰好 25 处', () => {
    /*
     * 配方整串锚定而不是逐处点名：041 把「卡片」从一张卡的写法升格成一条材质规则，
     * 全站（工作台各汇总卡 + 各面板的 section 卡）都是同一串。
     * 数量写死是有意的 —— 新增卡片就 +1，**顺手确认它也有那条发丝线**；
     * 反过来，少一张也会红：卡被改成别的写法和，数量会先掉下来。
     *
     * x-minimalist 的配方 = `rounded-card border border-line bg-raised shadow-card`
     * （圆角 8px / 1px 发丝线 / 纯白面 / α=0.04 的近零阴影）。实算的分层账在
     * 下面两条：卡与它所在的面**同色**（1.000），分层全部由 `border-line` 承担。
     */
    const offenders = []
    let count = 0
    for (const file of SOURCE_FILES) {
      for (const { tokens, line } of classAttrsOf(read(file))) {
        if (!tokens.includes('bg-raised') || !tokens.includes('shadow-card')) continue
        count += 1
        const missing = ['rounded-card', 'border-line'].filter((t) => !tokens.includes(t))
        if (missing.length) offenders.push(`${rel(file)}:${line} 缺 ${missing.join(' / ')}`)
      }
    }
    expect(
      offenders,
      '卡片串必须是 `rounded-card border border-line bg-raised shadow-card`：' +
        '白纸上的白卡**没有色差可用**，那条 1px 发丝线就是唯一的分层手段 —— ' +
        '少一个 border-line，这张卡就与它所在的白面糊成一片。',
    ).toEqual([])
    expect(
      count,
      'bg-raised + shadow-card 一扫一处都没了 —— 锚点断了；新增卡片就 +1，顺手确认配方完整',
    ).toBe(25)
  })

  it('旧玻璃卡片配方整串禁入：bg-raised/95、border-white/60、backdrop-blur-xl、shadow-panel', () => {
    /*
     * 043 的卡片是「白霜的实心近亲」：`bg-raised/95` + 不透明的白描边 +
     * 自己的模糊。这一代面是不透明的，这三样都成了旧值 —— 出现即「旧代码块
     * 被粘回来」。逐个钉的是**类名形态**，注释先剥（历史论证里会引用它们）。
     */
    const offenders = []
    for (const file of SOURCE_FILES) {
      for (const { tokens, line } of classAttrsOf(stripComments(read(file)))) {
        const hit = tokens.filter(
          (t) =>
            /^bg-raised\/\d{1,3}$/.test(t) ||
            /^border-white(\/\d{1,3})?$/.test(t) ||
            t.startsWith('backdrop-blur') ||
            t.startsWith('backdrop-saturate') ||
            t === 'shadow-panel',
        )
        if (hit.length) offenders.push(`${rel(file)}:${line} ${hit.join(' ')}`)
      }
    }
    expect(
      offenders,
      '043 的玻璃卡片配方回流了（bg-raised/95 / border-white/60 / backdrop-blur-xl / ' +
        'shadow-panel）。这一代的面是**不透明**的：填充不带透明度、描边是 border-line、' +
        '没有模糊、没有面板投影。',
    ).toEqual([])
  })

  it('表头带不许消失：region 压白卡 ≥ 1.046（实算 1.073）', () => {
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

  it('卡片与它所在的白面**同色**（实算 1.000）—— 分层全部由 1px 发丝线承担（实算 1.203）', () => {
    /*
     * 043 这条是「白卡压霜面 ≥1.046」：卡是 raised/95、霜是 55% 白玻璃，在最亮端
     * 落差最窄（实算 1.05），那里过线全屏就过线。
     *
     * x-minimalist 把那一档**整个拿掉**：卡与它所在的面同值（#FFFFFF），
     * 实算对比度**恰好 1.000** —— 色差这条路是这一代主动放弃的，不是失手丢的。
     *
     * 放弃色差 ≠ 放弃分层：分层**移交给了描边**。每张卡都必须有那条 1px
     * `border-line`（数量与配方由上面两条钉着），它的可测量别是「与卡面的对比」
     * = **1.203:1**。
     *
     * ⚠️ 这个数**故意**低于 WCAG 1.4.11 的 3:1，理由要写清楚：1.4.11 管的是
     *    「识别**控件**及其状态所必需的视觉信息」，而发丝线是**版式分隔**
     *    （minimalist 的 "Borders — exactly 1px solid #EAEAEA on cards,
     *    dividers"）—— 一张卡不靠边界也认得出是卡，它靠的是间距、字阶与
     *    分组。真要一个过 3:1 的边界，那是 §6 的焦点环，不是分隔线。
     *    这里钉的是「线必须在、且必须淡到刚好分得开」，不是「它要过 3:1」。
     */
    const raised = tokenHex('raised')
    const line = tokenHex('line')
    expect(raised && line, 'tailwind.config.js 里没有 colors.raised / colors.line').toBeTruthy()
    expect(FROST_SHOWN.length, '面板面色没算出来（tokenHex 断了）').toBeGreaterThan(0)
    expect(CARD_SHOWN.length, '卡面色没算出来（tokenHex 断了）').toBeGreaterThan(0)
    expect(
      contrast(CARD_SHOWN[0][1], FROST_SHOWN[0][1]),
      '卡与它所在的白面（主区栏）出现了色差 —— 这一代的设计是「同色 + 发丝线」；' +
        '若有意改回色差分层，那是另一个决定，请连同下面那条描边的账一起重写',
    ).toBeCloseTo(1, 3)
    expect(
      contrast(raised, tokenHex('canvas')),
      '白卡与纸也必须是同色（1.000）—— 色差这一档在这一代不存在',
    ).toBeCloseTo(1, 3)
    expect(
      contrast(line, raised),
      `发丝线与卡面只有 ${contrast(line, raised).toFixed(3)}:1 —— 卡片会看不出边界` +
        '（实算 1.203：这是这一代唯一的分层手段）',
    ).toBeGreaterThanOrEqual(1.15)
  })

  it('卡片是不透明的（bg-raised 不带 `/` 后缀）；卡内 rose-600 / slate-500 都过 AA', () => {
    /*
     * 041 时代这条是「/95 是照 rose-600 的余量逼出来的，再透一档就破」；
     * 043 把它降级成「雾度取值」（/95 与 /80 的差 < 0.3，读不出来）。
     * x-minimalist 把这个问题**整个取消**：面是不透明的，没有"透一点/实一点"
     * 可调 —— `bg-raised/95` 这类写法本身就是旧配方（上一条已全仓禁入）。
     *
     * 所以这条钉两件事：
     *   ① `bg-raised` 一律不带 `/` 透明度后缀（全仓，含 `:class` 里的字面量）；
     *   ② 卡面上的 rose-600 与 slate-500 在**每个代表点**上都过 AA
     *      —— 实算 rose-600 4.70、slate-500 4.76（都在 #FFFFFF 上）。
     */
    const slashed = []
    for (const file of SOURCE_FILES) {
      for (const { tokens, line } of classAttrsOf(stripComments(read(file)))) {
        for (const t of tokens) {
          if (/^bg-raised\//.test(t)) slashed.push(`${rel(file)}:${line} ${t}`)
        }
      }
    }
    expect(
      slashed,
      'bg-raised 带了透明度后缀。这一代的面是**不透明**的：一个 /95 只会把后面的' +
        '纸透出来，把「面 + 发丝线」讲的那层关系讲糊（043 的 /95 是白玻璃的近亲，' +
        '玻璃没了它就没有理由）。',
    ).toEqual([])

    expect(CARD_SHOWN.length, '卡片面没算出来（tokenHex 或纸解析断了）').toBeGreaterThan(0)
    for (const [name, card] of CARD_SHOWN) {
      expect(
        contrast(HEX['rose-600'], card),
        `rose-600 压卡片（${name}）只有 ${contrast(HEX['rose-600'], card).toFixed(2)}:1 ` +
          '—— 卡内错误文字欠对比度',
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(HEX['slate-500'], card),
        `slate-500 压卡片（${name}）只有 ${contrast(HEX['slate-500'], card).toFixed(2)}:1 ` +
          '—— 卡内弱化文字集体欠对比度',
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

// ---------------------------------------------------------------------------
// 12. 不透明面板 + 发丝线与固定大小（侧栏面 / 两块白面）
// ---------------------------------------------------------------------------

describe('不透明面板 + 发丝线与固定大小（侧栏面 / 两块白面，x-minimalist）', () => {
  /*
   * 病史先记着，不然看不出为什么还是「三块」：
   *
   * 使用方 2026-10-07 圈着侧栏和顶部标题条指定了三个值：**背景半透明、模糊 24
   * 像素、边缘用亮白描边**。第一版只照这三个值做，上线看到的是「没效果」——
   * 75% 白压在近白的纸上还是白。使用方当场补了第四条：**玻璃带一点色调**。
   * 036 那代三块是**同一种**中性暖灰；041 拆成深烟 / 白霜两种；043 保留两档、
   * 都收进清水档（填充 55%、模糊 32/30）。**x-minimalist 把三块一起做成不透明**：
   * 三块不再有透明度，但**仍然是两种料**——从两种透明度变成两种**颜色**：
   *
   *   侧栏        bg-veil   #F7F6F3   + border-line
   *   导航条+主区 bg-raised #FFFFFF   + border-line
   *
   * 为什么侧栏仍要「比纸深半档」：043 的「深伴星」关系（与纸 ≥1.08）在这一代
   * 继续成立（实算 1.0807），只是从"半透明叠出来的"变成"token 直接就是这个值"。
   * 两块白面与纸同值，靠 1px 发丝线分层（§11 有那条的完整论证）。
   *
   * 这一组钉的是几条**改坏了也看不出来**的机制：
   *   ① 三块的 token 组合逐项锚定（防顺手把料搅混）；
   *   ② 两块白面栏**必须同料**（只调一块 → 一块白一块灰，并排看就是坏的）；
   *   ③ 侧栏与白面**必须异料**（改回三块同料，就是把「侧栏比纸深半档」推翻）；
   *   ④ 填充不带透明度后缀、描边是 border-line（画在自己背景之上，带 α 就是
   *      同一个像素）；
   *   ⑤ 吸顶线必须同一条（滚起来才露馅）；导航条带 z；
   *   ⑥ 主区固定大小（038 的整条链，与本组同挂在 WORKBENCH 上）。
   *
   * 另外：三块都不许再出现 `backdrop-*` / `shadow-panel` / `border-white` ——
   * 那是 043 的玻璃料。`backdrop-saturate` 在 043 就已经整条退役（场是无彩的，
   * 提饱和无处可提），这一代更彻底：`backdrop-*` 全族禁入。
   */
  const MATERIAL_RE = /^(bg-(veil|raised)|border-line|rounded-card)$/
  const materialOf = (tokens) => tokens.filter((t) => MATERIAL_RE.test(t)).sort()
  const EXPECT_VEIL = ['bg-veil', 'border-line', 'rounded-card']
  const EXPECT_RAISED = ['bg-raised', 'border-line', 'rounded-card']

  it('三块面板都解析出来了 —— 锚点失效时先在这里红', () => {
    // 上面几个锚点都是从源码文本里「就近取 class」，元素挪了位置或换了写法就会解析空。
    // 与其让后面几条报出莫名其妙的失败，不如在这里说清楚是解析断了。
    expect(SIDEBAR.length, '没从 id="app-sidebar" 后面解析出侧栏面板的 class').toBeGreaterThan(1)
    expect(
      NAV.length,
      '没从「{{ activeTabLabel }}」往前解析出导航条那张卡片的 class',
    ).toBeGreaterThan(1)
    expect(
      MAIN.length,
      '没在源码里找到同时带 min-h-0 与 bg-raised 的 class —— 主区栏的锚点断了' +
        '（043 的锚点是 backdrop-blur-[30px]，x-minimalist 换成同料的白面标记）',
    ).toBeGreaterThan(1)
  })

  it('侧栏是 veil 面：token 组合逐项在（不透明 + 发丝线 + 卡片圆角）', () => {
    expect(
      materialOf(SIDEBAR),
      '侧栏的材质 token 与 x-minimalist 的定稿不一致（侧栏面：bg-veil + border-line + ' +
        'rounded-card，不透明、无模糊）。改成白面就把「侧栏比纸深半档」的基本盘推翻了 —— ' +
        '三块同色，整屏的层级只剩发丝线一条。',
    ).toEqual(EXPECT_VEIL)
    expect(SIDEBAR, '侧栏没吸顶').toContain('sticky')
    expect(SIDEBAR, '侧栏面板不是圆角卡片').toContain('rounded-card')
  })

  it('导航条与主区栏是白面料，且**两块完全同料**（防只调一块）', () => {
    expect(materialOf(NAV), '导航条的材质 token 与定稿不一致').toEqual(EXPECT_RAISED)
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

  it('侧栏与白面栏是**两种**料 —— 三块同料是被两代一起推翻的版本', () => {
    // 只调一块 → 一块深一块浅，三块不在同一个视线上；但把侧栏也改成白面是更隐蔽的
    // 倒退：静止看「整齐了」，侧栏与纸的分离比（1.0807）当场归零。
    // 两种料是决定，不是巧合 —— 只是这一代它由**颜色**表达，不再由透明度表达。
    expect(SIDEBAR, '侧栏的填充不是 bg-veil').toContain('bg-veil')
    expect(SIDEBAR, '侧栏出现了白面填充 —— 它是 veil 面').not.toContain('bg-raised')
    expect(NAV, '白面栏的填充不是 bg-raised').toContain('bg-raised')
    expect(NAV, '导航条用了侧栏面的填充').not.toContain('bg-veil')
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
      '导航条没吸顶 —— 不吸顶它滚过去就没了（043 时它的存在理由是「让模糊有东西' +
        '可糊」，玻璃退役后仍留着，理由见 2276 那一段注释）。',
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

  it('侧栏面与纸分得开（实算 1.0807 ≥ 1.08）；两块白面与纸同值，靠 1px 发丝线分层', () => {
    /*
     * 037 的第一版「没效果」（使用方原话）就是这么来的：75% 白压在近白纸上
     * 只有 1.0x，玻璃与底在数值上几乎同色 ——「半透明」这个属性在屏幕上不存在。
     *
     * x-minimalist 的两条线：
     *   · **侧栏面是「深伴星」** —— 比纸深半档，与 desk/canvas 那对同按 1.08 钉；
     *     实算 contrast(#F7F6F3, #FFFFFF) = **1.0807**（贴着线过，这是定稿值：
     *     再浅就掉到 1.08 以下，侧栏与纸就糊成一片）。
     *   · **两块白面与纸同值** —— 色差实算**恰好 1.000**，这一代主动放弃色差，
     *     分层交给 1px `border-line`：它的可测量别是"与纸的对比" = **1.203**
     *     （下面钉 ≥ 1.15；1.4.11 的 3:1 是控件的账，版式分隔不适用，§11 有论证）。
     */
    expect(VEIL_SHOWN.length, '侧栏面色没算出来（侧栏锚点或 colors.veil 断了）').toBeGreaterThan(0)
    expect(FROST_SHOWN.length, '白面色没算出来（colors.raised 或纸解析断了）').toBeGreaterThan(0)
    for (const [name, under] of gradientPoints) {
      const veil = (VEIL_SHOWN.find(([n]) => n === name) || [])[1]
      const ratio = contrast(veil, under)
      expect(
        ratio,
        `侧栏面压纸（${name}）只有 ${ratio.toFixed(4)}:1 —— ` +
          '低于 1.08 侧栏与纸就糊成一片，「比纸深半档」在屏幕上不存在' +
          `（实测定稿值 1.0807）。`,
      ).toBeGreaterThanOrEqual(1.08)
      const raised = (FROST_SHOWN.find(([n]) => n === name) || [])[1]
      expect(
        contrast(raised, under),
        `白面与纸（${name}）出现了色差 —— 这一代是「同色 + 发丝线」`,
      ).toBeCloseTo(1, 3)
    }
    expect(
      contrast(tokenHex('line'), tokenHex('canvas')),
      `发丝线与纸只有 ${contrast(tokenHex('line'), tokenHex('canvas')).toFixed(3)}:1 —— ` +
        '两块白面与纸同色，这条线是它们之间**唯一**的边界（实算 1.203）',
    ).toBeGreaterThanOrEqual(1.15)
  })

  it('填充不带透明度后缀，描边是 border-line —— 三块都是不透明的面', () => {
    /*
     * 043 这条是**通透度**（"不透明度落在 45~65"）：玻璃透明度的区间，
     * 往高调越接近身后的场、往低调越接近一块色板，55 是实机定档值。
     *
     * x-minimalist 把这个自由度**取消**了：面是不透明的，没有"透一点/实一点"
     * 可调。所以这条改成钉住那个新契约的两半：
     *   ① 填充必须是**裸 token**（`bg-veil` / `bg-raised`），不带 `/NN` 后缀 ——
     *      一个 `/95` 就把后面那张纸透出来，把「面 + 发丝线」讲的关系讲糊；
     *   ② 描边必须是 `border-line` 且同样不带透明度 —— 它画在自己的背景之上，
     *      带 α 压上去就是同一个像素（043 的 `border-white/60` 之所以不透明，
     *      就是这条理由；那一代靠"白描边"表达边界，这一代靠"发丝线"）。
     */
    for (const [name, tokens, fill] of [
      ['侧栏', SIDEBAR, 'bg-veil'],
      ['导航条', NAV, 'bg-raised'],
      ['主区栏', MAIN, 'bg-raised'],
    ]) {
      const kind = fill.replace(/^bg-/, '')
      expect(tokens, `${name}没有 ${fill} 填充`).toContain(fill)
      // fillOf 只认 `bg-<kind>/<n>` 这个形态 —— 它返回 undefined 就是"没有透明度后缀"。
      // 这条比 toContain(fill) 更强：它连 `bg-veil/95` 这种**同时存在**的写法也堵住。
      expect(
        fillOf(tokens, kind),
        `${name}的填充带了透明度后缀（bg-${kind}/NN）—— 三块面板都是**不透明**的（玻璃已退役）`,
      ).toBeUndefined()
      expect(alphaOf(fillOf(tokens, kind)), `${name}的填充解析出了 α —— 它应当没有`).toBeNull()
      expect(
        tokens.filter((t) => t.startsWith(`${fill}/`)),
        `${name}的填充带了透明度后缀 —— 三块面板都是**不透明**的（玻璃已退役）`,
      ).toEqual([])
      expect(tokens, `${name}的描边不是 border-line`).toContain('border-line')
      expect(
        tokens.filter((t) => t.startsWith('border-line/')),
        `${name}的描边带了透明度后缀 —— 它画在自己背景之上，带 α 就是同一个像素`,
      ).toEqual([])
    }
  })

  it('backdrop-* 全族退役：三块面板的类名里不许再出现 backdrop-blur / backdrop-saturate / backdrop-filter', () => {
    /*
     * 043 的场是**无彩**的，saturate 提不出任何东西（那条禁令当时就立着）；
     * 这一代连 blur 一起退 —— 三块面板都是不透明的面，`backdrop-*` 全族
     * 在这一代没有任何正当用途（043 唯一被豁免的是 `.glass-sample` 的折射链，
     * 那条链本身也已整份删除，见 §17）。
     */
    const offenders = []
    for (const file of SOURCE_FILES) {
      for (const { tokens, line } of classAttrsOf(stripComments(read(file)))) {
        const hit = tokens.filter((t) => t.startsWith('backdrop-'))
        if (hit.length) offenders.push(`${rel(file)}:${line} ${hit.join(' ')}`)
      }
    }
    expect(
      offenders,
      'backdrop-* 回流了（blur / saturate / filter 全族）。x-minimalist 的三块面板是' +
        '**不透明**的：没有背后的东西可以糊，也没有颜色值得提饱和 —— ' +
        'minimalist 只给导航留了一条「subtle nav blur」的口子，本项目连这条也没用。',
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
// 13. 面板上的文字安全复算（侧栏面上的 slate 深字 / 白面上的 slate-600）
// ---------------------------------------------------------------------------

describe('面板上的文字安全复算（侧栏面上的 slate 深字 / 白面上的 slate-600）', () => {
  /*
   * 这一组是「材质决定文字」的账。043 里它是**两档玻璃各一本**（翻面之后两档
   * 都是浅底配深字）；x-minimalist 之后两档并成「侧栏面 / 白面」两种**颜色**，
   * 账没有变，但基线简单了：面是不透明的，文字压在 token 自己的值上，
   * 不再有"叠出来的最坏底色"（underlayList 现在只有一个代表点，见文件头）。
   *
   *   · 侧栏面（veil #F7F6F3）—— 浅面上的文字整批翻深（043 改动量最大的一处，
   *     漏一处就欠对比度）。三档实算：
   *       slate-900 **16.52**（主标题）/ slate-700 **9.58**（正文、身份行）/
   *       slate-600 **7.01**（弱化行）。
   *     `slate-500` 压它是 **4.40 < 4.5** —— 那条反面断言仍然有效（下面钉着，
   *     它是"纱面托不住浅色字"这条老结论的 tripwire）。
   *     白**只留在选中胶囊 `bg-brand`（#111111）实底里面**（18.88）。
   *   · 白面（raised #FFFFFF）—— 压在上面的弱化文字是 `slate-600`（页签未选中态）：
   *     实算 **7.58**。`slate-500` 压白面是 4.76 —— **过**，页签仍写 600 的理由
   *     是层次而不是阈值（那条的注释写清了 043 那笔 4.37 为什么作废）。
   */
  it('侧栏面（veil）上的文字只有 slate 深字族（+ 白：只在胶囊里；+ 一处退出登录的 rose）', () => {
    /*
     * 规则仍是「侧栏里一律不许出现别的色系」，而不是逐处判断「这个 span 里是
     * 文字还是图标」：后者要靠人读上下文，护栏判不了。图标本可以留在灰系
     * （走非文字元素的 3:1），但一条不许的规则好守得多。
     *
     * 例外收成两处：选中胶囊里的白（压墨色 18.88 —— 它是「反白」，不是浅色字），
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
      '侧栏里出现了 slate/白以外的文字色。侧栏面是浅底 —— 浅色字压它欠对比度' +
        '（slate-500 只有 4.40、白系更浅），深底时代的白字族在 043 全部翻深；' +
        '语义色只有退出登录那处 rose。',
    ).toEqual([])
  })

  it('侧栏深字族的锚点 —— 三档 slate、白透块三档、Steep 桃色胶囊串、焦点环都在', () => {
    const asideBlock = WORKBENCH.slice(WORKBENCH.indexOf('<aside'), WORKBENCH.indexOf('</aside>'))
    const tokens = classAttrsOf(stripComments(asideBlock)).flatMap((a) => a.tokens)
    for (const t of ['text-slate-900', 'text-slate-700', 'text-slate-600']) {
      expect(tokens, `侧栏里没有 ${t} —— 深字族的三档没了`).toContain(t)
    }
    // 选中行：墨色胶囊 + 白描边环（043 删了 shadow-glow 光晕 —— 实底自撑）
    expect(
      WORKBENCH.includes("'bg-accent-soft ring-1 ring-accent-ink/10'"),
      '侧栏选中行不是「bg-accent-soft + ring-1 + ring-accent-ink/10」那串了 —— ' +
        '三段各管一件事（底色/描边粗细/描边色），别拆',
    ).toBe(true)
    for (const t of ['bg-white/40', 'bg-white/80', 'bg-slate-900/[0.08]']) {
      // /15 是选中图标块、/40 是未选中图标块、/45 是整行 hover —— 三种前缀都算数
      expect(
        tokens.some((tok) => tok === t || tok === `hover:${t}` || tok === `group-hover:${t}`),
        `侧栏里没有 ${t}（含 hover: / group-hover: 形态）。未选中行底与图标块是白色` +
          '**透块**：侧栏面 #F7F6F3 是浅的，实白块会刺眼（037 使用方诉状同一个理），' +
          '靠透明度分层次。',
      ).toBe(true)
    }
    expect(
      tokens,
      '侧栏的焦点环不是 ring-brand —— 043 起它跟全站一个环色（墨色压侧栏面 17.47，' +
        '041 那种「深底上豁免白环」的理由随深侧栏一起退役）',
    ).toContain('focus-visible:ring-brand-ink')
  })

  it('slate 深字族在侧栏面上过 AA（三档实算 16.52 / 9.58 / 7.01）；slate-500 压它是 4.40 —— 这就是最小到 600 的原因', () => {
    expect(VEIL_SHOWN.length, '侧栏面色没算出来（侧栏锚点或 colors.veil 断了）').toBeGreaterThan(0)
    for (const level of ['slate-900', 'slate-700', 'slate-600']) {
      const hex = HEX[level]
      expect(hex, `HEX 表里没有 ${level}，先补上再算`).toBeTruthy()
      for (const [name, veil] of VEIL_SHOWN) {
        expect(
          contrast(hex, veil),
          `${level} 压侧栏面（${name}）只有 ${contrast(hex, veil).toFixed(2)}:1 —— 侧栏的深字族从这里开始欠`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
    // 反面（tripwire）：slate-500 压侧栏面只有 4.40 —— 它若哪天被当正文写在侧栏面上，
    // 先在这里可见（图标块里可以：那是非文字元素，3:1 就够）。
    // 这条是「纱面托不住浅色字」那句老结论的**可复算形式**，两代都成立。
    const worst = Math.max(...VEIL_SHOWN.map(([, veil]) => contrast(HEX['slate-500'], veil)))
    expect(
      worst,
      `${worst.toFixed(2)} —— slate-500 在侧栏面上竟然过 4.5 了？面若被调亮，` +
        '重新决定「侧栏面上的弱化档」再拆这条',
    ).toBeLessThan(4.5)
  })

  it('选中胶囊上的字：深墨 8.14；深墨各档透明度压橙也全过（亮橙时代翻面）', () => {
    /*
     * 这条的结论换过三次向：
     *   · 041 蓝胶囊：白的各档透明度压 brand 全破 AA（/95 4.39、/85 3.82），
     *     只有纯白 4.70 过线 → 提示行必须转纯白；
     *   · 043 石墨：白字余量 18.88，白成了**层次手段**；
     *   · 2026-10-18 太阳橙：白字只剩 2.15 —— 字色整体翻成深墨 `on-brand`
     *     （#1C1917 压橙 8.14），提示行的 /85 深墨也有 6.17。
     *
     * 这条同时是余量哨兵，只是方向反了：余量来自「橙够亮」。brand 若被调暗
     * （往能吃白字的深红棕走），太阳橙就没了 —— 那一半由上一条用例守。
     */
    const brand = tokenHex('brand')
    const onBrand = tokenHex('on-brand')
    expect(brand, 'tailwind.config.js 里没有 colors.brand').toBeTruthy()
    expect(onBrand, 'tailwind.config.js 里没有 colors.on-brand').toBeTruthy()
    expect(
      contrast(onBrand, brand),
      '深墨压 brand 不过 4.5 了？先看 brand 是不是被调过，再谈别的',
    ).toBeGreaterThanOrEqual(4.5)
    const softest = composite(onBrand, 0.85, brand)
    expect(
      contrast(softest, brand),
      `${contrast(softest, brand).toFixed(2)} —— /85 深墨压 brand 跌到 4.5 以下了：` +
        '橙被调浅、深字余量收窄，重新决定选中胶囊上的字色再拆这条',
    ).toBeGreaterThanOrEqual(4.5)
    // 版面上的锚：提示行那一串里得有「选中 → 深墨」的分支
    const hi = WORKBENCH.indexOf('block truncate text-[13px] font-normal')
    expect(hi, '没扫到侧栏提示行的 class 串（锚点断），先修这条').toBeGreaterThan(-1)
    expect(
      WORKBENCH.slice(hi, hi + 240),
      "侧栏提示行没有「选中转 'text-accent-ink'」的分支 —— 深浅两态的层次靠它",
    ).toContain("'text-accent-ink'")
  })

  it('白面上的弱化文字：slate-600 过 AA（实算 7.58）—— 043「霜面最深端 4.37」那条推理随玻璃消失', () => {
    expect(FROST_SHOWN.length, '白面色没算出来（colors.raised 或纸解析断了）').toBeGreaterThan(0)
    for (const [name, face] of FROST_SHOWN) {
      const six = contrast(HEX['slate-600'], face)
      expect(
        six,
        `slate-600 压白面（${name}）只有 ${six.toFixed(2)}:1 —— ` +
          '页签未选中态、白面上的说明文字用的就是它',
      ).toBeGreaterThanOrEqual(4.5)
    }
    /*
     * ⚠️ **043 那条反面断言的前提没有了，别照着旧注释去找它。**
     *
     * 043 写的是「slate-500 压霜面最深端 4.37 不过 —— 所以页签不写 500」，
     * 成立的前提是**霜面是 55% 白玻璃**：半透明填充让最深处比纯白暗一档，
     * 500 在那里刚好跌破 4.5。minimalist 把玻璃整组删掉，白面就是 #FFFFFF，
     * 500 压它实算 **4.76 —— 过**。拿旧断言（`toBeLessThan(4.5)`）继续钉，
     * 只会钉住一个**屏幕上不存在**的底色。
     *
     * 所以这里换成两条真实成立、且方向不同的账：
     *   ① 500 现在是过的（4.76）—— 记下来，免得下一个人以为它被禁了；
     *   ② 页签仍然写 600，但理由是**层次**不是阈值：600（7.58）与选中态的
     *      墨底白字（18.88）之间留一级，正好是"未选中 vs 选中"的落差；
     *      500 与卡内正文灰同档（§11 里卡面正文就是 slate-500），
     *      在页签行上分不出主次。所以 `contrast(600) > contrast(500)` 是可测的，
     *      而那个**不变的**约束是「页签串里必须写 600」（下一条钉字面量）。
     */
    const face = FROST_SHOWN[0][1]
    expect(
      contrast(HEX['slate-500'], face),
      `slate-500 压白面只有 ${contrast(HEX['slate-500'], face).toFixed(2)}:1 —— ` +
        '它在这一代是过的（实算 4.76）；不过就说明白面被调暗了、或 500 被换色了',
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(HEX['slate-600'], face),
      'slate-600 压白面没有比 slate-500 更深 —— 页签那一级的层次就没了',
    ).toBeGreaterThan(contrast(HEX['slate-500'], face))
  })

  it('页签两串字面量：选中橙底深字 / 未选中 slate-600', () => {
    // 页签是三块面板上唯一的「一组文字」，两态各钉一串字面量 ——
    // 它同时是「选中 = brand 实底 + on-brand 深字」与「未选中 = 压白面的 slate-600」的锚。
    // 2026-10-18：太阳橙太亮，选中态的字从 text-white 换成 text-on-brand（8.14:1）。
    expect(
      WORKBENCH.includes("'border-brand bg-brand font-medium text-on-brand'"),
      '页签选中态不是「border-brand bg-brand font-medium text-on-brand」',
    ).toBe(true)
    expect(
      WORKBENCH.includes(
        "'border-line text-slate-600 hover:border-slate-300 hover:text-slate-800'",
      ),
      '页签未选中态不是 `border-line` + slate-600 那串。未选中页签的边界是**发丝线**' +
        '（分层用它），hover 才是控件描边 border-slate-300 —— 两者角色不同，别混；' +
        '文字仍用 600（白面上 500 虽然过线，但页签那一级要与选中态拉开层次，见上一条）',
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
   * 预览表，仍未动）。它的链在**面板文件**里，包装层在对应页面文件里
   * —— 所以第三条用例扫的是面板源码，时间线那条账也改成五份对账。
   */
  const TABS = ['workOrder', 'material', 'inbound', 'stock']
  /*
   * 四个汇总页各自的文件（2026-10 路由化改造）。
   *
   * 改造前这四个面板同住一个 WorkOrderList.vue，包装层写作
   * `v-if="mountedTabs.has(x)" v-show="activeTab === x"`（v-if 管存在、v-show 管可见）。
   * 拆页之后**包装层就是页面文件的根 div** —— 路由天然「一次只挂一页」，
   * 存在性不再需要 v-if，可见性不再需要 v-show。判据因此从「找那段指令」变成
   * 「读这一页模板的第一个 div」，断言的强度不变：缺 flex/h-full/flex-col 一样会红。
   */
  const PAGE_FILES = {
    workOrder: 'views/orders/WorkOrderList.vue',
    material: 'views/orders/PickingList.vue',
    inbound: 'views/orders/InboundList.vue',
    stock: 'views/materials/StockView.vue',
    // 下面三个是「面板 + 包装层」的页：包装层同样搬到了各自的页面文件
    tankLevel: 'views/stats/TankLevelView.vue',
    equipment: 'views/equipment/EquipmentView.vue',
    purchase: 'views/purchase/PurchaseView.vue',
  }
  const TANK_PANEL = read(join(SRC, 'components', 'TankLevelPanel.vue'))
  // 锚点再失效时，下面用例的第一条断言会先红（解析出来是空串）。
  const classAttr = (tab) =>
    (read(join(SRC, PAGE_FILES[tab])).match(/<template>\s*<div class="([^"]*)"/) || [])[1] ?? ''
  const classAttrsIn = (src) =>
    [...src.matchAll(/(:?)class="([^"]*)"/g)].map((m) => ({
      bound: m[1] === ':',
      value: m[2],
    }))
  const CLASS_ATTRS = classAttrsIn(WORKBENCH)
  const TANK_CLASS_ATTRS = classAttrsIn(TANK_PANEL)
  const MAINT_PANEL = read(join(SRC, 'components', 'EquipmentMaintenancePanel.vue'))
  const MAINT_CLASS_ATTRS = classAttrsIn(MAINT_PANEL)
  const PURCHASE_PANEL = read(join(SRC, 'components', 'PurchaseTrackingPanel.vue'))
/*
 * 变更-117 把「采购需求」拆成了 面板 + 抽屉 + 字段表。
 * 断言仍要覆盖整条链路（远程检索、上传控件），所以再拼一个合并视图 ——
 * 否则"代码搬了个家"会被当成"功能被删了"。
 */
const PURCHASE_UI = [
  PURCHASE_PANEL,
  read(join(SRC, 'components', 'purchase', 'PurchaseDetailDrawer.vue')),
  read(join(SRC, 'components', 'purchase', 'fields.js')),
].join('\n')
  const PURCHASE_DATA = read(join(SRC, 'composables', 'usePurchaseTracking.js'))
  const PURCHASE_CLASS_ATTRS = classAttrsIn(PURCHASE_PANEL)
  const countStatic = (text) => CLASS_ATTRS.filter((a) => !a.bound && a.value === text).length
  const countStaticTank = (text) =>
    TANK_CLASS_ATTRS.filter((a) => !a.bound && a.value === text).length
  const countStaticMaint = (text) =>
    MAINT_CLASS_ATTRS.filter((a) => !a.bound && a.value === text).length
  const countStaticPurchase = (text) =>
    PURCHASE_CLASS_ATTRS.filter((a) => !a.bound && a.value === text).length

  it('四个页签的定高链一级不少：包装层 h-full → 卡片 flex-1/min-h-0 → 表格区是唯一滚动容器', () => {
    expect(
      TABS.map(classAttr).filter(Boolean).length,
      '没解析出四个汇总页签的包装层 —— 锚点失效（面板懒挂载的写法变了？），先在这里红',
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
        'flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card',
      ),
      '不是四张卡片都写着 flex/min-h-0/flex-1/flex-col + 发丝线卡片配方：`min-h-0` 是' +
        '这里的关键一笔 —— flex 项默认 min-height:auto（不许比内容矮），不写它卡片' +
        '就被内容顶高，分页行照旧一页一个位置。',
    ).toBe(TABS.length)

    expect(
      countStatic('rounded-card border border-line bg-raised shadow-card'),
      '不是其余四张 section 卡片（周统计/日统计/储罐/体积）都换成了同一条卡片配方 —— ' +
        '卡片是**一条材质规则**，不是只改四张（x-minimalist 的配方 = 圆角 + 1px 发丝线 ' +
        '+ 纯白面 + α=0.04 的近零阴影，详见 §11）。' +
        '⚠️ 变更-091 起采购进度跟踪不再是「占位 section」，改成子组件 + 定高链，' +
        '所以这里从 5 变成 4（那张卡片现在在 PurchaseTrackingPanel.vue 里，另行钉住）。',
    ).toBe(4)

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
      '不是四个表格区都成了「自己滚」的那一层：表格区一旦不滚，滚的就是主区栏，' +
        '卡片退回跟着内容长，分页行又跑起来了。',
    ).toBe(TABS.length)

    expect(
      countStatic('flex shrink-0 justify-end border-t border-line px-6 py-3'),
      '不是四个分页行都带 shrink-0（分隔线是发丝线 border-line）：' +
        '空间不够时 flex 会先压它',
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
        'flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card',
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
      '储罐表格区不是「自己滚」的那一层：表格区一旦不滚，滚的就是主区栏，' +
        '卡片退回跟着内容长，分页行又跑起来了。',
    ).toBe(1)

    expect(
      countStaticTank('flex shrink-0 justify-end border-t border-line px-6 py-3'),
      '储罐分页行没有带 shrink-0（分隔线是发丝线 border-line）：空间不够时 flex 会先压它',
    ).toBe(1)
  })

  it('设备数据维护同一张方子（变更-088）：定高由包装层传下来，分页行钉底', () => {
    /*
     * 使用方 2026-10-16 对这张表说的是与 038 / 044 **同一句话**：
     * 「分页工具翻页时，不在同一个位置，体感上就像是在跳动」。
     *
     * 这一处是 038 的注释里点名过、当时没动的三个漏网页之一（原话：「另有设备保养、
     * 文件导入预览表，仍未动」）—— 变更-085 给表格区只加了 `max-h-[68vh]`，
     * 那是"最大高度"，卡片依然随每页折行数一高一矮，所以病还在。
     */
    expect(
      tokensOf(classAttr('equipment')),
      '设备数据维护的包装层少了 flex/h-full/flex-col：卡片拿不到定高，分页行会退回' +
        '「跟着内容跑」—— 使用方 2026-10-16 报的就是它。',
    ).toEqual(expect.arrayContaining(['flex', 'h-full', 'flex-col']))

    expect(
      countStaticMaint(
        'flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card',
      ),
      '维护卡片没有转成「撑满 + 纵向 flex + min-h-0」：`min-h-0` 是关键一笔 —— ' +
        'flex 项默认 min-height:auto（不许比内容矮），不写它卡片就被内容顶高，' +
        '分页行照旧一页一个位置，而静止看一屏完全正常。',
    ).toBe(1)

    // 表格区带 ledger-scroll（变更-086 的细滚动条），所以整串与四个汇总页签那条不同；
    // 但「自己滚」那一笔（min-h-0 flex-1 overflow-auto）必须一样
    expect(
      countStaticMaint('ledger-scroll min-h-0 flex-1 overflow-auto'),
      '维护表格区不是「自己滚」的那一层（或丢了细滚动条类 ledger-scroll）：' +
        '表格区一旦不滚，滚的就是主区栏，卡片退回跟着内容长，分页行又跑起来了。',
    ).toBe(1)

    expect(
      countStaticMaint('flex shrink-0 justify-end border-t border-line px-6 py-3'),
      '维护分页行没有带 shrink-0（分隔线是发丝线 border-line）：空间不够时 flex 会先压它',
    ).toBe(1)

    expect(
      countStaticMaint('shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800'),
      '加载失败提示条没有带 shrink-0：它也会被 flex 压扁',
    ).toBe(1)
  })

  it('采购进度跟踪同一张方子（变更-091）：定高由包装层传下来，分页行钉底', () => {
    /*
     * 新页面上线时最容易漏的就是这条链 —— 而它漏了**静止看一屏完全正常**，
     * 只有翻页（或行数变化）时才看得出来分页行在跳。所以照着 088 的做法，
     * 纳进来的当天就把四个锚点钉住，而不是等使用方再报一次。
     */
    expect(
      tokensOf(classAttr('purchase')),
      '采购进度跟踪的包装层少了 flex/h-full/flex-col：卡片拿不到定高，分页行会退回「跟着内容跑」。',
    ).toEqual(expect.arrayContaining(['flex', 'h-full', 'flex-col']))

    expect(
      countStaticPurchase(
        'flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card',
      ),
      '采购卡片没有转成「撑满 + 纵向 flex + min-h-0」：不写 min-h-0，卡片被内容顶高，分页行一页一个位置。',
    ).toBe(1)

    expect(
      countStaticPurchase('purchase-scroll min-h-0 flex-1 overflow-auto'),
      '采购表格区不是「自己滚」的那一层（或丢了细滚动条类 purchase-scroll）',
    ).toBe(1)

    expect(
      countStaticPurchase('flex shrink-0 justify-end border-t border-line px-6 py-3'),
      '采购分页行没有带 shrink-0（分隔线是发丝线 border-line）：空间不够时 flex 会先压它',
    ).toBe(1)

    expect(
      countStaticPurchase('shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800'),
      '加载失败提示条没有带 shrink-0：它也会被 flex 压扁',
    ).toBe(1)
  })

  it('采购进度跟踪是「表内录入」，不许退回弹窗（变更-092）', () => {
    /*
     * 使用方原话：「PC端就不用这种卡片式，直接在行上面添加，物料名称可以搜索，实时搜索的形式，
     * 物料编码自动带出，也可以根据物料编码搜索，物料名称自动带出。」
     * 这条把那次决定钉住：改回弹窗、或者把两个物料框换回普通输入框（"实时搜索 + 互相带出"就没了），
     * 都要在这里红一次，而不是等使用方再报一遍。
     */
    expect(
      PURCHASE_PANEL.includes('<el-dialog'),
      '采购面板又出现了 el-dialog：使用方明确要求 PC 端不要卡片式弹窗，改成表格第一行直接填、某行原地编辑。',
    ).toBe(false)

    // 变更-117：字段表驱动渲染，物料名称与物料编码**共用同一个 el-autocomplete**
    // （由 `field.kind` 决定谁出现）。上一版两行各写一遍才是 2 个、加上新增行是 4 个 ——
    // 数量变少不是功能缩水，恰恰是"只留一份实现"。
    expect(
      (PURCHASE_UI.match(/<el-autocomplete/g) || []).length,
      '物料名称/物料编码必须是 el-autocomplete 远程检索（普通输入框就没有「实时搜索 + 互相带出」了）',
    ).toBe(1)
    expect(
      PURCHASE_UI.includes('fetchMaterialSuggestions'),
      '两个物料框没有接上防抖远程检索（useMaterialLookup 的 fetchMaterialSuggestions）',
    ).toBe(true)

    // 字段表只留一份（fields.js），抽屉按 DRAWER_GROUPS 分组渲染
    expect(
      PURCHASE_UI.includes('DRAWER_GROUPS'),
      '抽屉没有按语义分组渲染（15 个字段平铺在一列里，人会找不到到货日期）',
    ).toBe(true)
  })

  it('送货单是图片，不是文本框（变更-094）', () => {
    /*
     * 使用方原话：「送货单是一张图片」。这条钉住三件事，任何一件被"简化"掉都会红：
     *   · 可编辑格里必须是上传控件（回到文本框就白改了）；
     *   · 只读行要判断形态（`/files/…` 才当图，文本照文本显示 —— 这一列原本是送货单号文本，
     *     老数据不能当坏数据）；
     *   · 上传走本服务的转发端点（file-service 不对外、那边也没有鉴权注解）。
     */
    expect(
      PURCHASE_UI.includes('DeliveryNoteUpload'),
      '送货单又变回文本框了：使用方明确说「送货单是一张图片」（变更-117 后上传控件在抽屉里）。',
    ).toBe(true)
    expect(
      PURCHASE_UI.includes('isStoredImage'),
      '只读行没有按形态取图（/files/… 才算图片，文本老数据要照原样显示）。',
    ).toBe(true)
    expect(
      PURCHASE_DATA.includes('/api/purchase/upload-delivery-note'),
      '送货单上传没有走本服务的转发端点（前端不许直连 file-service）。',
    ).toBe(true)
  })

  it('媒体尺寸通用规则（变更-089）：不许用宽度定高度', () => {
    /*
     * 病史：体积计算页的画布写着 `w-full` + `maxWidth` + `aspectRatio` ——
     * **宽度一被拉满，高度就只能由长宽比推出来、没人管它多高**。立式罐（3600×4800，
     * 比例 0.75）于是 680 / 0.75 ≈ **907px**，把整页顶出滚动条。使用方 2026-10-16
     * 圈着右边那条滑块问的正是它：「这个页面也出现了滑块，是因为图片太大了」。
     *
     * 通用配方（DESIGN.md §7）：`h-auto w-auto max-w-full` + `max-width` + **`max-height`**；
     * 浏览器在这两个上限里解出"保持长宽比的最大一档"，所以竖长图被高度收住、
     * 宽扁图被宽度收住，且**元素矩形 == 实际绘制区**（没有留白，坐标换算不会偏）。
     *
     * 这条守的是**形态**，不是某一张图：往后照片、图纸、票据大图、长截图都会踩同一个坑，
     * 所以写成全仓扫描 —— 凡是同一元素上出现 `aspectRatio` 却没有 `maxHeight`、
     * 或同时带 `w-full`，直接红。
     */
    const offenders = []
    let scanned = 0
    for (const file of SOURCE_FILES) {
      const src = stripComments(read(file))
      for (const m of src.matchAll(/<([a-zA-Z][\w-]*)([^>]*?)style="([^"]*aspectRatio[^"]*)"/g)) {
        const [, tag, attrs, styleBody] = m
        scanned += 1
        const line = src.slice(0, m.index).split(/\r?\n/).length
        if (!/maxHeight/.test(styleBody)) {
          offenders.push(`${rel(file)}:${line} <${tag}> 用了 aspectRatio 却没有 maxHeight`)
        }
        for (const c of attrs.matchAll(/:?class="([^"]*)"/g)) {
          if (/(^|\s)w-full(\s|$)/.test(c[1])) {
            offenders.push(
              `${rel(file)}:${line} <${tag}> 同时用了 w-full 与 aspectRatio（宽度定死 ⇒ 高度没人管）`,
            )
          }
        }
      }
    }

    expect(
      scanned,
      '一条带 aspectRatio 的媒体都没扫到 —— 锚点失效了（写法变了？），先在这里红，' +
        '否则这条守卫会静默变成"永远通过"。',
    ).toBeGreaterThan(0)

    expect(
      offenders,
      '媒体尺寸回流了：宽度一旦写死（w-full / 只给 maxWidth），高度就只能由长宽比长出来，' +
        '竖长图会把整页顶出滚动条。通用配方（`h-auto w-auto max-w-full` + max-width + ' +
        'max-height，见 DESIGN.md §7）不是只给这一张图用的。',
    ).toEqual([])
  })

  it('滚动时间线（glass-scroll / --main-scroll）整组退场 —— 零残留', () => {
    /*
     * ⚠️ **这一条替换掉了 043 版的「滚动时间线的来源跟着滚动容器走」**，不是漏删的
     * 旧账：那一版自己写着「删标记是另一个决定 —— 那时连同本组一起删，别只删一半」，
     * 这一条就是那个决定（变更-056）。
     *
     * 病史一句话：`--main-scroll` 是 042 折射层的时间线（声明与消费都在已删除的
     * glass-effects.css 里），它必须挂在「当时真正在滚的那个元素」上 —— 挂在不动的
     * 元素上，三块玻璃的边缘高光会冻在贴顶那一格，不报错、只是不跟手。玻璃整组退场
     * 之后它没有消费者，于是标记类、`INNER_SCROLL_TABS` 名单、`scrollsInsideCard`
     * 推导、以及专为它存在的 `:active` prop 一并删除。
     *
     * 这里钉**零残留**而不是钉「挂在哪」：挂在哪已经不是契约（时间线不存在了），
     * 而残留会让下一个人以为它还有用。剥注释之后扫 —— 本仓的注释文化会继续提到这些
     * 名字（记录它们为什么走），那是记录不是用法。
     */
    for (const token of [
      'glass-scroll',
      'INNER_SCROLL_TABS',
      'scrollsInsideCard',
      '--main-scroll',
    ]) {
      const offenders = SOURCE_FILES.filter((file) => stripComments(read(file)).includes(token)).map(
        rel,
      )
      expect(
        offenders,
        `「${token}」在 src 里还有用法 —— 时间线随玻璃退场后它没有任何消费者，` +
          '残留只会让下一个人以为它还有用（注释里的记账不算：本行断言已剥注释）。',
      ).toEqual([])
    }

    // `:active` 这个 prop 也是为那条时间线而生的：面板现在不收任何 prop
    // （数据走模块级单例，见 TankLevelPanel 头部注释）
    expect(
      read(join(SRC, 'components', 'TankLevelPanel.vue')),
      'TankLevelPanel 又收 prop 了 —— 变更-056 之后它只靠模块级单例取数',
    ).not.toMatch(/defineProps\s*\(/)
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
// 17. 042 的边缘光学与真折射样张 —— 整组退场（x-minimalist）
// ---------------------------------------------------------------------------
describe('042 的边缘光学与真折射样张：整组退场（x-minimalist）', () => {
  /*
   * 042 是 WWDC25 物料描述里被 041 明确推迟（并写进「不做」清单）的两件事：
   * **边缘色散** 与 **真实透镜折射**。(A) 落在 panel token 的四笔色散线上，
   * (B) 落在 /intro Hero 图上那块「演示玻璃」。
   *
   * x-minimalist 把整条链**整份删除** —— 不是"压平"，是这条链上的五样东西一起没了：
   *
   *   ① panel token 里的四笔边缘色散线（顶/左冷 rgb(150,190,255)、
   *      底/右暖 rgb(255,180,175)）与三笔玻璃光学（外投影 + 顶白镜面 + 底深厚度）；
   *   ② Intro.vue Hero 图上那块演示玻璃的 DOM 叠层；
   *   ③ SVG 滤镜链（id="lg-refract" + 三条 feDisplacementMap + feColorMatrix
   *      + feBlend，连着 6 条"不报错、只是没效果"的硬规矩）；
   *   ④ 位移贴图资产 src/assets/landing/lg-map.png（连 `?inline` 导入）；
   *   ⑤ 玻璃时代为它写的三条降级路径（级联降级 / `@supports not (backdrop-filter…)`
   *      / `prefers-reduced-transparency`）。
   *
   * 删它的理由**不是兼容性**（042 那套 Chromium-only 的账本身是成立的），
   * 是这一代的设计立场：minimalist 把 glassmorphism 与"装饰性填充"写进反模式
   * 清单，而那块样张是 aria-hidden、无交互、只为展示光学的**纯装饰**；
   * 「真实图片，不做假 UI」这条 037 就立过的规矩，删掉它之后反而更完整。
   *
   * 所以这一组不再钉"滤镜的六个坑与 scale 链 28/32/36"（那些属性已经不存在），
   * 改钉**退场本身**：整条链的每一个名字在全仓都不许留下**用法**。
   *
   * ⚠️ 扫描一律先过 `stripComments`：Intro.vue 的 `<script>` 块注释与
   *    minimal-field.css 的块注释里**故意**留着 `lg-map.png` / `backdrop-filter` /
   *    `glass-*` 这些字样作为"删了什么"的记账 —— 那是**记录不是用法**
   *    （规矩见文件头的 stripComments 段；这一轮差点因为按原文扫而误红）。
   */
  const INTRO = read(join(SRC, 'views', 'Intro.vue'))
  const RETIRED = [
    'backdrop-filter',
    '-webkit-backdrop-filter',
    'url(#lg-refract)',
    'feDisplacementMap',
    'feImage',
    'feColorMatrix',
    'feBlend',
    'backdrop-blur',
    'backdrop-saturate',
  ]

  it('折射链的九个名字在全仓（src）都不留用法 —— 剥注释之后扫', () => {
    const offenders = []
    for (const file of SOURCE_FILES) {
      stripComments(read(file))
        .split(/\r?\n/)
        .forEach((line, index) => {
          for (const word of RETIRED) {
            if (line.includes(word)) offenders.push(`${rel(file)}:${index + 1} ${word}`)
          }
        })
    }
    /*
     * 2026-10-21 使用方明确要求「图片预览做成毛玻璃」，所以**看图器那一个文件**豁免
     * backdrop-filter / -webkit-backdrop-filter 这两个名字（只这两个，其余七个照旧全仓禁）。
     * 豁免写死成文件名前缀，别的文件沾到一律红 —— 这条口子只留给看图器。
     * 见 src/components/ImageGalleryDialog.vue 与 style.css 里 .image-preview-dialog--glass 的注释。
     */
    const GLASS_ALLOWED_FILE = 'src/styles/image-viewer-glass.css:'
    const GLASS_ALLOWED_WORDS = new Set(['backdrop-filter', '-webkit-backdrop-filter'])
    const offendersWithoutGlassViewer = offenders.filter(
      (entry) =>
        !(entry.startsWith(GLASS_ALLOWED_FILE) && GLASS_ALLOWED_WORDS.has(entry.split(' ').pop())),
    )
    expect(
      offendersWithoutGlassViewer,
      '042 的折射/玻璃链回流了。这九个名字（backdrop-filter / -webkit-backdrop-filter / ' +
        'url(#lg-refract) / feDisplacementMap / feImage / feColorMatrix / feBlend / ' +
        'backdrop-blur / backdrop-saturate）在这条链上是**载荷**：任何一个回来，' +
        '都说明有人把 042 的代码块粘回去了。三块面板是不透明的，' +
        '没有背后的东西可以糊、也没有玻璃边可以镶色散。',
    ).toEqual([])
  })

  it('.minimal-figure 这个类名在 src 里零出现 —— 防样张以另一种形式回流', () => {
    /*
     * CSS 规则与 markup 两处都不许有：它是当年那块玻璃样张的挂点。
     * 工程图现在是**一张普通的真实截图**（下一条钉着），不需要一个语义为
     * "装饰性玻璃样张"的类名 —— 挂上去就是假命名（名字说的是它**曾经是什么**，
     * 而不是它现在长什么样）。
     */
    expect(
      scan(/minimal-figure/),
      'minimal-figure 回流了 —— 那是"那块玻璃样张"的挂点，它的规则与用法这一轮' +
        '已整份删除（删除理由登记在 DESIGN.md §5.3）',
    ).toEqual([])
  })

  it('资产不在：lg-map.png 已删除，且 src 里没有它的代码引用', () => {
    /*
     * 位移贴图是折射链的**载荷**：删链不删图，等于留了一个"随时可以接回来"的口子。
     * 引用侧同样扫：`import lgMap from '…lg-map.png?inline'` 这类代码一旦回来，
     * 图片本体也必须跟着回来 —— 两条一起钉才闭环。
     */
    expect(
      existsSync(join(SRC, 'assets', 'landing', 'lg-map.png')),
      'src/assets/landing/lg-map.png 还在 —— 位移贴图是 042 折射链的载荷，' +
        '删链不删图等于留了个口子',
    ).toBe(false)
    const offenders = []
    for (const file of SOURCE_FILES) {
      stripComments(read(file))
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/lg[-_]?map/i.test(line)) offenders.push(`${rel(file)}:${index + 1}`)
        })
    }
    expect(offenders, 'src 里还有 lg-map / lgMap 的代码引用（注释里记账不算）').toEqual([])
  })

  it('一张真实截图仍然在：vesselCanvas 那张图带 1px 发丝线与卡片圆角', () => {
    /*
     * 删掉装饰不等于删掉内容。Hero 上那张工程图是**抓的真实界面截图**
     * （`vesselCanvas`，150 产品罐 / 液位 1250mm），alt 也在 ——
     * 而且它现在是一条普通 img：`rounded-card` + `border-line`，
     * 与全站其余面同一种分层方式（不再是"拿 CSS 光学在真实截图上做表演"）。
     * 这条是「删掉了装饰、没删掉内容」的证据，别在清理时把它一起删了。
     */
    const img = [...INTRO.matchAll(/<img\b[\s\S]*?>/g)]
      .map((m) => m[0])
      .find((t) => /vesselCanvas/.test(t))
    expect(
      img,
      'Intro.vue 里找不到 :src="vesselCanvas" 的那张图 —— 删装饰时把内容也删了？',
    ).toBeTruthy()
    expect(img, '那张图丢了 1px 发丝线（border-line）').toMatch(/border-line/)
    expect(img, '那张图丢了卡片圆角（rounded-card）').toMatch(/rounded-card/)
    expect(img, '那张图没有 alt —— 它是内容，不是装饰').toMatch(/alt="/)
  })

  it('阴影回到「几乎不存在」：boxShadow 只剩 card / panel 两键、各恰好一段、α ≤ 0.05 且中性', () => {
    /*
     * 042 的色散线是**镶在 panel token 里的**（七段 box-shadow，顺序即载荷：
     * CSS Backgrounds 3「the first shadow is on top」）。那一整组现在没了，
     * 取而代之的是 minimalist 的高程条：阴影"几乎不存在"，真要用也只允许
     * 「超大扩散、α < 0.05」那一档。
     *
     * 这条钉四件事：
     *   ① boxShadow 的 key 集合不变（`card` / `panel`：x-minimalist 是就地改值，
     *      没有新开 token —— 新 token 的第一风险是撞颜色名，见 §14）；
     *   ② 每个 token **恰好一段** —— 七段那个"边缘光学"结构不许回来；
     *   ③ α ≤ 0.05 且为正（0.04 / 0.03 是定稿值：再深一点白纸上就看得见"脏"）；
     *   ④ 颜色是**中性黑**（R=G=B=0）—— 043 的底深线还带一点冷调（24,24,30），
     *      这一代连那点色偏都不要（白纸上任何色偏都会显脏）。
     */
    const ext = tailwindConfig.theme?.extend?.boxShadow ?? {}
    expect(
      Object.keys(ext).sort(),
      'boxShadow 的 key 集合变了 —— 042 的四笔色散线只许加进 panel、不许新开 token；' +
        'x-minimalist 只改值，key 不动',
    ).toEqual(['card', 'panel'])

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
    expect(splitTop('a(b,c),d'), '切分器坏了：rgba(…) 里的逗号被当成了段界').toEqual([
      'a(b,c)',
      'd',
    ])

    for (const [key, value] of Object.entries(ext)) {
      const segs = splitTop(value)
      expect(
        segs,
        `${key} 不是恰好一段（实为 ${segs.length} 段）—— 七段结构是 042 的边缘光学，` +
          '它随玻璃整组退役',
      ).toHaveLength(1)
      const rgba = (segs[0].match(/rgba?\(([^)]*)\)/) || [])[1]
      expect(rgba, `${key} 的投影颜色没解析出来`).toBeTruthy()
      const [r, g, b, a] = rgba.split(',').map((n) => Number(n.trim()))
      expect(
        a,
        `${key} 的 α=${a} 超过 0.05 —— minimalist 的阴影"几乎不存在"（定稿 0.04 / 0.03）`,
      ).toBeLessThanOrEqual(0.05)
      expect(a, `${key} 的 α=${a} 不为正 —— 那就是没有投影，请直接删掉这个 token`).toBeGreaterThan(
        0,
      )
      expect(
        [r, g, b],
        `${key} 的投影不是中性黑（${r},${g},${b}）—— 白纸上任何色偏都会显脏`,
      ).toEqual([0, 0, 0])
    }
  })

  it('边缘色散与底深线的字面量不许回流（150,190,255 / 255,180,175 / 24,24,30）', () => {
    /*
     * 那四笔只写在 tailwind.config.js 里（不在 src 的扫描范围内），
     * 所以它们由上面那条的「单段 + α ≤ 0.05 + 中性黑」间接管着；
     * 这一条管的是**有人把颜色抄进 src**：theme.css 的 EP 变量、组件 scoped 块、
     * 内联 style 都是常见落点。
     */
    const DISPERSION =
      /rgba?\(\s*(150[\s,]+190[\s,]+255|255[\s,]+180[\s,]+175|24[\s,]+24[\s,]+30)\s*[,)]/i
    const offenders = []
    for (const file of SOURCE_FILES) {
      stripComments(read(file))
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (DISPERSION.test(line)) offenders.push(`${rel(file)}:${index + 1}`)
        })
    }
    expect(
      offenders,
      '042 的边缘色散/底深线颜色出现在 src 里了。那几笔是"玻璃厚度"的光学，' +
        '白纸面上没有玻璃可镶边 —— 它们随整组退役（值仍在 git 历史里）。',
    ).toEqual([])
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

  /**
   * 取一个函数体：从 `function xxx` 到它**自己那一级**的收尾 `}`。
   *
   * ⚠️ 不能写死 `indexOf('\n}')`：2026-10 路由化改造把这段脚本搬进了
   * `composables/useVesselCanvas.js`，函数整体缩进了一级、收尾大括号成了 `'  }'`。
   * 写死"列 0"的切法会一直切到文件末尾，把后面的 `animateVesselTo` 也卷进来，
   * 于是「拖动路径不得缓动」这条断言的失败原因就变成了假阳性。
   * 这里按函数自身的缩进找收尾 —— 判据没放松，只是不再假设它写在第 0 列。
   */
  const functionBody = (name) => {
    const at = SRC_TEXT.indexOf(`function ${name}`)
    if (at < 0) return ''
    const lineStart = SRC_TEXT.lastIndexOf('\n', at) + 1
    const indent = SRC_TEXT.slice(lineStart, at)
    return SRC_TEXT.slice(at, SRC_TEXT.indexOf(`\n${indent}}`, at))
  }

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
    expect(at, 'setVesselLevelPair 不见了 —— 拖动路径的映射入口').toBeGreaterThan(-1)
    const body = functionBody('setVesselLevelPair')
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
    const immBody = functionBody('setVesselLevelImmediate')
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
    // 变更-058 起是 **4 处**：原来的三个用点（画布剖面线 + 画布引线标注 + 滑块钮间色带）
    // 之外多了**一处派生** —— VESSEL_DELTA_FILL 用它算出差值带底色的低透明度版，
    // 于是"带"与"线"必然同色相（此前是两份手写字面量，只是肉眼看着像而已）。
    expect(
      SRC_TEXT.split('VESSEL_DELTA_COLOR.consume').length - 1,
      '常量的消耗色用点不是 4 处（3 个用点 + 1 处差值带底色派生）',
    ).toBe(4)
    expect(
      SRC_TEXT.split('VESSEL_DELTA_COLOR.increase').length - 1,
      '常量的增加色用点不是 4 处（3 个用点 + 1 处差值带底色派生）',
    ).toBe(4)

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

  it('竖轨的 minimalist 配方：垫底凹槽 + 发丝环、盖掉 EP 竖版方角、钮座对中量校正、分钮环色走 border', () => {
    expect(SRC_TEXT).toContain('.vessel-level-slider :deep(.el-slider__runway)')
    /*
     * 变更-058：凹槽从「软拟态两笔方向性内阴影」换成「垫底 + 1px 发丝环」。
     * 要守的**凹凸关系没变**（一颗钮推着凹槽走），变的是它的成立方式：
     * 槽靠"比纸深半档"（`--el-fill-color` = region）加一圈发丝线读出来，不靠 inset 光影 ——
     * minimalist 的高程不来自光影（见 DESIGN.md §4.2，那条例外就是为这次决定而记的）。
     * 三条一起钉：① 底色挂 token；② 发丝环走 inset 扩散环（不动几何）；③ 旧材质整组禁入。
     */
    expect(
      SRC_TEXT,
      '轨道凹槽的底色不再挂 token —— 它必须与全站垫底同一档（--el-fill-color = region）',
    ).toContain('background-color: var(--el-fill-color)')
    expect(
      SRC_TEXT,
      '凹槽的发丝环没了 —— inset 扩散环是「不动几何」的描边写法（真 border 会让钮座偏心 1px）',
    ).toContain('box-shadow: inset 0 0 0 1px #eaeaea')
    for (const [needle, why] of [
      ['inset 2px 2px 5px rgba(90, 110, 150, 0.32)', '凹槽的冷投影'],
      ['rgba(90, 110, 150', '软拟态的冷调投影（凹槽 + 钮两处）'],
      ['linear-gradient(145deg', '圆钮的浮面渐变'],
      ['inset 0 1px 2px rgba(0, 0, 0, 0.14)', '色带的压暗'],
      ['#eeeef1', '输入框的 043 字面量'],
      ['#e8e8e9', '输入框/钮座的 043 字面量'],
    ]) {
      expect(
        SRC_TEXT,
        `${why}回流了 —— 变更-058 已把软拟态材质整组换成「垫底 + 发丝线 + 语义环」`,
      ).not.toContain(needle)
    }
    expect(
      SRC_TEXT,
      '钮座对中量没校正 —— EP 出厂按（6−36）/2 = −15px 写死，我们的轨厚 10 / 钮座 30 需要' +
        '（10−30）/2 = −10px，写错则钮在轨道上偏心 5px',
    ).toContain('--el-slider-button-wrapper-offset: -10px')
    expect(
      SRC_TEXT,
      '竖版 bar 没盖掉 EP `.is-vertical` 的 `0 0 3px 3px` 方角 —— 凹槽会缺一个圆头',
    ).toMatch(
      /\.vessel-level-slider :deep\(\.el-slider__bar\)\s*\{[\s\S]{0,140}border-radius: 9999px/,
    )
    expect(
      SRC_TEXT,
      '圆钮不是平的白面了 —— 它的辨识只许靠「2px 语义环 + 白面」，不许再叠渐变/投影',
    ).toContain('background-color: #ffffff')
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
      /\.vessel-level-slider :deep\(\.el-slider__bar\)[\s\S]{0,140}transition: none/,
    )
    /*
     * 2026-10-18 换主色（#111111 石墨 → #1E40AF 品牌蓝）之后，这条不能再钉死字面量：
     * 它真正要守的是「EP 默认聚焦环被覆写后，我们必须显式补回一圈」，而圈的颜色
     * 应当跟随主色 token。改成从 tailwind 的 brand 取值再比对 —— 比钉死更严：
     * 以后谁把 outline 换成别的深色，这里照样会红。
     */
    const brandRing = (tokenHex('brand-ink') || '').toLowerCase()
    expect(brandRing, 'tailwind.config.js 里没有 colors.brand-ink').toBeTruthy()
    expect(
      SRC_TEXT.toLowerCase(),
      '滑块的键盘聚焦环没了 —— EP 默认环被覆写后必须显式补一圈主色 outline',
    ).toContain(`outline: 2px solid ${brandRing}`)
    // 输入框的悬停/聚焦也换成「三档垫底 + 发丝环」，且挂 token
    expect(SRC_TEXT, '输入框悬停底没挂 token（-lighter 一档浮起）').toContain(
      'background-color: var(--el-fill-color-lighter)',
    )
    expect(SRC_TEXT, '输入框聚焦底没挂 token（fill = region 一档落下）').toContain(
      'background-color: var(--el-fill-color)',
    )
  })

  it('图表（差值带）与画布字体：语义色单一来源、字族与 :root 同源', () => {
    /*
     * 两件 x-minimalist（变更-058）收敛掉的"同一个事实写了两份"：
     *   ① 差值带底色原是手写 rose-500 / emerald-500 的 rgba，而线用的是
     *      rose-600 / emerald-600 —— 带与线**不是同一只色**，只是肉眼看着差不多。
     *      现在必须由 VESSEL_DELTA_COLOR 派生（withAlpha），同色相成为结构保证。
     *   ② 画布字族原是一条自带 system-ui 的字符串，与 src/style.css 的 :root 栈不是
     *      同一份 —— 页面上与图上同一串数字会落在两套字形里（tabular-nums 还在，
     *      但字形不同）。这条断言就是那份"同源"约束。
     */
    expect(SRC_TEXT, '差值带的底色不再由语义色派生（withAlpha 没了）').toContain(
      'const withAlpha = (hex, alpha)',
    )
    expect(SRC_TEXT, '差值带的底色没走派生常量').toContain(
      'consume: withAlpha(VESSEL_DELTA_COLOR.consume, 0.1)',
    )
    for (const raw of ['rgba(244, 63, 94', 'rgba(16, 185, 129']) {
      expect(
        SRC_TEXT,
        `${raw} 回流了 —— 差值带底色必须由 VESSEL_DELTA_COLOR 派生，不许再各写一份字面量`,
      ).not.toContain(raw)
    }

    const cssFont = (read(join(SRC, 'style.css')).match(/font-family:\s*([^;]+);/) || [])[1] ?? ''
    expect(cssFont, 'style.css 的 :root 里没解析到 font-family').toBeTruthy()
    const firstFamily = cssFont.match(/"([^"]+)"/)?.[1] ?? cssFont.trim().split(',')[0].trim()
    expect(
      SRC_TEXT,
      `画布字族与 :root 不同源 —— 页面上与图上同一串数字会落在两套字形里（:root 第一族 = ${firstFamily}）`,
    ).toContain(firstFamily)
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

/**
 * §19 边打边查（变更-059）
 *
 * 「触发时机」是一条容易被人改回去的契约：服务端查询 + 逐字发请求 = 打接口，所以它
 * 曾被定成「只能回车」（043）。这一代换成**防抖 + 去重 + 过期响应护栏**三层 ——
 * 「回车才查」这条结论作废了，但它的**理由**（别逐字打接口）必须继续成立，
 * 所以下面钉的是那三层机制本身，而不是"还有没有回车"。
 */
describe('物料查询边打边查（变更-059）：防抖 + 去重 + 过期响应护栏', () => {
  const WORKBENCH_SRC = read(join(SRC, 'views', 'materials', 'StockView.vue'))
  const DEBOUNCE_SRC = read(join(SRC, 'utils', 'debounce.js'))

  it('节流器的三个动作都在：延迟执行 / flush 立刻执行 / cancel 撤销', () => {
    expect(DEBOUNCE_SRC, 'debounce 工具没了').toContain('export function debounce')
    expect(DEBOUNCE_SRC, 'flush 没了 —— 回车与清空就没法「立刻查」').toContain('wrapped.flush = ')
    expect(DEBOUNCE_SRC, 'cancel 没了 —— 卸载后待发的那次会写进已销毁的组件').toContain(
      'wrapped.cancel = ',
    )
  })

  it('输入框接的是公共接线：既不逐字直发，也不再「只能回车」', () => {
    expect(WORKBENCH_SRC, '关键词变化没有接到公共接线').toContain(
      'const { flush: flushStockFilter } = useLiveQuery(stockKeyword, applyStockFilter',
    )
    expect(WORKBENCH_SRC, '回车没走「显式立刻查」').toContain('@keyup.enter="flushStockFilter"')
    expect(WORKBENCH_SRC, '清空没走立刻查（清空要把结果还原回来）').toContain(
      '@clear="flushStockFilter"',
    )
    // 标签级断言：关键词输入框这个 <el-input> 标签里不得出现 @input（换任何函数名都拦得住）
    expect(
      inputTagWith(WORKBENCH_SRC, 'v-model="stockKeyword"'),
      '输入框上还挂着逐字直发 —— 那是敲一个字打一次接口',
    ).not.toContain('@input')
  })

  /*
   * ⚠️ 机制（防抖 / 签名去重 / 过期响应护栏）的断言**不在这里**（变更-066）。
   *
   * 这一节原先用 `toContain('if (current === lastKey) return')`、
   * `toContain('if (seq !== stockRequestSeq) return')` 这类**源码字符串镜像**钉机制，
   * 而它们抓不到任何东西：那句护栏在文件里出现 2 次（try 与 catch 各一条），
   * `toContain` 分不清 2 与 1 —— 删掉 catch 那条、断言照样绿，而过期请求的失败
   * 就会覆盖新结果（正是那条断言名字宣称防住的那一刻）。
   *
   * 现在改为行为测试（已做变异检验：拆掉护栏就会红）：
   *   · tests/unit/useLiveQuery.spec.js        —— 防抖 / 去重 / flush / cancel / 卸载 / 签名维度 / sync
   *   · tests/unit/liveQueryStaleGuard.spec.js —— 三个数据层的过期响应护栏（deferred 让"先发后回"成为确定事实）
   * 本节只留"接线是否真的接上了"这一类只能从源码看的东西。
   */

  it('遮罩只盖首屏：已经有行时改在计数处提示，避免打字时结果反复消失又出现', () => {
    expect(WORKBENCH_SRC, '遮罩又变成只看 loading 了（打字时整块结果会闪）').toContain(
      '<LoadingMask v-if="stockLoading && !stockTableData.length" />',
    )
    expect(WORKBENCH_SRC, '细化阶段的信号没了').toContain('stockRefining')
    expect(WORKBENCH_SRC, '细化提示没落在计数那一行').toContain('查询中…')
  })
})

/**
 * §20 另外三个查询框统一到同一套接线（变更-060）
 *
 * 变更-059 先在物料查询上落了「防抖 + 去重 + 过期响应护栏」。当时另外三处各写各的：
 * 储罐液位与设备台账是「回车才查」，图片解析是手写的 `setTimeout` + 300ms 静默期
 * （与别处的 250ms 都不一致）。这一代收成同一份 `useLiveQuery` ——
 * 同一件事四份实现必然漂移，而"看起来像"与"真的同源"是两回事。
 */
describe('四个查询框共用一套边打边查接线（变更-060）', () => {
  const TANK_PANEL = read(join(SRC, 'components', 'TankLevelPanel.vue'))
  const LEDGER_PANEL = read(join(SRC, 'components', 'EquipmentMaintenancePanel.vue'))
  const OCR = read(join(SRC, 'views', 'ImageParse.vue'))

  it('四个框都接同一个接线（不许再出现第二套实现）', () => {
    // 用正则而不是整行字面量：换行与缩进不该让断言失效（曾经就因为把调用拆成多行而误红）
    expect(TANK_PANEL, '储罐液位没接公共接线').toMatch(
      /useLiveQuery\(\s*tankLevelKeyword,\s*reloadTankLevelRecords/,
    )
    expect(LEDGER_PANEL, '设备台账没接公共接线').toMatch(
      /useLiveQuery\(\s*keyword,\s*applyLedgerFilters/,
    )
    expect(OCR, '图片解析没接公共接线').toContain('flush: flushPickerSearch')
    // 手写的那套（含它留下的清理点）必须消失
    expect(OCR, '图片解析又出现手写的防抖计时器 —— 同一件事有两份实现').not.toContain(
      'pickerSearchTimer',
    )
  })

  it('回车 / 清空 / 「查询」按钮都走「立刻查」（先取消待发的那次）', () => {
    expect(TANK_PANEL, '储罐液位回车没走 flush').toContain('@keyup.enter="flushTankLevelQuery"')
    expect(
      TANK_PANEL,
      '储罐液位的「查询」按钮没走 flush —— 打完字马上点会变成两次请求',
    ).toContain('@click="flushTankLevelQuery"')
    expect(LEDGER_PANEL, '台账回车没走 flush').toContain('@keyup.enter="flushLedgerQuery"')
    expect(OCR, '选料回车没走 flush').toContain('@keyup.enter="flushPickerSearch"')
  })

  it('不许再出现「逐字直发」：关键词输入框的标签里不得出现 @input（与函数名无关）', () => {
    for (const [name, text, marker] of [
      ['储罐液位', TANK_PANEL, 'v-model="tankLevelKeyword"'],
      ['设备台账', LEDGER_PANEL, 'v-model="keyword"'],
      ['图片解析', OCR, 'v-model="pickerKeyword"'],
    ]) {
      const tag = inputTagWith(text, marker)
      expect(tag, `${name} 的关键词输入框标签没找到（选择器写错了？）`).not.toBe('')
      expect(tag, `${name} 的输入框又挂上了 @input 直发查询`).not.toContain('@input')
    }
  })

  /*
   * ⚠️ 这两处过期响应护栏的**机制**断言已移到 tests/unit/liveQueryStaleGuard.spec.js（变更-066）：
   * 原先是 `toContain('if (seq !== tankLevelRequestSeq) return')` 这类源码字符串镜像，
   * 而同样的句子在文件里出现两次（数据路径与 catch 路径各一条），toContain 分不清 2 与 1 ——
   * 删掉 catch 那条、断言照样绿。那里改成用 deferred 让"先发的请求后回来"成为确定事实，
   * 逐条断言数据 / 错误 / loading 三个通道都不被旧响应写。
   */

  it('遮罩只盖首屏 + 细化阶段有「查询中…」提示（两个面板都补齐，与物料同一套规矩）', () => {
    expect(TANK_PANEL, '储罐液位的遮罩又变成只看 loading 了').toContain(
      '<LoadingMask v-if="tankLevelLoading && !tankLevelTableData.length" />',
    )
    expect(TANK_PANEL, '储罐液位细化阶段没有「在查」的信号').toContain('tankLevelRefining')
    expect(TANK_PANEL, '储罐液位的提示没落在计数那一行').toContain('查询中…')

    expect(LEDGER_PANEL, '台账细化阶段没有「在查」的信号').toContain('ledgerRefining')
    expect(LEDGER_PANEL, '台账的提示没落在计数那一行').toContain('查询中…')

    expect(OCR, '选料弹窗细化阶段没有「在查」的信号').toContain('pickerLoading')
    expect(OCR, '选料弹窗的细化提示没落在候选列表里').toContain('查询中…')
  })

  it('vite 忽略原子写的临时目录（否则改一行代码就把 dev server 打死）', () => {
    const viteConfig = read(join(ROOT, 'vite.config.js'))
    expect(
      viteConfig,
      'vite 的 watch.ignored 没了 —— 编辑器用原子写落盘会 EBUSY 打死 dev server（已实测）',
    ).toContain("'**/.*.tmpdir/**'")
  })
})


/* ============================================================================
 * 变更-124：动效与表格的"禁令"（这一节只拦人，不描述现状）
 * ============================================================================
 *
 * 这几条都是**踩过之后的结论**，写进守卫是因为你和我都会忘：
 *   · 全站渐变背景 —— 廉价感的头号来源（minimal-field 那道径向光是唯一例外，它是"纸"的质感）
 *   · 表格行入场/重排动画 —— 一天几十次的翻页动作，逐行动画 = 自找疲劳
 *   · 滚动视差 / IntersectionObserver 驱动的动画 —— 内网台账不需要叙事
 *   · 交互态过渡 > 300ms —— 超过这个数，hover 会像"卡了一下"
 *   · 行高 > 44px、斑马纹 alpha > 0.03 —— 密度与"抢戏"的上限
 */
describe('变更-124：动效与表格禁令', () => {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return /\.(vue|css|js)$/.test(entry.name) ? [full] : []
    })
  const SRC_FILES = walk(SRC)

  it('禁止全站渐变背景（minimal-field 的径向纸纹是唯一例外）', () => {
    const offenders = []
    for (const file of SRC_FILES) {
      const text = read(file)
      const at = relative(SRC, file)
      text.split('\n').forEach((line, index) => {
        // 只看"用法"，不看注释：注释里提到 gradient 是在解释为什么不用它
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
        if (/bg-gradient-to-/.test(line)) offenders.push(`${at}:${index + 1} bg-gradient-to-`)
        if (/linear-gradient\(/.test(line)) offenders.push(`${at}:${index + 1} linear-gradient(`)
        if (/background-image:\s*linear-gradient/.test(line)) {
          offenders.push(`${at}:${index + 1} background-image: linear-gradient`)
        }
      })
    }
    expect(
      offenders,
      '出现了渐变背景。台账的底色只允许"纯色 + 一道极淡的径向纸纹"（minimal-field）；' +
        '渐变是营销站的语言，放在这里会让每一页都像落地页。',
    ).toEqual([])
  })

  it('表格行不许有入场/重排动画', () => {
    const offenders = []
    for (const file of SRC_FILES) {
      const text = read(file)
      const at = relative(SRC, file)
      text.split('\n').forEach((line, index) => {
        if (!/^\s*<tr\b/.test(line)) return
        if (/animate-|animation:/.test(line)) offenders.push(`${at}:${index + 1}`)
      })
    }
    expect(
      offenders,
      '表格行上出现了动画。翻页/筛选是高频动作，逐行动画一天要看几十次 —— ' +
        '这一条是使用方体验的唯一硬保护，不要绕过它。',
    ).toEqual([])
  })

  it('禁止滚动视差与 IntersectionObserver 驱动的动画', () => {
    const offenders = []
    for (const file of SRC_FILES) {
      const text = read(file)
      const at = relative(SRC, file)
      if (/IntersectionObserver/.test(text)) offenders.push(`${at} IntersectionObserver`)
      text.split('\n').forEach((line, index) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return
        // scroll-behavior: smooth 允许（那是锚点跳转），但把 scroll 塞进 transform/animation 不行
        if (/(transform|animation)[^;\n]*scroll/i.test(line)) offenders.push(`${at}:${index + 1} 滚动动画`)
      })
    }
    expect(offenders, '台账不需要"叙事型"滚动动效：内网用户是来对账的，不是来看故事的。').toEqual([])
  })

  it('交互态过渡 ≤ 300ms（数据到达型动画不受此限）', () => {
    const offenders = []
    for (const file of SRC_FILES) {
      const text = read(file)
      const at = relative(SRC, file)

      // Tailwind 的 duration-* 一律按数值比，不按位数比（duration-150 也是三位数）
      for (const m of text.matchAll(/duration-(\d+)/g)) {
        if (Number(m[1]) > 300) offenders.push(`${at} duration-${m[1]}`)
      }

      /*
       * CSS 里的 transition：只拦"交互态"（hover/press/focus 那类）。
       *
       * 放行清单 = 一次性动作，不是交互态：
       *   · bar-fill / kpi / rise —— 数据到达时的条形与入场（600/240ms）
       *   · drawer              —— 抽屉开合，属于"偶尔操作"，200–500ms 是允许区间
       *   · vessel-canvas       —— 用户主动缩放画布，需要看清过程
       */
      for (const m of text.matchAll(/([^{}]{0,160})\{[^{}]*transition:[^{}]*?(\d+)ms/g)) {
        const selector = (m[1].split('\n').pop() || '').trim()
        if (/bar-fill|kpi-|rise|drawer|vessel-canvas/.test(selector)) continue
        if (Number(m[2]) > 300) offenders.push(`${at} transition ${m[2]}ms  ← ${selector.slice(0, 40)}`)
      }
    }
    expect(offenders, '交互态过渡超过 300ms 会让 hover 感觉"卡了一下"（emil 的时长表上限）。').toEqual([])
  })

  it('台账表格配方：行高 ≤44px、斑马纹 alpha ≤0.03', () => {
    const css = read(join(SRC, 'table.css'))
    const tdBlock = css.slice(css.indexOf('.ledger-table tbody td'), css.indexOf('}', css.indexOf('.ledger-table tbody td')))
    const height = Number((tdBlock.match(/height:\s*(\d+)px/) || [])[1])
    expect(height, '配方里读不到行高').toBeGreaterThan(0)
    expect(height, '行高超过 44px：1280×800 下每多 4px 就少看一行').toBeLessThanOrEqual(44)

    const zebra = css.slice(css.indexOf('nth-child(even)'), css.indexOf('}', css.indexOf('nth-child(even)')))
    const alpha = Number((zebra.match(/rgba\([^)]*?,\s*([\d.]+)\s*\)/) || [])[1])
    expect(alpha, '配方里读不到斑马纹透明度').toBeGreaterThan(0)
    expect(alpha, '斑马纹太深：会和 hover / 选中态抢注意力（上限 0.03）').toBeLessThanOrEqual(0.03)
  })
})
