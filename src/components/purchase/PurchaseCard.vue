<script setup>
import { computed } from 'vue'
import { dueLabel, quantityText } from './boardGroups.js'

/*
 * 采购看板的一张卡（变更-148）。
 *
 * 显示五行，顺序按"扫一眼要什么"排：
 *   ① 物料名称（最多两行，超出省略）
 *   ② 规格型号（一行，省略）—— 采购员认料主要靠这一行
 *   ③ 数量 + 单位 ｜ 类别徽标
 *   ④ 要求到货 · 还剩 N 天（超期标红）
 *   ⑤ 需求人
 *
 * **OA 单号不上卡**：它长、而且只有真要催单时才需要 —— 点开抽屉里有。
 * 卡片的目标是"横向比较谁更急"，不是"看全所有字段"。
 */
const props = defineProps({
  row: { type: Object, required: true },
})

const due = computed(() => dueLabel(props.row))
const qty = computed(() => quantityText(props.row))

const dueToneClass = computed(() => {
  switch (due.value.tone) {
    case 'overdue':
      return 'text-rose-700'
    case 'soon':
      return 'text-brand-ink'
    case 'none':
      return 'text-slate-500'
    default:
      return 'text-slate-600'
  }
})

/** 列内标签：临期 / 部分到货 —— 只在这两种情况下多显示一个小徽标 */
const badge = computed(() => {
  const s = String(props.row.status || '').toUpperCase()
  if (s === 'DUE_SOON') return { text: '临期', cls: 'bg-brand-50 text-brand-ink' }
  if (s === 'PARTIAL') return { text: '部分到货', cls: 'bg-brand-50 text-brand-ink' }
  return null
})
</script>

<template>
  <button
    type="button"
    class="w-full rounded-card border border-line bg-raised p-3 text-left transition hover:-translate-y-px hover:border-slate-400 hover:shadow-card focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
    :aria-label="`${row.materialName || '采购需求'}，${row.statusLabel || ''}，${due.text}`"
  >
    <div class="flex items-start justify-between gap-2">
      <p class="line-clamp-2 min-w-0 text-sm font-medium leading-snug text-slate-900">
        {{ row.materialName || '（未填物料名称）' }}
      </p>
      <span
        v-if="badge"
        class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
        :class="badge.cls"
        >{{ badge.text }}</span
      >
    </div>

    <p v-if="row.spec" class="mt-1 truncate text-xs text-slate-500" :title="row.spec">
      {{ row.spec }}
    </p>

    <div class="mt-2 flex items-center gap-2 text-xs">
      <span class="font-medium tabular-nums text-slate-800">{{ qty }}</span>
      <span v-if="row.category" class="rounded bg-region px-1.5 py-0.5 text-slate-600">{{
        row.category
      }}</span>
    </div>

    <div class="mt-1.5 flex items-center justify-between gap-2 text-xs">
      <span class="tabular-nums text-slate-500">{{ row.requiredArrivalDate || '未填到货日' }}</span>
      <span class="shrink-0 font-medium" :class="dueToneClass">{{ due.text }}</span>
    </div>

    <div class="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-1.5 text-xs">
      <span class="truncate text-slate-600">{{ row.requester || '未填需求人' }}</span>
      <span v-if="row.oaNo" class="shrink-0 truncate text-slate-500" :title="row.oaNo"
        >OA 已提</span
      >
      <span v-else class="shrink-0 text-brand-ink">待提单</span>
    </div>
  </button>
</template>
