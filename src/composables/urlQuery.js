/**
 * 地址栏查询串的小工具（2026-10-18，变更-116）。
 *
 * 只有一个函数，因为只需要这一个：**进入页面时读一次**。
 *
 * ⚠️ 别改成 `computed(() => route.query.x)` 去初始化状态 —— 那样后续任何
 * 路由变化（包括我们自己写回 URL 的那次）都会把用户刚改的值覆盖回去，
 * 表现为"日期选中后立刻弹回"。
 */
export function readQuery(route, key, fallback = '') {
  const v = route.query[key]
  return typeof v === 'string' && v ? v : fallback
}
