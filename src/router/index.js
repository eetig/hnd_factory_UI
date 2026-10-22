import { createRouter, createWebHistory } from 'vue-router'
import { ADMIN_PERM, firstVisiblePath } from '../nav'
import { isLoggedIn } from '../api/auth'
import AppShell from '../layouts/AppShell.vue'
import Login from '../views/Login.vue'
import Register from '../views/RegisterView.vue'
import WorkOrderList from '../views/orders/WorkOrderList.vue'
import PickingList from '../views/orders/PickingList.vue'
import InboundList from '../views/orders/InboundList.vue'
import CostingView from '../views/orders/CostingView.vue'
import StockView from '../views/materials/StockView.vue'
import PurchaseView from '../views/purchase/PurchaseView.vue'
import PurchaseBoardView from '../views/purchase/PurchaseBoardView.vue'
import EquipmentView from '../views/equipment/EquipmentView.vue'
import EquipmentBoardView from '../views/equipment/EquipmentBoardView.vue'
import VesselView from '../views/equipment/VesselView.vue'
import ElectricityView from '../views/equipment/ElectricityView.vue'
import WeeklyView from '../views/stats/WeeklyView.vue'
import DailyView from '../views/stats/DailyView.vue'
import TankLevelView from '../views/stats/TankLevelView.vue'
import ImportView from '../views/maintain/ImportView.vue'
import ImageParseView from '../views/maintain/ImageParseView.vue'
import ArchiveView from '../views/archive/ArchiveView.vue'

/*
 * 工作台的路由表（2026-10 路由化改造）。
 *
 * 14 条工作台页面 + 登录 / 落地页 / 兜底，原来的「页签数组」就是这张表的另一面：
 *   · `meta.group`  —— 侧栏哪一组（也是顶栏面包屑的前半段）；
 *   · `meta.key`    —— 旧 `tabs` 的 key，页签按钮的 `data-tab-key` 读它；
 *   · `meta.title`  —— 主区标题（= nav 里那一项 label 的兜底值）；
 *   · `meta.perm`   —— 权限，**判据与导航完全同一份**（`canSeeNavItem`）。
 *
 * ⚠️ 页面组件是**静态 import**（不是懒加载）：工作台是天天要用的东西，
 * 拆包只会把首屏变成「先要一个包、再要一个包」。/intro 与 404 仍然是懒加载 ——
 * 它们与工作台毫无关系、几乎不会被访问。
 *
 * ⚠️ 权限在这里**只做入口守卫，不做数据保护**：后端那 6 条台账接口是 admin 闸门，
 * 路由守卫只是「别把人送进一张满屏 403 的空壳」。两边判据必须一致
 * （`system:admin` → `isAdmin()`，其余 → `hasPerm()`），这就是 `canSeeNavItem` 的职责。
 */

/** 工作台页面（顺序 = 侧栏顺序，见 src/nav/index.js 的 NAV_ITEMS） */
export const workbenchRoutes = [
  {
    path: '/orders',
    name: 'WorkOrderList',
    component: WorkOrderList,
    meta: { group: 'order', key: 'workOrder', title: '工单汇总', perm: ADMIN_PERM },
  },
  {
    path: '/orders/picking',
    name: 'PickingList',
    component: PickingList,
    meta: { group: 'order', key: 'material', title: '领料汇总', perm: ADMIN_PERM },
  },
  {
    path: '/orders/inbound',
    name: 'InboundList',
    component: InboundList,
    meta: { group: 'order', key: 'inbound', title: '入库汇总', perm: ADMIN_PERM },
  },
  {
    path: '/orders/costing',
    name: 'CostingView',
    component: CostingView,
    meta: { group: 'order', key: 'costing', title: '核算', perm: ADMIN_PERM },
  },
  {
    path: '/materials',
    name: 'StockView',
    component: StockView,
    meta: { group: 'materials', key: 'stock', title: '物料查询' },
  },
  {
    /*
     * 采购拆成两页（变更-148，2026-10-22）：
     *   /purchase/board  看板 —— 四列、只看未到货，"今天该催谁"
     *   /purchase/entry  录入 —— 原来那张 10 列表，擅长填不擅长读
     *
     * `/purchase` 保留成**重定向**，不是简单改路径：抽屉/收藏里已有的 `/purchase`
     * 链接（以及后端日志里的 referer）都还会打到这里，404 是最难解释的那种故障。
     */
    path: '/purchase',
    redirect: '/purchase/board',
  },
  {
    path: '/purchase/board',
    name: 'PurchaseBoardView',
    component: PurchaseBoardView,
    meta: { group: 'purchase', key: 'purchaseBoard', title: '采购看板', perm: ADMIN_PERM },
  },
  {
    path: '/purchase/entry',
    name: 'PurchaseView',
    component: PurchaseView,
    meta: { group: 'purchase', key: 'purchase', title: '采购录入', perm: ADMIN_PERM },
  },
  {
    /*
     * 设备也拆两页（变更-150）：看板看「还缺什么」，维护页负责填与细筛。
     * /equipment 保持指向维护页 —— 它已经在书签和文档里被引用过，改它没有收益。
     */
    path: '/equipment/board',
    name: 'EquipmentBoardView',
    component: EquipmentBoardView,
    meta: { group: 'equipment', key: 'equipmentBoard', title: '设备看板', perm: 'equipment:edit' },
  },
  {
    path: '/equipment',
    name: 'EquipmentView',
    component: EquipmentView,
    meta: { group: 'equipment', key: 'equipment', title: '设备数据维护', perm: 'equipment:edit' },
  },
  {
    path: '/equipment/vessel',
    name: 'VesselView',
    component: VesselView,
    meta: { group: 'equipment', key: 'vessel', title: '压力容器体积计算' },
  },
  {
    path: '/equipment/electricity',
    name: 'ElectricityView',
    component: ElectricityView,
    meta: { group: 'equipment', key: 'electricity', title: '电费预提' },
  },
  {
    path: '/stats/weekly',
    name: 'WeeklyView',
    component: WeeklyView,
    meta: { group: 'stats', key: 'weekly', title: '周统计' },
  },
  {
    path: '/stats/daily',
    name: 'DailyView',
    component: DailyView,
    meta: { group: 'stats', key: 'daily', title: '日报表记录' },
  },
  {
    path: '/stats/tank-level',
    name: 'TankLevelView',
    component: TankLevelView,
    meta: { group: 'stats', key: 'tankLevel', title: '月底储罐液位记录' },
  },
  {
    path: '/maintain/import',
    name: 'ImportView',
    component: ImportView,
    meta: { group: 'maintain', key: 'import', title: '文件导入', perm: 'work_order:import' },
  },
  {
    path: '/maintain/image-parse',
    name: 'ImageParseView',
    component: ImageParseView,
    meta: { group: 'maintain', key: 'imageParse', title: '图片解析', perm: 'work_order:import' },
  },
  {
    path: '/archive',
    name: 'ArchiveView',
    component: ArchiveView,
    // 无 perm：与导航同口径（全员可见）
    meta: { group: 'maintain', key: 'archive', title: '资料归档' },
  },
]

