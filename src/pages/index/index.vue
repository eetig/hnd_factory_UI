<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { onUnload } from '@dcloudio/uni-app'
import { useMessage, useToast } from 'wot-design-uni'
import dayjs from 'dayjs'
import request from '../../api/request'
import { uploadFiles } from '../../api/upload'
import { resolveAssetUrl } from '../../api/config'
import { clearAuth, getRoleName, hasPerm, isLoggedIn } from '../../api/auth'
import ProductSelectDialog from '../../components/ProductSelectDialog.vue'
import DateField from '../../components/DateField.vue'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import FilterHeaderCell from '../../components/FilterHeaderCell.vue'
import { useWorkOrderData } from '../../composables/useWorkOrderData'
import { usePickData } from '../../composables/usePickData'
import { useInboundData } from '../../composables/useInboundData'
import { useGoodsMoveData } from '../../composables/useGoodsMoveData'
// Excel 导入只在 H5 端保留。
// 原因（已确认）：App 与小程序没有 DOM，uni-app 也没有内置的 xlsx 文件选择器
//（uni.chooseFile 仅 H5 支持，小程序只能用 chooseMessageFile 从微信会话里选），
// 且「一次传 N 张图」的 multipart 也需要另做设计。
// 用条件编译整块排除，避免这笔代码进不了任何一端的包。
// #ifdef H5
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

// 提示与确认框：wot-design-uni 用 provide/inject 在组件树里共享实例。
// 本页调用 useToast()/useMessage() 会 provide 出选项 ref，
// 模板里的 <wd-toast/>、<wd-message-box/> 以及子组件（ImageParse 等）
// 再调用同名方法时会 inject 到同一份状态 —— 所以整页共用一个提示通道。
const toast = useToast()
const message = useMessage()

