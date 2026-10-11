import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElConfigProvider, ElDatePicker } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { installDatePickerWheel } from '../../src/utils/datePickerWheel'

// 静态扫源码的路径解析照 visualTokens.spec.js:24 的体例（import.meta.url 由 Vitest 给成文件 URL）
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/*
 * 变更-039「日历滚轮翻页」的用例。
 *
 * 挂**真实 ElDatePicker**，不手搭假面板 DOM —— 手搭等于把「面板的类名、按钮语义、
 * v-show 的写法」这套契约抄一遍，EP 一升版就集体过期，而且抄错了测试还是绿的。
 *
 * 三条与 jsdom 有关的硬事实（读 EP 2.14.5 编译产物核实的）：
 *   ① 面板是 persistent 硬编码 —— **mount 时就在 DOM 里**（v-show 藏在 .el-popper 上），
 *      不用点开输入框，Transition 也挡不住渲染；
 *   ② 面板 teleport 到 body（#el-popper-container-*），**wrapper.find() 看不见它** ——
 *      一律 document.querySelector；
 *   ③ 文案走 zh-cn（与 WorkOrderList.vue:1544 的 ElConfigProvider 同口径），
 *      头部两个 .el-date-picker__header-label 分别是 [0]=年、[1]=月，取数字用正则。
 */

/** 单日期 Host；dates 给两个就挂两个 picker（用例 9 用），月份不同方便分辨 */
const Host = {
  props: { dates: { type: Array, default: () => ['2026-03-15'] } },
  render() {
    return h(
      ElConfigProvider,
      { locale: zhCn },
      { default: () => this.dates.map((d) => h(ElDatePicker, { key: d, type: 'date', modelValue: d })) },
    )
  },
}

const panels = () => [...document.querySelectorAll('.el-picker-panel.el-date-picker')]
const panelEl = (i = 0) => panels()[i]
const labelsOf = (panel) =>
  [...panel.querySelectorAll('.el-date-picker__header-label')].map((e) => e.textContent.trim())
const monthNum = (panel = panelEl()) => +/(\d+)/.exec(labelsOf(panel)[1])[1]
const yearNum = (panel = panelEl()) => +/(\d+)/.exec(labelsOf(panel)[0])[1]

