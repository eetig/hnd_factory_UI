<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import request from '../api/request'
import { clearAuth, getRoleName, hasPerm, isAdmin, isLoggedIn } from '../api/auth'
import StatsTable from '../components/StatsTable.vue'
import OrderImageDialog from '../components/OrderImageDialog.vue'
import ProductSelectDialog from '../components/ProductSelectDialog.vue'
import LoadingMask from '../components/LoadingMask.vue'
import PanelState from '../components/PanelState.vue'
import FilterHeaderCell from '../components/FilterHeaderCell.vue'
import { useWorkOrderData } from '../composables/useWorkOrderData'
import { usePickData } from '../composables/usePickData'
import { useInboundData } from '../composables/useInboundData'
import { useGoodsMoveData } from '../composables/useGoodsMoveData'
import { useMaterialStockData } from '../composables/useMaterialStockData'
import { useOrderImages } from '../composables/useOrderImages'
import { useStatsData } from '../composables/useStatsData'
import { useTankLevelData } from '../composables/useTankLevelData'
// 容器底图不再逐个 import：文件名来自设备台账，编译期不知道会有哪几张，
// 由 useVesselList.js 用 import.meta.glob 建「文件名 → URL」映射
import { useVesselList } from '../composables/useVesselList'
import TankLevelPanel from '../components/TankLevelPanel.vue'
import EquipmentMaintenancePanel from '../components/EquipmentMaintenancePanel.vue'
import PurchaseTrackingPanel from '../components/PurchaseTrackingPanel.vue'
import WorkOrderImport from './WorkOrderImport.vue'
import ImageParse from './ImageParse.vue'
import { getReportOrderType } from '../constants/orderTypes'
import { STATUS_TEXT } from '../constants/statusTones'
import { getLastWeekMonday, getLastWeekSunday, formatMonthDay, formatQty } from '../utils/format'
import { UTubeBundle, shellVolumeMm3 } from '../utils/vesselVolume'
import { useLiveQuery } from '../composables/useLiveQuery'
import 'dayjs/locale/zh-cn'
import updateLocale from 'dayjs/plugin/updateLocale'
import {
  ElCheckbox,
  ElConfigProvider,
  ElDatePicker,
  ElDialog,
  ElInput,
  ElOption,
  ElPagination,
  ElSelect,
  // 变更-045：体积计算页的液位滑块（工作台首次用 slider）
  ElSlider,
  // 收起态的图标条没有文字，靠 tooltip 报出组名（全仓第一处 tooltip）。
  // 本项目没有 app.use(ElementPlus)，一律按文件显式 import。
  ElTooltip,
} from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
// EP 样式与主题覆盖统一由 src/main.js 按序导入（见那里的注释），这里不再重复 import

dayjs.extend(updateLocale)
dayjs.updateLocale('zh-cn', { weekStart: 1 })
dayjs.locale('zh-cn')

// adminOnly：台账明细，只给 admin（决策-004）。这 6 页背后的接口
// （/api/work-order、/api/pick、/api/inbound、/api/goods-move）在后端也被同一角色闸门拦着，
// 两边必须同进同退 —— 只藏前端等于数据公开，只锁后端等于非 admin 点进去满屏 403。
//
// 周统计（weekly）**不在此列**：它对所有人可见，数据走 /api/stats/weekly 这条
// 只吐汇总数的公开接口（同样见决策-004），不依赖上面那些明细。
const TAB_GROUPS = [
  { key: 'order', label: '工单报工', hint: '工单、领料、入库与核算' },
  { key: 'stats', label: '数据统计', hint: '周统计与台账记录' },
  { key: 'tools', label: '工具', hint: '查询与计算' },
  { key: 'maintain', label: '数据维护', hint: '基础数据与录入' },
]

const tabs = [
  { key: 'workOrder', label: '工单汇总', adminOnly: true, group: 'order' },
  { key: 'material', label: '领料汇总', adminOnly: true, group: 'order' },
  { key: 'inbound', label: '入库汇总', adminOnly: true, group: 'order' },
  { key: 'report', label: '工单报工', adminOnly: true, group: 'order' },
  { key: 'costing', label: '工单核算', adminOnly: true, group: 'order' },
  { key: 'materialCosting', label: '原辅料核算', adminOnly: true, group: 'order' },
  { key: 'stock', label: '物料查询', group: 'tools' },
  { key: 'weekly', label: '周统计', group: 'stats' },
  { key: 'daily', label: '日报表记录', group: 'stats' },
  { key: 'tankLevel', label: '月底储罐液位记录', group: 'stats' },
  { key: 'vessel', label: '压力容器体积计算', group: 'tools' },
  // 设备数据维护（2026-10-06）：台账原先只读、只能改 SQL，这个页签是它的维护入口。
  // 用**权限位**而不是 adminOnly：写接口本来就是「仅 admin + 该权限位」两道，
  // 将来要放开给非 admin 的维护员时只需给角色加权限位，不必动这里的结构。
  { key: 'equipment', label: '设备数据维护', perm: 'equipment:edit', group: 'maintain' },
  { key: 'electricity', label: '电费预提', group: 'tools' },
  // 采购进度跟踪（2026-10-10）：使用方先要一个入口、功能内容待定 —— 先挂占位页，与电费预提同款。
  { key: 'purchase', label: '采购进度跟踪', group: 'tools' },
  { key: 'import', label: '文件导入', perm: 'work_order:import', group: 'maintain' },
  // 图片解析：单据图片识别辅助录入（变更-003）。与文件导入同属录入入口，沿用同一权限位
  { key: 'imageParse', label: '图片解析', perm: 'work_order:import', group: 'maintain' },
]

// 可见 Tab = 两类过滤的叠加：adminOnly 看角色，其余看权限位
const visibleTabs = computed(() =>
  tabs.filter((tab) => (tab.adminOnly ? isAdmin() : hasPerm(tab.perm))),
)

// 权限相关的显隐都读 authState（响应式），登录/退出后立即生效，无需整页刷新
const loggedIn = computed(() => isLoggedIn())
const roleName = computed(() => getRoleName() || '已登录')

// ===== 卡片行横向滚动 =====
// 原来是给 14 个 Tab 的横条用的（一屏放不下）；改成 dashboard 后页签挪进组内，
// 这一套原样留给「同组页面卡片」—— 工单报工那一组有 6 张卡，窄屏照样会溢出。
const tabNavRef = ref(null)

/**
 * 鼠标滚轮 → Tab 条左右滚动。
 *
 * 只在「这个方向确实还有内容」时才拦截，滚到头就放行给页面 ——
 * 否则指针停在 Tab 条上时整页都滚不动，用户会以为页面卡住了。
 */
function handleTabWheel(event) {
  const nav = tabNavRef.value
  if (!nav) return

  // 横向滚轮（触控板左右滑）交给浏览器默认行为，不掺和
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

  const maxScroll = nav.scrollWidth - nav.clientWidth
  if (maxScroll <= 0) return // 本来就装得下，不拦截

  const atStart = nav.scrollLeft <= 0 && event.deltaY < 0
  const atEnd = nav.scrollLeft >= maxScroll && event.deltaY > 0
  if (atStart || atEnd) return

  event.preventDefault()
  nav.scrollLeft = Math.max(0, Math.min(maxScroll, nav.scrollLeft + event.deltaY))
}

function goLogin() {
  router.push('/login')
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
  router.replace('/')
}

// 工单报工表格列
const reportColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'orderType', label: '工单类型', width: 'w-40' },
  { key: 'materialDesc', label: '产成品', width: 'w-[200px]', wrap: true },
  { key: 'orderQty', label: '订单数量', width: 'w-28', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-32', align: 'right' },
]

const router = useRouter()
const activeTab = ref('workOrder')

// 面板懒挂载的状态（mountedTabs）声明在下面 visibleTabs watch **之后** ——
// 见那里的注释：位置本身就是实现的一部分，放错会让不可见的面板也常驻。

// 切换登录态后，原先所在 Tab 可能已不可见 —— 兜底切到第一个可见 Tab，
// 否则会停在一个空白的 activeTab 上。
//
// immediate 是必须的：非 admin 打开页面时首屏默认 Tab（工单汇总）本就不可见，
// 而 visibleTabs 只在「值发生变化」时才触发回调，首次渲染的可见列表
// 是在这之前就定下来的 —— 不加 immediate 页面会停在隐藏面板上，看起来一片空白。
// 同理，这个 watch 必须放在 activeTab 声明之后（immediate 会立刻读到它，放前面撞 TDZ）。
watch(
  visibleTabs,
  (list) => {
    if (list.length && !list.some((tab) => tab.key === activeTab.value)) {
      activeTab.value = list[0].key
    }
  },
  { immediate: true },
)

/*
 * 面板懒挂载（2026-10-16 性能审查，变更-076；播种顺序修正于变更-078）。
 *
 * 原先 16 个面板全是 v-show 常驻，首屏就把它们全建出来。冷缓存 trace 实测：
 *   DOM 2920 个节点中 **1379 个属于不可见面板**；16 个 el-popper、10 个 el-date-editor、
 *   15/16 张表都不可见却已存在；强制重排 117ms（EP popper 的 getBoundingClientRect watcher）；
 *   LCP 1032ms 里 1023ms 是渲染延迟。
 *
 * 为什么不用「纯 v-if」——那样每次切走再切回都会重建面板：
 *   ① 面板里的本地状态会丢（未保存的行内编辑、滚动位置、已选文件）；
 *   ② 面板的 onMounted 取数会重跑，把请求放大。
 * 所以：**v-if 管「存不存在」，v-show 管「可不可见」，两个必须一起写**：
 *   v-if="mountedTabs.has(x)"    首次激活才创建
 *   v-show="activeTab === x"     非当前页必须藏起来 —— 只留 v-if 会让进来过的面板同时显示、叠在一起
 *                                （2026-10-16 靠截图抓到过一次：顶部露出的是本该隐藏的工单汇总面板）
 * 挂载后的语义与改动前的 v-show 一致：状态保留、面板 onMounted 的取数不重跑。
 * 回归护栏见 tests/component/WorkOrderList.spec.js 的「面板懒挂载」用例。
 *
 * ⚠️ 这段**必须放在上面 visibleTabs watch 之后**，并用 immediate + flush:'sync'：
 *   immediate 让种子取「**生效后**的 activeTab」，而不是字面上的 ref('workOrder')。
 *   放前面会怎样（2026-10-16 实测）：非 admin 打开页面时 activeTab 随后被 visibleTabs
 *   改成 stock，可 workOrder 已经进了集合 —— 那个**用户根本看不到**的面板照样常驻，
 *   连带它里面的 2 个日期选择器与 2 个 el-popper 一起出现在首屏；实测那 105ms 强制重排
 *   **全来自这些不可见 popper 的几何读取**（element-plus.js:21837）。
 *   flush:'sync' 则保证同一 tick 内切到的 Tab 在首次渲染前就已入集合，不会闪一个空面板。
 */
const mountedTabs = reactive(new Set())
watch(activeTab, (key) => mountedTabs.add(key), { immediate: true, flush: 'sync' })

// 切换 Tab 后把激活项滚进视野：登录/退出会让 visibleTabs 变化并自动切 Tab，
// 切到的那个可能在可视区之外，用户会看不到自己现在在哪一页。
// 这个 watch 必须放在 activeTab 声明之后 —— watch 的第一个参数是立即求值的，
// 放前面会撞上 TDZ（Cannot access 'activeTab' before initialization）。
watch(activeTab, async (key) => {
  await nextTick()
  const nav = tabNavRef.value
  const button = nav?.querySelector(`[data-tab-key="${key}"]`)
  if (!nav || !button) return

  const left = button.offsetLeft
  const right = left + button.offsetWidth
  if (left < nav.scrollLeft) {
    nav.scrollLeft = left
  } else if (right > nav.scrollLeft + nav.clientWidth) {
    nav.scrollLeft = right - nav.clientWidth
  }
})

// ===== 分组（dashboard 侧栏 / 组内卡片）=====
//
// ⚠️ 这几个都**必须放在 activeTab 声明之后** —— watch 的第一个参数是立即求值的，
// 放前面会撞上 TDZ（Cannot access 'activeTab' before initialization）。同上方两处注释的坑。

/**
 * 当前所在的大类。**由 activeTab 推导，不是独立状态** ——
 * 这样侧栏高亮、组内卡片与「登录/退出后自动切页」「导入返回跳回工单汇总」这些既有逻辑
 * 天然一致，不会出现「切了页但侧栏还停在上一个组」这类要额外同步的 bug。
 */
const currentGroup = computed(
  () => tabs.find((tab) => tab.key === activeTab.value)?.group ?? TAB_GROUPS[0].key,
)

/** 当前组里**可见**的页 —— 组内卡片用它 */
const groupTabs = computed(() =>
  visibleTabs.value.filter((tab) => tab.group === currentGroup.value),
)

/**
 * 侧栏要列的组：**只保留有可见页的**。
 *
 * 「工单报工」那 6 页全是 adminOnly —— 匿名/非 admin 时整组都不可见，
 * 无条件列出来就是一个点了没反应的死按钮（还以为页面卡了）。
 * 与手机端抽屉同一口径（那边的 visibleGroups）。
 */
const sidebarGroups = computed(() =>
  TAB_GROUPS.map((group) => ({
    ...group,
    tabs: visibleTabs.value.filter((tab) => tab.group === group.key),
  })).filter((group) => group.tabs.length > 0),
)

/** 当前页标题（主区顶部） */
const activeTabLabel = computed(() => tabs.find((tab) => tab.key === activeTab.value)?.label ?? '')

/*
 * 变更-038 / 044 定下的「卡片内滚」契约仍然成立，但**不再需要 JS 表达**：
 * 四个汇总页签与储罐液位的滚动发生在卡片内部（表格区自己滚），其余页签仍在主区栏
 * 里滚。当时为此维护了 `INNER_SCROLL_TABS` + `scrollsInsideCard`，唯一的用途是给
 * `.glass-scroll` 标记类挑「此刻真正在滚的那个元素」—— 那是 042 折射层的时间线
 * （`--main-scroll`）要看的：挂在一个不滚动的元素上，三块玻璃的边缘高光会**冻在
 * 贴顶那一格**，不报错、只是不跟手。
 *
 * x-minimalist 删掉折射层之后这条时间线没有消费者，标记、名单与那份推导一并删除
 * （变更-056）。「谁在滚」这条**结构事实**没有丢：它现在由模板本身表达（卡片
 * `h-full flex-col` + 表格区 `min-h-0 flex-1 overflow-y-auto`），并由 spec §15 的
 * 定高链断言钉着 —— 也就是不再需要「两本账对账」这种东西了。
 */

/**
 * 切大类：落到该类第一个**可见**页。
 *
 * 不能盲取该类第一个页 —— 非 admin 时前 6 个页不可见（决策-004），
 * 那样一点「工单报工」就会切到一个看不见的页上，主区一片空白。
 */
function selectGroup(key) {
  const first = visibleTabs.value.find((tab) => tab.group === key)
  if (first) activeTab.value = first.key
}

// ===== 侧栏收起 / 展开（使用方 2026-10-07：点击切换浮动面板 / 图标条）=====

/**
 * 四个大类的图标（收起后那条图标条用）。
 *
 * key 与 TAB_GROUPS 一一对应 —— 以后加组必须同期加图标，否则 `:d` 拿到 undefined，
 * 画出来是一个空白按钮：点得动、能切页，但看不出是哪个组。
 *
 * 值是**一个 <path> 的 d**。一个 d 里可以并列写多段子路径（剪贴板的「夹子」、
 * 数据库的椭圆都是这么画的），所以四种图形都塞得进一条 path —— 不必为
 * <rect>/<circle> 另开元素，也就不必为此引入 v-html。
 * 线条语言取自 Feather，与 components/FilterHeaderCell.vue 同一套。
 */
const GROUP_ICON_PATHS = {
  order:
    'M15 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 1 1v3H8V3a1 1 0 0 1 1-1z',
  stats: 'M18 20V10M12 20V4M6 20V14',
  tools:
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  maintain:
    'M21 5a9 3 0 0 1-18 0a9 3 0 0 1 18 0zM21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
}

const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed'

/** 读写都兜一层：隐私模式下 localStorage 会直接抛（同 useVesselList 的缓存写法）。 */
function readCollapsedFlag() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 收起状态**持久化**：收起的动机是「把 224px 让回给表格」，
 * 刷新一次就自己弹回去，等于每次打开都要重收一遍，那这个功能就白做了。
 */
const collapsed = ref(readCollapsedFlag())

watch(collapsed, (value) => {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // 存不进去只是下次打开忘了收起，不影响本次使用
  }
})

function toggleSidebar() {
  collapsed.value = !collapsed.value
}

// 工单数据与筛选（2026-10-10 整改：筛选/分页都在服务端）
// 工单报工与工单核算原先读这份数据的「全量筛选后」数组，现在读 useStatsData，
// 而它取的是服务端按「工单类型 + 产成品」汇总的结果（workOrderSummaryRows）
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
  loadPickPage,
  reloadPickRecords,
  fetchPickRecords,
  fetchPickSummary,
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

/*
 * ===== 物料查询：边打边查（变更-059）=====
 *
 * ⚠️ 改的是**触发时机**，不是把服务端查询退回前端过滤 —— 筛选与分页仍在服务端
 * （见 useMaterialStockData 头部注释）。
 *
 * 接线本身走 `useLiveQuery`（防抖 + 查询签名去重 + 卸载时撤销，四个查询框共用一份，
 * 见 src/composables/useLiveQuery.js 的头部注释）；过期响应护栏那第三层在数据层里
 * （useMaterialStockData 的 stockRequestSeq）—— 它必须贴着请求写，只有那里知道谁先回来。
 *
 * 签名里带上「只看有库存」：筛选条件不止关键词，不带它的话改开关会被误判成"没变"。
 */
const { flush: flushStockFilter } = useLiveQuery(stockKeyword, applyStockFilter, {
  keyOf: () => `${stockKeyword.value.trim()}|${stockOnlyInStock.value}`,
})

/** 已经有行、又正在查（实时查询的「细化」阶段）：表格不换遮罩，只在计数处提示 */
const stockRefining = computed(() => stockLoading.value && stockTableData.value.length > 0)

/** 「只看有库存」开关：改完立刻重过滤（手动操作，不等防抖） */
function toggleStockOnlyInStock(value) {
  stockOnlyInStock.value = value
  return flushStockFilter()
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
  loadInboundPage,
  reloadInboundRecords,
  fetchInboundRecords,
  fetchInboundSummary,
  openInboundMaterialDialog,
  handleInboundMaterialSelected,
  clearInboundMaterialFilter,
} = useInboundData()

// 货物移动数据（原辅料核算的「已报工数」来源；数据本身由 useStatsData 读取）
// 加载失败必须在界面上呈现（变更-033）：失败时 goodsMoveQtyMap 是空的，
// 核算表的「已报工数」会被算成 0、「未报工数」= 全部领料量 —— 那不是缺数据，
// 是一个看起来合理的错误答案。现在失败走横幅 + 两列显示「—」。
//
// 2026-10-10 整改：取数从「明细全表」换成服务端「按物料 + 来源库位」的汇总结果。
const { goodsMoveError, fetchGoodsMoveSummary } = useGoodsMoveData()

// 工单图片弹窗：状态与请求逻辑见 useOrderImages，与 <OrderImageDialog /> 共用同一份状态
const { openImageDialog } = useOrderImages()

