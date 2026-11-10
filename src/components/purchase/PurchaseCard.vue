<script setup>
import { computed, ref } from 'vue'
import { dueLabel, needsAcceptance, quantityText, requesterSummary } from './boardGroups.js'

/*
 * 采购看板的一张卡 = **一个 OA 单**（2026-10-23，变更-168）。
 *
 * ## 为什么从"一行物料一张卡"改成"一个 OA 一张卡"
 *
 * 使用方：「通常一个 OA 单号对应多个卡片，这样可以做成一个卡片」。
 * 实测线上 6 条待处理里 5 条共用同一个 OA —— 那本来是**一件事**（一批采购），
 * 却被摊成 5 张卡，列里看不出"这张 OA 要催几次"。
 *
 * ## 卡面结构（2026-11-10 重构，变更-180）
 *
 * 使用方的原话：「每张卡片的不同之处是 OA 单号。一张 OA 单号对应多条物料需求。
 * 比如 提出日期-物料名称-物料编码-规格型号-用途-要求到货日期-需求人」。
 * 背景是：**每隔一段时间提一张 OA**，那一张单收的是这期间不同人、不同时间提的需求 ——
 * 所以卡上真正要读的不是"这单有多急"，而是"这一单里都装了些什么"。
 *
 *   ① 抬头：OA 单号（可点跳 EKP）｜最急那条的状态徽标
 *           次行：需求人汇总 · 提了多久
 *   ② 表头一次：提出 · 物料 · 到货（三列的列宽在三处共用同一个 grid 模板串）
 *   ③ 明细行：**一行一条物料，两行读法**
 *            第一行  提出日期（MM-DD）｜物料名称（13px 半粗）｜要求到货日（MM-DD，按急慢着色）
 *            第二行  物料编码 · 规格型号 · 用途 · 需求人 · 数量（11px 中灰，单行截断）
 *   ④ 底行：这单最早的要求到货日 · 还剩几天（取组内最急那条，口径由后端给）
 *
 * 七件事一件不少，且**顺序就是使用方口述的顺序**：提出 → 名称 → 编码 → 规格 → 用途 → 到货 → 需求人。
 *
 * ## 交互
 *
 *   · 点**某条物料** → 打开那条的详情（其余几条不用翻抽屉才看得到）
 *   · 点卡片空白 / 键盘 Enter → 打开**第一条**（lead）
 *   · 物料超过 4 条折叠，点「还有 N 条」展开 —— 否则一张 8 条的卡会顶出整列
 *
 * ⚠️ 根元素是 `div[role=button]` 而不是 `<button>`：卡片里有 `<a>`（OA 链接），
 *    HTML 不允许按钮里嵌交互元素；嵌了浏览器会把 `<a>` 拆出去，点链接反触发开抽屉。
 */
const props = defineProps({
  card: { type: Object, required: true },
  /** 这一列的状态色（看板按列传入，2026-11-02） */
  color: { type: String, default: '#5B6470' },
})

const emit = defineEmits(['open', 'open-row'])

const FOLD_LIMIT = 4
const expanded = ref(false)

/** 三列共用的 grid 模板：表头与明细行必须逐字一致，否则出现"表头对不上数据" */
const GRID = 'grid grid-cols-[34px_minmax(0,1fr)_46px] items-baseline gap-x-2'

const rows = computed(() => props.card?.rows || [])
const visibleRows = computed(() => (expanded.value ? rows.value : rows.value.slice(0, FOLD_LIMIT)))
const hiddenCount = computed(() => Math.max(0, rows.value.length - FOLD_LIMIT))

const lead = computed(() => props.card?.lead || rows.value[0] || {})
const due = computed(() => dueLabel(lead.value))
const requestAge = computed(() => requestAgeLabelOf(lead.value))
const requesterText = computed(() => requesterSummary(props.card?.requesters || []))

const dueToneClass = computed(() => toneClass(due.value.tone))

/**
 * 「提了多久」——抬头次行用。
 *
 * 为什么留着它、而不是显示 "OA 已提 / 待提单"：那两个字**每一列都知道**
 * （待提单列里全是待提单），在卡上再写一遍是纯噪音。这一格回答的是另一个问题：
 * **这件事拖了多久**。逐条的提出日期在明细里，抬头给的是这单最急那条的账龄。
 */
