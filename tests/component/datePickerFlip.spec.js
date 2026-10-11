import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElConfigProvider, ElDatePicker } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { installDatePickerFlip } from '../../src/utils/datePickerFlip'
import { installDatePickerWheel } from '../../src/utils/datePickerWheel'

// 静态扫源码的路径解析照 visualTokens.spec.js:24 的体例
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/*
 * 变更-040「日历翻页滑动动效」的用例。
 *
 * 挂**真实 ElDatePicker**（与 datePickerWheel.spec.js 同口径：teleport 到 body，
 * 一律 document.querySelector；文案走 zh-cn）。jsdom 30 **没有 Web Animations API**
 * ——本文件自备「假 WAAPI」桩：Element.prototype.animate 返回 {keyframes, options,
 * cancel(), finished}，用例可以「把动画推完」（resolve finished → 触发模块收尾）。
 *
 * 三条与 jsdom 有关的硬事实：
 *   ① clientWidth 恒 0 —— 模块的「宽度为 0 就不动」护栏会拦掉一切，必须给
 *      content 打 defineProperty 宽度桩（292 / 438 两档都测）；
 *   ② matchMedia 是 tests/setup.js 的桩、matches 恒 false（=「不减弱」）——
 *      reduced-motion 用例要临时覆写 window.matchMedia；
 *   ③ rAF 可用（vitest 默认 pretendToBeVisual）——「推一帧」用真 rAF。
 *
 * 另挂一个 window 'error' 收集器：jsdom 里事件监听器抛的异常不会冒给 dispatch 调用方，
 * 只会变成 window 的 error 事件 —— 不收就等着用例假绿。
 */

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
const contentOf = (panel = panelEl()) => panel.querySelector('.el-picker-panel__content')
const tableOf = (panel = panelEl()) => contentOf(panel).querySelector('table')
const ghostsOf = (panel = panelEl()) => contentOf(panel).querySelectorAll('[data-flip-ghost]')
const labelsOf = (panel) =>
  [...panel.querySelectorAll('.el-date-picker__header-label')].map((e) => e.textContent.trim())
const monthNum = (panel = panelEl()) => +/(\d+)/.exec(labelsOf(panel)[1])[1]

