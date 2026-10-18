import { computed } from 'vue'
import { hasPerm, isAdmin } from '../api/auth'

/**
 * 导航数据 —— **唯一真源**（2026-10 路由化改造）。
 *
 * 这里取代了原先散在 `views/WorkOrderList.vue` 里的 `TAB_GROUPS` / `tabs` 两份表。
 * 拆成「壳 + 路由页」之后，侧栏、顶栏面包屑、页签、路由表、路由守卫五处都要同一份
 * 「有哪些页、谁能看、在哪个组」—— 五份拷贝必然会漂移（旧结构里侧栏与组内页签
 * 至少还是同一份 `tabs`，现在连组件都不在一起了），所以统一收到这里。
 *
 * ⚠️ **权限只有一个字段 `perm`**：原先是 `adminOnly: true` 与 `perm: '…'` 两套写法、
 * 两套判据。合并之后 admin 专属页写 `perm: ADMIN_PERM`（`'system:admin'`），
 * 判据仍是 `isAdmin()` —— 不是 `hasPerm('system:admin')`。为什么必须分开：
 * `isAdmin()` 读的是 `roleKey === 'admin'`（与后端 `SaTokenConfigure` 的角色闸门
 * 一一对应），而 `hasPerm` 读的是权限位集合。后端那 6 个台账接口是按**角色**拦的，
 * 若这里换成权限位判断，两边口径一旦不一致就会出现「看得见点进去满屏 403」
 * 或者「明明有权限却找不到入口」。行为与改造前逐项一致：谁能看到哪些页，一个都不变。
 */

/** admin 专属页的 `perm` 值（判据是 `isAdmin()`，见文件头注释） */
export const ADMIN_PERM = 'system:admin'

/**
 * 侧栏的大类（顺序即侧栏顺序）。
 *
 * `hint` 会显示在展开态分组按钮的第二行 —— ⚠️ 侧栏宽度是按它们算过的
 * （见 tests/unit/visualTokens.spec.js §9：文字列必须装得下最长那条），
 * 改长之前先量一遍字宽，否则四条提示会两条折行、两条不折，行高参差。
 */
export const NAV_GROUPS = [
  { key: 'order', label: '工单', hint: '工单、领料、入库与核算' },
  { key: 'materials', label: '物料', hint: '物料编码、名称与库存' },
  { key: 'purchase', label: '采购', hint: '需求登记到到货的台账' },
  { key: 'equipment', label: '设备', hint: '台账、体积与电费' },
  { key: 'stats', label: '报表', hint: '周统计与台账记录' },
  { key: 'maintain', label: '维护', hint: '基础数据与录入' },
]

/**
 * 页面清单（顺序 = 组内页签顺序）。
 *
 * `key` 沿用旧 `tabs` 的 key：`:data-tab-key` 与组件测试的断言都读它，
 * 换名字等于把所有「哪一页是当前页」的断言重写一遍。
 *
 * ⚠️ 采购需求详情：变更-096/097 起只给 admin。使用方 2026-10-17 的原话是
 * 「这页只有管理员能看」，背后 `GET /api/purchase/**` 已收进后端的
 * ADMIN_READ_PATTERNS —— 两边必须同口径（只藏前端等于数据公开，只锁后端等于
 * 非 admin 点进来满屏 403）。
 *
 * ⚠️ 设备数据维护用**权限位**而不是 admin：写接口本来就是「仅 admin + 该权限位」
 * 两道，将来放开给非 admin 的维护员时只需给角色加权限位，结构不用动。
 */
