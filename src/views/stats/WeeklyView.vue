<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import request from '../../api/request'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import { formatMonthDay, formatQty, getLastWeekMonday, getLastWeekSunday } from '../../utils/format'
import { ElDatePicker } from 'element-plus'
import { useCountUp } from '../../composables/useCountUp.js'

/*
 * 周统计（原 WorkOrderList.vue 的 `weekly` 页签）。
 *
 * 取数走 `/api/stats/weekly`（决策-004）：它只回汇总数、不回明细，所以这一页
 * **对所有人可见**（那 6 条台账明细接口是 admin 专属的）。
 *
 * ⚠️ 求和口径（闭区间、日期为空的记录照样计入）与改造前**完全一致**，
 * 服务端实现见 WeeklyStatsServiceImpl；这里的 `pickMaterials` 把要汇总的物料编码
 * 传上去，后端不硬编码业务常量（那几个编码本来就定义在这一段）。
 *
 * ## 2026-10-18 视觉重做（变更-123）
 *
 * 使用方说「样式好单调」。原来这一页是一张全边框表格：标题塞在表格第一格、
 * 所有数字同字号、没有量级感。现在改成三层：
 *   ① **KPI 条**：入库 / 领用 / 实际使用 三个大数字，**滚动到达**（useCountUp）
 *   ② **物料卡**：每张内部「领用 → 剩余(可填) → 实际使用(带对比条) → 单耗」
 *   ③ 表格退役 —— 三个物料不需要一张带 20 条边框线的表
 *
 * 动效只有三种，而且都发生在"数据到达"这一刻（不是高频交互）：
 * 数字滚动 700ms、对比条 600ms（按卡片错开 60ms）、卡片入场 240ms。
 * 三者都遵守 prefers-reduced-motion（CSS 关了过渡，JS 直接给终值）。
 */

// 周统计固定展示项定义（materialCode 为隐藏属性，仅用于查询，不展示）
// unitLabel 为单耗单位；unitFactor 为单耗换算系数（氯铂酸按克计，需 ×1000）；qtyFactor 为领用数量换算系数
const WEEKLY_ROW_DEFINITIONS = [
  {
    materialCode: '111001787',
    name: '三氯氢硅（kg）',
    unitLabel: '吨/吨',
    unitFactor: 1,
    qtyFactor: 1,
  },
  {
    materialCode: '111001786',
    name: '电石（kg）',
    unitLabel: '吨/吨',
    unitFactor: 1,
    qtyFactor: 1,
  },
  {
    materialCode: '112004292',
    name: '氯铂酸（g）',
    unitLabel: '克/吨',
    unitFactor: 1000,
    qtyFactor: 20,
  },
]

// 车间剩余：手动填写（按物料编码存放），默认全部为空，不填显示 /
const weeklyRemaining = ref(
  Object.fromEntries(WEEKLY_ROW_DEFINITIONS.map((row) => [row.materialCode, ''])),
)

// 150产品（HND-V150）物料编码
const WEEKLY_INBOUND_MATERIAL_CODE = '114001897'

const WEEKLY_PICK_CODES = WEEKLY_ROW_DEFINITIONS.map((row) => row.materialCode)

// 查询区间：默认「上周一 ~ 上周日」。定义要放在下面那个 watch 之前 ——
// watch 的依赖数组是立刻就求值的，晚于它声明会撞上 TDZ。
const weeklyStartDate = ref(getLastWeekMonday())
const weeklyEndDate = ref(getLastWeekSunday())

const weeklyStats = ref({ pickQty: {}, inboundQty: {} })
const weeklyStatsLoading = ref(false)
const weeklyStatsError = ref('')

