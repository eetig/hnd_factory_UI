<script setup>
import { computed, ref } from 'vue'
import request from '../api/request'
import {
  ElButton,
  ElMessage,
  ElPagination,
} from 'element-plus'
import 'element-plus/dist/index.css'

const emit = defineEmits(['cancel', 'back'])

const fileInputRef = ref(null)
const dragActive = ref(false)
const uploading = ref(false)
const importing = ref(false)
const imported = ref(false)
const currentFile = ref(null)
const previewList = ref([])
const tableData = ref([])
const pageNum = ref(1)
const pageSize = ref(10)
const total = ref(0)
const workOrderType = ref('')
const taskId = ref('')
const previewError = ref('')
const errorRows = ref([])
const localErrors = ref([])
const importFailRows = ref([])
const importSummary = ref({ addCount: 0, updateCount: 0 })

// 各识别类型对应的表头定义（含列宽与换行样式）
const WORK_ORDER_COLUMNS = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'orderNo', label: '工单号', width: 'w-40' },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'materialDesc', label: '产成品', width: 'w-[180px]', wrap: true },
  { key: 'orderQty', label: '订单数量', width: 'w-28' },
  { key: 'planStartDate', label: '基本开始日期', width: 'w-36' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-32' },
]

const GOODS_MOVE_COLUMNS = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'orderNo', label: '工单号', width: 'w-40' },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'materialDesc', label: '物料描述', width: 'w-[180px]', wrap: true },
  { key: 'storageLocation', label: '存储地点', width: 'w-32' },
  { key: 'moveQty', label: '数量', width: 'w-28' },
  { key: 'moveType', label: '移动类型', width: 'w-28' },
  { key: 'postingDate', label: '过账日期', width: 'w-36' },
]

