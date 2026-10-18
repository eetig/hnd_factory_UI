<script setup>
import { computed, onMounted, ref } from 'vue'
import { useInboundData } from '../../composables/useInboundData'
import ProductSelectDialog from '../../components/ProductSelectDialog.vue'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import FilterHeaderCell from '../../components/FilterHeaderCell.vue'
import { canOpenImage, handleImgError } from '../../utils/image'
import { ElDatePicker, ElDialog, ElPagination } from 'element-plus'
import KpiCard from '../../components/KpiCard.vue'

/*
 * 入库汇总（原 WorkOrderList.vue 的 `inbound` 页签）。
 *
 * 与领料汇总同构：模板与逻辑逐字搬迁，数据/筛选/分页在 `useInboundData`
 * （模块级单例）里，只有图据大图弹窗的展示态是这一页自己的。
 */
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
  openInboundMaterialDialog,
  handleInboundMaterialSelected,
  clearInboundMaterialFilter,
  inboundSummaryRows,
  fetchInboundSummary,
} = useInboundData()


/*
 * ===== KPI（变更-124）=====
 *
 * ⚠️ **不做「数量合计」**：summary-by-material 的 VO 不带 unit，
 * 把 kg + 个 + 桶 + 米 加起来会得到一个"看起来像合计"的错误数字。
 * 宁可卡片朴素，也不摆假数 —— 所以只放两个**不跨量纲**的指标。
 *
 * ⚠️ **也不做「条数」卡**：页头与分页器已经各显示一次（共 N 条）。
 */
const inboundKindCount = computed(() => inboundSummaryRows.value.length)
const topInboundQty = computed(() =>
  inboundSummaryRows.value.reduce((max, row) => Math.max(max, Number(row.inboundQty) || 0), 0),
)
const topInboundName = computed(() => {
  const top = inboundSummaryRows.value.find((row) => (Number(row.inboundQty) || 0) === topInboundQty.value)
  return top ? top.materialName : ''
})

const inboundColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'inboundDate', label: '入库时间', width: 'w-36' },
  { key: 'materialName', label: '物料名称', wrap: true }, /* 不自定宽：table-fixed 会把剩余宽度全给它，其余列就不再被摊薄（2026-10-18 修「大段空白」） */
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

onMounted(() => {
  fetchInboundRecords()
  // 变更-124：KPI 要全区间聚合，进页面取一次（改筛选时 reload 会再取，共用同一个 ref）
  if (!inboundSummaryRows.value.length) fetchInboundSummary()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 变更-038：与工单汇总同一张方子（定高链 + 表格区自己滚 + 分页行钉底），
         完整理由见 views/orders/WorkOrderList.vue 的模板注释 -->
    <!-- KPI（变更-124）：两个不跨量纲的指标 -->
    <div v-if="inboundSummaryRows.length" class="mb-3 grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <KpiCard label="物料种类" :value="inboundKindCount" unit="种" hint="本区间有入库记录的物料数" />
      <KpiCard
        label="入库最多的物料"
        :value="topInboundQty"
        accent
        :hint="topInboundName + '（单位见下方明细）'"
      />
    </div>

    <section
      class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card"
    >
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
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
          <div class="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
            <table class="ledger-table w-full max-w-[1280px] table-fixed text-left">
              <colgroup>
                <col v-for="column in inboundColumns" :key="column.key" :class="column.width" />
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
              <tbody>
                <tr
                  v-for="(record, index) in inboundTableData"
                  :key="`${record.materialCode}-${record.inboundDate}-${index}`"
                  class="transition hover:bg-region"
                >
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">
                    {{ (inboundPageNum - 1) * inboundPageSize + index + 1 }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ record.inboundDate }}
                  </td>
                  <td class="max-w-[200px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700">
                    {{ record.materialName }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ record.materialCode }}
                  </td>
                  <td class="num whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">
                    {{ record.inboundQty }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ record.unit }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    <span
                      class="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-md bg-region text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                      :role="canOpenImage(record) ? 'button' : undefined"
                      :tabindex="canOpenImage(record) ? 0 : -1"
                      :aria-label="
                        record.imageUrl || record.thumbnailUrl ? '查看入库单据' : '暂无图片'
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
      <div class="flex min-h-[400px] items-center justify-center rounded-card bg-region p-6">
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
</template>
