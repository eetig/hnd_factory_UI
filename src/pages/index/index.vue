<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { onBackPress, onUnload, onPullDownRefresh } from '@dcloudio/uni-app'
import { useMessage, useToast } from 'wot-design-uni'
import dayjs from 'dayjs'
import request from '../../api/request'
import { uploadFiles } from '../../api/upload'
import { resolveAssetUrl, resolveVesselImage } from '../../api/config'
import { clearAuth, getRoleName, hasPerm, isAdmin, isLoggedIn } from '../../api/auth'
import { APP_ENV, ACTIVE_ENV } from '../../api/env'
import ProductSelectDialog from '../../components/ProductSelectDialog.vue'
import DateField from '../../components/DateField.vue'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import FilterHeaderCell from '../../components/FilterHeaderCell.vue'
import ThemeToggle from '../../components/ThemeToggle.vue'
import NavDrawer from '../../components/NavDrawer.vue'
import DropdownMenu from '../../components/DropdownMenu.vue'
import ImageViewer from '../../components/ImageViewer.vue'
import TankLevelFormDialog from '../../components/TankLevelFormDialog.vue'
import TankLevelImageDialog from '../../components/TankLevelImageDialog.vue'
import EquipmentMaintenancePanel from '../../components/EquipmentMaintenancePanel.vue'
import { useTheme } from '../../composables/useTheme'
import { useWorkOrderData } from '../../composables/useWorkOrderData'
import { usePickData } from '../../composables/usePickData'
import { useInboundData } from '../../composables/useInboundData'
import { useGoodsMoveData } from '../../composables/useGoodsMoveData'
import { useMaterialStockData } from '../../composables/useMaterialStockData'
import { useEquipmentLedgerData } from '../../composables/useEquipmentLedgerData'
import { useTankLevelData, TANK_LEVEL_CATEGORIES } from '../../composables/useTankLevelData'
import { useTankLevelImages } from '../../composables/useTankLevelImages'
import { useVesselList } from '../../composables/useVesselList'
// Excel 导入只在 H5 端保留。
// 原因（已确认）：App 与小程序没有 DOM，uni-app 也没有内置的 xlsx 文件选择器
//（uni.chooseFile 仅 H5 支持，小程序只能用 chooseMessageFile 从微信会话里选），
// 且「一次传 N 张图」的 multipart 也需要另做设计。
// 用条件编译整块排除，避免这笔代码进不了任何一端的包。
// #ifdef H5 || APP-PLUS
import WorkOrderImport from '../../components/WorkOrderImport.vue'
// #endif
import ImageParse from '../../components/ImageParse.vue'
import { REPORT_ORDER_TYPES, getReportOrderType } from '../../constants/orderTypes'
import { normalizeImageList } from '../../utils/image'
import { UTubeBundle, shellVolumeMm3 } from '../../utils/vesselVolume'
import {
  formatDate,
  getToday,
  getFirstDayOfCurrentMonth,
  getLastWeekMonday,
  getLastWeekSunday,
  formatMonthDay,
  formatQty,
  normalizeMaterialName,
} from '../../utils/format'
import 'dayjs/locale/zh-cn'
import updateLocale from 'dayjs/plugin/updateLocale'

dayjs.extend(updateLocale)
dayjs.updateLocale('zh-cn', { weekStart: 1 })
dayjs.locale('zh-cn')

// 抽屉底部要显示当前后端环境。
// 后端地址（ACTIVE_ENV.apiOrigin）是**构建期内联的常量**，包里连的是哪套后端
// 在打包那一刻就定了 —— 写出来是为了现场自查：装上手机扫一眼就能确认，
// 而不是等「连不上后端」了再回头猜（复盘见 UNIAPP迁移说明.md 第 10.5 节）。
const ENV_TIP = APP_ENV === 'remote' ? '线上' : '本机联调'
const envTip = `${ENV_TIP} · ${ACTIVE_ENV.apiOrigin || '同源入口'}`

// 提示与确认框：wot-design-uni 用 provide/inject 在组件树里共享实例。
// 本页调用 useToast()/useMessage() 会 provide 出选项 ref，
// 模板里的 <wd-toast/>、<wd-message-box/> 以及子组件（ImageParse 等）
// 再调用同名方法时会 inject 到同一份状态 —— 所以整页共用一个提示通道。
const toast = useToast()
const message = useMessage()

// 主题：颜色本体是 App.vue 里的两组 CSS 变量，这里只拿「当前是哪套 + 切一下」。
// 深色是默认值（写在 page 上），浅色靠给页面根 view 加 .theme-light。
// isLight 在这里多担一件事：储罐底图深浅两版是两个资源，按主题挑 src（见 VESSELS.imageDark）。
const { isLight, themeClass, wotTheme, themeVars } = useTheme()

/* 底部安全区（Home Indicator），喂给 App.vue 的 .pager-dock 与 .page 底部补白。
   为什么走 JS 而不是 CSS 的 env(safe-area-inset-bottom)：
     ① 本仓没有 env() 先例，App 端/小程序的 CSS 支持面一贯按最保守的来；
     ② uni 在 H5 端**就是**把 env() 包成 getSystemInfoSync().safeAreaInsets
        （造一个隐藏元素量它的 padding-bottom），取这个值等于取 env()；
     ③ wd-popup 的底部安全区就是这么取的，本 App 每个底部弹层在三端都靠它
        把按钮从白条上让开 —— 同一条已在真机跑通的路；
     ④ 仓内已有先例：NavDrawer.vue 的 uni.getSystemInfoSync && uni.getSystemInfoSync()。
   ⚠️ 取值顺序与 wot 相反：**先取 safeAreaInsets**。wot 在小程序用的
      screenHeight - safeArea.bottom 在 H5 桌面浏览器（窗口比屏幕矮一大截）
      会算出一个很大的假值，底栏会被凭空垫高。 */
function readSafeAreaBottom() {
  try {
    const info = (uni.getSystemInfoSync && uni.getSystemInfoSync()) || {}
    const insets = info.safeAreaInsets
    if (insets && typeof insets.bottom === 'number') {
      return Math.max(0, Math.round(insets.bottom))
    }
    // 老基础库没有 safeAreaInsets 时兜底（小程序这两个值都是屏幕坐标，可相减）
    const area = info.safeArea
    if (area && info.screenHeight) {
      return Math.max(0, Math.round(info.screenHeight - (area.bottom || 0)))
    }
  } catch (e) {
    // 取不到就按 0：退化成"不垫安全区"，与改造前一样，不会更差
  }
  return 0
}

const safeBottom = ref(readSafeAreaBottom())
// 挂到 .page 上（不是 .pager-dock 上）：.page 是整棵树的祖先，
// index.vue 与 WorkOrderImport.vue 两处的底栏都能继承到。
// 用字符串形式：wot 的 config-provider 注入 --wot-* 用的就是字符串，三端都验过。
const pageVars = computed(() => `--ui-safe-bottom: ${safeBottom.value}px;`)

// Tab 元数据同时喂给三处：顶部栏（当前标题 + 说明）、抽屉菜单（图标 + 名称 + 说明）。
// icon 取值必须来自 wot-design-uni 的图标字体，写错会渲染成空白方块。
// adminOnly：台账明细，只给 admin（决策-004）。这 6 页背后的接口
// （/api/work-order、/api/pick、/api/inbound、/api/goods-move）在后端也被同一角色闸门拦着，
// 两边必须同进同退 —— 只藏前端等于数据公开，只锁后端等于非 admin 点进去满屏 403。
//
// 周统计（weekly）**不在此列**：它对所有人可见，数据走 /api/stats/weekly 这条
// 只吐汇总数的公开接口（同样见决策-004），不依赖上面那些明细。
// 顶部导航的四个大类（使用方 2026-10-07 定）。**顺序即抽屉里的分组顺序**，与电脑端一致。
// 分组只是「怎么看这些页」，不新增状态：当前组由 activeTab 推导（见 currentGroup）。
const TAB_GROUPS = [
  { key: 'order', label: '工单报工' },
  { key: 'stats', label: '数据统计' },
  { key: 'tools', label: '工具' },
  { key: 'maintain', label: '数据维护' },
]

const tabs = [
  { key: 'workOrder', label: '工单汇总', icon: 'list', hint: '查看当前所有生产工单及处理状态', adminOnly: true, group: 'order' },
  { key: 'material', label: '领料汇总', icon: 'cart', hint: '按日期与物料查看领料记录', adminOnly: true, group: 'order' },
  { key: 'inbound', label: '入库汇总', icon: 'download', hint: '按日期与物料查看入库记录', adminOnly: true, group: 'order' },
  { key: 'report', label: '工单报工', icon: 'check-rectangle', hint: '产成品完工数量与确认产量', adminOnly: true, group: 'order' },
  { key: 'costing', label: '工单核算', icon: 'chart-pie', hint: '工单成本构成与核算结果', adminOnly: true, group: 'order' },
  { key: 'materialCosting', label: '原辅料核算', icon: 'layers', hint: '原辅料消耗与成本核算', adminOnly: true, group: 'order' },
  { key: 'stock', label: '物料查询', icon: 'goods', hint: '按工厂 / 存储地点查看物料库存', group: 'tools' },
  // 图片解析：单据图片识别辅助录入（变更-003）。权限位与文件导入相同（work_order:import）
  { key: 'imageParse', label: '图片解析', icon: 'image', hint: '拍照识别单据并确认入库', perm: 'work_order:import', group: 'maintain' },
  { key: 'weekly', label: '周统计', icon: 'chart-bar', hint: '上周领料、入库与单耗汇总', group: 'stats' },
  { key: 'daily', label: '日报表记录', icon: 'clock', hint: '按日归集的生产报表记录', group: 'stats' },
  // 月底储罐液位记录：查询免登录（不带 perm），录入/删除按钮按 tank_level:edit 权限显隐
  { key: 'tankLevel', label: '月底储罐液位记录', icon: 'chart', hint: '按日期 / 属地查看车间储罐液位', group: 'stats' },
  { key: 'vessel', label: '压力容器体积计算', icon: 'chart-bubble', hint: '卧式 / 立式储罐液位体积换算', group: 'tools' },
  // 设备数据维护（2026-10-06）：台账原先只读、只能改 SQL。用**权限位**而不是 adminOnly ——
  // 写接口本来就是「仅 admin + 该权限位」两道，将来放开给非 admin 的维护员时不必动这里。
  { key: 'equipment', label: '设备数据维护', icon: 'edit', hint: '逐个设备核对台账 / 几何 / 底图', perm: 'equipment:edit', group: 'maintain' },
  { key: 'electricity', label: '电费预提', icon: 'money-circle', hint: '电价档位与电费预提测算', group: 'tools' },
  // #ifdef H5 || APP-PLUS
  { key: 'import', label: '文件导入', icon: 'file-excel', hint: '上传 Excel 批量导入工单', perm: 'work_order:import', group: 'maintain' },
  // #endif
]

/*
 * Tab 三态（2026-10-21：与 PC 端同步，使用方「手机App和微信小程序权限逻辑和PC端同步」）。
 *
 * PC 现在的口径是「**全部可见 + 锁定态**」：游客也看得见所有功能，点锁定的才提示注册。
 * 之前这里还是老的「按权限隐藏」—— 两个端给同一批人看不同的东西，运维对不上账。
 *
 *   available：马上能用
 *     · 游客：物料查询、压力容器体积计算（纯查询 / 纯计算，零业务风险）
 *     · 注册用户：除了"管理员专属"的全部
 *     · 管理员：全部
 *   locked：可见、灰化、点一下弹提示（未登录说"需要注册"，已登录非管理员说"需要管理员"）
 */
const PUBLIC_TAB_KEYS = new Set(['stock', 'vessel'])
const ADMIN_TAB_KEYS = new Set(['equipment'])

function tabState(tab) {
  if (!tab) return 'locked'
  if (PUBLIC_TAB_KEYS.has(tab.key)) return 'available'
  if (ADMIN_TAB_KEYS.has(tab.key)) return isAdmin() ? 'available' : 'locked'
  return isLoggedIn() ? 'available' : 'locked'
}

/** 全部 Tab（不过滤）—— 保留旧名字：下面 watch 与 activeTabMeta 都在读它 */
const visibleTabs = computed(() => tabs)

/** 当前账号马上能用的 Tab（首屏落地、退出后兜底都读它） */
const availableTabs = computed(() => tabs.filter((tab) => tabState(tab) === 'available'))

// 抽屉里按大类分组渲染。**只保留有可见页的组** —— 小程序端没有「文件导入」，
// 数据维护那组只剩两项；将来再少一项时也不该留一个空标题在那里。
const visibleGroups = computed(() =>
  TAB_GROUPS.map((group) => ({
    ...group,
    tabs: visibleTabs.value.filter((tab) => tab.group === group.key),
  })).filter((group) => group.tabs.length > 0),
)

// 权限相关的显隐都读 authState（响应式），登录/退出后立即生效，无需整页刷新
const loggedIn = computed(() => isLoggedIn())
const roleName = computed(() => getRoleName() || '已登录')

// ===== 导航（豆包式）=====
// 页面主体不再放 Tab 条：全部导航收进左侧抽屉，正文直接铺满。
// 切换入口是顶部栏左上角的菜单按钮。
// 抽屉本身（弹层 + 跟手拖拽 + 开合吸附 + 锁底层滚动）拆在 components/NavDrawer.vue 里，
// 原因见那边的说明：**跟手拖拽每帧都要改位移**，这份状态留在这个上万行的组件里，
// 会让每帧都重跑一次整页 render（12 个 Tab 的表格全部重新 patch），手感发涩。
// 拆出去之后每帧只重渲染那个小壳。
//
// 这里只保留命令式入口。
//
// ⚠️ 页面上的触摸**不再转发**给抽屉了（2026-10-10 去掉的）：原来这里把 `.page` 上的
//    touchstart/move/end 转给 NavDrawer 的 edgeStart/edgeMove，从左缘 22px 起手右滑
//    就能拉出抽屉 —— 而那正好是系统「从两侧向内滑」的手势的地盘，应用自己抢边缘
//    只会把系统手势废掉，而且只能覆盖左边那 22px。
//    边缘整个让给系统之后，「返回手势开抽屉」改由下面的 onBackPress 承担（两侧都能开），
//    所以抽屉的入口是：顶栏菜单按钮 + 返回手势。理由见 NavDrawer 顶部那段。
const navDrawer = ref(null)

function openMenu() {
  if (navDrawer.value) navDrawer.value.open()
}

function closeMenu() {
  if (navDrawer.value) navDrawer.value.close()
}

/*
 * 返回键 / 系统「从两侧向内滑」的返回手势 = 抽屉的开关（使用方 2026-10-10 定的口径）：
 *   **抽屉关着时按一下 → 打开；开着时按一下 → 收回。**
 *
 * 为什么挂在返回事件上、而不是像以前那样在页面左缘自己划一条起手区：
 *   ① 手指从左边滑、从右边滑，系统发下来的是**同一个返回事件** —— 挂在它上面，
 *      两侧都能开抽屉；应用自己在页面边缘抢起手区只能覆盖左边那 22px；
 *   ② 应用内的 touch 处理器永远先于系统手势拿到触摸，凡是应用自己抢边缘的方案，
 *      系统手势在这条边上就废了（使用方上一轮报的冲突就是这么来的）。
 *
 * 返回 true = 不执行框架默认行为：首页那一下默认是"再按一次退出应用"（框架自带的
 * quit），两个分支都要挡掉，否则开/合的同时还会蹦退出提示。
 * ⚠️ 代价：返回手势不再能退出应用 —— 要退请用系统的方式（返回桌面 / 任务切换器）
 *    或抽屉底部的「退出登录」。使用方明确要的就是这个口径，别再改回"返回退出"。
 * ⚠️ 这个钩子只在 App 端触发，H5 / 小程序端不会调用（那边返回由浏览器/平台自己管）。
 *    ⚠️ 别换成 onLastPageBackPress：本工程走的是 uni-app（非 uni-app x）的 Plus 运行时，
 *    它只把 ON_BACK_PRESS 交给 invokeHook（安卓返回键 → backbutton → navigateBack），
 *    ON_LAST_PAGE_BACK_PRESS 只在 uni.x.* 那几个运行时里用。
 */
onBackPress(() => {
  if (!navDrawer.value) return false // 抽屉还没挂上（理论上只在首帧之前）：交回框架默认行为
  if (navDrawer.value.isOpen()) closeMenu()
  else openMenu()
  return true
})

// 导航列表的起手/松手：告诉 NavDrawer"这次手势在列表里"，它才不会把默认行为挡掉。
// （列表在插槽里，组件自己够不着，所以由这边打标。）
function onListTouchStart() {
  if (navDrawer.value) navDrawer.value.setListGesture(true)
}
function onListTouchEnd() {
  if (navDrawer.value) navDrawer.value.setListGesture(false)
}

// 当前面板的元数据。顶部栏与抽屉菜单共用 tabs 这一份数据源，
// 所以新增 Tab 只要往 tabs 里加一条，两处自动同步。
const activeTabMeta = computed(
  () =>
    visibleTabs.value.find((tab) => tab.key === activeTab.value) || {
      label: '工单汇总',
      hint: '查看当前所有生产工单及处理状态',
    },
)

/* 回到页面顶部。
   两处用：换 Tab（下面 handleTabChange）、翻页（各分页器的 @change）——
   都是"整段内容换了一批"，停在原地会看到新一页中间的一截。
   翻页尤其需要：分页栏已固定到屏幕底部（见 App.vue 的 .pager-dock），
   按钮不再随内容移动，若不回顶，新一页落在第几行取决于上一页的滚动位置，不可预测。 */
function scrollPageToTop() {
  uni.pageScrollTo({ scrollTop: 0, duration: 260 })
}

function handleTabChange(key) {
  if (key === activeTab.value) return

  activeTab.value = key
  // 换 Tab 等价于换页：回到顶部，避免停在上一页的滚动位置
  scrollPageToTop()
}

// 抽屉里点某一项：先收起抽屉再切面板 —— 抽屉的收起动画与面板入场动画重叠，观感更顺
/**
 * 锁定项的提示（与 PC 的三句话一致）：
 *   未登录 → 「需要注册」+ 去注册
 *   已登录非管理员 → 「需要管理员」+ 换个账号登录
 * 用 showModal 而不是 toast：要给一个**出口**，否则人只能退出去自己找登录/注册入口。
 */
function promptLocked(tab) {
  if (!isLoggedIn()) {
    uni.showModal({
      title: '需要注册',
      content: '这个功能需要注册后才能使用',
      confirmText: '去注册',
      cancelText: '以后再说',
      success: (res) => {
        if (res.confirm) {
          closeMenu()
          uni.navigateTo({ url: '/pages/register/register' })
        }
      },
    })
    return
  }

  uni.showModal({
    title: '需要管理员',
    content: '这个功能需要管理员权限。可以换个管理员账号登录，或联系管理员开通。',
    confirmText: '换个账号登录',
    cancelText: '知道了',
    success: (res) => {
      if (res.confirm) {
        closeMenu()
        goLogin()
      }
    },
  })
}

function selectTabFromMenu(key) {
  const tab = tabs.find((item) => item.key === key)
  // 锁定项：原地弹提示，**不切换面板** —— 切过去也只会是一片空表格
  if (tab && tabState(tab) === 'locked') {
    promptLocked(tab)
    return
  }

  // 走 closeMenu（带收起动画），不是直接置 false —— 见 NavDrawer 里 close() 的说明
  closeMenu()
  handleTabChange(key)
}

function logoutFromMenu() {
  closeMenu()
  handleLogout()
}

function loginFromMenu() {
  closeMenu()
  goLogin()
}

function goLogin() {
  // 原来是 vue-router 的 router.push('/login')。
  // uni-app 用页面栈：navigateTo 压栈（登录页有返回按钮），比 reLaunch 更贴合「去登录再回来」的语义。
  uni.navigateTo({ url: '/pages/login/login' })
}

async function handleLogout() {
  try {
    await request.post('/api/logout')
  } catch {
    // 退出接口异常不影响本地凭据清理
  }

  clearAuth()
  // 退出即回到只读浏览：查询类接口（物料 / 周统计 / 储罐液位 …）本就免登录，数据无需重取；
  // 台账明细那 6 个 Tab（决策-004）与写入类按钮会随 authState 变化自动隐藏。
  // 已经取回来的明细还留在内存里，但 Tab 与面板都不可见了，不会再展示出来。
  //
  // 原来这里还有一句 router.replace('/')，在单页应用里等价于「留在本页」；
  // uni-app 里没有等价且必要的操作（reLaunch 到当前页反而会重建页面、白重取一次数据），
  // 所以直接省掉。
}

// 工单报工表格列
const reportColumns = [
  { key: 'index', label: '序号', width: 'w-10', align: 'center' },
  { key: 'orderType', label: '工单类型', width: 'w-20' },
  { key: 'materialDesc', label: '产成品', width: 'w-40' },
  { key: 'orderQty', label: '订单数量', width: 'w-20', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-20', align: 'right' },
]

const activeTab = ref('workOrder')

// 切换登录态后，原先所在 Tab 可能已不可见 —— 兜底切到第一个可见 Tab，
// 否则会停在一个空白的 activeTab 上。
//
// immediate 是必须的：非 admin 打开页面时首屏默认 Tab（工单汇总）本就不可见，
// 而 visibleTabs 只在「值发生变化」时才触发回调，首次渲染的可见列表
// 是在这之前就定下来的 —— 不加 immediate 页面会停在隐藏面板上，看起来一片空白。
// 同理，这个 watch 必须放在 activeTab 声明之后（immediate 会立刻读到它，放前面撞 TDZ）。
watch(availableTabs, (list) => {
  // 兜底只在"当前 Tab 不可用"时动 —— 否则每次权限变化都会把人踢回第一个 Tab
  if (list.length && !list.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = list[0].key
  }
}, { immediate: true })

// 工单数据与筛选（2026-10-10 整改：筛选/分页都在服务端）
// 工单报工与工单核算原先读这份数据的「全量筛选后」数组，现在各自读 workOrderSummaryRows
const {
  tableData,
  pageNum,
  pageSize,
  total,
  loading,
  errorMessage,
  startDate,
  endDate,
  productFilter,
  orderTypeFilter,
  orderNoFilter,
  productDialogVisible,
  orderTypeDialogVisible,
  orderNoDialogVisible,
  productOptions,
  orderTypeOptions,
  orderNoOptions,
  workOrderSummaryRows,
  loadWorkOrderPage,
  reloadWorkOrders,
  fetchWorkOrders,
  fetchWorkOrderSummary,
  openProductDialog,
  handleProductSelected,
  clearProductFilter,
  openOrderTypeDialog,
  handleOrderTypeSelected,
  clearOrderTypeFilter,
  openOrderNoDialog,
  handleOrderNoSelected,
  clearOrderNoFilter,
} = useWorkOrderData()

// 领料汇总数据（原辅料核算取 pickSummaryRows —— 服务端按物料汇总的结果）
const {
  pickTableData,
  pickPageNum,
  pickPageSize,
  pickTotal,
  pickLoading,
  pickError,
  pickStartDate,
  pickEndDate,
  pickMaterialDialogVisible,
  pickMaterialFilter,
  pickMaterialOptions,
  pickSummaryRows,
  fetchPickRecords,
  fetchPickSummary,
  reloadPickRecords,
  loadPickPage,
  openPickMaterialDialog,
  handlePickMaterialSelected,
  clearPickMaterialFilter,
} = usePickData()

// 物料库存（「物料查询」面板）
const {
  stockTableData,
  stockPageNum,
  stockPageSize,
  stockTotal,
  stockLoading,
  stockError,
  stockKeyword,
  stockOnlyInStock,
  fetchStockRecords,
  applyStockFilter,
  getStockPageData,
  formatStockQty,
  displayText,
} = useMaterialStockData()

// 库存为空的提示。
// ⚠️ 「文件导入」只在 H5 与 App 端存在（小程序端没有文件选择器，见 UNIAPP迁移说明 §5.1），
//    小程序端不能把提示指向一个不存在的入口 —— 否则用户找半天找不到。
let stockImportHint = '还没有导入过库存汇总，请在电脑端（网页版）导入库存表'
// #ifdef H5 || APP-PLUS
stockImportHint = '还没有导入过库存汇总，可在「文件导入」里上传库存表'
// #endif

/** 「只看有库存」开关：改完立刻重过滤 */
function toggleStockOnlyInStock() {
  stockOnlyInStock.value = !stockOnlyInStock.value
  applyStockFilter()
}

// ===== 月底储罐液位记录 =====
// 数据层是模块级单例，面板与两个弹层读同一份状态。
// 取数**不进 onMounted**：这个 Tab 一个月才用几次，没必要在首屏就多打两个接口 ——
// 改成首次切到该 Tab 时才拉（与压力容器底图同一个思路，见 watch(activeTab)）。
const {
  tankLevelTableData,
  tankLevelPageNum,
  tankLevelPageSize,
  tankLevelTotal,
  tankLevelLoading,
  tankLevelError,
  tankLevelStartDate,
  tankLevelEndDate,
  tankLevelLocation,
  tankLevelCategory,
  tankLevelKeyword,
  tankLevelLocationOptions,
  getTankLevelPageData,
  fetchTankLevelRecords,
  fetchTankLevelLocations,
  reloadTankLevelRecords,
  ensureTankLevelLoaded,
  resetTankLevelFilters,
} = useTankLevelData()

// 设备数据维护：这里只取「重拉第一页」一个函数 —— 下拉刷新时用它。
// 模块级单例，与 EquipmentMaintenancePanel 里那套是同一份状态。
const { loadLedger } = useEquipmentLedgerData()

// 录入与删除按钮的显隐（不是安全边界，后端每个写接口各自鉴权）
const canEditTankLevel = computed(() => hasPerm('tank_level:edit'))

// 列与线下台账（月底车间各储罐液位记录表）对应；数值列的表头直接带单位，
// 免得与「压力容器体积计算」里的 m³ 混读。
// 电脑端还有「所属 / 物料 / 容器编号」三列，使用方已要求撤掉，这里也不放。
const TANK_LEVEL_COLUMNS = [
  { key: 'index', label: '序号', width: 'w-10', align: 'center' },
  { key: 'recordDate', label: '记录日期', width: 'w-24' },
  { key: 'location', label: '属地', width: 'w-20' },
  { key: 'tankName', label: '容器名称', width: 'w-32', wrap: true },
  { key: 'levelValue', label: '容器液位 (mm)', width: 'w-24', align: 'right' },
  { key: 'theoreticalWeight', label: '理论质量 (kg)', width: 'w-24', align: 'right' },
  { key: 'images', label: '图据', width: 'w-16' },
]

// 属地下拉（选项来自 /api/tank-level/locations）与所属下拉共用一个底部弹层组件
const tankLevelLocationDialogVisible = ref(false)
const tankLevelCategoryDialogVisible = ref(false)

// 属地 / 所属下拉：选中与清空都算「换了筛选条件」，必须**回到第 1 页**再查 ——
// 不回第 1 页的话，用户在第 3 页改条件后很可能落在一个已越界的页码上，看到空表
function handleTankLevelLocationSelected(value) {
  tankLevelLocation.value = value
  reloadTankLevelRecords()
}

function clearTankLevelLocation() {
  tankLevelLocation.value = ''
  reloadTankLevelRecords()
}

function handleTankLevelCategorySelected(value) {
  tankLevelCategory.value = value
  reloadTankLevelRecords()
}

function clearTankLevelCategory() {
  tankLevelCategory.value = ''
  reloadTankLevelRecords()
}

/** 有没有筛选条件：决定空表提示语是「没查到」还是「本来就没数据」 */
const tankLevelHasFilter = computed(() =>
  Boolean(tankLevelLocation.value || tankLevelCategory.value || tankLevelKeyword.value.trim()),
)

// 表单弹层：点任意一行打开（record 为 null 时是新增）。
// 没有编辑权限时同一个弹层呈现成只读详情 —— 看详情不该被权限挡住。
const tankLevelFormVisible = ref(false)
const tankLevelFormRecord = ref(null)

function openTankLevelForm(record = null) {
  tankLevelFormRecord.value = record
  tankLevelFormVisible.value = true
}

function openTankLevelCreate() {
  openTankLevelForm(null)
}

// 图据弹层的开关与请求都在 useTankLevelImages（模块级单例）里，这里直接用它的入口。
// 弹层里的大图走 uni.previewImage（在 PhotoGrid 里），不用页面上这个全局查看器。
const { openImageDialog: openTankLevelImages } = useTankLevelImages()

// ===== 列表里的图据缩略图 =====
// 与领料 / 入库那套同一个思路（缩略图 → 原图 → 隐藏，露出底层占位图标），
// 但那两处的数据源是记录上的单个 thumbnailUrl / imageUrl，这里是一组 images，故单独一份。
const tankLevelThumbFallbacks = ref({})
const tankLevelHiddenThumbs = ref({})

function tankLevelThumbKey(record) {
  return String(record?.id ?? `${record?.recordDate ?? ''}-${record?.tankName ?? ''}`)
}

/** 第一张照片的地址（缩略图优先，缺了就用原图）*/
function tankLevelThumbSrc(record) {
  const first = record?.images?.[0]
  if (!first) return ''

  const key = tankLevelThumbKey(record)
  return resolveAssetUrl(tankLevelThumbFallbacks.value[key] || first.thumbnailUrl || first.url)
}

function handleTankLevelThumbError(event, record) {
  const first = record?.images?.[0]
  const el = event?.target
  if (!first || !el) return

  const key = tankLevelThumbKey(record)
  const original = resolveAssetUrl(first.url)

  // 用 getAttribute('src') 比较：el.src 会被补成绝对 URL，与相对路径永远不相等
  if (original && el.getAttribute('src') !== original) {
    tankLevelThumbFallbacks.value = { ...tankLevelThumbFallbacks.value, [key]: original }
    return
  }
  el.style.display = 'none'
  tankLevelHiddenThumbs.value = { ...tankLevelHiddenThumbs.value, [key]: true }
}

// 入库汇总数据（工单核算取 inboundSummaryRows —— 服务端按物料汇总的结果）
const {
  inboundTableData,
  inboundPageNum,
  inboundPageSize,
  inboundTotal,
  inboundLoading,
  inboundError,
  inboundStartDate,
  inboundEndDate,
  inboundMaterialDialogVisible,
  inboundMaterialFilter,
  inboundMaterialOptions,
  inboundSummaryRows,
  fetchInboundRecords,
  fetchInboundSummary,
  reloadInboundRecords,
  loadInboundPage,
  openInboundMaterialDialog,
  handleInboundMaterialSelected,
  clearInboundMaterialFilter,
} = useInboundData()

// 货物移动数据（原辅料核算的「已报工数」来源；取的是服务端「按物料 + 来源库位」的汇总）
const {
  goodsMoveSummaryRows,
  goodsMoveError,
  goodsMoveStartDate,
  goodsMoveEndDate,
  goodsMoveQtyMap,
  fetchGoodsMoveSummary,
} = useGoodsMoveData()

const imageList = ref([])
const currentIndex = ref(0)
const currentMaterialDesc = ref('')
const currentConfirmedQty = ref('')
const currentOrderNo = ref('')
const imageDialogVisible = ref(false)
const imageUploading = ref(false)
const imageDeleting = ref(false)

// 工单原图给内嵌查看器用的地址数组（与下面的 imageList 同源）
const workOrderViewerUrls = computed(() => imageList.value.map((item) => resolveAssetUrl(item.url)))

// 工单报工数据：以「工单类型 + 产成品」为行、把订单数量与确认产量按组求和。
//
// ⚠️ 2026-10-10 整改：这一页**不是列表**，是对全量工单做 group by 的聚合表 ——
// 分页数据喂不了它（拿第 1 页汇总只会得到前 10 条），所以分组求和搬到了服务端
// （/api/work-order/summary-by-type-material，按工单号前缀 + 产成品分组）。
// 前端只剩展示口径：类型识别不出的行不进表（与原实现一致）、按类型字典顺序再按品名排。
const reportRows = computed(() =>
  workOrderSummaryRows.value
    .filter((row) => row.orderType)
    .map((row) => ({
      orderType: row.orderType,
      materialDesc: row.materialName,
      orderQty: formatQty(Number(row.orderQty) || 0),
      confirmedQty: formatQty(Number(row.confirmedQty) || 0),
    }))
    .sort((left, right) => {
      const byType = REPORT_ORDER_TYPES.findIndex((type) => type.label === left.orderType) -
        REPORT_ORDER_TYPES.findIndex((type) => type.label === right.orderType)

      if (byType !== 0) return byType

      return left.materialDesc.localeCompare(right.materialDesc, 'zh-CN')
    }),
)

const columns = [
  { key: 'index', label: '序号', width: 'w-10', align: 'center' },
  { key: 'planStartDate', label: '基本开始日期', width: 'w-24' },
  { key: 'orderNo', label: '工单号', width: 'w-28' },
  { key: 'orderType', label: '工单类型', width: 'w-24' },
  { key: 'materialCode', label: '物料编码', width: 'w-28' },
  { key: 'materialDesc', label: '产成品', width: 'w-40' },
  { key: 'orderQty', label: '订单数量', width: 'w-20', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-20', align: 'right' },
  { key: 'deliveredQty', label: '已交货数量', width: 'w-20', align: 'right' },
]


async function refreshImageList(order) {
  if (!currentOrderNo.value) {
    imageList.value = normalizeImageList(order?.imageList)
    return
  }

  const res = await request.get('/api/work-order/image/list', {
    params: { orderNo: currentOrderNo.value },
  })
  imageList.value = normalizeImageList(res.data?.data || [])
}

function updateCurrentOrderImages(images) {
  const normalizedImages = normalizeImageList(images)
  // 只更新**当前页**里那一条：改造后前端不再持有全量工单（原先还会顺带给
  // allWorkOrders / tableDataAll 两份内存副本打补丁），而用户点的工单必在当前页上。
  // 图片另有 /api/work-order/image/list 兜底刷新（见 refreshImageList），不会漏。
  const currentOrder = tableData.value.find(
    (order) => String(order.orderNo) === String(currentOrderNo.value),
  )
  if (currentOrder) {
    currentOrder.imageList = normalizedImages
  }
  imageList.value = normalizedImages
}

async function openImageDialog(order) {
  currentMaterialDesc.value = order?.materialDesc || '-'
  currentConfirmedQty.value = order?.confirmedQty ?? '-'
  currentOrderNo.value = order?.orderNo || ''
  imageList.value = normalizeImageList(order?.imageList)
  currentIndex.value = 0
  imageDialogVisible.value = true

  await refreshImageList(order)
}

// 一次最多选几张。后端接口本身不限张数，这里只为避免一次选太多把上传拖很久
const MAX_IMAGE_PICK = 9

function openImagePicker() {
  if (imageUploading.value || !currentOrderNo.value) return

  // 改造前是隐藏的 <input type="file" multiple> + .click()，
  // 小程序/App 端没有 DOM，改用 uni.chooseImage（三端统一，且能直接调相机）
  uni.chooseImage({
    count: MAX_IMAGE_PICK,
    sizeType: ['original', 'compressed'],
    sourceType: ['camera', 'album'],
    success: (res) => {
      handleImageSelected(res.tempFilePaths || [])
    },
  })
}

function handleImportCancel() {
  activeTab.value = 'workOrder'
}

/**
 * 「数据被写过了，下次切 Tab 记得重拉」的标记。
 *
 * 两个写入口都会置位：
 *   · 文件导入（Excel）—— 会新增/更新工单、领料、入库、货物移动四类数据；
 *   · 图片解析确认入库 —— 同上（走的是同一条落库管线，见 useOcrConfirm）。
 *
 * 为什么需要它：页面是**单页 + v-show 切 Tab**，Tab 组件从不卸载，切来切去不会触发
 * 任何生命周期钩子。而领料汇总这类面板的数据现在只在「筛条件 / 翻页 / 下拉刷新」时才查 ——
 * 写完数据后如果用户切回面板而恰好不碰筛选条，就还停在上一次的查询结果上。
 * 所以这里记一笔，切 Tab 时统一重拉。
 *
 * ⚠️ 2026-10-10 之前这个标记只服务文件导入（判断条件还写死了 prevTab === 'import'），
 * 图片解析那条链路压根没通知过页面 —— 那条「入库成功了、汇总页看不到」的 bug 就出在这。
 */
const importDirty = ref(false)

/** 图片解析确认入库成功后置脏（事件来自 components/ImageParse.vue） */
function handleOcrConfirmed() {
  importDirty.value = true
  // 落库会同时影响领料/入库/库存/周统计与三个核算页，这里直接刷一遍；
  // 用户此时通常还停在图片解析页，切走时还会再统一重拉一次，成本可以忽略
  refreshAllData()
}

/** 切 Tab 时要重拉的明细数据（只有 admin 能看这几页，非 admin 连接口都调不动） */
function fetchAdminOnlyData() {
  if (!isAdmin()) return
  fetchWorkOrders()
  fetchPickRecords()
  fetchInboundRecords()
  fetchGoodsMoveSummary()
}

/**
 * 三个聚合页（工单报工 / 工单核算 / 原辅料核算）的数据源。
 *
 * 它们的分子分母都来自明细，明细变了就必须跟着重取 —— 分页之后没人会替它们刷新。
 */
function refreshSummaryData() {
  if (!isAdmin()) return
  fetchWorkOrderSummary()
  fetchPickSummary()
  fetchInboundSummary()
}

function refreshAllData() {
  fetchAdminOnlyData()
  refreshSummaryData()
  // 库存汇总也可能在这次导入里被更新
  fetchStockRecords()
  // 周统计走的是独立的汇总接口（非 admin 也要能看），不在上面的 admin 分支里
  fetchWeeklyStats()
}

function handleImportBack() {
  activeTab.value = 'workOrder'
}

function showPreviousImage() {
  if (!imageList.value.length) return
  currentIndex.value =
    (currentIndex.value - 1 + imageList.value.length) % imageList.value.length
}

function showNextImage() {
  if (!imageList.value.length) return
  currentIndex.value = (currentIndex.value + 1) % imageList.value.length
}

async function handleImageSelected(tempFilePaths) {
  if (!tempFilePaths.length || !currentOrderNo.value) return

  imageUploading.value = true

  try {
    // 改造点：原来是 `new FormData()` 一次 POST 传 N 张图。
    // uni.request 在任何端都发不了 FormData，multipart 只能走 uni.uploadFile，
    // 而后者一次只带一个文件 —— 于是改成循环单文件请求同一接口（见 api/upload.js）。
    // 后端若声明的是 MultipartFile[]，单元素数组天然合法，返回值也仍是「本次上传的图片列表」。
    const res = await uploadFiles({
      url: '/api/work-order/image/upload',
      name: 'files',
      files: tempFilePaths,
      formData: { orderNo: currentOrderNo.value },
    })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '图片上传失败。')
    }

    const uploadedImages = normalizeImageList(res.data?.data || [])
    if (uploadedImages.length) {
      updateCurrentOrderImages([...imageList.value, ...uploadedImages])
      currentIndex.value = imageList.value.length - 1
    } else {
      await fetchWorkOrders()
      // 在当前页里找（用户点的工单必在当前页上）—— 前端不再持有全量工单
      const currentOrder = tableData.value.find(
        (order) => String(order.orderNo) === String(currentOrderNo.value),
      )
      await refreshImageList(currentOrder)
    }
    toast.success('图片上传成功')
  } catch (error) {
    toast.error(error.response?.data?.msg || error.message || '图片上传失败，请重试。')
  } finally {
    imageUploading.value = false
  }
}

