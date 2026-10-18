import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useCountUp } from '../../src/composables/useCountUp.js'

/**
 * 数字滚动（变更-123）。
 *
 * 这个 composable 的价值全在**边界**上：正常情况下它只是"好看"，
 * 出问题时却是"KPI 永远显示 0"——看起来像没数据，比没有动画糟得多。
 * 所以这里只守那三条边界：终值一定会到、终值会跟着改、减弱动效时不滚。
 */

let scope
const run = (fn) => {
  scope = effectScope()
  return scope.run(fn)
}

beforeEach(() => {
  vi.useFakeTimers()
  // jsdom 没有 matchMedia，默认当作"没有减弱动效"
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})

afterEach(() => {
  scope?.stop()
  vi.useRealTimers()
  delete window.matchMedia
})

describe('useCountUp', () => {
  it('动画走完之后一定落在终值（rAF 被节流也靠兜底定时器兜住）', async () => {
    const target = ref(0)
    const { display } = run(() => useCountUp(target, { duration: 200 }))

    target.value = 1234
    await nextTick()

    // 只推进定时器、不推进 rAF —— 模拟后台标签页里 rAF 被节流的情况
    vi.advanceTimersByTime(400)
    expect(display.value).toBe(1234)
  })

  it('目标值改了，会朝新目标去，而不是停在旧值', async () => {
    const target = ref(100)
    const { display } = run(() => useCountUp(target, { duration: 200 }))

    target.value = 500
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(display.value).toBe(500)

    target.value = 20
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(display.value).toBe(20)
  })

  it('prefers-reduced-motion 时直接给终值，一帧都不滚', async () => {
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    const target = ref(0)
    const { display } = run(() => useCountUp(target, { duration: 5000 }))

    target.value = 777
    await nextTick()
    // 一毫秒都不推进就必须已经是终值
    expect(display.value).toBe(777)
  })
})