async function fetchWeeklyStats() {
  // 日期被清空时不发请求：后端把空值当「不限」，而「没选日期」在这里的预期是什么都不算。
  // 与改造前一致 —— 那时清掉结束日期，整张表也会变成 0。
  if (!weeklyStartDate.value || !weeklyEndDate.value) {
    weeklyStats.value = { pickQty: {}, inboundQty: {} }
    return
  }

  weeklyStatsLoading.value = true
  weeklyStatsError.value = ''

  try {
    const res = await request.get('/api/stats/weekly', {
      params: {
        start: weeklyStartDate.value,
        end: weeklyEndDate.value,
        pickMaterials: WEEKLY_PICK_CODES.join(','),
        inboundMaterials: WEEKLY_INBOUND_MATERIAL_CODE,
      },
    })

    if (res.data?.success === true) {
      weeklyStats.value = {
        pickQty: res.data.data?.pickQty || {},
        inboundQty: res.data.data?.inboundQty || {},
      }
    } else {
      weeklyStats.value = { pickQty: {}, inboundQty: {} }
      weeklyStatsError.value = res.data?.msg || '周统计加载失败，请稍后重试。'
    }
  } catch (error) {
    weeklyStats.value = { pickQty: {}, inboundQty: {} }
    weeklyStatsError.value = error.response?.data?.msg || '周统计加载失败，请稍后重试。'
  } finally {
    weeklyStatsLoading.value = false
  }
}

// 日期范围变了就重新取数（改造前是本地过滤，改一次不用请求）
watch([weeklyStartDate, weeklyEndDate], fetchWeeklyStats)

// 进这一页取一次汇总数（改造前挂在 `watch(activeTab)` 上，路由化之后就是挂载）
onMounted(fetchWeeklyStats)

/** 入库的**原始数值**（`weeklyInboundQty` 是格式化过的字符串，滚动动画要数字） */
const inboundRaw = computed(
  () => Number(weeklyStats.value.inboundQty?.[WEEKLY_INBOUND_MATERIAL_CODE]) || 0,
)

// 原料领用：同上，值由 /api/stats/weekly 备好
function getWeeklyPickQty(materialCode) {
  const code = String(materialCode ?? '').trim()
  if (!code) return 0

  return formatQty(Number(weeklyStats.value.pickQty?.[code]) || 0)
}

const weeklyRows = computed(() => {
  const inboundQty = inboundRaw.value

  return WEEKLY_ROW_DEFINITIONS.map((row) => {
    // 原料领用：领料汇总求和后乘以该物料的换算系数
    const pickQty = formatQty(getWeeklyPickQty(row.materialCode) * (row.qtyFactor ?? 1))
    // 实际使用 = 原料领用 − 车间剩余（车间剩余未填按 0 计）
    const remainingQty = Number(weeklyRemaining.value[row.materialCode]) || 0
    const actualQty = formatQty(pickQty - remainingQty)

    // 单耗 = 实际使用 / 150产品入库数 × 换算系数（固定保留 2 位小数）
    const unitConsumption =
      inboundQty > 0 ? ((actualQty * (row.unitFactor ?? 1)) / inboundQty).toFixed(2) : '0.00'

    return {
      ...row,
      pickQty,
      actualQty,
      unitConsumption,
    }
  })
})

/*
 * ===== KPI 与对比条 =====
 *
 * 对比条宽度 = 实际使用 / 三者最大值。**故意不跨物料比绝对值**（kg 与 g 不同量纲），
 * 只做"这一周哪一项吃得最多"的粗读 —— 所以条旁边永远跟着数字，
 * 不让条形单独承担结论（图表第一条铁律：颜色/长度不能是唯一编码）。
 */
const pickTotal = computed(() => weeklyRows.value.reduce((sum, r) => sum + Number(r.pickQty), 0))
const actualTotal = computed(() =>
  weeklyRows.value.reduce((sum, r) => sum + Number(r.actualQty), 0),
)

const maxActual = computed(() => Math.max(1, ...weeklyRows.value.map((r) => Number(r.actualQty))))

/** 对比条百分比（0–100）。除以 maxActual 而不是 total，否则三个条都很短、看不出差别 */
function barPercent(row) {
  const v = Number(row.actualQty)
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.round((v / maxActual.value) * 100)
}