async function deleteImage(image) {
  if (!currentOrderNo.value || !image?.imageId) return

  try {
    await message.confirm({
      title: '确认删除图片',
      msg: '删除后将无法在当前工单中查看该图片，是否继续？',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  imageDeleting.value = true

  try {
    const res = await request.delete('/api/work-order/image/delete', {
      params: { imageId: image.imageId },
      data: { imageId: image.imageId },
    })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '图片删除失败。')
    }

    const remainingImages = imageList.value.filter(
      (item) => String(item.imageId) !== String(image.imageId),
    )
    updateCurrentOrderImages(remainingImages)
    if (currentIndex.value >= imageList.value.length) {
      currentIndex.value = Math.max(0, imageList.value.length - 1)
    }
    toast.success('图片已删除')
  } catch (error) {
    toast.error(error.response?.data?.msg || error.message || '图片删除失败，请重试。')
  } finally {
    imageDeleting.value = false
  }
}

// ===== 领料汇总 =====
const pickColumns = [
  { key: 'index', label: '序号', width: 'w-10', align: 'center' },
  { key: 'pickDate', label: '领料时间', width: 'w-24' },
  { key: 'materialName', label: '物料名称', width: 'w-40', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-28' },
  { key: 'pickQty', label: '领料数量', width: 'w-20', align: 'right' },
  { key: 'unit', label: '单位', width: 'w-16' },
  { key: 'imageUrl', label: '线下单据', width: 'w-16' },
]

// 单据大图的查看器状态（领料 / 入库共用一套 —— 同一时刻只可能打开一个）。
// 地址必须过 resolveAssetUrl：后端返回的是 /files、/thumbs 这类相对路径，
// 小程序与 App 端没有「同源」这个概念。
const imageViewerVisible = ref(false)
const imageViewerUrls = ref([])
const imageViewerIndex = ref(0)

function openImageViewer(url) {
  if (!url) return
  imageViewerUrls.value = [resolveAssetUrl(url)]
  imageViewerIndex.value = 0
  imageViewerVisible.value = true
}

function openPickImageDialog(record) {
  if (!record?.imageUrl) return
  openImageViewer(record.imageUrl)
}

/**
 * 列表图片加载失败的逐级降级（变更-001）：
 *   缩略图失败 → 回退原图 → 仍失败则隐藏，露出底层占位图标
 *
 * 改造前是直接改 DOM 的（el.dataset 记降级标记、el.src 换回原图、el.style.display 隐藏）。
 * 小程序与 App 端没有可操作的 DOM —— uni 的 <image> 只给一个 errMsg 事件，
 * 拿不到元素。所以改成用响应式状态驱动：按记录 key 记「已降级到原图」与「已隐藏」。
 */
const thumbnailFallbacks = reactive({})
const hiddenThumbnails = reactive({})

function imageKeyOf(record) {
  return String(record?.imageId ?? record?.imageUrl ?? record?.thumbnailUrl ?? '')
}

/** 当前该用的图片地址：经过降级链之后的结果 */
function resolveThumbnail(record) {
  const key = imageKeyOf(record)
  return thumbnailFallbacks[key] || record?.thumbnailUrl || record?.imageUrl || ''
}

function isThumbnailHidden(record) {
  return !!hiddenThumbnails[imageKeyOf(record)]
}

function handleImgError(event, record) {
  const key = imageKeyOf(record)

  // 第一级：缩略图失败了，回退原图
  if (record?.imageUrl && !thumbnailFallbacks[key]) {
    thumbnailFallbacks[key] = record.imageUrl
    return
  }

  // 第二级：原图也失败，隐藏，露出底层的占位图标
  hiddenThumbnails[key] = true
}



// ===== 入库汇总 =====
const inboundColumns = [
  { key: 'index', label: '序号', width: 'w-10', align: 'center' },
  { key: 'inboundDate', label: '入库时间', width: 'w-24' },
  { key: 'materialName', label: '物料名称', width: 'w-40', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-28' },
  { key: 'inboundQty', label: '领料数量', width: 'w-20', align: 'right' },
  { key: 'unit', label: '单位', width: 'w-16' },
  { key: 'imageUrl', label: '线下单据', width: 'w-16' },
]

// 入库单据大图：与领料共用同一个全屏查看器实例（同一时刻只可能打开一个），
// 这里只负责把地址塞进去并打开，见 openImageViewer。
function openInboundImageDialog(record) {
  if (!record?.imageUrl) return
  openImageViewer(record.imageUrl)
}

// ===== 工单核算 =====
const costingColumns = [
  { key: 'index', label: '序号', width: 'w-10', align: 'center' },
  { key: 'materialName', label: '已入库产成品', width: 'w-40', wrap: true },
  { key: 'materialCode', label: '产成品编码', width: 'w-28' },
  { key: 'inboundQty', label: '入库数', width: 'w-20', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-20', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-20', align: 'right' },
]

// 已报工数量：按归一化产成品名称汇总工单的确认产量。
//
// ⚠️ 2026-10-10 整改：数据源从「工单汇总当前筛选后的全量工单」换成服务端按
// 「工单类型 + 产成品」汇总的结果（workOrderSummaryRows）—— 分页之后前端已经没有全量了。
// 汇总行按名称再累一次即可，归一化口径（normalizeMaterialName）与改造前完全一致。
const reportedQtyMap = computed(() => {
  const map = new Map()

  for (const row of workOrderSummaryRows.value) {
    const key = normalizeMaterialName(row.materialName)
    if (!key) continue

    map.set(key, (map.get(key) || 0) + (Number(row.confirmedQty) || 0))
  }

  return map
})

// 工单核算：以已入库产成品（入库汇总当前筛选后的物料名称去重）为行，
// 入库数与已报工数汇总，差额为未报工数。
//
// ⚠️ 2026-10-10 整改：行与入库数都改读服务端按物料汇总的结果（inboundSummaryRows）——
// 入库汇总改成分页之后，前端手里只有当前页的 10 条，拿它做 group by 会得出「前 10 条的合计」。
// 筛选条件与入库汇总面板一致（同一个日期/物料区间），所以两边看到的仍是同一批数据。
const costingRows = computed(() => {
  const rows = new Map()

  // 入库数：来自入库汇总当前筛选后的数据，按物料名称去重
  for (const record of inboundSummaryRows.value) {
    const materialName = String(record.materialName ?? '').trim()
    const key = normalizeMaterialName(materialName)
    if (!key) continue

    if (!rows.has(key)) {
      rows.set(key, {
        materialName,
        materialCode: String(record.materialCode ?? '').trim(),
        inboundQty: 0,
        reportedQty: 0,
      })
    }

    rows.get(key).inboundQty += Number(record.inboundQty) || 0
  }

  // 已报工数：按产成品名称匹配工单报工数据
  for (const row of rows.values()) {
    row.reportedQty = reportedQtyMap.value.get(normalizeMaterialName(row.materialName)) || 0
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      inboundQty: formatQty(row.inboundQty),
      reportedQty: formatQty(row.reportedQty),
      unreportedQty: formatQty(row.inboundQty - row.reportedQty),
    }))
    .sort((left, right) => left.materialName.localeCompare(right.materialName, 'zh-CN'))
})

// ===== 原辅料核算 =====
// 暂照搬工单核算的列与计算逻辑，后续按原辅料规则单独调整（不影响工单核算）
const materialCostingColumns = [
  { key: 'index', label: '序号', width: 'w-10', align: 'center' },
  { key: 'materialName', label: '已领物料名称', width: 'w-40', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-28' },
  { key: 'pickQty', label: '领料数', width: 'w-20', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-20', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-20', align: 'right' },
]

// 物料库存列（页面按 物料编码 / 物料名称 / 规格 查物料信息；
// 名称与规格是后端联查 material_master 的结果，主数据没有则回退库存表那份）
// 工厂（列里恒为 1503）按使用方要求不展示
const STOCK_COLUMNS = [
  { key: 'index', label: '序号', width: 'w-10', align: 'center' },
  { key: 'materialCode', label: '物料编码', width: 'w-28' },
  { key: 'materialName', label: '物料名称', width: 'w-40', wrap: true },
  { key: 'spec', label: '规格', width: 'w-28', wrap: true },
  { key: 'storageLocation', label: '存储地点', width: 'w-16' },
  { key: 'unit', label: '基本计量单位', width: 'w-24' },
  { key: 'stockQty', label: '非限制使用的库存', width: 'w-32', align: 'right' },
  { key: 'storageDesc', label: '存储地点描述', width: 'w-28', wrap: true },
]

// 领料数换算系数（按物料编码，如 HND-V150_辅料包 ×3.2）
const MATERIAL_COSTING_QTY_FACTORS = {
  '112004292': 3.2,
}

// 派生行：领料数由其他物料折算，报工数取指定库位的货物移动
const MATERIAL_COSTING_DERIVED = [
  {
    materialCode: '111001792',
    materialName: '氯铂酸_150',
    sourceMaterialCode: '112004292', // HND-V150_辅料包
    qtyMultiplier: 20, // 领料数 = 辅料包领料数 × 20
    fromLocation: '5003', // 报工数仅统计来源库位 5003 的氯铂酸
    reportedMultiplier: 1000, // 报工数 = 该库位氯铂酸数量合计 × 1000
  },
  {
    materialCode: '111001792',
    materialName: '氯铂酸_171',
    sourceMaterialName: 'HND-V171_辅料包',
    qtyMultiplier: 20, // 领料数 = V171 辅料包领料数 × 20
    fromLocation: '5002', // 报工数仅统计来源库位 5002 的氯铂酸
    reportedMultiplier: 1000, // 报工数 = 该库位氯铂酸数量合计 × 1000
  },
]


// 原辅料核算：以领料汇总当前筛选后的物料名称去重为行，
// 领料数按物料累加，已报工数取货物移动数量合计。
//
// ⚠️ 2026-10-10 整改：两个数据源都换成服务端汇总结果 ——
// 领料数读 pickSummaryRows（按物料汇总），报工数读 goodsMoveSummaryRows（按物料 + 来源库位汇总）。
// 分页之后前端手里只有当前页，拿它做 group by 会得出「前 10 条的合计」。
// 下面的换算系数、派生行、差额与排序**一行没动** —— 那是报表口径，不属于数据源。
const materialCostingRows = computed(() => {
  const rows = new Map()

  // 领料数：来自领料汇总当前筛选后的数据，按物料名称去重
  for (const record of pickSummaryRows.value) {
    const materialName = String(record.materialName ?? '').trim()
    const key = normalizeMaterialName(materialName)
    if (!key) continue

    if (!rows.has(key)) {
      rows.set(key, {
        materialName,
        materialCode: String(record.materialCode ?? '').trim(),
        pickQty: 0,
        reportedQty: 0,
      })
    }

    rows.get(key).pickQty += Number(record.pickQty) || 0
  }

  // 领料数换算系数 + 已报工数：按物料编码处理
  for (const row of rows.values()) {
    const code = String(row.materialCode ?? '').trim()

    // 领料数乘以该物料的换算系数（无配置则为 1）
    row.pickQty *= MATERIAL_COSTING_QTY_FACTORS[code] ?? 1
    // 已报工数按物料编码汇总货物移动数量，先求和再取绝对值
    row.reportedQty = Math.abs(goodsMoveQtyMap.value.get(code) || 0)
  }

  // 派生行：领料数由源物料折算；报工数按物料编码 + 来源库位筛选货物移动后求和取绝对值
  for (const derived of MATERIAL_COSTING_DERIVED) {
    const sourceRow = [...rows.values()].find((row) => {
      if (
        derived.sourceMaterialCode &&
        String(row.materialCode ?? '').trim() === derived.sourceMaterialCode
      ) {
        return true
      }
      if (derived.sourceMaterialName) {
        return normalizeMaterialName(row.materialName) === normalizeMaterialName(derived.sourceMaterialName)
      }
      return false
    })
    const pickQty = (sourceRow?.pickQty ?? 0) * derived.qtyMultiplier

    // 已报工数：按物料编码汇总货物移动数量（服务端按「物料 + 来源库位」汇总后的结果，
    // 这里按物料编码再累一次），先求和再取绝对值
    const moveSum = goodsMoveSummaryRows.value
      .filter((record) => String(record.materialCode ?? '').trim() === derived.materialCode)
      .filter((record) => {
        if (!derived.fromLocation) return true
        return String(record.fromLocation ?? '').trim() === derived.fromLocation
      })
      .reduce((sum, record) => sum + (Number(record.moveQty) || 0), 0)

    rows.set(`derived:${derived.materialName}`, {
      materialName: derived.materialName,
      materialCode: derived.materialCode,
      pickQty,
      reportedQty: Math.abs(moveSum) * (derived.reportedMultiplier ?? 1),
    })
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      pickQty: formatQty(row.pickQty),
      reportedQty: formatQty(row.reportedQty),
      unreportedQty: formatQty(row.pickQty - row.reportedQty),
    }))
    // 领料数与报工数都为 0 的行不展示（如派生行缺少对应数据）
    .filter((row) => row.pickQty !== 0 || row.reportedQty !== 0)
    .sort((left, right) => left.materialName.localeCompare(right.materialName, 'zh-CN'))
})

// ===== 周统计 =====
// 表头（固定展示项，内容暂为固定值，后续再接入实际数据）
// width 是改造时补的：原来由 <colgroup> 里的 <col class="w-*"> 提供列宽，
// 改成 flex 后列宽必须落到单元格上，表头与数据行共用这里的一份定义。
const weeklyColumns = [
  { key: 'name', label: '名称', width: 'w-40' },
  { key: 'pickQty', label: '原料领用', width: 'w-20', align: 'right' },
  { key: 'remainingQty', label: '车间剩余', width: 'w-24', align: 'right' },
  { key: 'actualQty', label: '实际使用', width: 'w-20', align: 'right' },
  { key: 'unitConsumption', label: '单耗', width: 'w-24' },
]

// 周统计固定展示项定义（materialCode 为隐藏属性，仅用于查询，不展示）
// unitLabel 为单耗单位；unitFactor 为单耗换算系数（氯铂酸按克计，需 ×1000）；qtyFactor 为领用数量换算系数
const WEEKLY_ROW_DEFINITIONS = [
  { materialCode: '111001787', name: '三氯氢硅（kg）', unitLabel: '吨/吨', unitFactor: 1, qtyFactor: 1 },
  { materialCode: '111001786', name: '电石（kg）', unitLabel: '吨/吨', unitFactor: 1, qtyFactor: 1 },
  { materialCode: '112004292', name: '氯铂酸（g）', unitLabel: '克/吨', unitFactor: 1000, qtyFactor: 20 },
]

// 车间剩余：手动填写（按物料编码存放），默认全部为空，不填显示 /
const weeklyRemaining = ref(
  Object.fromEntries(WEEKLY_ROW_DEFINITIONS.map((row) => [row.materialCode, ''])),
)

// 150产品（HND-V150）物料编码
const WEEKLY_INBOUND_MATERIAL_CODE = '114001897'

// ===== 周统计取数（决策-004）=====
// 改造前这两个和在本地从 allInboundRecords / allPickRecords 现算，
// 而那两条明细接口现在只给 admin 了 —— 周统计对所有人可见，
// 所以改走 /api/stats/weekly：它只回汇总数，不回明细。
//
// ⚠️ 求和口径（闭区间、日期为空的记录照样计入）与改造前**完全一致**，
// 服务端实现见 WeeklyStatsServiceImpl；物料编码由前端传，后端不硬编码业务常量。
const WEEKLY_PICK_CODES = WEEKLY_ROW_DEFINITIONS.map((row) => row.materialCode)

// 查询区间：默认「上周一 ~ 上周日」。定义要放在下面那个 watch 之前 ——
// watch 的依赖数组是立刻就求值的，晚于它声明会撞上 TDZ。
const weeklyStartDate = ref(getLastWeekMonday())
const weeklyEndDate = ref(getLastWeekSunday())

const weeklyStats = ref({ pickQty: {}, inboundQty: {} })
const weeklyStatsLoading = ref(false)
const weeklyStatsError = ref('')

async function fetchWeeklyStats() {
  // 日期被清空时不发请求：后端把空值当「不限」，而「没选日期」在这里的预期是什么都不算。
  // 与改造前一致 —— 那时清掉结束日期，整张表也会变成 0。
  if (!weeklyStartDate.value || !weeklyEndDate.value) {
    weeklyStats.value = { pickQty: {}, inboundQty: {} }
    return
  }

  weeklyStatsLoading.value = true
  weeklyStatsError.value = ''

  try {
    const res = await request.get('/api/stats/weekly', {
      params: {
        start: weeklyStartDate.value,
        end: weeklyEndDate.value,
        pickMaterials: WEEKLY_PICK_CODES.join(','),
        inboundMaterials: WEEKLY_INBOUND_MATERIAL_CODE,
      },
    })

    if (res.data?.success === true) {
      weeklyStats.value = {
        pickQty: res.data.data?.pickQty || {},
        inboundQty: res.data.data?.inboundQty || {},
      }
    } else {
      weeklyStats.value = { pickQty: {}, inboundQty: {} }
      weeklyStatsError.value = res.data?.msg || '周统计加载失败，请稍后重试。'
    }
  } catch (error) {
    weeklyStats.value = { pickQty: {}, inboundQty: {} }
    weeklyStatsError.value = error.response?.data?.msg || '周统计加载失败，请稍后重试。'
  } finally {
    weeklyStatsLoading.value = false
  }
}

// 日期范围变了就重新取数（改造前是本地过滤，改一次不用请求）
watch([weeklyStartDate, weeklyEndDate], fetchWeeklyStats)

// 150产品入库数：接口已按区间汇总好，这里只取值
const weeklyInboundQty = computed(() =>
  formatQty(Number(weeklyStats.value.inboundQty?.[WEEKLY_INBOUND_MATERIAL_CODE]) || 0),
)

const weeklyInboundRow = computed(() => ({
  materialCode: WEEKLY_INBOUND_MATERIAL_CODE,
  name: '150产品入库数（kg）',
  value: weeklyInboundQty.value,
}))

// 原料领用：同上，值由 /api/stats/weekly 备好
function getWeeklyPickQty(materialCode) {
  const code = String(materialCode ?? '').trim()
  if (!code) return 0

  return formatQty(Number(weeklyStats.value.pickQty?.[code]) || 0)
}

const weeklyRows = computed(() => {
  const inboundQty = weeklyInboundQty.value

  return WEEKLY_ROW_DEFINITIONS.map((row) => {
    // 原料领用：领料汇总求和后乘以该物料的换算系数
    const pickQty = formatQty(getWeeklyPickQty(row.materialCode) * (row.qtyFactor ?? 1))
    // 实际使用 = 原料领用 − 车间剩余（车间剩余未填按 0 计）
    const remainingQty = Number(weeklyRemaining.value[row.materialCode]) || 0
    const actualQty = formatQty(pickQty - remainingQty)

    // 单耗 = 实际使用 / 150产品入库数 × 换算系数（固定保留 2 位小数）
    const unitConsumption = inboundQty > 0
      ? ((actualQty * (row.unitFactor ?? 1)) / inboundQty).toFixed(2)
      : '0.00'

    return {
      ...row,
      pickQty,
      actualQty,
      unitConsumption,
    }
  })
})

// 周统计页的工单明细表 —— ⚠️ **这张表在模板里没有渲染**（模板只有上面的周统计表与图片查看器；
// openWeeklyImageDialog / openWeeklyProductDialog / openWeeklyFilePicker 都没有调用点）。
// 它是迁移时留下的死代码。此处**只做最小维护**：把取数改成新接口的签名，
// 以免将来有人把它接回界面时踩到「接口已经改成分页了」这个坑。
// 建议单独开一次变更把它整块删掉，不要混在本次整改里。
const weeklyTableData = ref([])
const weeklyPageNum = ref(1)
const weeklyPageSize = ref(10)
const weeklyTotal = ref(0)
const weeklyLoading = ref(false)
const weeklyError = ref('')

// 标题：按所选日期范围生成，如「9月7日-9月13日周统计（截止9月13日晚8点）」
const weeklyTitle = computed(() => {
  const start = formatMonthDay(weeklyStartDate.value)
  const end = formatMonthDay(weeklyEndDate.value)
  return `${start}-${end}周统计（截止${end}晚8点）`
})
const weeklyImageList = ref([])
const weeklyCurrentIndex = ref(0)
const weeklyCurrentMaterialDesc = ref('')
const weeklyCurrentConfirmedQty = ref('')
const weeklyCurrentOrderNo = ref('')
const weeklyImageDialogVisible = ref(false)
const weeklyImageUploading = ref(false)
const weeklyImageDeleting = ref(false)

// 周统计原图给内嵌查看器用的地址数组（与上面的 weeklyImageList 同源）
const weeklyViewerUrls = computed(() => weeklyImageList.value.map((item) => resolveAssetUrl(item.url)))
const weeklyProductDialogVisible = ref(false)
const weeklyProductFilter = ref('')
/** 产成品候选：同样改由接口给（分页之后前端不再持有全量工单） */
const weeklyProductOptions = ref([])