/** 在指定元素上派发一个可取消的滚轮事件（与 wheel spec 同款） */
function wheel(target, deltaY, init = {}) {
  const e = new WheelEvent('wheel', { deltaY, deltaMode: 0, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))

let wrapper
let stopFlip
let stopWheel
let fake
let errors
let mmOrig = null

/** 假 WAAPI：可推完（resolveFinished）、可打断（cancel → finished 拒绝，演 AbortError） */
function installFakeAnimate() {
  const calls = []
  const orig = Element.prototype.animate // jsdom 30 里是 undefined
  Element.prototype.animate = function (keyframes, options) {
    const a = {
      target: this,
      keyframes,
      options,
      canceled: false,
      cancel() {
        if (a.canceled) return
        a.canceled = true
        a.rejectFinished?.(new Error('AbortError'))
      },
    }
    a.finished = new Promise((res, rej) => {
      a.resolveFinished = res
      a.rejectFinished = rej
    })
    calls.push(a)
    return a
  }
  fake = {
    calls,
    restore() {
      if (orig) Element.prototype.animate = orig
      else delete Element.prototype.animate
    },
  }
}

/** 把当前所有未取消的动画"推完"，并让微任务跑完（模块的收尾在 finished.then 里） */
async function runAll() {
  fake.calls.filter((a) => !a.canceled).forEach((a) => a.resolveFinished())
  await nextTick()
  await nextTick()
  await nextTick()
}

/** content.clientWidth 宽度桩（jsdom 恒 0，模块护栏会拦掉一切） */
function stubWidth(content, px) {
  Object.defineProperty(content, 'clientWidth', { configurable: true, value: px })
}

function mountHost(dates) {
  wrapper = mount(Host, { props: dates ? { dates } : {} })
  stopFlip = installDatePickerFlip()
}

beforeEach(() => {
  errors = []
  window.addEventListener('error', (e) => errors.push(e.error || e.message), { once: false })
  installFakeAnimate()
  mountHost()
})

afterEach(() => {
  stopFlip?.()
  stopWheel?.()
  stopWheel = null
  wrapper.unmount()
  // teleport 的 popper 容器是 EP 挂在 body 上的，卸不干净会串到下一个用例
  document.querySelectorAll('[id^="el-popper-container"]').forEach((el) => el.remove())
  fake?.restore()
  if (mmOrig) {
    window.matchMedia = mmOrig
    mmOrig = null
  }
  // 事件监听器/rAF 里抛的异常在 jsdom 只变成 window error 事件 —— 每个用例收尾都不许有
  expect(errors, `有未捕获异常：${errors.map(String).join(' | ')}`).toEqual([])
})

describe('日历翻页滑动动效（变更-040）', () => {
  it('前提：面板/四箭头在位，content 与其中的 table 各恰好一个', async () => {
    await nextTick()
    const panel = panelEl()
    expect(panel, '面板没渲染出来 —— 后面所有用例都会变成假绿').toBeTruthy()
    for (const sel of ['.arrow-left', '.arrow-right', '.d-arrow-left', '.d-arrow-right'])
      expect(panel.querySelector(sel), `缺箭头 ${sel}`).toBeTruthy()
    expect(panel.querySelectorAll('.el-picker-panel__content').length).toBe(1)
    expect(contentOf().querySelectorAll('table').length).toBe(1)
  })

  it('点右箭头：同步摆好幽灵与起始位；rAF 后双轨动画参数全等；推完全清、月份 +1', async () => {
    const content = contentOf()
    const table = tableOf()
    stubWidth(content, 292)

    panelEl().querySelector('.arrow-right').click()

    // ── 同步断言（capture 那一刻就该就位，EP 换月还在微任务里）──
    const ghost = content.querySelector('[data-flip-ghost]')
    expect(ghost, '点击后幽灵应已在 content 里').toBeTruthy()
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.querySelectorAll('[tabindex]').length, '克隆里的 tabindex 要剥掉').toBe(0)
    expect(content.style.overflow).toBe('hidden') // 裁切窗
    expect(table.style.transform, '新表格的防闪起始位').toBe('translateX(292px)')
    expect(ghost.style.transform).toBe('translateX(0)')

    await nextFrame()
    expect(fake.calls.length).toBe(2)
    const [aT, aG] = fake.calls
    expect(aT.target).toBe(table)
    expect(aG.target).toBe(ghost)
    expect(aT.keyframes).toEqual([{ transform: 'translateX(292px)' }, { transform: 'translateX(0)' }])
    expect(aG.keyframes).toEqual([{ transform: 'translateX(0)' }, { transform: 'translateX(-292px)' }])
    // fill:'forwards' 是防闪②，锁死
    expect(aT.options).toEqual({ duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' })
    expect(aG.options).toEqual(aT.options)

    await runAll()
    expect(content.querySelector('[data-flip-ghost]')).toBeNull()
    expect(table.style.transform).toBe('')
    expect(content.style.overflow).toBe('')
    expect(monthNum()).toBe(4)
  })

  it('点左箭头：方向镜像（表格 −292→0、幽灵 0→+292）；动画期间月份标签已是新值（header 不参与滑动）', async () => {
    const content = contentOf()
    stubWidth(content, 292)

    panelEl().querySelector('.arrow-left').click()
    expect(tableOf().style.transform).toBe('translateX(-292px)')

    await nextFrame()
    expect(fake.calls[0].keyframes).toEqual([{ transform: 'translateX(-292px)' }, { transform: 'translateX(0)' }])
    expect(fake.calls[1].keyframes).toEqual([{ transform: 'translateX(0)' }, { transform: 'translateX(292px)' }])
    expect(monthNum(), '动画还在跑，标签就该是新月份了').toBe(2)

    await runAll()
    expect(ghostsOf().length).toBe(0)
    expect(monthNum()).toBe(2)
  })

  it('滚轮模块联装：滚一格也走动画（程序化非 trusted 的 click 同样被接管）', async () => {
    stopWheel = installDatePickerWheel() // 与 main.js 一样两个都装
    const content = contentOf()
    stubWidth(content, 292)

    wheel(panelEl(), 100) // 同步派发；滚轮模块内部 .click() 也是同步的
    expect(content.querySelector('[data-flip-ghost]'), '滚一格后幽灵应已就位').toBeTruthy()

    await nextFrame()
    expect(fake.calls.length).toBe(2)
    await runAll()
    expect(ghostsOf().length).toBe(0)
    expect(content.style.overflow).toBe('')
    expect(monthNum()).toBe(4)
  })

  it('prefers-reduced-motion：不动画、不建幽灵、overflow 从未被写，但月份照翻', async () => {
    mmOrig = window.matchMedia
    window.matchMedia = (q) => ({
      matches: /reduced-motion/.test(q),
      media: q,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })
    const content = contentOf()
    stubWidth(content, 292)

    panelEl().querySelector('.arrow-right').click()
    await nextFrame()
    await nextTick()

    expect(fake.calls.length).toBe(0)
    expect(content.querySelector('[data-flip-ghost]')).toBeNull()
    expect(content.style.overflow).toBe('')
    expect(monthNum()).toBe(4)
  })

  it('无 WAAPI（jsdom 本态）：降级不崩，月份照翻', async () => {
    fake.restore() // Element.prototype.animate 回到 undefined
    const content = contentOf()
    stubWidth(content, 292)

    panelEl().querySelector('.arrow-right').click()
    await nextFrame()
    await nextTick()

    expect(content.querySelector('[data-flip-ghost]')).toBeNull()
    expect(content.style.overflow).toBe('')
    expect(monthNum()).toBe(4)
  })

  it('宽度为 0（面板不可见）：不动画不建幽灵，月份照翻', async () => {
    // 故意不打宽度桩 —— jsdom 的 clientWidth 就是 0
    const content = contentOf()
    panelEl().querySelector('.arrow-right').click()
    await nextFrame()
    await nextTick()

    expect(fake.calls.length).toBe(0)
    expect(content.querySelector('[data-flip-ghost]')).toBeNull()
    expect(content.style.overflow).toBe('')
    expect(monthNum()).toBe(4)
  })

  it('连翻：旧一轮被打断（canceled + AbortError 被吞）、幽灵恰 1 个、overflow 还原成空串而不是 hidden', async () => {
    const rejections = []
    const onRej = (r) => rejections.push(r)
    process.on('unhandledRejection', onRej)
    try {
      const content = contentOf()
      stubWidth(content, 292)
      const arrow = panelEl().querySelector('.arrow-right')

      arrow.click() // 第 1 轮
      await nextFrame()
      expect(fake.calls.length).toBe(2)
      const first = [...fake.calls]

      arrow.click() // 第 2 轮（第 1 轮还在跑）
      expect(ghostsOf().length, '重叠时旧幽灵被摘，恰好 1 个').toBe(1)
      expect(first[0].canceled).toBe(true)
      expect(first[1].canceled).toBe(true)

      await nextFrame()
      expect(fake.calls.length).toBe(4)
      await runAll()
      await new Promise((r) => setTimeout(r, 20)) // 让 unhandledRejection 有机会冒出来

      expect(ghostsOf().length).toBe(0)
      expect(content.style.overflow, 'overflow 原值只认链路起点，必须还原成空串').toBe('')
      expect(tableOf().style.transform).toBe('')
      expect(monthNum()).toBe(5) // 3 → 4 → 5
    } finally {
      process.off('unhandledRejection', onRej)
    }
    expect(rejections, 'AbortError 应被吞掉，不许漏出 unhandled rejection').toEqual([])
  })

  it('双面板：各自用自己 content 的实宽，翻 A 不动 B', async () => {
    stopFlip()
    wrapper.unmount()
    document.querySelectorAll('[id^="el-popper-container"]').forEach((el) => el.remove())
    mountHost(['2026-03-15', '2026-05-20'])
    await nextTick()

    const [a, b] = panels()
    const ca = contentOf(a)
    const cb = contentOf(b)
    stubWidth(ca, 292)
    stubWidth(cb, 438)
    expect(monthNum(a)).toBe(3)
    expect(monthNum(b)).toBe(5)

    a.querySelector('.arrow-right').click()
    expect(fake.calls.length, '同步就该有幽灵但动画在 rAF 里').toBe(0)
    await nextFrame()

    expect(fake.calls.length).toBe(2)
    const widths = fake.calls.map((c) => c.keyframes[0].transform)
    expect(widths).toEqual(['translateX(292px)', 'translateX(0)']) // A 用 292，没写死也没串号
    expect(ghostsOf(b).length, 'B 不该有幽灵').toBe(0)
    expect(cb.style.overflow).toBe('')

    await runAll()
    expect(monthNum(a)).toBe(4)
    expect(monthNum(b)).toBe(5)
  })

  it('动画中卸载：幽灵/内联/overflow 全清，rAF 不再触发，再点无反应', async () => {
    const content = contentOf()
    const table = tableOf()
    stubWidth(content, 292)
    const arrow = panelEl().querySelector('.arrow-right')

    arrow.click()
    await nextFrame()
    expect(fake.calls.length).toBe(2)

    stopFlip() // 卸载
    expect(content.querySelector('[data-flip-ghost]')).toBeNull()
    expect(table.style.transform).toBe('')
    expect(content.style.overflow).toBe('')

    const n = fake.calls.length
    await nextFrame()
    expect(fake.calls.length, 'rAF 已被 cancel，不该再起动画').toBe(n)

    arrow.click()
    await nextFrame()
    expect(content.querySelector('[data-flip-ghost]')).toBeNull()
  })
})

describe('装配（静态扫源码）', () => {
  it('main.js 确实装了这条监听 —— 防被误删', () => {
    const src = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8')
    expect(src).toMatch(
      /import\s*\{\s*installDatePickerFlip\s*\}\s*from\s*'\.\/utils\/datePickerFlip'/,
    )
    expect(src).toMatch(/^installDatePickerFlip\(\)$/m)
  })
})