function requestAgeLabelOf(row = {}) {
  const raw = String(row.requestDate || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '未填提出日期'

  const [y, m, d] = raw.split('-').map(Number)
  const now = new Date()
  const a = Date.UTC(y, m - 1, d)
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((b - a) / 86400000)

  if (!Number.isFinite(days)) return '未填提出日期'
  if (days <= 0) return '今天提出'
  if (days === 1) return '昨天提出'
  return `提出 ${days} 天`
}

/** `2026-10-19` → `10-19`；空值给一个小横线，别让格子塌成一片空白 */
function md(value) {
  const raw = String(value || '').trim()
  const m = raw.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}-${m[2]}` : '—'
}

function toneClass(tone) {
  switch (tone) {
    case 'overdue':
      return 'text-rose-700'
    case 'soon':
      return 'text-brand-ink'
    case 'none':
      return 'text-slate-500'
    default:
      return 'text-slate-600'
  }
}

/** 明细行右端那个到货日：**逐条**按自己的急慢着色，口径仍走 dueLabel（后端算的） */
function rowDueClass(row) {
  return toneClass(dueLabel(row).tone)
}

/**
 * 明细第二行：编码 · 规格 · 用途 · 需求人 · 数量。
 *
 * 这五项都短、且是"认料/认人"用的补充信息，合成一行读比拆五行省一半高度。
 * 空值直接跳过 —— 不让一串「— · — · —」占位。
 */
function metaOf(row = {}) {
  /*
   * 顺序有讲究：**短的、用来认人的放前面，长的、用来认料的放后面**。
   * 编码与规格动辄 30+ 字，若排在前面，一截断就把「谁提的、干什么用」全挤没了 ——
   * 而这两项恰恰是使用方列在需求里的（用途、需求人）。
   * 于是：编码 · 数量 · 需求人 · 用途 · 规格（最后这一项允许被截断，hover 有 title 看全）。
   */
  const spec = String(row.spec || '').trim() || String(row.category || '').trim()
  const parts = [row.materialCode, quantityText(row), row.requester, row.purpose, spec]
    .map((v) => String(v ?? '').trim())
    .filter((v) => v && v !== '—')
  return { text: parts.join(' · '), parts }
}

/*
 * 抬头次行只放两件事：**谁**提的、**拖了多久**。
 * 条数不放在这里 —— 右上角的徽标已经写着「5 条」，同一行再说一遍是噪音。
 */
const headerMeta = computed(() => `${requesterText.value} · ${requestAge.value}`)

/** 徽标：只看最急那条 —— 待验收 / 临期 / 部分到货 */
const badge = computed(() => {
  const status = String(lead.value.status || '').toUpperCase()
  // 待验收优先展示（2026-11-10）：已到货但还没录验收单，是"下一步要办的事"
  if ((props.card?.rows || []).some((r) => needsAcceptance(r))) {
    return { text: '待验收', cls: 'bg-amber-50 text-amber-800' }
  }
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
    class="purchase-card w-full cursor-pointer rounded-card border border-line bg-raised text-left transition focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
    :aria-label="cardLabel"
    @click="emit('open')"
    @keydown.enter.self="emit('open')"
    @keydown.space.self.prevent="emit('open')"
  >
    <!-- ① OA 单号（可点 → EKP）+ 状态徽标 -->
    <div class="flex items-start justify-between gap-2 px-3 pt-2.5">
      <div class="min-w-0">
        <p class="truncate text-[13px] leading-tight">
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
            title="这条还没粘 OA 链接 —— 点开这张卡，在详情里补一次，之后这里就能直接点开"
          >{{ card.oaNo }}</span>
          <span v-else class="text-slate-500">无 OA 单号</span>
        </p>
        <p class="mt-0.5 truncate text-[11px] tabular-nums text-slate-500">{{ headerMeta }}</p>
      </div>

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

    <!-- ② 明细：表头只出现一次，列宽与下面的明细行共用 GRID -->
    <div class="mt-2 border-t border-line">
      <div
        :class="GRID"
        class="px-3 pt-1 pb-0.5 text-[11px] tracking-wide text-slate-500"
        aria-hidden="true"
      >
        <span>提出</span>
        <span>物料</span>
        <span class="text-right">到货</span>
      </div>

      <ul>
        <li
          v-for="row in visibleRows"
          :key="row.id"
          class="border-t border-line first:border-t-0"
        >
          <button
            type="button"
            class="w-full px-3 py-1.5 text-left transition hover:bg-region focus-visible:bg-region focus-visible:outline-none"
            :aria-label="`打开 ${row.materialName || '这条物料'} 的详情`"
            @click="openRow(row, $event)"
            @keydown.stop
          >
            <span :class="GRID" class="block">
              <span class="truncate tabular-nums text-[11px] text-slate-500">{{ md(row.requestDate) }}</span>
              <span class="truncate text-[13px] font-medium leading-snug text-slate-900">{{
                row.materialName || '（未填物料名称）'
              }}</span>
              <span class="text-right tabular-nums text-[11px]" :class="rowDueClass(row)">{{
                md(row.requiredArrivalDate)
              }}</span>
            </span>
            <span
              v-if="metaOf(row).text"
              class="mt-0.5 block truncate text-[11px] text-slate-500"
              :title="metaOf(row).text"
            >{{ metaOf(row).text }}</span>
          </button>
        </li>

        <li v-if="hiddenCount && !expanded" class="border-t border-line">
          <button
            type="button"
            class="w-full px-3 py-1 text-left text-[11px] font-medium text-brand-ink hover:bg-region hover:underline focus-visible:bg-region focus-visible:outline-none"
            @click.stop="expanded = true"
            @keydown.stop
          >
            还有 {{ hiddenCount }} 条 · 展开 ⌄
          </button>
        </li>
      </ul>
    </div>

    <!-- ③ 这单最早的要求到货日 · 还剩几天 -->
    <div class="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[11px]">
      <span class="tabular-nums text-slate-500">最早 {{ md(card.earliestArrival) }}</span>
      <span class="shrink-0 font-medium" :class="dueToneClass">{{ due.text }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 状态色左边条 + hover 全在盒内（与设备看板同一套手感） */
.purchase-card {
  border-left-width: 3px;
  border-left-color: v-bind('color');
  transition: background-color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}

.purchase-card:hover {
  background-color: #fffdf8;
  border-color: #d8d2c6;
  box-shadow: inset 0 0 0 1px rgba(120, 108, 88, 0.16);
}

.purchase-card:active {
  background-color: #faf7f0;
}

@media (prefers-reduced-motion: reduce) {
  .purchase-card {
    transition: none;
  }
}
</style>
