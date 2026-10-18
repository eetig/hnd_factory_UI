<script setup>
import { computed, onMounted, ref } from 'vue'
import StatsTable from '../../components/StatsTable.vue'
import { useStatsData } from '../../composables/useStatsData'
import { useWorkOrderData } from '../../composables/useWorkOrderData'
import { useInboundData } from '../../composables/useInboundData'
import { usePickData } from '../../composables/usePickData'
import { useGoodsMoveData } from '../../composables/useGoodsMoveData'

/*
 * 核算（原 WorkOrderList.vue 的 `report` / `costing` / `materialCosting` 三个页签 **三合一**）。
 *
 * 为什么合成一页：它们是同一件事的三面 ——
 *   · 工单报工：按「工单类型 + 产成品」汇总订单量与确认产量；
 *   · 工单核算：以入库产成品为行，入库数 − 已报工数 = 未报工数；
 *   · 原辅料核算：以领料物料为行，领料数 − 已报工数 = 未报工数。
 * 三张表都是**只读**的派生结果、共用同一个日期区间，原先分在三个页签里，
 * 对照要看一次就切一次。现在一页三个视图，页内切换即可。
 *
 * ⚠️ 三张表仍**全部挂载**（用 v-show 而不是 v-if）：它们只是只读表格，
 * 挂载成本可以忽略，而切换时保留滚动位置与已渲染的行更顺手。
 * 「非当前视图必须藏起来」这条没变 —— 三个块都带 v-show，不会叠在一起。
 */
const { reportRows, costingRows, materialCostingRows } = useStatsData()
const { fetchWorkOrderSummary } = useWorkOrderData()
const { fetchInboundSummary } = useInboundData()
const { fetchPickSummary } = usePickData()
// 货物移动数据（原辅料核算的「已报工数」来源；数据本身由 useStatsData 读取）
// 加载失败必须在界面上呈现（变更-033）：失败时 goodsMoveQtyMap 是空的，
// 核算表的「已报工数」会被算成 0、「未报工数」= 全部领料量 —— 那不是缺数据，
// 是一个看起来合理的错误答案。现在失败走横幅 + 两列显示「—」。
const { goodsMoveError, fetchGoodsMoveSummary } = useGoodsMoveData()

/**
 * 原辅料核算的展示行：货物移动不可用时，把它派生的两列换成「—」。
 *
 * 0 与「—」的区别是这件事的全部：显示 0 等于替使用方断言「这个月没有人报工」，
 * 真实情况却是「这个数没拿到」。领料数不依赖货物移动，照常显示。
 */
const materialCostingDisplayRows = computed(() =>
  goodsMoveError.value
    ? materialCostingRows.value.map((row) => ({ ...row, reportedQty: '—', unreportedQty: '—' }))
    : materialCostingRows.value,
)

// 汇总表行 key：同名物料可能出现多行，用「分组键 + 序号」保证唯一
const statsRowKey = (item, index) => `${item.orderType ?? item.materialName}-${index}`

// 工单报工表格列
const reportColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'orderType', label: '工单类型', width: 'w-40' },
  { key: 'materialDesc', label: '产成品', width: 'w-[200px]', wrap: true },
  { key: 'orderQty', label: '订单数量', width: 'w-28', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-32', align: 'right' },
]

// ===== 工单核算 =====
const costingColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialName', label: '已入库产成品', width: 'w-[240px]', wrap: true },
  { key: 'materialCode', label: '产成品编码', width: 'w-36' },
  { key: 'inboundQty', label: '入库数', width: 'w-32', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-32', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-32', align: 'right', emphasis: true },
]

// ===== 原辅料核算 =====
// 暂照搬工单核算的列与计算逻辑，后续按原辅料规则单独调整（不影响工单核算）
const materialCostingColumns = [
  { key: 'index', label: '序号', width: 'w-16' },
  { key: 'materialName', label: '已领物料名称', width: 'w-[240px]', wrap: true },
  { key: 'materialCode', label: '物料编码', width: 'w-36' },
  { key: 'pickQty', label: '领料数', width: 'w-32', align: 'right' },
  { key: 'reportedQty', label: '已报工数', width: 'w-32', align: 'right' },
  { key: 'unreportedQty', label: '未报工数', width: 'w-32', align: 'right', emphasis: true },
]

