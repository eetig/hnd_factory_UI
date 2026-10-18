<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import request from '../../api/request'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import { formatMonthDay, formatQty, getLastWeekMonday, getLastWeekSunday } from '../../utils/format'
import { ElDatePicker } from 'element-plus'

/*
 * 周统计（原 WorkOrderList.vue 的 `weekly` 页签）。
 *
 * 取数走 `/api/stats/weekly`（决策-004）：它只回汇总数、不回明细，所以这一页
 * **对所有人可见**（那 6 条台账明细接口是 admin 专属的）。
 *
 * ⚠️ 求和口径（闭区间、日期为空的记录照样计入）与改造前**完全一致**，
 * 服务端实现见 WeeklyStatsServiceImpl；这里的 `pickMaterials` 把要汇总的物料编码
 * 传上去，后端不硬编码业务常量（那几个编码本来就定义在这一段）。
 */

// 表头（固定展示项，内容暂为固定值，后续再接入实际数据）
const weeklyColumns = [
  { key: 'name', label: '名称' },
  { key: 'pickQty', label: '原料领用', align: 'right' },
  { key: 'remainingQty', label: '车间剩余', align: 'right' },
  { key: 'actualQty', label: '实际使用', align: 'right' },
  { key: 'unitConsumption', label: '单耗' },
]

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

// 150产品入库数：接口已按区间汇总好，这里只取值
const weeklyInboundQty = computed(() =>
  formatQty(Number(weeklyStats.value.inboundQty?.[WEEKLY_INBOUND_MATERIAL_CODE]) || 0),
)

const weeklyInboundRow = computed(() => ({
  materialCode: WEEKLY_INBOUND_MATERIAL_CODE,
  name: '150产品入库数（kg）',
  value: weeklyInboundQty.value,
}))

// 原料领用：同上，值由 /api/stats/weekly 备好
function getWeeklyPickQty(materialCode) {
  const code = String(materialCode ?? '').trim()
  if (!code) return 0

  return formatQty(Number(weeklyStats.value.pickQty?.[code]) || 0)
}

const weeklyRows = computed(() => {
  const inboundQty = weeklyInboundQty.value

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
      <div class="flex items-center gap-3 border-b border-line px-6 py-3">
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

      <div class="p-6">
        <div class="relative">
          <LoadingMask v-if="weeklyStatsLoading" />

          <PanelState
            v-else-if="weeklyStatsError"
            type="error"
            title="暂时无法获取周统计数据"
            :description="weeklyStatsError"
            action-text="重新加载"
            @action="fetchWeeklyStats"
          />

          <div v-else class="overflow-x-auto">
            <table class="w-full table-fixed border-collapse text-center">
              <colgroup>
                <col class="w-[220px]" />
                <col class="w-32" />
                <col class="w-32" />
                <col class="w-32" />
                <col class="w-32" />
              </colgroup>
              <thead>
                <tr>
                  <th
                    colspan="5"
                    class="border border-line px-3 py-2.5 text-base font-bold tracking-wide text-slate-800"
                  >
                    {{ weeklyTitle }}
                  </th>
                </tr>
                <tr>
                  <th
                    v-for="column in weeklyColumns"
                    :key="column.key"
                    scope="col"
                    class="border border-line bg-region py-3 text-sm font-semibold text-slate-600"
                    :class="column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'"
                  >
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in weeklyRows" :key="row.name">
                  <td class="border border-line px-3 py-2.5 text-sm text-slate-700">
                    {{ row.name }}
                  </td>
                  <td class="border border-line py-2.5 pl-3 pr-5 text-right text-sm text-slate-700">
                    {{ row.pickQty }}
                  </td>
                  <td class="border border-line p-0">
                    <input
                      v-model="weeklyRemaining[row.materialCode]"
                      type="text"
                      placeholder="/"
                      :aria-label="`车间剩余 ${row.name}`"
                      class="w-full bg-transparent py-2.5 pl-3 pr-5 text-right text-sm text-slate-700 outline-none transition placeholder:text-slate-500 hover:bg-region focus:bg-raised focus:ring-2 focus:ring-inset focus:ring-brand"
                    />
                  </td>
                  <td class="border border-line py-2.5 pl-3 pr-5 text-right text-sm text-slate-700">
                    {{ row.actualQty }}
                  </td>
                  <td class="border border-line px-3 py-2.5 text-sm text-slate-700">
                    {{ row.unitConsumption }} {{ row.unitLabel }}
                  </td>
                </tr>
                <tr>
                  <td class="border border-line px-3 py-2.5 text-sm text-slate-700">
                    {{ weeklyInboundRow.name }}
                  </td>
                  <td
                    colspan="4"
                    class="border border-line px-3 py-2.5 text-sm font-semibold text-slate-800"
                  >
                    {{ weeklyInboundRow.value }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
