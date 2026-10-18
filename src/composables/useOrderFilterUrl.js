import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { orderStartDate, orderEndDate, orderTypeFilter } from './useOrderFilter'
import { readQuery } from './urlQuery.js'

/**
 * 工单组的筛选 ⇄ 地址栏（2026-10-18，变更-116）。
 *
 * 只做**筛选**，不做页码。理由：刷新后停在"第 5 页"通常不是用户想要的 ——
 * 数据可能已经变了，而用户看不到第 1 页就没法判断。筛选条件不同，它是
 * "我在看哪段时间的数据"，刷新后必须还在。
 *
 * 查询参数用短名：`start` / `end` / `type`。
 *   hbhnd.cloud/orders?start=2026-10-01&end=2026-10-08&type=包装工单
 */

/** 只有这四个页面共享这份筛选；别的页面不该被塞查询参数 */
const ORDER_PATHS = new Set(['/orders', '/orders/picking', '/orders/inbound', '/orders/costing'])

const isOrderPath = (p) => ORDER_PATHS.has(p)

/**
 * 把 URL 里的值搬进模块状态。**只在进入工单组页面时**调用 —— 否则在物料页
 * 粘一个带 `?start=` 的链接，也会把工单组的日期改掉。
 */
export function hydrateOrderFilterFromQuery(route) {
  if (!isOrderPath(route.path)) return
  const start = readQuery(route, 'start', '')
  const end = readQuery(route, 'end', '')
  const type = readQuery(route, 'type', '')
  // 只在 URL 明确带了值时才覆盖；没带就保持模块里现有的值（用户上次选的）
  if (start) orderStartDate.value = start
  if (end) orderEndDate.value = end
  if (type) orderTypeFilter.value = type
}

/**
 * 在 AppShell 里调用一次即可（它是全站唯一常驻的组件）。
 *
 * 两个方向：
 *   ① 进页面 / 粘链接 → `hydrateOrderFilterFromQuery`
 *   ② 用户改筛选 → 写回地址栏（`replace`，不堆历史）
 */
export function useOrderFilterUrl() {
  const route = useRoute()
  const router = useRouter()

  // ① 进入或切换到工单组页面时，先把 URL 当权威读一次
  watch(
    () => route.path,
    (p) => {
      if (isOrderPath(p)) hydrateOrderFilterFromQuery(route)
    },
    { immediate: true },
  )

  // ② 状态变了写回 URL。用 replace：筛选是连续动作，push 会把历史塞满，
  //    用户要按十几次后退才能离开页面。
  watch(
    [orderStartDate, orderEndDate, orderTypeFilter],
    () => {
      if (!isOrderPath(route.path)) return
      const query = { ...route.query }
      const want = {
        start: orderStartDate.value || '',
        end: orderEndDate.value || '',
        type: orderTypeFilter.value || '',
      }
      let dirty = false
      for (const [k, v] of Object.entries(want)) {
        const cur = typeof query[k] === 'string' ? query[k] : ''
        if (v === cur) continue
        if (v) query[k] = v
        else delete query[k]
        dirty = true
      }
      if (dirty) router.replace({ query })
    },
    { flush: 'post' },
  )
}
