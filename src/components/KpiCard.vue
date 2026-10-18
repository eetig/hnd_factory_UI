<script setup>
import { computed, toRef } from 'vue'
import { useCountUp } from '../composables/useCountUp.js'

/**
 * 一张 KPI 卡（2026-10-18，变更-124）。
 *
 * 从周统计页那三张卡提炼出来的：**一个标签 + 一个大数字 + 单位**，
 * 数字用 `useCountUp` 滚到目标值。
 *
 * ## 两条必须遵守的口径（调用方负责，组件只负责显示）
 *
 * 1. **不跨量纲相加**。传进来的必须是一个物理量（kg、条数、百分比）。
 *    领料/入库那种"kg + 个 + 桶"的合计**不许**做成卡片 —— 那不是合计，是加法错误。
 * 2. **不重复展示**。`total` 条数在页头与分页器已经各显示一次，不要再做一张卡。
 *
 * ## 为什么带一份 `sr-only` 精确值
 *
 * 滚动中的数字对读屏没有意义（它会反复播报中间态）。所以动画那份 `aria-hidden`，
 * 读屏拿精确终值 —— 这是数字动画的标准做法，不是可选项。
 */
const props = defineProps({
  /** 标签，如「订单数量合计」 */
  label: { type: String, required: true },
  /** 数值（动画的目标） */
  value: { type: Number, default: 0 },
  /** 单位，如 kg、% */
  unit: { type: String, default: '' },
  /** 小数位（百分比用 1，其余 0） */
  decimals: { type: Number, default: 0 },
  /** 数字下面的一行小字（来源/口径说明） */
  hint: { type: String, default: '' },
  /** 是否用品牌色突出（一屏里最多一张） */
  accent: { type: Boolean, default: false },
})

const { display } = useCountUp(toRef(props, 'value'))

/**
 * 千分位 + 固定小数。
 * 用 `toLocaleString('zh-CN')` 而不是手写正则：本项目不引 i18n 库，
 * 但汉字的千分位就是逗号，交给内置格式化最省事。
 */
const formatted = computed(() => {
  const v = display.value
  if (!Number.isFinite(v)) return '0'
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  })
})

const exact = computed(() => {
  const v = Number(props.value) || 0
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  })
})
</script>

<template>
  <div class="kpi-card rounded-card border border-line bg-region/50 px-5 py-4">
    <p class="text-xs font-medium tracking-wide text-slate-500">{{ label }}</p>
    <p
      class="mt-1 text-3xl font-semibold tabular-nums tracking-tight"
      :class="accent ? 'text-brand-ink' : 'text-slate-900'"
      aria-hidden="true"
    >
      {{ formatted }}<span v-if="unit" class="ml-1 text-base font-normal text-slate-500">{{ unit }}</span>
    </p>
    <!-- 读屏拿精确终值：滚动中的中间态对它没有意义 -->
    <span class="sr-only">{{ exact }} {{ unit }}</span>
    <p v-if="hint" class="mt-1 text-xs text-slate-500">{{ hint }}</p>
  </div>
</template>

<style scoped>
/*
 * 入场：240ms 上浮 4px，与周统计页同一套节奏（不引入第二种语言）。
 * 只在挂载时一次 —— KPI 不是交互态，不需要可中断。
 */
.kpi-card {
  animation: kpi-rise 240ms cubic-bezier(0.23, 1, 0.32, 1) both;
}

@keyframes kpi-rise {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kpi-card {
    animation: none;
  }
}
</style>