/**
 * 页内三个视图。标签沿用原来的页签名 —— 使用方与文档里都是这么叫的，
 * 换成「核算 1/2/3」反而要重新学一遍。
 */
const VIEWS = [
  { key: 'report', label: '工单报工' },
  { key: 'costing', label: '工单核算' },
  { key: 'materialCosting', label: '原辅料核算' },
]
const activeView = ref('report')

/*
 * 进这一页就把三张表的源数据各取一次。
 *
 * 三张表喂的都是各来源页「当前筛选后」的服务端汇总结果（口径见 useStatsData），
 * 而那几份明细随时可能被另一端（手机端、图片解析）改动 —— 进页面就实查一次，
 * 省得又出现「数据明明有、这一页看不到」。改造前这件事挂在 `watch(activeTab)` 上，
 * 按页签分别取；现在三个视图同页，进页取三份，语义一致。
 */
onMounted(() => {
  fetchWorkOrderSummary()
  fetchInboundSummary()
  fetchPickSummary()
  fetchGoodsMoveSummary()
})
</script>

<template>
  <div>
    <!-- 页内视图切换。与顶栏那排组内页签同一套形态（选中 = 墨色实底 + 白字），
         只是作用域是本页的三个只读视图，所以不进 `aria-label="页面切换"` 那一组。 -->
    <div class="mb-4 flex gap-2" role="tablist" aria-label="核算视图">
      <button
        v-for="view in VIEWS"
        :key="view.key"
        type="button"
        role="tab"
        :aria-selected="activeView === view.key ? 'true' : 'false'"
        :aria-current="activeView === view.key ? 'page' : undefined"
        class="shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
        :class="
          activeView === view.key
            ? 'border-brand bg-brand font-medium text-on-brand'
            : 'border-line text-slate-600 hover:border-slate-300 hover:text-slate-800'
        "
        @click="activeView = view.key"
      >
        {{ view.label }}
      </button>
    </div>

    <div v-show="activeView === 'report'">
      <StatsTable
        :columns="reportColumns"
        :rows="reportRows"
        empty-text="暂无报工数据"
        show-footer
        :row-key="statsRowKey"
      />
    </div>

    <div v-show="activeView === 'costing'">
      <StatsTable
        :columns="costingColumns"
        :rows="costingRows"
        empty-text="暂无核算数据"
        show-footer
        :row-key="statsRowKey"
      />
    </div>

    <div v-show="activeView === 'materialCosting'">
      <!-- 货物移动取数失败（变更-033）：核算表那两个派生列就没有正确答案，
           说出来 + 给一次重试，好过让 0 冒充「没有人报工」 -->
      <div
        v-if="goodsMoveError"
        role="alert"
        class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-rose-200 bg-rose-50 px-5 py-4"
      >
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-rose-700">货物移动数据加载失败</h3>
          <p class="mt-1 text-sm text-rose-700">
            「已报工数 / 未报工数」暂无法计算，两列以「—」显示。{{ goodsMoveError }}
          </p>
        </div>
        <button
          type="button"
          class="ml-auto shrink-0 rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2"
          @click="fetchGoodsMoveSummary"
        >
          重新加载
        </button>
      </div>

      <!--
        ⚠️ 这张表**不开合计行**（变更-124）。
        理由：原辅料的数量是换算后的口径（×3.2 / ×20 / ×1000），
        行与行之间单位并不统一（kg / g / 吨混排），而且派生行与源行同时存在 ——
        求出来的「合计」既跨量纲、又重复计入，是个看起来像合计的错数字。
        其余两张（工单报工 / 工单核算）同列单位一致，才开 tfoot。
      -->
      <StatsTable
        :columns="materialCostingColumns"
        :rows="materialCostingDisplayRows"
        empty-text="暂无核算数据"
        :row-key="statsRowKey"
      />
    </div>
  </div>
</template>