// 月底储罐液位记录（变更-004 / 变更-008）：整个面板在 <TankLevelPanel> 里，
// 它自己从 useTankLevelData() 取数与渲染。这里只留「首次进 Tab 才加载」这一个钩子 ——
// 面板是 v-show 常驻的，挂载时机与 Tab 切换不是一回事（见下方 watch(activeTab)）
const { ensureTankLevelLoaded } = useTankLevelData()

// 工单号可选项（当前日期范围内的工单号，倒序）
// 三张汇总表（工单报工 / 工单核算 / 原辅料核算）的行数据来自 useStatsData，
// 其纯函数部分有单测覆盖；本页只提供列配置
const { reportRows, costingRows, materialCostingRows } = useStatsData()

/**
 * 原辅料核算的展示行：货物移动不可用时，把它派生的两列换成「—」。
 *
 * 0 与「—」的区别是这件事的全部：显示 0 等于替使用方断言「这个月没有人报工」，
 * 真实情况却是「这个数没拿到」。领料数不依赖货物移动，照常显示。
 */
const materialCostingDisplayRows = computed(() =>
  goodsMoveError.value
    ? materialCostingRows.value.map((row) => ({ ...row, reportedQty: '—', unreportedQty: '—' }))
    : materialCostingRows.value,
)

// 汇总表行 key：同名物料可能出现多行，用「分组键 + 序号」保证唯一
const statsRowKey = (item, index) => `${item.orderType ?? item.materialName}-${index}`

const columns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'planStartDate', label: '基本开始日期', width: 'w-36' },
  { key: 'orderNo', label: '工单号', width: 'w-40' },
  { key: 'orderType', label: '工单类型', width: 'w-32' },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'materialDesc', label: '产成品', width: 'w-[180px]' },
  { key: 'orderQty', label: '订单数量', width: 'w-28', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-32', align: 'right' },
  { key: 'deliveredQty', label: '已交货数量', width: 'w-32', align: 'right' },
]

function handleImportCancel() {
  activeTab.value = 'workOrder'
}

/**
 * 「数据被写过了，下次切 Tab 记得重拉」的标记。
 *
 * 两个写入口都会置位：文件导入（Excel）、图片解析确认入库（走同一条落库管线）。
 * 页面是单页 + v-show 切 Tab，Tab 从不卸载，切来切去不触发任何生命周期钩子 ——
 * 而列表现在只在「筛条件 / 翻页」时才查，写完之后若用户不碰筛选条，就还停在旧结果上。
 *
 * ⚠️ 2026-10-10 之前这里只服务文件导入（判断还写死了 prevTab === 'import'），
 * 图片解析那条链路压根没通知过页面 —— 手机端「入库成功了、领料汇总看不到」那条 bug
 * 就出在这，电脑端是同一个结构性的坑，一并堵上。
 */
const importDirty = ref(false)

/** 图片解析确认入库成功后置脏（事件来自 views/ImageParse.vue） */
function handleOcrConfirmed() {
  importDirty.value = true
  // 落库会同时影响领料/入库/库存/周统计与三个核算页
  refreshAllData()
}

/**
 * 台账明细四连发：工单 / 领料 / 入库 / 货物移动。
 *
 * 这四个接口在后端是 admin 专属（决策-004），非 admin 调过去只会拿到 403 ——
 * 403 在 request 层只 reject、不弹提示，所以不会出错，但白发四个请求没意义。
 * 与那些 Tab 的显隐用的是同一个判据（isAdmin），不会出现「藏了 Tab 却还在拉数据」。
 */
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

// ===== 领料汇总 =====
const pickColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'pickDate', label: '领料时间', width: 'w-36' },
  { key: 'materialName', label: '物料名称', width: 'w-[200px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'pickQty', label: '领料数量', width: 'w-28', align: 'right' },
  { key: 'unit', label: '单位', width: 'w-24' },
  { key: 'imageUrl', label: '线下单据', width: 'w-24' },
]

const pickImageDialogVisible = ref(false)
const currentPickImage = ref('')

function openPickImageDialog(record) {
  if (!record?.imageUrl) return
  currentPickImage.value = record.imageUrl
  pickImageDialogVisible.value = true
}

/**
 * 列表图片加载失败的逐级降级（整流-001）：
 *   缩略图失败 → 回退原图 → 仍失败则隐藏，露出底层占位图标
 */
function handleImgError(event, record) {
  const el = event.target

  if (record?.imageUrl && el.dataset.thumbFallback !== '1') {
    el.dataset.thumbFallback = '1'
    el.src = record.imageUrl
    return
  }

  el.style.display = 'none'
}

/**
 * 这张单子能不能点开大图 —— 判据与弹窗函数里那道守卫完全一致（只看原图 imageUrl）。
 * 能点开才把缩略图当按钮（role/tabindex/键盘都跟着它走）；点不开时它只是个占位图标，
 * 不能变成键盘上停得下来、按下去却没反应的死节点。
 */
function canOpenImage(record) {
  return Boolean(record?.imageUrl)
}

// ===== 入库汇总 =====
const inboundColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'inboundDate', label: '入库时间', width: 'w-36' },
  { key: 'materialName', label: '物料名称', width: 'w-[200px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'inboundQty', label: '入库数量', width: 'w-28', align: 'right' },
  { key: 'unit', label: '单位', width: 'w-24' },
  { key: 'imageUrl', label: '线下单据', width: 'w-24' },
]

const inboundImageDialogVisible = ref(false)
const currentInboundImage = ref('')

function openInboundImageDialog(record) {
  if (!record?.imageUrl) return
  currentInboundImage.value = record.imageUrl
  inboundImageDialogVisible.value = true
}

// 月底储罐液位记录的列配置、行 key、图据弹窗都随面板一起移到了
// components/TankLevelPanel.vue（变更-008 加行内编辑后这块变长，留在本文件不合适）

// ===== 工单核算 =====
const costingColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialName', label: '已入库产成品', width: 'w-[240px]', wrap: true },
  { key: 'materialCode', label: '产成品编码', width: 'w-36' },
  { key: 'inboundQty', label: '入库数', width: 'w-32', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-32', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-32', align: 'right', emphasis: true },
]

// ===== 原辅料核算 =====
// 暂照搬工单核算的列与计算逻辑，后续按原辅料规则单独调整（不影响工单核算）
const materialCostingColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialName', label: '已领物料名称', width: 'w-[240px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'pickQty', label: '领料数', width: 'w-32', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-32', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-32', align: 'right', emphasis: true },
]

// 物料库存列（页面按 物料编码 / 物料名称 / 规格 查物料信息；
// 名称与规格是后端联查 material_master 的结果，主数据没有则回退库存表那份）
// 工厂（列里恒为 1503）按使用方要求不展示
const stockColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialCode', label: '物料编码', width: 'w-32' },
  { key: 'materialName', label: '物料名称', width: 'w-[220px]', wrap: true },
  { key: 'spec', label: '规格', width: 'w-[160px]', wrap: true },
  { key: 'storageLocation', label: '存储地点', width: 'w-24' },
  { key: 'unit', label: '基本计量单位', width: 'w-32' },
  { key: 'stockQty', label: '非限制使用的库存', width: 'w-40', align: 'right' },
  { key: 'storageDesc', label: '存储地点描述', width: 'w-[180px]', wrap: true },
]

// ===== 周统计 =====
// 表头（固定展示项，内容暂为固定值，后续再接入实际数据）
const weeklyColumns = [
  { key: 'name', label: '名称' },
  { key: 'pickQty', label: '原料领用', align: 'right' },
  { key: 'remainingQty', label: '车间剩余', align: 'right' },
  { key: 'actualQty', label: '实际使用', align: 'right' },
  { key: 'unitConsumption', label: '单耗' },
]

// 周统计固定展示项定义（materialCode 为隐藏属性，仅用于查询，不展示）
// unitLabel 为单耗单位；unitFactor 为单耗换算系数（氯铂酸按克计，需 ×1000）；qtyFactor 为领用数量换算系数
const WEEKLY_ROW_DEFINITIONS = [
  {
    materialCode: '111001787',
    name: '三氯氢硅（kg）',
    unitLabel: '吨/吨',
    unitFactor: 1,
    qtyFactor: 1,
  },
  {
    materialCode: '111001786',
    name: '电石（kg）',
    unitLabel: '吨/吨',
    unitFactor: 1,
    qtyFactor: 1,
  },
  {
    materialCode: '112004292',
    name: '氯铂酸（g）',
    unitLabel: '克/吨',
    unitFactor: 1000,
    qtyFactor: 20,
  },
]

// 车间剩余：手动填写（按物料编码存放），默认全部为空，不填显示 /
const weeklyRemaining = ref(
  Object.fromEntries(WEEKLY_ROW_DEFINITIONS.map((row) => [row.materialCode, ''])),
)

// 150产品（HND-V150）物料编码
const WEEKLY_INBOUND_MATERIAL_CODE = '114001897'

// ===== 周统计取数（决策-004）=====
// 改造前这两个和在本地从 allPickRecords / allInboundRecords 现算，
// 而那两条明细接口现在只给 admin 了 —— 周统计对所有人可见，
// 所以改走 /api/stats/weekly：它只回汇总数，不回明细。
//
// ⚠️ 求和口径（闭区间、日期为空的记录照样计入）与改造前**完全一致**，
// 服务端实现见 WeeklyStatsServiceImpl；这里的 .join(',') 把要汇总的物料编码传上去，
// 后端不硬编码业务常量（那几个编码本来就定义在这一段）。
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
    const unitConsumption =
      inboundQty > 0 ? ((actualQty * (row.unitFactor ?? 1)) / inboundQty).toFixed(2) : '0.00'

    return {
      ...row,
      pickQty,
      actualQty,
      unitConsumption,
    }
  })
})

// 标题：按所选日期范围生成，如「9月7日-9月13日周统计（截止9月13日晚8点）」
const weeklyTitle = computed(() => {
  const start = formatMonthDay(weeklyStartDate.value)
  const end = formatMonthDay(weeklyEndDate.value)
  return `${start}-${end}周统计（截止${end}晚8点）`
})
// ===== 储罐体积计算 =====
// 容器清单来自**设备台账**（`GET /api/equipment/vessels`，变更-025）—— 以前是写死在这里的
// 一个数组，每加一种规格都要改代码 + 出底图 + 重新发版。
// 现在几何、底图、介质密度都在库里，这里只剩「取数 + 兜底 + 选中项」。
//
// 展示层（配色、备注文案、显示宽度、文件名→URL 映射）在 composables/useVesselList.js，
// 体积公式在 utils/vesselVolume.js —— 三处各管各的。
//
// ⚠️ 底图坐标（imageBounds）的口径是**原图像素**：`width/height` 是底图原图尺寸，
//    其余数字用同一把尺子。绘制时是 `s = IMAGE_W / bounds.width`，
//    所以「按宽度归一化（width=1、height=长宽比）」的旧写法也能用 —— 只要六个数字同尺。
//    库里现存的行都是像素口径（变更-081 已把实体/VO 上写错的"按宽度归一化"改对，
//    这处注释 2026-10-16 一并改对）。
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

// 这个页面是**纯前端计算**（公式在本地），台账取不到时会退到本地缓存，见 useVesselList
onMounted(loadVessels)

// 每次**进「压力容器体积计算」页签**都重新取一次容器列表（变更-087）。
//
// 为什么需要：这个列表原先只在整页挂载时取一次，而「设备数据维护」与「体积计算」是同页
// 两个 v-show 页签（不共享状态）。于是使用方 2026-10-16 遇到的现象是：
// 在维护页刚把一台容器标定好并启用，切回计算页 —— **下拉里还是旧的 4 台**，
// 必须整页刷新才看得到。按"进入页签"重取，比在两端之间做跨页通知简单得多，也够用。
//
// ⚠️ 必须写在 onMounted 之后：watch 用 immediate 时会在 setup 期间立刻执行，
// 那时 loadVessels 还没解构出来（TDZ）—— 同一个坑本文件上方已经吃过一次（见 activeTab 的注释）。
watch(activeTab, (key) => {
  if (key === 'vessel') loadVessels()
})

// 当前选中的容器。**可能是 null**：清单异步来，且台账取不到时会退到缓存/空。
// 下游一律走 vesselGeometry，由它在没有选中项时返回一份「空白几何」，避免整页崩掉。
const selectedVessel = computed(() => {
  const list = vessels.value
  if (!list.length) return null
  return list.find((item) => item.key === vesselKey.value) ?? list[0]
})

// 没有选中项时用这份**空白几何**兜住：vesselCapacity / vesselDescription / renderVessel
// 等全都读它，给 null 会一路崩到模板。形状保证「画不出东西但不炸、也不产生 NaN」
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
    // 直边（那 40mm）是等径圆筒段，并入筒体高度 —— 体积与液位映射都按合并后的算
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
    // 容积计算读它，没配 bundle 的两台罐拿到 null（行为与改造前一致）
    bundle: vessel.bundle ? new UTubeBundle({ ...vessel.bundle }) : null,
  }
})

// 起始液位 / 终止液位：两个独立液位，用于对比与体积差计算
const vesselStartLevel = ref(1400)
const vesselEndLevel = ref(1400)
const vesselStartDisplay = ref(1400) // 动画中的起始液位
const vesselEndDisplay = ref(1400) // 动画中的终止液位
const vesselCanvas = ref(null)
const vesselImage = ref(null)
const vesselSwitching = ref(false) // 切换储罐时淡出/淡入

// 立式罐：图形与信息区并排布局（横卧罐图形较宽，保持上下堆叠）
const isVerticalVessel = computed(() => vesselGeometry.value.type === 'vertical')

// 画布尺寸：底图宽度 + 右侧引线标注栏
const VESSEL_CANVAS_WIDTH = 1075

/**
 * 画布的高度上限（变更-089）。
 *
 * ⚠️ 为什么必须有这一条：画布原先写的是 `w-full` + `maxWidth` + `aspectRatio` ——
 * **宽度一被拉满，高度就只能由长宽比推出来**，没人管它多高。立式罐（3600×4800）于是得到
 * 680 / 0.75 ≈ **907px** 高，把整页顶出滚动条（使用方 2026-10-16 圈着右边那条滑块问的
 * 就是它：「这个页面也出现了滑块，是因为图片太大了」）。
 *
 * 通用写法（图/画布同理，规则见 DESIGN.md §7）：**不许用宽度定高度**，改成
 * `h-auto w-auto max-w-full` + `max-width` + `max-height` —— 浏览器会在这两个上限里
 * 自动取"保持长宽比的最大一档"，元素矩形永远等于实际绘制区。
 * 这里用 `calc(100vh - 21rem)` 把上限挂到视口上：剩下的 21rem 留给页签头、信息行、
 * 液位读数与底部公式，所以立式罐再高也只占屏幕内、不会撑出页面滚动条。
 * 卧式罐（宽扁）不受影响 —— 它的高度本来就够小，`maxWidth` 先起作用。
 *
 * 变更-090 又把这笔预算收紧到 **20rem**：介质/几何那段说明搬进右栏后，顶部那行的高度
 * 由选择器决定（≈36px）而不是文字（两行 ≈34px），`py` 也从 16px 收到 8px ⇒
 * 实际腾出约 **1rem** —— 常量就跟着减 1rem（诚实对账：减多了会反而溢出，
 * 反倒把页面滚动条又请回来）。
 * ⚠️ 这是本页**唯一的高度调节旋钮**：觉得图偏小就把 rem 调小，觉得页面还滚就调大。
 */
const CANVAS_MAX_HEIGHT = 'calc(100vh - 20rem)'
const VESSEL_LABEL_COLUMN = 300

// 画布宽高比（用于 CSS 平滑过渡罐型切换时的高度变化）
const vesselCanvasAspect = computed(() => {
  const bounds = vesselGeometry.value.imageBounds
  const height = Math.round((VESSEL_CANVAS_WIDTH * bounds.height) / bounds.width)
  return (VESSEL_CANVAS_WIDTH + VESSEL_LABEL_COLUMN) / height
})

// 液体体积（mm³）：壳体液位体积 − 液面以下换热管所占体积。
// 两项的实现都在 utils/vesselVolume.js（与小程序仓共用同一份内容），这里只做调用：
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

