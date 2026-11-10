<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PurchaseBoard from './PurchaseBoard.vue'
import PurchaseView from '../../views/purchase/PurchaseView.vue'

/*
 * 采购工作台（2026-11-10，把变更-148 的两个平级页面并成一页两个页签）。
 *
 * ## 为什么并回来
 *
 * 变更-148 拆页时，使用方的原话是「录入效果确实很好，但是观感不好，要新建一个看板界面」——
 * 所以看板是**新增**的，录入页原样留着。两个菜单并存之后，实际用法变成：
 * 在看板上看到缺料 → 要登记就得切到录入页 → 填完再切回来看 —— 一次登记两次换页。
 * 使用方现在的要求是「直接在看板上增删改」，也就是把这两步放回同一个屏幕。
 *
 * ## 两个页签各自保命的地方
 *
 * · 「看板」：四列、只看未到货，一屏回答"今天该催谁"；
 * · 「录入 / 历史」：原来那张表，负责批量填与查历史（带筛选、分页）。
 *
 * 两套数据视角仍然**分开**：看板自己拉 200 条未到货，台账走自己的筛选与分页，
 * 互不污染（这也是当初不肯做 Tab 的理由，现在靠"各自一份请求"化解，
 * 而不是靠"两个页面"）。
 *
 * ## 为什么是懒挂载 + v-show
 *
 * 页签切回来要保留滚动位置、草稿行、筛选条件 —— 卸载重建会全丢。
 * 但两个都一进来就挂又会让首屏多发一次列表请求，所以第一次切过去才挂载
 * （`mountedTabs`），之后只切可见性。
 */
/*
 * `scope`（2026-11-10，变更-182）：`purchase` = 采购工作台（原样），
 * `expense` = 费用申请（看板三列 + 台账只放 ZCSG/FWCGSQ）。
 * 两页共用同一套组件，靠这一个 prop 分叉，避免复制文件后两边越改越不一样。
 */
const props = defineProps({
  scope: { type: String, default: 'purchase' },
})

const isExpense = computed(() => props.scope === 'expense')

/** 费用申请管的两类单据，台账与看板共用同一份常量 */
const EXPENSE_TYPES = ['ZCSG', 'FWCGSQ']

const route = useRoute()
const router = useRouter()

const TABS = [
  { key: 'board', label: '看板', hint: '今天该催谁' },
  { key: 'entry', label: '录入 / 历史', hint: '批量录入、查历史' },
]

/** 深链 `?tab=entry` 能直接落在录入页签（旧书签 /purchase/entry 会重定向到这里） */
const tab = ref(route.query.tab === 'entry' ? 'entry' : 'board')
const mountedTabs = ref(new Set([tab.value]))

watch(tab, (next) => {
  if (!mountedTabs.value.has(next)) {
    mountedTabs.value = new Set([...mountedTabs.value, next])
  }
  // 页签进 URL：刷新/分享能回到同一个视图，返回键也能退回上一个页签
  router.replace({ query: { ...route.query, tab: next === 'entry' ? 'entry' : undefined } })
})

/*
 * 反向：地址栏变了（点侧栏「采购看板」、浏览器后退）要跟着换页签。
 * 只单向 watch(tab) 的话，从 `?tab=entry` 点侧栏回到 `/purchase/board`，
 * 页面仍是录入页签，URL 却说在看板 —— 两处说法不一致最难排查。
 */
watch(
  () => route.query.tab,
  (value) => {
    const next = value === 'entry' ? 'entry' : 'board'
    if (next !== tab.value) tab.value = next
  },
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div
      class="flex shrink-0 items-center gap-1 self-start rounded-md border border-line bg-region/60 p-0.5"
      role="tablist"
      aria-label="采购视图"
    >
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        :data-tab="t.key"
        :title="t.hint"
        class="rounded px-3 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
        :class="
          tab === t.key
            ? 'bg-raised font-semibold text-slate-900 shadow-sm'
            : 'text-slate-600 hover:text-slate-900'
        "
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-show="tab === 'board'" class="flex min-h-0 flex-1 flex-col">
      <PurchaseBoard v-if="mountedTabs.has('board')" :scope="scope" />
    </div>

    <div v-show="tab === 'entry'" class="flex min-h-0 flex-1 flex-col">
      <PurchaseView
        v-if="mountedTabs.has('entry')"
        :order-types="isExpense ? EXPENSE_TYPES : []"
        :default-order-type="isExpense ? 'ZCSG' : ''"
      />
    </div>
  </div>
</template>
