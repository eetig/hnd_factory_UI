import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import { useLiveQuery, LIVE_QUERY_DEBOUNCE_MS } from '../../src/composables/useLiveQuery'

/**
 * `useLiveQuery` 的行为测试（变更-066）。
 *
 * 为什么必须**行为**而不是源码字符串断言：这一层是防抖、去重、过期护栏三件事的接缝，
 * 而"某句话在源码里出现过几次"抓不到任何一件 —— 曾经的同型断言就是这么失效的：
 * `toContain('if (seq !== stockRequestSeq) return')` 分不清这句话在文件里出现 2 次还是 1 次，
 * 删掉 catch 分支那一条、另一条还在，断言照样绿，而过期请求的失败就会盖掉新结果。
 *
 * 这里用一个**真实组件实例**挂载：`onUnmounted` 只在组件作用域里生效，
 * 不 mount 就测不到"卸载后待发的那次不再落地"。
 */
describe('useLiveQuery：防抖 / 去重 / flush / cancel / 卸载 / sync', () => {
  /** 把接线挂进真实组件；返回可驱动的一切 */
  function mountLive(options = {}) {
    const source = ref('')
    const run = vi.fn().mockResolvedValue(undefined)
    let api = null
    const wrapper = mount({
      setup() {
        api = useLiveQuery(source, run, options)
        return () => null
      },
    })
    return { source, run, wrapper, api: () => api }
  }

  /** 输入一个字（走真实的 watch → 防抖链路） */
  async function type(source, value) {
    source.value = value
    await nextTick()
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('第一次输入在静默期结束后才发一次 —— 不是每个字都发', async () => {
    const { source, run } = mountLive()

    await type(source, '甲')
    expect(run).not.toHaveBeenCalled()

    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('连打多个字只发最后一次 —— 静默期被每次输入重置', async () => {
    const { source, run } = mountLive()

    for (const value of ['甲', '甲醇', '甲醇罐']) {
      await type(source, value)
      vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS - 50) // 没等满就再敲
    }
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('同一个筛选条件不重复发（含只差首尾空白的同一条件）', async () => {
    const { source, run } = mountLive()

    await type(source, '甲醇')
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)
    expect(run).toHaveBeenCalledTimes(1)

    // 只差首尾空白 = 同一条件（签名是 trim 过的），不该再发
    await type(source, ' 甲醇 ')
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)
    expect(run).toHaveBeenCalledTimes(1)

    // 删一个字 = 一次真实变化，要查
    await type(source, '甲')
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)
    expect(run).toHaveBeenCalledTimes(2)

    // 再打回来 = 又一次真实变化（去重只挡"没变"，不挡"改回去了"）
    await type(source, '甲醇')
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('flush() 先取消待发的那次、再允许重复发（回车/清空/按钮：按了必须有反应）', async () => {
    const { source, run, api } = mountLive()

    await type(source, '甲醇')
    api().flush()
    expect(run).toHaveBeenCalledTimes(1)

    // 待发的那次已被取消：静默期过去不再多发一次
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS * 2)
    expect(run).toHaveBeenCalledTimes(1)

    // 同一条件再 flush 一次仍要发 —— 手动刷新不该被去重挡掉
    api().flush()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancel() 撤销待发的那次（导出给特殊场景用）', async () => {
    const { source, run, api } = mountLive()

    await type(source, '甲醇')
    api().cancel()
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS * 2)

    expect(run).not.toHaveBeenCalled()
  })

  it('卸载后待发的那次不再落地（否则会写进已销毁的组件）', async () => {
    const { source, run, wrapper } = mountLive()

    await type(source, '甲醇')
    wrapper.unmount()
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS * 2)

    expect(run).not.toHaveBeenCalled()
  })

  it('keyOf 的额外维度真的在起作用：对照"签名含开关 vs 不含开关"的行为差异', async () => {
    // 真实形态：关键词 + 「只看有库存」两个筛选维度。开关自己有处理函数负责发请求，
    // 所以 watch 只盯 source 是**对的**；keyOf 额外维度的作用发生在"关键词再变"的那一刻。
    const runWith = async (keyOf) => {
      const onlyInStock = ref(false)
      const { source, run } = mountLive({ keyOf: keyOf(onlyInStock) })

      await type(source, '甲醇')
      vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS) // 第 1 次
      onlyInStock.value = true
      await nextTick()
      // 只动开关：不重查（由开关自己的处理函数负责），这一点单独断言
      vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)
      expect(run, '只动开关不该由 watch 触发查询').toHaveBeenCalledTimes(1)

      // 关键词加个尾空格 = 同一个关键词，但**结果集已经因为开关而不同了**
      await type(source, '甲醇 ')
      vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)
      return run.mock.calls.length
    }

    const withToggle = await runWith((onlyInStock) => () => {
      // 签名带上开关（物料那处的写法）
      return `keyword|${onlyInStock.value}`
    })
    const withoutToggle = await runWith(() => () => 'keyword')

    expect(withToggle, '签名含开关时，这次输入必须重查（否则屏上还是改开关之前的结果）').toBe(2)
    expect(withoutToggle, '签名不含开关时会被误判成"没变"——这正是额外维度要防的回归').toBe(1)
  })

  it('sync() 只同步签名、不发请求：随后那次防抖成为空转（避免自己发过一次还再来一次）', async () => {
    const { source, run, api } = mountLive()

    await type(source, '甲醇')
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)
    expect(run).toHaveBeenCalledTimes(1)

    // 「重置筛选」的真实形态：清空触发源（watch 排了一次防抖）+ 组件自己发那一次请求
    await type(source, '')
    api().sync() // 只同步签名
    run() // 组件自己发的那一次
    expect(run).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS * 2)
    expect(run).toHaveBeenCalledTimes(2) // 没有 sync() 时这里会变成 3
  })

  it('反证：不做 sync() 就会多打一次参数完全相同的请求（这条是本用例存在的理由）', async () => {
    const { source, run } = mountLive()

    await type(source, '甲醇')
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS)
    expect(run).toHaveBeenCalledTimes(1)

    await type(source, '')
    run() // 组件自己发了一次
    vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS * 2)

    // 待发的那次防抖照发 → 同一条件打了两次：这正是 sync() 要消除的浪费
    expect(run).toHaveBeenCalledTimes(3)
  })
})
