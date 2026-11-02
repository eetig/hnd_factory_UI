<script setup>
import { computed } from 'vue'
import { blockReasonText, sizeText } from './ledgerGroups.js'

/*
 * 设备看板的一张卡（变更-150；2026-11-02 重做视觉）。
 *
 * 概念：**挂牌**。一台设备一张牌，左边一条状态色边（缺底图 / 缺标定 / 已停用 / 已就绪），
 * 其余保持中性。颜色只说明"这台卡在哪一步"，不做装饰。
 *
 * ⚠️ hover 效果全部在**盒内**（背景 + 边框 + 左侧色条加宽 + inset 阴影）：
 * 外层是 `overflow-y: auto` 的滚动区，盒子外的阴影/ring 会被裁掉，
 * 表现就是"鼠标一悬停，卡片上面那条轮廓线被盖住了"（2026-11-02 使用方报的 bug）。
 */
const props = defineProps({
  row: { type: Object, required: true },
  /** 这一列的状态色（由看板按列传入） */
  color: { type: String, default: '#5B6470' },
})

const reason = computed(() => blockReasonText(props.row))
const size = computed(() => sizeText(props.row))

const CONTAINER_LABELS = { 1: '卧式', 2: '平底', 3: '其他' }
const containerLabel = computed(() => CONTAINER_LABELS[Number(props.row.containerType)] || '')
</script>

<template>
  <button
    type="button"
    class="eq-card w-full rounded-card border border-line bg-raised p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
    :style="{ borderLeftColor: color }"
    :aria-label="`${row.equipmentName || '设备'}，${row.equipmentCode || ''}，${reason || '已就绪'}`"
  >
    <p class="line-clamp-2 min-w-0 text-sm font-medium leading-snug text-slate-900">
      {{ row.equipmentName || '（未填设备名称）' }}
      <span v-if="row.nickname" class="font-normal text-slate-500">（{{ row.nickname }}）</span>
    </p>

    <div class="mt-1.5 flex items-center gap-2 text-xs">
      <span class="font-medium tabular-nums text-slate-800">{{ row.equipmentCode || '无位号' }}</span>
      <span v-if="containerLabel" class="rounded bg-region px-1.5 py-0.5 text-slate-600">{{
        containerLabel
      }}</span>
    </div>

    <p v-if="size" class="mt-1 truncate text-xs tabular-nums text-slate-500" :title="size">
      {{ size }}
    </p>

    <p v-if="reason" class="eq-card__reason mt-1.5 line-clamp-2 rounded px-1.5 py-1 text-[11px] leading-snug">
      {{ reason }}
    </p>

    <div class="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-1.5 text-xs">
      <span class="truncate text-slate-600">{{ row.workshop || '未填车间' }}</span>
      <span class="shrink-0 truncate text-slate-500">{{ row.medium || '—' }}</span>
    </div>
  </button>
</template>

<style scoped>
.eq-card {
  border-left-width: 3px;
  /* hover 用 inset 阴影 + 边框加深：盒子外的东西会被滚动区裁掉，这里全在盒内 */
  transition: background-color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}

.eq-card:hover {
  background-color: #fffdf8;
  border-color: #d8d2c6;
  box-shadow: inset 0 0 0 1px rgba(120, 108, 88, 0.16);
}

.eq-card:active {
  background-color: #faf7f0;
}

@media (prefers-reduced-motion: reduce) {
  .eq-card {
    transition: none;
  }
}
</style>
