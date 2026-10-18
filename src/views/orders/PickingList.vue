<script setup>
import { onMounted, ref } from 'vue'
import { usePickData } from '../../composables/usePickData'
import ProductSelectDialog from '../../components/ProductSelectDialog.vue'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import FilterHeaderCell from '../../components/FilterHeaderCell.vue'
import { canOpenImage, handleImgError } from '../../utils/image'
import { ElDatePicker, ElDialog, ElPagination } from 'element-plus'

/*
 * 领料汇总（原 WorkOrderList.vue 的 `material` 页签）。
 *
 * 模板与逻辑逐字搬迁；数据、筛选、分页都在 `usePickData`（模块级单例）里，
 * 只有「图据大图弹窗」那两个 ref 是这一页自己的 —— 它们纯属展示态，
 * 切页时跟着关闭反而是对的。
 */
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
  openPickMaterialDialog,
  handlePickMaterialSelected,
  clearPickMaterialFilter,
} = usePickData()

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

onMounted(fetchPickRecords)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 变更-038：与工单汇总同一张方子（定高链 + 表格区自己滚 + 分页行钉底），
         完整理由见 views/orders/WorkOrderList.vue 的模板注释 -->
    <section
      class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card"
    >
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
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
            pickMaterialFilter ? `当前筛选：${pickMaterialFilter}` : '当前没有可展示的领料记录'
          "
        />

        <div v-else class="flex min-h-0 flex-1 flex-col">
          <div class="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
            <table class="min-w-full table-fixed divide-y divide-line text-left">
              <colgroup>
                <col v-for="column in pickColumns" :key="column.key" :class="column.width" />
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
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">
                    {{ (pickPageNum - 1) * pickPageSize + index + 1 }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ record.pickDate }}
                  </td>
                  <td class="max-w-[200px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700">
                    {{ record.materialName }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ record.materialCode }}
                  </td>
                  <td class="whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">
                    {{ record.pickQty }}
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
                        record.imageUrl || record.thumbnailUrl ? '查看领料单据' : '暂无图片'
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
      <div class="flex min-h-[400px] items-center justify-center rounded-card bg-region p-6">
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
</template>