const tabs = [
  { key: 'workOrder', label: '工单汇总' },
  { key: 'material', label: '领料汇总' },
  { key: 'inbound', label: '入库汇总' },
  { key: 'report', label: '工单报工' },
  { key: 'costing', label: '工单核算' },
  { key: 'materialCosting', label: '原辅料核算' },
  { key: 'weekly', label: '周统计' },
  { key: 'daily', label: '日报表记录' },
  { key: 'vessel', label: '压力容器体积计算' },
  { key: 'electricity', label: '电费预提' },
  // #ifdef H5
  { key: 'import', label: '文件导入', perm: 'work_order:import' },
  // #endif
  // 图片解析：单据图片识别辅助录入（变更-003）。与文件导入同属录入入口，沿用同一权限位
  { key: 'imageParse', label: '图片解析', perm: 'work_order:import' },
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
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'orderType', label: '工单类型', width: 'w-40' },
  { key: 'materialDesc', label: '产成品', width: 'w-[200px]' },
  { key: 'orderQty', label: '订单数量', width: 'w-28', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-32', align: 'right' },
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


// ===== 工单核算 =====
const costingColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialName', label: '已入库产成品', width: 'w-[240px]', wrap: true },
  { key: 'materialCode', label: '产成品编码', width: 'w-36' },
  { key: 'inboundQty', label: '入库数', width: 'w-32', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-32', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-32', align: 'right' },
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
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialName', label: '已领物料名称', width: 'w-[240px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'pickQty', label: '领料数', width: 'w-32', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-32', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-32', align: 'right' },
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
  { key: 'name', label: '名称', width: 'w-[220px]' },
  { key: 'pickQty', label: '原料领用', width: 'w-32', align: 'right' },
  { key: 'remainingQty', label: '车间剩余', width: 'w-32', align: 'right' },
  { key: 'actualQty', label: '实际使用', width: 'w-32', align: 'right' },
  { key: 'unitConsumption', label: '单耗', width: 'w-32' },
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
// imageBounds 为底图中罐体的像素边界（由图像分析 + 轮廓叠加验证得出）
const VESSELS = [
  {
    key: 'silane',
    type: 'horizontal',
    label: '三氯氢硅储罐A/B示意图',
    diameter: 2800, // 筒体内径 φ2.8m
    cylinderLength: 5500, // 筒体长度 l=5.5m
    straightFlange: 40, // 封头直边 0.04m
    headDepth: 700, // 封头曲面内高度 hi=0.7m
    // 底图改用 /static 下的绝对路径。
    // 原因是 canvas 画图拿到的是路径字符串（不是 import 出来的模块 URL），
    // 三端里只有 /static 的路径是各端都认的（App 端由打包进 www 的资源解析）。
    image: '/static/vessel.png',
    imageBounds: { width: 2150, height: 1060, left: 75, right: 2069, top: 131, bottom: 931 },
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
    imageBounds: { width: 1760, height: 1938, left: 131, right: 1351, top: 63, tangent: 310, bottom: 1930 },
    displayWidth: 470,
    medium: '乙烯基三氯硅烷',
    density: 1.27, // GB/T 35498-2017，20°C、101.325kPa g/cm³（数值上等于 t/m³）
    note: '乙烯基三氯硅烷，基准条件：20℃，101.325 kPa（常压），液体密度 1.27 g/cm³；物性来源：GB/T 35498-2017《工业用乙烯基三氯硅烷》。',
    liquid: { fill: 'rgba(0, 255, 255, 0.4)', line: '#00ffff' },
  },
]

const vesselKey = ref(VESSELS[0].key)
const selectedVessel = computed(
  () => VESSELS.find((item) => item.key === vesselKey.value) ?? VESSELS[0],
)

// wd-picker 的选项格式（默认 valueKey='value'、labelKey='label'）
const vesselColumns = computed(() =>
  VESSELS.map((vessel) => ({ value: vessel.key, label: vessel.label })),
)

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

// 储罐画布：改造前直接用 DOM canvas（canvas.getContext('2d') + Path2D + devicePixelRatio），
// 这些东西在小程序/App 端都不存在。改用 uni.createCanvasContext —— 老版画布 API，
// 三端（H5 / App / 小程序）都有实现，是唯一一条能三端通用的路径。
//
// 它相对标准 Canvas2D 缺了三样东西，下面各有替代实现：
//   1. 没有 Path2D 对象（且 clip()/fill()/stroke() 不吃参数）→ createPath() 记录 + 回放
//   2. 没有 ellipse()                                      → ellipseTo() 用贝塞尔逼近
//   3. 不自动上屏                                          → 每次绘制结尾必须 ctx.draw()
const VESSEL_CANVAS_ID = 'vesselCanvas'
let vesselCtx = null
let vesselCanvasSize = null // { width, height } 画布实际显示的 CSS 尺寸
let vesselImagePath = '' // 底图路径（老版 drawImage 直接吃路径字符串）

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

// 规格说明（随所选储罐变化）
const vesselDescription = computed(() => {
  const g = vesselGeometry.value
  const m = (value) => (value / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  const capacity = vesselCapacity.value.toFixed(1)

  const medium = g.medium && g.density
    ? `介质 ${g.medium}（ρ=${g.density} g/cm³，20°C、101.325 kPa）｜`
    : ''

  if (g.type === 'vertical') {
    return `${medium}筒体 φ${m(g.diameter)}m，筒体高度 ${m(g.cylinderHeight)}m，封头内高度 ${m(g.headDepth)}m，总容积 ${capacity} m³`
  }

  return `筒体 l=${m(g.cylinderLength)}m，φ${m(g.diameter)}m，直边 ${m(g.straightFlange)}m，封头内高度 hi=${m(g.headDepth)}m，总容积 ${capacity} m³`
})

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

/**
 * Path2D 的替代品：记录路径指令，用的时候回放到 ctx 上。
 *
 * 老版画布的 clip() / fill() / stroke() 都不接受参数，只能消费「当前路径」；
 * 而罐体轮廓这条路径在代码里要反复使用（先 clip，再做差值带，再画虚线液位），
 * 所以必须能把同一条路径回放多次。
 */
function createPath() {
  const ops = []
  const push = (name) => (...args) => ops.push([name, ...args])

  return {
    moveTo: push('moveTo'),
    lineTo: push('lineTo'),
    closePath: push('closePath'),
    ellipse: push('ellipse'),
    replay(ctx) {
      ctx.beginPath()
      for (const [name, ...args] of ops) {
        if (name === 'ellipse') ellipseTo(ctx, ...args)
        else if (name === 'closePath') ctx.closePath()
        else ctx[name](...args)
      }
      return ctx
    },
  }
}

/**
 * 椭圆弧 → 三次贝塞尔。
 * 老版 CanvasContext 没有 ellipse()，而两种罐型的封头都必须画椭圆弧。
 * 按 ≤90° 分段，每段用一条贝塞尔逼近（标准 kappa 构造，误差远小于一个像素）。
 */
function ellipseTo(ctx, cx, cy, rx, ry, rotation, startAngle, endAngle) {
  const segments = Math.ceil(Math.abs(endAngle - startAngle) / (Math.PI / 2)) || 1
  const step = (endAngle - startAngle) / segments
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation)

  // 椭圆上一点（含旋转）
  const pointAt = (angle) => {
    const x = rx * Math.cos(angle)
    const y = ry * Math.sin(angle)
    return [cx + x * cosR - y * sinR, cy + x * sinR + y * cosR]
  }

  // 椭圆在 angle 处的切线方向（未旋转）
  const tangentAt = (angle) => [-rx * Math.sin(angle), ry * Math.cos(angle)]

  for (let i = 0; i < segments; i += 1) {
    const a1 = startAngle + step * i
    const a2 = a1 + step
    const k = (4 / 3) * Math.tan((a2 - a1) / 4)

    const [x1, y1] = pointAt(a1)
    const [x2, y2] = pointAt(a2)
    const [dx1, dy1] = tangentAt(a1)
    const [dx2, dy2] = tangentAt(a2)

    ctx.bezierCurveTo(
      x1 + k * (dx1 * cosR - dy1 * sinR),
      y1 + k * (dx1 * sinR + dy1 * cosR),
      x2 - k * (dx2 * cosR - dy2 * sinR),
      y2 - k * (dx2 * sinR + dy2 * cosR),
      x2,
      y2,
    )
  }
}

/** 等底图加载好（老版 drawImage 内部会自行加载，这里只需把路径记下来） */
function loadVesselImage() {
  const url = selectedVessel.value.image
  if (vesselImagePath === url) {
    renderVessel()
    return
  }

  vesselImagePath = url
  // 切换罐型时给画布一个淡出 → 淡入的过渡
  vesselSwitching.value = true
  ensureCanvasContext().then(() => {
    renderVessel()
    // 等淡出动画基本结束再淡入，避免闪烁
    setTimeout(() => {
      vesselSwitching.value = false
    }, 330)
  })
}

/**
 * 取画布上下文与它实际显示的尺寸。
 *
 * 老版画布的坐标就是元素实际渲染的 CSS 像素，而绘制逻辑是按逻辑坐标系
 * (W × H) 写的，所以必须知道真实尺寸才能把逻辑坐标缩放上去 ——
 * 这等价于改造前的「canvas.width = W * dpr + setTransform(dpr, ...)」，
 * 只是缩放比现在由布局决定，而不是 devicePixelRatio。
 *
 * 两个坑导致这里要重试：
 *   1. 压力容器 Tab 用 v-show 隐藏，元素为 display:none 时量出来是 0×0；
 *   2. 切 Tab 的 watch 默认在 DOM 更新前触发。
 * 所以先等一拍，量不到就再等一帧，最多试 10 次后放弃（避免死循环）。
 */
function ensureCanvasContext(attempt = 0) {
  return nextTick().then(
    () =>
      new Promise((resolve) => {
        const measure = () =>
          uni
            .createSelectorQuery()
            .select(`#${VESSEL_CANVAS_ID}`)
            .boundingClientRect((rect) => {
              vesselCtx = uni.createCanvasContext(VESSEL_CANVAS_ID)

              if (rect && rect.width && rect.height) {
                vesselCanvasSize = { width: rect.width, height: rect.height }
                resolve()
                return
              }

              if (attempt >= 10) {
                resolve()
                return
              }

              setTimeout(() => resolve(ensureCanvasContext(attempt + 1)), 32)
            })
            .exec()

        measure()
      }),
  )
}

function stopVesselLoop() {
  if (vesselFrameId !== null) {
    vesselCaf(vesselFrameId)
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
    vesselFrameId = vesselRaf(vesselFrame)
  } else {
    vesselFrameId = null
  }
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
    displayRef.value = target
    vesselTransitions[which] = null
    renderVessel()
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

// 底图：卧式椭圆封头储罐图纸
// 罐体在底图中的像素边界（由图像分析 + 轮廓叠加验证得出，横纵比例尺一致：0.28567 px/mm）

// 绘制罐体底图与液位填充
function renderVessel() {
  const ctx = vesselCtx
  if (!ctx || !vesselImagePath) return

  const geometry = vesselGeometry.value
  const bounds = geometry.imageBounds

  // 画布尺寸按底图比例自适应
  const IMAGE_W = VESSEL_CANVAS_WIDTH
  const LABEL_COLUMN = VESSEL_LABEL_COLUMN
  const W = IMAGE_W + LABEL_COLUMN
  const H = Math.round((IMAGE_W * bounds.height) / bounds.width)

  // 逻辑坐标系 (W × H) → 画布实际 CSS 尺寸。
  // 首帧可能还没量到尺寸（boundingClientRect 是异步的），此时跳过这一帧，
  // 等 ensureCanvasContext 的 promise 回来会再触发一次绘制。
  const size = vesselCanvasSize
  if (!size) return

  ctx.save()
  // 取 min 而不是只按宽度缩放：万一某端不支持 CSS aspect-ratio、
  // 画布高度被平台默认值顶掉，按宽度缩放会把底部裁掉。取 min 的代价只是留白，
  // 不会丢内容。尺寸正确时（绝大多数情况）两者相等。
  const scale = Math.min(size.width / W, size.height / H)
  ctx.scale(scale, scale)

  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(vesselImagePath, 0, 0, IMAGE_W, H)

  const s = IMAGE_W / bounds.width
  const vesselPath = createPath()
  let tankLeft
  let tankRight
  let bottomY
  let levelToY

  if (geometry.type === 'vertical') {
    // 立式罐：顶部半椭球封头 + 等径筒体
    const left = bounds.left * s
    const right = bounds.right * s
    const tangentY = bounds.tangent * s
    const bottom = bounds.bottom * s
    const cx = (left + right) / 2
    const rx = (right - left) / 2
    const ry = tangentY - bounds.top * s
    const apexY = bounds.top * s

    vesselPath.moveTo(left, tangentY)
    vesselPath.ellipse(cx, tangentY, rx, ry, 0, Math.PI, Math.PI * 2)
    vesselPath.lineTo(right, bottom)
    vesselPath.lineTo(left, bottom)
    vesselPath.closePath()

    tankLeft = left
    tankRight = right
    bottomY = bottom

    // 液位映射：筒体段、封头段分别对应底图中各自的高度
    // （底图封头绘制得比实际略扁，分段映射可保证液面始终贴合图纸结构）
    levelToY = (level) => {
      if (level <= geometry.cylinderHeight) {
        return bottom - (level / geometry.cylinderHeight) * (bottom - tangentY)
      }
      const t = Math.min(geometry.headDepth, level - geometry.cylinderHeight)
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
      const path = createPath()
      points.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)))
      if (closeToBottom) {
        path.lineTo(tankRight, bottomY + 6)
        path.lineTo(tankLeft, bottomY + 6)
        path.closePath()
      }
      return path
    }

    ctx.save()
    vesselPath.replay(ctx)
    ctx.clip()
    ctx.lineJoin = 'round'

    // 终止液位：填充 + 实线液面
    if (vesselEndDisplay.value > 0) {
      const wavePoints = buildWave(levelY)
      ctx.fillStyle = geometry.liquid.fill
      toPath(wavePoints, true).replay(ctx)
      ctx.fill()

      ctx.strokeStyle = geometry.liquid.line
      ctx.lineWidth = 2
      toPath(wavePoints, false).replay(ctx)
      ctx.stroke()
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
      const bandPath = createPath()
      upperWave.forEach(([x, y], i) => (i === 0 ? bandPath.moveTo(x, y) : bandPath.lineTo(x, y)))
      for (let i = lowerWave.length - 1; i >= 0; i -= 1) {
        bandPath.lineTo(lowerWave[i][0], lowerWave[i][1])
      }
      bandPath.closePath()

      ctx.save()
      bandPath.replay(ctx)
      ctx.clip()

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
      // 老版 setLineDash 签名是 (pattern, offset)，只传 pattern 在部分端上会报错
      ctx.setLineDash([9, 6], 0)
      toPath(buildWave(startLevelY), false).replay(ctx)
      ctx.stroke()
      ctx.setLineDash([], 0)
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
      // 老版画布没有 textAlign / textBaseline 属性，只有 setter 方法
      ctx.setTextAlign('right')
      ctx.setTextBaseline('middle')

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

  ctx.restore()

  // 老版画布不会自动上屏：前面所有绘制都只是入队，必须显式 draw() 才真正画出来。
  // 少了这一句，画布永远是空白的。
  ctx.draw()
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
// （loadVesselImage 的定义在画布 helper 那一段 —— 老版画布不需要 Image 对象，
//   底图路径直接交给 drawImage，所以实现比改造前短很多）
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
  // 罐体底图（约 645 KB）改为切到压力容器 Tab 时按需加载，不拖慢首屏
})

