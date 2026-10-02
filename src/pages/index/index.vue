<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { onUnload } from '@dcloudio/uni-app'
import { useMessage, useToast } from 'wot-design-uni'
import dayjs from 'dayjs'
import request from '../../api/request'
import { uploadFiles } from '../../api/upload'
import { resolveAssetUrl } from '../../api/config'
import { clearAuth, getRoleName, hasPerm, isLoggedIn } from '../../api/auth'
import { APP_ENV, ACTIVE_ENV } from '../../api/env'
import ProductSelectDialog from '../../components/ProductSelectDialog.vue'
import DateField from '../../components/DateField.vue'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import FilterHeaderCell from '../../components/FilterHeaderCell.vue'
import ThemeToggle from '../../components/ThemeToggle.vue'
import DropdownMenu from '../../components/DropdownMenu.vue'
import ImageViewer from '../../components/ImageViewer.vue'
import TankLevelFormDialog from '../../components/TankLevelFormDialog.vue'
import TankLevelImageDialog from '../../components/TankLevelImageDialog.vue'
import { useTheme } from '../../composables/useTheme'
import { useWorkOrderData } from '../../composables/useWorkOrderData'
import { usePickData } from '../../composables/usePickData'
import { useInboundData } from '../../composables/useInboundData'
import { useGoodsMoveData } from '../../composables/useGoodsMoveData'
import { useMaterialStockData } from '../../composables/useMaterialStockData'
import { useTankLevelData, TANK_LEVEL_CATEGORIES } from '../../composables/useTankLevelData'
import { useTankLevelImages } from '../../composables/useTankLevelImages'
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

// Tab 元数据同时喂给三处：顶部栏（当前标题 + 说明）、抽屉菜单（图标 + 名称 + 说明）。
// icon 取值必须来自 wot-design-uni 的图标字体，写错会渲染成空白方块。
const tabs = [
  { key: 'workOrder', label: '工单汇总', icon: 'list', hint: '查看当前所有生产工单及处理状态' },
  { key: 'material', label: '领料汇总', icon: 'cart', hint: '按日期与物料查看领料记录' },
  { key: 'inbound', label: '入库汇总', icon: 'download', hint: '按日期与物料查看入库记录' },
  { key: 'report', label: '工单报工', icon: 'check-rectangle', hint: '产成品完工数量与确认产量' },
  { key: 'costing', label: '工单核算', icon: 'chart-pie', hint: '工单成本构成与核算结果' },
  { key: 'materialCosting', label: '原辅料核算', icon: 'layers', hint: '原辅料消耗与成本核算' },
  { key: 'stock', label: '物料查询', icon: 'goods', hint: '按工厂 / 存储地点查看物料库存' },
  // 图片解析：单据图片识别辅助录入（变更-003）。权限位与文件导入相同（work_order:import）
  { key: 'imageParse', label: '图片解析', icon: 'image', hint: '拍照识别单据并确认入库', perm: 'work_order:import' },
  { key: 'weekly', label: '周统计', icon: 'chart-bar', hint: '上周领料、入库与单耗汇总' },
  { key: 'daily', label: '日报表记录', icon: 'clock', hint: '按日归集的生产报表记录' },
  // 月底储罐液位记录：查询免登录（不带 perm），录入/删除按钮按 tank_level:edit 权限显隐
  { key: 'tankLevel', label: '月底储罐液位记录', icon: 'chart', hint: '按日期 / 属地查看车间储罐液位' },
  { key: 'vessel', label: '压力容器体积计算', icon: 'chart-bubble', hint: '卧式 / 立式储罐液位体积换算' },
  { key: 'electricity', label: '电费预提', icon: 'money-circle', hint: '电价档位与电费预提测算' },
  // #ifdef H5 || APP-PLUS
  { key: 'import', label: '文件导入', icon: 'file-excel', hint: '上传 Excel 批量导入工单', perm: 'work_order:import' },
  // #endif
]

// 按权限过滤可见 Tab
const visibleTabs = computed(() => tabs.filter((tab) => hasPerm(tab.perm)))

// 权限相关的显隐都读 authState（响应式），登录/退出后立即生效，无需整页刷新
const loggedIn = computed(() => isLoggedIn())
const roleName = computed(() => getRoleName() || '已登录')

// 切换登录态后，原先所在 Tab 可能已不可见 —— 兜底切到第一个可见 Tab，
// 否则会停在一个空白的 activeTab 上
watch(visibleTabs, (list) => {
  if (list.length && !list.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = list[0].key
  }
})

// ===== 导航（豆包式）=====
// 页面主体不再放 Tab 条：全部导航收进左侧抽屉，正文直接铺满。
// 切换入口是顶部栏左上角的菜单按钮。
const menuVisible = ref(false)

