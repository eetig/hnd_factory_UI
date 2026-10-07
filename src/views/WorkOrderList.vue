<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
import WorkOrderImport from './WorkOrderImport.vue'
import ImageParse from './ImageParse.vue'
import { getReportOrderType } from '../constants/orderTypes'
import { STATUS_TEXT } from '../constants/statusTones'
import {
  getLastWeekMonday,
  getLastWeekSunday,
  formatMonthDay,
  formatQty,
} from '../utils/format'
import { UTubeBundle, shellVolumeMm3 } from '../utils/vesselVolume'
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

// 切换登录态后，原先所在 Tab 可能已不可见 —— 兜底切到第一个可见 Tab，
// 否则会停在一个空白的 activeTab 上。
//
// immediate 是必须的：非 admin 打开页面时首屏默认 Tab（工单汇总）本就不可见，
// 而 visibleTabs 只在「值发生变化」时才触发回调，首次渲染的可见列表
// 是在这之前就定下来的 —— 不加 immediate 页面会停在隐藏面板上，看起来一片空白。
// 同理，这个 watch 必须放在 activeTab 声明之后（immediate 会立刻读到它，放前面撞 TDZ）。
watch(visibleTabs, (list) => {
  if (list.length && !list.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = list[0].key
  }
}, { immediate: true })

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
const groupTabs = computed(() => visibleTabs.value.filter((tab) => tab.group === currentGroup.value))

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
const activeTabLabel = computed(
  () => tabs.find((tab) => tab.key === activeTab.value)?.label ?? '',
)

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

// 工单数据与筛选（与工单报工面板共享同一份数据）
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
  getPageData,
  filterWorkOrders,
  fetchWorkOrders,
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

// 领料汇总数据（与原辅料核算面板共享；周统计已改为走后端汇总接口，不再要全量记录）
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
  getPickPageData,
  filterPickRecords,
  fetchPickRecords,
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

/** 「只看有库存」开关：改完立刻重过滤 */
function toggleStockOnlyInStock(value) {
  stockOnlyInStock.value = value
  applyStockFilter()
}

// 入库汇总数据（与工单核算面板共享；周统计已改为走后端汇总接口，不再要全量记录）
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
  getInboundPageData,
  filterInboundRecords,
  fetchInboundRecords,
  openInboundMaterialDialog,
  handleInboundMaterialSelected,
  clearInboundMaterialFilter,
} = useInboundData()

// 货物移动数据（原辅料核算的「已报工数」来源；数据本身由 useStatsData 读取）
// 注意：货物移动加载失败状态（goodsMoveError）目前没有在界面上呈现，
// 只有其它数据源的错误提示，这里保留现状并在此备注，避免被误当成死代码清掉。
const { fetchGoodsMoveRecords } = useGoodsMoveData()

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
 * 导入会新增/更新四类数据（工单、领料、入库、货物移动），
 * 而它们又是工单报工、工单核算、原辅料核算、周统计的数据源 —— 因此全部重新拉取。
 *
 * 注意：不能只在「返回工单汇总」按钮里刷新 —— 用户也可能直接点顶部 Tab 切走，
 * 所以用 importDirty 标记 + activeTab 监听统一处理。
 */
const importDirty = ref(false)

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
  fetchGoodsMoveRecords()
}