async function fetchWeeklyProductOptions() {
  try {
    const res = await request.get('/api/work-order/filter-options', {
      params: { startDate: weeklyStartDate.value, endDate: weeklyEndDate.value },
    })
    weeklyProductOptions.value = Array.isArray(res.data?.data?.productNames)
      ? res.data.data.productNames
      : []
  } catch {
    weeklyProductOptions.value = []
  }
}

function normalizeWeeklyImage(image) {
  if (typeof image === 'string') {
    return { imageId: image, url: image }
  }

  return {
    imageId: image?.imageId ?? image?.id ?? '',
    url: image?.url ?? image?.imageUrl ?? image?.fileUrl ?? image?.path ?? '',
  }
}

function normalizeWeeklyImageList(images) {
  let imageValues = images

  if (typeof imageValues === 'string') {
    try {
      imageValues = JSON.parse(imageValues)
    } catch {
      imageValues = imageValues ? [imageValues] : []
    }
  }

  if (!Array.isArray(imageValues)) {
    imageValues = imageValues ? [imageValues] : []
  }

  return imageValues.map(normalizeWeeklyImage).filter((image) => image.url)
}

async function refreshWeeklyImageList(order) {
  if (!weeklyCurrentOrderNo.value) {
    weeklyImageList.value = normalizeWeeklyImageList(order?.imageList)
    return
  }

  const res = await request.get('/api/work-order/image/list', {
    params: { orderNo: weeklyCurrentOrderNo.value },
  })
  weeklyImageList.value = normalizeWeeklyImageList(res.data?.data || [])
}

function updateWeeklyOrderImages(images) {
  const normalizedImages = normalizeWeeklyImageList(images)
  const currentOrder = weeklyTableData.value.find(
    (order) => String(order.orderNo) === String(weeklyCurrentOrderNo.value),
  )
  if (currentOrder) {
    currentOrder.imageList = normalizedImages
  }
  weeklyImageList.value = normalizedImages
}

async function openWeeklyImageDialog(order) {
  weeklyCurrentMaterialDesc.value = order?.materialDesc || '-'
  weeklyCurrentConfirmedQty.value = order?.confirmedQty ?? '-'
  weeklyCurrentOrderNo.value = order?.orderNo || ''
  weeklyImageList.value = normalizeWeeklyImageList(order?.imageList)
  weeklyCurrentIndex.value = 0
  weeklyImageDialogVisible.value = true

  await refreshWeeklyImageList(order)
}

function openWeeklyProductDialog() {
  weeklyProductDialogVisible.value = true
  fetchWeeklyProductOptions()
}

function handleWeeklyProductSelected(materialDesc) {
  weeklyProductFilter.value = materialDesc
  weeklyProductDialogVisible.value = false
  filterWeeklyOrders()
}

function clearWeeklyProductFilter() {
  weeklyProductFilter.value = ''
  filterWeeklyOrders()
}

function openWeeklyFilePicker() {
  if (weeklyImageUploading.value || !weeklyCurrentOrderNo.value) return

  uni.chooseImage({
    count: MAX_IMAGE_PICK,
    sizeType: ['original', 'compressed'],
    sourceType: ['camera', 'album'],
    success: (res) => {
      handleWeeklyImageSelected(res.tempFilePaths || [])
    },
  })
}

function showWeeklyPreviousImage() {
  if (!weeklyImageList.value.length) return
  weeklyCurrentIndex.value =
    (weeklyCurrentIndex.value - 1 + weeklyImageList.value.length) % weeklyImageList.value.length
}

function showWeeklyNextImage() {
  if (!weeklyImageList.value.length) return
  weeklyCurrentIndex.value = (weeklyCurrentIndex.value + 1) % weeklyImageList.value.length
}

async function handleWeeklyImageSelected(tempFilePaths) {
  if (!tempFilePaths.length || !weeklyCurrentOrderNo.value) return

  weeklyImageUploading.value = true

  try {
    // 同工单汇总：多文件 multipart → 循环单文件（见 api/upload.js 的说明）
    const res = await uploadFiles({
      url: '/api/work-order/image/upload',
      name: 'files',
      files: tempFilePaths,
      formData: { orderNo: weeklyCurrentOrderNo.value },
    })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '图片上传失败。')
    }

    const uploadedImages = normalizeWeeklyImageList(res.data?.data || [])
    if (uploadedImages.length) {
      updateWeeklyOrderImages([...weeklyImageList.value, ...uploadedImages])
      weeklyCurrentIndex.value = weeklyImageList.value.length - 1
    } else {
      await fetchWeeklyOrders()
      const currentOrder = weeklyTableData.value.find(
        (order) => String(order.orderNo) === String(weeklyCurrentOrderNo.value),
      )
      await refreshWeeklyImageList(currentOrder)
    }
    toast.success('图片上传成功')
  } catch (error) {
    toast.error(error.response?.data?.msg || error.message || '图片上传失败，请重试。')
  } finally {
    weeklyImageUploading.value = false
  }
}

async function deleteWeeklyImage(image) {
  if (!weeklyCurrentOrderNo.value || !image?.imageId) return

  try {
    await message.confirm({
      title: '确认删除图片',
      msg: '删除后将无法在当前工单中查看该图片，是否继续？',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  weeklyImageDeleting.value = true

  try {
    const res = await request.delete('/api/work-order/image/delete', {
      params: { imageId: image.imageId },
      data: { imageId: image.imageId },
    })

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '图片删除失败。')
    }

    const remainingImages = weeklyImageList.value.filter(
      (item) => String(item.imageId) !== String(image.imageId),
    )
    updateWeeklyOrderImages(remainingImages)
    if (weeklyCurrentIndex.value >= weeklyImageList.value.length) {
      weeklyCurrentIndex.value = Math.max(0, weeklyImageList.value.length - 1)
    }
    toast.success('图片已删除')
  } catch (error) {
    toast.error(error.response?.data?.msg || error.message || '图片删除失败，请重试。')
  } finally {
    weeklyImageDeleting.value = false
  }
}

/** 分页器回调：只换页，不重置条件 */
function getWeeklyPageData(page = weeklyPageNum.value) {
  weeklyPageNum.value = page
  return fetchWeeklyOrders()
}

function getWeeklyCellValue(row, columnKey, index) {
  if (columnKey === 'index') {
    return (weeklyPageNum.value - 1) * weeklyPageSize.value + index + 1
  }
  return row?.[columnKey] ?? ''
}

function normalizeWeeklyOrder(item) {
  if (!item) return null
  const order = item.workOrder
    ? { ...item.workOrder, ...item }
    : { ...item }
  order.imageList = normalizeWeeklyImageList(order.imageList)
  return order
}

/** 条件变了：回到第 1 页再查（这张表在模板里未渲染，但保持与其他面板一致的语义） */
function filterWeeklyOrders() {
  weeklyPageNum.value = 1
  return fetchWeeklyOrders()
}

/**
 * 周统计页那张工单明细表的取数。
 *
 * ⚠️ 改造前是「拉全表 + 前端按日期区间/产成品过滤 + 本地 slice 分页」；
 * 工单列表接口改成分页之后，取数必须带上 pageNum / pageSize（缺参数会被后端回 400），
 * 过滤也一并交给服务端 —— 前端手里已经没有全量工单了。
 */
async function fetchWeeklyOrders() {
  weeklyLoading.value = true
  weeklyError.value = ''

  try {
    const params = {
      pageNum: weeklyPageNum.value,
      pageSize: weeklyPageSize.value,
    }
    if (weeklyStartDate.value) params.startDate = weeklyStartDate.value
    if (weeklyEndDate.value) params.endDate = weeklyEndDate.value
    if (weeklyProductFilter.value) params.materialDesc = weeklyProductFilter.value

    const res = await request.get('/api/work-order/list', { params })
    if (res.data.success === true) {
      const dataList = Array.isArray(res.data.dataList)
        ? res.data.dataList.map(normalizeWeeklyOrder).filter(Boolean)
        : []

      weeklyTableData.value = dataList
      weeklyTotal.value = Number(res.data?.total) || 0
    } else {
      weeklyTableData.value = []
      weeklyTotal.value = 0
      weeklyError.value = res.data.msg || '工单接口返回异常，请稍后重试。'
    }
  } catch (error) {
    weeklyTableData.value = []
    weeklyTotal.value = 0
    weeklyError.value = error.response?.data?.msg || error.message || '工单数据加载失败，请稍后重试。'
  } finally {
    weeklyLoading.value = false
  }
}

// ===== 储罐体积计算 =====
// 容器清单来自**设备台账**（`GET /api/equipment/vessels`，变更-025）—— 以前是写死在这里的
// 一个数组，每加一种规格都要改代码 + 出底图 + 重新发版（小程序还要走一遍发布）。
// 现在几何、底图、介质密度都在库里，这里只剩「取数 + 兜底 + 选中项」。
//
// 展示层（配色、备注文案、显示宽度）在 composables/useVesselList.js，体积公式在
// utils/vesselVolume.js —— 三处各管各的，改哪一样都不必动另两处。
//
// ⚠️ 底图坐标（imageBounds）是**按图片宽度归一化**的：width 恒为 1、height 是长宽比，
//    其余是「占图宽的比例」。这样电脑端用原图、uni-app 用 1/2 压图能共用同一组坐标 ——
//    绘制时仍是 s = IMAGE_W / bounds.width 那一套，只是那个 width 成了 1。
const { vessels, vesselsLoading, vesselsFromCache, loadVessels } = useVesselList()

// 清单是异步来的，先留空，到位后由下面这个 watch 补上选中项
const vesselKey = ref('')

watch(vessels, (list) => {
  if (!list.length) return
  // 只在「当前选中项不在新清单里」时才改 —— 否则每次刷新都会把用户选中的罐顶掉
  if (!list.some((item) => item.key === vesselKey.value)) {
    vesselKey.value = list[0].key
  }
})

// 这个页面是**纯前端计算**（公式在本地），台账取不到时会退到本地缓存，见 useVesselList。
// 宁可慢一拍也不要把清单清空 —— 清了就真的什么都算不了。
onMounted(loadVessels)

// 储罐下拉的浮层开关。⚠️ 必须绑给 DropdownMenu 的 v-model —— 它的遮罩与面板都是
// v-if="modelValue"，漏绑就只 emit 一个没人监听的事件，点击毫无反应（这行别删）。
const vesselMenuOpen = ref(false)

// 当前选中的容器。**可能是 null**：清单异步来，且台账取不到时会退到缓存/空。
// 下游一律走 vesselGeometry，由它在没有选中项时返回一份「空白几何」，避免整页崩掉。
const selectedVessel = computed(() => {
  const list = vessels.value
  if (!list.length) return null
  return list.find((item) => item.key === vesselKey.value) ?? list[0]
})

// 底图实际地址：按主题挑深浅版，再按环境补前缀（包内 /static 或走网络）。
// 放在 computed 里而不是模板里直接调函数 —— 模板里调会在每次重渲染时重算字符串。
const vesselPaperSrc = computed(() => {
  const vessel = selectedVessel.value
  if (!vessel) return ''
  return resolveVesselImage(isLight.value ? vessel.image : vessel.imageDark)
})

// 储罐下拉的选项（企微式浮层，见 components/DropdownMenu.vue）。
// hint 用「罐型 + 主尺寸 + 密度」把几台容器一眼分开：浮层里罐名长得很像，
// 光看名字容易点错。
// icon 两行都用 chart-bubble（本面板自己的图标）：图标字体里没有卧式/立式罐的图形，
// 硬凑一个别的语义反而更误导，罐型交给 hint 表达。
const vesselOptions = computed(() =>
  vessels.value.map((vessel) => {
    const size =
      vessel.type === 'vertical'
        ? `立式 · φ${vessel.diameter / 1000}m × H${vessel.cylinderHeight / 1000}m`
        : `卧式 · φ${vessel.diameter / 1000}m × L${vessel.cylinderLength / 1000}m`
    // 密度可以不配（再沸器的介质未定）—— 直接拼会显示成「ρundefined」，缺就整段不拼
    const density = vessel.density ? ` · ρ${vessel.density}` : ''
    return {
      value: vessel.key,
      label: vessel.label,
      hint: size + density,
      icon: 'chart-bubble',
    }
  }),
)

// 浮层选中后写回唯一的罐标识；下游（selectedVessel / vesselGeometry）一行不动
function handleVesselSelect(key) {
  vesselKey.value = key
}

// 没有选中项时（清单还没到 / 台账取不到且无缓存）用这份**空白几何**兜住：
// 下游的 vesselDiagram / vesselStartVolume / vesselCapacity 等全都会读它，
// 让它们拿到 null 会一路崩到模板。这里给一个「画不出东西但不炸、也不产生 NaN」的形状
// （半径、量程都取正数，避免体积公式里出现除以零），界面上另有明确提示。
const BLANK_VESSEL_GEOMETRY = {
  type: 'horizontal',
  diameter: 1,
  radius: 0.5,
  cylinderLength: 1,
  straightFlange: 0,
  headDepth: 0.25,
  bottomHeadDepth: 0,
  maxLevel: 1,
  imageBounds: { width: 1, height: 1, left: 0, right: 1, top: 0, bottom: 1 },
  displayWidth: 320,
  liquid: { fill: 'transparent', line: 'transparent' },
  medium: '',
  density: null,
  note: '',
  bundle: null,
}

// 当前储罐的几何参数（统一两种罐型的字段）
const vesselGeometry = computed(() => {
  const vessel = selectedVessel.value
  if (!vessel) return BLANK_VESSEL_GEOMETRY

  if (vessel.type === 'vertical') {
    // 下封头可选：150 产品储罐是平底，缺省 0；甲醇计量罐上下都有封头。
    // 液位基准是**罐底最低点**（有下封头时即下封头顶点），所以量程要把下封头那一段算进去。
    // 直边（cylindrical 的那 40mm）是等径圆筒段，并入筒体高度 —— 体积与液位映射都按合并后的算
    const bottomHeadDepth = vessel.bottomHeadDepth ?? 0
    const cylinderHeight = vessel.cylinderHeight + 2 * (vessel.straightFlange ?? 0)
    return {
      type: 'vertical',
      diameter: vessel.diameter,
      radius: vessel.diameter / 2,
      cylinderHeight,
      headDepth: vessel.headDepth,
      bottomHeadDepth,
      // 直边已经并进上面那个 cylinderHeight 了（体积与液位映射都用合并后的值），
      // 这里再单独透传一份：对账要按「封头曲面 + 直边」算，缺了它会对不上台账的 head_volume
      straightFlange: vessel.straightFlange ?? 0,
      maxLevel: bottomHeadDepth + cylinderHeight + vessel.headDepth,
      imageBounds: vessel.imageBounds,
      displayWidth: vessel.displayWidth ?? 680,
      liquid: vessel.liquid,
      medium: vessel.medium ?? '',
      density: vessel.density ?? null,
      note: vessel.note ?? '',
    }
  }

  const headTotal = vessel.straightFlange + vessel.headDepth
  return {
    type: 'horizontal',
    diameter: vessel.diameter,
    radius: vessel.diameter / 2,
    cylinderLength: vessel.cylinderLength,
    straightFlange: vessel.straightFlange,
    headDepth: vessel.headDepth,
    headTotal,
    totalLength: vessel.cylinderLength + 2 * headTotal,
    maxLevel: vessel.diameter,
    imageBounds: vessel.imageBounds,
      displayWidth: vessel.displayWidth ?? 680,
      liquid: vessel.liquid,
    medium: vessel.medium ?? '',
    density: vessel.density ?? null,
    note: vessel.note ?? '',
    // 罐内管束：只有再沸器有。构造一次由 computed 缓存，不会每帧重建；
    // 容积计算与渲染都读它，没配 bundle 的两台罐拿到 null（行为与改造前一致）
    bundle: vessel.bundle ? new UTubeBundle({ ...vessel.bundle }) : null,
  }
})

// 起始液位 / 终止液位：两个独立液位，用于对比与体积差计算
const vesselStartLevel = ref(1400)
const vesselEndLevel = ref(1400)
const vesselStartDisplay = ref(1400) // 动画中的起始液位
const vesselEndDisplay = ref(1400) // 动画中的终止液位
const vesselSwitching = ref(false) // 切换储罐时淡出/淡入

// 储罐示意图：纯 CSS/DOM 图层（改造前是 uni 老版 canvas：createCanvasContext + 手写路径 + ctx.draw()）。
//
// 留 canvas 的唯一理由是「小程序 / App 端没有标准 Canvas2D」，代价是：
//   · 每帧一次 draw() 把整幅图重新交给渲染层，罐型切换还要重跑整套路径；
//   · 不量尺寸就没法画（createSelectorQuery 异步量宽度 + 最多 10 次重试），量到之前是空白；
//   · 水波得 JS 自己算相位，再插值成一条 140 段的折线。
// 现在几何全部落到 CSS 上：定位一律用百分比，盒子多宽图纸就多宽 ——
// 「随屏宽等比缩放」交给渲染引擎，JS 不再量任何尺寸；水波交给 CSS animation，
// 也就不再有「每帧重绘」。JS 只剩液位缓动一件事（见 vesselFrame），缓动跑完即停帧。
//
// 用到的 CSS 能力都挑了本项目里已有先例的：radial-gradient 平铺 + background-size、
// linear-gradient 斜纹；border-radius 斜杠语法在本项目里没有先例，见 UNIAPP迁移说明.md 5.3。
const VESSEL_IMAGE_WIDTH = 1075 // 底图逻辑宽（= static 下压缩后底图的实际像素宽）
const VESSEL_LABEL_COLUMN = 300 // 右侧引线标注栏宽度（逻辑像素）

// 立式罐：图形与信息区并排布局（横卧罐图形较宽，保持上下堆叠）
const isVerticalVessel = computed(() => vesselGeometry.value.type === 'vertical')

// 底图是否开始渲染。底图约 645 KB，切到压力容器 Tab 才真的去加载（见 watch(activeTab)）；
// 用变量锁存而不是每次重新 v-if，是为了来回切 Tab 时不重复加载同一张底图。
const vesselImageReady = ref(false)

// 水波纹参数（与改造前 canvas 同一组观感参数）
const VESSEL_WAVE = {
  amplitude: 3.5, // 波幅（逻辑像素）
  wavelength: 120, // 波长（逻辑像素）
  periodMs: 2620, // 相位推进一个波长所用的时间
}

// 波速（逻辑像素 / 秒）：波长 ÷ 周期。改造前是每帧推进 0.04 rad（约 2.6 s 一个周期），
// 换算成线速度后交给 CSS 动画匀速平移，观感一致。
const VESSEL_WAVE_SPEED = VESSEL_WAVE.wavelength / (VESSEL_WAVE.periodMs / 1000)

// #rrggbb → rgba(...)：波峰带用介质线色做半透明拱带。
// 改造前是沿波形的 2px 实线，而 DOM 单元素画不出「拱形填充 + 等粗描边」这套组合，
// 改用同色 0.85 半透明拱带近似（屏幕上差 1~2 个设备像素，见 UNIAPP迁移说明.md 5.3）。
function vesselRgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}
// 波峰带的图案（拱形 + 颜色）：图纸里的液面（vesselDiagram.waveStyle）与液位控件前的
// 图例小标（vesselWaveSwatch）必须一模一样，所以只写这一份 —— 瓦片宽度由 backgroundSize
// 给，这里只出「一个拱」的图案。参数与改造前 canvas 的水波同一组。
function vesselWavePattern(line) {
  return `radial-gradient(ellipse 50% 100% at 50% 100%, ${vesselRgba(line, 0.85)} 0 99.5%, transparent 100%)`
}

// 液位（mm）→ 液面在罐体盒子内的高度百分比（0 = 罐底，100 = 罐顶）。
// 改造前是在逻辑坐标系里算 Y 再乘缩放比换成画布像素，这里直接出百分比 ——
// 百分比跟着盒子缩放，所以「屏幕上多大」不需要 JS 知道。
//   卧式：液面高度随半径线性变化；
//   立式：下封头段 / 筒体段 / 上封头段分开映射（底图里的封头画得比真实椭球略扁，
//         分段映射才能让液面始终贴合图纸上的结构线）。没有下封头的罐只有后两段。
function levelBottomPercent(level, geometry, bounds, scale) {
  const bottom = bounds.bottom * scale

  if (geometry.type === 'vertical') {
    const tangent = bounds.tangent * scale
    const apex = bounds.top * scale
    // 下封头：150 产品储罐是平底（bottomHeadDepth 缺省 0、底图也没有 tangentBottom），
    // 此时 tangentBottom 就是 bottom，三段并成两段，结果与改造前逐位一致
    const hasBottomHead =
      geometry.bottomHeadDepth > 0 && bounds.tangentBottom !== undefined
    const bottomHead = hasBottomHead ? geometry.bottomHeadDepth : 0
    const tangentBottom = hasBottomHead ? bounds.tangentBottom * scale : bottom

    let y
    if (bottomHead > 0 && level <= bottomHead) {
      // 下封头段：液位自罐底最低点（下封头顶点）量起
      y = bottom - (level / bottomHead) * (bottom - tangentBottom)
    } else {
      const shellLevel = level - bottomHead
      y =
        shellLevel <= geometry.cylinderHeight
          ? tangentBottom - (shellLevel / geometry.cylinderHeight) * (tangentBottom - tangent)
          : tangent -
            (Math.min(geometry.headDepth, shellLevel - geometry.cylinderHeight) /
              geometry.headDepth) *
              (tangent - apex)
    }
    return ((bottom - y) / (bottom - apex)) * 100
  }

  return (level / geometry.diameter) * 100
}

// 上面那个映射的**逆**：液面在罐体盒子里的高度百分比（0 = 罐底、100 = 罐顶）→ 液位（mm）。
// 拖动液位滑块时用它把手指的位置换回液位。
// ⚠️ 与 levelBottomPercent 是一对：改分段映射（或底图的口径）必须同时改这里，
//    不然会出现「手柄拖到哪、液面不在哪」。验证脚本拿两者做往返换算（逐罐型抽样）。
function levelFromBottomPercent(percent, geometry, bounds, scale) {
  if (geometry.type !== 'vertical') return (percent / 100) * geometry.diameter

  const bottom = bounds.bottom * scale
  const tangent = bounds.tangent * scale
  const apex = bounds.top * scale
  const y = bottom - (percent / 100) * (bottom - apex)

  // 与正向映射同一套分段（见上）：平底罐没有下封头那一段；cyl 为 0 的退化情况直接跳过该段
  const hasBottomHead =
    geometry.bottomHeadDepth > 0 && bounds.tangentBottom !== undefined
  const bottomHead = hasBottomHead ? geometry.bottomHeadDepth : 0
  const tangentBottom = hasBottomHead ? bounds.tangentBottom * scale : bottom

  if (bottomHead > 0 && y >= tangentBottom && bottom > tangentBottom) {
    // 下封头段：液位自罐底最低点（下封头顶点）量起
    return (bottomHead * (bottom - y)) / (bottom - tangentBottom)
  }
  if (y >= tangent && tangentBottom > tangent) {
    // 筒体段
    return (
      bottomHead +
      (geometry.cylinderHeight * (tangentBottom - y)) / (tangentBottom - tangent)
    )
  }
  if (!(tangent > apex)) return bottomHead + geometry.cylinderHeight
  // 上封头段：y 越过顶点时算出来会大于量程，由调用方钳到 maxLevel
  return (
    bottomHead +
    geometry.cylinderHeight +
    (geometry.headDepth * (tangent - y)) / (tangent - apex)
  )
}

// 水波瓦片数：一格「拱」≈ 半个波长，取整是为了让平铺到罐宽正好是整数格
//（非整数会在右端留下半截拱，动画循环处也会跳一下）。
function vesselWaveTiles(tankWidth) {
  return Math.max(4, Math.round(tankWidth / (VESSEL_WAVE.wavelength / 2)))
}

// 储罐示意图的全部几何与图层样式。
//
// 坐标系与改造前 canvas 完全一致：逻辑宽 = 底图宽 1075 + 标注栏 300 = 1375，
// 逻辑高 = 1075 × 底图高 / 底图宽（底图尺寸见 VESSELS 的 imageBounds ——
// 那组边界由图像分析 + 轮廓叠加验证得出，横纵比例尺一致：0.28567 px/mm）。
// 底图上的像素边界乘同一个比例尺 scale 得到逻辑坐标，再换算成「占盒子的百分比」；
// 盒子按 1375 : 逻辑高 定宽高比，于是整幅图随屏宽等比缩放这件事由渲染引擎负责，
// JS 不需要量任何尺寸。
//
// 层级（自下而上）：底图 → 罐体裁剪层（液体 / 波峰带 / 差值带 / 起始虚线）→ 引线标注。
const vesselDiagram = computed(() => {
  const geometry = vesselGeometry.value
  const bounds = geometry.imageBounds
  const scale = VESSEL_IMAGE_WIDTH / bounds.width
  const W = VESSEL_IMAGE_WIDTH + VESSEL_LABEL_COLUMN
  const H = Math.round((VESSEL_IMAGE_WIDTH * bounds.height) / bounds.width)

  // 逻辑坐标 → 百分比（横向相对逻辑宽，纵向相对逻辑高）
  const toLeft = (value) => `${(((value * scale) / W) * 100).toFixed(4)}%`
  const toTop = (value) => `${(((value * scale) / H) * 100).toFixed(4)}%`

  const left = bounds.left * scale
  const right = bounds.right * scale
  const top = bounds.top * scale
  const bottom = bounds.bottom * scale
  const tankWidth = right - left
  const tankHeight = bottom - top

  // ===== 罐体轮廓 =====
  // 卧式：矩形挖掉两个椭圆角就是椭圆封头（rx = 封头曲面深度、ry = 半径）。
  //       改造前那条路径里还有一段直边（flange），但它落在上下轮廓线的延长线上，
  //       对轮廓没有任何影响 —— 所以「矩形 + 斜杠圆角」与改造前的路径等价。
  //       封头曲面深度与 canvas 同一式子：hiPx = headDepth / diameter × 2R。
  // 立式：上半是半椭圆封头、下半是等径筒体 → 上两角 rx 50% / ry 封头深占比，下两角直角。
  let tankStyle
  if (geometry.type === 'vertical') {
    const tankH = bounds.bottom - bounds.top
    const ry = ((bounds.tangent - bounds.top) / tankH) * 100
    // 下封头：底图里多一条 tangentBottom（下封头与筒体的切线）。有它就把下两角
    // 也改成椭圆角，没有就是平底（150 产品储罐），下两角直角。
    const hasBottomHead =
      geometry.bottomHeadDepth > 0 && bounds.tangentBottom !== undefined
    const ryBottom = hasBottomHead ? ((bounds.bottom - bounds.tangentBottom) / tankH) * 100 : 0
    tankStyle = {
      left: toLeft(bounds.left),
      top: toTop(bounds.top),
      width: `${((tankWidth / W) * 100).toFixed(4)}%`,
      height: `${((tankHeight / H) * 100).toFixed(4)}%`,
      // 斜杠前是四个角的水平半径、斜杠后是垂直半径（顺序 左上/右上/右下/左下）
      borderRadius: hasBottomHead
        ? `50% 50% 50% 50% / ${ry.toFixed(4)}% ${ry.toFixed(4)}% ${ryBottom.toFixed(4)}% ${ryBottom.toFixed(4)}%`
        : `50% 50% 0 0 / ${ry.toFixed(4)}% ${ry.toFixed(4)}% 0 0`,
    }
  } else {
    const headPx = (geometry.headDepth / geometry.diameter) * tankHeight
    tankStyle = {
      left: toLeft(bounds.left),
      top: toTop(bounds.top),
      width: `${((tankWidth / W) * 100).toFixed(4)}%`,
      height: `${((tankHeight / H) * 100).toFixed(4)}%`,
      borderRadius: `${((headPx / tankWidth) * 100).toFixed(4)}% / 50%`,
    }
  }

  // ===== 液位 =====
  // 波幅换算成罐体高度的百分比。波峰带高度 = 2 × 波幅：带子下沿正好落在液面上、
  // 上沿落在「液面 + 一个波幅」处 —— 与下方液体块严丝合缝，不会叠出双倍透明度。
  const amp = (VESSEL_WAVE.amplitude / tankHeight) * 100
  const endPct = levelBottomPercent(vesselEndDisplay.value, geometry, bounds, scale)
  const startPct = levelBottomPercent(vesselStartDisplay.value, geometry, bounds, scale)
  const hasLiquid = vesselEndDisplay.value > 0
  const hasStart = vesselStartDisplay.value > 0
  const levelDelta = vesselStartDisplay.value - vesselEndDisplay.value
  const hasDelta = Math.abs(levelDelta) > 1 // 与改造前同一阈值
  const tone = levelDelta > 0 ? 'is-decrease' : 'is-increase'

  // ===== 水波 =====
  // 单个「拱」用 radial-gradient 画：椭圆（rx = 半个瓦片宽、ry = 整条带高）贴着瓦片
  // 下边中点，拱内填色、拱外透明；瓦片按 background-size 横向平铺，格数取整保证右端
  // 不出现半截拱。动画把「两倍宽的自层」整体 translateX(-50%)，位移恰好等于整数格
  //（图案周期）—— 循环处没有跳变；时长按罐宽 ÷ 波速算，与改造前同速。
  const tiles = vesselWaveTiles(tankWidth)
  const waveDuration = tankWidth / VESSEL_WAVE_SPEED

  // 起始液位虚线：墨色由 .vessel-diagram__start 的 $ui-text 令牌给（深色主题自动变亮），
  // 线型 2px 高、5px 实 / 4px 空。
  // 改造前的 setLineDash([9, 6]) 是逻辑像素，随图缩放后在手机上只剩 1~2 个设备像素、
  // 糊成一片，这里刻意改成固定屏幕像素（见 UNIAPP迁移说明.md 5.3）。
  const startStyle = {
    display: hasStart ? 'block' : 'none',
    bottom: `calc(${startPct.toFixed(4)}% - 1px)`,
  }

  // ===== 引线标注 =====
  // 锚点取起止两条液位线的中点、横向离罐体右端 30 逻辑像素（与改造前一致）。
  // 文字位置：改造前是「文字块中心在锚点上方 3.2 个字号处，再夹在画布内」；
  // DOM 版字号固定 13px 屏幕像素，锚点落在图纸上方 40% 以内时改成放在引线下方，
  // 保证标注不越出面板上沿（面板已不再画底色，但标注仍要留在图区内；见 UNIAPP迁移说明.md 5.3）。
  const anchorPct = (startPct + endPct) / 2
  const calloutBelow = anchorPct > 60

  return {
    width: W,
    height: H,
    // 宽高比：与改造前 canvas 的 aspectRatio 同一套（CSS 过渡才能平滑切高度）
    aspectRatio: `${W} / ${H}`,
    // 底图占整幅图的宽度比例：1075 / 1375
    paperStyle: { width: `${((VESSEL_IMAGE_WIDTH / W) * 100).toFixed(4)}%` },
    tankStyle,
    liquidStyle: {
      display: hasLiquid ? 'block' : 'none',
      height: `${(endPct + amp).toFixed(4)}%`,
      backgroundColor: geometry.liquid.fill,
    },
    waveStyle: {
      display: hasLiquid ? 'block' : 'none',
      bottom: `${(endPct - amp).toFixed(4)}%`,
      height: `${(amp * 2).toFixed(4)}%`,
      backgroundImage: vesselWavePattern(geometry.liquid.line),
      // 自层是两倍宽，所以瓦片宽 = 罐宽的 1/tiles，即自层宽的 0.5/tiles
      backgroundSize: `${(50 / tiles).toFixed(4)}% 100%`,
      animationDuration: `${waveDuration.toFixed(2)}s`,
    },
    deltaStyle: {
      bottom: `${Math.min(startPct, endPct).toFixed(4)}%`,
      height: `${Math.abs(startPct - endPct).toFixed(4)}%`,
    },
    startStyle,
    // 液位滑块轨道（贴在罐体左缘、盖在图纸之上那条）：纵向与罐体盒子同高，
    // 所以它的百分比刻度与上面几个液位百分比（startPct / endPct）**同一把尺** ——
    // 手柄的 bottom% 可以直接用，拖动时反过来也能用它把手指位置换算成液位（见 railPercentOfY）。
    sliderStyle: {
      left: tankStyle.left,
      top: tankStyle.top,
      height: tankStyle.height,
    },
    sliderTopPct: (top / H) * 100,
    sliderHeightPct: (tankHeight / H) * 100,
    hasDelta,
    hasStart,
    calloutTone: tone,
    calloutBelow,
    calloutStyle: {
      left: toLeft(bounds.right - 30),
      top: `${(100 - anchorPct).toFixed(4)}%`,
    },
    // 三行标注拆成「前缀 / 数值 / 单位」三格，数值进定宽槽（见 .vessel-num）。
    // 正负号留在数值里：拆成三格后 flex 的 gap 会把独立的「−」与数字隔开成「− 14.59」。
    lines: [
      {
        prefix: levelDelta > 0 ? '消耗' : '增加',
        value: `${Math.abs(levelDelta).toFixed(0)}`,
        unit: 'mm',
        slot: 'vessel-num--level',
        key: 'level',
      },
      {
        prefix: '',
        value: `${levelDelta > 0 ? '−' : '+'}${Math.abs(vesselVolumeDelta.value).toFixed(2)}`,
        unit: 'm³',
        slot: 'vessel-num--signed',
        key: 'volume',
      },
      ...(vesselMassDelta.value === null
        ? []
        : [{
            prefix: '',
            value: `${levelDelta > 0 ? '−' : '+'}${Math.abs(vesselMassDelta.value).toFixed(2)}`,
            unit: 't',
            slot: 'vessel-num--signed',
            key: 'mass',
          }]),
    ],
  }
})

