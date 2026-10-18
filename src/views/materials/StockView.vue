<script setup>
import { computed, onMounted } from 'vue'
import { useMaterialStockData } from '../../composables/useMaterialStockData'
import { useLiveQuery } from '../../composables/useLiveQuery'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import { ElCheckbox, ElInput, ElPagination } from 'element-plus'

/*
 * 物料查询（原 WorkOrderList.vue 的 `stock` 页签）。
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

// 物料库存列（页面按 物料编码 / 物料名称 / 规格 查物料信息；
// 名称与规格是后端联查 material_master 的结果，主数据没有则回退库存表那份）
// 工厂（列里恒为 1503）按使用方要求不展示
const stockColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialCode', label: '物料编码', width: 'w-32' },
  { key: 'materialName', label: '物料名称', width: 'w-[220px]', wrap: true },
  { key: 'spec', label: '规格', wrap: true }, /* 不自定宽：吸收剩余宽度（同上） */
  { key: 'storageLocation', label: '存储地点', width: 'w-24' },
  { key: 'unit', label: '基本计量单位', width: 'w-32' },
  { key: 'stockQty', label: '非限制使用的库存', width: 'w-40', align: 'right' },
  { key: 'storageDesc', label: '存储地点描述', width: 'w-[180px]', wrap: true },
]

onMounted(fetchStockRecords)
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 变更-038：与工单汇总同一张方子（定高链 + 表格区自己滚 + 分页行钉底），
         完整理由见 views/orders/WorkOrderList.vue 的模板注释 -->
    <section
      class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card"
    >
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
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
          :title="stockKeyword || stockOnlyInStock ? '没有符合筛选条件的记录' : '暂无库存数据'"
          :description="
            stockKeyword || stockOnlyInStock
              ? '换个关键词，或取消勾选「只看有库存」看看'
              : '还没有导入过库存汇总，可在「文件导入」里上传库存表'
          "
        />

        <div v-else class="flex min-h-0 flex-1 flex-col">
          <!-- 9 列在窄窗口下会溢出：外层 overflow-x-auto + colgroup 定宽，
           与领料 / 入库汇总那两张表同一套写法 -->
          <div class="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
            <table class="min-w-full table-fixed divide-y divide-line text-left">
              <colgroup>
                <col v-for="column in stockColumns" :key="column.key" :class="column.width" />
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
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">
                    {{ (stockPageNum - 1) * stockPageSize + index + 1 }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ displayText(record.materialCode) }}
                  </td>
                  <td class="max-w-[220px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700">
                    {{ displayText(record.materialName) }}
                  </td>
                  <td class="max-w-[160px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-600">
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
                    :class="Number(record.stockQty) > 0 ? 'text-slate-900' : 'text-slate-500'"
                  >
                    {{ displayText(formatStockQty(record.stockQty)) }}
                  </td>
                  <td class="max-w-[180px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-600">
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
</template>