// 规格说明（随所选储罐变化）
const vesselDescription = computed(() => {
  const g = vesselGeometry.value
  // 说明性字段（图纸口径的筒体高与直边、管束根数、铭牌容积）读原始配置：
  // 几何实例上只留计算用到的量 —— 直边在几何里已并进筒体高，显示时得拆回来
  // `?? {}` 兜住「清单还没到」的瞬间（此时各项都取不到，描述会退化成只写几何算得出的部分）
  const raw = selectedVessel.value ?? {}
  const m = (value) => (value / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  const capacity = vesselCapacity.value.toFixed(1)

  const medium =
    g.medium && g.density ? `介质 ${g.medium}（ρ=${g.density} g/cm³，20°C、101.325 kPa）｜` : ''

  if (g.type === 'vertical') {
    const flange = (raw.straightFlange ?? 0) > 0 ? `直边 ${m(raw.straightFlange)}m，` : ''
    // 上下都有封头时两条分开写，免得「封头内高度 0.55m」被当成罐底也是封头
    const heads =
      (g.bottomHeadDepth ?? 0) > 0
        ? `上封头内高度 ${m(g.headDepth)}m，下封头内高度 ${m(g.bottomHeadDepth)}m`
        : `封头内高度 ${m(g.headDepth)}m`
    return `${medium}筒体 φ${m(g.diameter)}m，筒体高度 ${m(raw.cylinderHeight ?? g.cylinderHeight)}m，${flange}${heads}，总容积 ${capacity} m³`
  }

  // 直边为 0 时不写这一项，免得出现「直边 0m」
  const flange = g.straightFlange > 0 ? `直边 ${m(g.straightFlange)}m，` : ''

  // 带管束的罐（再沸器）：capacity 是**扣掉管束后的净值**，必须写明，
  // 否则会被当成毛容积用。管束与铭牌的说明性字段读原始配置（实例上只留计算用到的量）。
  const bundleConfig = raw.bundle
  const bundle =
    bundleConfig && g.bundle
      ? `；罐内 U 型管束 ${bundleConfig.tubeCount} 根 ${bundleConfig.tubeSpec}` +
        `（罐内 ${m(bundleConfig.tubeLengthMm)}m/根），全浸没挤占 ${(g.bundle.totalVolumeMm3 / 1e9).toFixed(4)} m³` +
        ` —— 上述体积与总容积均已扣除管束`
      : ''
  // 数据表的铭牌全容积。只作对照、不参与计算 —— 它与按几何算出的总容积对不上，
  // 所以必须带上「数据表值」这半句，否则会被当成程序算错了
  const nameplate = raw.nameplateVolume
    ? `；铭牌全容积 ${raw.nameplateVolume} m³（数据表值，仅作对照、不参与计算）`
    : ''

  return `筒体 l=${m(g.cylinderLength)}m，φ${m(g.diameter)}m，${flange}封头内高度 hi=${m(g.headDepth)}m，总容积 ${capacity} m³${nameplate}${bundle}`
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
    ((2 / 3) * Math.PI * r * r * head + Math.PI * r * r * (g.straightFlange ?? 0)) / 1e9
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

// 水波纹参数
const VESSEL_WAVE = {
  amplitude: 3.5, // 波幅（画布像素）
  wavelength: 120, // 波长（画布像素）
  speed: 0.04, // 相位推进速度（弧度 / 60fps 帧），约 2.6 秒一个周期
}

let vesselFrameId = null
let vesselWavePhase = 0
let vesselLastFrameTime = 0
let vesselTransitions = { start: null, end: null } // 起始/终止液位的缓动过渡状态

function stopVesselLoop() {
  if (vesselFrameId !== null) {
    cancelAnimationFrame(vesselFrameId)
    vesselFrameId = null
  }
  vesselLastFrameTime = 0
}

// 单帧：推进液位缓动 + 波纹相位，然后重绘
function vesselFrame(now) {
  // 按真实时间推进，避免不同刷新率下速度不一致
  const deltaMs = vesselLastFrameTime ? Math.min(50, now - vesselLastFrameTime) : 16.7
  vesselLastFrameTime = now

  for (const which of ['start', 'end']) {
    const transition = vesselTransitions[which]
    if (!transition) continue

    const progress = Math.min(1, (now - transition.startTime) / transition.duration)
    const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic：起步快、接近目标时放缓

    levelDisplayRef(which).value = transition.from + transition.delta * eased

    if (progress >= 1) {
      levelDisplayRef(which).value = transition.from + transition.delta
      vesselTransitions[which] = null
    }
  }

  vesselWavePhase += VESSEL_WAVE.speed * (deltaMs / 16.7)
  renderVessel()

  // 切到其他 Tab 时自动停帧，不浪费性能
  if (activeTab.value === 'vessel') {
    vesselFrameId = requestAnimationFrame(vesselFrame)
  } else {
    vesselFrameId = null
  }
}

function startVesselLoop() {
  if (vesselFrameId === null && activeTab.value === 'vessel') {
    vesselFrameId = requestAnimationFrame(vesselFrame)
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
    displayRef.value = target
    vesselTransitions[which] = null
    renderVessel()
    return
  }

  vesselTransitions[which] = {
    from,
    delta,
    duration: 700 + (Math.abs(delta) / vesselGeometry.value.maxLevel) * 1300,
    startTime: performance.now(),
  }

  startVesselLoop()
}

// 变更-045 定的两处墨色，变更-046 把「差值语义色」也收拢成常量：
// 起始 = 图上虚线（#1e293b = slate-800，与图例 border-slate-800 同一只墨）；
// 差值一对墨 = 消耗玫红 / 增加翡翠 —— 画布剖面线 + 引线标注 + 滑块钮间色带三处共用。
const VESSEL_START_INK = '#1e293b'
const VESSEL_DELTA_COLOR = { consume: '#e11d48', increase: '#059669' }

/**
 * 语义色的**低透明度版**（差值带的底色）—— 由上面那一对**派生**，不再各写一份字面量。
 *
 * x-minimalist（变更-058）收敛的：原先是 rose-500 / emerald-500 的手写 rgba，
 * 与线用的 rose-600 / emerald-600 **不是同一只色** —— 于是"带"与"线"是两家人，
 * 只是肉眼看着差不多才一直没露馅。派生之后两者必然同色相，spec 也钉得住这条关系。
 *
 * 两档 α 的差别是**观察强度**不是笔误：消耗（玫红）比增加（翡翠）更刺眼，
 * 所以同样铺一层时它给得更少（0.10 vs 0.12），两种带的"分量感"才相当。
 */
const withAlpha = (hex, alpha) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
const VESSEL_DELTA_FILL = {
  consume: withAlpha(VESSEL_DELTA_COLOR.consume, 0.1),
  increase: withAlpha(VESSEL_DELTA_COLOR.increase, 0.12),
}

/**
 * 画布里的字族必须与 `src/style.css` 的 `:root` **同源**（同一份墨、同一套字）。
 *
 * x-minimalist 把全站字体栈从 Inter 换成系统人文无衬线时，画布这里漏了 ——
 * 后果是图上的数字与页面上同一串数字落在两套字形里（`tabular-nums` 还在，
 * 但字形不同）。spec 有一条跨文件断言钉着两者同源。
 */
const VESSEL_CANVAS_FONT =
  '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

// 底图：卧式椭圆封头储罐图纸
// 罐体在底图中的像素边界（由图像分析 + 轮廓叠加验证得出，横纵比例尺一致：0.28567 px/mm）

// 绘制罐体底图与液位填充
function renderVessel() {
  const canvas = vesselCanvas.value
  if (!canvas) return

  const image = vesselImage.value
  if (!image) return

  const geometry = vesselGeometry.value
  const bounds = geometry.imageBounds
  const dpr = window.devicePixelRatio || 1

  // 画布尺寸按底图比例自适应
  const IMAGE_W = VESSEL_CANVAS_WIDTH
  const LABEL_COLUMN = VESSEL_LABEL_COLUMN
  const W = IMAGE_W + LABEL_COLUMN
  const H = Math.round((IMAGE_W * bounds.height) / bounds.width)

  canvas.width = W * dpr
  canvas.height = H * dpr

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(image, 0, 0, IMAGE_W, H)

  const s = IMAGE_W / bounds.width
  const vesselPath = new Path2D()
  let tankLeft
  let tankRight
  let bottomY
  let levelToY

  if (geometry.type === 'vertical') {
    // 立式罐：顶部半椭球封头 + 等径筒体（+ 可选的底部半椭球封头）
    const left = bounds.left * s
    const right = bounds.right * s
    const tangentY = bounds.tangent * s
    const bottom = bounds.bottom * s
    const cx = (left + right) / 2
    const rx = (right - left) / 2
    const ry = tangentY - bounds.top * s
    const apexY = bounds.top * s
    // 下封头：150 产品储罐是平底（没有 tangentBottom），此时 tangentBottomY 就是 bottom，
    // 下面走 else 分支画平底，与改造前完全一致
    const hasBottomHead = geometry.bottomHeadDepth > 0 && bounds.tangentBottom !== undefined
    const tangentBottomY = hasBottomHead ? bounds.tangentBottom * s : bottom
    const ryBottom = bottom - tangentBottomY

    vesselPath.moveTo(left, tangentY)
    vesselPath.ellipse(cx, tangentY, rx, ry, 0, Math.PI, Math.PI * 2)
    vesselPath.lineTo(right, tangentBottomY)
    if (hasBottomHead) {
      // 由右下角沿椭圆逆时针扫到左下角，画出下半个椭球
      vesselPath.ellipse(cx, tangentBottomY, rx, ryBottom, 0, 0, Math.PI)
    } else {
      vesselPath.lineTo(left, bottom)
    }
    vesselPath.closePath()

    tankLeft = left
    tankRight = right
    bottomY = bottom

    // 液位映射：下封头段 / 筒体段 / 上封头段分别对应底图中各自的高度
    // （底图封头绘制得比实际略扁，分段映射可保证液面始终贴合图纸结构）
    const bottomHead = hasBottomHead ? geometry.bottomHeadDepth : 0
    levelToY = (level) => {
      if (bottomHead > 0 && level <= bottomHead) {
        return bottom - (level / bottomHead) * ryBottom
      }
      const shellLevel = level - bottomHead
      if (shellLevel <= geometry.cylinderHeight) {
        return tangentBottomY - (shellLevel / geometry.cylinderHeight) * (tangentBottomY - tangentY)
      }
      const t = Math.min(geometry.headDepth, shellLevel - geometry.cylinderHeight)
      return tangentY - (t / geometry.headDepth) * (tangentY - apexY)
    }
  } else {
    // 卧式罐：椭圆封头曲面 + 直边 + 圆筒
    const R = ((bounds.bottom - bounds.top) / 2) * s
    const cy = ((bounds.top + bounds.bottom) / 2) * s
    const hiPx = (geometry.headDepth / geometry.diameter) * 2 * R // 曲面深度
    const flangePx = (geometry.straightFlange / geometry.diameter) * 2 * R // 直边
    const xEllipseLeft = bounds.left * s + hiPx
    const xEllipseRight = bounds.right * s - hiPx
    const xCylLeft = xEllipseLeft + flangePx
    const bottom = bounds.bottom * s

    vesselPath.moveTo(xCylLeft, cy - R)
    vesselPath.lineTo(xEllipseRight, cy - R)
    vesselPath.ellipse(xEllipseRight, cy, hiPx, R, 0, -Math.PI / 2, Math.PI / 2)
    vesselPath.lineTo(xEllipseLeft, cy + R)
    vesselPath.ellipse(xEllipseLeft, cy, hiPx, R, 0, Math.PI / 2, Math.PI * 1.5)
    vesselPath.closePath()

    tankLeft = bounds.left * s
    tankRight = bounds.right * s
    bottomY = bottom
    levelToY = (level) => bottom - (level / geometry.diameter) * 2 * R
  }

  const levelY = levelToY(vesselEndDisplay.value)
  const startLevelY = levelToY(vesselStartDisplay.value)

  // 液位绘制：终止液位（实线 + 填充）与起始液位（黑色粗虚线），均为波浪形
  if (vesselEndDisplay.value > 0 || vesselStartDisplay.value > 0) {
    const span = tankRight - tankLeft
    const steps = 140

    // 生成指定基准高度上的波浪路径点（与液面同一波形、同相位）
    const buildWave = (baseY) => {
      const points = []
      for (let i = 0; i <= steps; i += 1) {
        const x = tankLeft + (span * i) / steps
        const phase = ((x - tankLeft) / VESSEL_WAVE.wavelength) * Math.PI * 2 + vesselWavePhase
        points.push([x, baseY + Math.sin(phase) * VESSEL_WAVE.amplitude])
      }
      return points
    }

    const toPath = (points, closeToBottom) => {
      const path = new Path2D()
      points.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)))
      if (closeToBottom) {
        path.lineTo(tankRight, bottomY + 6)
        path.lineTo(tankLeft, bottomY + 6)
        path.closePath()
      }
      return path
    }

    ctx.save()
    ctx.clip(vesselPath)
    ctx.lineJoin = 'round'

    // 终止液位：填充 + 实线液面
    if (vesselEndDisplay.value > 0) {
      const wavePoints = buildWave(levelY)
      ctx.fillStyle = geometry.liquid.fill
      ctx.fill(toPath(wavePoints, true))

      ctx.strokeStyle = geometry.liquid.line
      ctx.lineWidth = 2
      ctx.stroke(toPath(wavePoints, false))
    }

    // 起止液位之间的差值区：斜线剖面填充，直观展示消耗量/增加量
    const levelDelta = vesselStartDisplay.value - vesselEndDisplay.value

    if (Math.abs(levelDelta) > 1) {
      const isDecrease = levelDelta > 0 // 终止低于起始 → 消耗
      const upperY = Math.min(startLevelY, levelY)
      const lowerY = Math.max(startLevelY, levelY)

      // 差值带：上边界波浪 + 下边界波浪（同相位，等厚）
      const upperWave = buildWave(upperY)
      const lowerWave = buildWave(lowerY)
      const bandPath = new Path2D()
      upperWave.forEach(([x, y], i) => (i === 0 ? bandPath.moveTo(x, y) : bandPath.lineTo(x, y)))
      for (let i = lowerWave.length - 1; i >= 0; i -= 1) {
        bandPath.lineTo(lowerWave[i][0], lowerWave[i][1])
      }
      bandPath.closePath()

      ctx.save()
      ctx.clip(bandPath)

      const bandTop = upperY - VESSEL_WAVE.amplitude - 4
      const bandHeight = lowerY - upperY + VESSEL_WAVE.amplitude * 2 + 8
      const bandWidth = tankRight - tankLeft

      // 底色 = 同一只语义色的低透明度版（派生关系见 VESSEL_DELTA_FILL）
      ctx.fillStyle = isDecrease ? VESSEL_DELTA_FILL.consume : VESSEL_DELTA_FILL.increase
      ctx.fillRect(tankLeft, bandTop, bandWidth, bandHeight)

      // 斜线剖面线
      ctx.globalAlpha = 0.4
      ctx.strokeStyle = isDecrease ? VESSEL_DELTA_COLOR.consume : VESSEL_DELTA_COLOR.increase
      ctx.lineWidth = 1.4
      ctx.beginPath()
      for (let offset = -bandHeight; offset < bandWidth; offset += 11) {
        ctx.moveTo(tankLeft + offset, bandTop + bandHeight)
        ctx.lineTo(tankLeft + offset + bandHeight, bandTop)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.restore()
    }

    // 起始液位：黑色偏粗波浪虚线，用于对比起止液位
    if (vesselStartDisplay.value > 0) {
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 3
      ctx.setLineDash([9, 6])
      ctx.stroke(toPath(buildWave(startLevelY), false))
      ctx.setLineDash([])
    }

    ctx.restore()

    // 差值区引线标注（绘制在裁剪区之外）
    if (Math.abs(levelDelta) > 1) {
      const isDecrease = levelDelta > 0
      const color = isDecrease ? VESSEL_DELTA_COLOR.consume : VESSEL_DELTA_COLOR.increase

      // 画布会被 CSS 缩放显示，字号按缩放比例反向补偿，保证屏幕上大小恒定
      const displayWidth = canvas.clientWidth || IMAGE_W
      const uiScale = Math.min(4, W / displayWidth)
      const fs = 13 * uiScale

      const sign = isDecrease ? '−' : '+'
      const lines = [
        `${isDecrease ? '消耗' : '增加'} ${Math.abs(levelDelta).toFixed(0)} mm`,
        `${sign}${Math.abs(vesselVolumeDelta.value).toFixed(2)} m³`,
      ]

      // 配置了密度时，追加质量变化
      const massDelta = vesselMassDelta.value
      if (massDelta !== null) {
        lines.push(`${sign}${Math.abs(massDelta).toFixed(2)} t`)
      }

      ctx.font = `600 ${fs}px ${VESSEL_CANVAS_FONT}`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'

      const textRight = W - fs * 0.7
      const textWidth = Math.max(...lines.map((text) => ctx.measureText(text).width))
      const textLeft = textRight - textWidth

      const anchorX = tankRight - 30
      const anchorY = (Math.min(startLevelY, levelY) + Math.max(startLevelY, levelY)) / 2
      const labelY = Math.max(fs * 1.9, Math.min(H - fs * 1.9, anchorY - fs * 3.2))

      // 引线：罐体 → 水平出线 → 折角指向文字
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(1.2, fs * 0.12)
      ctx.beginPath()
      ctx.moveTo(anchorX, anchorY)
      ctx.lineTo(textLeft - fs * 1.5, anchorY)
      ctx.lineTo(textLeft - fs * 0.45, labelY)
      ctx.stroke()

      // 起点圆点
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(anchorX, anchorY, fs * 0.26, 0, Math.PI * 2)
      ctx.fill()

      // 文字：整体相对 labelY 垂直居中
      const lineGap = fs * 1.25
      const startOffset = -((lines.length - 1) / 2) * lineGap
      lines.forEach((text, i) => {
        ctx.fillText(text, textRight, labelY + startOffset + i * lineGap)
      })
    }
  }
}

// 滑块调节液位（变更-045）：拖动/点击要的是**跟手** —— 直接落到目标值，不走缓动。
// 缓动（animateVesselTo，700~2000ms）留给键入、罐型切换这类「变化事件」的表演；
// 拖动若走缓动，液面会一直拖着一条明显的尾巴，滑块就没法用来扫值了。
// 清掉进行中的补间后，watcher 随后跑的那次会因 delta≈0 走进 animateVesselTo 的落位分支。
function setVesselLevelImmediate(which, value) {
  const clamped = Math.max(0, Math.min(vesselGeometry.value.maxLevel, Number(value) || 0))
  levelTargetRef(which).value = clamped
  vesselTransitions[which] = null
  levelDisplayRef(which).value = clamped
  renderVessel()
}

// 滑块工具提示：值 + 单位（液位一律 mm）
const formatVesselLevelTooltip = (value) => `${Math.round(value)} mm`

// ── 变更-046：一根竖轨两个钮（EP vertical + range）────────────────────────────
// 起始 / 终止是两个独立值、允许倒挂（倒挂即为「消耗」），而 range 模式两钮**不许交叉**：
// EP 把下钮的 max 钉在上钮、上钮的 min 钉在下钮。于是轨道收的是**排好序**的一对 [低, 高]；
// 「哪个钮是起始」由 startIsLower 映射。倒挂态想再往交叉方向拉 —— 走数字框键入（watcher 照常缓动）。
const startIsLower = computed(() => vesselStartLevel.value <= vesselEndLevel.value)

const vesselLevelPair = computed(() =>
  startIsLower.value
    ? [vesselStartLevel.value, vesselEndLevel.value]
    : [vesselEndLevel.value, vesselStartLevel.value],
)

// 下钮 / 上钮的可访问名跟着映射走（倒挂时下钮是终止）
const vesselLevelRangeLabels = computed(() =>
  startIsLower.value ? ['起始液位滑块', '终止液位滑块'] : ['终止液位滑块', '起始液位滑块'],
)

// 钮环 = 该钮代表的读数在图上那根线的墨色；钮间色带 = 差值语义色，与画布剖面线同一对值
const vesselLevelSliderStyle = computed(() => ({
  '--el-slider-main-bg-color':
    vesselVolumeDelta.value >= 0 ? VESSEL_DELTA_COLOR.increase : VESSEL_DELTA_COLOR.consume,
  '--v-thumb-lower': startIsLower.value ? VESSEL_START_INK : vesselGeometry.value.liquid.line,
  '--v-thumb-upper': startIsLower.value ? vesselGeometry.value.liquid.line : VESSEL_START_INK,
}))

// ── 变更-048：读数引线标注（挂在钮上）────────────────────────────────────────
// 两根读数柱退役，读数改挂到**钮**上。钮心位置是算出来的，不是量的：
// EP 竖版把钮座的 bottom 写成「值的百分比」（bottom: p% + translateY(50%) ⇒
// 钮心恰好落在读数刻度上），所以以定高柱顶为原点，钮心 y = 柱高 − 值/量程 × 柱高。
// 三个数（柱高 260 / 轨宽 42 = 16 + 10 + 16 / 标注栏左缘 76）与模板和 CSS 里
// 那几处字面量是同一只数，改一处必须三处一起改。
const VESSEL_RAIL_HEIGHT = 260
const VESSEL_RAIL_KNOB_X = 21 // 轨心：16（EP 竖版 runway 的左右 margin） + 10 / 2
const VESSEL_CALLOUT_LEFT = 76 // 与 .vessel-level-callout 的 left 同一只数
// 两个标注的下限间距 = 标注两行的高度 + 余量：两个钮靠得再近，标注也不叠
const VESSEL_CALLOUT_GAP = 52

function vesselKnobY(level) {
  const maxLevel = vesselGeometry.value.maxLevel || 1
  const ratio = Math.max(0, Math.min(1, level / maxLevel))
  return VESSEL_RAIL_HEIGHT * (1 - ratio)
}

// 标注的 top：先钉在自己的钮心上；两个靠得太近时向两边让开（只在柱内挪，柱外不许）——
// 让位只动标注，引线的折角负责把「标注挪了位」画回来。等值（两钮叠一起）时
// start <= end 成立，自然拆成「起始在上、终止在下」。
const vesselCalloutTops = computed(() => {
  const half = VESSEL_CALLOUT_GAP / 2
  const pad = 25 // 标注半高 + 1：柱口之内留得下整个标注
  const clampTop = (value) => Math.max(pad, Math.min(VESSEL_RAIL_HEIGHT - pad, value))
  const start = clampTop(vesselKnobY(vesselStartLevel.value))
  const end = clampTop(vesselKnobY(vesselEndLevel.value))

  if (Math.abs(start - end) < VESSEL_CALLOUT_GAP) {
    const upper = Math.max(
      pad,
      Math.min((start + end) / 2 - half, VESSEL_RAIL_HEIGHT - pad - VESSEL_CALLOUT_GAP),
    )
    return start <= end ? [upper, upper + VESSEL_CALLOUT_GAP] : [upper + VESSEL_CALLOUT_GAP, upper]
  }
  return [start, end]
})

// 引线（折线 + 起点圆点），坐标系与定高柱一致：圆点钉在钮心，横出到标注栏前，
// 折角指到标注的垂直中心 —— 与画布差值标注同一套语言（圆点 → 横出 → 折角）
const vesselLeaders = computed(() => {
  const [startTop, endTop] = vesselCalloutTops.value
  const leader = (level, top, color) => {
    const y = Math.round(vesselKnobY(level) * 10) / 10
    return {
      color,
      x: VESSEL_RAIL_KNOB_X,
      y,
      points: `${VESSEL_RAIL_KNOB_X},${y} ${VESSEL_CALLOUT_LEFT - 18},${y} ${VESSEL_CALLOUT_LEFT - 5},${top}`,
    }
  }
  return {
    start: leader(vesselStartLevel.value, startTop, VESSEL_START_INK),
    end: leader(vesselEndLevel.value, endTop, vesselGeometry.value.liquid.line),
  }
})

// 标注的 top 走内联 style（值驱动）；--v-callout-ink 把该读数的墨带进标注内部 ——
// 数字框的下划线用它（起始虚线 / 终止实线，与画布那两根线、钮环三处同相）
const vesselStartCalloutStyle = computed(() => ({
  top: `${vesselCalloutTops.value[0]}px`,
  '--v-callout-ink': VESSEL_START_INK,
}))
const vesselEndCalloutStyle = computed(() => ({
  top: `${vesselCalloutTops.value[1]}px`,
  '--v-callout-ink': vesselGeometry.value.liquid.line,
}))

function setVesselLevelPair([lower, upper]) {
  // 方向快照就在 if 处一次取定：两次 setVesselLevelImmediate 之间 refs 会变，
  // 若中途重判 startIsLower，会把两钮的值对调。
  if (startIsLower.value) {
    setVesselLevelImmediate('start', lower)
    setVesselLevelImmediate('end', upper)
  } else {
    setVesselLevelImmediate('end', lower)
    setVesselLevelImmediate('start', upper)
  }
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

// 切换储罐：液位按新罐径钳制、底图按需重载
let loadedVesselImageUrl = ''

function loadVesselImage() {
  // 清单还没到（或台账取不到）时没有底图可加载 —— 直接返回，等清单到位后会再调一次
  const url = selectedVessel.value?.image
  if (!url) return
  if (loadedVesselImageUrl === url && vesselImage.value) {
    renderVessel()
    return
  }

  loadedVesselImageUrl = url
  const image = new Image()
  image.onload = () => {
    vesselImage.value = image
    renderVessel()
    // 等淡出动画基本结束再淡入，避免闪烁
    window.setTimeout(() => {
      vesselSwitching.value = false
    }, 330)
  }
  image.src = url
}

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

  loadVesselImage()
})