// 液位控件那几个图例小标里，「终止液位」那个画的是图纸里的波峰液面 —— 图案与图纸
// 同一份声明（vesselWavePattern），所以两边永远一致。
const vesselWaveSwatch = computed(() => ({
  backgroundImage: vesselWavePattern(vesselGeometry.value.liquid.line),
}))

// ===== 液位滑块（图纸左缘的轨道 + 两个玻璃手柄）=====
// 手柄贴着自己的液面：位置取液位的**显示值**（缓动中的那个），于是用 ± 按钮步进时
// 手柄跟着液面一起滑，不是「数字跳、手柄等」。刻度就是 levelBottomPercent 的输出。
//
// 两个液位挨得很近时手柄会叠在一起，完全重合就只能抓到上面那个 —— 所以「没被拖的那个」
// 要让开一点。⚠️ 让开的只是手柄的**画法**，不动液位：
//   · 拖动中（vesselRailDragWhich 不为空）被拖的那个永远画在自己的真实刻度上；
//   · 起手那一下液位也不跳 —— 拖动映射的是手指位移，见 moveRailDrag 里的 pct0 锚点。
//
// 让开的量按**像素**算、不按百分比：手柄是固定屏幕尺寸的胶囊（28px 高），轨道高度却随罐型
// 与屏幕在 ~100px（卧式罐在手机上）到 ~250px（立式罐）之间变 —— 固定百分比在矮轨道上只让开
// 几像素，两个胶囊照样叠着（2026-10-10 真机截图撞见的正是这个）。
const RAIL_HANDLE_MIN_PX = 36 // 两个手柄中心至少隔这么多 px（胶囊 28px 画出来 30px + 6px 缝）

// 轨道在屏幕上的高度（px）。手柄是固定屏幕像素、让开量按像素算，所以得知道轨道多高；
// 而轨道高度 = 图纸高 × sliderHeightPct，图纸高只能在运行期量（见 measureVesselRailHeight）。
// 量到之前是 0：那时不推，两个手柄先按真实刻度画（面板没显示过，本来就没人看得见）。
const vesselRailHeightPx = ref(0)

// 正在被拖的手柄（'' | 'start' | 'end'）：驱动「另一个让开」与手柄的高亮/置顶样式。
// 从落点到第一下 move（认领）之间还是 ''，这段时间不给任何高亮。
// 拖动会话本身是普通对象、不进响应式，见下面的 vesselRailDrag。
const vesselRailDragWhich = ref('')

function clampRailPercent(value) {
  return Math.max(0, Math.min(100, value))
}

// 两个手柄各自的「让开」量（px，正数 = 往上让），作用在手柄的 margin-bottom 上。
// 位置本身仍是真实刻度的百分比：让开的只是画法，液位与数字都不动。
function railHandleOffsets(start, end, active) {
  const offsets = { start: 0, end: 0 }
  const height = vesselRailHeightPx.value
  if (!(height > 0)) return offsets

  const need = RAIL_HANDLE_MIN_PX - (Math.abs(start - end) / 100) * height
  if (!(need > 0)) return offsets // 本来就离得够开，谁也不让

  // 刻度高的那个往上让、低的往下让。被拖的那个不动、另一个让开全部；
  // 谁都没拖则各让一半 —— 于是「拖起来一个」时总间距与没拖时一样，不会先合再分。
  const upWhich = start >= end ? 'start' : 'end'
  const downWhich = upWhich === 'start' ? 'end' : 'start'
  const upPct = upWhich === 'start' ? start : end
  const downPct = downWhich === 'start' ? start : end
  const roomUp = Math.max(0, ((100 - upPct) / 100) * height)
  const roomDown = Math.max(0, (downPct / 100) * height)

  let upPx = Math.min(active === downWhich ? need : active === upWhich ? 0 : need / 2, roomUp)
  let downPx = Math.min(active === upWhich ? need : active === downWhich ? 0 : need / 2, roomDown)
  // 有一边顶到轨道端头了（两个液位都在量程顶端这种），让另一边多让一点补上；
  // 补不满也就算了 —— 两个手柄都贴在端点时物理上展不开，只能叠着。
  const deficit = need - upPx - downPx
  if (deficit > 0) {
    const extraDown = Math.min(deficit, roomDown - downPx)
    downPx += extraDown
    upPx += Math.min(deficit - extraDown, roomUp - upPx)
  }

  offsets[upWhich] = upPx
  offsets[downWhich] = -downPx
  return offsets
}

const vesselRailHandles = computed(() => {
  const geometry = vesselGeometry.value
  const bounds = geometry.imageBounds
  const scale = VESSEL_IMAGE_WIDTH / bounds.width
  const start = clampRailPercent(levelBottomPercent(vesselStartDisplay.value, geometry, bounds, scale))
  const end = clampRailPercent(levelBottomPercent(vesselEndDisplay.value, geometry, bounds, scale))
  const offsets = railHandleOffsets(start, end, vesselRailDragWhich.value)

  return [
    {
      which: 'start',
      label: '起始液位滑块',
      class: 'vessel-rail__handle--start',
      percent: start,
      offsetPx: offsets.start,
      value: Math.round(vesselStartDisplay.value),
      swatchStyle: null,
    },
    {
      which: 'end',
      label: '终止液位滑块',
      class: 'vessel-rail__handle--end',
      percent: end,
      offsetPx: offsets.end,
      value: Math.round(vesselEndDisplay.value),
      swatchStyle: vesselWaveSwatch.value, // 与控件列那个小标、图纸里的波峰带同一份图案
    },
  ]
})

// 液体体积（mm³）：壳体液位体积 − 液面以下换热管所占体积。
// 两项的实现都在 utils/vesselVolume.js（两套前端共用同一份内容），这里只做调用：
//   · 壳体是闭式解，依据工艺核算公式
//       V(h) = L[ πr²/2 − (r−h)√(2rh−h²) − r²·arcsin((r−h)/r) ]
//            + (π·hi)/(3r) · [ 3r²h − r³ + (r−h)³ ]
//     第一项为筒体（含两端直边）内液体体积，第二项为两端椭圆封头曲面内液体体积合计
//   · 管束项只有配了 bundle 的罐（再沸器）才有；另两台罐 geometry.bundle 为 null，
//     减 0，结果与改造前逐位一致
// 液位入参是 mm，返回 mm³。
function liquidVolumeMm3(depth, geometry) {
  const shell = shellVolumeMm3(depth, geometry)
  const tubeBundle = geometry.bundle ? geometry.bundle.immersedVolumeMm3(depth) : 0
  return shell - tubeBundle
}

const vesselStartVolume = computed(
  () => liquidVolumeMm3(vesselStartDisplay.value, vesselGeometry.value) / 1e9,
)
const vesselEndVolume = computed(
  () => liquidVolumeMm3(vesselEndDisplay.value, vesselGeometry.value) / 1e9,
)
// 体积变化 = 终止 − 起始（正数为增加）
const vesselVolumeDelta = computed(() => vesselEndVolume.value - vesselStartVolume.value)

// 物料重量（吨）：体积 × 密度（g/cm³ 数值上等于 t/m³）；未配置密度时为 null
function toMass(volume) {
  const density = vesselGeometry.value.density
  return density ? volume * density : null
}

const vesselStartMass = computed(() => toMass(vesselStartVolume.value))
const vesselEndMass = computed(() => toMass(vesselEndVolume.value))
const vesselMassDelta = computed(() =>
  vesselStartMass.value === null ? null : toMass(vesselVolumeDelta.value),
)
const vesselCapacity = computed(
  () => liquidVolumeMm3(vesselGeometry.value.maxLevel, vesselGeometry.value) / 1e9,
)

// 储罐规格（随所选储罐变化）：拆成「标签 / 数值」条目数组，交给模板用网格排版。
//
// ⚠️ 改造前这里拼的是**一整句话**（"筒体 l=5.5m，φ2.8m，直边 0.04m，封头内高度
//    hi=0.7m，总容积 40.1 m³"），而这句 60+ 字的话与右侧固定 224px 的储罐选择器
//    同处一个 flex 行：360px 的小屏上，行内可用宽度只有约 274px（页面 16px 内边距
//    + 卡片 px-6），选择器吃掉 224px + 27px 间距后只剩约 23px —— 一个汉字一行，
//    整段塌成竖排碎字（小程序端实测如此；H5 桌面够宽所以看不出来）。
//    现在改成结构化条目：模板里两列起步的网格，多窄都不会再挤出单字一行。
const vesselSpecs = computed(() => {
  const g = vesselGeometry.value
  // 毫米 → 米。保留两位后去掉多余的 0（0.04m 而不是 0.040m）
  const m = (value) => `${(value / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} m`
  // 说明性字段（根数、规格、图纸口径的筒体高与直边、铭牌容积）读原始选项：
  // 几何实例上只留计算用到的量。`?? {}` 兜住「清单还没到」的瞬间（此时各项都取不到，
  // 规格网格会退化成只显示几何算得出来的那几项）
  const raw = selectedVessel.value ?? {}
  const bundleConfig = raw.bundle

  const items = []

  if (g.type === 'vertical') {
    items.push({ label: '筒体内径', value: `φ${m(g.diameter)}` })
    // 筒体高度按图纸口径显示（不含直边）。几何计算里直边是并进筒体高的等径圆筒段，
    // 显示时拆回来 —— 否则「图纸写 3400、页面写 3.48m」会对不上
    items.push({ label: '筒体高度', value: m(raw.cylinderHeight ?? g.cylinderHeight) })
    if ((raw.straightFlange ?? 0) > 0) {
      items.push({ label: '封头直边', value: m(raw.straightFlange) })
    }
  } else {
    items.push({ label: '筒体内径', value: `φ${m(g.diameter)}` })
    items.push({ label: '筒体长度', value: `l = ${m(g.cylinderLength)}` })
    // 直边为 0 的罐（再沸器）不列这一项，免得规格里出现「0 m」
    if (g.straightFlange > 0) items.push({ label: '封头直边', value: m(g.straightFlange) })
  }

  // 上下都有封头时（甲醇计量罐）两条分开列，免得「封头曲面 0.55m」被当成罐底也是封头
  const hasBottomHead = (g.bottomHeadDepth ?? 0) > 0
  items.push({
    label: hasBottomHead ? '上封头曲面' : '封头曲面',
    value: `hi = ${m(g.headDepth)}`,
  })
  if (hasBottomHead) {
    items.push({ label: '下封头曲面', value: `hi = ${m(g.bottomHeadDepth)}` })
  }
  // 带管束的罐：这个总容积是**扣掉管束后的净值**，标签上必须写清楚，
  // 否则会被当成毛容积用（壳体满罐是 18.3 m³，净值 18.0 m³）
  items.push({
    label: g.bundle ? '总容积（已扣管束）' : '总容积',
    value: `${vesselCapacity.value.toFixed(1)} m³`,
  })
  items.push({ label: '液位量程', value: `0 ~ ${g.maxLevel} mm` })

  // 管束：根数与规格决定扣除量，单列出来便于与真实图纸核对
  if (bundleConfig && g.bundle) {
    items.push({
      label: '换热管',
      value: `${bundleConfig.tubeCount} 根 ${bundleConfig.tubeSpec}`,
    })
    items.push({
      label: '管束挤占',
      value: `${(g.bundle.totalVolumeMm3 / 1e9).toFixed(4)} m³`,
    })
  }

  // 数据表的铭牌全容积。**只作对照、不参与计算** —— 它与上面那个按几何算出的总容积对不上，
  // 所以标签里必须带「铭牌」二字，否则两个容积并排会被当成程序算错了一个
  // ⚠️ 走上面那个已兜空的 raw（`selectedVessel.value ?? {}`）：清单还没到 / 接口失败时
  //    selectedVessel 是 null，直接 .value.nameplateVolume 会抛 TypeError，
  //    整个页面 render 中断（真机与 H5 都实测到过：控制台一条 engine 空指针）。
  const nameplateVolume = raw.nameplateVolume
  if (nameplateVolume) {
    items.push({ label: '铭牌全容积', value: `${nameplateVolume} m³` })
  }

  // 介质与密度：质量换算用的就是这两个数，单列出来比埋在长句里好找
  if (g.medium) items.push({ label: '介质', value: g.medium })
  if (g.density) items.push({ label: '密度', value: `${g.density} g/cm³` })

  return items
})

// 录入对账：台账里的 head_volume 是**单个封头的「曲面 + 直边」**容积（源台账给的，不是我们编的），
// 按同一口径用当前几何自己算一遍，对不上就说明库里的几何填错了。
// 这是白捡的校验 —— 几何一填错（内径多打个 0、封头深忘了改）立刻看得见，
// 否则要等到有人拿它算体积时才发现，而那时数值已经错了。
// 台账没给 head_volume 的行（如 150产品罐是平底、源表未给）跳过，不误报。
const RECONCILE_TOLERANCE = 0.01 // 1%：图纸取值与源台账的舍入差远小于这个
const vesselReconcileWarning = computed(() => {
  const expected = selectedVessel.value?.headVolumeForCheck
  if (!expected) return ''

  const g = vesselGeometry.value
  const r = g.radius
  const head = g.headDepth
  if (!r || !head) return ''

  // 单位：r / head / straightFlange 都是 mm，算出来是 mm³，除以 1e9 得 m³
  const computedM3 =
    (((2 / 3) * Math.PI * r * r * head + Math.PI * r * r * (g.straightFlange ?? 0)) / 1e9)
  const diff = Math.abs(computedM3 - expected) / expected
  if (diff <= RECONCILE_TOLERANCE) return ''

  return (
    `几何参数与台账对不上：按几何算出的封头容积是 ${computedM3.toFixed(4)} m³，` +
    `台账记的是 ${expected} m³（差 ${(diff * 100).toFixed(1)}%）。` +
    `请核对台账里这台容器的内径 / 封头曲面深 / 直边。`
  )
})

// 台账标了「带内置管束」（container_type=4）却取不到管束参数 —— 那会**静默不扣**管内排液体积
// （再沸器满罐偏大约 1.9%），页面上看不出任何异常。管束参数目前还在前端的临时表里
// （见 useVesselList 的 BUNDLE_BY_ID，待台账加列后删除），所以新增同类容器时最容易漏配。
const vesselBundleWarning = computed(() => {
  const vessel = selectedVessel.value
  if (vessel?.containerType === 4 && !vessel.bundle) {
    return '这台容器在台账里标了「带内置管束」，但取不到它的管束参数，体积没有扣除管内排液体积 —— 请补录。'
  }
  return ''
})

// 公式块下方那句说明。页面上方那个式子算的是**壳体**体积，而配了管束的罐（再沸器）
// 读数还要再扣掉管束 —— 说明必须跟着变，否则「程序按此式实时计算液体体积」
// 与旁边的读数对不上，会被当成算错了。
// 写成 computed 而不是模板里的 v-if：小程序端对块级条件渲染的编译支持面更窄，
// 插值在三端行为完全一致。
const vesselFormulaCaption = computed(() =>
  vesselGeometry.value.bundle
    ? '程序按此式算出壳体体积，再扣除液面以下的换热管体积 —— 两者之差才是上表的有效液体体积'
    : '程序按此式实时计算液体体积',
)

let vesselFrameId = null // 缓动帧循环句柄（null = 已停帧）
let vesselTransitions = { start: null, end: null } // 起始/终止液位的缓动过渡状态

// ===== 画布移植 helper =====

// 动画时钟统一走 Date.now()。
// requestAnimationFrame 回调给的是 performance.now() 基准的时间戳，
// 而小程序端没有它（退回 setTimeout 时只能拿到 Date.now()），两个时钟混用
// 会让与 startTime 的差值算成天文数字、缓动直接跳到终点。统一在入口转换。
function vesselNow() {
  return Date.now()
}

// 小程序没有全局 requestAnimationFrame（只有 type="2d" canvas 节点上的同名方法）。
// 有就用，与刷新率对齐；没有就退回约 30fps 的定时器 —— 老版画布每帧要
// 序列化一次绘制指令再上屏，60fps 在中低端机上是浪费。
const vesselRaf =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(() => cb(vesselNow()))
    : (cb) => setTimeout(() => cb(vesselNow()), 33)

const vesselCaf =
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout

function stopVesselLoop() {
  if (vesselFrameId !== null) {
    vesselCaf(vesselFrameId)
    vesselFrameId = null
  }
}

// 单帧：推进液位缓动。
// 改造前这一帧还要重算 140 段波浪折线并 ctx.draw() 上屏；现在波形由 CSS 动画自己跑，
// 这里只改那几个被 :style 绑定的数值 —— 没有缓动要推进时就停帧（不再常驻 60fps）。
function vesselFrame(now) {
  let busy = false

  for (const which of ['start', 'end']) {
    const transition = vesselTransitions[which]
    if (!transition) continue

    const progress = Math.min(1, (now - transition.startTime) / transition.duration)
    const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic：起步快、接近目标时放缓

    levelDisplayRef(which).value = transition.from + transition.delta * eased

    if (progress >= 1) {
      levelDisplayRef(which).value = transition.from + transition.delta
      vesselTransitions[which] = null
    } else {
      busy = true
    }
  }

  // 切到其他 Tab、或所有缓动都跑完时停帧，不浪费性能
  vesselFrameId = busy && activeTab.value === 'vessel' ? vesselRaf(vesselFrame) : null
}

function startVesselLoop() {
  if (vesselFrameId === null && activeTab.value === 'vessel') {
    vesselFrameId = vesselRaf(vesselFrame)
  }
}

// 液位平滑过渡到目标值（时长随变化幅度自适应，700~2000ms）
function levelTargetRef(which) {
  return which === 'start' ? vesselStartLevel : vesselEndLevel
}

function levelDisplayRef(which) {
  return which === 'start' ? vesselStartDisplay : vesselEndDisplay
}

function animateVesselTo(which, target) {
  const displayRef = levelDisplayRef(which)
  const from = displayRef.value
  const delta = target - from

  if (Math.abs(delta) < 0.5) {
    // 液位就是 :style 的数据源，赋值即渲染，不需要像改造前那样手动重绘
    displayRef.value = target
    vesselTransitions[which] = null
    return
  }

  vesselTransitions[which] = {
    from,
    delta,
    duration: 700 + (Math.abs(delta) / vesselGeometry.value.maxLevel) * 1300,
    startTime: vesselNow(),
  }

  startVesselLoop()
}

function clampAndAnimateLevel(which, value) {
  const maxLevel = vesselGeometry.value.maxLevel
  const clamped = Math.max(0, Math.min(maxLevel, Number(value) || 0))

  if (clamped !== value) {
    levelTargetRef(which).value = clamped
    return
  }

  animateVesselTo(which, clamped)
}

watch(vesselStartLevel, (value) => clampAndAnimateLevel('start', value))
watch(vesselEndLevel, (value) => clampAndAnimateLevel('end', value))

// ===== 液位滑块：拖动 =====
// 手柄沿轨道上下拖，直接改写对应的液位。三件事决定了这么写：
//   ① **映射的是手指位移、不是手指落点**：手柄有高度、手指不可能正好按在它的中线上，
//      按落点算的话碰到手柄的一瞬间液位就跳；两个手柄被推开时（RAIL_HANDLE_MIN_PX）跳得更明显。
//      所以起手先记「液位在轨道上的真实刻度」与「起手那一点的刻度」，之后只累加位移。
//   ② **轨道有多高、在哪只能量**：宽度一变（横竖屏、分屏、切罐换底图）它就跟变，
//      所以每次起手量一次（一次 createSelectorQuery，约一帧）。量到之前收到的 move 丢掉再量。
//   ③ **拖动期间不跑缓动**：display 与 target 一起写成手指算出来的值 ——
//      target 那条既有 watcher 拿到「等于显示值」的目标，会走「没有变化」那条分支，
//      不起缓动、也不会有人跟手指抢着写 display。
let vesselRailDrag = null // 拖动会话（普通对象，不进响应式）
const RAIL_MEASURE_TRIES = 3 // 量不到图纸 rect 时的重试上限

// 触摸点 / 鼠标点的屏幕 Y。优先 clientY：两端 boundingClientRect 给的都是
// 「相对显示区域」的坐标（App/H5 就是 getBoundingClientRect，小程序同理），同一个坐标系，
// 不需要再拿 scrollOffset 换算。
function railPointerY(event) {
  const point =
    (event.touches && event.touches[0]) ||
    (event.changedTouches && event.changedTouches[0]) ||
    event // 鼠标事件（H5 桌面端）直接用
  const y = point && point.clientY
  return typeof y === 'number' ? y : null
}

// 屏幕 Y → 轨道上的百分比（0 = 罐底，100 = 罐顶）。
// 轨道挂在图纸里，位置与高度都是图纸高的百分比（sliderTopPct / sliderHeightPct）。
function railPercentOfY(rect, y) {
  const railHeight = (vesselDiagram.value.sliderHeightPct / 100) * rect.height
  if (!railHeight) return null
  const railTop = rect.top + (vesselDiagram.value.sliderTopPct / 100) * rect.height
  return (1 - (y - railTop) / railHeight) * 100
}

// 液位（mm）→ 轨道百分比：与 vesselRailHandles 画手柄用的是同一个映射
function railPercentOfLevel(level) {
  const geometry = vesselGeometry.value
  const bounds = geometry.imageBounds
  return levelBottomPercent(level, geometry, bounds, VESSEL_IMAGE_WIDTH / bounds.width)
}

// 轨道百分比 → 液位（mm）：钳到量程内并取整。算不出有限值就返回 null（不动液位）
function vesselLevelAtRailPercent(percent) {
  const geometry = vesselGeometry.value
  const bounds = geometry.imageBounds
  const level = levelFromBottomPercent(
    Math.max(0, Math.min(100, percent)),
    geometry,
    bounds,
    VESSEL_IMAGE_WIDTH / bounds.width,
  )
  if (!Number.isFinite(level)) return null
  return Math.max(0, Math.min(geometry.maxLevel, Math.round(level)))
}

function setVesselLevelFromRail(which, level) {
  vesselTransitions[which] = null // 缓动停手，别再往 display 里写
  levelDisplayRef(which).value = level
  levelTargetRef(which).value = level
}

// 量图纸的盒子。页面级查询：本页不是自定义组件，不需要 PhotoGrid 里那句 .in(instance.proxy)。
// 量不到（还没渲染 / 端上限制）就把 rect 记成 null，由调用方决定怎么办，绝不抛。
function measureVesselDiagram(callback) {
  try {
    const query = uni.createSelectorQuery()
    query.select('.vessel-diagram').boundingClientRect()
    query.exec((result) => callback(Array.isArray(result) ? result[0] : null))
  } catch (error) {
    callback(null)
  }
}

// 量轨道在屏幕上的高度，喂给 railHandleOffsets（它按像素算「让开多少」）。
// 只在面板真的显示着的时候量：面板是 v-show 常驻的，隐藏时整盒是 0，量了会把 0 记进去。
function measureVesselRailHeight() {
  if (!vesselImageReady.value || activeTab.value !== 'vessel') return
  measureVesselDiagram((rect) => {
    if (!rect || !rect.height) return
    vesselRailHeightPx.value = (vesselDiagram.value.sliderHeightPct / 100) * rect.height
  })
}

// 切 Tab / 换储罐都会让图纸换尺寸，得等到 DOM 落地之后再量（v-show 的显示状态、新罐的宽高比
// 都发生在这一刻之后）—— 所以统一用 setTimeout，而不是同步量。
// （转屏 / 改窗口同理，但没有再挂一个 resize 监听：起手拖手柄时会顺手重量一次，
//   而那个值只影响「让开多少」这条画法，量到之前与实际差一点也看不出来。）
function scheduleVesselRailMeasure(delay = 0) {
  setTimeout(measureVesselRailHeight, delay)
}

// 起手：整条轨道（含热区条与胶囊）都从这里进。落点**不**预先指定手柄 —— which 先空着，
// 第一下 move 量到 rect 之后按「落点离哪个手柄画出来的位置近」认领（nearestRailHandle）。
// 认领推迟到那时是因为认领要比屏幕像素距离，得先知道图纸 rect（异步一帧）。
function startRailDrag(event) {
  const y = railPointerY(event)
  if (y === null) return

  const drag = { which: '', y0: y, rect: null, pct0: null, fingerPct0: 0, tries: 1 }
  vesselRailDrag = drag
  vesselRailDragWhich.value = ''
  measureVesselDiagram((rect) => {
    // ⚠️ 这条守卫比的是会话对象本身，不能比 which：落到轨道上起手时 which 还是 ''，
    //    第一下 move 认领之后才变成 'start'/'end'，比 which 会把刚量到的 rect 丢掉。
    if (vesselRailDrag === drag) drag.rect = rect
    // 顺手把「轨道多高」刷新一遍（同一只盒子，不多花一次查询）——
    // 拖过一次之后让开量就是按当前屏幕算的了
    if (rect && rect.height) vesselRailHeightPx.value = (vesselDiagram.value.sliderHeightPct / 100) * rect.height
  })
}

// 屏幕 Y 离哪个手柄「画出来的位置」更近（含让开偏移，见 railHandleOffsets）。
// 两个手柄挨着时，胶囊上缘外几像素起手会落到旁边那个胶囊的热区里 ——
// 认领按落点算，认的是「手指在哪」，这类误抓就没了。
function nearestRailHandle(y, rect) {
  const railHeight = (vesselDiagram.value.sliderHeightPct / 100) * rect.height
  const railBottom = rect.top + ((vesselDiagram.value.sliderTopPct + vesselDiagram.value.sliderHeightPct) / 100) * rect.height
  let best = 'start'
  let bestDist = Infinity
  for (const handle of vesselRailHandles.value) {
    // 胶囊中心 = 轨道底 − 刻度高度 − 让开量（bottom% + margin-bottom 把盒底推到那儿，translateY(50%) 再把中心压上去）
    const centerY = railBottom - (handle.percent / 100) * railHeight - handle.offsetPx
    const dist = Math.abs(y - centerY)
    if (dist < bestDist) {
      bestDist = dist
      best = handle.which
    }
  }
  return best
}

