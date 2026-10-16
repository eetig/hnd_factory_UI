/**
 * Element Plus 按需样式的护栏（变更-080）
 *
 * 背景：076 把 EP 的全量样式（dist/index.css，产物 352KB）换成按需引入，只引了 22 个
 * el-xxx.css。漏掉的是「日期选择器的弹出面板」—— EP 把它单独放在
 * el-date-picker-panel.css 里，而**输入框那截看起来毫无异常**，所以页面级截图
 * （当时还对比过像素完全一致）根本发现不了，直到用户在实际使用中打开日历。
 *
 * 这个 spec 把「有没有漏」变成可自动判定的问题：
 *   ① 从 src/main.js 抽出实际引入的 theme-chalk 文件清单（外加 src/theme.css 里的补丁）
 *   ② 算出这些文件覆盖到的 .el-xxx 类名
 *   ③ 反向检查 REQUIRED 里写的类名在**当前安装的 EP 版本**里真实存在
 *      （防手写错，也防 EP 升级把某个类搬到别的文件 —— 那正是 076 这类漏项的成因）
 *   ④ 按表检查「源码里用到的每个组件」所需的类名是否都被覆盖
 *   ⑤ 源码里出现、但表里没登记的组件 → 直接失败并提示怎么补
 *
 * 新增 EP 组件时：在 REQUIRED 里加一行（组件名 → 它必需的类名）。忘了加，
 * 第 ⑤ 条会拦下来；加了但样式没引，第 ④ 条会拦下来并打印缺哪些类名。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHALK_DIR = join(ROOT, 'node_modules', 'element-plus', 'theme-chalk')
const DIST_CSS = join(ROOT, 'node_modules', 'element-plus', 'dist', 'index.css')
const MAIN_JS = join(ROOT, 'src', 'main.js')
const THEME_CSS = join(ROOT, 'src', 'theme.css')

/**
 * 组件 → 它必须被覆盖的类名。
 * 键 = 源码里出现的形态（模板标签 `el-date-picker`，或具名导入 `ElDatePicker` 转成的
 * `el-date-picker`）。值为空数组表示该组件没有自有样式类。
 */
const REQUIRED = {
  'el-config-provider': [], // 只提供配置上下文，产物里没有自有类
  'el-button': ['el-button'],
  'el-input': ['el-input'],
  'el-select': ['el-select', 'el-select-dropdown'],
  'el-option': ['el-select-dropdown'], // 下拉面板的规则实际写在 el-option.css 里
  // 日期选择器是**两个文件**：这是 076 踩的坑，逐条钉住面板侧的类名
  'el-date-picker': [
    'el-date-picker',
    'el-picker-panel',
    'el-date-table',
    'el-date-table-cell',
    'el-month-table',
    'el-year-table',
    'el-date-editor',
    'el-time-panel',
  ],
  'el-tooltip': ['el-tooltip'], // 由 src/theme.css 补（EP 只在 el-table.css 里定义它）
  'el-dialog': ['el-dialog'],
  'el-message': ['el-message'],
  'el-message-box': ['el-message-box'],
  'el-loading': ['el-loading-mask'],
  'el-pagination': ['el-pagination'],
  'el-image': ['el-image', 'el-image-viewer'], // 预览大图是独立组件
  'el-checkbox': ['el-checkbox'],
  'el-autocomplete': ['el-autocomplete'],
  'el-slider': ['el-slider'],
}

/**
 * 源码里不出现、但被上面那些组件依赖的内部样式（弹层定位、滚动条、图标）。
 * 它们不进「用到就必须登记」的扫描，但必须被覆盖。
 */
const REQUIRED_INTERNAL = {
  'el-popper': ['el-popper'],
  'el-overlay': ['el-overlay'],
  'el-scrollbar': ['el-scrollbar'],
  'el-icon': ['el-icon'],
}

const classesIn = (files) => {
  const out = new Set()
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\.(el-[a-z0-9-]+)/g)) out.add(m[1])
  }
  return out
}

