import { ref } from 'vue'
import { getToday } from '../utils/format'

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
 * ## 和 URL 的关系（2026-10-18 变更-116 改写）
 *
 * **原先这里写的是「不塞进 URL」**，理由是"没有分享某个筛选视图的需求"。
 * 使用方后来说了真实场景：条件改好、按 F5 刷新就弹回默认值 —— 那条理由不成立了。
 * 现在由 `useOrderFilterUrl` 双向同步 `?start=&end=&type=`：
 *   · 进入页面时以 URL 为权威（能接住粘过来的链接）
 *   · 用户改条件时用 `router.replace` 写回（不堆历史）
 * 状态本身**仍然只有这一份**（模块作用域），URL 只是它的一个视图。
 *
 * ## 与数据层的关系（重要，别在这里再存一份）
 *
 * 这里**只放状态，不放取数**。真正的查询由 `useWorkOrderData` 用它组参数
 * （`buildWorkOrderQuery` 读的就是这两个 ref），所以：
 *   ⚠️ **这里不许再声明一套 `startDate`** —— 同一个筛选条件存两位真值，
 *   早晚会出现「改了界面上的日期，请求还带旧值」。
 *   搬运时是把 `useWorkOrderData` 里那三个模块级 ref 挪到这里，不是复制。
 */
/*
 * 默认统计区间（2026-11-02 改用"最近 90 天"）。
 *
 * 原来是「本月 1 号 ~ 今天」。问题在月初：11 月 2 号打开，区间只有 11-01~11-02，
 * 而工单/领料/入库都还是 10 月的 ⇒ 三张汇总表全空，人第一反应是"数据没了"。
 * 使用方 2026-11-02 也正好撞上这个（连着两次看不到数据）。
 *
 * 90 天覆盖一个季度的对账窗口，且语义仍是"最近"，不会让人以为在看历史。
 * 要精确到某个月，日期控件照样能改（这里的默认值只决定"打开时"）。
 */
export const orderStartDate = ref(getDaysAgo(89)) // 含今天共 90 天
export const orderEndDate = ref(getToday())

/** 取 N 天前的日期字符串（YYYY-MM-DD），与 getToday 同格式 */
function getDaysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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