export const routes = [
  {
    path: '/login',
    name: 'Login',
    component: Login,
  },
  {
    /*
     * 自助注册（变更-129）：与登录页同级，不需要任何权限（游客就是来注册的）。
     */
    path: '/register',
    name: 'Register',
    component: Register,
    meta: { title: '注册' },
  },
  {
    /*
     * 内部推广落地页。给厂内同事与领导的导览页，不是工作台的一部分。
     *
     * 用**懒加载**：这一页要引用三张截图资源，且与工作台的首屏毫无关系。
     * 静态 import 会把它的代码塞进主包，拖慢真正天天要用的工作台。
     *
     * ⚠️ 它在 AppShell **之外**：落地页是整页排版，套上侧栏与顶栏就成另一张页面了。
     */
    path: '/intro',
    name: 'Intro',
    component: () => import('../views/Intro.vue'),
  },
  {
    /*
     * 工作台 = **壳 + 子路由**。
     *
     * 壳（AppShell）持有侧栏、顶栏与主区；`<router-view />` 在主区里，14 个页面
     * 都是它的子路由。这样 /login 与 /intro 天然在壳外面，不用在壳里写
     * 「当前是不是工作台」这种第二位真值。
     */
    path: '/',
    component: AppShell,
    /*
     * 首页 = **第一个可见页**，不是固定的 /orders。
     *
     * 未登录 / 非 admin 时「工单汇总」本就不可见（决策-004），固定重定向过去
     * 会落到一个被守卫弹回来的地址上，白屏一次。改造前这条兜底是
     * `watch(visibleTabs, …, { immediate: true })` 把 activeTab 拨到第一个可见页 ——
     * 同一个意图，现在由 redirect 表达。
     *
     * 默认不需要登录：只读浏览对所有人开放。「写入数据库」的功能（文件导入、
     * 图片解析、工单图片上传/删除）由页面内按权限显隐控制，不在路由上拦。
     */
    redirect: () => firstVisiblePath(),
    children: workbenchRoutes,
  },
  {
    /*
     * 兜底路由。没有它时，地址打错会渲染出一张空白页、且没有任何回去的路——
     * 对靠书签和转发链接进工作台的人来说，这比报错更难排查。
     *
     * 必须放在最后：Vue Router 按数组顺序匹配，这条会吞掉所有未命中的路径。
     * 懒加载，理由同 /intro——几乎不会被访问的页面不该占主包体积。
     */
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('../views/NotFound.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to, from, next) => {
  // 已登录时不再停留在登录页
  if (to.path === '/login' && isLoggedIn()) {
    next({ path: '/' })
    return
  }

  /*
   * 变更-129 分层访问：**不再把没有权限的人重定向走**。
   *
   * 使用方要求"游客也能看到所有功能，点击锁定的才提示注册"。锁定页必须**能进来**，
   * 进来后由 AppShell 渲染一张「需要注册 / 需要管理员」的卡片 —— 这样链接可以照常分享，
   * 打开的人看到的是明确的原因和出口，而不是被无声弹走（那只会让人以为网站坏了）。
   *
   * 所以这里只保留"登录页在已登录时跳走"这一条；权限判断全部下放到界面层。
   */

  next()
})

export default router