const walk = (dir) => {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(vue|js)$/.test(name)) out.push(p)
  }
  return out
}

// 注释里的 `<el-xxx` 不算用法，先剥掉注释再扫
const stripComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

const mainSrc = readFileSync(MAIN_JS, 'utf8')
const importedCss = [...mainSrc.matchAll(/element-plus\/theme-chalk\/([a-z0-9-]+\.css)/g)].map((m) =>
  join(CHALK_DIR, m[1]),
)

const covered = classesIn([...importedCss, THEME_CSS])
const existsInEp = classesIn([DIST_CSS])

// 扫描源码里用到的 EP 组件
const kebab = (pascal) =>
  'el-' + pascal.slice(2).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

const used = new Set()
for (const file of walk(join(ROOT, 'src'))) {
  const src = stripComments(readFileSync(file, 'utf8'))
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'element-plus'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim()
      if (/^El[A-Z]/.test(name)) used.add(kebab(name))
    }
  }
  for (const m of src.matchAll(/<(el-[a-z0-9-]+)/g)) used.add(m[1])
}

describe('Element Plus 按需样式覆盖（变更-080 护栏）', () => {
  it('前置条件：能读到 EP 的样式文件与 main.js 的导入清单', () => {
    expect(importedCss.length, 'main.js 里没找到 theme-chalk 导入').toBeGreaterThan(0)
    expect(existsInEp.size, '读不到 element-plus/dist/index.css').toBeGreaterThan(100)
  })

  it('① 源码里用到的 EP 组件都已在 REQUIRED 表里登记', () => {
    const unregistered = [...used].filter((u) => !(u in REQUIRED) && !(u in REQUIRED_INTERNAL))
    expect(
      unregistered,
      `这些组件在源码里用到了但没登记：${unregistered.join(', ')}。\n` +
        '请在 tests/unit/elementPlusStyles.spec.js 的 REQUIRED 里加上它们需要的类名，\n' +
        '并在 src/main.js 顶部补上对应的 el-xxx.css 导入（缺了会让组件裸奔）。',
    ).toEqual([])
  })

  it('② REQUIRED 里写的类名在当前 EP 版本里真实存在（防手写错 / 防 EP 搬家）', () => {
    const bad = []
    for (const [comp, classes] of Object.entries({ ...REQUIRED, ...REQUIRED_INTERNAL })) {
      for (const c of classes) if (!existsInEp.has(c)) bad.push(`${comp} → .${c}`)
    }
    expect(bad, `这些类名在 element-plus/dist/index.css 里不存在：\n  ${bad.join('\n  ')}`).toEqual(
      [],
    )
  })

  it('③ 用到的组件所需类名，全部已被 src/main.js 的导入覆盖', () => {
    const mustCheck = [
      ...[...used].filter((u) => u in REQUIRED),
      ...Object.keys(REQUIRED_INTERNAL),
    ]
    const missing = []
    for (const comp of mustCheck) {
      const need = REQUIRED[comp] || REQUIRED_INTERNAL[comp] || []
      const gone = need.filter((c) => !covered.has(c))
      if (gone.length) missing.push(`${comp} 缺：${gone.map((c) => '.' + c).join('、')}`)
    }
    expect(
      missing,
      '有组件样式没被引入（表现是该组件裸奔，输入框可能还正常）：\n  ' +
        missing.join('\n  ') +
        '\n排查：在 element-plus/theme-chalk 里反查这些类名属于哪个 el-xxx.css，补进 src/main.js。',
    ).toEqual([])
  })

  it('④ 日期面板是两件套：el-date-picker.css 与 el-date-picker-panel.css 必须同时在', () => {
    const names = importedCss.map((p) => p.replace(/\\/g, '/').split('/').pop())
    expect(names, '076 就是漏了 -panel 那份（日历格子会挤成一团）').toContain(
      'el-date-picker.css',
    )
    expect(names).toContain('el-date-picker-panel.css')
  })
})