function moveRailDrag(event) {
  const drag = vesselRailDrag
  if (!drag) return
  const y = railPointerY(event)
  if (y === null) return

  if (!drag.rect) {
    if (drag.tries < RAIL_MEASURE_TRIES) {
      drag.tries += 1
      measureVesselDiagram((rect) => {
        if (vesselRailDrag === drag && !drag.rect) drag.rect = rect
      })
    }
    return
  }

  if (drag.which === '') {
    // 落到轨道（不是胶囊）上起的拖：按落点认领一个手柄。
    // 认领之后走的是与直接抓胶囊完全相同的那条路 —— 锚点仍按认领到的液位算，液位不跳。
    drag.which = nearestRailHandle(drag.y0, drag.rect)
    vesselRailDragWhich.value = drag.which
  }

  if (drag.pct0 === null) {
    // 锚点：起手时液位所在的真实刻度 + 起手那一点的刻度。两者之差就是「手指位移」，
    // 于是第一下 move 算出来的液位仍然等于起手时的液位 —— 液位不跳，手柄才开始跟手。
    const anchorPct = railPercentOfLevel(levelDisplayRef(drag.which).value)
    const fingerPct = railPercentOfY(drag.rect, drag.y0)
    if (fingerPct === null) return
    drag.pct0 = anchorPct
    drag.fingerPct0 = fingerPct
  }

  const fingerPct = railPercentOfY(drag.rect, y)
  if (fingerPct === null) return
  const level = vesselLevelAtRailPercent(drag.pct0 + (fingerPct - drag.fingerPct0))
  if (level !== null) setVesselLevelFromRail(drag.which, level)
}

function endRailDrag() {
  if (!vesselRailDrag) return
  vesselRailDrag = null
  vesselRailDragWhich.value = ''
}

// 触摸端起手时挡一下随后补发的 mouse 事件（触摸屏上浏览器会在 touchend 之后补一套 mouse 兼容事件）
let railLastTouchAt = 0
const RAIL_TOUCH_DEDUPE_MS = 700

function startRailDragByTouch(event) {
  railLastTouchAt = Date.now()
  startRailDrag(event)
}

// 鼠标拖出胶囊也要继续跟手，所以 move / up 挂在 window 上（只有 H5 桌面端会走到这里，
// 真机与小程序端没有 mouse 事件；页面内那三个 @touch 事件本来就跟元素走）。
function handleRailMouseMove(event) {
  moveRailDrag(event)
}

function stopRailMouseDrag() {
  window.removeEventListener('mousemove', handleRailMouseMove)
  window.removeEventListener('mouseup', stopRailMouseDrag)
  endRailDrag()
}

function startRailDragByMouse(event) {
  if (Date.now() - railLastTouchAt < RAIL_TOUCH_DEDUPE_MS) return
  startRailDrag(event)
  if (!vesselRailDrag) return
  window.addEventListener('mousemove', handleRailMouseMove)
  window.addEventListener('mouseup', stopRailMouseDrag)
}

// 切换储罐：液位按新罐径钳制、底图按需切换
// （底图交给 <image> 自己加载 —— src 一换就重新取图；这里只负责让面板淡出淡入，
//   把换图那一瞬的空档盖住）
watch(vesselKey, () => {
  const maxLevel = vesselGeometry.value.maxLevel

  for (const which of ['start', 'end']) {
    const targetRef = levelTargetRef(which)
    const displayRef = levelDisplayRef(which)

    if (targetRef.value > maxLevel) targetRef.value = maxLevel
    if (displayRef.value > maxLevel) {
      displayRef.value = maxLevel
      vesselTransitions[which] = null
    }
  }

  vesselSwitching.value = true
  setTimeout(() => {
    vesselSwitching.value = false
  }, 330)

  // 换罐换底图 → 图纸宽高比变 → 轨道高度变，让开量要按新的算。
  // 等 360ms 是因为 .vessel-diagram 的 aspect-ratio 自己带了 320ms 过渡：
  // 刚换完那一刻量到的还是**旧**罐子的高度，立式↔卧式差了 100 多像素。
  scheduleVesselRailMeasure(360)
})

// 离开页面时的清理。
// 注册两份是因为：小程序端页面销毁走的是 uni-app 的 onUnload，
// 而 H5/App 端 Vue 的 onUnmounted 也会触发（两边都调一次也无妨，清理函数是幂等的）。
function cleanupVessel() {
  stopVesselLoop()
  // 拖到一半离开页面：把挂在 window 上的那两个鼠标监听摘掉、把会话丢掉。
  // typeof 这一问是给小程序端的 —— 那边没有 window，而 cleanup 每条路径都会走到。
  if (typeof window !== 'undefined') {
    window.removeEventListener('mousemove', handleRailMouseMove)
    window.removeEventListener('mouseup', stopRailMouseDrag)
  }
  endRailDrag()
}

onMounted(() => {
  fetchAdminOnlyData()
  fetchStockRecords()
  // 罐体底图（约 645 KB）改为切到压力容器 Tab 时按需加载，不拖慢首屏
})

// 补拉登录后的 admin 明细：登录页是 navigateTo 进去、saveAuth 后 navigateBack 回来的，
// 首页不重建、onMounted 不再跑（挂载那一次被 fetchAdminOnlyData 里的 isAdmin() 挡掉了）。
// 于是「未登录进首页 → 登录 → 工单/领料/入库/货物移动几页有权限却一直空着」。
// authState 是响应式的，权限一到就补拉，取的四个数据集与挂载时完全一致。
watch(() => isAdmin(), (admin) => {
  if (admin) fetchAdminOnlyData()
})

onUnmounted(cleanupVessel)
onUnload(cleanupVessel)

// 切到压力容器 Tab 时才渲染底图（首次约 645 KB），离开时停帧
watch(activeTab, (tab) => {
  if (tab === 'vessel') {
    // 锁存后一直渲染，来回切 Tab 不会重新加载
    vesselImageReady.value = true
    // 切回来时若还有没跑完的缓动，接上帧循环
    if (vesselTransitions.start || vesselTransitions.end) startVesselLoop()
    // 面板刚显示出来才量得到轨道的实际高度（隐藏时整盒是 0）
    scheduleVesselRailMeasure()
  } else {
    stopVesselLoop()
  }

  // 月底储罐液位记录同理：首次进这个 Tab 才拉数据（含属地下拉选项），
  // 已经取过就不再打接口 —— 面板是 v-show 常驻的，挂载时机与切 Tab 不是一回事
  if (tab === 'tankLevel') {
    ensureTankLevelLoaded()
  }

  // 周统计：进 Tab 时取一次汇总数（日期没变就不必重复请求）
  if (tab === 'weekly') {
    fetchWeeklyStats()
  }

  // 三个聚合页：进 Tab 时重取自己的汇总数据。
  // 它们的行来自明细（入库 / 领料 / 工单 / 货物移动），而那几份明细随时可能被
  // 另一端（电脑端、另一台手机、图片解析）改动 —— 进页面就实查一次，
  // 省得又出现「数据明明有、这一页看不到」。
  if (tab === 'report' || tab === 'costing') {
    fetchWorkOrderSummary()
  }
  if (tab === 'costing') {
    fetchInboundSummary()
  }
  if (tab === 'materialCosting') {
    fetchPickSummary()
    fetchGoodsMoveSummary()
  }

  // 离开「写入页」且期间写成功 → 刷新各数据集。
  //
  // ⚠️ 条件里**不再限定 prevTab === 'import'**：图片解析（imageParse）也会落库，
  // 原先它既不发通知、这里也不认它，于是「图片解析入库 → 切到领料汇总看不到新记录」
  // （本次整改要修的就是这条）。只要 dirty 就重拉，谁写的都算。
  if (importDirty.value) {
    importDirty.value = false
    refreshAllData()
  }
})

/**
 * 下拉刷新：重拉**当前面板**的数据。
 *
 * ⚠️ 只能按 activeTab 分发，不能「全部重拉」—— 9 个面板的取数函数一起打出去，
 * 每次下拉都会白打好几个与当前页面无关的接口（其中空调的还会报 403）。
 */
onPullDownRefresh(async () => {
  try {
    switch (activeTab.value) {
      case 'workOrder':
      case 'report':
        await Promise.all([fetchWorkOrders(), fetchWorkOrderSummary()])
        break
      case 'material':
        await Promise.all([fetchPickRecords(), fetchPickSummary()])
        break
      case 'inbound':
        await Promise.all([fetchInboundRecords(), fetchInboundSummary()])
        break
      case 'costing':
        await Promise.all([fetchWorkOrderSummary(), fetchInboundSummary()])
        break
      case 'materialCosting':
        await Promise.all([fetchPickSummary(), fetchGoodsMoveSummary()])
        break
      case 'stock':
        await fetchStockRecords()
        break
      case 'tankLevel':
        await Promise.all([fetchTankLevelLocations(), fetchTankLevelRecords()])
        break
      case 'equipment':
        await loadLedger()
        break
      case 'weekly':
        fetchWeeklyStats()
        break
      case 'daily':
      case 'vessel':
      case 'imageParse':
      case 'import':
      default:
        // 这几页没有需要重拉的列表数据（日报表是占位页，图片解析/文件导入是写入页，
        // 压力容器体积计算是纯前端换算），直接结束下拉即可
        break
    }
  } finally {
    // 不 stop 的话加载动画会一直转 —— 放在 finally 里，接口失败也要收
    uni.stopPullDownRefresh()
  }
})
</script>