/** 在指定元素上派发一个可取消的滚轮事件 */
function wheel(target, deltaY, init = {}) {
  const e = new WheelEvent('wheel', { deltaY, deltaMode: 0, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

let wrapper
let stop
function mountHost(dates) {
  wrapper = mount(Host, { props: dates ? { dates } : {} })
  stop = installDatePickerWheel()
}

beforeEach(() => {
  mountHost()
})

afterEach(() => {
  stop?.() // 重新安装即重置累计器，用例之间不串状态
  wrapper.unmount()
  // teleport 的 popper 容器是 EP 挂在 body 上的，卸不干净会串到下一个用例
  document.querySelectorAll('[id^="el-popper-container"]').forEach((el) => el.remove())
  vi.useRealTimers()
})

describe('日历滚轮翻页（变更-039）', () => {
  it('前提：面板随挂载就在 DOM 里、四个箭头类名在位', async () => {
    await nextTick()
    const panel = panelEl()
    expect(panel, '面板没渲染出来 —— 后面所有用例都会变成假绿，先修这里').toBeTruthy()
    expect(panel.closest('.el-popper')?.style.display).toBe('none') // 没点开时 v-show 藏在 popper 根上
    for (const sel of ['.arrow-left', '.arrow-right', '.d-arrow-left', '.d-arrow-right'])
      expect(panel.querySelector(sel), `缺箭头 ${sel}`).toBeTruthy()
    expect(monthNum()).toBe(3)
    expect(yearNum()).toBe(2026)
  })

  it('面板上滚一格 → 月份 +1，且事件被 preventDefault', async () => {
    const e = wheel(panelEl(), 100)
    await nextTick()
    expect(monthNum()).toBe(4)
    expect(e.defaultPrevented).toBe(true)
  })

  it('面板外（body 上）滚动 → 不翻、不拦', async () => {
    const e = wheel(document.body, 100)
    await nextTick()
    expect(monthNum()).toBe(3)
    expect(e.defaultPrevented).toBe(false)
  })

  it('静默窗：150ms 内连滚只翻一格，过了窗再滚才翻', async () => {
    vi.useFakeTimers() // mount 已完成，这里再装 —— Date.now 随假时钟走，见文件头的用法约定
    wheel(panelEl(), 100)
    await nextTick()
    expect(monthNum()).toBe(4)

    wheel(panelEl(), 100) // 窗内：只吞不翻
    await nextTick()
    expect(monthNum()).toBe(4)

    vi.advanceTimersByTime(150)
    wheel(panelEl(), 100)
    await nextTick()
    expect(monthNum()).toBe(5)
  })

  it('亚阈值累计：两个 20（触控板的碎步）凑成一格，且每一步都被拦', async () => {
    const e1 = wheel(panelEl(), 20)
    await nextTick()
    expect(monthNum()).toBe(3) // 20 还不够
    expect(e1.defaultPrevented).toBe(true) // 但仍被拦：指针在面板上就别滚背后的列表

    wheel(panelEl(), 20)
    await nextTick()
    expect(monthNum()).toBe(4)
  })

  it('年视图（单箭头被 v-show 藏起）→ 滚轮改走双箭头，年份按十年段跳', async () => {
    // 点年份标题进年视图：EP 的 showPicker('year')
    panelEl().querySelectorAll('.el-date-picker__header-label')[0].click()
    await nextTick()
    expect(panelEl().querySelector('.arrow-left').style.display).toBe('none')

    const before = yearNum()
    wheel(panelEl(), 100)
    await nextTick()
    expect(yearNum()).toBe(before + 10) // year 视图里 moveByYear 步进 10 年
  })

  it('面板内靠原生滚轮的区域（时分秒列等）→ 放行，不拦不翻', async () => {
    // 全站目前只有单日期面板，没有这个区域 —— 造一个同类的节点放进去，
    // 验的是「排除选择器 + 限定在面板内」这条逻辑本身。
    const zone = document.createElement('div')
    zone.className = 'el-time-spinner__wrapper'
    panelEl().appendChild(zone)

    const e = wheel(zone, 100)
    await nextTick()
    expect(monthNum()).toBe(3)
    expect(e.defaultPrevented).toBe(false)
  })

  it('Ctrl+滚（触控板捏合的形态）→ 放行，不拦不翻', async () => {
    const e = wheel(panelEl(), 100, { ctrlKey: true })
    await nextTick()
    expect(monthNum()).toBe(3)
    expect(e.defaultPrevented).toBe(false)
  })

  it('累计按面板分桶：A 上滚 20 再在 B 上滚 20，不允许拼成一格', async () => {
    stop() // 卸掉当前监听（重新安装即重置累计器），再挂两个 picker
    wrapper.unmount()
    document.querySelectorAll('[id^="el-popper-container"]').forEach((el) => el.remove())
    mountHost(['2026-03-15', '2026-05-20'])
    await nextTick()

    const [a, b] = panels()
    expect(monthNum(a)).toBe(3)
    expect(monthNum(b)).toBe(5)

    wheel(a, 20)
    await nextTick()
    wheel(b, 20)
    await nextTick()
    expect(monthNum(a)).toBe(3) // 若累计没分桶，这一下会把 B 翻掉
    expect(monthNum(b)).toBe(5)
  })
})

describe('装配（静态扫源码）', () => {
  it('main.js 确实装了这条监听 —— 防被误删', () => {
    const src = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8')
    expect(src).toMatch(
      /import\s*\{\s*installDatePickerWheel\s*\}\s*from\s*'\.\/utils\/datePickerWheel'/,
    )
    expect(src).toMatch(/^installDatePickerWheel\(\)$/m)
  })
})
