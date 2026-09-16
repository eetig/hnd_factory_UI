<script setup>
import { onMounted, ref } from 'vue'
import axios from 'axios'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import updateLocale from 'dayjs/plugin/updateLocale'
import { ElConfigProvider, ElDatePicker, ElPagination } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'

dayjs.extend(updateLocale)
dayjs.updateLocale('zh-cn', { weekStart: 1 })
dayjs.locale('zh-cn')

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

const columns = [
  { key: 'index', label: '序号' },
  { key: 'orderNo', label: '订单号' },
  { key: 'materialCode', label: '物料编码' },
  { key: 'materialDesc', label: '物料描述' },
  { key: 'orderQty', label: '订单数量' },
  { key: 'planStartDate', label: '基本开始日期' },
  { key: 'confirmedQty', label: '确认的产量' },
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

function getPageData(page = pageNum.value) {
  pageNum.value = page
  const startIndex = (pageNum.value - 1) * pageSize.value
  const endIndex = startIndex + pageSize.value
  tableData.value = tableDataAll.value.slice(startIndex, endIndex)
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

function filterWorkOrders() {
  tableDataAll.value = allWorkOrders.value.filter((order) => {
    const planStartDate = String(order.planStartDate || '').slice(0, 10)
    return planStartDate >= startDate.value && planStartDate <= endDate.value
  })

  total.value = tableDataAll.value.length
  pageNum.value = 1
  getPageData()
}

async function fetchWorkOrders() {
  loading.value = true
  errorMessage.value = ''

  try {
    const res = await axios.get('/api/work-order/list')
    if (res.data.success === true) {
      const dataList = Array.isArray(res.data.dataList) ? res.data.dataList : []
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
      <header class="mb-8 flex flex-col gap-3 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">Factory Operations</p>
          <h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">工单汇总</h1>
          <p class="mt-2 text-sm text-slate-500">查看当前所有生产工单及处理状态</p>
        </div>
        <div class="text-sm text-slate-500">
          共 <span class="font-semibold text-slate-900">{{ tableData.length }}</span> 条工单
        </div>
      </header>

      <div class="mb-6 flex items-center gap-3">
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

      <section class="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div v-if="loading" class="loading-mask" aria-label="正在加载工单">
          <div class="loader" role="status" aria-label="正在加载">
            <div class="loader-text">Loading...</div>
            <div class="loader-bar"></div>
          </div>
        </div>

        <div v-if="errorMessage" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
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

        <div v-else-if="tableData.length === 0" class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600">∅</div>
          <h2 class="text-base font-semibold text-slate-900">暂无工单数据</h2>
          <p class="mt-2 text-sm text-slate-500">当前没有可展示的工单记录</p>
        </div>

        <div v-else>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-200 text-left">
              <thead class="bg-slate-50">
                <tr>
                  <th v-for="column in columns" :key="column.key" scope="col" class="whitespace-nowrap px-6 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 bg-white">
                <tr v-for="(order, index) in tableData" :key="`${order.orderNo}-${index}`" class="transition hover:bg-slate-50">
                  <td class="whitespace-nowrap px-6 py-4 text-sm font-semibold text-slate-900">{{ (pageNum - 1) * pageSize + index + 1 }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.orderNo }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.materialCode }}</td>
                  <td class="min-w-64 px-6 py-4 text-sm text-slate-700">{{ order.materialDesc }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.orderQty }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.planStartDate }}</td>
                  <td class="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{{ order.confirmedQty }}</td>
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
      </section>
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