onMounted(() => {
  fetchAdminOnlyData()
  fetchStockRecords()
  // 罐体底图（约 645 KB）改为切到压力容器 Tab 时按需加载，不拖慢首屏
})

onUnmounted(() => {
  stopVesselLoop()
})

// 切到压力容器 Tab 时按需加载底图 + 启动波纹动画，离开时停帧
watch(activeTab, (tab) => {
  if (tab === 'vessel') {
    loadVesselImage()
    startVesselLoop()
  } else {
    stopVesselLoop()
  }

  // 月底储罐液位记录：首次进入 Tab 才请求（按月的台账，没必要拖慢首屏）
  if (tab === 'tankLevel') {
    ensureTankLevelLoaded()
  }

  // 周统计：进 Tab 时取一次汇总数（日期没变就不必重复请求）
  if (tab === 'weekly') {
    fetchWeeklyStats()
  }

  // 三个聚合页：进 Tab 时重取自己的汇总数据。
  // 它们的行来自明细（入库 / 领料 / 工单 / 货物移动），而那几份明细随时可能被
  // 另一端（手机端、图片解析）改动 —— 进页面就实查一次，省得又出现「数据明明有、这一页看不到」。
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
  // 原先它既不发通知、这里也不认它，于是「图片解析入库 → 切到领料汇总看不到新记录」。
  // 只要 dirty 就重拉，谁写的都算。
  if (importDirty.value) {
    importDirty.value = false
    refreshAllData()
  }
})
</script>

