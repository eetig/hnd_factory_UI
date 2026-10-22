<script setup>
import { computed } from 'vue'
import { blockReasonText, sizeText } from './ledgerGroups.js'

/*
 * 设备看板的一张卡（变更-150）。
 *
 * 五行，和采购卡同一套节奏（同一系统里两张看板不该长得不一样）：
 *   ① 设备名称（昵称跟在后面，小字）
 *   ② 位号 + 容器类型
 *   ③ 规模（规格或 Φ内径×筒长）
 *   ④ **缺什么**（后端给的 enableBlockReason 优先）
 *   ⑤ 车间装置 · 介质
 */
const props = defineProps({
  row: { type: Object, required: true },
})

const reason = computed(() => blockReasonText(props.row))
const size = computed(() => sizeText(props.row))

const CONTAINER_LABELS = { 1: '卧式', 2: '平底', 3: '其他' }
const containerLabel = computed(() => CONTAINER_LABELS[Number(props.row.containerType)] || '')
</script>

<template>
  <button
    type="button"
    class="w-full rounded-card border border-line bg-raised p-3 text-left transition hover:-translate-y-px hover:border-slate-400 hover:shadow-card focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
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

    <p
      v-if="reason"
      class="mt-1.5 line-clamp-2 rounded bg-brand-50 px-1.5 py-1 text-[11px] leading-snug text-brand-ink"
    >
      {{ reason }}
    </p>

    <div class="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-1.5 text-xs">
      <span class="truncate text-slate-600">{{ row.workshop || '未填车间' }}</span>
      <span class="shrink-0 truncate text-slate-500">{{ row.medium || '—' }}</span>
    </div>
  </button>
</template>
