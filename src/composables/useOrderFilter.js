import { ref } from 'vue'
import { getFirstDayOfCurrentMonth, getToday } from '../utils/format'

/**
 * 工单组的**共享筛选状态**（起止日期 + 工单类型）。
 *
 * ## 为什么必须是模块作用域
 *
 * 拆成路由页之后，「工单汇总 / 领料汇总 / 入库汇总 / 核算」是四个**独立的页面组件**，
 * 切页 = 路由切换 = 旧组件被卸载。若把 `ref()` 写在页面里，用户改好的起止日期
 * 一换页就回到默认值 —— 而这几页看的是同一段时间的数据，来回对照时日期被重置
 * 是最恼人的那种小毛病（改造前它们共享同一个 `setup`，所以从来没有过这个问题）。
 *
 * 状态放模块作用域即与 app 同寿：四个页面 `import` 到的是同一对 ref，
 * 切页、刷新路由、甚至先退出再登录都不会丢。
 *
 * ## 为什么不塞进 URL
 *
 * 查询串会把「用户上次选的区间」变成可分享 / 可被前进后退污染的东西，
 * 还会让每条 `router.push` 都得带上筛选参数。这里没有"分享某个筛选视图"的需求，
 * 不值得引入那份复杂度。
 *
 * ## 与数据层的关系（重要，别在这里再存一份）
 *
 * 这里**只放状态，不放取数**。真正的查询由 `useWorkOrderData` 用它组参数
 * （`buildWorkOrderQuery` 读的就是这两个 ref），所以：
 *   ⚠️ **这里不许再声明一套 `startDate`** —— 同一个筛选条件存两位真值，
 *   早晚会出现「改了界面上的日期，请求还带旧值」。
 *   搬运时是把 `useWorkOrderData` 里那三个模块级 ref 挪到这里，不是复制。
 */
export const orderStartDate = ref(getFirstDayOfCurrentMonth())
export const orderEndDate = ref(getToday())

/**
 * 工单类型筛选（界面上存中文标签，发请求时由 `getReportOrderTypeKey` 换成 typeKey）。
 *
 * 它现在挂在「工单类型」这一列的表头筛选上（`FilterHeaderCell`），不在筛选条里 ——
 * 但它是**工单组的状态**而不是某一页的局部状态：拆页后进核算页再回来，
 * 用户不应被要求重选一次。
 */
export const orderTypeFilter = ref('')

/** 组件里取这份状态（四个工单组页面都从这里拿，别各自 `ref`） */
export function useOrderFilter() {
  return {
    startDate: orderStartDate,
    endDate: orderEndDate,
    orderTypeFilter,
  }
}
