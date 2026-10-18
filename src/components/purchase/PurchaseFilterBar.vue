<script setup>
import { computed } from 'vue'
import { ElDatePicker, ElInput, ElOption, ElSelect } from 'element-plus'
import { useLiveQuery } from '../../composables/useLiveQuery'
import { usePurchaseTracking } from '../../composables/usePurchaseTracking'
import { CATEGORY_OPTIONS } from './fields.js'

/**
 * 采购需求的筛选条（2026-10-18，变更-117）。
 *
 * 状态直接从 `usePurchaseTracking()` 取（模块作用域），不通过 props 往下传 ——
 * 这份状态本来就只有一个真值，传一层反而多一条可能不同步的路径。
 *
 * ## 「一行不换行」怎么做到
 *
 * 全部 `flex-nowrap`。宽度不够时**只有 chips 那一段**可以横滚（`overflow-x-auto`
 * + 隐藏滚动条视觉），日期 / 类别 / 关键字永远在原位 —— 让主要输入框被挤走
 * 比让筛选胶囊滚一下糟得多。
 *
 * ## chips 为什么没把数字写在脸上（与上一版不同）
 *
 * 上一版 chips 是「超期 3」两段式，7 个加起来 400+px，和日期/类别/关键字
 * 挤不进一行。数字改成 `title` 提示：筛的时候不需要看数量，看数量的时候
 * 悬停一下就有。**这是为"一行"付的代价**，如果不接受，把 chips 拆回独立一行即可。
 */
const {
  keyword,
  rangeStart,
  rangeEnd,
  statusFilter,
  categoryFilter,
  summary,
  applyPurchaseFilters,
} = usePurchaseTracking()

// 关键字边打边查：防抖 300ms（与其余查询框同一套接线，见 useLiveQuery）。
const { flush: flushKeyword } = useLiveQuery(keyword, applyPurchaseFilters, { delay: 300 })

/** 7 个状态胶囊。数字全部来自服务端聚合，前端不做加减 */
const chips = computed(() => [
  { value: '', label: '全部', count: summary.value.total },
  { value: 'OVERDUE', label: '超期', count: summary.value.overdue },
  { value: 'DUE_SOON', label: '临期', count: summary.value.dueSoon },
  { value: 'PENDING_OA', label: '待提单', count: summary.value.pendingOa },
  { value: 'WAITING', label: '等货', count: summary.value.waiting },
  { value: 'ARRIVED', label: '已到货', count: summary.value.arrived },
  { value: 'PARTIAL', label: '部分到货', count: summary.value.partial },
])

/**
 * 点一下＝按该状态筛；再点一次＝取消。
 *
 * ⚠️ **单选而不是多选**：后端 `/api/purchase/list` 只收一个 `status` 参数，
 * 多选要么串起来（后端不认识 `OVERDUE,ARRIVED` 这种值），要么发多次请求再合并
 * （分页就废了）。本轮的硬约束是「不改接口契约」，所以保持单选 —— 这条已在
 * 变更说明里标为**未达项**，需要多选得先让后端支持。
 */
function toggleStatus(value) {
  statusFilter.value = statusFilter.value === value ? '' : value
  applyPurchaseFilters()
}
</script>

<template>
  <div class="flex min-w-0 flex-nowrap items-center gap-2">
    <el-date-picker
      v-model="rangeStart"
      type="date"
      value-format="YYYY-MM-DD"
      placeholder="提出需求·起"
      aria-label="提出需求日期起"
      class="!w-[124px] shrink-0"
      @change="applyPurchaseFilters"
    />
    <span class="shrink-0 text-xs text-slate-500">至</span>
    <el-date-picker
      v-model="rangeEnd"
      type="date"
      value-format="YYYY-MM-DD"
      placeholder="提出需求·止"
      aria-label="提出需求日期止"
      class="!w-[124px] shrink-0"
      @change="applyPurchaseFilters"
    />

    <!-- chips 可横滚，其余不滚 -->
    <div class="flex min-w-0 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        v-for="chip in chips"
        :key="chip.value || 'all'"
        type="button"
        class="shrink-0 rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
        :class="
          statusFilter === chip.value
            ? 'border-slate-700 bg-slate-800 text-white'
            : 'border-line bg-region text-slate-600 hover:border-slate-400'
        "
        :aria-pressed="statusFilter === chip.value"
        :title="`${chip.label}：${chip.count} 条`"
        @click="toggleStatus(chip.value)"
      >
        {{ chip.label }}
      </button>
    </div>

    <el-select
      v-model="categoryFilter"
      placeholder="全部类别"
      aria-label="按类别筛选"
      clearable
      class="!w-[104px] shrink-0"
      @change="applyPurchaseFilters"
    >
      <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
    </el-select>

    <el-input
      v-model="keyword"
      placeholder="物料名称 / 编码"
      aria-label="搜索采购需求（物料名称或编码）"
      clearable
      class="!w-[168px] shrink-0"
      @keyup.enter="flushKeyword"
      @clear="flushKeyword"
    />
  </div>
</template>