onUnmounted(cleanupVessel)
onUnload(cleanupVessel)

// 切到压力容器 Tab 时按需加载底图 + 启动波纹动画，离开时停帧
watch(activeTab, (tab, prevTab) => {
  if (tab === 'vessel') {
    loadVesselImage()
    startVesselLoop()
  } else {
    stopVesselLoop()
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
  <view class="page">
    <view class="mx-auto max-w-7xl">
      <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">Factory Operations</p>
          <h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">工单汇总</h1>
          <p class="mt-2 text-sm text-slate-500">查看当前所有生产工单及处理状态</p>
        </div>
        <div class="flex items-center gap-3 text-sm text-slate-500">
          <span>共 <span class="font-semibold text-slate-900">{{ total }}</span> 条工单</span>
          <span class="text-slate-300">|</span>

          <!-- 未登录即可只读浏览；写入类功能按权限隐藏，登录入口放这里 -->
          <template v-if="loggedIn">
            <span>{{ roleName }}</span>
            <button
             
              class="rounded px-1.5 py-0.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
              @click="handleLogout"
            >
              退出
            </button>
          </template>
          <template v-else>
            <span class="text-slate-400">只读浏览</span>
            <button
             
              class="rounded px-2 py-0.5 font-medium text-sky-600 transition hover:bg-sky-50"
              @click="goLogin"
            >
              登录
            </button>
          </template>
        </div>
      </header>

      <nav class="mb-6 flex gap-8 border-b border-slate-200" aria-label="页面切换">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
         
          class="relative pb-3 pt-1 text-sm font-medium transition focus:outline-none"
          :class="activeTab === tab.key ? 'text-sky-600' : 'text-slate-500 hover:text-slate-700'"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span
            v-if="activeTab === tab.key"
            class="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-sky-600"
            aria-hidden="true"
          ></span>
        </button>
      </nav>

      <div v-show="activeTab === 'workOrder'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
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
            <view class="dt min-w-full divide-y divide-slate-200 text-left">
              <view class="dt__head bg-slate-50">
                <view class="dt__row">
                  <view
                    v-for="column in columns"
                    :key="column.key"
                    scope="col"
                    class="dt__cell whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
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
                  <view class="dt__cell w-16 whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ (pageNum - 1) * pageSize + index + 1 }}</view>
                  <view class="dt__cell w-36 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ order.planStartDate }}</view>
                  <view class="dt__cell w-40 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ order.orderNo }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ getReportOrderType(order.orderNo) }}</view>
                  <view class="dt__cell w-36 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ order.materialCode }}</view>
                  <view class="dt__cell w-[180px] max-w-[180px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                    {{ order.materialDesc }}
                  </view>
                  <view class="dt__cell w-28 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ order.orderQty }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ order.confirmedQty }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ order.deliveredQty }}</view>
                </view>
              </view>
            </view>
          </div>

          <div class="flex justify-end border-t border-slate-100 px-6 py-4">
            <wd-pagination
              v-model="pageNum"
              :total="total"
              :page-size="pageSize"
              show-message
              :hide-if-one-page="false"
              @change="getPageData"
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
        custom-style="width: 92vw; max-height: 88vh; border-radius: 16px; background-color: #fff; display: flex; flex-direction: column; overflow: hidden;"
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
            <image
              class="viewer-stage__img"
              :src="resolveAssetUrl(imageList[currentIndex].url)"
              mode="aspectFit"
              alt="物料原图"
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
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
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
                <view class="dt min-w-full divide-y divide-slate-200 text-left">
                  <view class="dt__head bg-slate-50">
                    <view class="dt__row">
                      <view
                        v-for="column in pickColumns"
                        :key="column.key"
                        scope="col"
                        class="dt__cell whitespace-nowrap py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
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
                      </view>
                    </view>
                  </view>
                  <view class="dt__body divide-y divide-slate-100 bg-white">
                    <view
                      v-for="(record, index) in pickTableData"
                      :key="`${record.materialCode}-${record.pickDate}-${index}`"
                      class="dt__row transition hover:bg-slate-50"
                    >
                      <view class="dt__cell w-16 whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ (pickPageNum - 1) * pickPageSize + index + 1 }}</view>
                      <view class="dt__cell w-36 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.pickDate }}</view>
                      <view class="dt__cell w-[200px] max-w-[200px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                        {{ record.materialName }}
                      </view>
                      <view class="dt__cell w-36 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.materialCode }}</view>
                      <view class="dt__cell w-28 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ record.pickQty }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.unit }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap px-3 py-2 text-sm text-slate-600">
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

              <div class="flex justify-end border-t border-slate-100 px-6 py-2.5">
                <wd-pagination
              v-model="pickPageNum"
              :total="pickTotal"
              :page-size="pickPageSize"
              show-message
              :hide-if-one-page="false"
              @change="getPickPageData"
            />
              </div>
            </div>
          </div>
        </section>

        <wd-popup
          v-model="pickImageDialogVisible"
          position="center"
          custom-style="width: 90vw; border-radius: 16px; padding: 16px; background-color: #f8fafc;"
        >
          <image
            v-if="currentPickImage"
            class="simple-viewer__img"
            :src="resolveAssetUrl(currentPickImage)"
            mode="aspectFit"
            alt="领料单据大图"
          />
        </wd-popup>

        <ProductSelectDialog
          v-model="pickMaterialDialogVisible"
          :options="pickMaterialOptions"
          :selected="pickMaterialFilter"
          label="物料名称"
          @select="handlePickMaterialSelected"
        />
      </div>

      <div v-show="activeTab === 'inbound'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
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
                <view class="dt min-w-full divide-y divide-slate-200 text-left">
                  <view class="dt__head bg-slate-50">
                    <view class="dt__row">
                      <view
                        v-for="column in inboundColumns"
                        :key="column.key"
                        scope="col"
                        class="dt__cell whitespace-nowrap py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
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
                      </view>
                    </view>
                  </view>
                  <view class="dt__body divide-y divide-slate-100 bg-white">
                    <view
                      v-for="(record, index) in inboundTableData"
                      :key="`${record.materialCode}-${record.inboundDate}-${index}`"
                      class="dt__row transition hover:bg-slate-50"
                    >
                      <view class="dt__cell w-16 whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ (inboundPageNum - 1) * inboundPageSize + index + 1 }}</view>
                      <view class="dt__cell w-36 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.inboundDate }}</view>
                      <view class="dt__cell w-[200px] max-w-[200px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                        {{ record.materialName }}
                      </view>
                      <view class="dt__cell w-36 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.materialCode }}</view>
                      <view class="dt__cell w-28 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ record.inboundQty }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ record.unit }}</view>
                      <view class="dt__cell w-24 whitespace-nowrap px-3 py-2 text-sm text-slate-600">
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

              <div class="flex justify-end border-t border-slate-100 px-6 py-2.5">
                <wd-pagination
              v-model="inboundPageNum"
              :total="inboundTotal"
              :page-size="inboundPageSize"
              show-message
              :hide-if-one-page="false"
              @change="getInboundPageData"
            />
              </div>
            </div>
          </div>
        </section>

        <wd-popup
          v-model="inboundImageDialogVisible"
          position="center"
          custom-style="width: 90vw; border-radius: 16px; padding: 16px; background-color: #f8fafc;"
        >
          <image
            v-if="currentInboundImage"
            class="simple-viewer__img"
            :src="resolveAssetUrl(currentInboundImage)"
            mode="aspectFit"
            alt="入库单据大图"
          />
        </wd-popup>

        <ProductSelectDialog
          v-model="inboundMaterialDialogVisible"
          :options="inboundMaterialOptions"
          :selected="inboundMaterialFilter"
          label="物料名称"
          @select="handleInboundMaterialSelected"
        />
      </div>

      <div v-show="activeTab === 'report'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <view class="dt min-w-full divide-y divide-slate-200 text-left">
              <view class="dt__head bg-slate-50">
                <view class="dt__row">
                  <view
                    v-for="column in reportColumns"
                    :key="column.key"
                    scope="col"
                    class="dt__cell whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
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
                  <view class="dt__cell w-16 whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ index + 1 }}</view>
                  <view class="dt__cell w-40 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ item.orderType }}</view>
                  <view class="dt__cell w-[200px] max-w-[200px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                    {{ item.materialDesc }}
                  </view>
                  <view class="dt__cell w-28 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.orderQty }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.confirmedQty }}</view>
                </view>
              </view>
            </view>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'costing'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <view class="dt min-w-full divide-y divide-slate-200 text-left">
              <view class="dt__head bg-slate-50">
                <view class="dt__row">
                  <view
                    v-for="column in costingColumns"
                    :key="column.key"
                    scope="col"
                    class="dt__cell whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
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
                  <view class="dt__cell w-16 whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ index + 1 }}</view>
                  <view class="dt__cell w-[240px] max-w-[240px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                    {{ item.materialName }}
                  </view>
                  <view class="dt__cell w-36 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ item.materialCode }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.inboundQty }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.reportedQty }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm font-semibold text-sky-700">{{ item.unreportedQty }}</view>
                </view>
              </view>
            </view>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'materialCosting'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <view class="dt min-w-full divide-y divide-slate-200 text-left">
              <view class="dt__head bg-slate-50">
                <view class="dt__row">
                  <view
                    v-for="column in materialCostingColumns"
                    :key="column.key"
                    scope="col"
                    class="dt__cell whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
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
                  <view class="dt__cell w-16 whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">{{ index + 1 }}</view>
                  <view class="dt__cell w-[240px] max-w-[240px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700">
                    {{ item.materialName }}
                  </view>
                  <view class="dt__cell w-36 whitespace-nowrap px-3 py-2 text-sm text-slate-600">{{ item.materialCode }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.pickQty }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm text-slate-600">{{ item.reportedQty }}</view>
                  <view class="dt__cell w-32 whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm font-semibold text-sky-700">{{ item.unreportedQty }}</view>
                </view>
              </view>
            </view>
          </div>
        </section>
      </div>

      <div v-show="activeTab === 'weekly'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
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
                    <view class="dt__grow border border-slate-300 px-3 py-2 text-base font-bold tracking-wide text-slate-800">
                      {{ weeklyTitle }}
                    </view>
                  </view>

                  <view class="dt__row">
                    <view
                      v-for="column in weeklyColumns"
                      :key="column.key"
                      class="dt__cell border border-slate-300 bg-cyan-100 py-3 text-sm font-semibold text-slate-700"
                      :class="[column.width, column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3']"
                    >
                      {{ column.label }}
                    </view>
                  </view>
                </view>

                <view class="dt__body">
                  <view v-for="row in weeklyRows" :key="row.name" class="dt__row">
                    <view class="dt__cell w-[220px] border border-slate-300 px-3 py-2 text-sm text-slate-700">{{ row.name }}</view>
                    <view class="dt__cell w-32 border border-slate-300 py-2 pl-3 pr-5 text-right text-sm text-slate-700">{{ row.pickQty }}</view>
                    <view class="dt__cell w-32 border border-slate-300 p-0">
                      <input
                        v-model="weeklyRemaining[row.materialCode]"
                        type="text"
                        placeholder="/"
                        aria-label="车间剩余"
                        class="weekly-input"
                      />
                    </view>
                    <view class="dt__cell w-32 border border-slate-300 py-2 pl-3 pr-5 text-right text-sm text-slate-700">{{ row.actualQty }}</view>
                    <view class="dt__cell w-32 border border-slate-300 px-3 py-2 text-sm text-slate-700">{{ row.unitConsumption }} {{ row.unitLabel }}</view>
                  </view>

                  <view class="dt__row">
                    <view class="dt__cell w-[220px] border border-slate-300 px-3 py-2 text-sm text-slate-700">{{ weeklyInboundRow.name }}</view>
                    <view class="dt__grow border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800">
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
          custom-style="width: 92vw; max-height: 88vh; border-radius: 16px; background-color: #fff; display: flex; flex-direction: column; overflow: hidden;"
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

              <image
                class="viewer-stage__img"
                :src="resolveAssetUrl(weeklyImageList[weeklyCurrentIndex].url)"
                mode="aspectFit"
                alt="物料原图"
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
          @select="handleWeeklyProductSelected"
        />
      </div>

      <div v-show="activeTab === 'daily'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <PanelState
              title="日报表记录"
              description="功能建设中，敬请期待"
            />
        </section>
      </div>

      <div v-show="activeTab === 'vessel'">
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <!-- 储罐切换：位置在两种罐型下保持一致，切换时不跳动 -->
          <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-slate-100 px-6 py-3.5">
            <div class="min-w-0 flex-1">
              <p class="text-xs text-slate-500">{{ vesselDescription }}</p>
              <p v-if="vesselGeometry.note" class="mt-1 text-xs font-medium text-amber-700">
                {{ vesselGeometry.note }}
              </p>
            </div>
            <!-- 储罐选择：el-select 换成 wd-picker。
                 wd-picker 支持默认插槽做触发器，这里沿用原来那个紧凑的行内样式，
                 而不是它默认的「标签 + 值」表单行 —— 位置在两种罐型下要保持一致。 -->
            <wd-picker v-model="vesselKey" :columns="vesselColumns">
              <view class="vessel-select" aria-label="选择储罐">
                <text>{{ selectedVessel.label }}</text>
                <wd-icon name="arrow-down" size="14px" />
              </view>
            </wd-picker>
          </div>

          <div class="flex flex-wrap items-stretch" :class="isVerticalVessel ? 'gap-x-6 p-6' : ''">
            <div class="flex justify-center" :class="isVerticalVessel ? 'shrink-0' : 'w-full p-6'">
              <!-- 储罐画布（老版画布 API）：
                   canvas-id 是 uni.createCanvasContext 的取用键；
                   id 供 createSelectorQuery 量尺寸 —— 量到的实际宽高决定
                   逻辑坐标系 (W × H) 的缩放比，所以两者都不能省。 -->
              <canvas
                id="vesselCanvas"
                canvas-id="vesselCanvas"
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
                :class="isVerticalVessel ? 'px-0 pb-4 pt-5' : 'rounded-xl border border-slate-200 bg-slate-50 px-6 py-4'"
            >
              <span class="text-sm text-slate-500">体积变化</span>
              <span
                class="text-2xl font-bold tracking-tight"
                :class="vesselVolumeDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'"
              >{{ vesselVolumeDelta >= 0 ? '+' : '' }}{{ vesselVolumeDelta.toFixed(2) }}</span>
              <span class="text-sm text-slate-500">m³</span>
              <span
                v-if="vesselMassDelta !== null"
                class="text-base font-semibold"
                :class="vesselVolumeDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'"
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
                      class="vessel-step"
                      aria-label="降低起始液位"
                      @touchstart.prevent="startStepHold('start', -1)"
                      @touchend="stopStepHold"
                      @touchcancel="stopStepHold"
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
                      @touchstart.prevent="startStepHold('start', 1)"
                      @touchend="stopStepHold"
                      @touchcancel="stopStepHold"
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
                    体积：<span class="font-semibold text-sky-600">{{ vesselStartVolume.toFixed(2) }}</span> m³<template v-if="vesselStartMass !== null"><span class="ml-1 text-slate-400">（{{ vesselStartMass.toFixed(2) }} t）</span></template>
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
                      class="vessel-step"
                      aria-label="降低终止液位"
                      @touchstart.prevent="startStepHold('end', -1)"
                      @touchend="stopStepHold"
                      @touchcancel="stopStepHold"
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
                      @touchstart.prevent="startStepHold('end', 1)"
                      @touchend="stopStepHold"
                      @touchcancel="stopStepHold"
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
                    体积：<span class="font-semibold text-sky-600">{{ vesselEndVolume.toFixed(2) }}</span> m³<template v-if="vesselEndMass !== null"><span class="ml-1 text-slate-400">（{{ vesselEndMass.toFixed(2) }} t）</span></template>
                  </div>
                </div>
              </div>
            </div>
            </div>
            </div>
          </div>

          <div class="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
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
        <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
          <!-- 电价档位备注 -->
          <div class="border-b border-slate-100 bg-amber-50/40 px-6 py-4">
            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-600">
                !
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-slate-800">电价档位备注</h3>
                <div class="mt-3 grid gap-3 sm:grid-cols-3">
                  <div class="rounded-lg border border-amber-200/70 bg-white px-4 py-2.5">
                    <p class="text-xs text-slate-500">10 万度以内</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      1.1 ~ 1.2<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                    </p>
                  </div>
                  <div class="rounded-lg border border-amber-200/70 bg-white px-4 py-2.5">
                    <p class="text-xs text-slate-500">20 万度以内</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      0.9 ~ 1<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                    </p>
                  </div>
                  <div class="rounded-lg border border-amber-200/70 bg-white px-4 py-2.5">
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

      <!-- #ifdef H5 -->
      <div v-show="activeTab === 'import'">
        <WorkOrderImport
          @cancel="handleImportCancel"
          @back="handleImportBack"
          @imported="importDirty = true"
        />
      </div>
      <!-- #endif -->

      <div v-show="activeTab === 'imageParse'">
        <ImageParse />
      </div>
    </view>

    <!-- 提示与确认框的宿主组件。
         wot-design-uni 的 useToast()/useMessage() 走 provide/inject：
         本页 setup 里调用它们会 provide 出选项 ref，这两个组件再 inject 回来。
         挂在页面根部，本页与所有子组件（ImageParse 等）的提示都走同一对实例。 -->
    <wd-toast />
    <wd-message-box />
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
  padding: calc(var(--status-bar-height, 0px) + 32px) 16px 32px;
  background-color: $slate-50;
}

/* ===== 数据表格 =====
   改造前用的是原生 <table> + <colgroup> + table-fixed。
   小程序端没有表格布局（WXSS 也不支持 display: table），<table>/<tr>/<td>
   会被 uni-app 编译成一堆嵌套 view，表格排版整个丢失。
   因此改成 flex 行：
     - .dt__row 是 flex 容器，.dt__cell 为不收缩的定宽项；
     - 列宽沿用原先 columns[].width 的那批 Tailwind w-* 类，语义不变；
     - 跨列单元格（原 colspan）改用 .dt__grow 占满剩余宽度；
     - 外层 overflow-x-auto 保留，列多时横向滚动，与改造前行为一致。
   注：本块所在的 <style> 已声明 lang="scss"（用于 // 注释与 uni.scss 变量）。 */
.dt {
  min-width: 100%;
}

.dt__head {
  background-color: $slate-50;
}

.dt__row {
  display: flex;
  min-width: 100%;
  align-items: stretch;
}

/* flex 子项默认会被压缩，不关掉的话列宽对不齐 */
.dt__row > view {
  flex-shrink: 0;
}

/* 表格为空时的整行提示 */
.dt__empty {
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
  border: 1px solid $slate-200;
  border-radius: 4px;
  background-color: #fff;
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

.viewer-stage {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
}

/* uni 的 image 组件不会自己撑开，必须给显式高度 */
.viewer-stage__img {
  width: 100%;
  height: 56vh;
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
  border-radius: 50%;
  background-color: rgba(15, 23, 42, 0.45);
  color: #fff;
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

/* 储罐选择器：按标题样式呈现。
   改造前这些样式挂在 :deep(.el-select__wrapper) 上 —— 覆写的是 Element Plus 的
   内部结构。现在触发器就是我们自己的 view，样式直接写在它身上，不再需要 :deep()；
   同时去掉了 hover / is-focused 两条 —— 触屏没有 hover，
   而 :deep(.is-focused) 那个类名也是 Element Plus 专属的。 */
.vessel-select {
  display: inline-flex;
  width: 224px; /* 固定宽度，避免被拉伸到整行 */
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 10px;
  box-shadow: 0 0 0 1px rgb(203 213 225) inset;
  color: rgb(15 23 42);
  font-size: 15px;
  font-weight: 600;
  transition: box-shadow 0.2s ease;
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