function openMenu() {
  menuVisible.value = true
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

function handleTabChange(key) {
  if (key === activeTab.value) return

  activeTab.value = key
  // 换 Tab 等价于换页：回到顶部，避免停在上一页的滚动位置
  uni.pageScrollTo({ scrollTop: 0, duration: 260 })
}

// 抽屉里点某一项：先收起抽屉再切面板 —— 抽屉的收起动画与面板入场动画重叠，观感更顺
function selectTabFromMenu(key) {
  menuVisible.value = false
  handleTabChange(key)
}

function logoutFromMenu() {
  menuVisible.value = false
  handleLogout()
}

function loginFromMenu() {
  menuVisible.value = false
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
  // 退出即回到只读浏览：读接口本就免登录，数据无需重取；
  // 写入类 Tab 与按钮会随 authState 变化自动隐藏。
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

// 工单数据与筛选（与工单报工面板共享同一份数据）
const {
  tableData,
  tableDataAll,
  allWorkOrders,
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

// 领料汇总数据（与原辅料核算、周统计面板共享）
const {
  allPickRecords,
  pickFiltered,
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
  getPickDate,
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
  ensureTankLevelLoaded,
  resetTankLevelFilters,
} = useTankLevelData()

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

function handleTankLevelLocationSelected(value) {
  tankLevelLocation.value = value
  fetchTankLevelRecords()
}

function clearTankLevelLocation() {
  tankLevelLocation.value = ''
  fetchTankLevelRecords()
}

function handleTankLevelCategorySelected(value) {
  tankLevelCategory.value = value
  fetchTankLevelRecords()
}

function clearTankLevelCategory() {
  tankLevelCategory.value = ''
  fetchTankLevelRecords()
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

// 图据弹层的开关与请求都在 useTankLevelImages（模块级单例）里，这里直接用它的入口
const { openImageDialog: openTankLevelImages } = useTankLevelImages()

/** 图据弹层里点了某张：交给页面根部那个全局全屏查看器 */
function handleTankLevelImagePreview({ urls = [], index = 0 } = {}) {
  openImageViewerList(urls, index)
}

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

// 入库汇总数据（与工单核算、周统计面板共享）
const {
  allInboundRecords,
  inboundFiltered,
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
  getInboundDate,
  getInboundPageData,
  filterInboundRecords,
  fetchInboundRecords,
  openInboundMaterialDialog,
  handleInboundMaterialSelected,
  clearInboundMaterialFilter,
} = useInboundData()

// 货物移动数据（原辅料核算的「已报工数」来源）
const {
  goodsMoveRecords,
  goodsMoveError,
  goodsMoveStartDate,
  goodsMoveEndDate,
  goodsMoveQtyMap,
  fetchGoodsMoveRecords,
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

// 工单号可选项（当前日期范围内的工单号，倒序）
// 工单报工数据：取工单汇总页当前查出的数据，按 工单类型 + 产成品 分组，数量与产量按组求和
const reportRows = computed(() => {
  const rows = new Map()

  for (const order of tableDataAll.value) {
    const orderType = getReportOrderType(order?.orderNo)
    if (!orderType) continue

    const materialDesc = String(order.materialDesc ?? '').trim()
    if (!materialDesc) continue

    const key = `${orderType}|${materialDesc}`
    let row = rows.get(key)

    if (!row) {
      row = { orderType, materialDesc, orderQty: 0, confirmedQty: 0 }
      rows.set(key, row)
    }

    row.orderQty += Number(order.orderQty) || 0
    row.confirmedQty += Number(order.confirmedQty) || 0
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      orderQty: formatQty(row.orderQty),
      confirmedQty: formatQty(row.confirmedQty),
    }))
    .sort((left, right) => {
      const byType = REPORT_ORDER_TYPES.findIndex((type) => type.label === left.orderType) -
        REPORT_ORDER_TYPES.findIndex((type) => type.label === right.orderType)

      if (byType !== 0) return byType

      return left.materialDesc.localeCompare(right.materialDesc, 'zh-CN')
    })
})

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
  const updateImages = (order) => {
    if (String(order.orderNo) === String(currentOrderNo.value)) {
      order.imageList = normalizedImages
    }
  }

  allWorkOrders.value.forEach(updateImages)
  tableDataAll.value.forEach(updateImages)
  imageList.value = normalizedImages
  filterWorkOrders()
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
 * 导入会新增/更新四类数据（工单、领料、入库、货物移动），
 * 而它们又是工单报工、工单核算、原辅料核算、周统计的数据源 —— 因此全部重新拉取。
 *
 * 注意：不能只在「返回工单汇总」按钮里刷新 —— 用户也可能直接点顶部 Tab 切走，
 * 所以用 importDirty 标记 + activeTab 监听统一处理。
 */
const importDirty = ref(false)

function refreshAllData() {
  fetchWorkOrders()
  fetchPickRecords()
  fetchInboundRecords()
  fetchGoodsMoveRecords()
  // 库存汇总也可能在这次导入里被更新
  fetchStockRecords()
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
      const currentOrder = allWorkOrders.value.find(
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
// 打开时先看第几张（月底储罐液位记录的图据是多张，点哪张先看哪张）
const imageViewerIndex = ref(0)

function openImageViewer(url) {
  if (!url) return
  imageViewerUrls.value = [resolveAssetUrl(url)]
  imageViewerIndex.value = 0
  imageViewerVisible.value = true
}

/**
 * 一次看多张（月底储罐液位记录的图据）。
 * 传进来的是后端给的相对路径，这里统一过 resolveAssetUrl ——
 * 与单图入口同一个道理，查看器只认能直接加载的地址。
 */
function openImageViewerList(urls, index = 0) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean).map(resolveAssetUrl)
  if (!list.length) return

  imageViewerUrls.value = list
  imageViewerIndex.value = Math.min(Math.max(Number(index) || 0, 0), list.length - 1)
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

// 已报工数量：按归一化产成品名称汇总工单的确认产量
const reportedQtyMap = computed(() => {
  const map = new Map()

  for (const order of tableDataAll.value) {
    const key = normalizeMaterialName(order.materialDesc)
    if (!key) continue

    map.set(key, (map.get(key) || 0) + (Number(order.confirmedQty) || 0))
  }

  return map
})

// 工单核算：以已入库产成品（入库汇总的物料名称去重）为行，入库数与已报工数汇总，差额为未报工数
const costingRows = computed(() => {
  const rows = new Map()

  // 入库数：来自入库汇总数据，按物料名称去重
  for (const record of allInboundRecords.value) {
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


// 原辅料核算：以领料汇总的物料名称去重为行，领料数按物料累加，已报工数取货物移动数量合计
const materialCostingRows = computed(() => {
  const rows = new Map()

  // 领料数：来自领料汇总数据，按物料名称去重
  for (const record of allPickRecords.value) {
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

    const moveSum = goodsMoveRecords.value
      .filter((record) => {
        if (String(record.materialCode ?? '').trim() !== derived.materialCode) return false
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

// 150产品入库数：按物料编码 + 时间范围，累计入库汇总的数量
const weeklyInboundQty = computed(() => {
  const sum = allInboundRecords.value
    .filter((record) => {
      if (String(record.materialCode ?? '').trim() !== WEEKLY_INBOUND_MATERIAL_CODE) return false

      const inboundDate = getInboundDate(record)
      if (!inboundDate) return true

      return inboundDate >= weeklyStartDate.value && inboundDate <= weeklyEndDate.value
    })
    .reduce((total, record) => total + (Number(record.inboundQty) || 0), 0)

  return formatQty(sum)
})

const weeklyInboundRow = computed(() => ({
  materialCode: WEEKLY_INBOUND_MATERIAL_CODE,
  name: '150产品入库数（kg）',
  value: weeklyInboundQty.value,
}))

// 原料领用：按时间范围 + 物料编码，从领料汇总数据求和
function getWeeklyPickQty(materialCode) {
  const code = String(materialCode ?? '').trim()
  if (!code) return 0

  const sum = allPickRecords.value
    .filter((record) => {
      if (String(record.materialCode ?? '').trim() !== code) return false

      const pickDate = getPickDate(record)
      if (!pickDate) return true

      return pickDate >= weeklyStartDate.value && pickDate <= weeklyEndDate.value
    })
    .reduce((total, record) => total + (Number(record.pickQty) || 0), 0)

  return formatQty(sum)
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

const weeklyTableData = ref([])
const weeklyTableDataAll = ref([])
const allWeeklyOrders = ref([])
const weeklyPageNum = ref(1)
const weeklyPageSize = ref(10)
const weeklyTotal = ref(0)
const weeklyLoading = ref(false)
const weeklyError = ref('')
const weeklyStartDate = ref(getLastWeekMonday())
const weeklyEndDate = ref(getLastWeekSunday())

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

const weeklyProductOptions = computed(() => {
  const names = allWeeklyOrders.value
    .filter(matchesWeeklyDateRange)
    .map((order) => String(order.materialDesc ?? '').trim())
    .filter(Boolean)

  return [...new Set(names)].sort((left, right) => left.localeCompare(right, 'zh-CN'))
})

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
  const updateImages = (order) => {
    if (String(order.orderNo) === String(weeklyCurrentOrderNo.value)) {
      order.imageList = normalizedImages
    }
  }

  allWeeklyOrders.value.forEach(updateImages)
  weeklyTableDataAll.value.forEach(updateImages)
  weeklyImageList.value = normalizedImages
  filterWeeklyOrders()
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
      const currentOrder = allWeeklyOrders.value.find(
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

function getWeeklyPageData(page = weeklyPageNum.value) {
  weeklyPageNum.value = page
  const startIndex = (weeklyPageNum.value - 1) * weeklyPageSize.value
  const endIndex = startIndex + weeklyPageSize.value
  weeklyTableData.value = weeklyTableDataAll.value.slice(startIndex, endIndex)
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

function getWeeklyOrderDate(order) {
  return String(order?.planStartDate || '').slice(0, 10)
}

function sortWeeklyOrders(orders) {
  return [...orders].sort((left, right) => {
    const leftDate = new Date(left.planStartDate || 0).getTime()
    const rightDate = new Date(right.planStartDate || 0).getTime()

    if (leftDate !== rightDate) {
      return rightDate - leftDate
    }

    return String(right.orderNo ?? '').localeCompare(
      String(left.orderNo ?? ''),
      undefined,
      { numeric: true },
    )
  })
}

function matchesWeeklyDateRange(order) {
  const planStartDate = getWeeklyOrderDate(order)
  if (!planStartDate) return false
  return planStartDate >= weeklyStartDate.value && planStartDate <= weeklyEndDate.value
}

function matchesWeeklyProductFilter(order) {
  if (!weeklyProductFilter.value) return true
  return String(order.materialDesc ?? '').trim() === weeklyProductFilter.value
}

function filterWeeklyOrders() {
  weeklyTableDataAll.value = allWeeklyOrders.value.filter(
    (order) => matchesWeeklyDateRange(order) && matchesWeeklyProductFilter(order),
  )

  weeklyTotal.value = weeklyTableDataAll.value.length
  weeklyPageNum.value = 1
  getWeeklyPageData()
}

async function fetchWeeklyOrders() {
  weeklyLoading.value = true
  weeklyError.value = ''

  try {
    const res = await request.get('/api/work-order/list')
    if (res.data.success === true) {
      const dataList = Array.isArray(res.data.dataList)
        ? res.data.dataList.map(normalizeWeeklyOrder).filter(Boolean)
        : []

      allWeeklyOrders.value = sortWeeklyOrders(dataList)
      filterWeeklyOrders()
    } else {
      allWeeklyOrders.value = []
      weeklyTableDataAll.value = []
      weeklyTableData.value = []
      weeklyTotal.value = 0
      weeklyError.value = res.data.msg || '工单接口返回异常，请稍后重试。'
    }
  } catch (error) {
    allWeeklyOrders.value = []
    weeklyTableDataAll.value = []
    weeklyTableData.value = []
    weeklyTotal.value = 0
    weeklyError.value = error.response?.data?.msg || '工单数据加载失败，请稍后重试。'
  } finally {
    weeklyLoading.value = false
  }
}

// ===== 储罐体积计算 =====
// 储罐配置：新增储罐只需在数组里加一项
// imageBounds 为底图中罐体的像素边界（由图像分析 + 轮廓叠加验证得出）。
//
// ⚠️ 这组坐标与底图的实际像素尺寸是**绑定**的：绘制时按 s = IMAGE_W / bounds.width
//    把两者换算到画布坐标，所以图片一改尺寸，坐标必须等比跟着改，否则液位线会与
//    图纸错位。底图现为原图 1/2 尺寸（为压小程序主包），用
//    resources/compress-vessel-images.py 重新生成时会打印出配套的新坐标。
const VESSELS = [
  {
    key: 'silane',
    type: 'horizontal',
    label: '三氯氢硅储罐A/B示意图',
    diameter: 2800, // 筒体内径 φ2.8m
    cylinderLength: 5500, // 筒体长度 l=5.5m
    straightFlange: 40, // 封头直边 0.04m
    headDepth: 700, // 封头曲面内高度 hi=0.7m
    // 底图放 /static：三端里只有 /static 的路径是各端都认的（App 端由打包进 www 的资源解析），
    // 而且 <image> 的 src 要的就是「资源路径字符串」，不是 import 出来的模块 URL。
    image: '/static/vessel.png',
    // 深色主题用的同尺寸亮线版（透明底 + 亮色线稿，见 resources/compress-vessel-images.py）。
    // 两张图尺寸必须一致，否则切主题时液位线会跳 —— 脚本里有校验。
    imageDark: '/static/vessel-dark.png',
    // 坐标已按压缩后的底图（1075x530 = 原图 1/2）等比缩放。
    // ⚠️ 底图一换尺寸，这组数字必须同步重算，否则液位线会与图纸错位 ——
    //    用 resources/compress-vessel-images.py 重新生成，它会把新值打印出来。
    imageBounds: { width: 1075, height: 530, left: 37.5, right: 1034.5, top: 65.5, bottom: 465.5 },
    displayWidth: 680,
    medium: '三氯氢硅',
    density: 1.35, // 20°C、101.325kPa 工程取值（SIS 联锁/容积/物料衡算/泄放计算用）g/cm³
    note: '三氯氢硅，若用于 SIS 联锁、储罐容积、物料衡算、泄放计算，工程上直接采用：20℃，101.325kPa，ρ=1.35 g/cm³',
    liquid: { fill: 'rgba(208, 226, 128, 0.28)', line: '#a6cb3c' }, // 浅黄绿（氯系介质特征色，柔和不刺眼）
  },
  {
    key: 'product150',
    type: 'vertical',
    label: '150产品储罐示意图',
    diameter: 3600, // 筒体内径 φ3.6m
    cylinderHeight: 4800, // 筒体高度 4.8m
    headDepth: 900, // 顶部封头曲面内高度 0.9m
    image: '/static/vessel-product150.png',
    // 深色主题用的同尺寸亮线版（理由同上一台罐）
    imageDark: '/static/vessel-product150-dark.png',
    // 坐标已按压缩后的底图（880x969 = 原图 1/2）等比缩放，同见上方说明
    imageBounds: { width: 880, height: 969, left: 65.5, right: 675.5, top: 31.5, tangent: 155, bottom: 965 },
    displayWidth: 470,
    medium: '乙烯基三氯硅烷',
    density: 1.27, // GB/T 35498-2017，20°C、101.325kPa g/cm³（数值上等于 t/m³）
    note: '乙烯基三氯硅烷，基准条件：20℃，101.325 kPa（常压），液体密度 1.27 g/cm³；物性来源：GB/T 35498-2017《工业用乙烯基三氯硅烷》。',
    liquid: { fill: 'rgba(0, 255, 255, 0.4)', line: '#00ffff' },
  },
]

const vesselKey = ref(VESSELS[0].key)

// 储罐下拉的浮层开关。⚠️ 必须绑给 DropdownMenu 的 v-model —— 它的遮罩与面板都是
// v-if="modelValue"，漏绑就只 emit 一个没人监听的事件，点击毫无反应（这行别删）。
const vesselMenuOpen = ref(false)
const selectedVessel = computed(
  () => VESSELS.find((item) => item.key === vesselKey.value) ?? VESSELS[0],
)

// 储罐下拉的选项（企微式浮层，见 components/DropdownMenu.vue）。
// hint 用「罐型 + 主尺寸 + 密度」把两个罐一眼分开：浮层里只有 2 项，而罐名长得很像
//（都带「储罐…示意图」），光看名字容易点错。
// icon 两行都用 chart-bubble（本面板自己的图标）：图标字体里没有卧式/立式罐的图形，
// 硬凑一个别的语义反而更误导，罐型交给 hint 表达。
const vesselOptions = computed(() =>
  VESSELS.map((vessel) => ({
    value: vessel.key,
    label: vessel.label,
    hint: vessel.type === 'vertical'
      ? `立式 · φ${vessel.diameter / 1000}m × H${vessel.cylinderHeight / 1000}m · ρ${vessel.density}`
      : `卧式 · φ${vessel.diameter / 1000}m × L${vessel.cylinderLength / 1000}m · ρ${vessel.density}`,
    icon: 'chart-bubble',
  })),
)

// 浮层选中后写回唯一的罐标识；下游（selectedVessel / vesselGeometry）一行不动
function handleVesselSelect(key) {
  vesselKey.value = key
}

// 当前储罐的几何参数（统一两种罐型的字段）
const vesselGeometry = computed(() => {
  const vessel = selectedVessel.value

  if (vessel.type === 'vertical') {
    return {
      type: 'vertical',
      diameter: vessel.diameter,
      radius: vessel.diameter / 2,
      cylinderHeight: vessel.cylinderHeight,
      headDepth: vessel.headDepth,
      maxLevel: vessel.cylinderHeight + vessel.headDepth,
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
//   立式：筒体段与封头段分开映射（底图里的封头画得比真实椭球略扁，
//         分段映射才能让液面始终贴合图纸上的结构线）。
function levelBottomPercent(level, geometry, bounds, scale) {
  const bottom = bounds.bottom * scale

  if (geometry.type === 'vertical') {
    const tangent = bounds.tangent * scale
    const apex = bounds.top * scale
    const y =
      level <= geometry.cylinderHeight
        ? bottom - (level / geometry.cylinderHeight) * (bottom - tangent)
        : tangent -
          (Math.min(geometry.headDepth, level - geometry.cylinderHeight) / geometry.headDepth) *
            (tangent - apex)
    return ((bottom - y) / (bottom - apex)) * 100
  }

  return (level / geometry.diameter) * 100
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
    const ry = ((bounds.tangent - bounds.top) / (bounds.bottom - bounds.top)) * 100
    tankStyle = {
      left: toLeft(bounds.left),
      top: toTop(bounds.top),
      width: `${((tankWidth / W) * 100).toFixed(4)}%`,
      height: `${((tankHeight / H) * 100).toFixed(4)}%`,
      borderRadius: `50% 50% 0 0 / ${ry.toFixed(4)}% ${ry.toFixed(4)}% 0 0`,
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

// 液体体积（mm³）—— 闭式解，依据工艺核算公式：
//   V(h) = L[ πr²/2 − (r−h)√(2rh−h²) − r²·arcsin((r−h)/r) ]
//        + (π·hi)/(3r) · [ 3r²h − r³ + (r−h)³ ]
// 第一项为筒体（含两端直边）内液体体积，第二项为两端椭圆封头曲面内液体体积合计
function liquidVolumeMm3(depth, geometry) {
  const r = geometry.radius
  const h = Math.max(0, Math.min(geometry.maxLevel, Number(depth) || 0))
  if (h <= 0) return 0

  // 立式储罐：筒体为等径圆柱，顶部为半椭球封头
  //   V = πr²h（筒体段） + πr²[ t − t³/(3hi²) ]（封头段，t = h − 筒体高度）
  if (geometry.type === 'vertical') {
    const cylinderPart = Math.PI * r * r * Math.min(h, geometry.cylinderHeight)
    if (h <= geometry.cylinderHeight) return cylinderPart

    const t = h - geometry.cylinderHeight
    const hi = geometry.headDepth
    const headPart = Math.PI * r * r * (t - Math.pow(t, 3) / (3 * hi * hi))
    return cylinderPart + headPart
  }

  // 卧式储罐：闭式解，依据工艺核算公式
  const straightLength = geometry.cylinderLength + 2 * geometry.straightFlange
  const sqrtTerm = Math.sqrt(Math.max(0, 2 * r * h - h * h))
  const asinTerm = Math.asin(Math.max(-1, Math.min(1, (r - h) / r)))

  const cylinder =
    straightLength * ((Math.PI * r * r) / 2 - (r - h) * sqrtTerm - r * r * asinTerm)
  const heads =
    ((Math.PI * geometry.headDepth) / (3 * r)) *
    (3 * r * r * h - Math.pow(r, 3) + Math.pow(r - h, 3))

  return cylinder + heads
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

  const items = []

  if (g.type === 'vertical') {
    items.push({ label: '筒体内径', value: `φ${m(g.diameter)}` })
    items.push({ label: '筒体高度', value: m(g.cylinderHeight) })
  } else {
    items.push({ label: '筒体内径', value: `φ${m(g.diameter)}` })
    items.push({ label: '筒体长度', value: `l = ${m(g.cylinderLength)}` })
    items.push({ label: '封头直边', value: m(g.straightFlange) })
  }

  items.push({ label: '封头曲面', value: `hi = ${m(g.headDepth)}` })
  items.push({ label: '总容积', value: `${vesselCapacity.value.toFixed(1)} m³` })
  items.push({ label: '液位量程', value: `0 ~ ${g.maxLevel} mm` })

  // 介质与密度：质量换算用的就是这两个数，单列出来比埋在长句里好找
  if (g.medium) items.push({ label: '介质', value: g.medium })
  if (g.density) items.push({ label: '密度', value: `${g.density} g/cm³` })

  return items
})

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
}

function startStepHold(which, direction) {
  stopStepHold()
  stepVesselLevel(which, direction)

  vesselStepDelayTimer = setTimeout(() => {
    vesselStepRepeatTimer = setInterval(() => stepVesselLevel(which, direction, 25), 40)
  }, 320)
}

// 液位按钮的按下/抬起必须同时覆盖触摸与鼠标：
//   · 小程序端与 App 真机只有 touch 事件；
//   · H5 桌面端只有 mouse 事件 —— 只绑 @touchstart 的话，鼠标点一下完全没反应。
// 两边都绑就得防「一次操作走两格」：触摸屏上浏览器会在 touchend 之后补发一套 mouse
// 兼容事件。touchstart 的 .prevent 通常会抑制它们，但个别 webview 不保证，所以再用
// 时间窗兜一道：刚发生过触摸，短时间内来的 mouse 按下直接丢弃。
let vesselLastTouchAt = 0
const VESSEL_TOUCH_DEDUPE_MS = 700

function startStepHoldByTouch(which, direction) {
  vesselLastTouchAt = Date.now()
  startStepHold(which, direction)
}

function startStepHoldByMouse(which, direction) {
  if (Date.now() - vesselLastTouchAt < VESSEL_TOUCH_DEDUPE_MS) return
  startStepHold(which, direction)
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
})

// 离开页面时的清理。
// 注册两份是因为：小程序端页面销毁走的是 uni-app 的 onUnload，
// 而 H5/App 端 Vue 的 onUnmounted 也会触发（两边都调一次也无妨，清理函数是幂等的）。
function cleanupVessel() {
  stopVesselLoop()
  stopStepHold()
}

onMounted(() => {
  fetchWorkOrders()
  fetchPickRecords()
  fetchInboundRecords()
  fetchGoodsMoveRecords()
  fetchStockRecords()
  // 罐体底图（约 645 KB）改为切到压力容器 Tab 时按需加载，不拖慢首屏
})

onUnmounted(cleanupVessel)
onUnload(cleanupVessel)

// 切到压力容器 Tab 时才渲染底图（首次约 645 KB），离开时停帧
watch(activeTab, (tab, prevTab) => {
  if (tab === 'vessel') {
    // 锁存后一直渲染，来回切 Tab 不会重新加载
    vesselImageReady.value = true
    // 切回来时若还有没跑完的缓动，接上帧循环
    if (vesselTransitions.start || vesselTransitions.end) startVesselLoop()
  } else {
    stopVesselLoop()
  }

  // 月底储罐液位记录同理：首次进这个 Tab 才拉数据（含属地下拉选项），
  // 已经取过就不再打接口 —— 面板是 v-show 常驻的，挂载时机与切 Tab 不是一回事
  if (tab === 'tankLevel') {
    ensureTankLevelLoaded()
  }

  // 离开导入页且期间导入成功 → 刷新各数据集
  if (prevTab === 'import' && importDirty.value) {
    importDirty.value = false
    refreshAllData()
  }
})
</script>

<template>
  <!-- 改造前这里套了一层 <el-config-provider :locale="zhCn"> 只为给 Element Plus 注入
       中文 locale。wot-design-uni 默认就是中文，不需要这层包裹，直接去掉。
       原来写死在这层的 Tailwind 布局类（min-h-screen / px-4 py-8 …）
       挪到 .page 里 —— 顶部还要叠加状态栏高度，Tailwind 表达不了 calc(var())。 -->
  <view class="page" :class="themeClass">
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
            <DateField v-model="startDate" placeholder="起始日期" @change="filterWorkOrders" />
            <span class="text-sm text-slate-500">至</span>
            <DateField v-model="endDate" placeholder="结束日期" @change="filterWorkOrders" />
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

          <!-- 居中而不是 justify-end：wd-pagination 的 .wd-pager 是行内块，宽度只等于
               show-message 那段文字，而它内部的 __content 又是 justify-content: flex-start；
               靠右排时按钮组会贴着这个窄块的右缘，看着像"往右冒出来一截"。
               容器居中 + 给组件限宽（见下面 wd-pagination 上的 custom-style）之后，
               按钮组在两处筛选行里都稳定居中；限宽还顺手挡掉 H5 桌面端把按钮摊开的问题。 -->
          <div class="flex justify-center border-t border-slate-100 px-6 py-4">
            <!-- wd-pagination 的 change 事件传的是 `{ value: N }` 对象，不是页码本身
                 （el-pagination 传的是数字，迁移时直接绑函数会拿到对象）。
                 而 change 又在 update:modelValue 之前触发，此时 pageNum 还是旧值，
                 所以必须把新的页码显式取出来传进去，不能靠 v-model 已更新。 -->
            <wd-pagination
              v-model="pageNum"
              custom-style="max-width: 340px;"
              :total="total"
              :page-size="pageSize"
              show-message
              :hide-if-one-page="false"
              @change="(event) => getPageData(event.value)"
            />
          </div>
        </div>
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
        custom-style="width: 92vw; max-height: 88vh; border-radius: 22px; background-color: var(--ui-surface); border: 1px solid var(--ui-border); display: flex; flex-direction: column; overflow: hidden;"
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
            <DateField v-model="pickStartDate" placeholder="起始日期" @change="filterPickRecords" />
            <span class="text-sm text-slate-500">至</span>
            <DateField v-model="pickEndDate" placeholder="结束日期" @change="filterPickRecords" />
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

              <!-- 居中 + 限宽，同工单汇总那处分页（那边有完整说明） -->
              <div class="flex justify-center border-t border-slate-100 px-6 py-2.5">
                <!-- 事件载荷是 { value: N }，同工单汇总那处分页 -->
                <wd-pagination
              v-model="pickPageNum"
              custom-style="max-width: 340px;"
              :total="pickTotal"
              :page-size="pickPageSize"
              show-message
              :hide-if-one-page="false"
              @change="(event) => getPickPageData(event.value)"
            />
              </div>
            </div>
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
            <DateField v-model="inboundStartDate" placeholder="起始日期" @change="filterInboundRecords" />
            <span class="text-sm text-slate-500">至</span>
            <DateField v-model="inboundEndDate" placeholder="结束日期" @change="filterInboundRecords" />
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

              <!-- 居中 + 限宽，同工单汇总那处分页（那边有完整说明） -->
              <div class="flex justify-center border-t border-slate-100 px-6 py-2.5">
                <!-- 事件载荷是 { value: N }，同工单汇总那处分页 -->
                <wd-pagination
              v-model="inboundPageNum"
              custom-style="max-width: 340px;"
              :total="inboundTotal"
              :page-size="inboundPageSize"
              show-message
              :hide-if-one-page="false"
              @change="(event) => getInboundPageData(event.value)"
            />
              </div>
            </div>
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
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm font-semibold text-sky-700">{{ item.unreportedQty }}</view>
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
                  <view class="dt__cell w-20 whitespace-nowrap py-2 pl-2 pr-3 text-right text-sm font-semibold text-sky-700">{{ item.unreportedQty }}</view>
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
              <input
                v-model="stockKeyword"
                class="filter-search__input"
                type="text"
                placeholder="物料编码 / 物料描述"
                placeholder-class="ui-placeholder"
                confirm-type="search"
                @input="applyStockFilter"
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

              <div class="flex justify-center border-t border-slate-100 px-6 py-2.5">
                <wd-pagination
                  v-model="stockPageNum"
                  custom-style="max-width: 340px;"
                  :total="stockTotal"
                  :page-size="stockPageSize"
                  show-message
                  :hide-if-one-page="false"
                  @change="(event) => getStockPageData(event.value)"
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'imageParse'">
        <ImageParse />
      </div>

      <div v-show="activeTab === 'weekly'">
        <section class="panel rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
            <DateField v-model="weeklyStartDate" placeholder="起始日期" @change="filterWeeklyOrders" />
            <span class="text-sm text-slate-500">至</span>
            <DateField v-model="weeklyEndDate" placeholder="结束日期" @change="filterWeeklyOrders" />
          </div>

          <view class="p-6">
            <view class="overflow-x-auto">
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
          custom-style="width: 92vw; max-height: 88vh; border-radius: 22px; background-color: var(--ui-surface); border: 1px solid var(--ui-border); display: flex; flex-direction: column; overflow: hidden;"
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
              @change="fetchTankLevelRecords"
            />
            <span class="text-sm text-slate-500">至</span>
            <DateField
              v-model="tankLevelEndDate"
              placeholder="结束日期"
              @change="fetchTankLevelRecords"
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
                @confirm="fetchTankLevelRecords"
              />
            </view>

            <view class="filter-chip" @click="resetTankLevelFilters">重置</view>

            <!-- 录入入口：只有 tank_level:edit 权限才出现（后端写接口各自鉴权） -->
            <view v-if="canEditTankLevel" class="filter-chip is-on" @click="openTankLevelCreate">
              <wd-icon name="add" size="14px" />
              新增
            </view>

            <span class="ml-auto text-sm text-slate-500">
              共 <span class="font-semibold text-slate-900">{{ tankLevelTotal }}</span> 条记录
            </span>
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

              <div class="flex justify-center border-t border-slate-100 px-6 py-2.5">
                <wd-pagination
                  v-model="tankLevelPageNum"
                  custom-style="max-width: 340px;"
                  :total="tankLevelTotal"
                  :page-size="tankLevelPageSize"
                  show-message
                  :hide-if-one-page="false"
                  @change="(event) => getTankLevelPageData(event.value)"
                />
              </div>
            </div>
          </div>

          <!-- 记录说明：与线下台账表尾、电脑端一字不差 -->
          <div class="border-t border-slate-100 px-6 py-3 text-xs leading-relaxed text-slate-500">
            <p>记录说明：</p>
            <p>1. 实际重量与理论计算可能存在差异，以实际测量为准。</p>
            <p>2. 记录时间为每月月底下午3点</p>
          </div>
        </section>

        <!-- 表单弹层（新增 / 编辑 / 只读详情）与图据弹层。
             图据弹层的开关在 useTankLevelImages 里，这里不用绑 v-model；
             大图交给页面根部的 <ImageViewer />，见 handleTankLevelImagePreview。 -->
        <TankLevelFormDialog v-model="tankLevelFormVisible" :record="tankLevelFormRecord" />
        <TankLevelImageDialog @preview="handleTankLevelImagePreview" />

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
                  <text class="vessel-select__label">{{ selectedVessel.label }}</text>
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
                    :src="isLight ? selectedVessel.image : selectedVessel.imageDark"
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
                </template>
              </view>
            </div>

            <div :class="isVerticalVessel ? 'flex min-w-0 flex-1 flex-col justify-center' : 'w-full'">
            <!-- 横版：体积变化在左、液位控制列在右；竖版：体积变化居中在上 -->
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

            <!-- 液位控件列：竖版罐原来是写死的两列，小屏上每列只有 ~125px，
                 而一个液位控件（标签 + 两个 38px 圆钮 + 80px 输入框）本身就要 ~240px，
                 必然横向溢出卡片。改成窄屏一列、≥640px 两列。 -->
            <div
                class="gap-x-6 gap-y-5"
                :class="
                  isVerticalVessel
                    ? 'grid w-full grid-cols-1 px-0 sm:grid-cols-2'
                    : 'flex flex-wrap gap-x-6'
                "
              >
              <!-- 起始液位：控件与其数据同列 -->
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_6px_16px_-6px_rgba(15,23,42,0.18)]">
                  <span class="flex items-center gap-2 whitespace-nowrap text-sm text-slate-700">
                    <span class="vessel-legend vessel-legend--start" aria-hidden="true"></span>
                    起始液位
                  </span>
                  <div class="flex items-center gap-3">
                    <!-- touch 与 mouse 两组都要绑，缺一组就有一端按不动（见 startStepHoldByTouch 的注释） -->
                    <button
                      class="vessel-step"
                      aria-label="降低起始液位"
                      @touchstart.prevent="startStepHoldByTouch('start', -1)"
                      @touchend="stopStepHold"
                      @touchcancel="stopStepHold"
                      @mousedown.prevent="startStepHoldByMouse('start', -1)"
                      @mouseup="stopStepHold"
                      @mouseleave="stopStepHold"
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
                      class="vessel-step"
                      aria-label="升高起始液位"
                      @touchstart.prevent="startStepHoldByTouch('start', 1)"
                      @touchend="stopStepHold"
                      @touchcancel="stopStepHold"
                      @mousedown.prevent="startStepHoldByMouse('start', 1)"
                      @mouseup="stopStepHold"
                      @mouseleave="stopStepHold"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div class="space-y-1 pl-1 text-sm text-slate-500">
                  <div>
                    液位：<span class="vessel-num vessel-num--level font-semibold text-slate-900">{{ Math.round(vesselStartDisplay) }}</span> mm
                  </div>
                  <div>
                    体积：<span class="vessel-num vessel-num--volume font-semibold text-sky-600">{{ vesselStartVolume.toFixed(2) }}</span> m³<template v-if="vesselStartMass !== null"><span class="ml-1 text-slate-400">（<span class="vessel-num vessel-num--volume">{{ vesselStartMass.toFixed(2) }}</span> t）</span></template>
                  </div>
                </div>
              </div>

              <!-- 终止液位：控件与其数据同列 -->
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_6px_16px_-6px_rgba(15,23,42,0.18)]">
                  <span class="flex items-center gap-2 whitespace-nowrap text-sm text-slate-700">
                    <span
                      class="vessel-legend vessel-legend--end"
                      :style="vesselWaveSwatch"
                      aria-hidden="true"
                    ></span>
                    终止液位
                  </span>
                  <div class="flex items-center gap-3">
                    <button
                      class="vessel-step"
                      aria-label="降低终止液位"
                      @touchstart.prevent="startStepHoldByTouch('end', -1)"
                      @touchend="stopStepHold"
                      @touchcancel="stopStepHold"
                      @mousedown.prevent="startStepHoldByMouse('end', -1)"
                      @mouseup="stopStepHold"
                      @mouseleave="stopStepHold"
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
                      class="vessel-step"
                      aria-label="升高终止液位"
                      @touchstart.prevent="startStepHoldByTouch('end', 1)"
                      @touchend="stopStepHold"
                      @touchcancel="stopStepHold"
                      @mousedown.prevent="startStepHoldByMouse('end', 1)"
                      @mouseup="stopStepHold"
                      @mouseleave="stopStepHold"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div class="space-y-1 pl-1 text-sm text-slate-500">
                  <div>
                    液位：<span class="vessel-num vessel-num--level font-semibold text-slate-900">{{ Math.round(vesselEndDisplay) }}</span> mm
                  </div>
                  <div>
                    体积：<span class="vessel-num vessel-num--volume font-semibold text-sky-600">{{ vesselEndVolume.toFixed(2) }}</span> m³<template v-if="vesselEndMass !== null"><span class="ml-1 text-slate-400">（<span class="vessel-num vessel-num--volume">{{ vesselEndMass.toFixed(2) }}</span> t）</span></template>
                  </div>
                </div>
              </div>
            </div>
            </div>
            </div>
          </div>

          <div class="border-t border-slate-100 px-6 py-4">
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
                程序按此式实时计算液体体积
              </p>
              <p v-else class="mt-3 text-center text-xs leading-relaxed text-slate-500">
                <text class="mf-var">L</text> 筒体长度（含两端直边）　<text class="mf-var">r</text> 筒体内半径　<text class="mf-var">h</text> 液位高度　<text class="mf-var">h</text><text class="mf-sub">i</text> 封头曲面内高度
                <span class="text-slate-400">｜</span>
                程序按此式实时计算液体体积
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
      <wd-popup
        v-model="menuVisible"
        position="left"
        safe-area-inset-bottom
        custom-style="box-sizing: border-box; width: 78vw; max-width: 620rpx; height: 100vh; background-color: var(--ui-surface); display: flex; flex-direction: column; overflow: hidden;"
      >
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

          <text class="drawer__group">全部功能</text>

          <scroll-view class="drawer__list" scroll-y>
            <view
              v-for="tab in visibleTabs"
              :key="tab.key"
              class="menu-item"
              :class="{ 'is-active': activeTab === tab.key }"
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
            </view>
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
            <text class="drawer__tip">未登录也可以只读浏览工单数据</text>
            <text class="drawer__env">{{ envTip }}</text>
          </view>
        </view>
      </wd-popup>

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
  padding: calc(var(--status-bar-height, 0px) + 28px) 16px 40px;
  // 深色主题的"氛围"：纯黑底 + 顶部一层蓝紫光晕，纯 CSS，不引图片资源。
  // 拆成 background-color / background-image 两条而不是 background 简写，
  // 避免简写把颜色一起重置掉。
  background-color: $ui-bg;
  background-image: radial-gradient(120% 46% at 50% 0%, $ui-glow 0%, transparent 62%);
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
}

/* ===== 顶部栏（豆包式）=====
   左：菜单按钮。三条横线用 CSS 画（不依赖图标字体，长短略有差异更有"手感"）；
   中：当前面板标题 + 一句话说明；右：账户入口，点开同一个抽屉。 */
.topbar {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 8rpx 0 28rpx;
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

/* 胶囊按钮：登录 = 白底黑字的主操作；退出 = 低饱和危险色 */
.pill-btn {
  @include pill-button;
}

.pill-btn--primary {
  background-color: $ui-text;
  color: $ui-on-light;
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

.vessel-diagram__callout.is-decrease {
  color: #e11d48;
}

.vessel-diagram__callout.is-increase {
  color: #059669;
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

/* 软拟态（Soft UI）步进按钮：降低/升高液位。
   深色下是「暗面 + 亮边」，浅色下是「白面 + 灰影」—— 两种形态都靠
   --ui-soft-a/b + --ui-soft-shadow/light 这组变量切换（见 App.vue 的 .theme-light）。 */
.vessel-step {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: 1px solid $ui-hairline;
  border-radius: 50%;
  background: linear-gradient(145deg, $ui-soft-a, $ui-soft-b);
  color: $ui-text-2;
  font-size: 19px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  box-shadow:
    6px 6px 14px $ui-soft-shadow,
    -3px -3px 10px $ui-soft-light;
  transition: all 260ms cubic-bezier(0.23, 1, 0.32, 1);
}

.vessel-step:hover {
  color: $ui-text;
}

.vessel-step:active {
  filter: blur(0.4px);
  background: linear-gradient(145deg, $ui-soft-b, $ui-soft-a);
  box-shadow:
    inset 5px 5px 10px $ui-soft-shadow,
    inset -3px -3px 10px $ui-soft-light;
}

/* 液位输入框：软拟态外观 + 隐藏原生上下箭头 */
.vessel-level-input {
  border: 1px solid $ui-hairline;
  border-radius: 12px;
  padding: 9px 14px;
  background-color: $ui-surface-2;
  color: $ui-text;
  font-size: 14px;
  font-weight: 600;
  outline: none;
  box-shadow:
    6px 6px 14px $ui-soft-shadow,
    -3px -3px 10px $ui-soft-light;
  transition: box-shadow 260ms cubic-bezier(0.23, 1, 0.32, 1);
}

/* 聚焦时呈"按入"质感的凹陷效果 */
.vessel-level-input:focus {
  background-color: $ui-surface-3;
  box-shadow:
    inset 4px 4px 10px $ui-soft-shadow,
    inset -3px -3px 8px $ui-soft-light;
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
