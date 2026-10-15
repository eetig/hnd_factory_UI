import { afterEach, describe, expect, it, vi } from 'vitest'
import { debounce } from '../../src/utils/debounce'

// 边打边查的节流器（变更-059）。这里用假定时器真跑一遍时序 —— 三个动作
// （默认的延迟执行、flush 立刻执行、cancel 撤销）各自的语义都要钉住，
// 因为「回车 = 立刻查」与「卸载时撤销」都建立在它们之上。
describe('debounce：输入 → 服务端查询的节流器（变更-059）', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('静默期内的连续调用只执行**最后一次**（这就是"边打边查"不炸接口的原因）', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const run = debounce(fn, 250)

    run('H')
    run('HN')
    run('HND')
    expect(fn, '还在打字就发请求了 —— 防抖等于没做').not.toHaveBeenCalled()

    vi.advanceTimersByTime(249)
    expect(fn, '差 1ms 就提前发了').not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn, '发的不是最后一次输入的内容 —— 结果会与输入框对不上').toHaveBeenCalledWith('HND')
  })

  it('flush()：立刻执行，并且**吃掉**待发的那次（不会迟到再补一发）', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const run = debounce(fn, 250)

    run('HND')
    expect(run.flush('HND')).toBeUndefined()
    expect(fn, '回车没有立刻发请求').toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(fn, 'flush 之后待发的那次又补了一发 —— 会白打一次接口').toHaveBeenCalledTimes(1)
  })

  it('cancel()：撤销待发的那次，函数不再被调用（组件卸载用）', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const run = debounce(fn, 250)

    run('HND')
    run.cancel()
    vi.advanceTimersByTime(1000)

    expect(fn, 'cancel 之后仍然发请求 —— 卸载后写状态会撞在已销毁的组件上').not.toHaveBeenCalled()
  })

  it('参数与返回值透传：flush() 拿得到 fn 的结果', async () => {
    const fn = vi.fn((a, b) => a + b)
    const run = debounce(fn, 5)

    expect(run.flush(1, 2)).toBe(3)
    expect(fn).toHaveBeenCalledWith(1, 2)
  })
})