<template>
  <!-- 改造前这里套了一层 <el-config-provider :locale="zhCn"> 只为给 Element Plus 注入
       中文 locale。wot-design-uni 默认就是中文，不需要这层包裹，直接去掉。
       原来写死在这层的 Tailwind 布局类（min-h-screen / px-4 py-8 …）
       挪到 .page 里 —— 顶部还要叠加状态栏高度，Tailwind 表达不了 calc(var())。
       ⚠️ 这一层原先还绑着 touchstart/move/end 三个把页面手势转发给抽屉的监听，
       2026-10-10 全部去掉：那段屏幕边缘要留给系统的内滑返回手势（见上面 onBackPress 那段）。 -->
  <view
    class="page"
    :class="themeClass"
    :style="pageVars"
  >
    <!-- 主题统一交给 wot-design-uni 的 config-provider：
         日期选择器、弹层、Toast、MessageBox 这些组件不用逐个改色。
         theme 跟随 useTheme()（wot-theme-light 无样式 = 它自己的浅色默认值）。
         原来这里还有一层 <view class="mx-auto max-w-7xl">，
         现在把这层类名挂到 provider 上，少一层无意义的嵌套。 -->
    <wd-config-provider
      :theme="wotTheme"
      :theme-vars="themeVars"
      custom-class="page__shell mx-auto max-w-7xl"
    >
      <!-- 顶部栏（豆包式）：左上角菜单按钮 → 左侧抽屉导航；
           中间只显示"当前面板 + 一句话说明"；右侧主题切换 + 账户入口。
           原来的横向胶囊 Tab 条已移除 —— 12 个标签在手机上横滑仍然局促，
           导航全部收进抽屉后正文也能铺满整屏。 -->
      <header class="topbar">
        <button class="topbar__btn" aria-label="打开菜单" @click="openMenu">
          <view class="burger">
            <view class="burger__bar"></view>
            <view class="burger__bar is-short"></view>
            <view class="burger__bar"></view>
          </view>
        </button>

        <view class="topbar__meta">
          <text class="topbar__name">{{ activeTabMeta.label }}</text>
          <text class="topbar__hint">{{ activeTabMeta.hint }}</text>
        </view>

        <!-- 深色 / 浅色切换：按钮与图标见 components/ThemeToggle.vue -->
        <ThemeToggle />

        <button class="topbar__btn" aria-label="账户与功能菜单" @click="openMenu">
          <wd-icon name="user" size="20px" />
        </button>
      </header>

      <div v-show="activeTab === 'workOrder'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
            <DateField v-model="startDate" placeholder="起始日期" @change="reloadWorkOrders" />
            <span class="text-sm text-slate-500">至</span>
            <DateField v-model="endDate" placeholder="结束日期" @change="reloadWorkOrders" />
          </div>

          <div class="relative">
            <LoadingMask v-if="loading" />

        <PanelState
              v-else-if="errorMessage"
              type="error"
              title="暂时无法获取工单"
              :description="errorMessage"
              action-text="重新加载"
              @action="fetchWorkOrders"
            />

        <PanelState
              v-else-if="tableData.length === 0 && !productFilter && !orderTypeFilter && !orderNoFilter"
              title="暂无工单数据"
              description="当前没有可展示的工单记录"
            />

        <div v-else>
          <div class="overflow-x-auto">
            <view class="dt dt--scroll min-w-full divide-y divide-slate-200 text-left">
              <view class="dt__head bg-slate-50">
                <view class="dt__row">
                  <view
                    v-for="column in columns"
                    :key="column.key"
                    scope="col"
                    class="dt__cell whitespace-nowrap py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="[column.width, column.align === 'right' ? 'pl-2 pr-3 text-right' : column.align === 'center' ? 'px-2 text-center' : 'px-2']"
                  >
                    <template v-if="column.key === 'orderNo'">
                      <FilterHeaderCell
                        :label="column.label"
                        :selected="orderNoFilter"
                        hint="工单号"
                        :max-width="130"
                        @open="openOrderNoDialog"
                        @clear="clearOrderNoFilter"
                      />
                    </template>

                    <template v-else-if="column.key === 'orderType'">
                      <FilterHeaderCell
                        :label="column.label"
                        :selected="orderTypeFilter"
                        hint="工单类型"
                        :max-width="110"
                        @open="openOrderTypeDialog"
                        @clear="clearOrderTypeFilter"
                      />
                    </template>

                    <template v-else-if="column.key === 'materialDesc'">
                      <FilterHeaderCell
                        :label="column.label"
                        :selected="productFilter"
                        hint="产成品"
                        :max-width="110"
                        @open="openProductDialog"
                        @clear="clearProductFilter"
                      />
                    </template>

                    <template v-else>{{ column.label }}</template>
                  </view>
                </view>
              </view>
              <view class="dt__body divide-y divide-slate-100 bg-white">
                <view class="dt__row" v-if="tableData.length === 0">
                  <view class="dt__empty px-3 py-16 text-center text-sm text-slate-400">
                    没有符合筛选条件的工单
                  </view>
                </view>
                <view v-for="(order, index) in tableData" :key="`${order.orderNo}-${index}`" class="dt__row transition hover:bg-slate-50">
                  <view class="dt__cell w-10 whitespace-nowrap px-2 py-2 text-center text-sm font-semibold text-slate-900">{{ (pageNum - 1) * pageSize + index + 1 }}</view>
                  <view class="dt__cell w-24 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ order.planStartDate }}</view>
                  <view class="dt__cell w-28 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ order.orderNo }}</view>
                  <view class="dt__cell w-24 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ getReportOrderType(order.orderNo) }}</view>
                  <view class="dt__cell w-28 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ order.materialCode }}</view>
                  <view class="dt__cell w-40 whitespace-normal break-words px-2 py-2 text-sm text-slate-700">
                    {{ order.materialDesc }}
                  </view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ order.orderQty }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ order.confirmedQty }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ order.deliveredQty }}</view>
                </view>
              </view>
            </view>
          </div>

        </div>
          </div>

        <!-- 分页停靠栏：各调用点统一按这个形态写（其余几处照抄本节）。
             容器只用 .pager-dock 一个类 —— 样式（贴屏幕底、玻璃底、高度与安全区）
             全在 App.vue 里那一份，居中由它的 flex 负责。
             ⚠️ 必须放在 v-if/v-else 之外：留在里面的话翻页时 loading 置真会把它
                整个卸载，底栏就每翻一页闪一下（它现在常驻屏幕，闪一下非常显眼）。
             ⚠️ 门槛 total > 0：composable 只在请求成功时写总条数、出错时置 0，
                所以翻页过程中恒 > 0（不闪），首次进入/报错/空结果时整条消失 ——
                那三种状态下本来就没有"页"可翻。
             ⚠️ 翻页要顺带回顶（scrollPageToTop）：按钮已固定不动，不回顶的话新一页
                停在第几行取决于上一页的滚动位置，反而更难预期。 -->
        <div v-if="total > 0" class="pager-dock" :class="{ 'is-busy': loading }">
          <!-- wd-pagination 的 change 事件传的是 `{ value: N }` 对象，不是页码本身
               （el-pagination 传的是数字，迁移时直接绑函数会拿到对象）。
               而 change 又在 update:modelValue 之前触发，此时 pageNum 还是旧值，
               所以必须把新的页码显式取出来传进去，不能靠 v-model 已更新。 -->
          <wd-pagination
            v-model="pageNum"
            :total="total"
            :page-size="pageSize"
            show-message
            :hide-if-one-page="false"
            @change="(event) => { loadWorkOrderPage(event.value); scrollPageToTop() }"
          />
        </div>
        </section>

      <!-- 单张工单的图片查看器。
           改造前是 el-dialog（width="80vw"，居中弹窗）。
           移动端看大图更适合近全屏，改成 wd-popup 居中弹层；
           原来的 #header / #footer 两个具名插槽在 wd-popup 里没有对应物，
           直接落成普通的头部/底部块。 -->
      <wd-popup
        v-model="imageDialogVisible"
        position="center"
        custom-style="width: 92vw; max-height: 88vh; border-radius: 22px; background-color: var(--ui-glass-fill); border: 1px solid var(--ui-border); display: flex; flex-direction: column; overflow: hidden;"
      >
        <view class="viewer-head">
          <text>物料描述：{{ currentMaterialDesc }}</text>
          <text>确认的产量：{{ currentConfirmedQty }}</text>
        </view>

        <view class="viewer-body">
          <view v-if="imageList.length" class="viewer-stage">
            <view
              v-if="imageList.length > 1"
              class="viewer-nav viewer-nav--prev"
              aria-label="上一张"
              @click="showPreviousImage"
            >
              <text>‹</text>
            </view>

            <!-- <img> 要换成 <image>：uni 的 image 组件用 mode 控制填充方式，
                 没有 object-contain 那套 CSS；且必须给显式高度才撑得开。 -->
            <!-- 图片区换成带手势缩放的内嵌查看器（替代写死高度的 <image>） -->
            <ImageViewer
              mode="inline"
              :urls="workOrderViewerUrls"
              :current="currentIndex"
            />
            <view
              v-if="imageList.length > 1"
              class="viewer-nav viewer-nav--next"
              aria-label="下一张"
              @click="showNextImage"
            >
              <text>›</text>
            </view>

            <view v-if="hasPerm('work_order:image:delete')" class="viewer-stage__delete">
              <wd-button
                type="error"
                size="small"
                :loading="imageDeleting"
                @click="deleteImage(imageList[currentIndex])"
              >
                删除当前图片
              </wd-button>
            </view>
          </view>

          <text v-else class="viewer-empty">暂无图片</text>
        </view>

        <view v-if="imageList.length" class="viewer-counter">
          第 {{ currentIndex + 1 }} 张 / 共 {{ imageList.length }} 张
        </view>

        <view class="viewer-foot">
          <!-- 原来的隐藏 <input type="file"> 已移除：
               小程序/App 没有 DOM，改用 uni.chooseImage（见 openImagePicker） -->
          <wd-button
            v-if="hasPerm('work_order:image:upload')"
            :loading="imageUploading"
            @click="openImagePicker"
          >
            添加图片
          </wd-button>
        </view>
      </wd-popup>

      <ProductSelectDialog
        v-model="productDialogVisible"
        :options="productOptions"
        :selected="productFilter"
        icon="shop"
        @select="handleProductSelected"
      />

      <ProductSelectDialog
        v-model="orderTypeDialogVisible"
        :options="orderTypeOptions"
        :selected="orderTypeFilter"
        label="工单类型"
        icon="list"
        @select="handleOrderTypeSelected"
      />

      <ProductSelectDialog
        v-model="orderNoDialogVisible"
        :options="orderNoOptions"
        :selected="orderNoFilter"
        label="工单号"
        icon="file"
        @select="handleOrderNoSelected"
      />
      </div>

      <div v-show="activeTab === 'material'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-2.5">
            <DateField v-model="pickStartDate" placeholder="起始日期" @change="reloadPickRecords" />
            <span class="text-sm text-slate-500">至</span>
            <DateField v-model="pickEndDate" placeholder="结束日期" @change="reloadPickRecords" />
          </div>

          <div class="relative">
            <LoadingMask v-if="pickLoading" />

            <PanelState
              v-else-if="pickError"
              type="error"
              title="暂时无法获取领料汇总"
              :description="pickError"
              action-text="重新加载"
              @action="fetchPickRecords"
            />

            <PanelState
              v-else-if="pickTableData.length === 0"
              :title="pickMaterialFilter ? '没有符合筛选条件的记录' : '暂无领料数据'"
              :description="pickMaterialFilter ? `当前筛选：${pickMaterialFilter}` : '当前没有可展示的领料记录'"
            />

            <div v-else>
              <div class="overflow-x-auto">
                <view class="dt dt--scroll min-w-full divide-y divide-slate-200 text-left">
                  <view class="dt__head bg-slate-50">
                    <view class="dt__row">
                      <view
                        v-for="column in pickColumns"
                        :key="column.key"
                        scope="col"
                        class="dt__cell whitespace-nowrap py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                        :class="[column.width, column.align === 'right' ? 'pl-2 pr-3 text-right' : column.align === 'center' ? 'px-2 text-center' : 'px-2']"
                      >
                        <template v-if="column.key === 'materialName'">
                          <FilterHeaderCell
                            :label="column.label"
                            :selected="pickMaterialFilter"
                            hint="物料名称"
                            :max-width="130"
                            @open="openPickMaterialDialog"
                            @clear="clearPickMaterialFilter"
                          />
                        </template>

                        <template v-else>{{ column.label }}</template>
                      </view>
                    </view>
                  </view>
                  <view class="dt__body divide-y divide-slate-100 bg-white">
                    <view
                      v-for="(record, index) in pickTableData"
                      :key="`${record.materialCode}-${record.pickDate}-${index}`"
                      class="dt__row transition hover:bg-slate-50"
                    >
                      <view class="dt__cell w-10 whitespace-nowrap px-2 py-2 text-center text-sm font-semibold text-slate-900">{{ (pickPageNum - 1) * pickPageSize + index + 1 }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ record.pickDate }}</view>
                      <view class="dt__cell w-40 whitespace-normal break-words px-2 py-2 text-sm text-slate-700">
                        {{ record.materialName }}
                      </view>
                      <view class="dt__cell w-28 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ record.materialCode }}</view>
                      <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ record.pickQty }}</view>
                      <view class="dt__cell w-16 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ record.unit }}</view>
                      <view class="dt__cell w-16 whitespace-nowrap px-2 py-2 text-sm text-slate-600">
                        <view
                          class="thumb"
                          :aria-label="record.imageUrl || record.thumbnailUrl ? '查看领料单据' : '暂无图片'"
                          @click="openPickImageDialog(record)"
                        >
                          <!-- 占位图标：原来用内联 <svg>，小程序不支持 svg 标签，换组件库图标 -->
                          <wd-icon name="picture" size="12px" />
                          <!-- 缩略图：缺失时回退原图；加载失败逐级降级（见 handleImgError），
                               最终隐藏并露出底层图标。src 要过 resolveAssetUrl ——
                               后端返回的是 /thumbs、/files 这类相对路径。 -->
                          <image
                            v-if="(record.thumbnailUrl || record.imageUrl) && !isThumbnailHidden(record)"
                            class="thumb__img"
                            :src="resolveAssetUrl(resolveThumbnail(record))"
                            mode="aspectFill"
                            lazy-load
                            alt="领料单据"
                            @error="handleImgError($event, record)"
                          />
                        </view>
                      </view>
                    </view>
                  </view>
                </view>
              </div>

            </div>
          </div>

        <!-- 分页停靠栏：形态同工单汇总那处（那边有完整说明） -->
        <div v-if="pickTotal > 0" class="pager-dock" :class="{ 'is-busy': pickLoading }">
          <!-- 事件载荷是 { value: N }，同工单汇总那处分页 -->
          <wd-pagination
            v-model="pickPageNum"
            :total="pickTotal"
            :page-size="pickPageSize"
            show-message
            :hide-if-one-page="false"
            @change="(event) => { loadPickPage(event.value); scrollPageToTop() }"
          />
        </div>
        </section>

        <!-- 领料单据大图：同上 —— 原来的居中卡片弹窗（.simple-viewer__img 没有任何样式，
             图片按 uni 默认的 320×240 渲染，也不能缩放）已下线，
             统一改成页面根部的 <ImageViewer /> 全屏查看器，见 openPickImageDialog。 -->
        <ProductSelectDialog
          v-model="pickMaterialDialogVisible"
          :options="pickMaterialOptions"
          :selected="pickMaterialFilter"
          label="物料名称"
          icon="cart"
          @select="handlePickMaterialSelected"
        />
      </div>

      <div v-show="activeTab === 'inbound'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-2.5">
            <DateField v-model="inboundStartDate" placeholder="起始日期" @change="reloadInboundRecords" />
            <span class="text-sm text-slate-500">至</span>
            <DateField v-model="inboundEndDate" placeholder="结束日期" @change="reloadInboundRecords" />
          </div>

          <div class="relative">
            <LoadingMask v-if="inboundLoading" />

            <PanelState
              v-else-if="inboundError"
              type="error"
              title="暂时无法获取入库汇总"
              :description="inboundError"
              action-text="重新加载"
              @action="fetchInboundRecords"
            />

            <PanelState
              v-else-if="inboundTableData.length === 0"
              :title="inboundMaterialFilter ? '没有符合筛选条件的记录' : '暂无入库数据'"
              :description="inboundMaterialFilter ? `当前筛选：${inboundMaterialFilter}` : '当前没有可展示的入库记录'"
            />

            <div v-else>
              <div class="overflow-x-auto">
                <view class="dt dt--scroll min-w-full divide-y divide-slate-200 text-left">
                  <view class="dt__head bg-slate-50">
                    <view class="dt__row">
                      <view
                        v-for="column in inboundColumns"
                        :key="column.key"
                        scope="col"
                        class="dt__cell whitespace-nowrap py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                        :class="[column.width, column.align === 'right' ? 'pl-2 pr-3 text-right' : column.align === 'center' ? 'px-2 text-center' : 'px-2']"
                      >
                        <template v-if="column.key === 'materialName'">
                          <FilterHeaderCell
                            :label="column.label"
                            :selected="inboundMaterialFilter"
                            hint="物料名称"
                            :max-width="130"
                            @open="openInboundMaterialDialog"
                            @clear="clearInboundMaterialFilter"
                          />
                        </template>

                        <template v-else>{{ column.label }}</template>
                      </view>
                    </view>
                  </view>
                  <view class="dt__body divide-y divide-slate-100 bg-white">
                    <view
                      v-for="(record, index) in inboundTableData"
                      :key="`${record.materialCode}-${record.inboundDate}-${index}`"
                      class="dt__row transition hover:bg-slate-50"
                    >
                      <view class="dt__cell w-10 whitespace-nowrap px-2 py-2 text-center text-sm font-semibold text-slate-900">{{ (inboundPageNum - 1) * inboundPageSize + index + 1 }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ record.inboundDate }}</view>
                      <view class="dt__cell w-40 whitespace-normal break-words px-2 py-2 text-sm text-slate-700">
                        {{ record.materialName }}
                      </view>
                      <view class="dt__cell w-28 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ record.materialCode }}</view>
                      <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ record.inboundQty }}</view>
                      <view class="dt__cell w-16 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ record.unit }}</view>
                      <view class="dt__cell w-16 whitespace-nowrap px-2 py-2 text-sm text-slate-600">
                        <view
                          class="thumb"
                          :aria-label="record.imageUrl || record.thumbnailUrl ? '查看入库单据' : '暂无图片'"
                          @click="openInboundImageDialog(record)"
                        >
                          <!-- 占位图标：原来用内联 <svg>，小程序不支持 svg 标签，换组件库图标 -->
                          <wd-icon name="picture" size="12px" />
                          <!-- 缩略图：缺失时回退原图；加载失败逐级降级（见 handleImgError），
                               最终隐藏并露出底层图标。src 要过 resolveAssetUrl ——
                               后端返回的是 /thumbs、/files 这类相对路径。 -->
                          <image
                            v-if="(record.thumbnailUrl || record.imageUrl) && !isThumbnailHidden(record)"
                            class="thumb__img"
                            :src="resolveAssetUrl(resolveThumbnail(record))"
                            mode="aspectFill"
                            lazy-load
                            alt="入库单据"
                            @error="handleImgError($event, record)"
                          />
                        </view>
                      </view>
                    </view>
                  </view>
                </view>
              </div>

            </div>
          </div>

        <!-- 分页停靠栏：形态同工单汇总那处（那边有完整说明） -->
        <div v-if="inboundTotal > 0" class="pager-dock" :class="{ 'is-busy': inboundLoading }">
          <!-- 事件载荷是 { value: N }，同工单汇总那处分页 -->
          <wd-pagination
            v-model="inboundPageNum"
            :total="inboundTotal"
            :page-size="inboundPageSize"
            show-message
            :hide-if-one-page="false"
            @change="(event) => { loadInboundPage(event.value); scrollPageToTop() }"
          />
        </div>
        </section>

        <!-- 入库单据大图：原来的居中卡片弹窗（图片走 uni <image> 默认的 320×240、
             没有任何样式也放不大）已下线，统一改成页面根部的 <ImageViewer /> 全屏查看器，
             见 openInboundImageDialog。 -->
        <ProductSelectDialog
          v-model="inboundMaterialDialogVisible"
          :options="inboundMaterialOptions"
          :selected="inboundMaterialFilter"
          label="物料名称"
          icon="download"
          @select="handleInboundMaterialSelected"
        />
      </div>

      <div v-show="activeTab === 'report'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <view class="dt dt--scroll min-w-full divide-y divide-slate-200 text-left">
              <view class="dt__head bg-slate-50">
                <view class="dt__row">
                  <view
                    v-for="column in reportColumns"
                    :key="column.key"
                    scope="col"
                    class="dt__cell whitespace-nowrap py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="[column.width, column.align === 'right' ? 'pl-2 pr-3 text-right' : column.align === 'center' ? 'px-2 text-center' : 'px-2']"
                  >
                    {{ column.label }}
                  </view>
                </view>
              </view>
              <view class="dt__body divide-y divide-slate-100 bg-white">
                <view class="dt__row" v-if="reportRows.length === 0">
                  <view class="dt__empty px-3 py-16 text-center text-sm text-slate-400">
                    暂无报工数据
                  </view>
                </view>
                <view
                  v-for="(item, index) in reportRows"
                  :key="`${item.orderType}-${item.materialDesc}-${index}`"
                  class="dt__row transition hover:bg-slate-50"
                >
                  <view class="dt__cell w-10 whitespace-nowrap px-2 py-2 text-center text-sm font-semibold text-slate-900">{{ index + 1 }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ item.orderType }}</view>
                  <view class="dt__cell w-40 whitespace-normal break-words px-2 py-2 text-sm text-slate-700">
                    {{ item.materialDesc }}
                  </view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ item.orderQty }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ item.confirmedQty }}</view>
                </view>
              </view>
            </view>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'costing'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <view class="dt dt--scroll min-w-full divide-y divide-slate-200 text-left">
              <view class="dt__head bg-slate-50">
                <view class="dt__row">
                  <view
                    v-for="column in costingColumns"
                    :key="column.key"
                    scope="col"
                    class="dt__cell whitespace-nowrap py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="[column.width, column.align === 'right' ? 'pl-2 pr-3 text-right' : column.align === 'center' ? 'px-2 text-center' : 'px-2']"
                  >
                    {{ column.label }}
                  </view>
                </view>
              </view>
              <view class="dt__body divide-y divide-slate-100 bg-white">
                <view class="dt__row" v-if="costingRows.length === 0">
                  <view class="dt__empty px-3 py-16 text-center text-sm text-slate-400">
                    暂无核算数据
                  </view>
                </view>
                <view
                  v-for="(item, index) in costingRows"
                  :key="`${item.materialName}-${index}`"
                  class="dt__row transition hover:bg-slate-50"
                >
                  <view class="dt__cell w-10 whitespace-nowrap px-2 py-2 text-center text-sm font-semibold text-slate-900">{{ index + 1 }}</view>
                  <view class="dt__cell w-40 whitespace-normal break-words px-2 py-2 text-sm text-slate-700">
                    {{ item.materialName }}
                  </view>
                  <view class="dt__cell w-28 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ item.materialCode }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ item.inboundQty }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ item.reportedQty }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm font-semibold text-gold-700">{{ item.unreportedQty }}</view>
                </view>
              </view>
            </view>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'materialCosting'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <view class="dt dt--scroll min-w-full divide-y divide-slate-200 text-left">
              <view class="dt__head bg-slate-50">
                <view class="dt__row">
                  <view
                    v-for="column in materialCostingColumns"
                    :key="column.key"
                    scope="col"
                    class="dt__cell whitespace-nowrap py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="[column.width, column.align === 'right' ? 'pl-2 pr-3 text-right' : column.align === 'center' ? 'px-2 text-center' : 'px-2']"
                  >
                    {{ column.label }}
                  </view>
                </view>
              </view>
              <view class="dt__body divide-y divide-slate-100 bg-white">
                <view class="dt__row" v-if="materialCostingRows.length === 0">
                  <view class="dt__empty px-3 py-16 text-center text-sm text-slate-400">
                    暂无核算数据
                  </view>
                </view>
                <view
                  v-for="(item, index) in materialCostingRows"
                  :key="`${item.materialName}-${index}`"
                  class="dt__row transition hover:bg-slate-50"
                >
                  <view class="dt__cell w-10 whitespace-nowrap px-2 py-2 text-center text-sm font-semibold text-slate-900">{{ index + 1 }}</view>
                  <view class="dt__cell w-40 whitespace-normal break-words px-2 py-2 text-sm text-slate-700">
                    {{ item.materialName }}
                  </view>
                  <view class="dt__cell w-28 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ item.materialCode }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ item.pickQty }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ item.reportedQty }}</view>
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm font-semibold text-gold-700">{{ item.unreportedQty }}</view>
                </view>
              </view>
            </view>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'stock'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-2.5">
            <view class="filter-search">
              <wd-icon name="search" size="14px" />
              <!-- ⚠️ 查询改到服务端之后**只能回车 / 键盘搜索键才发请求**：
                   原先这里还挂着 @input（逐字实时过滤），那是「前端全量 + 本地 filter」
                   时代的做法，照搬到服务端就是「敲一个字打一次接口」。 -->
              <input
                v-model="stockKeyword"
                class="filter-search__input"
                type="text"
                placeholder="物料编码 / 物料描述"
                placeholder-class="ui-placeholder"
                confirm-type="search"
                @confirm="applyStockFilter"
              />
            </view>

            <!-- 库存快照语义下会留下一批数量为 0 的物料行（信息保留供查询），
                 默认把它们收起来，需要时点开看 -->
            <view
              class="filter-chip"
              :class="stockOnlyInStock ? 'is-on' : ''"
              @click="toggleStockOnlyInStock"
            >
              <wd-icon :name="stockOnlyInStock ? 'check' : 'goods'" size="14px" />
              只看有库存
            </view>

          </div>

          <div class="relative">
            <LoadingMask v-if="stockLoading" />

            <PanelState
              v-else-if="stockError"
              type="error"
              title="暂时无法获取物料库存"
              :description="stockError"
              action-text="重新加载"
              @action="fetchStockRecords"
            />

            <!-- 「只看有库存」默认关着（这一页是查物料信息，不是看有多少货），
                 所以空态只在「有关键词 / 开了筛选」时才说筛选的事 -->
            <PanelState
              v-else-if="stockTableData.length === 0"
              :title="stockKeyword || stockOnlyInStock ? '没有符合筛选条件的记录' : '暂无库存数据'"
              :description="
                stockKeyword || stockOnlyInStock
                  ? '换个关键词，或取消「只看有库存」看看'
                  : stockImportHint
              "
            />

            <div v-else>
              <!-- 9 列在手机宽度下必然溢出：外层 overflow-x-auto + .dt--scroll，
                   与其它 6 张表一致（见样式区 .dt--scroll 的说明） -->
              <div class="overflow-x-auto">
                <view class="dt dt--scroll min-w-full divide-y divide-slate-200 text-left">
                  <view class="dt__head bg-slate-50">
                    <view class="dt__row">
                      <view
                        v-for="column in STOCK_COLUMNS"
                        :key="column.key"
                        class="dt__cell whitespace-nowrap py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                        :class="[
                          column.width,
                          column.align === 'right'
                            ? 'pl-2 pr-3 text-right'
                            : column.align === 'center'
                              ? 'px-2 text-center'
                              : 'px-2',
                        ]"
                      >
                        {{ column.label }}
                      </view>
                    </view>
                  </view>
                  <view class="dt__body divide-y divide-slate-100 bg-white">
                    <view
                      v-for="(record, index) in stockTableData"
                      :key="`${record.plantCode}-${record.materialCode}-${record.storageLocation}-${index}`"
                      class="dt__row transition hover:bg-slate-50"
                    >
                      <view class="dt__cell w-10 whitespace-nowrap px-2 py-2 text-center text-sm font-semibold text-slate-900">{{ (stockPageNum - 1) * stockPageSize + index + 1 }}</view>
                      <view class="dt__cell w-28 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ displayText(record.materialCode) }}</view>
                      <view class="dt__cell w-40 whitespace-normal break-words px-2 py-2 text-sm text-slate-700">{{ displayText(record.materialName) }}</view>
                      <view class="dt__cell w-28 whitespace-normal break-words px-2 py-2 text-sm text-slate-600">{{ displayText(record.spec) }}</view>
                      <view class="dt__cell w-16 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ displayText(record.storageLocation) }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ displayText(record.unit) }}</view>
                      <view
                        class="dt__cell w-32 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm font-semibold"
                        :class="Number(record.stockQty) > 0 ? 'text-slate-900' : 'text-slate-400'"
                      >
                        {{ displayText(formatStockQty(record.stockQty)) }}
                      </view>
                      <view class="dt__cell w-28 whitespace-normal break-words px-2 py-2 text-sm text-slate-600">{{ displayText(record.storageDesc) }}</view>
                    </view>
                  </view>
                </view>
              </div>

            </div>
          </div>

        <!-- 分页停靠栏：形态同工单汇总那处（那边有完整说明） -->
        <div v-if="stockTotal > 0" class="pager-dock" :class="{ 'is-busy': stockLoading }">
          <!-- 事件载荷是 { value: N }，同工单汇总那处分页 -->
          <wd-pagination
            v-model="stockPageNum"
            :total="stockTotal"
            :page-size="stockPageSize"
            show-message
            :hide-if-one-page="false"
            @change="(event) => { getStockPageData(event.value); scrollPageToTop() }"
          />
        </div>
        </section>
      </div>

      <div v-show="activeTab === 'imageParse'">
        <!-- 图片解析：确认入库成功后置脏（@confirmed），切回汇总页时统一重拉 ——
             「入库成功了、领料汇总却看不到」那条 bug 的另一半就在这里 -->
        <ImageParse @confirmed="handleOcrConfirmed" />
      </div>

      <div v-show="activeTab === 'weekly'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
            <!-- 日期一变就重取汇总数 —— 由下面那个 watch([weeklyStartDate, weeklyEndDate]) 负责，
                 模板上不必再挂 @change（原先挂的 filterWeeklyOrders 是给那张**未渲染**的
                 工单明细表用的，每次改日期都会白白多打一个工单接口） -->
            <DateField v-model="weeklyStartDate" placeholder="起始日期" />
            <span class="text-sm text-slate-500">至</span>
            <DateField v-model="weeklyEndDate" placeholder="结束日期" />
          </div>

          <view class="relative p-6">
            <LoadingMask v-if="weeklyStatsLoading" />

            <!-- 接口挂了就明确报错，不要把表默默显示成全 0 —— 那看起来像真实数据 -->
            <PanelState
              v-else-if="weeklyStatsError"
              type="error"
              title="暂时无法获取周统计数据"
              :description="weeklyStatsError"
              action-text="重新加载"
              @action="fetchWeeklyStats"
            />

            <view v-else class="overflow-x-auto">
              <!-- 周统计表：改造前是带边框的原生表格（border-collapse 合并相邻边）。
                   这里同样换成 flex 行；单元格保留各自的 border 类，相邻边框靠
                   .weekly-grid 里的负边距重叠来还原 1px 单线（见样式区注释）。 -->
              <view class="dt weekly-grid w-full text-center">
                <view class="dt__body">
                  <view class="dt__row">
                    <view class="dt__grow border border-slate-300 px-2 py-2 text-base font-bold tracking-wide text-slate-800">
                      {{ weeklyTitle }}
                    </view>
                  </view>

                  <view class="dt__row">
                    <view
                      v-for="column in weeklyColumns"
                      :key="column.key"
                      class="dt__cell border border-slate-300 bg-cyan-100 py-3 text-sm font-semibold text-slate-700"
                      :class="[column.width, column.align === 'right' ? 'pl-2 pr-3 text-right' : column.align === 'center' ? 'px-2 text-center' : 'px-2']"
                    >
                      {{ column.label }}
                    </view>
                  </view>
                </view>

                <view class="dt__body">
                  <view v-for="row in weeklyRows" :key="row.name" class="dt__row">
                    <view class="dt__cell w-40 border border-slate-300 px-2 py-2 text-sm text-slate-700">{{ row.name }}</view>
                    <view class="dt__cell w-20 border border-slate-300 py-2 pl-2 pr-3 text-right text-sm text-slate-700">{{ row.pickQty }}</view>
                    <view class="dt__cell w-24 border border-slate-300 p-0">
                      <input
                        v-model="weeklyRemaining[row.materialCode]"
                        type="text"
                        placeholder="/"
                        aria-label="车间剩余"
                        class="weekly-input"
                      />
                    </view>
                    <view class="dt__cell w-20 border border-slate-300 py-2 pl-2 pr-3 text-right text-sm text-slate-700">{{ row.actualQty }}</view>
                    <view class="dt__cell w-24 border border-slate-300 px-2 py-2 text-sm text-slate-700">{{ row.unitConsumption }} {{ row.unitLabel }}</view>
                  </view>

                  <view class="dt__row">
                    <view class="dt__cell w-40 border border-slate-300 px-2 py-2 text-sm text-slate-700">{{ weeklyInboundRow.name }}</view>
                    <view class="dt__grow border border-slate-300 px-2 py-2 text-sm font-semibold text-slate-800">
                      {{ weeklyInboundRow.value }}
                    </view>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </section>

        <!-- 周统计的图片查看器 —— 与上面工单汇总那个结构一致，
             沿用同一套 .viewer-* 样式。
             （这两块的重复是先前的既有写法，迁移时保持原样不做额外重构，
               以免在换平台的同时改变行为。） -->
        <wd-popup
          v-model="weeklyImageDialogVisible"
          position="center"
          custom-style="width: 92vw; max-height: 88vh; border-radius: 22px; background-color: var(--ui-glass-fill); border: 1px solid var(--ui-border); display: flex; flex-direction: column; overflow: hidden;"
        >
          <view class="viewer-head">
            <text>物料描述：{{ weeklyCurrentMaterialDesc }}</text>
            <text>确认的产量：{{ weeklyCurrentConfirmedQty }}</text>
          </view>

          <view class="viewer-body">
            <view v-if="weeklyImageList.length" class="viewer-stage">
              <view
                v-if="weeklyImageList.length > 1"
                class="viewer-nav viewer-nav--prev"
                aria-label="上一张"
                @click="showWeeklyPreviousImage"
              >
                <text>‹</text>
              </view>

              <!-- 图片区换成带手势缩放的内嵌查看器（替代写死高度的 <image>） -->
              <ImageViewer
                mode="inline"
                :urls="weeklyViewerUrls"
                :current="weeklyCurrentIndex"
              />
              <view
                v-if="weeklyImageList.length > 1"
                class="viewer-nav viewer-nav--next"
                aria-label="下一张"
                @click="showWeeklyNextImage"
              >
                <text>›</text>
              </view>

              <view v-if="hasPerm('work_order:image:delete')" class="viewer-stage__delete">
                <wd-button
                  type="error"
                  size="small"
                  :loading="weeklyImageDeleting"
                  @click="deleteWeeklyImage(weeklyImageList[weeklyCurrentIndex])"
                >
                  删除当前图片
                </wd-button>
              </view>
            </view>

            <text v-else class="viewer-empty">暂无图片</text>
          </view>

          <view v-if="weeklyImageList.length" class="viewer-counter">
            第 {{ weeklyCurrentIndex + 1 }} 张 / 共 {{ weeklyImageList.length }} 张
          </view>

          <view class="viewer-foot">
            <wd-button
              v-if="hasPerm('work_order:image:upload')"
              :loading="weeklyImageUploading"
              @click="openWeeklyFilePicker"
            >
              添加图片
            </wd-button>
          </view>
        </wd-popup>

        <ProductSelectDialog
          v-model="weeklyProductDialogVisible"
          :options="weeklyProductOptions"
          :selected="weeklyProductFilter"
          icon="chart-bar"
          @select="handleWeeklyProductSelected"
        />
      </div>

      <div v-show="activeTab === 'daily'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <PanelState
              title="日报表记录"
              description="功能建设中，敬请期待"
            />
        </section>
      </div>

      <!-- 设备数据维护（2026-10-06）：页签按 equipment:edit 权限显隐，写接口另有 admin 闸门 -->
      <div v-show="activeTab === 'equipment'">
        <EquipmentMaintenancePanel />
      </div>

      <div v-show="activeTab === 'tankLevel'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <!-- 筛选行：日期区间 + 属地 + 所属 + 关键字。
               条件全部走**接口查询**（不像物料查询那样前端本地过滤）：记录是按月累积的，
               全量拉到手机上再筛不划算，电脑端也是这么查的。
               关键字因此不做逐字实时过滤（会把接口打爆），回车 / 键盘搜索键才发请求。 -->
          <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-2.5">
            <DateField
              v-model="tankLevelStartDate"
              placeholder="起始日期"
              @change="reloadTankLevelRecords"
            />
            <span class="text-sm text-slate-500">至</span>
            <DateField
              v-model="tankLevelEndDate"
              placeholder="结束日期"
              @change="reloadTankLevelRecords"
            />

            <FilterHeaderCell
              label="属地"
              :selected="tankLevelLocation"
              hint="属地"
              :max-width="110"
              @open="tankLevelLocationDialogVisible = true"
              @clear="clearTankLevelLocation"
            />
            <FilterHeaderCell
              label="所属"
              :selected="tankLevelCategory"
              hint="所属（产品 / 原料）"
              :max-width="110"
              @open="tankLevelCategoryDialogVisible = true"
              @clear="clearTankLevelCategory"
            />

            <view class="filter-search">
              <wd-icon name="search" size="14px" />
              <input
                v-model="tankLevelKeyword"
                class="filter-search__input"
                type="text"
                placeholder="物料 / 容器名称 / 容器编号"
                placeholder-class="ui-placeholder"
                confirm-type="search"
                @confirm="reloadTankLevelRecords"
              />
            </view>

            <view class="filter-chip" @click="resetTankLevelFilters">重置</view>

            <!-- 录入入口：只有 tank_level:edit 权限才出现（后端写接口各自鉴权） -->
            <view v-if="canEditTankLevel" class="filter-chip is-on" @click="openTankLevelCreate">
              <wd-icon name="add" size="14px" />
              新增
            </view>

          </div>

          <div class="relative">
            <LoadingMask v-if="tankLevelLoading" />

            <PanelState
              v-else-if="tankLevelError"
              type="error"
              title="暂时无法获取储罐液位记录"
              :description="tankLevelError"
              action-text="重新加载"
              @action="fetchTankLevelRecords"
            />

            <PanelState
              v-else-if="tankLevelTableData.length === 0"
              :title="tankLevelHasFilter ? '没有符合筛选条件的记录' : '暂无储罐液位记录'"
              :description="
                tankLevelHasFilter
                  ? '换个日期区间或关键字试试，或点「重置」回到默认范围。'
                  : canEditTankLevel
                    ? '点上方「新增」开始录入。'
                    : '数据由管理员维护。'
              "
            />

            <div v-else>
              <div class="overflow-x-auto">
                <view class="dt dt--scroll min-w-full divide-y divide-slate-200 text-left">
                  <view class="dt__head bg-slate-50">
                    <view class="dt__row">
                      <view
                        v-for="column in TANK_LEVEL_COLUMNS"
                        :key="column.key"
                        class="dt__cell whitespace-nowrap py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                        :class="[
                          column.width,
                          column.align === 'right'
                            ? 'pl-2 pr-3 text-right'
                            : column.align === 'center'
                              ? 'px-2 text-center'
                              : 'px-2',
                        ]"
                      >
                        {{ column.label }}
                      </view>
                    </view>
                  </view>
                  <view class="dt__body divide-y divide-slate-100 bg-white">
                    <!-- 点任意一行打开详情 / 编辑弹层（没有编辑权限时同一层是只读详情）：
                         手机屏幕窄，再挤一列「操作」按钮只会让表格更长 -->
                    <view
                      v-for="(record, index) in tankLevelTableData"
                      :key="record.id || index"
                      class="dt__row transition hover:bg-slate-50"
                      @click="openTankLevelForm(record)"
                    >
                      <view class="dt__cell w-10 whitespace-nowrap px-2 py-2 text-center text-sm font-semibold text-slate-900">{{ (tankLevelPageNum - 1) * tankLevelPageSize + index + 1 }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ displayText(record.recordDate) }}</view>
                      <view class="dt__cell w-20 whitespace-nowrap px-2 py-2 text-sm text-slate-600">{{ displayText(record.location) }}</view>
                      <view class="dt__cell w-32 whitespace-normal break-words px-2 py-2 text-sm text-slate-700">{{ displayText(record.tankName) }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm text-slate-600">{{ displayText(record.levelValue) }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm font-semibold text-slate-900">{{ displayText(record.theoreticalWeight) }}</view>
                      <!-- 图据：点开弹层看大图 / 拍照上传 / 删图。
                           ⚠️ .stop 不能省：不拦的话会连带触发行点击，弹层与查看器一起打开 -->
                      <view class="dt__cell w-16 whitespace-nowrap px-2 py-2 text-sm text-slate-600">
                        <view
                          class="thumb"
                          :aria-label="record.images.length ? `查看照片（共 ${record.images.length} 张）` : '暂无照片'"
                          @click.stop="openTankLevelImages(record)"
                        >
                          <wd-icon name="picture" size="12px" />
                          <image
                            v-if="record.images.length && !tankLevelHiddenThumbs[tankLevelThumbKey(record)]"
                            class="thumb__img"
                            :src="tankLevelThumbSrc(record)"
                            mode="aspectFill"
                            lazy-load
                            alt="储罐液位照片"
                            @error="handleTankLevelThumbError($event, record)"
                          />
                          <text v-if="record.images.length > 1" class="thumb__badge">{{ record.images.length }}</text>
                        </view>
                      </view>
                    </view>
                  </view>
                </view>
              </div>
            </div>
          </div>

          <!-- 记录说明：与线下台账表尾、电脑端一字不差。
               分页停靠栏已不占文档流（见下方 .pager-dock），这块自然上移贴住表格。 -->
          <div class="border-t border-slate-100 px-6 py-3 text-xs leading-relaxed text-slate-500">
            <p>记录说明：</p>
            <p>1. 实际重量与理论计算可能存在差异，以实际测量为准。</p>
            <p>2. 记录时间为每月月底下午3点</p>
          </div>

        <!-- 分页停靠栏：形态同工单汇总那处（那边有完整说明） -->
        <div v-if="tankLevelTotal > 0" class="pager-dock" :class="{ 'is-busy': tankLevelLoading }">
          <!-- 事件载荷是 { value: N }，同工单汇总那处分页 -->
          <wd-pagination
            v-model="tankLevelPageNum"
            :total="tankLevelTotal"
            :page-size="tankLevelPageSize"
            show-message
            :hide-if-one-page="false"
            @change="(event) => { getTankLevelPageData(event.value); scrollPageToTop() }"
          />
        </div>
        </section>

        <!-- 表单弹层（新增 / 编辑 / 只读详情）与图据弹层。
             图据弹层的开关在 useTankLevelImages 里，这里不用绑 v-model；
             弹层里的大图走 uni.previewImage（在 PhotoGrid 里），不用页面根部那个查看器。 -->
        <TankLevelFormDialog v-model="tankLevelFormVisible" :record="tankLevelFormRecord" />
        <TankLevelImageDialog />

        <!-- 属地 / 所属两个下拉都复用物料选择弹层：选项都是短字符串列表，
             底部弹层 + 搜索的形态在手机上比浮层好用（见 DropdownMenu 的适用范围说明） -->
        <ProductSelectDialog
          v-model="tankLevelLocationDialogVisible"
          :options="tankLevelLocationOptions"
          :selected="tankLevelLocation"
          label="属地"
          @select="handleTankLevelLocationSelected"
        />
        <ProductSelectDialog
          v-model="tankLevelCategoryDialogVisible"
          :options="TANK_LEVEL_CATEGORIES"
          :selected="tankLevelCategory"
          label="所属（产品 / 原料）"
          @select="handleTankLevelCategorySelected"
        />
      </div>

      <div v-show="activeTab === 'vessel'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <!-- 容器清单来自设备台账（异步）。取不到时**必须给出明确提示**：
               这个页面是纯前端计算，清单空了就什么都算不了，而页面本身不会报错，
               只会静静地显示一台空白罐与 0.00 —— 看着像「算出来是 0」。
               注意文案里不要写 Markdown 星号，模板里是纯文本，会原样显示出来。 -->
          <view
            v-if="vesselsLoading && !vessels.length"
            class="border-b border-slate-100 px-6 py-3 text-xs text-slate-500"
          >
            正在加载容器清单…
          </view>
          <view
            v-else-if="vesselsFromCache"
            class="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs leading-relaxed text-amber-800"
          >
            <template v-if="vessels.length">
              当前显示的是本地缓存的容器清单（设备台账接口暂时取不到）。若台账刚改过几何参数，
              这里的数值可能不是最新的 —— 恢复连接后会自动刷新。
            </template>
            <template v-else>
              取不到容器清单：设备台账接口连不上，本地也没有缓存。
              请稍后重试；若一直如此，请联系管理员核对台账里这几台容器的几何参数是否已填写。
            </template>
          </view>

          <!-- 储罐信息区：只剩罐型选择这一行。
               规格网格与介质条件备注已挪到卡片末尾、液体体积计算公式正上方。
               改造前选择器与规格说明挤在一个 flex 行里：固定 224px 的选择器在 360px 小屏上
               只给文字留下约 23px，整段规格说明塌成每行一两个字的竖排碎字。
               现在规格走网格，窄屏两列、宽屏四列，任何宽度下都不会再碎成竖排。 -->
          <div class="border-b border-slate-100 px-6 py-4">
            <!-- 第 1 行：储罐选择。DropdownMenu 的默认插槽就是触发器，
                 沿用原来那个胶囊样式，不去用它默认的「标签 + 值」表单行。
                 改造前这里是 wd-picker（滚轮弹层）—— 两个罐用滚轮选太笨重，
                 换成企微式浮层（见 components/DropdownMenu.vue）。 -->
            <div class="flex justify-end">
              <DropdownMenu
                v-model="vesselMenuOpen"
                :options="vesselOptions"
                :selected="vesselKey"
                aria-label="选择储罐"
                @select="handleVesselSelect"
              >
                <view class="vessel-select" :class="{ 'is-open': vesselMenuOpen }">
                  <text class="vessel-select__label">{{ selectedVessel ? selectedVessel.label : '—' }}</text>
                  <view class="vessel-select__caret">
                    <wd-icon name="arrow-down" size="14px" />
                  </view>
                </view>
              </DropdownMenu>
            </div>
          </div>

          <div class="flex flex-wrap items-stretch" :class="isVerticalVessel ? 'gap-x-6 p-6' : ''">
            <!-- 竖版（立式罐）时图形与信息并排：`shrink-0` 让图形保持 470px 的下限，
                 但在 360px 小屏上这 470px 是挤不进去的（整块横向溢出卡片）。
                 所以窄屏改成 w-full 让它单独占一行，≥640px 再恢复原来的并排。 -->
            <div class="flex justify-center" :class="isVerticalVessel ? 'w-full sm:w-auto sm:shrink-0' : 'w-full p-6'">
              <!-- 储罐示意图：纯 CSS/DOM 图层（改造前是 uni 老版 canvas）。
                   尺寸与改造前 canvas 完全一致：宽 = displayWidth（maxWidth 100% 兜住小屏）、
                   宽高比 = 1375 : 逻辑高；各图层都用百分比定位，所以「随屏宽等比缩放」由渲染引擎负责。
                   宽度必须写成「确定的 px 值 + max-width: 100%」而不是 w-full：立式罐那一行是
                   sm:w-auto（收缩包裹）的父容器，子元素只写百分比宽度会算不出基准、整块塌成 0。
                   ⚠️ 也别给 .vessel-diagram 加 overflow:hidden —— 标注文字允许溢出一点，裁掉就看不全。 -->
              <view
                class="vessel-diagram mx-auto"
                :class="{ 'is-switching': vesselSwitching }"
                :style="{
                  width: `${vesselGeometry.displayWidth}px`,
                  maxWidth: '100%',
                  aspectRatio: vesselDiagram.aspectRatio,
                }"
              >
                <!-- 底图按需渲染：切到本 Tab 才真的去加载（vesselImageReady 锁存，来回切 Tab 不重复加载）。
                     深浅两版是两个资源（浅色白纸版 / 深色亮线版），按主题换 src；两图同尺寸，几何一律不动。 -->
                <template v-if="vesselImageReady">
                  <image
                    class="vessel-diagram__paper"
                    :src="vesselPaperSrc"
                    :style="vesselDiagram.paperStyle"
                    mode="scaleToFill"
                  />
                  <!-- 罐体裁剪层：液体、波峰带、差值带、起始虚线全部裁在罐体轮廓内 -->
                  <view class="vessel-diagram__tank" :style="vesselDiagram.tankStyle">
                    <view class="vessel-diagram__liquid" :style="vesselDiagram.liquidStyle"></view>
                    <view class="vessel-diagram__wave" :style="vesselDiagram.waveStyle">
                      <view class="vessel-diagram__wave-shift"></view>
                    </view>
                    <view
                      v-if="vesselDiagram.hasDelta"
                      class="vessel-diagram__delta"
                      :class="vesselDiagram.calloutTone"
                      :style="vesselDiagram.deltaStyle"
                    ></view>
                    <view
                      v-if="vesselDiagram.hasStart"
                      class="vessel-diagram__start"
                      :style="vesselDiagram.startStyle"
                    ></view>
                  </view>
                  <!-- 差值引线标注（在裁剪层之外，所以不会被罐体切掉） -->
                  <view
                    v-if="vesselDiagram.hasDelta"
                    class="vessel-diagram__callout"
                    :class="[vesselDiagram.calloutTone, vesselDiagram.calloutBelow ? 'is-below' : '']"
                    :style="vesselDiagram.calloutStyle"
                  >
                    <view class="vessel-diagram__callout-dot"></view>
                    <view class="vessel-diagram__callout-text">
                      <!-- 每行 = 前缀 + 定宽数值槽 + 单位。key 用每行自带的稳定标识
                           （line.key），不能拿内容当 key：数值每帧都在变，那样每帧都要销毁重建。 -->
                      <view
                        v-for="line in vesselDiagram.lines"
                        :key="line.key"
                        class="vessel-diagram__callout-line"
                      >
                        <text v-if="line.prefix">{{ line.prefix }}</text>
                        <text class="vessel-num" :class="line.slot">{{ line.value }}</text>
                        <text>{{ line.unit }}</text>
                      </view>
                    </view>
                  </view>

                  <!-- 液位滑块：轨道贴罐体左缘、与罐体同高（同一个液位刻度），两个玻璃手柄
                       一上一下 —— 起始液位与终止液位。层在图纸与引线标注之上（使用方
                       2026-10-10 要求「在图层上方」）。
                       起手事件挂整条轨道上、两条都给（小程序端没有 mouse、H5 桌面端没有
                       touch，同下面 ± 按钮的理由）：胶囊、轨道、热区条上按下的都会冒泡到
                       这里。落点不预先指定手柄，第一下 move 按「离谁画出来的位置近」认领
                       —— 见 startRailDrag / nearestRailHandle（2026-10-13，手机端反馈
                       失触概率高：原来只有胶囊本体 ±10px 能接到手指）。 -->
                  <view
                    v-if="selectedVessel"
                    class="vessel-rail"
                    :style="vesselDiagram.sliderStyle"
                    @touchstart.stop.prevent="startRailDragByTouch($event)"
                    @touchmove.stop.prevent="moveRailDrag"
                    @touchend="endRailDrag"
                    @touchcancel="endRailDrag"
                    @mousedown.stop.prevent="startRailDragByMouse($event)"
                  >
                    <!-- 起手热区：轨道只有 10px 宽，手指很难正落在上面。这条看不见的
                         （左右各 11px，共 32px）把「摸轨道」也算起手。画在最底层：
                         轨道与胶囊是后面的兄弟节点，各自的命中照旧压在上面。 -->
                    <view class="vessel-rail__grab"></view>
                    <view class="vessel-rail__track"></view>
                    <view
                      v-for="handle in vesselRailHandles"
                      :key="handle.which"
                      class="vessel-rail__handle"
                      :class="[handle.class, { 'is-dragging': vesselRailDragWhich === handle.which }]"
                      :style="{ bottom: `${handle.percent.toFixed(4)}%`, marginBottom: `${handle.offsetPx.toFixed(2)}px` }"
                      :aria-label="handle.label"
                    >
                      <!-- 小标与控件列那两个一模一样：起始 = 起始虚线，终止 = 波峰液面 -->
                      <view
                        class="vessel-legend"
                        :class="`vessel-legend--${handle.which}`"
                        :style="handle.swatchStyle"
                      ></view>
                      <text class="vessel-num vessel-num--level vessel-rail__num">{{ handle.value }}</text>
                    </view>
                  </view>
                </template>
              </view>
            </div>

            <div :class="isVerticalVessel ? 'flex min-w-0 flex-1 flex-col justify-center' : 'w-full'">
            <!-- 横版：体积变化在左、两个液位的读数在右；竖版：体积变化居中在上、读数在下
                 （排不下时读数自己换行，见下面那格的 min-w） -->
            <div
              class="flex flex-wrap items-center justify-between gap-x-8 gap-y-5"
              :class="isVerticalVessel ? 'flex-col' : 'border-t border-slate-100 px-6 pt-5'"
            >
            <!-- 体积变化：横版居中于左侧空区，竖版居中在上 -->
            <div class="flex justify-center" :class="isVerticalVessel ? 'w-full' : 'flex-1'">
            <!-- 体积变化：居中作为视觉焦点。
                     数值来自实时计算，位数一变多，原来那套 flex-wrap 会把「m³」与
                     「（t）」甩到第二行 —— 所以这里不换行（flex-nowrap + whitespace-nowrap），
                     盒子也把左右内边距收窄（px-6 → px-4）把宽度让给数字。 -->
            <div
                class="flex flex-nowrap items-baseline justify-center gap-x-1.5 whitespace-nowrap"
                :class="isVerticalVessel ? 'px-0 pb-4 pt-5' : 'rounded-xl border border-slate-200 bg-slate-50 px-4 py-4'"
            >
              <span class="text-sm text-slate-500">体积变化</span>
              <span
                class="vessel-num vessel-num--signed text-2xl font-bold tracking-tight"
                :class="vesselVolumeDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'"
              >{{ vesselVolumeDelta >= 0 ? '+' : '' }}{{ vesselVolumeDelta.toFixed(2) }}</span>
              <span class="text-sm text-slate-500">m³</span>
              <span
                v-if="vesselMassDelta !== null"
                class="text-base font-semibold"
                :class="vesselVolumeDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'"
              >（<span class="vessel-num vessel-num--signed">{{ vesselMassDelta >= 0 ? '+' : '' }}{{ vesselMassDelta.toFixed(2) }}</span> t）</span>
            </div>
            </div>

            <!-- 两个液位的读数：一格一个液位。
                 2026-10-10 使用方要求删掉液位的输入框与 ± 按钮 —— 液位改成直接拖图纸左缘那两个
                 玻璃手柄来设，这一列只留读数（手柄上那个数字也是同一个 display 值，两处一致）。
                 每格多宽、怎么换行，全在下面 .vessel-readout 那条 scss 里（flex: 1 1 200px + min-width: 0，
                 不用 min-w-[200px] 的原因也写在那一处）—— 360~375px 的手机上两格落成一列，宽屏并排。
                 同理标签也不加 whitespace-nowrap —— 极窄时让中文自己换行，别撑宽整页。 -->
            <div
              class="flex flex-wrap gap-x-6 gap-y-3"
              :class="isVerticalVessel ? 'w-full' : ''"
            >
              <!-- 起始液位：图例与图纸里那条起始虚线、手柄上的小标同一份画法 -->
              <div class="vessel-readout flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span class="flex items-center gap-2 text-sm text-slate-700">
                  <span class="vessel-legend vessel-legend--start" aria-hidden="true"></span>
                  起始液位
                </span>

                <div class="space-y-1 text-sm text-slate-500">
                  <div>
                    液位：<span class="vessel-num vessel-num--level font-semibold text-slate-900">{{ Math.round(vesselStartDisplay) }}</span> mm
                  </div>
                  <div>
                    体积：<span class="vessel-num vessel-num--volume font-semibold text-gold-600">{{ vesselStartVolume.toFixed(2) }}</span> m³<template v-if="vesselStartMass !== null"><span class="ml-1 text-slate-400">（<span class="vessel-num vessel-num--volume">{{ vesselStartMass.toFixed(2) }}</span> t）</span></template>
                  </div>
                </div>
              </div>

              <!-- 终止液位：图例用与图纸里那片波峰液面同一份图案（颜色随介质走） -->
              <div class="vessel-readout flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span class="flex items-center gap-2 text-sm text-slate-700">
                  <span
                    class="vessel-legend vessel-legend--end"
                    :style="vesselWaveSwatch"
                    aria-hidden="true"
                  ></span>
                  终止液位
                </span>

                <div class="space-y-1 text-sm text-slate-500">
                  <div>
                    液位：<span class="vessel-num vessel-num--level font-semibold text-slate-900">{{ Math.round(vesselEndDisplay) }}</span> mm
                  </div>
                  <div>
                    体积：<span class="vessel-num vessel-num--volume font-semibold text-gold-600">{{ vesselEndVolume.toFixed(2) }}</span> m³<template v-if="vesselEndMass !== null"><span class="ml-1 text-slate-400">（<span class="vessel-num vessel-num--volume">{{ vesselEndMass.toFixed(2) }}</span> t）</span></template>
                  </div>
                </div>
              </div>
            </div>
            </div>
            </div>
          </div>

          <div class="border-t border-slate-100 px-6 py-3">
            <!-- 规格网格（从卡片头部挪下来：紧邻下方就是液体体积计算公式）。标签在上、数值在下 —— 不用「一行标签 + 一行数值」
                 是因为窄屏两列时那两种文字加起来正好会顶出格子。 -->
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <div
                v-for="spec in vesselSpecs"
                :key="spec.label"
                class="rounded-lg bg-slate-50 px-3 py-2"
              >
                <div class="text-xs text-slate-500">{{ spec.label }}</div>
                <div class="mt-0.5 text-sm font-semibold text-slate-900">{{ spec.value }}</div>
              </div>
            </div>

            <!-- 介质基准条件（原文照旧，单独成段后能正常折行） -->
            <p v-if="vesselGeometry.note" class="mt-3 text-xs font-medium leading-relaxed text-amber-700">
              {{ vesselGeometry.note }}
            </p>
            <!-- 录入对账：几何与台账的封头容积对不上时单独一行红字（不阻断计算，
                 因为页面算的是按几何来的，台账那列只用于核对） -->
            <p v-if="vesselReconcileWarning" class="mt-2 text-xs font-medium leading-relaxed text-red-600">
              {{ vesselReconcileWarning }}
            </p>
            <p v-if="vesselBundleWarning" class="mt-2 text-xs font-medium leading-relaxed text-red-600">
              {{ vesselBundleWarning }}
            </p>
          </div>

          <div class="border-t border-slate-100 bg-slate-50 px-6 py-4">
            <div class="mx-auto max-w-[900px] overflow-x-auto">
              <p class="mb-3 text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                液体体积计算公式
              </p>

              <div v-if="vesselGeometry.type === 'vertical'" class="math-formula text-center text-slate-700">
                <div>
                  <text class="mf-var">V</text>(<text class="mf-var">h</text>) = π<text class="mf-var">r</text>²<text class="mf-var">h</text>
                  <span class="ml-2 text-xs text-slate-400">（<text class="mf-var">h</text> ≤ <text class="mf-var">H</text>，筒体段）</span>
                  <span class="mx-7 text-slate-300">｜</span>
                  <text class="mf-var">V</text>(<text class="mf-var">h</text>) = π<text class="mf-var">r</text>²<text class="mf-var">H</text> + π<text class="mf-var">r</text>²[ <text class="mf-var">t</text> −
                  <span class="frac"><span class="frac-num"><text class="mf-var">t</text>³</span><span class="frac-den">3<text class="mf-var">h</text><text class="mf-sub">i</text>²</span></span> ]
                  <span class="ml-2 text-xs text-slate-400">（<text class="mf-var">h</text> &gt; <text class="mf-var">H</text>，<text class="mf-var">t</text> = <text class="mf-var">h</text> − <text class="mf-var">H</text>）</span>
                </div>
              </div>

              <div v-else class="math-formula text-center text-slate-700">
                <div>
                  <text class="mf-var">V</text>(<text class="mf-var">h</text>) = <text class="mf-var">L</text> [
                  <span class="frac"><span class="frac-num">π<text class="mf-var">r</text>²</span><span class="frac-den">2</span></span>
                  − (<text class="mf-var">r</text> − <text class="mf-var">h</text>)<span class="sqrt">√<span class="sqrt-body">2<text class="mf-var">rh</text> − <text class="mf-var">h</text>²</span></span>
                  − <text class="mf-var">r</text>² · arcsin<span class="paren">(</span><span class="frac"><span class="frac-num"><text class="mf-var">r</text> − <text class="mf-var">h</text></span><span class="frac-den"><text class="mf-var">r</text></span></span><span class="paren">)</span> ]
                  &nbsp;+&nbsp;
                  <span class="frac"><span class="frac-num">π · <text class="mf-var">h</text><text class="mf-sub">i</text></span><span class="frac-den">3<text class="mf-var">r</text></span></span>
                  · [ 3<text class="mf-var">r</text>²<text class="mf-var">h</text> − <text class="mf-var">r</text>³ + (<text class="mf-var">r</text> − <text class="mf-var">h</text>)³ ]
                </div>
              </div>

              <p v-if="vesselGeometry.type === 'vertical'" class="mt-3 text-center text-xs leading-relaxed text-slate-500">
                <text class="mf-var">r</text> 筒体内半径　<text class="mf-var">h</text> 液位高度　<text class="mf-var">H</text> 筒体高度　<text class="mf-var">h</text><text class="mf-sub">i</text> 封头曲面内高度
                <span class="text-slate-400">｜</span>
                {{ vesselFormulaCaption }}
              </p>
              <p v-else class="mt-3 text-center text-xs leading-relaxed text-slate-500">
                <text class="mf-var">L</text> 筒体长度（含两端直边）　<text class="mf-var">r</text> 筒体内半径　<text class="mf-var">h</text> 液位高度　<text class="mf-var">h</text><text class="mf-sub">i</text> 封头曲面内高度
                <span class="text-slate-400">｜</span>
                {{ vesselFormulaCaption }}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'electricity'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <!-- 电价档位备注 -->
          <div class="border-b border-slate-100 bg-amber-50 px-6 py-4">
            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-600">
                !
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-slate-800">电价档位备注</h3>
                <div class="mt-3 grid gap-3 sm:grid-cols-3">
                  <div class="rounded-lg border border-amber-200 bg-white px-4 py-2.5">
                    <p class="text-xs text-slate-500">10 万度以内</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      1.1 ~ 1.2<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                    </p>
                  </div>
                  <div class="rounded-lg border border-amber-200 bg-white px-4 py-2.5">
                    <p class="text-xs text-slate-500">20 万度以内</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      0.9 ~ 1<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                    </p>
                  </div>
                  <div class="rounded-lg border border-amber-200 bg-white px-4 py-2.5">
                    <p class="text-xs text-slate-500">20 万度以上</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      0.72<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <PanelState
              title="电费预提"
              description="功能建设中，敬请期待"
            />
        </section>
      </div>

      <!-- #ifdef H5 || APP-PLUS -->
      <div v-show="activeTab === 'import'">
        <WorkOrderImport
          @cancel="handleImportCancel"
          @back="handleImportBack"
          @imported="importDirty = true"
        />
      </div>
      <!-- #endif -->

      <!-- 左侧抽屉菜单（豆包式）：全部导航 + 账户操作都收在这里。
           wd-popup position="left" 自带遮罩点击关闭；宽度/高度用 custom-style 指定。
           wd-popup 会把 customStyle 接到弹层本体（.wd-popup）上，并自动拼在前缀
           "z-index:..; padding-bottom:<安全区>px;" 之后，所以这里必须补 box-sizing: border-box，
           让安全区的高度从 100vh 里扣掉 —— 否则安全区变成"屏幕外的一截"，
           底部按钮在白线附近没有留白。（列表必须是 scroll-view：小程序的 <view> 写
           overflow-y 不会滚动；高度给确定的 52vh，三端都能滚，底部账户区也留在屏内。） -->
      <!--
        液态玻璃（使用方 2026-10-08 定）。

        这里和 PC 侧栏有个**本质区别**，也是玻璃在这边才真正成立的原因：
        PC 侧栏自己占一列、背后是纯色，得额外铺一层背景才有东西可糊；
        而抽屉是**压在页面内容上面**的，背后就是工单汇总那张表 —— 天然有东西可透。

        四处改动：
        1. 弹层本体背景改 transparent（原来是不透明的 --ui-surface）——
           玻璃膜挪到 .drawer 上，因为 conditional compilation 只能写在 <style> 里，
           写在 custom-style 这个内联字符串里就没法按平台分支。
        2. **遮罩设成全透明**（使用方 2026-10-09 要求「侧边栏弹出时下层页面颜色不变」）。
           最初这里放的是 --ui-glass-scrim（浅色 0.18 / 深色 0.34），想着"比 wot 默认的 0.65 轻很多"就够了。
           但真机一量：0.18 也把下层那张白卡片从 rgb(255) 压到 rgb(212) —— 抽屉右侧那条竖带
           肉眼一看就是灰的，"玻璃盖在页面上"的真实感就没了。现在改成 transparent：
           开启前后那条竖带的亮度分位完全一致（p50 1.000 / 1.000）。
           注意**不能直接删掉 modal-style**：wot 的遮罩默认是 rgba(0,0,0,0.65)，删了就回到最黑那种。
           遮罩元素本身必须留着，它是"点外面关闭"的点击区。
        3. .drawer 上加模糊（见 <style> 里那段，小程序端单独兜底）。
        4. 右缘投影**加在弹层本体上，不是 .drawer 上** —— 弹层的 custom-style 里有
           overflow: hidden，写在 .drawer 上的 box-shadow 会被它裁掉，一点都看不见。
           写在弹层自己身上则不受自身 overflow 影响（overflow 裁的是后代，不是
           元素自己的 box-shadow）。实测过：同样是 overflow: hidden，弹层右缘那条
           竖带 0.578→0.439 的亮度梯度确实存在。
      -->
      <NavDrawer ref="navDrawer">
        <view class="drawer">
          <view class="drawer__brand">
            <view class="drawer__mark">
              <text>HND</text>
            </view>
            <view class="drawer__meta">
              <text class="drawer__eyebrow">Factory Operations</text>
              <text class="drawer__title">工单汇总</text>
            </view>
          </view>

          <view class="drawer__stats">
            <view class="chip">
              <text class="chip__text">共 <text class="chip__strong">{{ total }}</text> 条工单</text>
            </view>
            <view v-if="loggedIn" class="chip chip--live">
              <view class="chip__dot"></view>
              <text class="chip__text">{{ roleName }}</text>
            </view>
            <view v-else class="chip">
              <text class="chip__text">只读浏览</text>
            </view>
          </view>

          <!-- 按大类分组（2026-10-07）：分组标题放进 scroll-view 里，跟列表一起滚。
               只渲染**有可见页**的组 —— 小程序端没有「文件导入」，数据维护那组只剩两项，
               但也不该留一个空标题。 -->
          <scroll-view class="drawer__list" scroll-y @touchstart="onListTouchStart" @touchend="onListTouchEnd" @touchcancel="onListTouchEnd">
            <template v-for="group in visibleGroups" :key="group.key">
              <text class="drawer__group">{{ group.label }}</text>
              <view
                v-for="tab in group.tabs"
                :key="tab.key"
                class="menu-item"
                :class="{ 'is-active': activeTab === tab.key, 'is-locked': tabState(tab) === 'locked' }"
                @click="selectTabFromMenu(tab.key)"
              >
                <view class="menu-item__icon">
                  <wd-icon :name="tab.icon" size="18px" />
                </view>
                <view class="menu-item__text">
                  <text class="menu-item__label">{{ tab.label }}</text>
                  <text class="menu-item__hint">{{ tab.hint }}</text>
                </view>
                <wd-icon v-if="activeTab === tab.key" name="check" size="16px" />
                <wd-icon v-else-if="tabState(tab) === 'locked'" name="lock-on" size="14px" class="menu-item__lock" />
              </view>
            </template>
          </scroll-view>

          <view class="drawer__foot">
            <button
              v-if="loggedIn"
              class="drawer__action pill-btn pill-btn--danger"
              @click="logoutFromMenu"
            >
              退出登录
            </button>
            <button
              v-else
              class="drawer__action pill-btn pill-btn--primary"
              @click="loginFromMenu"
            >
              登录
            </button>
            <text class="drawer__tip">未登录也可以浏览物料、周统计等查询页</text>
            <text class="drawer__env">{{ envTip }}</text>
          </view>
        </view>
      </NavDrawer>

      <!-- 提示与确认框的宿主组件。
           wot-design-uni 的 useToast()/useMessage() 走 provide/inject：
           本页 setup 里调用它们会 provide 出选项 ref，这两个组件再 inject 回来。
           挂在页面根部；必须放在 config-provider 内部才会继承深色主题，
           本页与所有子组件（ImageParse 等）的提示都走同一对实例。 -->
      <!-- 单据大图查看器（领料 / 入库共用）：全屏黑底 + 手势缩放。
           挂在页面根部而不是各自的 Tab 面板里：它要 position: fixed 铺满视口，
           前提是「从页面根到这里没有 transform 祖先」（说明 4.2）。 -->
      <ImageViewer v-model="imageViewerVisible" :urls="imageViewerUrls" :current="imageViewerIndex" />
      <wd-toast />
      <wd-message-box />
    </wd-config-provider>
  </view>
