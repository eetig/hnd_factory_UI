<script setup>
import { computed, ref } from 'vue'
import { dueLabel, quantityText, requestAgeLabel, requesterSummary } from './boardGroups.js'

/*
 * 采购看板的一张卡 = **一个 OA 单**（2026-10-23，变更-168）。
 *
 * ## 为什么从"一行物料一张卡"改成"一个 OA 一张卡"
 *
 * 使用方：「通常一个 OA 单号对应多个卡片，这样可以做成一个卡片」。
 * 实测线上 6 条待处理里 5 条共用同一个 OA —— 那本来是**一件事**（一批采购），
 * 却被摊成 5 张卡，列里看不出"这张 OA 要催几次"。
 *
 * ## 卡面结构
 *
 *   ① 顶行：OA 单号（可点跳 EKP ⤴）｜最急那条的状态徽标
 *   ② 需求人 · 提了多久
 *   ③ 物料行列表：**名称 + 规格 + 数量**（使用方 2026-10-23 选定这一种，
 *      虽然比"只显示名称"高，但采购员认料主要靠规格）
 *   ④ 底行：最早的要求到货日 · 还剩几天（取组内最急那条，口径由后端给）
 *
 * ## 交互
 *
 *   · 点**某条物料** → 打开那条的抽屉（其余 4 条不用翻抽屉才看得到）
 *   · 点卡片空白 / 键盘 Enter → 打开**第一条**（lead）
 *   · 物料超过 4 条折叠，点「还有 N 条」展开 —— 否则一张 8 条的卡会顶出整列
 *
 * ⚠️ 根元素是 `div[role=button]` 而不是 `<button>`：卡片里有 `<a>`（OA 链接），
 *    HTML 不允许按钮里嵌交互元素；嵌了浏览器会把 `<a>` 拆出去，点链接反触发开抽屉。
 */
const props = defineProps({
  card: { type: Object, required: true },
})

const emit = defineEmits(['open', 'open-row'])

const FOLD_LIMIT = 4
const expanded = ref(false)

const rows = computed(() => props.card?.rows || [])
const visibleRows = computed(() => (expanded.value ? rows.value : rows.value.slice(0, FOLD_LIMIT)))
const hiddenCount = computed(() => Math.max(0, rows.value.length - FOLD_LIMIT))

const lead = computed(() => props.card?.lead || rows.value[0] || {})
const due = computed(() => dueLabel(lead.value))
const requestAge = computed(() => requestAgeLabel(lead.value))
const requesterText = computed(() => requesterSummary(props.card?.requesters || []))

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

/** 徽标：只看最急那条 —— 临期 / 部分到货 */
const badge = computed(() => {
  const status = String(lead.value.status || '').toUpperCase()
  if (status === 'DUE_SOON') return { text: '临期', cls: 'bg-brand-50 text-brand-ink' }
  if (status === 'PARTIAL') return { text: '部分到货', cls: 'bg-brand-50 text-brand-ink' }
  return null
})

/** 卡片 aria-label：读屏要能听出"这单有几条料、最急的是哪条" */
const cardLabel = computed(() => {
  const oa = props.card?.oaNo || '无 OA 单号'
  const count = rows.value.length
  const first = lead.value.materialName || '采购需求'
  return `${oa}，${count} 条物料，最急：${first}，${due.value.text}`
})

function openRow(row, event) {
  if (event) event.stopPropagation()
  emit('open-row', row)
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="w-full cursor-pointer rounded-card border border-line bg-raised p-3 text-left transition hover:border-slate-400 hover:shadow-card focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
    :aria-label="cardLabel"
    @click="emit('open')"
    @keydown.enter.self="emit('open')"
    @keydown.space.self.prevent="emit('open')"
  >
    <!-- ① OA 单号（可点 → EKP）+ 状态徽标 -->
    <div class="flex items-start justify-between gap-2">
      <p class="min-w-0 truncate text-xs">
        <a
          v-if="card.oaUrl"
          :href="card.oaUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="tabular-nums font-medium text-brand-ink hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink"
          :title="`在 OA 里打开：${card.oaUrl}`"
          @click.stop
          @keydown.stop
        >{{ card.oaNo }} ↗</a>
        <span
          v-else-if="card.oaNo"
          class="cursor-help tabular-nums font-medium text-amber-700 underline decoration-amber-400/60 decoration-dashed underline-offset-2"
          title="这条还没粘 OA 链接 —— 在「采购录入」的详情里补一次，之后这里就能直接点开"
        >{{ card.oaNo }}</span>
        <span v-else class="text-slate-500">无 OA 单号</span>
      </p>

      <span
        v-if="badge"
        class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
        :class="badge.cls"
        >{{ badge.text }}</span
      >
      <span
        v-else-if="card.count > 1"
        class="shrink-0 rounded bg-region px-1.5 py-0.5 text-[11px] tabular-nums text-slate-600"
        >{{ card.count }} 条</span
      >
    </div>

    <!-- ② 需求人 · 提了多久 -->
    <p class="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
      <span class="truncate">{{ requesterText }}</span>
      <span class="shrink-0 tabular-nums">{{ requestAge }}</span>
    </p>

    <!-- ③ 物料行：名称 + 规格 + 数量（点某一条 → 打开那条的抽屉） -->
    <ul class="mt-2 space-y-1.5 border-t border-line pt-2">
      <li v-for="row in visibleRows" :key="row.id">
        <button
          type="button"
          class="w-full rounded-md px-1 py-0.5 text-left transition hover:bg-region focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink"
          :aria-label="`打开 ${row.materialName || '这条物料'} 的详情`"
          @click="openRow(row, $event)"
          @keydown.stop
        >
          <span class="flex items-baseline justify-between gap-2">
            <span class="min-w-0 truncate text-sm font-medium leading-snug text-slate-900">{{
              row.materialName || '（未填物料名称）'
            }}</span>
            <span class="shrink-0 text-xs tabular-nums text-slate-600">{{ quantityText(row) }}</span>
          </span>
          <span v-if="row.spec" class="mt-0.5 block truncate text-[11px] text-slate-500" :title="row.spec">{{
            row.spec
          }}</span>
          <span v-else-if="row.category" class="mt-0.5 block text-[11px] text-slate-500">{{ row.category }}</span>
        </button>
      </li>

      <li v-if="hiddenCount && !expanded">
        <button
          type="button"
          class="w-full rounded-md px-1 py-0.5 text-left text-[11px] font-medium text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink"
          @click.stop="expanded = true"
          @keydown.stop
        >
          还有 {{ hiddenCount }} 条 · 展开 ⌄
        </button>
      </li>
    </ul>

    <!-- ④ 最早的要求到货日 · 还剩几天 -->
    <div class="mt-2 flex items-center justify-between gap-2 border-t border-line pt-1.5 text-xs">
      <span class="tabular-nums text-slate-500">{{ card.earliestArrival || '未填到货日' }}</span>
      <span class="shrink-0 font-medium" :class="dueToneClass">{{ due.text }}</span>
    </div>
  </div>
</template>
