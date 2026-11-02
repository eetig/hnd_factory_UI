<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElDatePicker, ElInput } from 'element-plus'
import StatsTable from '../../components/StatsTable.vue'
import WorkOrderDetailDialog from '../../components/WorkOrderDetailDialog.vue'
import { useOrderFilter } from '../../composables/useOrderFilter'
import { useStatsData } from '../../composables/useStatsData'
import { useWorkOrderData } from '../../composables/useWorkOrderData'

/*
 * 工单汇总（2026-11-02 重构，使用方：「把工单汇总改成这个页面」）。
 *
 * ## 从"明细表"改成"聚合表"
 *
 * 原来这一页是**每张工单一行**的明细（日期 / 工单号 / 物料编码 / 已交货 / 图纸…），
 * 手机上看着挤、做报表也用不上。使用方选了核算页那种形态：
 *
 *     序号 · 工单类型 · 产成品 · 订单数量 · 确认的产量
 *
 * 行 = 「工单类型 + 产成品」的聚合（后端 `summary-by-type-material`，与核算页同源，
 * 所以两处的数字天生一致）；**点行下钻**看这一行由哪些工单组成
 * （`WorkOrderDetailDialog`：逐张工单 + 每种物料一列 + 明细展开 + 合计）。
 *
 * ## 筛选（使用方 2026-11-02：日期 + 产成品 + 工单类型）
 *
 * 日期区间走 `useOrderFilter` 的**共享状态**（与核算/领料/入库同一套，默认最近 90 天），
 * 四个页面切来切去区间不会各说各话。
 * 产成品与工单类型是本页的两个文本框：后端聚合结果只有几十行，客户端过滤足够快。
 */
const { startDate, endDate } = useOrderFilter()
const { fetchWorkOrderSummary } = useWorkOrderData()
const { reportRows } = useStatsData()

const productKeyword = ref('')
const typeKeyword = ref('')

/** 统计范围显式写出来（与核算页一致：数字覆盖哪段时间不能靠猜） */
const rangeLabel = computed(() => `${startDate.value || '不限'} ~ ${endDate.value || '不限'}`)

/** 客户端过滤：包含即命中，大小写不敏感；序号按过滤后的顺序重排 */
const rows = computed(() => {
  const product = productKeyword.value.trim().toLowerCase()
  const type = typeKeyword.value.trim().toLowerCase()
  return reportRows.value
    .filter((row) => {
      if (type && !String(row.orderType ?? '').toLowerCase().includes(type)) return false
      if (product && !String(row.materialDesc ?? '').toLowerCase().includes(product)) return false
      return true
    })
    .map((row, index) => ({ ...row, index: index + 1 }))
})

const COLUMNS = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'orderType', label: '工单类型', width: 'w-[140px]' },
  { key: 'materialDesc', label: '产成品', wrap: true },
  { key: 'orderQty', label: '订单数量', width: 'w-32', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-32', align: 'right' },
]

const detailOpen = ref(false)
const detailRow = ref(null)

function openDetail(row) {
  detailRow.value = row
  detailOpen.value = true
}

onMounted(() => {
  fetchWorkOrderSummary()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <section class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
      <!-- 筛选：日期区间（与核算/领料/入库共享） + 产成品 + 工单类型 -->
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <span class="shrink-0 text-xs text-slate-500">起始日期</span>
        <el-date-picker
          v-model="startDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          aria-label="起始日期"
          :first-day-of-week="1"
          @change="fetchWorkOrderSummary"
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
          @change="fetchWorkOrderSummary"
        />

        <span class="ml-2 shrink-0 text-xs text-slate-500">产成品</span>
        <el-input
          v-model="productKeyword"
          placeholder="按名称模糊搜"
          clearable
          class="w-[180px]"
          aria-label="按产成品筛选"
        />
        <span class="shrink-0 text-xs text-slate-500">工单类型</span>
        <el-input
          v-model="typeKeyword"
          placeholder="操作 / 包装 / 转桶"
          clearable
          class="w-[150px]"
          aria-label="按工单类型筛选"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <StatsTable
          :columns="COLUMNS"
          :rows="rows"
          empty-text="这段时间里没有匹配的工单"
          row-clickable
          @row-click="openDetail"
        />
      </div>

      <p class="shrink-0 border-t border-line px-6 py-2.5 text-xs text-slate-500">
        统计范围：{{ rangeLabel }}
        <span class="ml-2">行 = 工单类型 + 产成品的聚合；点任意一行看由哪些工单组成。</span>
      </p>
    </section>

    <WorkOrderDetailDialog
      v-model="detailOpen"
      :type-key="detailRow?.typeKey || ''"
      :type-label="detailRow?.orderType || ''"
      :material-desc="detailRow?.materialDesc || ''"
      :summary-qty="detailRow?.orderQtyRaw ?? null"
    />
  </div>
</template>