const { display: inboundDisplay } = useCountUp(inboundRaw)
const { display: pickTotalDisplay } = useCountUp(pickTotal)
const { display: actualTotalDisplay } = useCountUp(actualTotal)

/** 滚动的中间值也要过一遍格式化，否则会出现 "6844.9999" */
const fmt = (v) => formatQty(Math.round(v))

/** 三个区块全空 = 这段时间没数据，给空态而不是一排 0（一排 0 会被误读成"用完了"） */
const isEmpty = computed(() => inboundRaw.value === 0 && pickTotal.value === 0)

// 标题：按所选日期范围生成，如「9月7日-9月13日周统计（截止9月13日晚8点）」
const weeklyTitle = computed(() => {
  const start = formatMonthDay(weeklyStartDate.value)
  const end = formatMonthDay(weeklyEndDate.value)
  return `${start}-${end}周统计（截止${end}晚8点）`
})
</script>

<template>
  <div>
    <section class="rounded-card border border-line bg-raised shadow-card">
      <div class="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <span class="shrink-0 text-xs text-slate-500">起始日期</span>
        <el-date-picker
          v-model="weeklyStartDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          aria-label="起始日期"
          :first-day-of-week="1"
        />
        <span class="shrink-0 text-sm text-slate-500">至</span>
        <span class="shrink-0 text-xs text-slate-500">结束日期</span>
        <el-date-picker
          v-model="weeklyEndDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          aria-label="结束日期"
          :first-day-of-week="1"
        />
      </div>

      <div class="relative p-6">
        <!--
          标题**始终渲染**（2026-10-18）：它描述的是"你选中的是哪个区间"，
          加载中和空态时更需要看得到 —— 塞进 `v-else` 等于"数据到之前不知道自己在看哪一周"。
        -->
        <h2 class="font-serif text-lg font-semibold tracking-tight text-slate-900">
          {{ weeklyTitle }}
        </h2>

        <LoadingMask v-if="weeklyStatsLoading" />

        <PanelState
          v-else-if="weeklyStatsError"
          type="error"
          title="暂时无法获取周统计数据"
          :description="weeklyStatsError"
          action-text="重新加载"
          @action="fetchWeeklyStats"
        />

        <PanelState
          v-else-if="isEmpty"
          type="empty"
          title="这段时间没有领料和入库记录"
          description="换个日期区间试试，或者确认上周的领料单是否已经导入。"
        />

        <template v-else>
          <!-- ① KPI 条：三个大数字，滚动到达 -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="kpi-rise rounded-card border border-line bg-region/50 px-5 py-4">
              <p class="text-xs font-medium tracking-wide text-slate-500">150 产品入库</p>
              <p class="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900" aria-hidden="true">
                {{ fmt(inboundDisplay) }}
                <span class="text-base font-normal text-slate-500">kg</span>
              </p>
              <!-- 读屏拿精确终值：滚动中的数字对它没有意义，重复播报只会打断人 -->
              <span class="sr-only">{{ fmt(inboundRaw) }} kg</span>
            </div>
            <div
              class="kpi-rise rounded-card border border-line bg-region/50 px-5 py-4"
              style="animation-delay: 60ms"
            >
              <p class="text-xs font-medium tracking-wide text-slate-500">原料领用合计</p>
              <p class="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900" aria-hidden="true">
                {{ fmt(pickTotalDisplay) }}
                <span class="text-base font-normal text-slate-500">kg</span>
              </p>
              <span class="sr-only">{{ fmt(pickTotal) }} kg</span>
            </div>
            <div
              class="kpi-rise rounded-card border border-line bg-region/50 px-5 py-4"
              style="animation-delay: 120ms"
            >
              <p class="text-xs font-medium tracking-wide text-slate-500">实际使用合计</p>
              <p class="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-brand-ink" aria-hidden="true">
                {{ fmt(actualTotalDisplay) }}
                <span class="text-base font-normal text-slate-500">kg</span>
              </p>
              <span class="sr-only">{{ fmt(actualTotal) }} kg</span>
            </div>
          </div>

          <!-- ② 物料卡 -->
          <ul class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <li
              v-for="(row, index) in weeklyRows"
              :key="row.name"
              class="card-rise rounded-card border border-line bg-raised p-4"
              :style="{ animationDelay: `${140 + index * 60}ms` }"
            >
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-sm font-medium text-slate-900">{{ row.name }}</span>
                <span class="text-xs text-slate-500">{{ row.unitLabel }}</span>
              </div>

              <dl class="mt-3 space-y-2 text-sm">
                <div class="flex items-center justify-between gap-2">
                  <dt class="text-slate-500">原料领用</dt>
                  <dd class="tabular-nums text-slate-800">{{ row.pickQty }}</dd>
                </div>

                <div class="flex items-center justify-between gap-2">
                  <dt class="text-slate-500">
                    <label :for="`remaining-${row.materialCode}`">车间剩余</label>
                  </dt>
                  <dd class="w-28">
                    <input
                      :id="`remaining-${row.materialCode}`"
                      v-model="weeklyRemaining[row.materialCode]"
                      type="text"
                      inputmode="decimal"
                      placeholder="/"
                      :aria-label="`车间剩余 ${row.name}`"
                      class="w-full rounded-md border border-line bg-transparent px-2 py-1 text-right text-sm tabular-nums text-slate-800 outline-none transition placeholder:text-slate-500 hover:border-slate-400 focus:border-brand focus:ring-2 focus:ring-brand-ink"
                    />
                  </dd>
                </div>

                <!-- 实际使用 + 对比条 -->
                <div>
                  <div class="flex items-center justify-between gap-2">
                    <dt class="text-slate-500">实际使用</dt>
                    <dd class="tabular-nums font-medium text-slate-900">{{ row.actualQty }}</dd>
                  </div>
                  <div
                    class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-region"
                    role="img"
                    :aria-label="`实际使用占本周最大项的 ${barPercent(row)}%`"
                  >
                    <div
                      class="bar-fill h-full rounded-full bg-brand"
                      :style="{ transform: `scaleX(${barPercent(row) / 100})` }"
                    />
                  </div>
                </div>

                <div class="flex items-center justify-between gap-2 border-t border-line pt-2">
                  <dt class="text-slate-500">单耗</dt>
                  <dd class="tabular-nums font-semibold text-brand-ink">
                    {{ row.unitConsumption }}
                    <span class="text-xs font-normal text-slate-500">{{ row.unitLabel }}</span>
                  </dd>
                </div>
              </dl>
            </li>
          </ul>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
/*
 * 三种入场，都只在"数据到达"时发生一次：
 *   卡片上浮 4px + 淡入 240ms；KPI 也用它，靠 animation-delay 错开。
 *
 * ⚠️ 用 `animation` 而不是 `transition`：这里不需要"可中断/可回退"，
 * 数据到达是一次性事件。（可中断的交互态才用 transition —— 见 emil 的判定顺序。）
 */
.kpi-rise,
.card-rise {
  animation: rise 240ms cubic-bezier(0.23, 1, 0.32, 1) both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/*
 * 对比条从左侧长出来：scaleX 而不是 width —— width 会触发布局，
 * 40 个卡片同时长的时候会掉帧（变换只走合成器）。
 */
.bar-fill {
  transform-origin: left center;
  transition: transform 600ms cubic-bezier(0.23, 1, 0.32, 1);
}

/* 首帧就要从 0 开始：否则从浏览器默认值(1)过渡到目标值，会看到"先满后退" */
.bar-fill[style*='scaleX(0)'] {
  transform: scaleX(0);
}

@media (prefers-reduced-motion: reduce) {
  .kpi-rise,
  .card-rise {
    animation: none;
  }
  .bar-fill {
    transition: none;
  }
}
</style>
