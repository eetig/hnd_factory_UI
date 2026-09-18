<script setup>
import { computed, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import request from '../api/request'
import ProductSelectDialog from '../components/ProductSelectDialog.vue'
import WorkOrderImport from './WorkOrderImport.vue'
import 'dayjs/locale/zh-cn'
import updateLocale from 'dayjs/plugin/updateLocale'
import {
  ElButton,
  ElConfigProvider,
  ElDatePicker,
  ElDialog,
  ElMessage,
  ElMessageBox,
  ElPagination,
} from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'

dayjs.extend(updateLocale)
dayjs.updateLocale('zh-cn', { weekStart: 1 })
dayjs.locale('zh-cn')

const tabs = [
  { key: 'workOrder', label: '工单汇总' },
  { key: 'import', label: '文件导入' },
]
const activeTab = ref('workOrder')

const tableData = ref([])
const tableDataAll = ref([])
const allWorkOrders = ref([])
const pageNum = ref(1)
const pageSize = ref(10)
const total = ref(0)
const loading = ref(false)
const errorMessage = ref('')
const startDate = ref(getFirstDayOfCurrentMonth())
const endDate = ref(getToday())
const imageList = ref([])
const currentIndex = ref(0)
const currentMaterialDesc = ref('')
const currentConfirmedQty = ref('')
const currentOrderNo = ref('')
const imageDialogVisible = ref(false)
const imageFileInput = ref(null)
const imageUploading = ref(false)
const imageDeleting = ref(false)
const productDialogVisible = ref(false)
const productFilter = ref('')

const productOptions = computed(() => {
  const names = allWorkOrders.value
    .filter(matchesDateRange)
    .map((order) => String(order.materialDesc ?? '').trim())
    .filter(Boolean)

  return [...new Set(names)].sort((left, right) => left.localeCompare(right, 'zh-CN'))
})

const columns = [
  { key: 'index', label: '序号' },
  { key: 'orderNo', label: '工单类型' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'materialDesc', label: '产成品' },
  { key: 'orderQty', label: '订单数量' },
  { key: 'planStartDate', label: '基本开始日期' },
  { key: 'confirmedQty', label: '确认的产量' },
  { key: 'imageUrl', label: '入库单据' },
]

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getToday() {
  return formatDate(new Date())
}

function getFirstDayOfCurrentMonth() {
  const date = new Date()
  date.setDate(1)
  return formatDate(date)
}

function normalizeImage(image) {
  if (typeof image === 'string') {
    return { imageId: image, url: image }
  }

  return {
    imageId: image?.imageId ?? image?.id ?? '',
    url: image?.url ?? image?.imageUrl ?? image?.fileUrl ?? image?.path ?? '',
  }
}

function normalizeImageList(images) {
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

  return imageValues.map(normalizeImage).filter((image) => image.url)
}

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

function openProductDialog() {
  productDialogVisible.value = true
}

function handleProductSelected(materialDesc) {
  productFilter.value = materialDesc
  productDialogVisible.value = false
  filterWorkOrders()
}

function clearProductFilter() {
  productFilter.value = ''
  filterWorkOrders()
}

function openFilePicker() {
  imageFileInput.value?.click()
}

function handleImportCancel() {
  activeTab.value = 'workOrder'
}

function handleImportBack() {
  activeTab.value = 'workOrder'
  fetchWorkOrders()
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

async function handleImageSelected(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''

  if (!files.length || !currentOrderNo.value) return

  imageUploading.value = true

  try {
    const formData = new FormData()
    formData.append('orderNo', currentOrderNo.value)
    files.forEach((file) => formData.append('files', file))

    const res = await request.post('/api/work-order/image/upload', formData)
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
    ElMessage.success('图片上传成功')
  } catch (error) {
    ElMessage.error(error.response?.data?.msg || error.message || '图片上传失败，请重试。')
  } finally {
    imageUploading.value = false
  }
}

async function deleteImage(image) {
  if (!currentOrderNo.value || !image?.imageId) return

  try {
    await ElMessageBox.confirm(
      '删除后将无法在当前工单中查看该图片，是否继续？',
      '确认删除图片',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      },
    )
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
    ElMessage.success('图片已删除')
  } catch (error) {
    ElMessage.error(error.response?.data?.msg || error.message || '图片删除失败，请重试。')
  } finally {
    imageDeleting.value = false
  }
}

function getPageData(page = pageNum.value) {
  pageNum.value = page
  const startIndex = (pageNum.value - 1) * pageSize.value
  const endIndex = startIndex + pageSize.value
  tableData.value = tableDataAll.value.slice(startIndex, endIndex)
}

function normalizeWorkOrder(item) {
  if (!item) return null
  const order = item.workOrder
    ? { ...item.workOrder, ...item }
    : { ...item }
  order.imageList = normalizeImageList(order.imageList)
  return order
}

function getOrderDate(order) {
  return String(order?.planStartDate || '').slice(0, 10)
}

function sortWorkOrders(workOrders) {
  return [...workOrders].sort((left, right) => {
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

function matchesDateRange(order) {
  const planStartDate = getOrderDate(order)
  if (!planStartDate) return false
  return planStartDate >= startDate.value && planStartDate <= endDate.value
}

function matchesProductFilter(order) {
  if (!productFilter.value) return true
  return String(order.materialDesc ?? '').trim() === productFilter.value
}

function filterWorkOrders() {
  tableDataAll.value = allWorkOrders.value.filter(
    (order) => matchesDateRange(order) && matchesProductFilter(order),
  )

  total.value = tableDataAll.value.length
  pageNum.value = 1
  getPageData()
}

async function fetchWorkOrders() {
  loading.value = true
  errorMessage.value = ''

  try {
    const res = await request.get('/api/work-order/list')
    if (res.data.success === true) {
      const dataList = Array.isArray(res.data.dataList)
        ? res.data.dataList.map(normalizeWorkOrder).filter(Boolean)
        : []

      allWorkOrders.value = sortWorkOrders(dataList)
      filterWorkOrders()
    } else {
      allWorkOrders.value = []
      tableDataAll.value = []
      tableData.value = []
      total.value = 0
      errorMessage.value = res.data.msg || '工单接口返回异常，请稍后重试。'
    }
  } catch (error) {
    allWorkOrders.value = []
    tableDataAll.value = []
    tableData.value = []
    total.value = 0
    errorMessage.value = error.response?.data?.msg || '工单数据加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

onMounted(fetchWorkOrders)
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
    <div class="mx-auto max-w-7xl">
      <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">Factory Operations</p>
          <h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">工单汇总</h1>
          <p class="mt-2 text-sm text-slate-500">查看当前所有生产工单及处理状态</p>
        </div>
        <div class="text-sm text-slate-500">
          共 <span class="font-semibold text-slate-900">{{ total }}</span> 条工单
        </div>
      </header>

      <nav class="mb-6 flex gap-8 border-b border-slate-200" aria-label="页面切换">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
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
            <div v-if="loading" class="loading-mask" aria-label="正在加载工单">
          <div class="loader" role="status" aria-label="正在加载">
            <div class="loader-text">Loading...</div>
            <div class="loader-bar"></div>
          </div>
        </div>

        <div v-else-if="errorMessage" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">!</div>
          <h2 class="text-base font-semibold text-slate-900">暂时无法获取工单</h2>
          <p class="mt-2 text-sm text-slate-500">{{ errorMessage }}</p>
          <button
            type="button"
            class="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            @click="fetchWorkOrders"
          >
            重新加载
          </button>
        </div>

        <div v-else-if="tableData.length === 0 && !productFilter" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600">∅</div>
          <h2 class="text-base font-semibold text-slate-900">暂无工单数据</h2>
          <p class="mt-2 text-sm text-slate-500">当前没有可展示的工单记录</p>
        </div>

        <div v-else>
          <div class="overflow-x-auto">
            <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
              <colgroup>
                <col class="w-16" />
                <col class="w-40" />
                <col class="w-36" />
                <col class="w-[180px]" />
                <col class="w-28" />
                <col class="w-36" />
                <col class="w-32" />
                <col class="w-24" />
              </colgroup>
              <thead class="bg-slate-50">
                <tr>
                  <th v-for="column in columns" :key="column.key" scope="col" class="whitespace-nowrap px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <template v-if="column.key === 'materialDesc'">
                      <span class="inline-flex items-center gap-1">
                        <button
                          type="button"
                          class="inline-flex max-w-[110px] items-center gap-1 rounded transition hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                          :class="productFilter ? 'text-sky-600' : ''"
                          :title="productFilter ? `已筛选：${productFilter}` : '点击选择产成品'"
                          @click="openProductDialog"
                        >
                          <span class="truncate">{{ productFilter || column.label }}</span>
                          <svg
                            class="h-3.5 w-3.5 shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                          >
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                          </svg>
                        </button>
                        <button
                          v-if="productFilter"
                          type="button"
                          class="rounded px-1 text-slate-400 transition hover:text-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                          aria-label="清除产成品筛选"
                          @click="clearProductFilter"
                        >
                          ×
                        </button>
                      </span>
                    </template>
                    <template v-else>{{ column.label }}</template>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 bg-white">
                <tr v-if="tableData.length === 0">
                  <td :colspan="columns.length" class="px-6 py-16 text-center text-sm text-slate-400">
                    没有符合筛选条件的工单
                  </td>
                </tr>
                <tr v-for="(order, index) in tableData" :key="`${order.orderNo}-${index}`" class="transition hover:bg-slate-50">
                  <td class="whitespace-nowrap px-6 py-4 text-sm font-semibold text-slate-900">{{ (pageNum - 1) * pageSize + index + 1 }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.orderNo }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.materialCode }}</td>
                  <td class="max-w-[180px] whitespace-normal break-words px-3 py-3 text-sm text-slate-700">
                    {{ order.materialDesc }}
                  </td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.orderQty }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.planStartDate }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.confirmedQty }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">
                    <span
                      v-if="order.imageList?.length"
                      class="relative inline-block cursor-pointer"
                      @click="openImageDialog(order)"
                    >
                      <img
                        :src="order.imageList[0]?.url"
                        alt="入库单据"
                        class="h-12 w-12 rounded-lg object-cover transition hover:opacity-80"
                      />
                      <span
                        v-if="order.imageList.length > 1"
                        class="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold text-white"
                      >
                        {{ order.imageList.length }}
                      </span>
                    </span>
                    <span
                      v-else
                      class="flex h-12 w-12 cursor-pointer items-center justify-center rounded-lg bg-slate-100 text-slate-400 transition hover:bg-slate-200"
                      aria-label="暂无入库单据"
                      @click="openImageDialog(order)"
                    >
                      <svg
                        class="h-6 w-6"
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
                    </span>
                  </td>
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

      <el-dialog
        v-model="imageDialogVisible"
        width="80vw"
        class="image-preview-dialog"
        align-center
      >
        <template #header>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-1 pr-6 text-sm text-slate-700">
            <span>物料描述：{{ currentMaterialDesc }}</span>
            <span>确认的产量：{{ currentConfirmedQty }}</span>
          </div>
        </template>

        <div class="flex min-h-[520px] items-center gap-4 overflow-x-auto rounded-lg bg-slate-50 p-6">
          <div v-if="imageList.length" class="relative flex w-full items-center justify-center">
            <el-button
              v-if="imageList.length > 1"
              circle
              class="absolute left-2 z-10"
              aria-label="上一张"
              @click="showPreviousImage"
            >
              ‹
            </el-button>
            <img
              :src="imageList[currentIndex].url"
              alt="物料原图"
              class="max-h-[70vh] max-w-[85%] rounded-lg object-contain"
            />
            <el-button
              v-if="imageList.length > 1"
              circle
              class="absolute right-2 z-10"
              aria-label="下一张"
              @click="showNextImage"
            >
              ›
            </el-button>
            <el-button
              type="danger"
              size="small"
              class="absolute bottom-2 left-1/2 -translate-x-1/2"
              :loading="imageDeleting"
              @click="deleteImage(imageList[currentIndex])"
            >
              删除当前图片
            </el-button>
          </div>
          <span v-if="!imageList.length" class="w-full text-center text-sm text-slate-400">
            暂无图片
          </span>
        </div>

        <div v-if="imageList.length" class="mt-3 text-center text-sm text-slate-500">
          第 {{ currentIndex + 1 }} 张 / 共 {{ imageList.length }} 张
        </div>

        <template #footer>
          <div class="flex justify-end gap-3">
            <input
              ref="imageFileInput"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="handleImageSelected"
            />
            <el-button :loading="imageUploading" @click="openFilePicker">
              添加图片
            </el-button>
          </div>
        </template>
      </el-dialog>

      <ProductSelectDialog
        v-model="productDialogVisible"
        :options="productOptions"
        :selected="productFilter"
        @select="handleProductSelected"
      />
      </div>

      <div v-show="activeTab === 'import'">
        <WorkOrderImport @cancel="handleImportCancel" @back="handleImportBack" />
      </div>
    </div>
    </main>
  </el-config-provider>
</template>

<style scoped>
.loading-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.72);
}

.loader {
  display: flex;
  width: min(360px, 80%);
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.loader-text {
  align-self: center;
  margin-bottom: 20px;
  color: rgb(0, 0, 0);
  font-size: 24px;
}

.loader-bar {
  width: 30%;
  min-width: 110px;
  height: 10px;
  overflow: hidden;
  border-radius: 5px;
  background-color: rgb(0, 0, 0);
  animation: loader-bar-animation 2s ease-in-out infinite;
}

@keyframes loader-bar-animation {
  0% {
    transform: translateX(-100%);
  }

  50% {
    transform: translateX(100%);
  }

  100% {
    transform: translateX(-100%);
  }
}
</style>