</template>

<style scoped lang="scss">
/* 页面外壳。
   本页在 pages.json 里声明了 navigationStyle: custom —— 页面自带标题栏，
   就不该再叠一条原生导航栏。代价是要自己给状态栏让出高度，
   否则内容会被状态栏压住（H5/App/H5 端 --status-bar-height 为 0 或实际值）。 */
.page {
  box-sizing: border-box;
  min-height: 100vh;
  /* 底部补白 = 停靠栏高度 + 安全区 + 20px 呼吸 —— 两个都是变量，改底栏高度只需改
     App.vue 里的 --ui-dock-h，这里自动跟上。底栏是 fixed、不占文档流，
     不留这段补白，列表最后一行就会被它压住。 */
  padding: calc(var(--status-bar-height, 0px) + 28px) 16px
    calc(var(--ui-dock-h) + var(--ui-safe-bottom, 0px) + 20px);
  // 场景先于玻璃：深墨蓝底 + 3 个大半径柔光光斑，纯 CSS、不引图片、不加 DOM。
  // 画法与 token 都在 uni.scss 的 @mixin scene-bg 里（两套主题各一套值）。
  @include scene-bg;
  color: $ui-text;
}

/* config-provider 的根节点：它替代了原来的 <view class="mx-auto max-w-7xl">，
   宽度约束由挂在同一节点上的 Tailwind 类（mx-auto / max-w-7xl）负责。 */
.page__shell {
  width: 100%;
}

/* 每个 Tab 面板（section）在显示时轻推入场。
   v-show 会把 display 从 none 切回 block，CSS 动画因此会重放 ——
   这是"切 Tab 有反馈"的主要来源，也是本次改版里性价比最高的一处丝滑加成。 */
.panel {
  /* ⚠️ mixin 里的 position: relative 只为让动效的 top 生效，位移绝不能用 transform 实现：
     面板里嵌着 DateField 的日期弹层与 ProductSelectDialog（都是 position: fixed），
     面板上一旦残留 transform 就会成为它们的包含块 —— 弹层与遮罩只铺满面板、
     弹层底边跟着面板底边跑，两条关闭路径同时失效（周统计的日期弹层踩过，
     详见 UNIAPP迁移说明.md 第 4.2 节）。 */
  @include panel-in;

  /* 无模糊玻璃：膜色 / 描边 / 三层投影都由 token 化的工具类提供
     （bg-white / border-slate-200 / shadow-sm 全指向 --ui-*），这里只补一层磨砂颗粒。
     ⚠️ **这里故意不加 backdrop-filter**，两个理由：
       1) 它和 transform 一样会给 position: fixed 的后代建包含块 —— 就是上面注释里
          那个坑（DateField 日期弹层、ProductSelectDialog 会只铺满面板、两条关闭路径失效）。
          面板是玻璃预算里明确排除在模糊之外的一类，别顺手加回来。
       2) 面板背后是平滑的柔光场景，对平滑渐变做模糊 ≈ 不模糊，本来就没收益。
          需要模糊的是"浮在内容之上"的层（顶栏、抽屉、弹窗、Toast）。 */
  background-image: var(--ui-grain);
  background-repeat: repeat;
}

/* ===== 顶部栏（豆包式）=====
   左：菜单按钮。三条横线用 CSS 画（不依赖图标字体，长短略有差异更有"手感"）；
   中：当前面板标题 + 一句话说明；右：账户入口，点开同一个抽屉。 */
.topbar {
  display: flex;
  align-items: center;
  gap: 14rpx;
  /* 浮层玻璃：顶栏正好压在场景最亮的一处光斑上，"借光"在它身上最明显。
     属于玻璃预算里"浮在内容之上"那一档，每页只有这一个，不计入重复行。
     内边距与 gap 刻意收紧：整条栏比原来多占了左右各 24rpx，
     按原来的值副标题会被挤成省略号（实测过）。 */
  @include glass($radius: $ui-radius-lg);
  padding: 16rpx 18rpx;
  margin-bottom: 24rpx;
}

.topbar__btn {
  display: flex;
  width: 84rpx;
  height: 84rpx;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid $ui-border;
  border-radius: 26rpx;
  background-color: $ui-raise;
  color: $ui-text-2;
  transition: background-color $ui-dur $ui-ease, transform 160ms $ui-ease;

  &::after {
    border: 0;
  }

  &:active {
    transform: scale(0.94);
    background-color: $ui-surface-3;
  }
}

.burger {
  display: flex;
  flex-direction: column;
  gap: 7rpx;
}

.burger__bar {
  width: 32rpx;
  height: 3rpx;
  border-radius: $ui-radius-pill;
  background-color: $ui-text;

  &.is-short {
    width: 20rpx;
  }
}

.topbar__meta {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.topbar__name {
  color: $ui-text;
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.15;
}

.topbar__hint {
  margin-top: 6rpx;
  overflow: hidden;
  color: $ui-text-3;
  font-size: 24rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 信息胶囊：条数、当前身份等只读信息 */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 28rpx;
  border: 1px solid $ui-border;
  border-radius: $ui-radius-pill;
  background-color: $ui-raise;
  color: $ui-text-2;
  font-size: 25rpx;
  line-height: 1.2;
}

.chip__text {
  color: $ui-text-2;
  font-size: 25rpx;
}

.chip__strong {
  color: $ui-text;
  font-weight: 600;
}

/* 已登录：绿色小圆点，一眼看出"当前是可写入身份" */
.chip--live {
  border-color: $ui-success-line;
  background-color: $ui-success-soft;

  .chip__text {
    color: $ui-success;
  }
}

.chip__dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background-color: $ui-success;
  box-shadow: 0 0 0 6rpx $ui-success-soft;
}

/* 胶囊按钮：登录 = 香槟金主操作（规范里唯一允许的强调色做法）；退出 = 低饱和危险色 */
.pill-btn {
  @include pill-button;
}

.pill-btn--primary {
  @include glass-button;
}

.pill-btn--danger {
  border: 1px solid $ui-danger-line;
  background-color: $ui-danger-soft;
  color: $ui-danger;
}

/* ===== 抽屉菜单（左侧滑出）=====
   wd-popup 负责滑入与遮罩，这里只管抽屉内部排版：
   品牌区 → 状态胶囊 → 分组标题 → 功能列表 → 底部账户区（margin-top: auto 顶到底部）。 */
.drawer {
  display: flex;
  flex: 1;
  box-sizing: border-box;
  flex-direction: column;
  padding: calc(var(--status-bar-height, 0px) + 36rpx) 28rpx 32rpx;

  /* 右缘描边：玻璃的边要有厚度感，不然就是一块半透明色块。走统一的玻璃描边 token
     （深色是 white/15、浅色是淡黑 —— 白描边压在白卡上没有边界感）。 */
  border-right: 1px solid $ui-glass-line;

  /* #ifdef H5 || APP-PLUS */
  /*
   * 液态玻璃膜。**颜色与模糊全部走 uni.scss 的玻璃材质 token**，不在这里写死：
   * 2026-10-09 按「夜航玻璃拟态」规范改造后，膜 / 描边 / 投影 / 颗粒 / 模糊半径是
   * 一整套（@mixin glass），抽屉只是这套材质的一个使用方。改参数请去 uni.scss，
   * 在这里覆盖会和其他玻璃面不一致。
   *
   * 背景色放进条件编译分支（而不是写在外面再让小程序覆盖）：写在外面会在小程序产物里
   * 留下一条被覆盖掉的死声明，虽然无害但读起来误导。
   */
  background-color: $ui-glass-fill;

  /* 磨砂颗粒。_url 常量在 uni.scss（那里有浓度实测记录与 SVG 转义的坑）。
     颗粒是"磨砂"这个观感的来源之一，别单独去掉。 */
  background-image: var(--ui-grain);
  background-repeat: repeat;

  /* 大模糊 + 饱和增强 = 规范的"无色玻璃借光"。
     ⚠️ 半径大是**故意的**：规范禁止低模糊值。之前那版 10~18px 是"半透明"而不是"玻璃"，
     之所以看着像一块糊掉的板，是因为当时背后是白表格（没有可折射的明暗）。
     换成夜景场景后，大半径糊的是柔光光斑，才是规范要的效果。 */
  backdrop-filter: blur($ui-glass-blur) saturate($ui-glass-sat);
  -webkit-backdrop-filter: blur($ui-glass-blur) saturate($ui-glass-sat);
  /* #endif */

  /* #ifdef MP-WEIXIN */
  /*
   * ⚠️ 微信小程序**原生不支持 backdrop-filter**（小程序不是浏览器，CSS 是子集），
   * 模糊做不了。而"半透明但不模糊"反而更糟 —— 背后表格的字会和抽屉里的导航字
   * 叠在一起，两边都看不清。所以退回接近不透明的膜：先保住可读性。
   * 代价说清楚：小程序端**没有**模糊效果，只是比原来通透一点点。
   */
  background-color: $ui-surface-trans;
  /* #endif */
}

.drawer__brand {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 0 8rpx;
}

.drawer__mark {
  display: flex;
  width: 84rpx;
  height: 84rpx;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 26rpx;
  background: linear-gradient(135deg, $ui-accent, $ui-accent-2);
  color: $ui-on-accent;
  font-size: 24rpx;
  font-weight: 700;
  letter-spacing: 0.06em;
  box-shadow: 0 18rpx 36rpx -20rpx $ui-accent-glow;
}

.drawer__meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.drawer__eyebrow {
  color: $ui-accent-text;
  font-size: 20rpx;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.drawer__title {
  margin-top: 6rpx;
  color: $ui-text;
  font-size: 36rpx;
  font-weight: 700;
}

.drawer__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin: 28rpx 0 4rpx;
  padding: 0 8rpx;
}

.drawer__group {
  padding: 28rpx 12rpx 12rpx;
  color: $ui-text-3;
  font-size: 22rpx;
  letter-spacing: 0.16em;
}

