<script setup>
import { onMounted } from 'vue'
import { useWorkOrderData } from '../../composables/useWorkOrderData'
import ProductSelectDialog from '../../components/ProductSelectDialog.vue'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import FilterHeaderCell from '../../components/FilterHeaderCell.vue'
import { getReportOrderType } from '../../constants/orderTypes'
import { ElDatePicker, ElPagination } from 'element-plus'

/*
 * 工单汇总（原 WorkOrderList.vue 的 `workOrder` 页签）。
 *
 * 模板与逻辑都是**逐字搬迁**：数据、筛选、分页全部走 `useWorkOrderData`
 * （模块级单例，筛选条件与日期区间因此跨页保留），这里只剩列配置与取数时机。
 *
 * 取数时机从「整页挂载时四连发」改成「进这一页取自己那份」—— 路由化之后
 * 每一页都是独立挂载的，进页即取数是同一件事的另一种写法；顺带，
 * 从导入 / 图片解析回来后数据自动是新的（那两页写完会路由跳走，
 * 再进来就重新取，改造前靠 importDirty 标记做的事现在由路由天然完成）。
 */
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
  loadWorkOrderPage,
  reloadWorkOrders,
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


/*
 * 列宽（变更-124 重算）：1280 视口下主区可用宽约 926px。
 *
 * 原来这 8 列固定宽合计 **1008px** —— 已经比可用宽多 82px，也就是说
 * 工单汇总在 1280 屏上**一直**有一条横向滚动条（之前的限宽只治了"摊宽"，
 * 没治"总宽超了"）。这里按内容实测收敛：日期 10 字符、单号 10 位数字、
 * 类型 4 个汉字、编码 9 位，各自留够即可，剩下的全给「产成品」去换行。
 *
 *   新合计 776px + 产成品自适应 ≈ 150px = 926px，正好铺满不留横滚。
 */
const columns = [
  { key: 'index', label: '序号', width: 'w-14' },
  { key: 'planStartDate', label: '基本开始日期', width: 'w-28' },
  { key: 'orderNo', label: '工单号', width: 'w-[120px]' },
  { key: 'orderType', label: '工单类型', width: 'w-[88px]' },
  { key: 'materialCode', label: '物料编码', width: 'w-28' },
  /*
   * 产成品**故意不给宽度**（2026-10-18，使用方：「表格上总是有大段大段的空白」）。
   *
   * 原因：`table-fixed` + 每列都写死宽度时，表格被 `min-w-full` 撑到卡片宽度，
   * 浏览器会把**多出来的宽按比例分给所有列** —— 于是每个数字列都被撑宽，
   * 数字右对齐、左边留一大片白。看着就像一排排空洞。
   *
   * 解法：只留这一列不自定宽。`table-fixed` 会把剩余宽度**全部**给它，
   * 其余列的宽度就严格按声明值走、不再被摊薄。产成品本来就是最长的文本，
   * 宽一点正合适（单元格里有 max-width + 截断，不会把行撑爆）。
   */
  { key: 'materialDesc', label: '产成品' },
  { key: 'orderQty', label: '订单数量', width: 'w-24', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-24', align: 'right' },
  { key: 'deliveredQty', label: '已交货数量', width: 'w-24', align: 'right' },
]



onMounted(() => {
  fetchWorkOrders()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!--
    变更-038：四个汇总页的卡片**撑满主区栏、自己管滚动**（使用方
    2026-10-11：「翻页功能每页都不在一个位置，体验很差」）。

    钉住分页行的道理：分页行是卡片的最后一个子元素，卡片多高它就多低。
    而「产成品 / 物料名称」那几列是 `whitespace-normal break-words` 的，
    每页折行的条数不一样 —— 卡片跟着内容一高一矮，分页行就一上一下。

    链条：上一级（主区栏的 `flex-1` 定高）→ `h-full` 把定高传下来
    → 卡片 `flex-1 min-h-0` 正好吃满 → 表格区 `flex-1 min-h-0
    overflow-y-auto` 是**唯一的纵向滚动容器** → 分页行 `shrink-0` 钉在卡底。
    翻页时折行条数变了，动的也只是表格区内部，分页行一动不动。

    ⚠️ 两处 `min-h-0` 都不能省 —— flex item 默认 `min-height:auto`，不写就不肯
    缩到内容以下，内容长的页会把卡片（连带分页行）重新顶高。
    ⚠️ 表格区的纵向滚动是「白捡 + 显式」两笔：`overflow-x:auto` 本来就会把
    `overflow-y` 的 `visible` 计算成 `auto`，显式写上 `overflow-y-auto` 是给下一个人看的。
    -->

    <section
      class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card"
    >
      <div class="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
        <span class="shrink-0 text-xs text-slate-500">起始日期</span>
        <el-date-picker
          v-model="startDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          aria-label="起始日期"
          :first-day-of-week="1"
          @change="reloadWorkOrders"
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
          @change="reloadWorkOrders"
        />
      </div>

      <div class="relative flex min-h-0 flex-1 flex-col">
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

        <div v-else class="flex min-h-0 flex-1 flex-col">
          <div class="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
            <table class="ledger-table w-full max-w-[1280px] table-fixed text-left">
              <colgroup>
                <col v-for="column in columns" :key="column.key" :class="column.width" />
              </colgroup>
              <thead class="bg-region">
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
              <tbody>
                <tr v-if="tableData.length === 0">
                  <td :colspan="columns.length" class="px-3 py-16 text-center text-sm text-slate-500">
                    没有符合筛选条件的工单
                  </td>
                </tr>
                <!--
                  2026-10-21 使用方：工单汇总**不要再点一行就弹图片预览**。
                  原来整行是 role=button + cursor-pointer，一点就开图 —— 而这一页根本没有
                  图据列，"行可点"是个看不见的入口，误触率很高。
                  现在行是**纯展示**：不响应点击、不进 Tab 序列、鼠标也不变手型。
                  （工单图据的弹窗组件 OrderImageDialog 仍在仓里，将来若要在别的入口看图
                   直接挂 <OrderImageDialog /> 即可，见该组件头部注释。）
                -->
                <tr
                  v-for="(order, index) in tableData"
                  :key="`${order.orderNo}-${index}`"
                  class="transition hover:bg-region"
                >
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">
                    {{ (pageNum - 1) * pageSize + index + 1 }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ order.planStartDate }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ order.orderNo }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ getReportOrderType(order.orderNo) }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-600">
                    {{ order.materialCode }}
                  </td>
                  <td class="whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700">
                    {{ order.materialDesc }}
                  </td>
                  <td class="num whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">
                    {{ order.orderQty }}
                  </td>
                  <td class="num whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">
                    {{ order.confirmedQty }}
                  </td>
                  <td class="num whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm text-slate-600">
                    {{ order.deliveredQty }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex shrink-0 justify-end border-t border-line px-6 py-3">
            <el-pagination
              v-model:current-page="pageNum"
              :page-size="pageSize"
              :total="total"
              layout="total, prev, pager, next"
              background
              @current-change="loadWorkOrderPage"
            />
          </div>
        </div>
      </div>
    </section>

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
</template>
