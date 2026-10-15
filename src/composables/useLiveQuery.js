import { onUnmounted, watch } from 'vue'
import { debounce } from '../utils/debounce'

/** 边打边查的静默期：最后一次输入之后这么久才发请求 */
export const LIVE_QUERY_DEBOUNCE_MS = 250

/**
 * 边打边查（变更-059 / 060）：把「输入框 → 服务端查询」的接线收成一处。
 *
 * 四个查询框（物料 / 储罐液位 / 设备台账 / 图片解析选料）要的是同一套东西，所以抽在
 * 这里 —— 抄四份的下场已经出现过：图片解析那份是自己手写的 `setTimeout` + 序号，
 * 与别处的写法、静默期（300ms vs 250ms）和边界行为都不一致。
 *
 * 三层各管一件事，缺一层就出问题：
 *   ① **防抖**（`debounce`）—— 「每次按键」换成「每次停顿」。缺它：敲 8 个字打 8 次接口，
 *      前 7 次的结果还没用上就被盖掉；
 *   ② **查询签名去重** —— 同一个筛选条件不重复发。缺它：打字删回来、`clear` 与 `watch`
 *      双触发都会白打一次；
 *   ③ **过期响应护栏** —— ⚠️ **不在本文件里**，必须贴着请求写（在 `fetchXxx` 里比对序号）：
 *      只有那里知道"谁先回来"，本文件只管"发不发、什么时候发"。四个数据层各有一条。
 *
 * ⚠️ 为什么用 `watch(source)` 而不是给输入框挂 `@input`：Element Plus 在**输入法组字
 * 期间不 emit**，Vue 的 v-model 对原生 input 也跳过组字中间态 —— 所以 watch 只在"落字"
 * 之后触发，选词过程中的拼音串不会变成一次查询。挂 `@input` 就会（原生事件照样发），
 * 图片解析原来正是这么挂的。
 *
 * @param {import('vue').Ref} source 触发源（通常是关键词 ref）
 * @param {Function} run 真正发请求的函数（通常是「回第 1 页再查」那个）
 * @param {{ keyOf?: () => string, delay?: number }} [options]
 *   · `keyOf` 返回**筛选签名**（默认取 source 的 trim 值）。筛选条件不止关键词时
 *     （比如物料的「只看有库存」）必须一起进签名，否则改了开关会被误判成"没变"；
 *   · `delay` 覆盖静默期，默认 250ms。
 * @returns {{ flush: Function, cancel: Function }} `flush()` = 立刻查（回车 / 清空 /
 *   手动改筛选）：取消待发的那次、并**允许重复发**（等于手动刷新一次；被去重挡掉会
 *   显得"按了没反应"）。
 */
export function useLiveQuery(source, run, options = {}) {
  const { keyOf, delay = LIVE_QUERY_DEBOUNCE_MS } = options
  const key = () => (keyOf ? keyOf() : String(source.value ?? '').trim())

  let lastKey = null
  const runIfChanged = () => {
    const current = key()
    // 同一个筛选条件不重复发（null 起步：第一次一定会发）
    if (current === lastKey) return undefined
    lastKey = current
    return run()
  }

  const soon = debounce(runIfChanged, delay)
  watch(source, () => soon())
  onUnmounted(() => soon.cancel())

  return {
    /**
     * 只把签名同步成当前值，**不发请求**（变更-066）。
     *
     * 场景：代码里改了触发源（「重置筛选」把关键词清空、选料弹窗给关键词塞初值），
     * 紧接着自己发了那一次请求。此时 `watch` 已经排了一次防抖，250ms 后它发现签名变了，
     * 于是**再发一次参数完全相同的请求** —— 去重层就这样被绕过了。
     * 在「自己发请求」之前调一次 `sync()`，那次待发的防抖就成了空转。
     */
    sync: () => {
      lastKey = key()
    },
    /** 立刻查：取消待发的那次 + 允许重复发 */
    flush: () => {
      soon.cancel()
      lastKey = key()
      return run()
    },
    /** 撤销待发的那次（`onUnmounted` 已接；导出给测试与特殊场景） */
    cancel: soon.cancel,
  }
}