function refreshAllData() {
  fetchAdminOnlyData()
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



// ===== 入库汇总 =====
const inboundColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'inboundDate', label: '入库时间', width: 'w-36' },
  { key: 'materialName', label: '物料名称', width: 'w-[200px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'inboundQty', label: '领料数量', width: 'w-28', align: 'right' },
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

// 这个页面是**纯前端计算**（公式在本地），台账取不到时会退到本地缓存，见 useVesselList
onMounted(loadVessels)

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

  const medium = g.medium && g.density
    ? `介质 ${g.medium}（ρ=${g.density} g/cm³，20°C、101.325 kPa）｜`
    : ''

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
    const hasBottomHead =
      geometry.bottomHeadDepth > 0 && bounds.tangentBottom !== undefined
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

      // 底色
      ctx.fillStyle = isDecrease ? 'rgba(244, 63, 94, 0.1)' : 'rgba(16, 185, 129, 0.12)'
      ctx.fillRect(tankLeft, bandTop, bandWidth, bandHeight)

      // 斜线剖面线
      ctx.globalAlpha = 0.4
      ctx.strokeStyle = isDecrease ? '#e11d48' : '#059669'
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
      const color = isDecrease ? '#e11d48' : '#059669'

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

      ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`
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

// 步进调节液位（配合软拟态按钮）
function stepVesselLevel(which, direction, step = 10) {
  const targetRef = levelTargetRef(which)
  const next = Number(targetRef.value || 0) + direction * step
  targetRef.value = Math.max(0, Math.min(vesselGeometry.value.maxLevel, next))
}

// 按住按钮时连续调节：先响应一次，停顿 320ms 后进入连发，步长加大以便快速扫过
let vesselStepDelayTimer = null
let vesselStepRepeatTimer = null

function stopStepHold() {
  if (vesselStepDelayTimer) {
    clearTimeout(vesselStepDelayTimer)
    vesselStepDelayTimer = null
  }
  if (vesselStepRepeatTimer) {
    clearInterval(vesselStepRepeatTimer)
    vesselStepRepeatTimer = null
  }
  window.removeEventListener('pointerup', stopStepHold)
  window.removeEventListener('pointercancel', stopStepHold)
}

function startStepHold(which, direction) {
  stopStepHold()
  stepVesselLevel(which, direction)

  vesselStepDelayTimer = setTimeout(() => {
    vesselStepRepeatTimer = setInterval(() => stepVesselLevel(which, direction, 25), 40)
  }, 320)

  // 在按钮外松开鼠标也能停止
  window.addEventListener('pointerup', stopStepHold)
  window.addEventListener('pointercancel', stopStepHold)
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
  stopStepHold()
})

// 切到压力容器 Tab 时按需加载底图 + 启动波纹动画，离开时停帧
watch(activeTab, (tab, prevTab) => {
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

  // 离开导入页且期间导入成功 → 刷新各数据集
  if (prevTab === 'import' && importDirty.value) {
    importDirty.value = false
    refreshAllData()
  }
})
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="min-h-screen bg-slate-50">
    <!--
      外壳**不再限宽居中**（原先这里挂的是 mx-auto max-w-[1600px]，我早先加的）。
      留着它，那块浮动面板离视口左边就是 (视口−1600)/2 + 16 —— 1664 的屏上量出来 48px，
      跟使用方要的「四边 16px」对不上；屏幕越宽偏得越多。
      主区不再被压到 1600：几个台账表格本来就宽，宽出来正好摊开列。
    -->
    <div class="flex">
      <!--
        左侧栏：用户信息 + 四个大类 + 设置（2026-10-07 改成 dashboard 布局）。

        分组只是「怎么看这些页」，**不新增状态** —— 当前组由 activeTab 推导（见 currentGroup），
        所以「登录/退出后自动切页」「导入返回跳回工单汇总」这些既有逻辑一行都不用动。

        窄屏不隐藏：页签从顶部挪走了，侧栏是**唯一**的页面入口，藏掉就没法切页了。
        代价是窄窗口下主区被压窄（主区自己会横向滚），比「没有导航」可接受得多。
      -->
      <!--
        整块做成**浮动面板**：四边 16px 外边距、圆角 20px、一层低透明度柔和投影（使用方 2026-10-07 定）。
        原先这里是三张各自带边框的小卡片，现在并成一块 —— 浮起来之后还分层画边框，
        会变成「面板里套卡片」的双层轮廓，反而糊。

        sticky 用 top-4（与那 16px 是同一个数）：长页面滚动时面板跟着走，
        滚起来不会出现「先贴上边、再被 16px 顶开」的突兀感。

        面板**撑满可用高度**（使用方 2026-10-07 追加）：此前高度跟着内容走，
        aside 被 main 的 min-h-screen 撑满、面板却只有小半截，下面空出一条竖带。
        高度取 100vh − 上下各 16px，正好与外边距凑成整屏：
        16 + (100vh − 32px) + 16 = 100vh，因此不会凭空空出一条页面滚动条。

        flex-col + 导航 flex-1：「设置 / 共 N 条工单」落到面板底部（内容短时靠底对齐，
        不浮在半空）。整块再兜一层 overflow-y-auto —— 窗口特别矮或以后大类变多时，
        退化成「整面板自己滚」，而不是把内容溢出到圆角外面。
      -->
      <aside class="w-56 shrink-0">
        <div
          class="sticky top-4 m-4 flex h-[calc(100vh-2rem)] flex-col overflow-y-auto rounded-card bg-white p-4 shadow-card"
        >
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Factory Operations</p>
          <p class="mt-1 text-lg font-bold tracking-tight text-slate-900">HND生产助手</p>
          <p class="mt-1 text-xs text-slate-500">生产工单与物料数据查询助手</p>

          <!-- 分区之间只用一条细分割线：面板本身已经浮起来了，
               再给每块画边框就成了「面板里套卡片」的双层轮廓，反而糊 -->
          <nav class="mt-3 flex-1 space-y-1 border-t border-slate-100 pt-3" aria-label="功能分类">
            <button
              v-for="group in sidebarGroups"
              :key="group.key"
              type="button"
              class="w-full rounded-xl px-3 py-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:scale-[0.99]"
              :class="
                currentGroup === group.key
                  ? 'bg-sky-50 font-medium text-sky-700'
                  : 'text-slate-600 hover:bg-slate-50'
              "
              @click="selectGroup(group.key)"
            >
              {{ group.label }}
              <span class="mt-0.5 block text-xs font-normal text-slate-500">{{ group.hint }}</span>
            </button>
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
          <div class="mt-3 border-t border-slate-100 pt-3 text-sm">
            <template v-if="loggedIn">
              <p class="font-medium text-slate-700">{{ roleName }}</p>
              <button
                type="button"
                class="mt-1 rounded-xl px-1.5 py-0.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 active:scale-[0.98]"
                @click="handleLogout"
              >
                退出登录
              </button>
            </template>
            <template v-else>
              <p class="text-slate-500">只读浏览</p>
              <button
                type="button"
                class="mt-1 rounded-xl px-2 py-0.5 font-medium text-sky-700 transition hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:scale-[0.98]"
                @click="goLogin"
              >
                登录
              </button>
            </template>
          </div>
        </div>
      </aside>

      <!--
        主区**左边不留内边距**：侧栏那块浮动面板自己带 16px 外边距（m-4），
        这里再补一层就成 32px 的缝，跟「四边 16px」对不上。
        py-4 则是与面板的上下 16px 对齐。
      -->
      <div class="min-w-0 flex-1 py-4 pr-4 sm:pr-6">

      <!-- 主区顶部：当前页标题 + **同组页面的卡片**。
           页签从顶部横条挪到了这里（放上方而不是照示意图放底部）：切页不必先滚到最底。
           卡片行沿用原来 Tab 条的横向滚动写法（见下方注释），只是把下划线换成了卡片态。 -->
      <div class="mb-4">
        <h2 class="mb-4 text-xl font-bold tracking-tight text-slate-900">{{ activeTabLabel }}</h2>
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
            class="shrink-0 whitespace-nowrap rounded-xl border px-3 py-1.5 text-sm transition focus:outline-none"
            :class="
              activeTab === tab.key
                ? 'border-sky-200 bg-sky-50 font-medium text-sky-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800'
            "
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <div v-show="activeTab === 'workOrder'">
        <section class="rounded-card border border-slate-200 bg-white shadow-card">
          <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
            <el-date-picker
              v-model="startDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="起始日期"
              :first-day-of-week="1"
              @change="filterWorkOrders"
            />
            <span class="text-sm text-slate-500">至</span>
            <el-date-picker
              v-model="endDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              :first-day-of-week="1"
              @change="filterWorkOrders"
            />
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
            <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
              <colgroup>
                <col v-for="column in columns" :key="column.key" :class="column.width" />
              </colgroup>
              <thead class="bg-slate-50">
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
              <tbody class="divide-y divide-slate-100 bg-white">
                <tr v-if="tableData.length === 0">
                  <td :colspan="columns.length" class="px-3 py-16 text-center text-sm text-slate-500">
                    没有符合筛选条件的工单
                  </td>
                </tr>
                <tr v-for="(order, index) in tableData" :key="`${order.orderNo}-${index}`" class="cursor-pointer transition hover:bg-slate-50" @click="openImageDialog(order)">
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">{{ (pageNum - 1) * pageSize + index + 1 }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ order.planStartDate }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ order.orderNo }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ getReportOrderType(order.orderNo) }}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ order.materialCode }}</td>
                  <td class="max-w-[180px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700">
                    {{ order.materialDesc }}
                  </td>
                  <td class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">{{ order.orderQty }}</td>
                  <td class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">{{ order.confirmedQty }}</td>
                  <td class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">{{ order.deliveredQty }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex justify-end border-t border-slate-100 px-6 py-4">
            <el-pagination
              v-model:current-page="pageNum"
              :page-size="pageSize"
              :total="total"
              layout="total, prev, pager, next"
              background
              @current-change="getPageData"
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

      <div v-show="activeTab === 'material'">
        <section class="rounded-card border border-slate-200 bg-white shadow-card">
          <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3">
            <el-date-picker
              v-model="pickStartDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="起始日期"
              :first-day-of-week="1"
              @change="filterPickRecords"
            />
            <span class="text-sm text-slate-500">至</span>
            <el-date-picker
              v-model="pickEndDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              :first-day-of-week="1"
              @change="filterPickRecords"
            />
            <span class="ml-auto text-sm text-slate-500">
              共 <span class="font-semibold text-slate-900">{{ pickTotal }}</span> 条记录
            </span>
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
                <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
                  <colgroup>
                    <col v-for="column in pickColumns" :key="column.key" :class="column.width" />
                  </colgroup>
                  <thead class="bg-slate-50">
                    <tr>
                      <th
                        v-for="column in pickColumns"
                        :key="column.key"
                        scope="col"
                        class="whitespace-nowrap py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
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
                  <tbody class="divide-y divide-slate-100 bg-white">
                    <tr
                      v-for="(record, index) in pickTableData"
                      :key="`${record.materialCode}-${record.pickDate}-${index}`"
                      class="transition hover:bg-slate-50"
                    >
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">{{ (pickPageNum - 1) * pickPageSize + index + 1 }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ record.pickDate }}</td>
                      <td class="max-w-[200px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700">
                        {{ record.materialName }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ record.materialCode }}</td>
                      <td class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">{{ record.pickQty }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ record.unit }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                        <span
                          class="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-500"
                          :aria-label="record.imageUrl || record.thumbnailUrl ? '查看领料单据' : '暂无图片'"
                          @click="openPickImageDialog(record)"
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
                            class="absolute inset-0 h-5 w-5 rounded-xl border border-slate-200 bg-white object-cover transition hover:opacity-80"
                            @error="handleImgError($event, record)"
                          />
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="flex justify-end border-t border-slate-100 px-6 py-3">
                <el-pagination
                  v-model:current-page="pickPageNum"
                  :page-size="pickPageSize"
                  :total="pickTotal"
                  layout="total, prev, pager, next"
                  background
                  @current-change="getPickPageData"
                />
              </div>
            </div>
          </div>
        </section>

        <el-dialog
          v-model="pickImageDialogVisible"
          width="70vw"
          align-center
        >
          <div class="flex min-h-[400px] items-center justify-center rounded-card bg-slate-50 p-6">
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

      <div v-show="activeTab === 'inbound'">
        <section class="rounded-card border border-slate-200 bg-white shadow-card">
          <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3">
            <el-date-picker
              v-model="inboundStartDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="起始日期"
              :first-day-of-week="1"
              @change="filterInboundRecords"
            />
            <span class="text-sm text-slate-500">至</span>
            <el-date-picker
              v-model="inboundEndDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              :first-day-of-week="1"
              @change="filterInboundRecords"
            />
            <span class="ml-auto text-sm text-slate-500">
              共 <span class="font-semibold text-slate-900">{{ inboundTotal }}</span> 条记录
            </span>
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
                <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
                  <colgroup>
                    <col v-for="column in inboundColumns" :key="column.key" :class="column.width" />
                  </colgroup>
                  <thead class="bg-slate-50">
                    <tr>
                      <th
                        v-for="column in inboundColumns"
                        :key="column.key"
                        scope="col"
                        class="whitespace-nowrap py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
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
                  <tbody class="divide-y divide-slate-100 bg-white">
                    <tr
                      v-for="(record, index) in inboundTableData"
                      :key="`${record.materialCode}-${record.inboundDate}-${index}`"
                      class="transition hover:bg-slate-50"
                    >
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">{{ (inboundPageNum - 1) * inboundPageSize + index + 1 }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ record.inboundDate }}</td>
                      <td class="max-w-[200px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700">
                        {{ record.materialName }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ record.materialCode }}</td>
                      <td class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">{{ record.inboundQty }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ record.unit }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                        <span
                          class="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-500"
                          :aria-label="record.imageUrl || record.thumbnailUrl ? '查看入库单据' : '暂无图片'"
                          @click="openInboundImageDialog(record)"
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
                            class="absolute inset-0 h-5 w-5 rounded-xl border border-slate-200 bg-white object-cover transition hover:opacity-80"
                            @error="handleImgError($event, record)"
                          />
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="flex justify-end border-t border-slate-100 px-6 py-3">
                <el-pagination
                  v-model:current-page="inboundPageNum"
                  :page-size="inboundPageSize"
                  :total="inboundTotal"
                  layout="total, prev, pager, next"
                  background
                  @current-change="getInboundPageData"
                />
              </div>
            </div>
          </div>
        </section>

        <el-dialog
          v-model="inboundImageDialogVisible"
          width="70vw"
          align-center
        >
          <div class="flex min-h-[400px] items-center justify-center rounded-card bg-slate-50 p-6">
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

      <div v-show="activeTab === 'report'">
        <StatsTable
          :columns="reportColumns"
          :rows="reportRows"
          empty-text="暂无报工数据"
          :row-key="statsRowKey"
        />
      </div>

      <div v-show="activeTab === 'costing'">
        <StatsTable
          :columns="costingColumns"
          :rows="costingRows"
          empty-text="暂无核算数据"
          :row-key="statsRowKey"
        />
      </div>

      <div v-show="activeTab === 'materialCosting'">
        <StatsTable
          :columns="materialCostingColumns"
          :rows="materialCostingRows"
          empty-text="暂无核算数据"
          :row-key="statsRowKey"
        />
      </div>

      <div v-show="activeTab === 'stock'">
        <section class="rounded-card border border-slate-200 bg-white shadow-card">
          <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3">
            <el-input
              v-model="stockKeyword"
              placeholder="物料编码 / 物料名称 / 规格"
              clearable
              class="w-72"
              @input="applyStockFilter"
              @clear="applyStockFilter"
            />
            <!-- 默认**不勾**：这一页是查物料信息，要把数量为 0 的物料也列出来 -->
            <el-checkbox :model-value="stockOnlyInStock" @change="toggleStockOnlyInStock">
              只看有库存
            </el-checkbox>
            <span class="ml-auto text-sm text-slate-500">
              共 <span class="font-semibold text-slate-900">{{ stockTotal }}</span> 条记录
            </span>
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

            <PanelState
              v-else-if="stockTableData.length === 0"
              :title="stockKeyword || stockOnlyInStock ? '没有符合筛选条件的记录' : '暂无库存数据'"
              :description="
                stockKeyword || stockOnlyInStock
                  ? '换个关键词，或取消勾选「只看有库存」看看'
                  : '还没有导入过库存汇总，可在「文件导入」里上传库存表'
              "
            />

            <div v-else>
              <!-- 9 列在窄窗口下会溢出：外层 overflow-x-auto + colgroup 定宽，
                   与领料 / 入库汇总那两张表同一套写法 -->
              <div class="overflow-x-auto">
                <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
                  <colgroup>
                    <col v-for="column in stockColumns" :key="column.key" :class="column.width" />
                  </colgroup>
                  <thead class="bg-slate-50">
                    <tr>
                      <th
                        v-for="column in stockColumns"
                        :key="column.key"
                        scope="col"
                        class="whitespace-nowrap py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                        :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                      >
                        {{ column.label }}
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 bg-white">
                    <tr
                      v-for="(record, index) in stockTableData"
                      :key="`${record.plantCode}-${record.materialCode}-${record.storageLocation}-${index}`"
                      class="transition hover:bg-slate-50"
                    >
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">{{ (stockPageNum - 1) * stockPageSize + index + 1 }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ displayText(record.materialCode) }}</td>
                      <td class="max-w-[220px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700">{{ displayText(record.materialName) }}</td>
                      <td class="max-w-[160px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-600">{{ displayText(record.spec) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ displayText(record.storageLocation) }}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">{{ displayText(record.unit) }}</td>
                      <td
                        class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm font-semibold"
                        :class="Number(record.stockQty) > 0 ? 'text-slate-900' : 'text-slate-500'"
                      >
                        {{ displayText(formatStockQty(record.stockQty)) }}
                      </td>
                      <td class="max-w-[180px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-600">{{ displayText(record.storageDesc) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="flex justify-end border-t border-slate-100 px-6 py-3">
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

      <div v-show="activeTab === 'weekly'">
        <section class="rounded-card border border-slate-200 bg-white shadow-card">
          <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
            <el-date-picker
              v-model="weeklyStartDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="起始日期"
              :first-day-of-week="1"
            />
            <span class="text-sm text-slate-500">至</span>
            <el-date-picker
              v-model="weeklyEndDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
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
                      <th colspan="5" class="border border-slate-300 px-3 py-2.5 text-base font-bold tracking-wide text-slate-800">
                        {{ weeklyTitle }}
                      </th>
                    </tr>
                    <tr>
                      <th
                        v-for="column in weeklyColumns"
                        :key="column.key"
                        scope="col"
                        class="border border-slate-300 bg-cyan-100 py-3 text-sm font-semibold text-slate-700"
                        :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                      >
                        {{ column.label }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in weeklyRows" :key="row.name">
                      <td class="border border-slate-300 px-3 py-2.5 text-sm text-slate-700">{{ row.name }}</td>
                      <td class="border border-slate-300 py-2.5 pl-3 pr-5 text-right text-sm text-slate-700">{{ row.pickQty }}</td>
                      <td class="border border-slate-300 p-0">
                        <input
                          v-model="weeklyRemaining[row.materialCode]"
                          type="text"
                          placeholder="/"
                          aria-label="车间剩余"
                          class="w-full bg-transparent py-2.5 pl-3 pr-5 text-right text-sm text-slate-700 outline-none transition placeholder:text-slate-500 hover:bg-slate-50 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-sky-300"
                        />
                      </td>
                      <td class="border border-slate-300 py-2.5 pl-3 pr-5 text-right text-sm text-slate-700">{{ row.actualQty }}</td>
                      <td class="border border-slate-300 px-3 py-2.5 text-sm text-slate-700">{{ row.unitConsumption }} {{ row.unitLabel }}</td>
                    </tr>
                    <tr>
                      <td class="border border-slate-300 px-3 py-2.5 text-sm text-slate-700">{{ weeklyInboundRow.name }}</td>
                      <td colspan="4" class="border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-800">
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

      <div v-show="activeTab === 'daily'">
        <section class="rounded-card border border-slate-200 bg-white shadow-card">
          <PanelState
              title="日报表记录"
              description="功能建设中，敬请期待"
            />
        </section>
      </div>

      <div v-show="activeTab === 'tankLevel'">
        <TankLevelPanel />
      </div>

      <!-- 设备数据维护（2026-10-06）：页签按 equipment:edit 权限显隐，写接口另有 admin 闸门 -->
      <div v-show="activeTab === 'equipment'">
        <EquipmentMaintenancePanel />
      </div>

      <div v-show="activeTab === 'vessel'">
        <section class="rounded-card border border-slate-200 bg-white shadow-card">
          <!-- 容器清单来自设备台账（异步）。取不到时必须给出明确提示：
               这个页面是纯前端计算，清单空了就什么都算不了，而页面本身不会报错，
               只会静静地显示一台空白罐与 0.00 —— 看着像「算出来是 0」。 -->
          <div
            v-if="vesselsLoading && !vessels.length"
            class="border-b border-slate-100 px-6 py-3 text-xs text-slate-500"
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

          <!-- 储罐切换：位置在两种罐型下保持一致，切换时不跳动 -->
          <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-slate-100 px-6 py-4">
            <div class="min-w-0 flex-1">
              <p class="text-xs text-slate-500">{{ vesselDescription }}</p>
              <p v-if="vesselGeometry.note" class="mt-1 text-xs font-medium text-amber-700">
                {{ vesselGeometry.note }}
              </p>
              <!-- 录入对账：几何与台账的封头容积对不上时单独一行红字（不阻断计算 ——
                   页面算的是按几何来的，台账那列只用于核对） -->
              <p v-if="vesselReconcileWarning" class="mt-1 text-xs font-medium text-rose-600">
                {{ vesselReconcileWarning }}
              </p>
              <p v-if="vesselBundleWarning" class="mt-1 text-xs font-medium text-rose-600">
                {{ vesselBundleWarning }}
              </p>
            </div>
            <el-select v-model="vesselKey" class="vessel-select shrink-0" aria-label="选择储罐">
              <el-option
                v-for="vessel in vessels"
                :key="vessel.key"
                :label="vessel.label"
                :value="vessel.key"
              />
            </el-select>
          </div>

          <div class="flex flex-wrap items-stretch" :class="isVerticalVessel ? 'gap-x-6 p-6' : ''">
            <div class="flex justify-center" :class="isVerticalVessel ? 'shrink-0' : 'w-full p-6'">
              <canvas
              ref="vesselCanvas"
              class="vessel-canvas mx-auto block w-full"
              :class="{ 'is-switching': vesselSwitching }"
              :style="{
                maxWidth: `${vesselGeometry.displayWidth}px`,
                aspectRatio: String(vesselCanvasAspect),
              }"
            ></canvas>
            </div>

            <div :class="isVerticalVessel ? 'flex min-w-0 flex-1 flex-col justify-center' : 'w-full'">
            <!-- 横版：体积变化在左、液位控制列在右；竖版：体积变化居中在上 -->
            <div
              class="flex flex-wrap items-center justify-between gap-x-8 gap-y-5"
              :class="isVerticalVessel ? 'flex-col' : 'border-t border-slate-100 px-6 pt-5'"
            >
            <!-- 体积变化：横版居中于左侧空区，竖版居中在上 -->
            <div class="flex justify-center" :class="isVerticalVessel ? 'w-full' : 'flex-1'">
            <!-- 体积变化：居中作为视觉焦点 -->
            <div
                class="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1"
                :class="isVerticalVessel ? 'px-0 pb-4 pt-5' : 'rounded-card border border-slate-200 bg-slate-50 px-6 py-4'"
            >
              <span class="text-sm text-slate-500">体积变化</span>
              <!-- 24px 粗体属「大字号」，阈值 3:1，-600 已过 —— 与下面那处刻意不同，别对齐 -->
              <span
                class="text-2xl font-bold tracking-tight"
                :class="vesselVolumeDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'"
              >{{ vesselVolumeDelta >= 0 ? '+' : '' }}{{ vesselVolumeDelta.toFixed(2) }}</span>
              <span class="text-sm text-slate-500">m³</span>
              <span
                v-if="vesselMassDelta !== null"
                class="text-base font-semibold"
                :class="vesselVolumeDelta >= 0 ? STATUS_TEXT.success : STATUS_TEXT.error"
              >（{{ vesselMassDelta >= 0 ? '+' : '' }}{{ vesselMassDelta.toFixed(2) }} t）</span>
            </div>
            </div>

            <div
                class="gap-x-6 gap-y-5"
                :class="
                  isVerticalVessel
                    ? 'grid w-full grid-cols-2 px-0'
                    : 'flex flex-wrap gap-x-6'
                "
              >
              <!-- 起始液位：控件与其数据同列 -->
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 shadow-[0_6px_16px_-6px_rgba(15,23,42,0.18)]">
                  <span class="flex items-center gap-2 whitespace-nowrap text-sm text-slate-700">
                    <span class="inline-block h-0 w-5 border-t-2 border-dashed border-slate-800" aria-hidden="true"></span>
                    起始液位
                  </span>
                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      class="vessel-step"
                      aria-label="降低起始液位"
                      @pointerdown.prevent="startStepHold('start', -1)"
                      @keydown.enter.prevent="stepVesselLevel('start', -1)"
                      @keydown.space.prevent="stepVesselLevel('start', -1)"
                    >
                      −
                    </button>
                    <input
                      v-model.number="vesselStartLevel"
                      type="number"
                      min="0"
                      :max="vesselGeometry.maxLevel"
                      step="10"
                      class="vessel-level-input w-20 min-w-0 text-right"
                    />
                    <button
                      type="button"
                      class="vessel-step"
                      aria-label="升高起始液位"
                      @pointerdown.prevent="startStepHold('start', 1)"
                      @keydown.enter.prevent="stepVesselLevel('start', 1)"
                      @keydown.space.prevent="stepVesselLevel('start', 1)"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div class="space-y-1 pl-1 text-sm text-slate-500">
                  <div>
                    液位：<span class="font-semibold text-slate-900">{{ Math.round(vesselStartDisplay) }}</span> mm
                  </div>
                  <div>
                    体积：<span class="font-semibold text-sky-700">{{ vesselStartVolume.toFixed(2) }}</span> m³<template v-if="vesselStartMass !== null"><span class="ml-1 text-slate-500">（{{ vesselStartMass.toFixed(2) }} t）</span></template>
                  </div>
                </div>
              </div>

              <!-- 终止液位：控件与其数据同列 -->
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 shadow-[0_6px_16px_-6px_rgba(15,23,42,0.18)]">
                  <span class="flex items-center gap-2 whitespace-nowrap text-sm text-slate-700">
                    <span
                      class="inline-block h-0 w-5 border-t-2"
                      :style="{ borderColor: vesselGeometry.liquid.line }"
                      aria-hidden="true"
                    ></span>
                    终止液位
                  </span>
                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      class="vessel-step"
                      aria-label="降低终止液位"
                      @pointerdown.prevent="startStepHold('end', -1)"
                      @keydown.enter.prevent="stepVesselLevel('end', -1)"
                      @keydown.space.prevent="stepVesselLevel('end', -1)"
                    >
                      −
                    </button>
                    <input
                      v-model.number="vesselEndLevel"
                      type="number"
                      min="0"
                      :max="vesselGeometry.maxLevel"
                      step="10"
                      class="vessel-level-input w-20 min-w-0 text-right"
                    />
                    <button
                      type="button"
                      class="vessel-step"
                      aria-label="升高终止液位"
                      @pointerdown.prevent="startStepHold('end', 1)"
                      @keydown.enter.prevent="stepVesselLevel('end', 1)"
                      @keydown.space.prevent="stepVesselLevel('end', 1)"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div class="space-y-1 pl-1 text-sm text-slate-500">
                  <div>
                    液位：<span class="font-semibold text-slate-900">{{ Math.round(vesselEndDisplay) }}</span> mm
                  </div>
                  <div>
                    体积：<span class="font-semibold text-sky-700">{{ vesselEndVolume.toFixed(2) }}</span> m³<template v-if="vesselEndMass !== null"><span class="ml-1 text-slate-500">（{{ vesselEndMass.toFixed(2) }} t）</span></template>
                  </div>
                </div>
              </div>
            </div>
            </div>
            </div>
          </div>

          <div class="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
            <div class="mx-auto max-w-[900px] overflow-x-auto">
              <p class="mb-3 text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                液体体积计算公式
              </p>

              <div v-if="vesselGeometry.type === 'vertical'" class="math-formula text-center text-slate-700">
                <div>
                  <i>V</i>(<i>h</i>) = π<i>r</i>²<i>h</i>
                  <span class="ml-2 text-xs text-slate-500">（<i>h</i> ≤ <i>H</i>，筒体段）</span>
                  <span class="mx-7 text-slate-500" aria-hidden="true">｜</span>
                  <i>V</i>(<i>h</i>) = π<i>r</i>²<i>H</i> + π<i>r</i>²[ <i>t</i> −
                  <span class="frac"><span><i>t</i>³</span><span>3<i>h</i><sub>i</sub>²</span></span> ]
                  <span class="ml-2 text-xs text-slate-500">（<i>h</i> &gt; <i>H</i>，<i>t</i> = <i>h</i> − <i>H</i>）</span>
                </div>
              </div>

              <div v-else class="math-formula text-center text-slate-700">
                <div>
                  <i>V</i>(<i>h</i>) = <i>L</i> [
                  <span class="frac"><span>π<i>r</i>²</span><span>2</span></span>
                  − (<i>r</i> − <i>h</i>)<span class="sqrt">√<span>2<i>rh</i> − <i>h</i>²</span></span>
                  − <i>r</i>² · arcsin<span class="paren">(</span><span class="frac"><span><i>r</i> − <i>h</i></span><span><i>r</i></span></span><span class="paren">)</span> ]
                  &nbsp;+&nbsp;
                  <span class="frac"><span>π · <i>h</i><sub>i</sub></span><span>3<i>r</i></span></span>
                  · [ 3<i>r</i>²<i>h</i> − <i>r</i>³ + (<i>r</i> − <i>h</i>)³ ]
                </div>
              </div>

              <p v-if="vesselGeometry.type === 'vertical'" class="mt-3 text-center text-xs leading-relaxed text-slate-500">
                <i>r</i> 筒体内半径　<i>h</i> 液位高度　<i>H</i> 筒体高度　<i>h</i><sub>i</sub> 封头曲面内高度
                <span class="text-slate-500">｜</span>
                {{ vesselFormulaCaption }}
              </p>
              <p v-else class="mt-3 text-center text-xs leading-relaxed text-slate-500">
                <i>L</i> 筒体长度（含两端直边）　<i>r</i> 筒体内半径　<i>h</i> 液位高度　<i>h</i><sub>i</sub> 封头曲面内高度
                <span class="text-slate-500">｜</span>
                {{ vesselFormulaCaption }}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'electricity'">
        <section class="rounded-card border border-slate-200 bg-white shadow-card">
          <!-- 电价档位备注 -->
          <div class="border-b border-slate-100 bg-amber-50/40 px-6 py-4">
            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-800">
                !
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-slate-800">电价档位备注</h3>
                <div class="mt-3 grid gap-3 sm:grid-cols-3">
                  <div class="rounded-card border border-amber-200/70 bg-white px-4 py-2.5">
                    <p class="text-xs text-slate-500">10 万度以内</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      1.1 ~ 1.2<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                    </p>
                  </div>
                  <div class="rounded-card border border-amber-200/70 bg-white px-4 py-2.5">
                    <p class="text-xs text-slate-500">20 万度以内</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      0.9 ~ 1<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                    </p>
                  </div>
                  <div class="rounded-card border border-amber-200/70 bg-white px-4 py-2.5">
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

      <div v-show="activeTab === 'import'">
        <WorkOrderImport
          @cancel="handleImportCancel"
          @back="handleImportBack"
          @imported="importDirty = true"
        />
      </div>

      <div v-show="activeTab === 'imageParse'">
        <ImageParse />
      </div>
      </div>
    </div>
    </main>
  </el-config-provider>
</template>

<style scoped>
/* 储罐图：切换罐型时淡出淡入 + 高度平滑过渡 */
.vessel-canvas {
  transition: aspect-ratio 320ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease;
}

.vessel-canvas.is-switching {
  opacity: 0;
}

/* 软拟态（Soft UI）步进按钮：降低/升高液位 */
.vessel-step {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: linear-gradient(145deg, #ffffff, #e8ecf1);
  color: #475569;
  font-size: 19px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  box-shadow:
    4px 4px 8px rgba(163, 177, 198, 0.45),
    -3px -3px 8px rgba(255, 255, 255, 0.9),
    inset 0 -2px 3px -1px rgba(0, 0, 0, 0.06),
    inset 0 2px 3px -1px rgba(255, 255, 255, 0.9);
  transition: all 260ms cubic-bezier(0.23, 1, 0.32, 1);
}

.vessel-step:hover {
  color: #0f172a;
}

.vessel-step:active {
  filter: blur(0.4px);
  background: linear-gradient(145deg, #e8ecf1, #ffffff);
  box-shadow:
    inset 4px 4px 8px rgba(163, 177, 198, 0.5),
    inset -3px -3px 8px rgba(255, 255, 255, 0.95);
}

/* 液位输入框：软拟态外观 + 隐藏原生上下箭头 */
.vessel-level-input {
  border: none;
  border-radius: 12px;
  padding: 9px 14px;
  background-color: #eef1f5;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  outline: none;
  box-shadow:
    4px 4px 8px rgba(163, 177, 198, 0.45),
    -3px -3px 8px rgba(255, 255, 255, 0.9);
  transition: box-shadow 260ms cubic-bezier(0.23, 1, 0.32, 1);
}

/* 聚焦时呈"按入"质感的凹陷效果 */
.vessel-level-input:focus {
  background-color: #f5f8fb;
  box-shadow:
    inset 3px 3px 6px rgba(163, 177, 198, 0.4),
    inset -3px -3px 6px rgba(255, 255, 255, 0.9);
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

.vessel-select :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px rgb(14 165 233) inset, 0 0 0 3px rgb(224 242 254);
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