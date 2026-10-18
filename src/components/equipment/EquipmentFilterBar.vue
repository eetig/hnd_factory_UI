<script setup>
import { computed } from 'vue'
import { ElOption, ElSelect } from 'element-plus'
import { CONTAINER_OPTIONS } from './fields.js'
import { containerFilter, statusScope } from './useEquipmentFilters.js'

/**
 * 设备台账的状态 + 容器类型筛选（2026-10-18，变更-118）。
 *
 * ## 为什么关键字不在这里
 *
 * 关键字要接 `useLiveQuery`（防抖 + 查询签名去重 + 卸载撤销），而那条接线
 * **必须只有一份**（本仓有守卫钉着"四个查询框共用一套接线，不许出现第二套实现"）。
 * 它留在面板里，这里只管两个"选一下就生效"的维度 —— 组件边界跟着
 * "谁拥有那条接线"划，而不是跟着视觉位置划。
 *
 * ## 一行不换行
 *
 * 外层 `flex-nowrap`，chips 段允许横滚（`.filter-chips`），下拉固定宽度。
 * 让主要控件被挤走，比让胶囊滚一下糟得多。
 *
 * ## 「只看停用」为什么带星号
 *
 * 后端只提供 `onlyEnabled` 布尔，没有"只看停用"。这一档是**前端过滤当前页**
 * （见 useEquipmentFilters.js 的注释），所以标题写成"停用·本页"，
 * 并在计数行给出提示 —— 不让人以为筛的是全库。
 */
const emit = defineEmits(['change'])

const CHIPS = [
  { value: 'all', label: '全部', client: false },
  { value: 'on', label: '启用', client: false },
  { value: 'off', label: '停用·本页', client: true },
]

const activeChip = computed(() => CHIPS.find((c) => c.value === statusScope.value) ?? CHIPS[0])

function pickStatus(value) {
  if (statusScope.value === value) {
    // 再点一次当前档 = 回到「全部」，和采购页的胶囊同一手感
    statusScope.value = 'all'
  } else {
    statusScope.value = value
  }
  emit('change')
}

function pickContainer() {
  emit('change')
}
</script>

<template>
  <div class="flex min-w-0 flex-nowrap items-center gap-2">
    <div
      class="filter-chips flex min-w-0 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <button
        v-for="chip in CHIPS"
        :key="chip.value"
        type="button"
        class="shrink-0 rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
        :class="
          statusScope === chip.value
            ? 'border-slate-700 bg-slate-800 text-white'
            : 'border-line bg-region text-slate-600 hover:border-slate-400'
        "
        :aria-pressed="statusScope === chip.value"
        :title="chip.client ? '只过滤当前这一页（后端没有「只看停用」）' : `按「${chip.label}」筛选（服务端）`"
        @click="pickStatus(chip.value)"
      >
        {{ chip.label }}
      </button>
    </div>

    <el-select
      v-model="containerFilter"
      placeholder="全部类型"
      aria-label="按容器类型筛选（只过滤当前页）"
      clearable
      class="!w-[116px] shrink-0"
      @change="pickContainer"
    >
      <el-option
        v-for="t in CONTAINER_OPTIONS"
        :key="t.value"
        :label="t.label"
        :value="String(t.value)"
      />
    </el-select>

    <!-- 提示当前生效的是"本页内过滤"，省得有人以为筛的是全库 -->
    <span
      v-if="activeChip.client || containerFilter !== ''"
      class="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700"
      title="后端没有这两个筛选参数（硬约束：不改接口契约），所以只过滤当前页；翻页会换样本"
    >
      本页内过滤
    </span>
  </div>
</template>