/* 必须是确定高度，scroll-view 才会滚动（三端一致的做法） */
.drawer__list {
  height: 52vh;
  flex-shrink: 0;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 8rpx;
  padding: 20rpx;
  border-radius: $ui-radius-md;
  color: $ui-text-2;
  transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;

  /* 锁定态：可见但压暗（与 PC 的 opacity-60 + 灰字同义），点击弹提示而不是切开 */
  &.is-locked {
    opacity: 0.55;
  }

  &.is-active {
    background-color: $ui-accent-soft;
    color: $ui-accent-text;
  }

  &:active {
    background-color: $ui-surface-3;
  }

  &__icon {
    display: flex;
    width: 60rpx;
    height: 60rpx;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 18rpx;
    background-color: $ui-raise-2;
  }

  &__text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }

  &__lock {
    flex-shrink: 0;
    color: $ui-text-3;
  }

  &__label {
    color: inherit;
    font-size: 28rpx;
    font-weight: 500;
  }

  &__hint {
    margin-top: 4rpx;
    overflow: hidden;
    color: $ui-text-3;
    font-size: 22rpx;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.drawer__foot {
  margin-top: auto;
  padding: 24rpx 8rpx 0;
  border-top: 1px solid $ui-hairline;
}

/* 尺寸交给这里；配色仍由 pill-btn / 修饰类决定，别在本块里写 background-color ，
   否则会盖掉 .pill-btn--danger / --primary 的配色（同权重、后写的胜出）。 */
.drawer__action {
  display: flex;
  width: 100%;
  height: 84rpx;
  align-items: center;
  justify-content: center;
}

.drawer__tip {
  display: block;
  margin-top: 18rpx;
  color: $ui-text-3;
  font-size: 22rpx;
  text-align: center;
}

/* 后端地址是构建期内联的常量（切环境只改 src/api/env.js 的 APP_ENV）。
   放这一行是为了自查：万一手机上装的是旧包，扫一眼就知道它连的是哪套后端。
   事故复盘见 UNIAPP迁移说明.md 第 10.5 节。 */
.drawer__env {
  display: block;
  margin-top: 4rpx;
  color: $ui-text-3;
  font-size: 20rpx;
  text-align: center;
}

/* ===== 数据表格 =====
   改造前用的是原生 <table> + <colgroup> + table-fixed。
   小程序端没有表格布局（WXSS 也不支持 display: table），<table>/<tr>/<td>
   会被 uni-app 编译成一堆嵌套 view，表格排版整个丢失。
   因此改成 flex 行：
     - .dt__row 是 flex 容器，.dt__cell 为不收缩的定宽项；
     - 列宽沿用原先 columns[].width 的那批 Tailwind w-* 类，语义不变；
       **表头行与每个数据行都必须把 column.width 绑到单元格上**：flex 下没有
       <colgroup> 统一分配列宽，只靠内容宽撑开 —— 哪一列的某一行漏绑，表头与
       数据行就会错位（表头少绑时最明显：表头跟着文字宽度收窄、数据行仍是定宽）。
     - 列宽按**手机屏**收紧过一轮：桌面端的 64/144/160px 在手机上每列都留一大片
       空白，现改成按内容长度取的标准刻度（序号 w-10、日期 w-24、工单号/编码 w-28、
       类型 w-20、数量 w-20、需要换行的名称列 w-40），内边距 px-3 → px-2、右对齐列
       pr-5 → pr-3、表头 py-4 → py-3。刻意不再用 w-[NNpx] 这类方括号类名：
       小程序端要靠构建期转义才生效（同 FilterHeaderCell 的 max-width 处理）。
     - **序号列一律居中**（表头与数据格都居中）：列定义里给序号列写 align: 'center'，
       表头与数据格的 :class 据此补 text-center。主页面这 6 张表与导入页原本是左对齐，
       只有图片解析页的序号列写了 align: 'center'；现在三处统一成同一套规则。
     - 跨列单元格（原 colspan）改用 .dt__grow 占满剩余宽度；
     - 外层 overflow-x-auto 保留，列多时横向滚动，与改造前行为一致。
   注：本块所在的 <style> 已声明 lang="scss"（用于 // 注释与 uni.scss 变量）。 */
.dt {
  min-width: 100%;
}

/* 横向滚动的 6 张表（工单汇总 / 领料汇总 / 入库汇总 / 工单报工 / 工单核算 /
   原辅料核算）在模板上加了 .dt--scroll。
   原因：改造后行内的单元格是 flex-shrink: 0 的定宽项，列多时会「溢出」行盒子，
   而 .dt / .dt__head / .dt__body / .dt__row 这几个盒子的宽度默认只等于**滚动容器的
   可视宽**（.dt 是块级盒子，width: auto 就等于父容器宽的 100%）。底色与分隔线原本都画在
   这些盒子上，于是只能覆盖前一段 —— 横向滚过之后右侧那几列落到盒外，露出没有底色的底，
   表现为「表头灰底只到中间某一列，后面几列变白」「hover 过的那一行同理半截」，
   连 divide-y 画在 .dt__body 上的分隔线也一起半截。
   这里做两件事：
     1) 底色与分隔线改画到**单元格**上（.dt--scroll 里的表头行 + 所有 .dt__row 的直接子
        view）。单元格就是被溢出走的那些格子本身，画在它们身上与盒子宽度无关，各端必然
        整行铺满 —— 只靠把盒子撑宽，App 端真机实测并不可靠；
     2) 因此要把 Tailwind 在盒子上画的 divide-y 中和掉，否则会和单元格上的线叠成 2px。
   同时保留 .dt 的 width: max-content（H5 上更"正统"，横向滚动范围也更准）；
   内容比容器窄时仍由 .dt 上的 min-width: 100% 兜底（空表提示行也在其中）。
   -webkit- 前缀是给老 WKWebView（iOS 小程序）的。 */
.dt--scroll {
  width: -webkit-max-content;
  width: max-content;
}

/* 底色改画到单元格上。表头行先 inherit 到 .dt__head 的底色，再由单元格继承；
   数据行则让单元格继承行自己的底色 —— 行上的 hover:bg-slate-50 也就跟着铺满整行了。 */
.dt--scroll .dt__head > .dt__row,
.dt--scroll .dt__row > view {
  background-color: inherit;
}

/* 中和 Tailwind 画在盒子上的 divide-y（.dt > 第 2 个孩子 = 表头与表体之间、
   .dt__body > 相邻行），否则会和下面画在单元格上的线叠成 2px。
   这里用 .dt.dt--scroll 双类名把权重提到 (0,4,2)，保证压得住 weapp-tailwindcss 改写出的
   `.divide-y>view+view` 与 H5 版的 `.divide-y > :not([hidden]) ~ :not([hidden])`。 */
.dt.dt--scroll > .dt__body,
.dt.dt--scroll .dt__body > .dt__row + .dt__row {
  border-top-width: 0;
  border-bottom-width: 0;
}

/* 表头与数据行之间那条线（原来由根节点上的 divide-slate-200 画在 .dt__body 上）。
   单元格已经是 border-box，加 1px 边框不会改动列宽几何。 */
.dt--scroll .dt__head > .dt__row > view {
  border-bottom: 1px solid $slate-200;
}

/* 数据行之间的分隔线（原来由 .dt__body 上的 divide-slate-100 画在行盒子上）。 */
.dt--scroll .dt__body > .dt__row + .dt__row > view {
  border-top: 1px solid $slate-100;
}

.dt__head {
  background-color: $slate-50;
}

.dt__row {
  display: flex;
  min-width: 100%;
  align-items: stretch;
}

/* flex 子项默认会被压缩，不关掉的话列宽对不齐；
   而且必须显式声明 border-box —— 本项目的 tailwind preflight 是关掉的
   （见 tailwind.config.js 的 corePlugins.preflight），uni-view 默认按
   content-box 算：写了 w-16 的列实际占 64px + 左右内边距，整张表比设计宽一圈，
   看上去就是「列与列之间间距很大」。声明 border-box 后列宽 = 类名写的那个值，
   与改造前桌面端（preflight 生效时）的几何一致。 */
.dt__row > view {
  box-sizing: border-box;
  flex-shrink: 0;
}

/* 表格为空时的整行提示 */
.dt__empty {
  box-sizing: border-box;
  width: 100%;
  padding: 64px 12px;
  color: $slate-400;
  font-size: 14px;
  text-align: center;
}

/* 跨列单元格（原 colspan）：占满行内剩余宽度 */
.dt__grow {
  flex: 1 1 0%;
  min-width: 0;
}

/* 周统计表：改造前靠 border-collapse: collapse 合并相邻单元格边框。
   flex 下相邻单元格各画一条边 → 视觉上变成 2px 双线。
   给「除首列外的单元格」一个 -1px 左边距、给后续行一个 -1px 上边距，
   让相邻边框互相重叠，还原成 1px 单线网格。 */
.weekly-grid .dt__row > view + view {
  margin-left: -1px;
}

.weekly-grid .dt__row + .dt__row {
  margin-top: -1px;
}

/* ===== 筛选行的公共件（物料查询 / 月底储罐液位记录共用）===== */
.filter-search {
  display: flex;
  min-width: 200px;
  min-height: 36px;
  flex: 1 1 200px;
  max-width: 320px;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-radius: $ui-radius-pill;
  background-color: $ui-surface-2;
  color: $ui-text-3;
}

.filter-search__input {
  /* min-width: 0 不能省：flex 子项默认按内容宽当最小宽度，
     输入框的固有宽度会把整行顶出容器（物料选择器踩过同一个坑） */
  min-width: 0;
  min-height: 36px;
  flex: 1;
  color: $ui-text;
  font-size: 14px;
}

/* 胶囊按钮（开关 / 动作）：开=强调色淡底 */
.filter-chip {
  display: flex;
  height: 32px;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 0 14px;
  border-radius: $ui-radius-pill;
  background-color: $ui-raise-2;
  color: $ui-text-2;
  font-size: 13px;
  transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;
}

.filter-chip.is-on {
  background-color: $ui-accent-soft;
  color: $ui-accent-text;
}

/* 表格内的输入框。
   改造前是一串 Tailwind 工具类，但其中 focus:ring-* 那类变体在小程序端
   本就不生效，且小程序 input 需要显式高度才撑得起来，所以落成显式样式。 */
.weekly-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  padding: 0 20px 0 12px;
  border: 0;
  background-color: transparent;
  color: $slate-700;
  font-size: 14px;
  text-align: right;
}

/* ===== 列表里的单据缩略图 =====
   改造前是「20×20 的 span 里叠一个内联 <svg> 占位图标 + 一张 img 覆盖其上」，
   图片加载失败时逐级降级、最终隐藏露出图标。
   小程序端没有 svg 标签，占位图标换成 wd-icon；img 换成 <image>。 */
.thumb {
  position: relative;
  display: flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background-color: $slate-100;
  color: $slate-400;
}

.thumb__img {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 20px;
  height: 20px;
  border: 1px solid $ui-border;
  border-radius: 4px;
  background-color: $ui-surface-2;
}

/* 多张照片时角上的张数（月底储罐液位记录的图据可多张）*/
.thumb__badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background-color: $ui-accent;
  color: $ui-on-accent;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
}

/* ===== 图片查看器（工单汇总与周统计各一份，共用这套类名）=====
   原来靠 Element Plus 的 el-dialog 提供弹层与 #header/#footer 插槽，
   现在换成 wd-popup + 普通的头部/主体/底部三块，样式自己给。 */
.viewer-head {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  padding: 16px 20px;
  border-bottom: 1px solid $slate-100;
  color: $slate-700;
  font-size: 14px;
}

.viewer-body {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: $slate-50;
}

// 图片区高度给在这一层：内嵌的 ImageViewer（inline 形态）是 100%，
// uni 的 <image> 也不会自己撑开 —— 改造前这段高度写在 .viewer-stage__img 上。
// overflow 必须裁掉：放大后的图不能画到卡片外面。
.viewer-stage {
  position: relative;
  display: flex;
  width: 100%;
  height: 56vh;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.viewer-nav {
  position: absolute;
  top: 50%;
  z-index: 10;
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  /* 用负 margin 做垂直居中，省掉 translateY，两端表现更稳 */
  margin-top: -18px;
  border: 1px solid $ui-border-contrast;
  border-radius: 50%;
  background-color: $ui-raise-3;
  color: $ui-text;
  font-size: 20px;
  line-height: 1;

  &--prev {
    left: 8px;
  }

  &--next {
    right: 8px;
  }
}

.viewer-stage__delete {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
}

.viewer-empty {
  color: $slate-400;
  font-size: 14px;
}

.viewer-counter {
  padding: 8px 20px;
  color: $slate-500;
  font-size: 13px;
  text-align: center;
}

.viewer-foot {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid $slate-100;
}

/* 储罐示意图（纯 CSS/DOM 图层，取代改造前的 .vessel-canvas）。
   三层结构：① __paper 底图；② __tank 罐体裁剪层（overflow + 斜杠圆角，液体/波峰带/
   差值带/起始虚线都在里面）；③ __callout 引线标注（在裁剪层之外，所以不会被罐体切掉）。
   切换罐型时高度平滑过渡 + 淡出淡入 —— 与改造前一致。 */
/* 面板本身不画底色、也不描边：底图是「按主题二选一」的两张同尺寸资源
   （浅色 = 白纸版，深色 = 透明底亮线版，见 resources/compress-vessel-images.py），
   于是图纸背景天然就是它所在卡片的底色 —— 深浅主题都不需要对任何色值。
   改造前 canvas 版在深色下是一整块白纸，见 UNIAPP迁移说明.md 5.3。 */
.vessel-diagram {
  position: relative;
  transition: aspect-ratio 320ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease;
}

.vessel-diagram.is-switching {
  opacity: 0;
}

/* 底图：宽 = 1075 / 1375（右侧 300 是引线标注栏，改造前 canvas 也是这么留的） */
.vessel-diagram__paper {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
}

/* ⚠️ 这里**不要**加 mix-blend-mode。
   2026-10-09 曾用 `.theme-light & { mix-blend-mode: multiply }` 把"白纸底图"的白色
   乘成卡片底色（当时底图的浅色版是白底）。观感是对的，但真机反馈**每次加载会先白一下
   再变过来** —— 混合生效前的那一帧仍是原始白底。
   已经改成从资源侧解决：两张底图现在都是透明底（见 resources/compress-vessel-images.py），
   线稿直接坐在卡片实际底色上，任何底色都对，也就不需要混合模式、没有那一帧。 */

/* 罐体裁剪层：轮廓 = 矩形 + 斜杠圆角（圆角值由 vesselDiagram 按罐型算好内联） */
.vessel-diagram__tank {
  position: absolute;
  overflow: hidden;
}

/* 液体主体：顶边落在「液面 − 一个波幅」处，向上正好接住波峰带 */
.vessel-diagram__liquid {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
}

/* 波峰带：只占液面上下一格波幅；拱形瓦片、瓦片宽、动画时长都内联给定（随介质与罐宽变）。
   自层两倍宽 + translateX(-50%)：位移恰好 = 整数格 = 图案周期，循环处不跳变。 */
.vessel-diagram__wave {
  position: absolute;
  left: 0;
  width: 100%;
  overflow: hidden;
}

.vessel-diagram__wave-shift {
  position: absolute;
  top: 0;
  left: 0;
  width: 200%;
  height: 100%;
  background-repeat: repeat;
  animation-name: vessel-wave;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

@keyframes vessel-wave {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(-50%);
  }
}

/* 起止液位差值带：底色 + 45° 斜纹。
   斜纹间距改成了固定屏幕像素（改造前是 1.4px / 11 逻辑像素，随图缩放后在手机上
   只剩 2~3 个设备像素、糊成一片）—— 这是刻意的偏差，见 UNIAPP迁移说明.md 5.3。 */
.vessel-diagram__delta {
  position: absolute;
  left: 0;
  width: 100%;
  background-image: linear-gradient(
    45deg,
    transparent 0 5.8px,
    currentColor 5.8px 6.8px,
    transparent 6.8px 100%
  );
  background-size: 9px 9px;
}

/* 颜色与改造前一致；斜纹用 currentColor 的 0.4 透明度（等效于原来的 globalAlpha = 0.4） */
.vessel-diagram__delta.is-decrease {
  color: rgba(225, 29, 72, 0.4);
  background-color: rgba(244, 63, 94, 0.1);
}

.vessel-diagram__delta.is-increase {
  color: rgba(5, 150, 105, 0.4);
  background-color: rgba(16, 185, 129, 0.12);
}

/* 起始液位虚线的画法：图纸里那条（.vessel-diagram__start）与液位控件前的小标
   （.vessel-legend--start）必须一模一样，所以只写这一份 @mixin。
   墨色走 $ui-text（浅色 = #14161c，与改造前的 #0f172a 肉眼无差；
   深色自动变亮 —— 深色底图是亮线，写死近黑会整条看不见）。
   线型 2px 高、5px 实 / 4px 空（固定屏幕像素，理由同差值带斜纹） */
@mixin vessel-start-line {
  height: 2px;
  background-image: linear-gradient(90deg, $ui-text 0 5px, transparent 5px 9px);
}

.vessel-diagram__start {
  position: absolute;
  left: 0;
  width: 100%;
  @include vessel-start-line;
}

/* ===== 液位滑块：轨道 + 玻璃手柄（盖在图纸之上，见模板）=====
   轨道贴罐体左缘、与罐体盒子同高 —— 于是它的刻度与液面同一把尺（0 = 罐底、100 = 罐顶），
   手柄的 bottom% 直接就是 levelBottomPercent 算出来的那个数。
   只有手柄是固定屏幕尺寸（手指要抓得住、数字要看得清），轨道与手柄的位置全走百分比，
   跟着图纸缩放。

   材质用抽屉 / 顶栏那套「液态玻璃」（@mixin glass）—— 使用方 2026-10-10 点名要这个材质。
   ⚠️ glass 里刻意不写 position（见 uni.scss 那条注释），定位一律在外面写，别搬进去。 */
.vessel-rail {
  position: absolute;
  z-index: 3; /* 压住底图、液体与引线标注 */
  width: 10px;
  margin-left: -5px; /* 轨道中心线落在罐体左缘上 */
  touch-action: none; /* 轨道上的滑动不参与页面滚动 */
}

/* 起手热区：看不见、只是把轨道左右各撑宽 11px（10px 轨道 → 32px 加宽区）。
   落在它上面的触摸冒泡到 .vessel-rail 的起手处理，按落点认领手柄（见模板里的说明）。
   画在最底层（它是 .vessel-rail 的第一个子节点）：轨道与胶囊的命中照旧优先。
   touch-action 不继承（同下面手柄那条注释），所以这里也得自己写一份。 */
.vessel-rail__grab {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -11px;
  right: -11px;
  touch-action: none;
}

/* 轨道本身也是一条玻璃（同一处材质说明见上面的段落注释），只是窄。
   描边比 mixin 默认那档重一级：10px 宽的条子上，默认的 15% 白在深色卡片上基本看不出来，
   2026-10-10 的第一版截图里整条轨道就是"消失"的。 */
.vessel-rail__track {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  @include glass($radius: $ui-radius-pill);
  border-color: $ui-glass-line-hover;
  /* 三层大投影在窄条上有一半落在条子外面、看着像脏边，换成一条贴身晕影 */
  box-shadow: 0 2px 10px $ui-glass-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.14);
  touch-action: none; /* 同手柄：摸到轨道上起手，别让页面抢着滚 */
}

/* 手柄：从轨道中心线向右伸出（罐体左侧那条空白太窄，手机上放不下一个胶囊）。
   纵向位置由模板内联的 bottom% 给，translateY(50%) 让中心压在液面上。
   left/top/bottom 都不参与 transition：跟手要 1:1，中间不能再插一层动画。 */
.vessel-rail__handle {
  position: absolute;
  left: 50%;
  display: flex;
  height: 28px;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 6px;
  transform: translateY(50%);
  border-radius: $ui-radius-pill;
  cursor: grab;
  user-select: none;
  /* 拦页面滚动的主力：把手势的判定提前到合成器，不会因为「浏览器已经决定要滚」
     甩一个 touchcancel 过来把手势打断（同 PhotoGrid 的圆圈）。touch-action 不继承，
     所以必须写在手柄自己身上 —— 光写在 .vessel-rail 上，手柄读到的还是 auto。 */
  touch-action: none;
  @include glass($radius: $ui-radius-pill);
  /* 大尺寸的 $ui-glass-elev 在小胶囊上太重，换成一条贴身投影 + 顶边受光 */
  box-shadow: 0 5px 16px $ui-glass-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: transform 160ms $ui-ease, box-shadow 160ms $ui-ease;
}

/* 小标缩窄：胶囊少盖一点罐体（控制列那两个保持 20px 不动） */
.vessel-rail__handle .vessel-legend {
  width: 12px;
}

/* 手感区：胶囊 28px（画出来 30px，含 1px 玻璃描边）在手机上还是窄 —— 上下各再撑 14px
   （合 58px），左边 8px 把轨道那侧搭上，右边 14px 兜住手指偏出胶囊的情形。
   伪元素不是事件目标（touch 落在它上面照样冒泡到 .vessel-rail 的起手处理），只扩热区、不动外观。
   2026-10-13 由 ±10px 扩到这里：手机端反馈「失触概率高」——原来的热区外 4px 就摸不到了。 */
.vessel-rail__handle::before {
  content: '';
  position: absolute;
  top: -14px;
  right: -14px;
  bottom: -14px;
  left: -8px;
}

/* 拖动中：提亮、微放大、压到另一个手柄之上（两个叠在一起时拖的一定是被按住的这个） */
.vessel-rail__handle.is-dragging {
  z-index: 1;
  transform: translateY(50%) scale(1.08);
  box-shadow: 0 10px 26px $ui-glass-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.vessel-rail__num {
  color: $ui-text;
  font-size: 12px;
  font-weight: 600;
}

/* ===== 液位控件前的两个图例小标 =====
   两个都按图纸里对应的那一层画，避免「小标是一套、图纸是另一套」：
     起始 = 那条起始虚线（与 .vessel-diagram__start 共用 @mixin vessel-start-line）
     终止 = 那片波峰液面（图案与图纸的 .__wave 同一份 vesselWavePattern，颜色由模板内联给） */
.vessel-legend {
  display: inline-block;
  width: 20px;
  flex-shrink: 0; // 窄屏下别被标签压扁
}

.vessel-legend--start {
  @include vessel-start-line;
}

/* 终止：只画波峰那一格，不画液体填充（20px 宽的小标里 0.28 透明度的填充看不出来）。
   拱的宽高比照图纸来（图纸里拱约 14.5 × 3.5 CSS px ≈ 4:1）：瓦片 14px、带高 4px，
   小标里正好看到一个整拱加半个。 */
.vessel-legend--end {
  height: 4px;
  background-repeat: repeat;
  background-size: 14px 100%;
}

/* ===== 两个液位的读数格 =====
   每格 200px 起步（约等于「体积：12.86 m³（38.5 t）」那句的宽度）：200+200+24 放不下就换行，
   放得下 grow 平分 —— 360~375px 的手机上两格落成一列，宽屏并排。

   为什么是这行 scss 而不是 min-w-[200px]：
     · min-width 挡不住「父级比它窄」——立式罐那张图纸（displayWidth 可能 700 多 px）会把旁边
       这一列挤到只剩十几 px，格子就会横向溢出、连整页一起撑宽；flex-basis + min-width:0 允许
       它缩到任意窄，页面不会被读数格撑宽。
     · 也别指望 Tailwind 的 basis-52 —— H5 端 rpx 会被编译成 rem，根字号随视口走
       （900px 宽时 1rem = 38.4px，basis-52 = 13rem = 499.2px），只有写死 px 才各屏一致。 */
.vessel-readout {
  flex: 1 1 200px;
  min-width: 0;
}

/* ===== 逐帧滚动的数值：定宽槽（液位读数 + 引线标注共用）=====
   这几个数字绑定的是缓动值（vesselStartDisplay / vesselEndDisplay 等），缓动期间
   每帧写一次；数字是行内文本，宽度一变就推动同一行的固定文字：
     · 体积变化那行是 justify-center —— 组内一变宽，整组重新居中，两端的
       「体积变化」「m³」跟着一起挪；
     · 引线标注是右对齐 —— 行左边界 = 内容宽度，「消耗 / 增加」跟着左右跑。
   给每个滚动数字一个定宽、右对齐的槽，槽宽恒定，槽外一个像素都不动。

   宽度用 ch（= 字体里「0」的宽度）：开了等宽数字时 1ch 就是一位数字宽，没开时
   ch 不小于其他数字，天然不溢出。先写 em 回退再写 ch —— 同一选择器后写者胜出，
   不支持 ch 的解析器会丢掉第二行。
   槽要留余量：宽度不够时溢出方向是右侧，会压到后面的单位上。
   font-variant-numeric: tabular-nums：平台字体默认可能是比例数字（iOS 的 SF Pro
   尤其明显），同一位数每帧都在改字宽 —— 那是 60fps 的连续抖动；小程序端若忽略
   这个属性，槽宽仍固定，只是数字在槽内微动。 */
.vessel-num {
  display: inline-block;
  white-space: nowrap;
  text-align: right;
  font-variant-numeric: tabular-nums;
  -webkit-font-feature-settings: 'tnum';
  font-feature-settings: 'tnum';
}

/* 液位读数：不超过 4 位整数（量程：卧式 = 直径 2800，立式 = 筒体 4800 + 封头 900） */
.vessel-num--level {
  width: 2.6em;
  width: calc(4ch + 0.1em);
}

/* 体积 / 质量：XX.XX（一个小数点） */
.vessel-num--volume {
  width: 2.7em;
  width: calc(4ch + 0.5em);
}

/* 带符号：正负号 + 4 位 + 小数点；数字右对齐，多出的空档留在左侧、
   紧贴「体积变化」那一侧，不影响观感 */
.vessel-num--signed {
  width: 3.3em;
  width: calc(4ch + 0.8em);
}

/* 引线标注：1px 高的定位容器本身就是那条水平引线（罐体 → 文字一侧），
   颜色由 is-decrease / is-increase 给，圆点与文字都用 currentColor 继承 */
.vessel-diagram__callout {
  position: absolute;
  right: 0;
  height: 1px;
  background-color: currentColor;
}

/* 升/降色是**语义色**，走 token：写死的 #e11d48/#059669 是 Tailwind 的 rose-600/emerald-600，
   在墨蓝夜景上过饱和、跳出来，而且浅色主题下与本仓的 $ui-danger/$ui-success 不是同一个值。
   换 token 后两套主题各自成立（深色是降饱和的那组，见 uni.scss）。 */
.vessel-diagram__callout.is-decrease {
  color: $ui-danger;
}

.vessel-diagram__callout.is-increase {
  color: $ui-success;
}

/* 起点圆点：直径 7px（改造前是 fs × 0.26 的半径，屏幕上约 6.8px），圆心落在锚点上 */
.vessel-diagram__callout-dot {
  position: absolute;
  top: 50%;
  left: 0;
  width: 7px;
  height: 7px;
  margin: -3.5px 0 0 -3.5px;
  border-radius: 50%;
  background-color: currentColor;
}

/* 文字：右对齐贴面板右边缘（改造前文字右边界 = W − fs × 0.7 ≈ 屏幕上 9px），
   底边抬到引线上方 20px —— 改造前文字块中心在引线上方 41.6 屏幕像素 */
.vessel-diagram__callout-text {
  position: absolute;
  right: 9px;
  bottom: calc(50% + 20px);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  color: currentColor;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
}

/* 锚点落在图纸上方 40% 以内时，文字改放引线下方，避免越出白纸面板 */
.vessel-diagram__callout.is-below .vessel-diagram__callout-text {
  bottom: auto;
  top: calc(50% + 6px);
}

/* 标注每行：前缀 + 定宽数值槽 + 单位。整块右对齐（align-items: flex-end），
   行宽由槽宽决定 —— 槽定宽，所以缓动期间前缀与单位一个像素都不动。
   改造前每行是一整条字符串，「消耗 / 增加」的左边界 = 内容宽度，数值一变宽就左右跑。 */
.vessel-diagram__callout-line {
  display: flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

/* 储罐选择器：按标题样式呈现。
   改造前这些样式挂在 :deep(.el-select__wrapper) 上 —— 覆写的是 Element Plus 的
   内部结构。现在触发器就是我们自己的 view，样式直接写在它身上，不再需要 :deep()；
   同时去掉了 hover / is-focused 两条 —— 触屏没有 hover，
   而 :deep(.is-focused) 那个类名也是 Element Plus 专属的。
   弹层从 wd-picker 的滚轮换成了自绘浮层，但触发器这一层完全没动 ——
   样式挂在我们自己的 view 上，换承载它的弹层不需要改这里。

   ⚠️ 这里原来是 `width: 224px`（"固定宽度，避免被拉伸到整行"）。那个固定宽度是
      小程序端整块排版塌掉的元凶：选择器与规格说明同处一个 flex 行时，224px 是
      **不可压缩**的，360px 小屏上留给文字的就只剩约 23px，一个汉字一行。
      模板里已把选择器挪到独立行，这里再把宽度改成按内容自适应 ——
      width: auto + 罐名省略号，罐名再长也只是截断，不会撑破卡片。 */
.vessel-select {
  display: flex;
  width: auto;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 16px;
  border-radius: 999px;
  background-color: $ui-surface-2;
  box-shadow: 0 0 0 1px $ui-border inset;
  color: $ui-text;
  font-size: 15px;
  font-weight: 600;
  transition: box-shadow $ui-dur $ui-ease, background-color $ui-dur $ui-ease;
}

/* 罐名（"三氯氢硅储罐A/B示意图" 13 个字）：flex:1 撑开胶囊并给省略号一个可压缩的盒子。
   <text> 在小程序里默认是行内元素，overflow / text-overflow 对行内盒无效，
   所以必须显式改成块级。 */
.vessel-select__label {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: left;
}

/* 开态箭头翻转（参考图里「与我相关 ⌃」）：收起是下箭头，展开翻 180°。
   给图标套一层我们自己的节点，才能在不写 :deep() 的前提下加 transform ——
   覆写第三方结构是本项目明令避免的写法（UNIAPP迁移说明.md 第 4 节）。
   ⚠️ transform 只落在这个叶子节点上：DropdownMenu 的遮罩是 position: fixed，
      祖先里出现 transform 会让它认错包含块（说明 4.2）。 */
.vessel-select__caret {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: transform $ui-dur $ui-ease;
}

.vessel-select.is-open .vessel-select__caret {
  transform: rotate(180deg);
}

/* 公式排版：衬线斜体变量 + 真分数 + 根号上划线 */
.math-formula {
  font-family: Cambria, 'Cambria Math', 'Times New Roman', 'Songti SC', serif;
  font-size: 16px;
  line-height: 2.1;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

// 公式里的变量名与下标。
// 改造前用的是 <i> / <sub> —— uni-app 会把它们编译成块级 view，行内排版直接崩掉
// （「L 筒体长度」会变成两行）。所以改写成 <text>（行内组件）+ 显式类名表达斜体/下标。
.math-formula .mf-var {
  font-style: italic;
}

.math-formula .mf-sub {
  font-size: 0.7em;
  vertical-align: -0.15em;
}

.math-formula .frac {
  display: inline-flex;
  flex-direction: column;
  margin: 0 4px;
  vertical-align: middle;
  font-size: 0.85em;
  line-height: 1.25;
  text-align: center;
}

// 分子/分母改用显式类名，不再依赖 > :first-child / :last-child ——
// span 转换后元素名变了，且小程序 WXSS 对结构伪类的支持并不在官方保证范围内。
.math-formula .frac-num {
  border-bottom: 1px solid currentColor;
  padding: 0 5px;
}

.math-formula .frac-den {
  padding: 0 5px;
}

.math-formula .sqrt-body {
  border-top: 1px solid currentColor;
  padding: 0 4px 0 2px;
  margin-left: -1px;
}

.math-formula .paren {
  display: inline-block;
  transform: scaleY(1.35);
  margin: 0 2px;
}
</style>