export const NAV_ITEMS = [
  { key: 'workOrder', label: '工单汇总', path: '/orders', perm: ADMIN_PERM, group: 'order' },
  {
    key: 'material',
    label: '领料汇总',
    path: '/orders/picking',
    perm: ADMIN_PERM,
    group: 'order',
  },
  {
    key: 'inbound',
    label: '入库汇总',
    path: '/orders/inbound',
    perm: ADMIN_PERM,
    group: 'order',
  },
  // 核算：工单报工 / 工单核算 / 原辅料核算三张只读表合成一页（页内切换），
  // 所以这里只有一条导航项 —— 它们共用一份筛选区间，本来就不该是三个入口。
  { key: 'costing', label: '核算', path: '/orders/costing', perm: ADMIN_PERM, group: 'order' },
  { key: 'stock', label: '物料查询', path: '/materials', group: 'materials' },
  {
    key: 'purchase',
    label: '采购需求详情',
    path: '/purchase',
    perm: ADMIN_PERM,
    group: 'purchase',
  },
  {
    key: 'equipment',
    label: '设备数据维护',
    path: '/equipment',
    perm: 'equipment:edit',
    group: 'equipment',
  },
  // 体积计算是纯前端计算，电费预提是本地档位说明 + 占位，都不需要登录
  { key: 'vessel', label: '压力容器体积计算', path: '/equipment/vessel', group: 'equipment' },
  { key: 'electricity', label: '电费预提', path: '/equipment/electricity', group: 'equipment' },
  // 周统计对所有人可见：它走 /api/stats/weekly 这条只吐汇总数的公开接口（决策-004），
  // 不依赖那 6 条 admin 专属的台账明细
  { key: 'weekly', label: '周统计', path: '/stats/weekly', group: 'stats' },
  { key: 'daily', label: '日报表记录', path: '/stats/daily', group: 'stats' },
  { key: 'tankLevel', label: '月底储罐液位记录', path: '/stats/tank-level', group: 'stats' },
  {
    key: 'import',
    label: '文件导入',
    path: '/maintain/import',
    perm: 'work_order:import',
    group: 'maintain',
  },
  // 图片解析：单据图片识别辅助录入（变更-003）。与文件导入同属录入入口，沿用同一权限位
  {
    key: 'imageParse',
    label: '图片解析',
    path: '/maintain/image-parse',
    perm: 'work_order:import',
    group: 'maintain',
  },
]

/**
 * 大类图标（收起态那条图标条与展开态分组块共用）。
 *
 * key 与 NAV_GROUPS 一一对应 —— 以后加组必须同期加图标，否则 `:d` 拿到 undefined，
 * 画出来是一个空白按钮：点得动、能切页，但看不出是哪个组。
 *
 * 值是**一个 `<path>` 的 `d`**。一个 d 里可以并列写多段子路径（剪贴板的「夹子」、
 * 数据库的椭圆都是这么画的），所以六种图形都塞得进一条 path —— 不必为
 * `<rect>` / `<circle>` 另开元素，也就不必为此引入 v-html。
 * 线条语言取自 Feather，与 components/FilterHeaderCell.vue 同一套。
 */
export const GROUP_ICON_PATHS = {
  order:
    'M15 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 1 1v3H8V3a1 1 0 0 1 1-1z',
  materials:
    'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
  purchase:
    'M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6',
  equipment:
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  stats: 'M18 20V10M12 20V4M6 20V14',
  maintain:
    'M21 5a9 3 0 0 1-18 0a9 3 0 0 1 18 0zM21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
}

/**
 * 一条导航项当前是否可见。
 *
 * 两类过滤的叠加，与改造前的 `visibleTabs` 逐字同口径：
 *   `adminOnly ? isAdmin() : hasPerm(tab.perm)`
 * 合并成一个 `perm` 字段之后，`ADMIN_PERM` 走 `isAdmin()`，其余走 `hasPerm()`。
 */
export function canSeeNavItem(item) {
  if (!item) return false
  return item.perm === ADMIN_PERM ? isAdmin() : hasPerm(item.perm)
}

/**
 * 可见项 —— **模块级 computed**。
 *
 * 为什么不在 `useNav()` 里建：路由守卫（`router/index.js`）也要读它，而守卫
 * 没有组件实例。`computed` 本身不依赖组件作用域（只有 `watch` 才需要），
 * 放在模块里反而是唯一正确的位置 —— 它读的 `authState` 是 reactive 镜像，
 * 登录 / 退出后自动重算，不需要整页刷新。
 */
export const visibleNavItems = computed(() => NAV_ITEMS.filter(canSeeNavItem))

/**
 * 第一个可见页的路径。
 *
 * 两处要用：
 *   · `/` 的 redirect —— 非 admin 打开首页时，「工单汇总」本就不可见，
 *     停在那儿就是一片空白（改造前靠 `watch(visibleTabs, …, {immediate:true})`
 *     把 activeTab 兜到第一个可见页，同一个意图）；
 *   · 路由守卫 —— 直接敲一个没权限的地址时把人送到他能看的页面，而不是渲染一张
 *     空壳（那 6 个页背后的接口在后端也是 admin 闸门，进去只会满屏 403）。
 * 一个都看不见时落回 `/login`：那是唯一还能正常渲染的页面。
 */
export function firstVisiblePath() {
  return visibleNavItems.value[0]?.path ?? '/login'
}

/** 组件里用的导航视图：可见项 / 可见分组 / 首个可见页 */
export function useNav() {
  const visibleGroups = computed(() =>
    NAV_GROUPS.map((group) => ({
      ...group,
      items: visibleNavItems.value.filter((item) => item.group === group.key),
    })).filter((group) => group.items.length > 0),
  )

  return { visibleItems: visibleNavItems, visibleGroups, firstVisiblePath }
}