<template>
  <!--
  ⚠️ **读这一页的模板注释之前，先看这一条**（x-minimalist，2026-10-15）

  本文件有大段注释在描述 036~043 的**液态玻璃**配方：`bg-white/55`、
  `backdrop-blur` 的 32px / 30px 两档任意值、`glass-frost`/`glass-veil`、`border-white`、
  「两档玻璃」「清水档」「边缘光学」……**那些段落现在只是历史记录，不再是现状。**

  现状：三块面板已换成**不透明的面 + 1px 发丝线**（侧栏 `bg-veil`、导航条与主区栏
  `bg-raised`，都配 `border-line` = #EAEAEA），全站**零** `backdrop-*`；
  卡片配方是 `bg-raised` + `border-line`（原 `/95` + `border-white/60` + `blur-xl` 退役）；
  纸是 `bg-canvas`（纯白）+ `.minimal-field` 的一道 α=0.035 暖径向。
  现状以 `DESIGN.md` 与 `src/minimal-field.css` 为准。变更-057 已把**以现状口吻**描述
  玻璃的段落逐处改准（纸的定高 / 侧栏选中态账 / 主区栏定高链 / 吸顶 sticky 的理由 /
  液位滑块那处漂移），剩下的「玻璃」字样基本是历史叙述（哪个变更做了什么、为什么退役）。

  `glass-scroll` 这个标记类与它背后的 `INNER_SCROLL_TABS` / `scrollsInsideCard` 推导
  已在变更-056 一并删除（时间线随玻璃退场后它们没有消费者）。「滚动到底发生在卡片内
  还是玻璃栏里」这条结构事实没有丢：四个页签的卡片是 `h-full flex-col`、表格区是
  `min-h-0 flex-1 overflow-y-auto`，由模板本身表达，spec §15 的定高链断言钉着。
  -->
  <el-config-provider :locale="zhCn">
    <!--
      页面底色 = **浅桌面灰 `desk`**（变更-043）。037 立的那条规矩没变、只换了颜色：
      底与卡是两回事，只差一层嵌套却是两种读法 —— 底变暖是「整屏泛黄」，卡是
      「有一张纸，东西都放在纸上」（第一版做错成了前者）。043 把最外圈从深夜蓝
      翻到浅灰：它只在纸的四边露出那 16px，出的是「桌面」—— 场要比它**更亮**
      才浮得起来；041 的蓝「夜」语义（深同伴衬托亮天穹）在这里反过来用。

      卡片四边留 16px，与侧栏浮动面板同一个数 —— 同一种留白不出现两个值。
      **高度写死 100vh − 上下各 16px（main 的 p-4），不是 min-h**（使用方 2026-10-07
      圈着主区要「固定大小」时改的）。原来写的是 min-h，短内容完全看不出区别 ——
      但**下限不是高度**：内容一长纸就跟着长，里面那几级 flex 分配全部落空
      （实测：主区栏 619 → 3157 → 3381px，整页多出一条滚动条）。
      定高之后纸正好是一整屏，页面自己不再滚动，滚动都在两块面板内部
      —— 这也是侧栏 `100vh − 4rem` 那个数终于「算得准」的前提。
      内层的东西（侧栏面板、各页卡片）层级不变，只是这张纸在 **x-minimalist** 上是
      **纯白纸 + 一道 α=0.035 的暖径向**（`.minimal-field`，配方与理由在
      minimal-field.css）—— 036~043 那套「浅灰渐变 + 两团中性光斑」是**给玻璃吸的**
      （平纸上 blur 无物可糊，这条 036 的老结论一直成立），这一代不要玻璃，于是
      问题本身换了：纸上放墨字与发丝线，就是 minimalist 要的样子。
    -->
    <main class="min-h-screen bg-desk p-4">
      <!--
      外壳**不再限宽居中**（原先这里挂的是 mx-auto max-w-[1600px]，我早先加的）。
      留着它，那块浮动面板离视口左边就是 (视口−1600)/2 + 16 —— 1664 的屏上量出来 48px，
      跟使用方要的「四边 16px」对不上；屏幕越宽偏得越多。
      主区不再被压到 1600：几个台账表格本来就宽，宽出来正好摊开列。
    -->
      <div class="minimal-field flex h-[calc(100vh-2rem)] rounded-card border border-line bg-canvas">
        <!--
        左侧栏：用户信息 + 四个大类 + 设置（2026-10-07 改成 dashboard 布局）。

        分组只是「怎么看这些页」，**不新增状态** —— 当前组由 activeTab 推导（见 currentGroup），
        所以「登录/退出后自动切页」「导入返回跳回工单汇总」这些既有逻辑一行都不用动。

        「藏掉就没法切页」这条已经不成立（2026-10-07 加收起后改）。原文是
        「窄屏不隐藏：页签从顶部挪走了，侧栏是**唯一**的页面入口」—— 当时确实如此。
        现在藏掉不等于没有导航：收起态是**图标条**，四个大类各留一个图标、点了照样切组
        （只列有可见页的组，见 sidebarGroups）。于是窄窗口下反而多了一条出路：
        主动收起把 224px 让回给表格，不必再像原先那样忍着主区被压窄。
      -->
        <!--
        整块做成**浮动面板**：四边 16px 外边距、圆角 20px、一层低透明度柔和投影（使用方 2026-10-07 定）。
        原先这里是三张各自带边框的小卡片，现在并成一块 —— 浮起来之后还分层画边框，
        会变成「面板里套卡片」的双层轮廓，反而糊。

        sticky 的落点已从 top-4 改到 **top-0**（与主区那条导航条钉在同一条线上）——
        理由与实测数据写在面板那一处注释里。四边 16px 是**静止**位置，由面板自己的
        m-4 给；吸顶位置由 top-* 给，两者互不干扰。

        面板**撑满可用高度**（使用方 2026-10-07 追加）：此前高度跟着内容走，
        aside 被 main 的 min-h-screen 撑满、面板却只有小半截，下面空出一条竖带。

        这个高度是 100vh 减掉**四层** 16px。外层那张纸（x-minimalist 起是纯白纸 +
        一道 α=0.035 暖径向；043 那代是中性柔光场，037~043 的更早几代见 DESIGN.md）
        是后加的，从两层变四层，
        数字必须跟着改 —— 否则面板比它所在的那张卡片还高出 32px：
          main 的 p-4 (16) + 面板 m-4 (16) + 面板高 + m-4 (16) + p-4 (16) = 100vh
          ⇒ 面板高 = 100vh − 64px = 100vh − 4rem
        外层卡片自己则是 100vh − 32px（= 面板高 + 面板那上下两个 16px 外边距），
        于是三层加起来正好一整屏，不会凭空空出一条页面滚动条。
        **这个数现在是写死的**（`h-[calc(100vh-2rem)]`，不再是 min-h）：纸不定高，
        上面这套算术只是「至少」，主区一有长内容就全部失效 —— 见纸那一处的注释。

        flex-col + 导航 flex-1：账号块落到面板底部（内容短时靠底对齐，不浮在半空）。
        整块再兜一层 overflow-y-auto —— 窗口特别矮或以后大类变多时，
        退化成「整面板自己滚」，而不是把内容溢出到圆角外面。

        收窄时额外压一层 overflow-x-hidden：overflow-y 一旦不是 visible，
        overflow-x 就会被算成 auto，200ms 的宽度过渡里文字来不及换行，
        会在面板底部闪出一条横向滚动条。
      -->
        <!--
        收起态 = aside 变窄（88px），不是浮层盖在内容上 —— 使用方选的「内容让位、不重叠」，
        所以面板留在 flex 流内，主区（flex-1）自动把那 136px 拿回去。

        **两个状态的 margin 都是 m-4**，这是关键：面板离卡片内缘恒 16px 是既定口径，
        而面板高度 h-[calc(100vh-4rem)] 里的 4rem 正是 main 的上下 p-4 加这上下两个 m-4 ——
        只收窄、不动 margin，那行高度才不用跟着改（动 margin 就得同步动高度，
        漏一处面板就比外层卡片高出一截，底边从卡片里冒出来）。

        收起后的可见窄条是 88 − 16×2 = 56px（与使用方定的「56px 窄条」一致）。

        **展开态从 w-56（224px）加宽到 w-72（288px）**：分组块加了 36px 图标之后，
        按钮里留给文字那一列只剩 92px（实测），而最长的提示「工单、领料、入库与核算」
        在 text-xs 下要 132px —— 于是四条提示两条折行、两条不折，行高 74/58 交替，
        块就参差了，正是使用方说的「排版不美观」。

        这与上面品牌小字那条注释是**同一个坑**：侧栏的横向余量本来就只有几 px，
        往里塞任何东西都得先算一遍字宽，不能凭感觉。288px 下文字列是 156px，
        132px 的提示留出 24px 余量；提示行本身也加了 truncate 兜底 ——
        万一以后有人把某条提示写长了，它会省略号收尾，而不是再把行高撑成两种。
      -->
        <aside
          class="shrink-0 transition-[width] duration-200 ease-out"
          :class="collapsed ? 'w-[88px]' : 'w-72'"
        >
          <!--
          侧栏玻璃（磨砂玻璃是变更-037 建的那一层；041 深烟、043 翻浅成轻纱 —— 第三版材质）。

          病史先记着，不然下一个人看不出为什么现在做浅色：使用方 2026-10-07 圈着侧栏
          与顶部导航条指定三件事 —— **背景半透明、模糊 24 像素、边缘用亮白描边**。
          第一版只照这三个值做，上线看到的是「没效果」：75% 白压在暖白纸上还是白，
          模糊一张纯色的纸还是那张纸。使用方当场加了第四条：**玻璃带一点色调** ——
          于是有了 `glass` 色那一代。它解决了「看得见」，没解决「好看」：
          2026-10-11 使用方再看：「配色还是不好看，参考苹果系统的液体玻璃做」。
          根因不在玻璃、**在纸** —— 一张几乎纯色的纸，模糊无物可糊、saturate 无彩可提，
          玻璃再调也是灰片。

          玻璃时代的四步（036 做料 → 037 暖白纸 → 041 天穹蓝 → 043 去色留亮度）
          **整组退役**：x-minimalist 不要玻璃。侧栏现在是一块**不透明的暖骨面**
          `bg-veil`（#F7F6F3）+ `border-line`（1px #EAEAEA）+ `rounded-card`；
          与纸的分离比 **1.08**（spec 实算钉 ≥1.08）—— 靠「比纸深半档」，不靠
          填充透明度、不靠模糊、不靠投影（043 那套「低填充 + blur 32 + 边光学」
          是一个整体，拆一件都不成立，所以一起退场）。

          · **不许再出现 `backdrop-*`**：整站零 `backdrop-filter` / `backdrop-blur`
            / `backdrop-saturate`（minimalist 只给导航留了一条「subtle nav blur」
            的口子，本项目连这条也不用）—— spec 有一条全仓反扫钉着。
          · 描边是 `border-line` 而不是 `border-white`：白纸上的白边等于没有边，
            发丝线才是这一代唯一的分层手段。
          · 选中指示是 **`bg-brand` 实底**（墨色 #111111 + 纯白字 18.9:1）+ 一圈
            `ring-1 ring-white/20` 描边；041 那圈 30% 的 `shadow-glow` 光晕**已退役**
            —— 墨色实底自己撑得住，`shadow-glow` 这个 token 也删了。
          · **吸顶位置从 `top-4` 改成 `top-0`**（与主区那条导航条对齐，见那处注释）：
            sticky 的吸附基准是 **border box**，`m-4` 那 16px **不参与**吸顶 —— 实测
            滚到 900 时面板 top = 16（就是 `top-4` 的值），不是 32。所以静止态由
            `m-4` 给的 32px 不受影响，改的只是吸住之后那一条线：0，和导航条同一条。

          ⚠️ **浅纱上的文字整批翻深**（043 改动量最大的一处，漏一处就欠对比度）：
          面板底色是 #D8D9DE 压 55% 出来的浅纱，041 的白字族压它全部破线 ——
          字族换成 slate 深色四档：主标题 `text-slate-900`（压纱最坏 ~13.5）、
          正文/身份行 `text-slate-700`、弱化行（提示 / 只读浏览）`text-slate-600`
          （5.76 —— 排版分档，不是阈值压线）、图标块里的图形 slate-600。
          白**只留在两处**：选中行底 `bg-brand` 实底**里面**（白字 16.83，
          提示行转纯白也富余 —— 041 那种「只有纯白过线」的窘迫随石墨主色退役），
          以及描边 `border-white`（光学件，不承载文字）。
          **焦点环回到全站统一的 `ring-brand`**（石墨压浅纱 ~13:1）—— 041 那种
          「全站唯一一处白环」的特殊待遇随深底一起退役。
          未选中行底与图标块**翻成白色透块**：行 hover `bg-white/45`、图标块
          `bg-white/40` + slate-600 图标；选中行里图标块转 `bg-white/15` + 白图标
          （与选中胶囊同层，反白处理；白图标压石墨底 16.8，图形线富余）。
          037 那条「未选中图标块一律 `bg-raised`」如今又轮到白色透块 ——
          037 的前提（浅色面板）回来了，但取的是**半透明白**不是实白：
          纱面比当年的暖白纸更灰，透块压纱既有形体又不刺眼（spec 复算钉着）。
          （变更-034 / 036 两轮曾把登录文字与品牌小字从 emerald-700 收进 800 保对比度；
          041 / 043 换主色后那套 emerald 对比账整页作废，slate 深字账写在这一段里。）
          -->
          <div
            id="app-sidebar"
            class="sticky top-0 m-4 flex h-[calc(100vh-4rem)] flex-col overflow-x-hidden overflow-y-auto rounded-card border border-line bg-veil"
            :class="collapsed ? 'p-2' : 'p-4'"
          >
            <!--
            收起/展开按钮贴右上角（这个控件的惯例位置），**只与那句英文小字同行**，
            中文那两行单独占满整宽。

            为什么不让按钮与整个品牌块同行：当初侧栏内容宽是 160px，切出 36px 后
            那句「生产工单与物料数据查询助手」（156px）会被折成「…数据查」/「询助手」——
            把「查询」拦腰截断，是展开态（人人都看得到的那一态）最显眼的一处难看。
            只挤英文小字就没这个问题：它本来就折成两行（FACTORY / OPERATIONS）。

            （侧栏在 2026-10-07 加宽到 w-72 后，内容宽 224px，156px 的小字与 36px 按钮
            同行也放得下了 —— 但这个「按钮只与英文小字同行」的摆法**不因此改回**：
            它把按钮钉在品牌块右上角，标题那两行独享整宽，眼下没有问题要解决。）
          -->
            <div
              class="flex items-start gap-2"
              :class="collapsed ? 'justify-center' : 'justify-between'"
            >
              <p
                v-show="!collapsed"
                class="min-w-0 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
              >
                Factory Operations
              </p>
              <!--
              焦点环回到全站统一的 `ring-brand`（043）：石墨压浅纱 ~13:1，
              041 那种「全站唯一一处白环」的特殊待遇随深底一起退役 ——
              「全站一个环色」的规矩在浅纱上不再需要豁免。

              这处原先用的是 slate-500，理由是「导航项那批浅色环只有 1.67:1，
              别跟着抄」。那批环（含审计漏掉的 rose 两处、以及 slate-400 的 2.56:1）
              已在 变更-028 一并修掉，不统一的理由随之消失 —— 同一种控件两种环色只是噪音。
            -->
              <button
                type="button"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-white/45 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]"
                :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
                :aria-expanded="!collapsed"
                aria-controls="app-sidebar"
                @click="toggleSidebar"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'" />
                </svg>
              </button>
            </div>
            <p v-show="!collapsed" class="mt-1 text-lg font-bold tracking-tight text-slate-900">
              HND生产助手
            </p>
            <p v-show="!collapsed" class="mt-1 text-xs text-slate-600">
              生产工单与物料数据查询助手
            </p>

            <!-- 分区之间只用一条细分割线：面板本身已经浮起来了，
               再给每块画边框就成了「面板里套卡片」的双层轮廓，反而糊 -->
            <nav
              class="mt-4 flex-1 space-y-1.5 border-t border-brand/10 pt-4"
              aria-label="功能分类"
            >
              <!--
              收起态与展开态是**同一组按钮**，只是文字部分 v-show 掉、按钮本身
              缩成方块。不做两套（展开一套 / 收起一套）：两套就是同一个导航
              存了两位真值，容易只改一边；而且 nav[aria-label="功能分类"] button
              会一次命中两组 —— 既有用例的断言是 toContain 式的，**抓不到**这种重复，
              真正抓得到的是 tests/component 里那条把 aria-label 逐项断死的新用例。

              **因此这里只能 v-show，不能 v-if**：v-if 会把收起态的按钮整个摘掉。

              —— 每个分组是一个**看得见的块**（使用方 2026-10-07：「每个块周围带绿色光晕」）。
              原先这里只是四行左对齐的文字浮在白底上，谈不上是「块」。现在图标进了一个
              36px 的圆角方块（未选中白色透块 + slate-600 图标；选中反白 + 白图标，
              压在 brand 行底上 16.83），行才有形体 —— 面板下半部那片空白
              也因此读起来是「列表到此为止」，而不是「列表没填满」。

              未选中图标块 043 起是 **`bg-white/40` 白色透块**（041 的 `/12` 在浅纱上
              会被纱吞掉）。037 那代它在 slate-100 与纯白 `bg-raised` 之间调过两轮
              （面板沉下去把 slate-100 追上、改白又撞上使用方 2026-10-11 说的「刺眼」）——
              043 的浅纱比 037 的暖白纸更灰，白透块压纱仍读得出来，也不刺眼。
              规则一句话：「**这块料上，抬起来的一律是白色系**」—— 实白给浅底
              （卡片 /95），白透块给纱面（图标块 /40、行 hover /45）。

              选中项**只剩 `bg-brand` 实底 + `ring-1 ring-white/20` 描边**（043 删了
              `shadow-glow` 光晕 —— 石墨实底自己撑得住）。四块一样亮就分不出当前在
              哪一组，这条没变；收起态也不描边 —— 40px 见方里再套一层环，加上与按钮
              等大的图标块，会糊成一团。

              图标在展开态也留着（与收起态同一个 20px 图标，只是换了底色）：
              收起后那四个图标才学得会 —— 否则它们就是四个陌生符号。
            -->
              <el-tooltip
                v-for="group in sidebarGroups"
                :key="group.key"
                :content="group.label"
                placement="right"
                :disabled="!collapsed"
                :show-after="200"
              >
                <button
                  type="button"
                  class="rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.99]"
                  :class="[
                    collapsed
                      ? 'mx-auto flex h-10 w-10 items-center justify-center'
                      : 'flex w-full items-center gap-3 px-2.5 py-2.5 text-left',
                    !collapsed && currentGroup === group.key ? 'bg-brand ring-1 ring-white/20' : '',
                    !collapsed && currentGroup !== group.key ? 'hover:bg-white/45' : '',
                  ]"
                  :aria-label="collapsed ? group.label : undefined"
                  :aria-current="currentGroup === group.key ? 'true' : undefined"
                  @click="selectGroup(group.key)"
                >
                  <span
                    class="flex shrink-0 items-center justify-center rounded-md transition-colors"
                    :class="[
                      collapsed ? 'h-10 w-10' : 'h-9 w-9',
                      currentGroup === group.key
                        ? 'bg-white/15 text-white'
                        : 'bg-white/40 text-slate-600',
                      collapsed && currentGroup !== group.key ? 'hover:bg-white/55' : '',
                    ]"
                  >
                    <svg
                      class="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path :d="GROUP_ICON_PATHS[group.key]" />
                    </svg>
                  </span>
                  <span v-show="!collapsed" class="min-w-0">
                    <span
                      class="block text-sm"
                      :class="
                        currentGroup === group.key ? 'font-medium text-white' : 'text-slate-900'
                      "
                      >{{ group.label }}</span
                    >
                    <!-- truncate 是兜底：宽度已按最长的那条提示留足，正常情况下不会省略。
                       它防的是「以后有人把某条提示改长」—— 那时宁可省略号，也不要
                       四条里两条折行、行高变成两种。 -->
                    <!-- 提示行颜色：未选中 slate-600（压浅纱 5.76），选中态转纯白
                       （压**墨色**胶囊 18.88 —— x-minimalist 的主色是 #111111；
                       石墨那代是 16.83。041 那种「只有纯白过线」的贴线账早随蓝退役）。
                       选中行的层次由字号（14/12）与字重（medium/normal）承担。 -->
                    <span
                      class="mt-0.5 block truncate text-xs font-normal"
                      :class="currentGroup === group.key ? 'text-white' : 'text-slate-600'"
                      >{{ group.hint }}</span
                    >
                  </span>
                </button>
              </el-tooltip>
            </nav>

            <!--
            账号块放**面板最底**（使用方 2026-10-07：登录按钮放左下角）。
            原先它紧贴在标题下面 —— 那是视线的起点，却摆了个低频操作
            （一人一账号，登录/退出一天用不上一次），每次看侧栏都得先跨过它。
            挪到底部后，顶部只剩「这是什么 + 去哪儿」，也顺带把面板下缘的空档填上了。

            它上面原先还有一小块「设置 / 共 N 条工单」，使用方同日划掉了：
            条数在工单汇总的分页器上本来就报（`:total="total"`），侧栏再来一遍是重复的，
            别再往回加。
            未登录即可只读浏览；写入类功能按权限隐藏。
          -->
            <div class="mt-3 border-t border-brand/10 pt-3 text-sm">
              <!--
              2026-10-07 使用方圈出这一块说「有点丑」，重做的思路是**对齐导航行的形体**：
              上面四组都是「36px 图标块 + 文字」的整行块，这里原先却是两行裸文字
              （变更-028 重做导航时漏下了这块），于是它读起来像没做完。

              身份行**不可点**：它答的是「你是谁」（管理员 / 只读浏览），不是动作 ——
              图标块照给，只是不响应 hover。退出/登录是动作，**整行可点**：
              hover 与导航行同一条（整行 bg-white/45），图标块再转成 rose / brand 实心，
              把「这一下会发生什么」讲清楚。

              收起态**不再另做一套**：行结构不变，文字 v-show 掉、图标块 36 → 40px，
              身份行由 tooltip + role="img" 的 aria-label 报「当前登录：xx」。
              仍然**只有一个按钮**（展开的整行与收起的图标块是同一颗），
              DOM 里「退出登录」不会出现两份。
            -->
              <template v-if="loggedIn">
                <el-tooltip
                  :content="roleName"
                  placement="right"
                  :disabled="!collapsed"
                  :show-after="200"
                >
                  <div
                    class="flex items-center"
                    :class="collapsed ? 'justify-center' : 'gap-3 px-2.5 py-2.5'"
                  >
                    <span
                      class="flex shrink-0 items-center justify-center rounded-md bg-white/40 text-slate-600"
                      :class="collapsed ? 'h-10 w-10' : 'h-9 w-9'"
                      :role="collapsed ? 'img' : undefined"
                      :aria-label="collapsed ? `当前登录：${roleName}` : undefined"
                    >
                      <svg
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path
                          d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 0 1-8 0 4 4 0 0 1 8 0z"
                        />
                      </svg>
                    </span>
                    <span
                      v-show="!collapsed"
                      class="min-w-0 truncate text-sm font-medium text-slate-700"
                    >
                      {{ roleName }}
                    </span>
                  </div>
                </el-tooltip>
                <el-tooltip
                  content="退出登录"
                  placement="right"
                  :disabled="!collapsed"
                  :show-after="200"
                >
                  <button
                    type="button"
                    class="group mt-1 rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]"
                    :class="
                      collapsed
                        ? 'mx-auto flex items-center justify-center'
                        : 'flex w-full items-center gap-3 px-2.5 py-2.5 text-left hover:bg-white/45'
                    "
                    :aria-label="collapsed ? '退出登录' : undefined"
                    @click="handleLogout"
                  >
                    <span
                      class="flex shrink-0 items-center justify-center rounded-md bg-white/40 text-slate-600 transition"
                      :class="
                        collapsed
                          ? 'h-10 w-10 group-hover:bg-white/55'
                          : 'h-9 w-9 group-hover:bg-rose-600 group-hover:text-white'
                      "
                    >
                      <svg
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <path d="M16 17l5-5-5-5" />
                        <path d="M21 12H9" />
                      </svg>
                    </span>
                    <span
                      v-show="!collapsed"
                      class="text-sm text-slate-700 transition group-hover:text-rose-700"
                    >
                      退出登录
                    </span>
                  </button>
                </el-tooltip>
              </template>
              <template v-else>
                <el-tooltip
                  content="只读浏览"
                  placement="right"
                  :disabled="!collapsed"
                  :show-after="200"
                >
                  <div
                    class="flex items-center"
                    :class="collapsed ? 'justify-center' : 'gap-3 px-2.5 py-2.5'"
                  >
                    <span
                      class="flex shrink-0 items-center justify-center rounded-md bg-white/40 text-slate-600"
                      :class="collapsed ? 'h-10 w-10' : 'h-9 w-9'"
                      :role="collapsed ? 'img' : undefined"
                      :aria-label="collapsed ? '未登录，只读浏览' : undefined"
                    >
                      <svg
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path
                          d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 0 1-8 0 4 4 0 0 1 8 0z"
                        />
                      </svg>
                    </span>
                    <span v-show="!collapsed" class="min-w-0 truncate text-sm text-slate-600">
                      只读浏览
                    </span>
                  </div>
                </el-tooltip>
                <el-tooltip
                  content="登录"
                  placement="right"
                  :disabled="!collapsed"
                  :show-after="200"
                >
                  <button
                    type="button"
                    class="group mt-1 rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]"
                    :class="
                      collapsed
                        ? 'mx-auto flex items-center justify-center'
                        : 'flex w-full items-center gap-3 px-2.5 py-2.5 text-left hover:bg-white/45'
                    "
                    :aria-label="collapsed ? '登录' : undefined"
                    @click="goLogin"
                  >
                    <span
                      class="flex shrink-0 items-center justify-center rounded-md bg-brand text-white transition group-hover:bg-brand-deep"
                      :class="collapsed ? 'h-10 w-10' : 'h-9 w-9'"
                    >
                      <svg
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                        <path d="M10 17l5-5-5-5" />
                        <path d="M15 12H3" />
                      </svg>
                    </span>
                    <span v-show="!collapsed" class="text-sm font-medium text-slate-900">
                      登录
                    </span>
                  </button>
                </el-tooltip>
              </template>
            </div>
          </div>
        </aside>

        <!--
        主区**左边不留内边距**：侧栏那块浮动面板自己带 16px 外边距（m-4），
        这里再补一层就成 32px 的缝，跟「四边 16px」对不上。
        py-4 则是与面板的上下 16px 对齐。
      -->
        <!--
          主区列 = **一个定高的纵向 flex**（使用方 2026-10-07 圈着主区指定：
          「红色框选区域**固定大小**，也做成**液态玻璃栏**」）。

          为什么是 `flex flex-col` + 下一条 `flex-1 min-h-0`，而不是给那块手算一个
          `h-[calc(100vh-…)]`：**导航条的高度不是常数**（页签换行、字体回退都会变），
          把它的高度减进 calc 里，改天导航条长高两行，主区就跟着错位。
          交给 flex 分配：列高由纸（那张白纸）的**定高**给（`h-[calc(100vh-2rem)]`，与侧栏面板那个
          100vh−4rem 是同一套数），导航条占它该占的，**剩下的全归主区栏** ——
          导航条长高多少，它就自动少多少。

          ⚠️ 这套分配**只在纸是定高时才成立**，第一版这里写对了、纸那边还是 `min-h-`，
          结果整条链一起失效（实测 619 → 3157 → 3381px）。护栏钉的是**整条链**，
          见 tests/unit/visualTokens.spec.js 的「固定大小」那两条。
        -->
        <div class="flex min-w-0 flex-1 flex-col py-4 pr-4 sm:pr-6">
          <!-- 主区顶部：当前页标题 + **同组页面的页签**。
           页签从顶部横条挪到了这里（放上方而不是照示意图放底部）：切页不必先滚到最底。
           页签行沿用原来 Tab 条的横向滚动写法（见下方注释），只是把下划线换成了卡片态。

           **这一条也包一张卡片**（使用方 2026-10-07 追加）：此前标题与页签直接压在
           纸面上，而它下面的筛选/表格、左边的侧栏面板都是有底的 —— 单这一条裸着，
           就破了「东西都放在纸上」那层意思：**纸是底，抬起来的卡片才是内容**。
           **x-minimalist：三层现在是「桌面（desk 暖骨）→ 纸（canvas 纯白
           + `.minimal-field`）→ 不透明白面（这一条）」。** 043 那套「柔光场 +
           清水白玻璃」已退役（同样是三层，换的只是材质：玻璃 → 面）。

           **这一条与侧栏不同料、与主区栏同料**：`bg-raised`（纯白，不透明）
           + `border-line`（1px #EAEAEA）+ `rounded-card`。分层靠**描边与间距**，
           不靠填充透明度 —— minimalist：border replaces elevation。
           ⚠️ 它和主区栏**必须同串**（两块同料），spec 防「只调一块」。
           ⚠️ 页签里**只有选中的那个有底色**（041 起 brand 实底 + 白字；043 起
           brand 是石墨黑，白字 16.83 过 AA —— 041 时代 4.70 的贴线账退役），
           未选中的是**透明的**（使用方 2026-10-11 定）。原来是白药丸
           （`bg-white text-slate-600`）；改透明之后它们是**直接压在白玻璃上**的纯文字 +
           描边 —— 顶上那一排五个白药丸正是使用方圈出来的「很多地方都是白色的」之一，
           而且五个里四个是白的，读数上也是**只在选中项上花颜色**更省。
           未选中的文字 slate-600 压白玻璃+浅场富余（spec 复算），摘掉白底不影响可读性。

           **并且改成吸顶**（同一轮定的）。不吸顶的话它滚过去就没了，那块 30px 模糊
           底下**永远没有东西经过**，毛玻璃等于白写；吸顶之后表格从它下面滑过，
           彩色内容经过时确实看得见（实测 3× 截图：一条 amber 色带从底下过，
           卡片上半段泛黄）。

           为什么是 `top-0` 而不是看着更「贴纸面」的 `top-4`：**`top-4` 会漏**。
           主区的内容不裁剪，钉在 16px 处，上面那 16px 就空出一条缝，
           正在滚的表格行从导航条**上方**划过去（实测截图里能看见半个「再沸器 17 号」
           悬在导航上面）—— 与 `/intro` 吸顶头部踩过的是同一个坑。`top-0` 贴着视口
           最上沿，上面没有位置可漏。侧栏面板同步改成 `top-0`，两块钉在同一条线上
           （静止态两者都在 y=32 不受影响）。

           `z-30`：吸顶后要压在下面的卡片上；el-dialog / el-select 那类是挂到 body 的
           2000+，不受影响。 -->
          <div
            class="sticky top-0 z-30 mb-4 shrink-0 rounded-card border border-line bg-raised px-6 py-4"
          >
            <h2 class="mb-3 text-xl font-bold tracking-tight text-slate-900">
              {{ activeTabLabel }}
            </h2>
            <!--
          横向滚动：
          · overflow-x-auto 会让 overflow-y 也算作 auto，补 pb-px 把边兜回来；
          · 隐藏滚动条：滚动靠滚轮/触控板，一条横杠横在卡片下面反而碍眼。
        -->
            <div
              ref="tabNavRef"
              class="flex gap-2 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="页面切换"
              @wheel="handleTabWheel"
            >
              <button
                v-for="tab in groupTabs"
                :key="tab.key"
                :data-tab-key="tab.key"
                type="button"
                :aria-current="activeTab === tab.key ? 'page' : undefined"
                class="shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                :class="
                  activeTab === tab.key
                    ? 'border-brand bg-brand font-medium text-white'
                    : 'border-line text-slate-600 hover:border-slate-300 hover:text-slate-800'
                "
                @click="activeTab = tab.key"
              >
                {{ tab.label }}
              </button>
            </div>
          </div>

          <!--
          主区玻璃栏（使用方 2026-10-07：「红色框选区域固定大小，也做成液态玻璃栏」）。

          **固定大小**：`flex-1 min-h-0` —— 高度由 flex 分配（列高减导航条），
          **与里面装的是什么无关**。这正是使用方要的那句：换页签、有没有数据、
          表格多少行，这一块**始终是同一个大小**，不会这里缩一下那里撑一下。
          `min-h-0` 不能省：flex item 默认 `min-height:auto`，不写它就不肯缩到
          内容以下，「固定」立刻失效（内容长的页签会把整页顶出滚动条）。
          内容在自己的滚动条里走（`overflow-y-auto`），**页面本身不滚**。

          ⚠️ 这两条**不够**，第一版就栽在这里：`flex-1 min-h-0` 分配的是「父元素给的
          空间」，父元素自己得先有个**定高**。当时纸还是 `min-h-[calc(100vh-2rem)]`，
          于是实测三种内容下栏高 619 → 3157 → 3381px —— 内容短的时候看着完全正常，
          量了才知道没固定住。链条是四级：**纸定高 → 列 flex-col → 导航条 shrink-0
          → 栏 flex-1/min-h-0/overflow-y-auto**，缺一级整条就退化。

          **x-minimalist：与导航条同料、与侧栏分成两料** —— `bg-raised`（纯白）
          + `border-line` + `rounded-card`，与导航条**必须同串**（spec 防「只调一块」）。
          043 那版的 `glass-frost + bg-white/55 + backdrop-blur（任意值 30px）+ border-white`
          已随玻璃整组退役。里面那些卡片（各页签的 `<section>`）是同一张白面
          （`bg-raised` + `border-line`）：**这块料上，抬起来的一律是白 + 一道发丝线**。

          ⚠️ **连带后果（要说实话）**：主区改成自己滚之后，**外面的页面不再滚动了**，
          于是导航条那条 `sticky top-0` 从此**是惰性的** —— 不会有内容从它下面过。
          仍然留着，两个理由：① 它是使用方上一轮（变更-030）为「让模糊有东西可糊」
          特意定的，去掉等于把那一轮的结论悄悄推翻；② 万一哪天主区又改回整页滚，
          它立刻恢复作用。
          ⚠️ x-minimalist 之后第 ① 条**已经失去对象**：头部不再是半透明的，没有模糊
          需要「背后有东西」（它是 `bg-raised` 不透明面 + 1px 发丝线）。留着它的理由
          只剩第 ② 条 —— 哪天主区改回整页滚，这条 sticky 立刻有用；拆它是个独立决定，
          与配色换代无关，本轮不动。
          ⚠️ 变更-038 之后，四个汇总页签上连**这一栏**都不滚了（滚的是卡片里的表格区），
          这条 sticky 于是更没有用武之地 —— 同上，去留是独立决定。

          ⚠️ **这一栏曾经挂过 `.glass-scroll`**（变更-038）：四个汇总页签改成「卡片
          撑满、表格区自己滚」之后，本栏在那四页上不再滚动，`--main-scroll` 时间线
          就不能挂死在它身上 —— 挂在一个不动的元素上，三块玻璃的边缘高光会**停在
          贴顶那一格**，不报错、只是不跟手（与 `.minimal-field` 那段注释记的是同一种
          失效）。所以那时把标记从静态 class 挪到 `:class` 绑定上：本栏挂「不是那四页
          时」的那一份，那四页各自的表格区挂自己那一份 —— **任何时刻只有一处声明**。
          x-minimalist 删掉折射层后时间线没有消费者，标记与推导一并删除（变更-056）；
          这条注释留在这里，只是回答「为什么本栏没有那个类」。
          -->
          <div
            class="flex-1 min-h-0 overflow-y-auto rounded-card border border-line bg-raised p-4"
          >
            <div v-if="mountedTabs.has('workOrder')" v-show="activeTab === 'workOrder'" class="flex h-full flex-col">
              <!--
              变更-038：四个汇总页签的卡片**撑满玻璃栏、自己管滚动**（使用方
              2026-10-11：「翻页功能每页都不在一个位置，体验很差」）。

              钉住分页行的道理：分页行是卡片的最后一个子元素，卡片多高它就多低。
              而「产成品 / 物料名称」那几列是 `whitespace-normal break-words` 的，
              每页折行的条数不一样 —— 卡片跟着内容一高一矮，分页行就一上一下。

              链条：上一级（玻璃栏的 `flex-1` 定高）→ `h-full` 把定高传下来
              → 卡片 `flex-1 min-h-0` 正好吃满 → 表格区 `flex-1 min-h-0
              overflow-y-auto` 是**唯一的纵向滚动容器** → 分页行 `shrink-0` 钉在卡底。
              翻页时折行条数变了，动的也只是表格区内部，分页行一动不动。

              ⚠️ 两处 `min-h-0` 都不能省 —— 与上面 2122 那段是同一个坑：flex item
              默认 `min-height:auto`，不写就不肯缩到内容以下，内容长的页会把卡片
              （连带分页行）重新顶高，这一轮就白改了。
              ⚠️ 表格区的纵向滚动是「白捡 + 显式」两笔：`overflow-x:auto` 本来就会把
              `overflow-y` 的 `visible` 计算成 `auto`（它一直是纵向滚动容器，只是过去
              没有高度约束、一直长高），显式写上 `overflow-y-auto` 是给下一个人看的。
              其余三个汇总页签（物料 / 领料 / 库存）同一张方子，不重复注释。
              -->
              <section
                class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card"
              >
                <div class="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
                  <span class="shrink-0 text-xs text-slate-500">起始日期</span>
                  <el-date-picker
                    v-model="startDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    aria-label="起始日期"
                    :first-day-of-week="1"
                    @change="reloadWorkOrders"
                  />
                  <span class="shrink-0 text-sm text-slate-500">至</span>
                  <span class="shrink-0 text-xs text-slate-500">结束日期</span>
                  <el-date-picker
                    v-model="endDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    aria-label="结束日期"
                    :first-day-of-week="1"
                    @change="reloadWorkOrders"
                  />
                </div>

                <div class="relative flex min-h-0 flex-1 flex-col">
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
                    v-else-if="
                      tableData.length === 0 && !productFilter && !orderTypeFilter && !orderNoFilter
                    "
                    title="暂无工单数据"
                    description="当前没有可展示的工单记录"
                  />

                  <div v-else class="flex min-h-0 flex-1 flex-col">
                    <div
                      class="min-h-0 flex-1 overflow-x-auto overflow-y-auto"
                    >
                      <table class="min-w-full table-fixed divide-y divide-line text-left">
                        <colgroup>
                          <col v-for="column in columns" :key="column.key" :class="column.width" />
                        </colgroup>
                        <thead class="bg-region">
                          <tr>
                            <th
                              v-for="column in columns"
                              :key="column.key"
                              scope="col"
                              class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                              :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                            >
                              <template v-if="column.key === 'orderNo'">
                                <FilterHeaderCell
                                  :label="column.label"
                                  :selected="orderNoFilter"
                                  hint="工单号"
                                  max-width-class="max-w-[130px]"
                                  @open="openOrderNoDialog"
                                  @clear="clearOrderNoFilter"
                                />
                              </template>

                              <template v-else-if="column.key === 'orderType'">
                                <FilterHeaderCell
                                  :label="column.label"
                                  :selected="orderTypeFilter"
                                  hint="工单类型"
                                  max-width-class="max-w-[110px]"
                                  @open="openOrderTypeDialog"
                                  @clear="clearOrderTypeFilter"
                                />
                              </template>

                              <template v-else-if="column.key === 'materialDesc'">
                                <FilterHeaderCell
                                  :label="column.label"
                                  :selected="productFilter"
                                  hint="产成品"
                                  max-width-class="max-w-[110px]"
                                  @open="openProductDialog"
                                  @clear="clearProductFilter"
                                />
                              </template>

                              <template v-else>{{ column.label }}</template>
                            </th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                          <tr v-if="tableData.length === 0">
                            <td
                              :colspan="columns.length"
                              class="px-3 py-16 text-center text-sm text-slate-500"
                            >
                              没有符合筛选条件的工单
                            </td>
                          </tr>
                          <tr
                            v-for="(order, index) in tableData"
                            :key="`${order.orderNo}-${index}`"
                            tabindex="0"
                            class="cursor-pointer transition hover:bg-region focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                            @click="openImageDialog(order)"
                            @keydown.enter.self.prevent="openImageDialog(order)"
                            @keydown.space.self.prevent="openImageDialog(order)"
                          >
                            <td
                              class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900"
                            >
                              {{ (pageNum - 1) * pageSize + index + 1 }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ order.planStartDate }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ order.orderNo }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ getReportOrderType(order.orderNo) }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ order.materialCode }}
                            </td>
                            <td
                              class="max-w-[180px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700"
                            >
                              {{ order.materialDesc }}
                            </td>
                            <td
                              class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600"
                            >
                              {{ order.orderQty }}
                            </td>
                            <td
                              class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600"
                            >
                              {{ order.confirmedQty }}
                            </td>
                            <td
                              class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600"
                            >
                              {{ order.deliveredQty }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div class="flex shrink-0 justify-end border-t border-line px-6 py-3">
                      <el-pagination
                        v-model:current-page="pageNum"
                        :page-size="pageSize"
                        :total="total"
                        layout="total, prev, pager, next"
                        background
                        @current-change="loadWorkOrderPage"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <!-- 工单图片弹窗：状态在 useOrderImages（模块级单例），组件只负责渲染 -->
              <OrderImageDialog />

              <ProductSelectDialog
                v-model="productDialogVisible"
                :options="productOptions"
                :selected="productFilter"
                @select="handleProductSelected"
              />

              <ProductSelectDialog
                v-model="orderTypeDialogVisible"
                :options="orderTypeOptions"
                :selected="orderTypeFilter"
                label="工单类型"
                @select="handleOrderTypeSelected"
              />

              <ProductSelectDialog
                v-model="orderNoDialogVisible"
                :options="orderNoOptions"
                :selected="orderNoFilter"
                label="工单号"
                @select="handleOrderNoSelected"
              />
            </div>

            <div v-if="mountedTabs.has('material')" v-show="activeTab === 'material'" class="flex h-full flex-col">
              <!-- 变更-038：与工单汇总同一张方子（定高链 + 表格区自己滚 + 分页行钉底），
                   完整理由见上面「工单汇总」那一段 -->
              <section
                class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card"
              >
                <div
                  class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3"
                >
                  <span class="shrink-0 text-xs text-slate-500">起始日期</span>
                  <el-date-picker
                    v-model="pickStartDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    aria-label="起始日期"
                    :first-day-of-week="1"
                    @change="reloadPickRecords"
                  />
                  <span class="shrink-0 text-sm text-slate-500">至</span>
                  <span class="shrink-0 text-xs text-slate-500">结束日期</span>
                  <el-date-picker
                    v-model="pickEndDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    aria-label="结束日期"
                    :first-day-of-week="1"
                    @change="reloadPickRecords"
                  />
                  <span class="ml-auto text-sm text-slate-500">
                    共 <span class="font-semibold text-slate-900">{{ pickTotal }}</span> 条记录
                  </span>
                </div>

                <div class="relative flex min-h-0 flex-1 flex-col">
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
                    :description="
                      pickMaterialFilter
                        ? `当前筛选：${pickMaterialFilter}`
                        : '当前没有可展示的领料记录'
                    "
                  />

                  <div v-else class="flex min-h-0 flex-1 flex-col">
                    <div
                      class="min-h-0 flex-1 overflow-x-auto overflow-y-auto"
                    >
                      <table class="min-w-full table-fixed divide-y divide-line text-left">
                        <colgroup>
                          <col
                            v-for="column in pickColumns"
                            :key="column.key"
                            :class="column.width"
                          />
                        </colgroup>
                        <thead class="bg-region">
                          <tr>
                            <th
                              v-for="column in pickColumns"
                              :key="column.key"
                              scope="col"
                              class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                              :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                            >
                              <template v-if="column.key === 'materialName'">
                                <FilterHeaderCell
                                  :label="column.label"
                                  :selected="pickMaterialFilter"
                                  hint="物料名称"
                                  max-width-class="max-w-[130px]"
                                  @open="openPickMaterialDialog"
                                  @clear="clearPickMaterialFilter"
                                />
                              </template>

                              <template v-else>{{ column.label }}</template>
                            </th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                          <tr
                            v-for="(record, index) in pickTableData"
                            :key="`${record.materialCode}-${record.pickDate}-${index}`"
                            class="transition hover:bg-region"
                          >
                            <td
                              class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900"
                            >
                              {{ (pickPageNum - 1) * pickPageSize + index + 1 }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ record.pickDate }}
                            </td>
                            <td
                              class="max-w-[200px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700"
                            >
                              {{ record.materialName }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ record.materialCode }}
                            </td>
                            <td
                              class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600"
                            >
                              {{ record.pickQty }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ record.unit }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              <span
                                class="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-md bg-region text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                :role="canOpenImage(record) ? 'button' : undefined"
                                :tabindex="canOpenImage(record) ? 0 : -1"
                                :aria-label="
                                  record.imageUrl || record.thumbnailUrl
                                    ? '查看领料单据'
                                    : '暂无图片'
                                "
                                @click="openPickImageDialog(record)"
                                @keydown.enter.prevent="openPickImageDialog(record)"
                                @keydown.space.prevent="openPickImageDialog(record)"
                              >
                                <svg
                                  class="h-3 w-3"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="1.5"
                                  aria-hidden="true"
                                >
                                  <rect x="3" y="3" width="18" height="18" rx="2" />
                                  <circle cx="8.5" cy="8.5" r="1.5" />
                                  <path d="m21 15-5-5L5 21" />
                                </svg>
                                <!-- 缩略图：缺失时回退原图；加载失败逐级降级，最终露出底层占位图标 -->
                                <img
                                  v-if="record.thumbnailUrl || record.imageUrl"
                                  :src="record.thumbnailUrl || record.imageUrl"
                                  alt="领料单据"
                                  loading="lazy"
                                  decoding="async"
                                  class="absolute inset-0 h-5 w-5 rounded-md border border-line bg-raised object-cover transition hover:opacity-80"
                                  @error="handleImgError($event, record)"
                                />
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div class="flex shrink-0 justify-end border-t border-line px-6 py-3">
                      <el-pagination
                        v-model:current-page="pickPageNum"
                        :page-size="pickPageSize"
                        :total="pickTotal"
                        layout="total, prev, pager, next"
                        background
                        @current-change="loadPickPage"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <el-dialog v-model="pickImageDialogVisible" width="70vw" align-center>
                <div
                  class="flex min-h-[400px] items-center justify-center rounded-card bg-region p-6"
                >
                  <img
                    v-if="currentPickImage"
                    :src="currentPickImage"
                    alt="领料单据大图"
                    class="max-h-[70vh] max-w-full rounded-card object-contain"
                  />
                </div>
              </el-dialog>

              <ProductSelectDialog
                v-model="pickMaterialDialogVisible"
                :options="pickMaterialOptions"
                :selected="pickMaterialFilter"
                label="物料名称"
                @select="handlePickMaterialSelected"
              />
            </div>

            <div v-if="mountedTabs.has('inbound')" v-show="activeTab === 'inbound'" class="flex h-full flex-col">
              <!-- 变更-038：与工单汇总同一张方子（定高链 + 表格区自己滚 + 分页行钉底），
                   完整理由见上面「工单汇总」那一段 -->
              <section
                class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card"
              >
                <div
                  class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3"
                >
                  <span class="shrink-0 text-xs text-slate-500">起始日期</span>
                  <el-date-picker
                    v-model="inboundStartDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    aria-label="起始日期"
                    :first-day-of-week="1"
                    @change="reloadInboundRecords"
                  />
                  <span class="shrink-0 text-sm text-slate-500">至</span>
                  <span class="shrink-0 text-xs text-slate-500">结束日期</span>
                  <el-date-picker
                    v-model="inboundEndDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    aria-label="结束日期"
                    :first-day-of-week="1"
                    @change="reloadInboundRecords"
                  />
                  <span class="ml-auto text-sm text-slate-500">
                    共 <span class="font-semibold text-slate-900">{{ inboundTotal }}</span> 条记录
                  </span>
                </div>

                <div class="relative flex min-h-0 flex-1 flex-col">
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
                    :description="
                      inboundMaterialFilter
                        ? `当前筛选：${inboundMaterialFilter}`
                        : '当前没有可展示的入库记录'
                    "
                  />

                  <div v-else class="flex min-h-0 flex-1 flex-col">
                    <div
                      class="min-h-0 flex-1 overflow-x-auto overflow-y-auto"
                    >
                      <table class="min-w-full table-fixed divide-y divide-line text-left">
                        <colgroup>
                          <col
                            v-for="column in inboundColumns"
                            :key="column.key"
                            :class="column.width"
                          />
                        </colgroup>
                        <thead class="bg-region">
                          <tr>
                            <th
                              v-for="column in inboundColumns"
                              :key="column.key"
                              scope="col"
                              class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                              :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                            >
                              <template v-if="column.key === 'materialName'">
                                <FilterHeaderCell
                                  :label="column.label"
                                  :selected="inboundMaterialFilter"
                                  hint="物料名称"
                                  max-width-class="max-w-[130px]"
                                  @open="openInboundMaterialDialog"
                                  @clear="clearInboundMaterialFilter"
                                />
                              </template>

                              <template v-else>{{ column.label }}</template>
                            </th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                          <tr
                            v-for="(record, index) in inboundTableData"
                            :key="`${record.materialCode}-${record.inboundDate}-${index}`"
                            class="transition hover:bg-region"
                          >
                            <td
                              class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900"
                            >
                              {{ (inboundPageNum - 1) * inboundPageSize + index + 1 }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ record.inboundDate }}
                            </td>
                            <td
                              class="max-w-[200px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700"
                            >
                              {{ record.materialName }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ record.materialCode }}
                            </td>
                            <td
                              class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600"
                            >
                              {{ record.inboundQty }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ record.unit }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              <span
                                class="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-md bg-region text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                :role="canOpenImage(record) ? 'button' : undefined"
                                :tabindex="canOpenImage(record) ? 0 : -1"
                                :aria-label="
                                  record.imageUrl || record.thumbnailUrl
                                    ? '查看入库单据'
                                    : '暂无图片'
                                "
                                @click="openInboundImageDialog(record)"
                                @keydown.enter.prevent="openInboundImageDialog(record)"
                                @keydown.space.prevent="openInboundImageDialog(record)"
                              >
                                <svg
                                  class="h-3 w-3"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="1.5"
                                  aria-hidden="true"
                                >
                                  <rect x="3" y="3" width="18" height="18" rx="2" />
                                  <circle cx="8.5" cy="8.5" r="1.5" />
                                  <path d="m21 15-5-5L5 21" />
                                </svg>
                                <!-- 缩略图：缺失时回退原图；加载失败逐级降级，最终露出底层占位图标 -->
                                <img
                                  v-if="record.thumbnailUrl || record.imageUrl"
                                  :src="record.thumbnailUrl || record.imageUrl"
                                  alt="入库单据"
                                  loading="lazy"
                                  decoding="async"
                                  class="absolute inset-0 h-5 w-5 rounded-md border border-line bg-raised object-cover transition hover:opacity-80"
                                  @error="handleImgError($event, record)"
                                />
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div class="flex shrink-0 justify-end border-t border-line px-6 py-3">
                      <el-pagination
                        v-model:current-page="inboundPageNum"
                        :page-size="inboundPageSize"
                        :total="inboundTotal"
                        layout="total, prev, pager, next"
                        background
                        @current-change="loadInboundPage"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <el-dialog v-model="inboundImageDialogVisible" width="70vw" align-center>
                <div
                  class="flex min-h-[400px] items-center justify-center rounded-card bg-region p-6"
                >
                  <img
                    v-if="currentInboundImage"
                    :src="currentInboundImage"
                    alt="入库单据大图"
                    class="max-h-[70vh] max-w-full rounded-card object-contain"
                  />
                </div>
              </el-dialog>

              <ProductSelectDialog
                v-model="inboundMaterialDialogVisible"
                :options="inboundMaterialOptions"
                :selected="inboundMaterialFilter"
                label="物料名称"
                @select="handleInboundMaterialSelected"
              />
            </div>

            <div v-if="mountedTabs.has('report')" v-show="activeTab === 'report'">
              <StatsTable
                :columns="reportColumns"
                :rows="reportRows"
                empty-text="暂无报工数据"
                :row-key="statsRowKey"
              />
            </div>

            <div v-if="mountedTabs.has('costing')" v-show="activeTab === 'costing'">
              <StatsTable
                :columns="costingColumns"
                :rows="costingRows"
                empty-text="暂无核算数据"
                :row-key="statsRowKey"
              />
            </div>

            <div v-if="mountedTabs.has('materialCosting')" v-show="activeTab === 'materialCosting'">
              <!-- 货物移动取数失败（变更-033）：核算表那两个派生列就没有正确答案，
                   说出来 + 给一次重试，好过让 0 冒充「没有人报工」 -->
              <div
                v-if="goodsMoveError"
                role="alert"
                class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-rose-200 bg-rose-50 px-5 py-4"
              >
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-rose-700">货物移动数据加载失败</h3>
                  <p class="mt-1 text-sm text-rose-700">
                    「已报工数 / 未报工数」暂无法计算，两列以「—」显示。{{ goodsMoveError }}
                  </p>
                </div>
                <button
                  type="button"
                  class="ml-auto shrink-0 rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
                  @click="fetchGoodsMoveSummary"
                >
                  重新加载
                </button>
              </div>

              <StatsTable
                :columns="materialCostingColumns"
                :rows="materialCostingDisplayRows"
                empty-text="暂无核算数据"
                :row-key="statsRowKey"
              />
            </div>

            <div v-if="mountedTabs.has('stock')" v-show="activeTab === 'stock'" class="flex h-full flex-col">
              <!-- 变更-038：与工单汇总同一张方子（定高链 + 表格区自己滚 + 分页行钉底），
                   完整理由见上面「工单汇总」那一段 -->
              <section
                class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card"
              >
                <div
                  class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3"
                >
                  <!-- ⚠️ **边打边查**（变更-059）：停 250ms 就发请求，**不用回车**。
                       查询仍在**服务端**（筛选与分页都没动，见 useMaterialStockData），
                       接线走公共的 `useLiveQuery`（防抖 + 查询签名去重 + 卸载撤销），
                       过期响应护栏在数据层（`stockRequestSeq`）—— 三层缺一不可。
                       中文输入法安全：走 watch 而不是 @input，组字期间的拼音串不会变成查询。
                       回车与清空 = 显式意图：立刻发，且允许重复发（等于手动刷新一次）。 -->
                  <el-input
                    v-model="stockKeyword"
                    placeholder="物料编码 / 物料名称 / 规格"
                    aria-label="搜索物料"
                    clearable
                    class="w-72"
                    @keyup.enter="flushStockFilter"
                    @clear="flushStockFilter"
                  />
                  <!-- 默认**不勾**：这一页是查物料信息，要把数量为 0 的物料也列出来 -->
                  <el-checkbox :model-value="stockOnlyInStock" @change="toggleStockOnlyInStock">
                    只看有库存
                  </el-checkbox>
                  <span class="ml-auto text-sm text-slate-500">
                    <!-- 细化阶段（已有行、又在查）在这里说话：表格不换遮罩，避免打字时
                         整块结果反复消失又出现 -->
                    <template v-if="stockRefining">查询中…</template>
                    <template v-else>
                      共 <span class="font-semibold text-slate-900">{{ stockTotal }}</span> 条记录
                    </template>
                  </span>
                </div>

                <div class="relative flex min-h-0 flex-1 flex-col">
                  <!-- 实时查询下**只有首屏**才用遮罩：已经有行时换遮罩会让结果在打字时
                       反复消失又出现；细化阶段改由上面计数处提示「查询中…」 -->
                  <LoadingMask v-if="stockLoading && !stockTableData.length" />

                  <PanelState
                    v-else-if="stockError"
                    type="error"
                    title="暂时无法获取物料库存"
                    :description="stockError"
                    action-text="重新加载"
                    @action="fetchStockRecords"
                  />

                  <PanelState
                    v-else-if="stockTableData.length === 0"
                    :title="
                      stockKeyword || stockOnlyInStock ? '没有符合筛选条件的记录' : '暂无库存数据'
                    "
                    :description="
                      stockKeyword || stockOnlyInStock
                        ? '换个关键词，或取消勾选「只看有库存」看看'
                        : '还没有导入过库存汇总，可在「文件导入」里上传库存表'
                    "
                  />

                  <div v-else class="flex min-h-0 flex-1 flex-col">
                    <!-- 9 列在窄窗口下会溢出：外层 overflow-x-auto + colgroup 定宽，
                   与领料 / 入库汇总那两张表同一套写法 -->
                    <div
                      class="min-h-0 flex-1 overflow-x-auto overflow-y-auto"
                    >
                      <table class="min-w-full table-fixed divide-y divide-line text-left">
                        <colgroup>
                          <col
                            v-for="column in stockColumns"
                            :key="column.key"
                            :class="column.width"
                          />
                        </colgroup>
                        <thead class="bg-region">
                          <tr>
                            <th
                              v-for="column in stockColumns"
                              :key="column.key"
                              scope="col"
                              class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                              :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                            >
                              {{ column.label }}
                            </th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                          <tr
                            v-for="(record, index) in stockTableData"
                            :key="`${record.plantCode}-${record.materialCode}-${record.storageLocation}-${index}`"
                            class="transition hover:bg-region"
                          >
                            <td
                              class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900"
                            >
                              {{ (stockPageNum - 1) * stockPageSize + index + 1 }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ displayText(record.materialCode) }}
                            </td>
                            <td
                              class="max-w-[220px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700"
                            >
                              {{ displayText(record.materialName) }}
                            </td>
                            <td
                              class="max-w-[160px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-600"
                            >
                              {{ displayText(record.spec) }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ displayText(record.storageLocation) }}
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                              {{ displayText(record.unit) }}
                            </td>
                            <td
                              class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm font-semibold"
                              :class="
                                Number(record.stockQty) > 0 ? 'text-slate-900' : 'text-slate-500'
                              "
                            >
                              {{ displayText(formatStockQty(record.stockQty)) }}
                            </td>
                            <td
                              class="max-w-[180px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-600"
                            >
                              {{ displayText(record.storageDesc) }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div class="flex shrink-0 justify-end border-t border-line px-6 py-3">
                      <el-pagination
                        v-model:current-page="stockPageNum"
                        :page-size="stockPageSize"
                        :total="stockTotal"
                        layout="total, prev, pager, next"
                        background
                        @current-change="getStockPageData"
                      />
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div v-if="mountedTabs.has('weekly')" v-show="activeTab === 'weekly'">
              <section
                class="rounded-card border border-line bg-raised shadow-card"
              >
                <div class="flex items-center gap-3 border-b border-line px-6 py-3">
                  <span class="shrink-0 text-xs text-slate-500">起始日期</span>
                  <el-date-picker
                    v-model="weeklyStartDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    aria-label="起始日期"
                    :first-day-of-week="1"
                  />
                  <span class="shrink-0 text-sm text-slate-500">至</span>
                  <span class="shrink-0 text-xs text-slate-500">结束日期</span>
                  <el-date-picker
                    v-model="weeklyEndDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    aria-label="结束日期"
                    :first-day-of-week="1"
                  />
                </div>

                <div class="p-6">
                  <div class="relative">
                    <LoadingMask v-if="weeklyStatsLoading" />

                    <PanelState
                      v-else-if="weeklyStatsError"
                      type="error"
                      title="暂时无法获取周统计数据"
                      :description="weeklyStatsError"
                      action-text="重新加载"
                      @action="fetchWeeklyStats"
                    />

                    <div v-else class="overflow-x-auto">
                      <table class="w-full table-fixed border-collapse text-center">
                        <colgroup>
                          <col class="w-[220px]" />
                          <col class="w-32" />
                          <col class="w-32" />
                          <col class="w-32" />
                          <col class="w-32" />
                        </colgroup>
                        <thead>
                          <tr>
                            <th
                              colspan="5"
                              class="border border-line px-3 py-2.5 text-base font-bold tracking-wide text-slate-800"
                            >
                              {{ weeklyTitle }}
                            </th>
                          </tr>
                          <tr>
                            <th
                              v-for="column in weeklyColumns"
                              :key="column.key"
                              scope="col"
                              class="border border-line bg-region py-3 text-sm font-semibold text-slate-600"
                              :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                            >
                              {{ column.label }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="row in weeklyRows" :key="row.name">
                            <td class="border border-line px-3 py-2.5 text-sm text-slate-700">
                              {{ row.name }}
                            </td>
                            <td
                              class="border border-line py-2.5 pl-3 pr-5 text-right text-sm text-slate-700"
                            >
                              {{ row.pickQty }}
                            </td>
                            <td class="border border-line p-0">
                              <input
                                v-model="weeklyRemaining[row.materialCode]"
                                type="text"
                                placeholder="/"
                                :aria-label="`车间剩余 ${row.name}`"
                                class="w-full bg-transparent py-2.5 pl-3 pr-5 text-right text-sm text-slate-700 outline-none transition placeholder:text-slate-500 hover:bg-region focus:bg-raised focus:ring-2 focus:ring-inset focus:ring-brand"
                              />
                            </td>
                            <td
                              class="border border-line py-2.5 pl-3 pr-5 text-right text-sm text-slate-700"
                            >
                              {{ row.actualQty }}
                            </td>
                            <td class="border border-line px-3 py-2.5 text-sm text-slate-700">
                              {{ row.unitConsumption }} {{ row.unitLabel }}
                            </td>
                          </tr>
                          <tr>
                            <td class="border border-line px-3 py-2.5 text-sm text-slate-700">
                              {{ weeklyInboundRow.name }}
                            </td>
                            <td
                              colspan="4"
                              class="border border-line px-3 py-2.5 text-sm font-semibold text-slate-800"
                            >
                              {{ weeklyInboundRow.value }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div v-if="mountedTabs.has('daily')" v-show="activeTab === 'daily'">
              <section
                class="rounded-card border border-line bg-raised shadow-card"
              >
                <PanelState type="pending" title="日报表记录" description="功能建设中，敬请期待" />
              </section>
            </div>

            <!--
              变更-044：与四个汇总页签同一张 038 方子（完整链条注释见 workOrder
              页签那段）—— 卡片撑满、表格区自己滚、分页行钉卡底。使用方 2026-10-11：
              「翻页组件位置变化，体验不好」（第 4 页只剩 1 行时分页行跳到表格下面）。
            -->
            <div v-if="mountedTabs.has('tankLevel')" v-show="activeTab === 'tankLevel'" class="flex h-full flex-col">
              <TankLevelPanel />
            </div>

            <!-- 设备数据维护（2026-10-06）：页签按 equipment:edit 权限显隐，写接口另有 admin 闸门。
                 变更-088：接上 038/044 那张定高方子（`flex h-full flex-col`）——
                 使用方 2026-10-16 对这张表说的是同一句话「翻页时不在同一个位置，像在跳动」。 -->
            <div v-if="mountedTabs.has('equipment')" v-show="activeTab === 'equipment'" class="flex h-full flex-col">
              <EquipmentMaintenancePanel />
            </div>

            <div v-if="mountedTabs.has('vessel')" v-show="activeTab === 'vessel'">
              <section
                class="rounded-card border border-line bg-raised shadow-card"
              >
                <!-- 容器清单来自设备台账（异步）。取不到时必须给出明确提示：
               这个页面是纯前端计算，清单空了就什么都算不了，而页面本身不会报错，
               只会静静地显示一台空白罐与 0.00 —— 看着像「算出来是 0」。 -->
                <div
                  v-if="vesselsLoading && !vessels.length"
                  class="border-b border-line px-6 py-3 text-xs text-slate-500"
                >
                  正在加载容器清单…
                </div>
                <div
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
                </div>

                <!-- 储罐切换：位置在两种罐型下保持一致，切换时不跳动。
                     变更-090：介质/几何那段说明**从这一行搬进右栏**（原先它横在顶部，
                     把图往下压）。这个页面的图是「高度决定宽度」的（见 CANVAS_MAX_HEIGHT），
                     顶部每让出一行、图就长高一行；而右栏加宽对图**零损失**。
                     这里 py 也从 4 收到 2。 -->
                <div
                  class="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-b border-line px-6 py-2"
                >
                  <!-- 告警留在顶部：它们是需要立刻看见的红字，塞进窄右栏会折成一片 -->
                  <p v-if="vesselReconcileWarning" class="mr-auto text-xs font-medium text-rose-600">
                    {{ vesselReconcileWarning }}
                  </p>
                  <p v-if="vesselBundleWarning" class="mr-auto text-xs font-medium text-rose-600">
                    {{ vesselBundleWarning }}
                  </p>
                  <el-select
                    v-model="vesselKey"
                    class="vessel-select shrink-0"
                    aria-label="选择储罐"
                  >
                    <el-option
                      v-for="vessel in vessels"
                      :key="vessel.key"
                      :label="vessel.label"
                      :value="vessel.key"
                    />
                  </el-select>
                </div>

                <div
                  class="flex flex-wrap items-stretch"
                  :class="isVerticalVessel ? 'gap-x-6 p-6' : ''"
                >
                  <div
                    class="flex justify-center"
                    :class="isVerticalVessel ? 'shrink-0' : 'w-full p-6'"
                  >
                    <canvas
                      ref="vesselCanvas"
                      class="vessel-canvas mx-auto block h-auto w-auto max-w-full"
                      :class="{ 'is-switching': vesselSwitching }"
                      :style="{
                        maxWidth: `${vesselGeometry.displayWidth}px`,
                        maxHeight: CANVAS_MAX_HEIGHT,
                        aspectRatio: String(vesselCanvasAspect),
                      }"
                    ></canvas>
                  </div>

                  <div
                    :class="
                      isVerticalVessel
                        ? 'flex min-w-[260px] max-w-[380px] flex-1 flex-col justify-center'
                        : 'w-full'
                    "
                  >
                    <!-- 介质 / 几何说明（变更-090：从顶部行搬到这里）。
                         竖版：右栏是窄条，给它 260~380px 才折得好看 —— 而图是高度决定宽度的，
                         多让出横向对它**没有任何损失**；横版：右栏在图下方、本来就占整幅宽。 -->
                    <p
                      class="text-xs leading-relaxed text-slate-500"
                      :class="isVerticalVessel ? '' : 'mt-4'"
                    >
                      {{ vesselDescription }}
                    </p>
                    <p v-if="vesselGeometry.note" class="mt-1 text-xs font-medium text-amber-700">
                      {{ vesselGeometry.note }}
                    </p>

                    <!-- 横版：体积变化在左、液位控制列在右；竖版：体积变化居中在上 -->
                    <div
                      class="flex flex-wrap items-center justify-between gap-x-8 gap-y-5"
                      :class="isVerticalVessel ? 'flex-col' : 'border-t border-line px-6 pt-5'"
                    >
                      <!-- 体积变化：横版居中于左侧空区，竖版居中在上 -->
                      <div
                        class="flex justify-center"
                        :class="isVerticalVessel ? 'w-full' : 'flex-1'"
                      >
                        <!-- 体积变化：居中作为视觉焦点 -->
                        <div
                          class="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1"
                          :class="
                            isVerticalVessel
                              ? 'px-0 pb-4 pt-5'
                              : 'rounded-card border border-line bg-region px-6 py-4'
                          "
                        >
                          <span class="text-sm text-slate-500">体积变化</span>
                          <!-- 24px 粗体属「大字号」，阈值 3:1，-600 已过 —— 与下面那处刻意不同，别对齐 -->
                          <span
                            class="text-2xl font-bold tracking-tight"
                            :class="vesselVolumeDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'"
                            >{{ vesselVolumeDelta >= 0 ? '+' : ''
                            }}{{ vesselVolumeDelta.toFixed(2) }}</span
                          >
                          <span class="text-sm text-slate-500">m³</span>
                          <span
                            v-if="vesselMassDelta !== null"
                            class="text-base font-semibold"
                            :class="
                              vesselVolumeDelta >= 0 ? STATUS_TEXT.success : STATUS_TEXT.error
                            "
                            >（{{ vesselMassDelta >= 0 ? '+' : ''
                            }}{{ vesselMassDelta.toFixed(2) }} t）</span
                          >
                        </div>
                      </div>

                      <!-- 竖轨 + 两根读数引线（变更-048，使用方 2026-10-12 拿实机截图定：
                           「红色框选部分不要了，相应的信息通过引线指向滑块按钮」）——
                           两根读数柱撤成**挂在钮上的引线标注**：钮在轨道上到哪，标注跟到哪；
                           引线走画布差值标注同一套折线语言（圆点 → 横出 → 折角），
                           墨色 = 该读数的墨（起始虚线 / 终止液面线），与钮环、图例三处同源 -->
                      <div
                        class="gap-x-6 gap-y-5"
                        :class="
                          isVerticalVessel
                            ? 'flex w-full items-center justify-center px-0'
                            : 'flex flex-1 flex-wrap items-center justify-center gap-x-6'
                        "
                      >
                        <!-- 竖轨的定高柱（EP 竖版根是 height:100%，父柱不定高就塌成一条）：
                             宽 = 轨 42 + 右侧标注栏 250 —— 标注入列，柱心才是整组的视觉中心 -->
                        <div class="relative flex h-[260px] w-[292px] shrink-0 items-center">
                          <!-- 引线层：画在同一只 260 定高柱的坐标系里（无 viewBox，
                               用户单位即 px），overflow: visible 让线伸出柱外指到标注 -->
                          <svg
                            class="vessel-level-leader"
                            width="42"
                            height="260"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <polyline
                              :points="vesselLeaders.start.points"
                              :stroke="vesselLeaders.start.color"
                              stroke-width="1.5"
                              fill="none"
                            />
                            <circle
                              :cx="vesselLeaders.start.x"
                              :cy="vesselLeaders.start.y"
                              r="3.4"
                              :fill="vesselLeaders.start.color"
                            />
                            <polyline
                              :points="vesselLeaders.end.points"
                              :stroke="vesselLeaders.end.color"
                              stroke-width="1.5"
                              fill="none"
                            />
                            <circle
                              :cx="vesselLeaders.end.x"
                              :cy="vesselLeaders.end.y"
                              r="3.4"
                              :fill="vesselLeaders.end.color"
                            />
                          </svg>

                          <!-- 起始读数标注：数字仍可键入（865 / 1525 的实测读数，045 定的分工），
                               只是不再画框 —— 见 .vessel-level-input 的「带下划线的数字」配方 -->
                          <div
                            class="vessel-level-callout vessel-level-callout-start"
                            :style="vesselStartCalloutStyle"
                          >
                            <div
                              class="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700"
                            >
                              <span
                                class="inline-block h-0 w-5 border-t-2 border-dashed border-slate-800"
                                aria-hidden="true"
                              ></span>
                              起始液位
                              <input
                                v-model.number="vesselStartLevel"
                                type="number"
                                min="0"
                                :max="vesselGeometry.maxLevel"
                                step="10"
                                aria-label="起始液位（毫米）"
                                class="vessel-level-input min-w-0 text-right"
                              />
                              <span class="text-slate-500">mm</span>
                            </div>
                            <div class="mt-0.5 text-sm text-slate-500">
                              体积：<span class="font-semibold text-brand-deep">{{
                                vesselStartVolume.toFixed(2)
                              }}</span>
                              m³<template v-if="vesselStartMass !== null"
                                ><span class="ml-1 whitespace-nowrap"
                                  >（{{ vesselStartMass.toFixed(2) }} t）</span
                                ></template
                              >
                            </div>
                          </div>

                          <!-- 液位滑块（变更-046）：一根竖轨两个钮，上高下低 —— 钮环色 = 该钮
                               代表的读数在图上那根线的墨色（起始虚线 / 终止液面线），钮间色带 =
                               消耗·增加语义色（与画布剖面线同一对值）。range 两钮不许交叉：
                               倒挂（消耗）只能走数字框键入 —— 滑块收的是排序过的一对，
                               startIsLower 负责把两个数再映射回起始 / 终止，见 setVesselLevelPair -->
                          <el-slider
                            class="vessel-level-slider"
                            vertical
                            range
                            height="260px"
                            :model-value="vesselLevelPair"
                            :min="0"
                            :max="vesselGeometry.maxLevel"
                            :step="1"
                            placement="right"
                            :format-tooltip="formatVesselLevelTooltip"
                            :range-start-label="vesselLevelRangeLabels[0]"
                            :range-end-label="vesselLevelRangeLabels[1]"
                            :style="vesselLevelSliderStyle"
                            @input="setVesselLevelPair"
                          />

                          <!-- 终止读数标注 -->
                          <div
                            class="vessel-level-callout vessel-level-callout-end"
                            :style="vesselEndCalloutStyle"
                          >
                            <div
                              class="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-700"
                            >
                              <span
                                class="inline-block h-0 w-5 border-t-2"
                                :style="{ borderColor: vesselGeometry.liquid.line }"
                                aria-hidden="true"
                              ></span>
                              终止液位
                              <input
                                v-model.number="vesselEndLevel"
                                type="number"
                                min="0"
                                :max="vesselGeometry.maxLevel"
                                step="10"
                                aria-label="终止液位（毫米）"
                                class="vessel-level-input min-w-0 text-right"
                              />
                              <span class="text-slate-500">mm</span>
                            </div>
                            <div class="mt-0.5 text-sm text-slate-500">
                              体积：<span class="font-semibold text-brand-deep">{{
                                vesselEndVolume.toFixed(2)
                              }}</span>
                              m³<template v-if="vesselEndMass !== null"
                                ><span class="ml-1 whitespace-nowrap"
                                  >（{{ vesselEndMass.toFixed(2) }} t）</span
                                ></template
                              >
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="border-t border-line bg-region/50 px-6 py-4">
                  <div class="mx-auto max-w-[900px] overflow-x-auto">
                    <p
                      class="mb-3 text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-500"
                    >
                      液体体积计算公式
                    </p>

                    <div
                      v-if="vesselGeometry.type === 'vertical'"
                      class="math-formula text-center text-slate-700"
                    >
                      <div>
                        <i>V</i>(<i>h</i>) = π<i>r</i>²<i>h</i>
                        <span class="ml-2 text-xs text-slate-500"
                          >（<i>h</i> ≤ <i>H</i>，筒体段）</span
                        >
                        <span class="mx-7 text-slate-500" aria-hidden="true">｜</span>
                        <i>V</i>(<i>h</i>) = π<i>r</i>²<i>H</i> + π<i>r</i>²[ <i>t</i> −
                        <span class="frac"
                          ><span><i>t</i>³</span><span>3<i>h</i><sub>i</sub>²</span></span
                        >
                        ]
                        <span class="ml-2 text-xs text-slate-500"
                          >（<i>h</i> &gt; <i>H</i>，<i>t</i> = <i>h</i> − <i>H</i>）</span
                        >
                      </div>
                    </div>

                    <div v-else class="math-formula text-center text-slate-700">
                      <div>
                        <i>V</i>(<i>h</i>) = <i>L</i> [
                        <span class="frac"><span>π<i>r</i>²</span><span>2</span></span>
                        − (<i>r</i> − <i>h</i>)<span class="sqrt"
                          >√<span>2<i>rh</i> − <i>h</i>²</span></span
                        >
                        − <i>r</i>² · arcsin<span class="paren">(</span
                        ><span class="frac"
                          ><span><i>r</i> − <i>h</i></span
                          ><span><i>r</i></span></span
                        ><span class="paren">)</span> ] &nbsp;+&nbsp;
                        <span class="frac"
                          ><span>π · <i>h</i><sub>i</sub></span
                          ><span>3<i>r</i></span></span
                        >
                        · [ 3<i>r</i>²<i>h</i> − <i>r</i>³ + (<i>r</i> − <i>h</i>)³ ]
                      </div>
                    </div>

                    <p
                      v-if="vesselGeometry.type === 'vertical'"
                      class="mt-3 text-center text-xs leading-relaxed text-slate-500"
                    >
                      <i>r</i> 筒体内半径　<i>h</i> 液位高度　<i>H</i> 筒体高度　<i>h</i
                      ><sub>i</sub> 封头曲面内高度
                      <span class="text-slate-500">｜</span>
                      {{ vesselFormulaCaption }}
                    </p>
                    <p v-else class="mt-3 text-center text-xs leading-relaxed text-slate-500">
                      <i>L</i> 筒体长度（含两端直边）　<i>r</i> 筒体内半径　<i>h</i> 液位高度　<i
                        >h</i
                      ><sub>i</sub> 封头曲面内高度
                      <span class="text-slate-500">｜</span>
                      {{ vesselFormulaCaption }}
                    </p>
                  </div>
                </div>
              </section>
            </div>

            <div v-if="mountedTabs.has('electricity')" v-show="activeTab === 'electricity'">
              <section
                class="rounded-card border border-line bg-raised shadow-card"
              >
                <!-- 电价档位备注 -->
                <div class="border-b border-line bg-amber-50/40 px-6 py-4">
                  <div class="flex items-start gap-3">
                    <div
                      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-800"
                    >
                      !
                    </div>
                    <div class="min-w-0 flex-1">
                      <h3 class="text-sm font-semibold text-slate-800">电价档位备注</h3>
                      <div class="mt-3 grid gap-3 sm:grid-cols-3">
                        <div class="rounded-card border border-amber-200/70 bg-raised px-4 py-2.5">
                          <p class="text-xs text-slate-500">10 万度以内</p>
                          <p class="mt-1 text-lg font-semibold text-slate-900">
                            1.1 ~ 1.2<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                          </p>
                        </div>
                        <div class="rounded-card border border-amber-200/70 bg-raised px-4 py-2.5">
                          <p class="text-xs text-slate-500">20 万度以内</p>
                          <p class="mt-1 text-lg font-semibold text-slate-900">
                            0.9 ~ 1<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                          </p>
                        </div>
                        <div class="rounded-card border border-amber-200/70 bg-raised px-4 py-2.5">
                          <p class="text-xs text-slate-500">20 万度以上</p>
                          <p class="mt-1 text-lg font-semibold text-slate-900">
                            0.72<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <PanelState type="pending" title="电费预提" description="功能建设中，敬请期待" />
              </section>
            </div>

            <!-- 采购进度跟踪（变更-091）：需求登记 → 下单 → 到货的流水台账。
                 包装层接上 038/044/088 那张定高方子（卡片撑满 + 表格区自己滚 + 分页行钉底），
                 面板文件里是完整链条。 -->
            <div v-if="mountedTabs.has('purchase')" v-show="activeTab === 'purchase'" class="flex h-full flex-col">
              <PurchaseTrackingPanel />
            </div>

            <div v-if="mountedTabs.has('import')" v-show="activeTab === 'import'">
              <WorkOrderImport
                @cancel="handleImportCancel"
                @back="handleImportBack"
                @imported="importDirty = true"
              />
            </div>

            <div v-if="mountedTabs.has('imageParse')" v-show="activeTab === 'imageParse'">
              <ImageParse @confirmed="handleOcrConfirmed" />
            </div>
          </div>
        </div>
      </div>
    </main>
  </el-config-provider>
</template>

<style scoped>
/* 储罐图：切换罐型时淡出淡入 + 高度平滑过渡 */
.vessel-canvas {
  transition:
    aspect-ratio 320ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 200ms ease;
}

.vessel-canvas.is-switching {
  opacity: 0;
}

/*
 * 软拟态（Soft UI）液位控件：数字输入框 + 滑块
 *
 * ⚠️ 这一块是**工作台里唯一没跟着设计系统走形态的地方**（037 / 041 / 043 都只换颜色）：
 * 它自带的是一套**冷**色 —— 渐变 `#ffffff→#e8ecf1`、投影 `#a3b1c6`、输入框底 `#eef1f5`。
 * 037 全站暖化时它跟着转暖（不然压在暖白卡上就是使用方说的「与周围颜色不搭配」），
 * 041 全站回到冷调（天穹 + 白霜 + 苹果蓝），它**第二次跟着走**：
 * 渐变 `#fbfcfe→#e9eef6`、投影 `rgba(90,110,150,…)`。
 * 043 是**第三次**，但方向变了 —— 场与玻璃全部中性化之后，「跟着走」的定义回到
 * 「冷/暖之外」：渐变两端换成**纯中性**（`#fbfbfd→#eaebee`，B−R ≤ 3），输入框的
 * 静止底/聚焦底改为直接挂 token：`#edf2fc`→`#eeeef1`（当时 = `--el-fill-color` =
 * `region`）、聚焦底 `#e6f1fc`→`#e8e8e9`（当时 = `brand-50`）。投影色**这一次不换**——
 * `rgba(90,110,150,…)` 那点蓝在 35% 透明度下读不出来，强行中性化反而让投影发死。
 *
 * ⚠️ **x-minimalist 之后这里有一处刻意保留的数值漂移**（变更-057 只把它写清，没偷偷改）：
 * `region` 现在是 `#F7F7F5`、`brand-50` 是 `#E7E7E7`，而本块 scoped CSS 里那四个字面量
 * 仍是 043 的值（`#eeeef1` / `#e8e8e9` / 渐变 `#fbfbfd→#eaebee`）。逐通道差 1~10，
 * 肉眼不可辨，但上面那句"直接挂 token"现在**只剩历史准确**。
 * 这是一条**登记在案的设计例外**（DESIGN.md §4.2）：这块控件是工作台唯一的触觉控件，
 * 形态（软拟态凹槽 + 钮环 + 语义色带）被 spec §18 逐条钉着，让它跟随新令牌需要一次
 * 独立的形态决定（minimalist 的「近零阴影」与软拟态的凹槽本质冲突）。
 * 跟随的代价与做法都留在这里，等那次决定一起做。
 *
 * 变更-045 **第一次动到形态**：使用方要求「把输入框形式改成滑块」——
 * 两个软拟态步进圆钮（−/+）整体退役，改为同一套光影配方的轨道 + 圆钮滑块；
 * 数字输入框保留（865 / 1525 这类非整十的实测读数要能直接键入，滑块扫值、键盘录值）。
 * 圆钮的渐变与投影沿用上面那套（面色跟底色、光从左上来），轨道则是它的反面：
 * **压进去的凹槽**（inset 光影）—— 一颗实物钮推着凹槽走，凹凸关系才自洽。
 *
 * 变更-046 **收了形态**：使用方看过 045 实机截图后定稿「竖放 + 一根轨两个钮」——
 * 两根横轨收成一根竖轨（EP vertical + range）。凹槽 / 钮的光影配方原样沿用：竖过来
 * 光仍是左上来，inset 方向不用翻；竖轨的 bar 要盖掉 EP `.is-vertical` 的 `0 0 3px 3px`
 * 方角。钮环改用 `--v-thumb-lower` / `--v-thumb-upper`（使用处按「该钮代表哪个读数」
 * 注入语义色 —— 与起止解耦，倒挂时环色跟着换边）；钮的 border 从「2px 主色」改成
 * 「2px transparent + 分钮着色」，box-sizing: border-box，几何一字不差。
 *
 * 变更-048 **撤掉两根读数柱**（使用方拿实机截图定：「红色框选部分不要了，相应的信息
 * 通过引线指向滑块按钮」）：读数改成**挂在钮上的引线标注**（`.vessel-level-callout`，
 * 位置由脚本按「钮心 = 柱高 − 值/量程 × 柱高」注入），引线走画布差值标注那套折线；
 * 数字框不再画框、退成「带下划线的数字」（下划线即该读数的墨相）。
 *
 * 变更-058（x-minimalist）**换掉了材质**：软拟态那套光影整组退役 ——
 * 凹槽的两笔方向性内阴影、钮的渐变 + 四层投影、色带的压暗、输入框的亮出/压入，
 * 全部换成**垫底档位 + 1px 发丝线 + 语义环**（minimalist 的高程不来自光影）。
 * ⚠️ **几何一字未动**：轨厚 10 / 钮 22 / 钮座 30 / 对中量 −10px 全部照旧，
 * 拖动即时落位、引线标注、语义色带这些行为与语义也一字未动 ——
 * 换的只是"这块控件看起来是什么材质"，不是它怎么工作。
 *
 * 三件事仍然不动，且各有理由：
 *   ① `.vessel-canvas` 的**内容色**（液面按罐号取色的 PALETTE）—— 那是数据不是 chrome
 *      （见 DESIGN.md §4.1，落地页那张工程图的青色水面是同一条）；
 *   ② 语义红绿（`VESSEL_DELTA_COLOR`）—— 状态语义，全站唯一允许的高饱和；
 *   ③ 计算几何与键盘通路（可拖、可键入、可 Tab）。
 */
.vessel-level-slider {
  --el-slider-height: 10px;
  --el-slider-button-size: 22px;
  --el-slider-button-wrapper-size: 30px;
  /* 钮座在轨道上的横向对中量 =（轨厚 − 钮座）/ 2 =（10 − 30）/ 2。EP 出厂按
     （6 − 36）/ 2 = −15px 写死这个变量；045 改了轨厚与钮座却没跟它，钮一直偏 5px ——
     046 竖过来放大了这个偏心（左右偏），一并校正 */
  --el-slider-button-wrapper-offset: -10px;
}

.vessel-level-slider :deep(.el-slider__runway) {
  border-radius: 9999px;
  /*
   * x-minimalist（变更-058）：凹槽不再是软拟态的两笔方向性内阴影
   * （冷投影 `rgba(90,110,150,.32)` + 白高光）。这一代的高程不来自光影 ——
   * 「槽」靠**比纸深半档的垫底** + **1px 发丝线**读出来就够：
   *   · 底色挂 token `--el-fill-color`（= region，与全站垫底同一档）；
   *   · 描边走 `inset 0 0 0 1px` 的**扩散环**而不是 border —— 不动盒子几何
   *     （`--el-slider-button-wrapper-offset: -10px` 那套对中量是按 10px 轨厚算的，
   *     加真 border 会让它偏 1px）。
   */
  background-color: var(--el-fill-color);
  box-shadow: inset 0 0 0 1px #eaeaea;
}

/* 拖动要**即时跟手**（液面同步落位），所以钮与轨道都禁掉 CSS 过渡 ——
   留着的话钮会以 ~0.2s 自己滑过去，而液面是瞬移，二者肉眼可见地错位 */
.vessel-level-slider :deep(.el-slider__bar),
.vessel-level-slider :deep(.el-slider__button-wrapper) {
  transition: none;
}

/* 钮间色带 = 差值语义色（消耗玫红 / 增加翡翠），由使用处经 --el-slider-main-bg-color
   注入，与画布剖面线共用 VESSEL_DELTA_COLOR；两根线各自的墨色改走钮环（见下）。
   x-minimalist：那笔 `inset 0 1px 2px rgba(0,0,0,.14)` 压暗退役 —— 色带是**实色语义**，
   让颜色自己说话，而不是再叠一层"带子凸起"的错觉。 */
.vessel-level-slider :deep(.el-slider__bar) {
  border-radius: 9999px;
}

.vessel-level-slider :deep(.el-slider__button) {
  /* border-box：2px 环占钮径内圈，换成 transparent 只是「先不画」，几何与 045 一字不差 */
  border: 2px solid transparent;
  /*
   * x-minimalist（变更-058）：**平的白面**取代软拟态那套四层光影
   * （`linear-gradient(145deg,…)` + 外投影 + 白高光 + 内压暗 + 内高光）。
   * 钮的辨识现在靠两件事，都不依赖光影：
   *   ① 2px 的**语义环**（`--v-thumb-lower` / `--v-thumb-upper`，与读数同色）；
   *   ② 白面压在白纸上 —— 环就是它的边界（minimalist：border 取代 elevation）。
   * 顺带说明为什么这次可以删而不心虚：拖动是**瞬时**的（见下面的 transition: none），
   * 那套光影从来不参与"手感"，只参与观感。
   */
  background-color: #ffffff;
}

/* 钮环 = 该钮代表的读数色。range 模式下轨道子的 DOM 序 = [bar, 下钮, 上钮]：
   nth-child(2) 是下钮、nth-child(3) 是上钮 —— 与值的高低走，与起止解耦 */
.vessel-level-slider
  :deep(.el-slider__runway > .el-slider__button-wrapper:nth-child(2) .el-slider__button) {
  border-color: var(--v-thumb-lower);
}

.vessel-level-slider
  :deep(.el-slider__runway > .el-slider__button-wrapper:nth-child(3) .el-slider__button) {
  border-color: var(--v-thumb-upper);
}

/* 键盘聚焦：EP 自带的焦点表现落在被上面覆写的钮上，这里显式补一圈
   （墨色 = x-minimalist 的主色 #111111；043 那代是 #171719） */
.vessel-level-slider :deep(.el-slider__button-wrapper:focus-visible .el-slider__button) {
  outline: 2px solid #111111;
  outline-offset: 2px;
}

/* 引线层：与定高柱同一坐标系（无 viewBox，用户单位即 px）。
   overflow: visible —— 引线要从柱里伸出去指到标注栏 */
.vessel-level-leader {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
}

/* 读数标注：绝对定位在标注栏里，top 由使用处按「钮心」注入（见 vesselCalloutTops），
   translateY(-50%) 让标注以钮心为中轴。**刻意不给过渡** —— 钮与液面都是瞬移
   （046 的规矩），标注自己滑会跟钮错开，引线圆点就对不上了 */
.vessel-level-callout {
  position: absolute;
  left: 76px;
  width: 216px;
  transform: translateY(-50%);
}

/* 液位数字：仍可键入（865 / 1525 这类实测读数落不到步长格点上，「扫值」与
   「录值」是两种手势 —— 045 定的分工）；048 起**不再画框**，退成「带下划线的数字」：
   下划线即该读数的墨相（起始虚线 / 终止实线，与画布那两根线、钮环同一只墨，
   经外层的 --v-callout-ink 带进来）。
   x-minimalist（变更-058）：悬停/聚焦不再用软拟态的"亮出/压入"两笔方向性光影，
   改成**三档垫底 + 1px 发丝环**：悬停浮起一档（`-lighter`）、聚焦落下两档（`fill`
   = region）并亮出发丝环 —— 「按进去录值」这层意思还在，但它由**深浅**说，
   不由投影说。三个值全部挂 EP 的填充 token（region 系），不再写 043 的字面量。 */
.vessel-level-input {
  border: none;
  border-bottom: 1px dashed var(--v-callout-ink);
  border-radius: 6px;
  padding: 1px 4px;
  width: 3.75rem;
  background-color: transparent;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  outline: none;
  box-shadow: none;
  font-variant-numeric: tabular-nums;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}

/* 终止的下划线是实线 —— 与它在图上那根实线液面同相 */
.vessel-level-callout-end .vessel-level-input {
  border-bottom-style: solid;
}

.vessel-level-input:hover {
  background-color: var(--el-fill-color-lighter);
}

/* 聚焦 = 落下一档 + 发丝环（"按入"的扁平写法，取代原来的 inset 光影） */
.vessel-level-input:focus {
  background-color: var(--el-fill-color);
  border-bottom-color: transparent;
  box-shadow: inset 0 0 0 1px #eaeaea;
}

.vessel-level-input::-webkit-outer-spin-button,
.vessel-level-input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
  appearance: none;
}

.vessel-level-input {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* 储罐选择器：按标题样式呈现 */
.vessel-select {
  width: 224px; /* 固定宽度，避免被 Element Plus 默认样式拉伸到整行 */
}

.vessel-select :deep(.el-select__wrapper) {
  padding: 7px 12px;
  font-size: 15px;
  font-weight: 600;
  color: rgb(15 23 42);
  border-radius: 10px;
  box-shadow: 0 0 0 1px rgb(203 213 225) inset;
  transition: box-shadow 0.2s ease;
}

.vessel-select :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px rgb(148 163 184) inset;
}

/* 聚焦环跟随主色（变更-043：苹果蓝 brand/brand-100 → 石墨 brand/brand-100。
   变更-033 起的规矩没变：正文界面的聚焦环一律用主色档，
   天蓝（statusTones 的 info）不在这出现） */
.vessel-select :deep(.el-select__wrapper.is-focused) {
  box-shadow:
    0 0 0 1px rgb(29 29 31) inset,
    0 0 0 3px rgb(210 210 210);
}

/* 公式排版：衬线斜体变量 + 真分数 + 根号上划线 */
.math-formula {
  font-family: Cambria, 'Cambria Math', 'Times New Roman', 'Songti SC', serif;
  font-size: 16px;
  line-height: 2.1;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.math-formula i {
  font-style: italic;
}

.math-formula sub {
  font-size: 0.7em;
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

.math-formula .frac > span:first-child {
  border-bottom: 1px solid currentColor;
  padding: 0 5px;
}

.math-formula .frac > span:last-child {
  padding: 0 5px;
}

.math-formula .sqrt > span {
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