const INBOUND_COLUMNS = [
  { key: 'materialName', label: '物料名称', width: 'w-[200px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'inboundDate', label: '领料时间', width: 'w-36' },
  { key: 'inboundQty', label: '领料数量', width: 'w-28' },
  { key: 'unit', label: '单位', width: 'w-24' },
]

const PICK_COLUMNS = [
  { key: 'materialName', label: '物料名称', width: 'w-[200px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'pickDate', label: '领料时间', width: 'w-36' },
  { key: 'pickQty', label: '领料数量', width: 'w-28' },
  { key: 'unit', label: '单位', width: 'w-24' },
]

// 货物移动字段别名容错（后端字段名有出入时自动适配）
const GOODS_MOVE_FIELD_MAP = {
  orderNo: ['orderNo', 'workOrderNo', 'orderCode'],
  materialCode: ['materialCode', 'materialNo'],
  materialDesc: ['materialDesc', 'materialName'],
  storageLocation: ['storageLocation', 'storagePlace', 'locationCode'],
  moveQty: ['quantity', 'moveQty', 'moveQuantity', 'qty'],
  moveType: ['movementType', 'moveType', 'moveTypeName', 'type'],
  postingDate: ['postingDate', 'postDate', 'moveDate', 'moveTime'],
}

// 生产入库单字段别名容错
const INBOUND_FIELD_MAP = {
  materialName: ['materialName', 'materialDesc'],
  materialCode: ['materialCode', 'materialNo'],
  inboundDate: ['inboundDate', 'inboundTime'],
  inboundQty: ['inboundQty', 'inboundQuantity', 'quantity'],
  unit: ['unit'],
}

// 领料汇总字段别名容错
const PICK_FIELD_MAP = {
  materialName: ['materialName', 'materialDesc'],
  materialCode: ['materialCode', 'materialNo'],
  pickDate: ['pickDate', 'pickTime'],
  pickQty: ['pickQty', 'pickQuantity', 'quantity'],
  unit: ['unit'],
}

// 识别类型 → 表格配置（未命中的类型回落到工单汇总表头）
const TABLE_CONFIGS = [
  { type: '生产入库单', columns: INBOUND_COLUMNS, fieldMap: INBOUND_FIELD_MAP },
  { type: '领料汇总', columns: PICK_COLUMNS, fieldMap: PICK_FIELD_MAP },
  { type: '货物移动', columns: GOODS_MOVE_COLUMNS, fieldMap: GOODS_MOVE_FIELD_MAP },
]

const activeTableConfig = computed(() => {
  const type = String(workOrderType.value)
  return TABLE_CONFIGS.find((config) => type.includes(config.type)) ?? null
})

const columns = computed(() => activeTableConfig.value?.columns ?? WORK_ORDER_COLUMNS)

function pickField(item, aliases) {
  for (const alias of aliases) {
    const value = item?.[alias]
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return ''
}

// 按当前识别类型的字段映射规整每行数据，保证与表头一一对应
function normalizePreviewRow(item) {
  if (!item) return null

  const fieldMap = activeTableConfig.value?.fieldMap
  if (!fieldMap) return item

  return Object.fromEntries(
    Object.entries(fieldMap).map(([key, aliases]) => [key, pickField(item, aliases)]),
  )
}

const displayTableData = computed(() => tableData.value.map(normalizePreviewRow))

function getCellValue(row, columnKey, index) {
  if (columnKey === 'index') {
    return (pageNum.value - 1) * pageSize.value + index + 1
  }
  return row?.[columnKey]
}

const previewErrors = computed(() => [...errorRows.value, ...localErrors.value])
const hasPreviewErrors = computed(() => previewErrors.value.length > 0)
const canImport = computed(
  () => Boolean(taskId.value) && previewList.value.length > 0 && !hasPreviewErrors.value,
)

function resetState() {
  previewList.value = []
  tableData.value = []
  pageNum.value = 1
  total.value = 0
  workOrderType.value = ''
  taskId.value = ''
  previewError.value = ''
  errorRows.value = []
  localErrors.value = []
  importFailRows.value = []
  importSummary.value = { addCount: 0, updateCount: 0 }
  imported.value = false
}

function getPageData(page = pageNum.value) {
  pageNum.value = page
  const startIndex = (pageNum.value - 1) * pageSize.value
  const endIndex = startIndex + pageSize.value
  tableData.value = previewList.value.slice(startIndex, endIndex)
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function handleDrop(event) {
  dragActive.value = false
  const files = Array.from(event.dataTransfer?.files || [])
  handleFile(files[0])
}

function handleFileInputChange(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  handleFile(files[0])
}

function isExcelFile(file) {
  const name = file?.name || ''
  return /\.(xlsx|xls)$/i.test(name)
}

function getErrorMessage(error, fallback) {
  if (error?.response?.status === 404) {
    return '导入接口不存在，请确认后端服务已实现文件导入接口。'
  }
  return error?.response?.data?.msg || error?.message || fallback
}

function handleFile(file) {
  if (!file) return

  if (!isExcelFile(file)) {
    ElMessage.error('仅支持 .xlsx / .xls 格式的 Excel 文件')
    return
  }

  fetchPreview(file)
}

function collectEmptyOrderNoErrors(list) {
  return list.reduce((errors, item, index) => {
    if (!String(item?.orderNo ?? '').trim()) {
      errors.push({ row: index + 1, msg: '工单号不能为空' })
    }
    return errors
  }, [])
}

// 仅含工单号的类型才校验工单号必填（如工单汇总、货物移动；生产入库单无此字段）
const requiresOrderNo = computed(() => {
  const fieldMap = activeTableConfig.value?.fieldMap
  return fieldMap ? 'orderNo' in fieldMap : true
})

async function fetchPreview(file) {
  resetState()
  currentFile.value = file
  uploading.value = true

  try {
    const formData = new FormData()
    formData.append('file', file)

    const res = await request.post('/api/work-order/import/preview', formData)
    const data = res.data?.data || {}

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '文件解析失败，请检查文件内容后重试。')
    }

    previewList.value = Array.isArray(data.list) ? data.list : []
    total.value = Number(data.total) || previewList.value.length
    workOrderType.value = data.workOrderType || ''
    taskId.value = data.taskId || ''
    errorRows.value = Array.isArray(data.errorRows) ? data.errorRows : []
    localErrors.value = requiresOrderNo.value ? collectEmptyOrderNoErrors(previewList.value) : []
    pageNum.value = 1
    getPageData()

    if (!workOrderType.value) {
      ElMessage.warning('文件解析完成，但未能识别出工单类型。')
    } else {
      ElMessage.success(`文件解析完成，识别为${workOrderType.value}`)
    }
  } catch (error) {
    previewError.value = getErrorMessage(error, '文件解析失败，请稍后重试。')
    ElMessage.error(previewError.value)
  } finally {
    uploading.value = false
  }
}

async function handleImport() {
  if (!canImport.value || importing.value) return

  importing.value = true

  try {
    const res = await request.post('/api/work-order/import/save', {
      taskId: taskId.value,
    })
    const data = res.data?.data || {}

    if (res.data?.success === false) {
      throw new Error(res.data.msg || '导入失败，请稍后重试。')
    }

    importSummary.value = {
      addCount: Number(data.addCount) || 0,
      updateCount: Number(data.updateCount) || 0,
    }
    importFailRows.value = Array.isArray(data.failRows) ? data.failRows : []
    imported.value = true

    if (importFailRows.value.length) {
      ElMessage.warning(
        `导入完成：新增 ${importSummary.value.addCount} 条，更新 ${importSummary.value.updateCount} 条，失败 ${importFailRows.value.length} 条`,
      )
    } else {
      ElMessage.success(
        `导入成功：新增 ${importSummary.value.addCount} 条，更新 ${importSummary.value.updateCount} 条`,
      )
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '导入失败，请稍后重试。'))
  } finally {
    importing.value = false
  }
}

function handleCancel() {
  emit('cancel')
}

function handleBackToList() {
  emit('back')
}
</script>

<template>
  <div>
    <input
      ref="fileInputRef"
      type="file"
      accept=".xlsx,.xls"
      class="hidden"
      @change="handleFileInputChange"
    />

    <section
      class="relative cursor-pointer rounded-xl border-2 border-dashed bg-white p-12 transition"
      :class="dragActive ? 'border-sky-500 bg-sky-50' : 'border-slate-300 hover:border-sky-400'"
      @click="openFilePicker"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="handleDrop"
    >
      <div v-if="uploading" class="flex flex-col items-center gap-4 py-4">
        <div class="loader" role="status" aria-label="正在解析文件">
          <div class="loader-text">解析中...</div>
          <div class="loader-bar"></div>
        </div>
        <p class="text-sm text-slate-500">{{ currentFile?.name }}</p>
      </div>

      <div v-else class="flex flex-col items-center gap-3 py-4">
        <svg
          class="h-12 w-12 text-sky-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M12 16V4m0 0 4 4m-4-4-4 4" />
          <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
        <p class="text-base font-medium text-slate-700">
          将 Excel 文件拖到此处，或 <span class="text-sky-600">点击选择文件</span>
        </p>
        <p class="text-xs text-slate-400">仅支持 .xlsx / .xls 格式</p>
        <p v-if="currentFile" class="mt-1 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600">
          <span class="max-w-60 truncate">{{ currentFile.name }}</span>
          <span class="font-medium text-emerald-600">解析完成</span>
        </p>
      </div>
    </section>

    <div v-if="previewError" class="mt-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
      <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-500">!</div>
      <div>
        <h3 class="text-sm font-semibold text-rose-700">文件解析失败</h3>
        <p class="mt-1 text-sm text-rose-600">{{ previewError }}</p>
      </div>
    </div>

    <section v-if="previewList.length" class="mt-6 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm text-slate-500">文件类型识别结果：</span>
        <span
          v-if="workOrderType"
          class="rounded-full bg-sky-100 px-3 py-1 text-sm font-semibold text-sky-700"
        >
          {{ workOrderType }}
        </span>
        <span v-else class="rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-600">
          识别失败
        </span>
        <span class="text-sm text-slate-500">共 <span class="font-semibold text-slate-900">{{ total }}</span> 条记录</span>
      </div>
    </section>

    <section v-if="hasPreviewErrors" class="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
      <h3 class="text-sm font-semibold text-rose-700">
        文件校验失败行（共 {{ previewErrors.length }} 行），请修正文件后重新上传
      </h3>
      <div class="mt-3 overflow-x-auto rounded-lg bg-white">
        <table class="min-w-full divide-y divide-rose-100 text-left">
          <thead class="bg-rose-50">
            <tr>
              <th scope="col" class="whitespace-nowrap px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-500">行号</th>
              <th scope="col" class="whitespace-nowrap px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-500">错误说明</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-rose-50">
            <tr v-for="(error, index) in previewErrors" :key="`${error.row}-${index}`">
              <td class="whitespace-nowrap px-4 py-2 text-sm font-semibold text-slate-900">第 {{ error.row }} 行</td>
              <td class="px-4 py-2 text-sm text-rose-600">{{ error.msg }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="previewList.length" class="relative mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="overflow-x-auto">
        <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
          <colgroup>
            <col v-for="column in columns" :key="column.key" :class="column.width" />
          </colgroup>
          <thead class="bg-slate-50">
            <tr>
              <th v-for="column in columns" :key="column.key" scope="col" class="whitespace-nowrap px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            <tr v-for="(item, index) in displayTableData" :key="`${item?.orderNo}-${index}`" class="transition hover:bg-slate-50">
              <td
                v-for="column in columns"
                :key="column.key"
                :class="column.wrap
                  ? 'max-w-[180px] whitespace-normal break-words px-3 py-3 text-sm text-slate-700'
                  : `whitespace-nowrap px-6 py-4 text-sm text-slate-600${column.key === 'index' ? ' font-semibold text-slate-900' : ''}`"
              >
                {{ getCellValue(item, column.key, index) }}
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
    </section>

    <section v-if="imported" class="mt-6 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">✓</div>
        <h3 class="text-sm font-semibold text-slate-900">导入完成</h3>
        <span class="text-sm text-slate-500">
          新增 <span class="font-semibold text-emerald-600">{{ importSummary.addCount }}</span> 条，
          更新 <span class="font-semibold text-sky-600">{{ importSummary.updateCount }}</span> 条
        </span>
      </div>

      <div v-if="importFailRows.length" class="mt-3">
        <h4 class="text-sm font-semibold text-rose-700">导入失败行（共 {{ importFailRows.length }} 行）</h4>
        <div class="mt-3 overflow-x-auto rounded-lg border border-rose-100">
          <table class="min-w-full divide-y divide-rose-100 text-left">
            <thead class="bg-rose-50">
              <tr>
                <th scope="col" class="whitespace-nowrap px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-500">行号</th>
                <th scope="col" class="whitespace-nowrap px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-500">错误说明</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-rose-50">
              <tr v-for="(row, index) in importFailRows" :key="`${row.row}-${index}`">
                <td class="whitespace-nowrap px-4 py-2 text-sm font-semibold text-slate-900">第 {{ row.row }} 行</td>
                <td class="px-4 py-2 text-sm text-rose-600">{{ row.msg }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <div class="mt-6 flex justify-end gap-3">
      <el-button v-if="!imported" :disabled="importing" @click="handleCancel">
        取消
      </el-button>
      <el-button
        v-if="!imported"
        type="primary"
        :loading="importing"
        :disabled="!canImport"
        :title="hasPreviewErrors ? '存在校验失败行，请修正文件后重新上传' : ''"
        @click="handleImport"
      >
        确认导入
      </el-button>
      <el-button v-else type="primary" @click="handleBackToList">
        返回工单汇总
      </el-button>
    </div>
  </div>
</template>

<style scoped>
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
