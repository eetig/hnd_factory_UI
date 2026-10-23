<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useMaterialMasterPage } from '../../composables/useMaterialMasterPage'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
// 本工程没有 Element Plus 自动导入（其余页面都是显式 import），漏了就会渲染成空标签
import { ElCheckbox, ElInput, ElPagination } from 'element-plus'
import { STATUS_TONE } from '../../constants/statusTones'

/*
 * 物料主数据（2026-10-23，变更-159）。
 *
 * 三段式：左栏按「状态 / 物料类型」筛，中间搜索 + 一码一行的结果表，右侧详情抽屉。
 * 为什么不是一页大表格：3 万个物料里 88% 是备件/设备/行政，用户真正要的是"打两个字选中它"，
 * 而不是翻 600 页 —— 所以**搜索优先**，类型只是收窄用的侧栏，不是主入口。
 *
 * 数据层在 useMaterialMasterPage（请求 + 过期响应护栏 + 分页），这里只管交互与呈现。
 */
const {
  keyword,
  typeCode,
  statusFilter,
  hasPrice,
  rows,
  total,
  pageNum,
  pageCount,
  pageSize,
  loading,
  refining,
  error,
  facets,
  selectedCode,
  detail,
  detailLoading,
  fetchFacets,
  fetchPage,
  applyFilters,
  goPage,
  toggleType,
  toggleStatus,
  openDetail,
  closeDetail,
} = useMaterialMasterPage()

const searchInput = ref(null)

/* 边打边查：停 300ms 发请求（与物料库存页同一手感）。
   中文输入法期间不回发：watch 拿到的是组字后的 v-model 值，拼音串不会触发查询。 */
let debounceTimer = null
watch(keyword, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => applyFilters(), 300)
})

function onSearchEnter() {
  clearTimeout(debounceTimer)
  applyFilters()
}

const statusItems = computed(() => facets.value?.statuses ?? [])
const typeItems = computed(() => facets.value?.types ?? [])

const shownFrom = computed(() => (total.value === 0 ? 0 : (pageNum.value - 1) * pageSize.value + 1))
const shownTo = computed(() => Math.min(pageNum.value * pageSize.value, total.value))

const STATUS_TEXT = { 1: '正常', 2: '待停用', 0: '停用' }

/* 状态胶囊只用 statusTones 的语义色：视觉守卫禁止组件里散写 amber/emerald/slate 色阶
   （对比度是那边算好的，散写会出现"看着差不多、其实不过 AA"的第二套色） */
function statusClass(status) {
  if (status === 2) return STATUS_TONE.warning
  if (status === 0) return STATUS_TONE.neutral
  return STATUS_TONE.success
}

/** 价格：0 显示「未计价」（比 ¥0.00 更不容易被误读成免费）；价格单位 1000 要一起说清 */
function formatPrice(row) {
  if (row.price === null || row.price === undefined) return '—'
  const value = Number(row.price)
  if (!value) return '未计价'
  const unit = Number(row.priceUnit) || 1
  const text = value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return unit === 1 ? `¥${text}` : `¥${text} / ${unit.toLocaleString('zh-CN')}`
}

/** 上次更改：后端是 LocalDate（yyyy-MM-dd），空值显示「—」 */
function formatDate(value) {
  if (!value) return '—'
  return String(value).slice(0, 10)
}

function formatUnit(row) {
  const unit = Number(row.priceUnit) || 1
  return unit === 1 ? row.unit || '—' : `${row.unit || ''}（每 ${unit}）`
}

function pick(row) {
  openDetail(row.code)
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code)
  } catch {
    // 剪贴板不可用时不打断使用（老浏览器/非安全上下文）
  }
}

onMounted(async () => {
  await Promise.all([fetchFacets(), fetchPage()])
  await nextTick()
  searchInput.value?.focus?.()
})
</script>

<template>
  <div class="relative flex h-full min-h-0">
    <!-- ===== 左栏：状态 / 类型 ===== -->
    <aside
      class="mr-4 flex w-56 shrink-0 flex-col overflow-y-auto rounded-card border border-line bg-raised shadow-card"
    >
      <div class="border-b border-line px-4 py-3">
        <p class="text-sm font-semibold text-slate-900">筛选</p>
        <p class="mt-1 text-xs text-slate-500">
          共 <span class="font-semibold text-slate-900">{{ facets.total }}</span> 个物料
        </p>
      </div>

      <div class="px-2 py-3">
        <p class="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">状态</p>
        <button
          v-for="item in statusItems"
          :key="`st-${item.code}`"
          type="button"
          class="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition"
          :class="statusFilter === item.code ? 'bg-region font-semibold text-slate-900' : 'text-slate-600 hover:bg-region'"
          @click="toggleStatus(item.code)"
        >
          <span>{{ item.label }}</span>
          <span class="text-xs tabular-nums text-slate-500">{{ item.count }}</span>
        </button>
      </div>

      <div class="border-t border-line px-2 py-3">
        <p class="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">物料类型</p>
        <button
          v-for="item in typeItems"
          :key="`ty-${item.code}`"
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition"
          :class="typeCode === item.code ? 'bg-region font-semibold text-slate-900' : 'text-slate-600 hover:bg-region'"
          @click="toggleType(item.code)"
        >
          <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: item.color || '#94a3b8' }"></span>
          <span class="min-w-0 flex-1 truncate text-left">{{ item.label }}</span>
          <span class="text-xs tabular-nums text-slate-500">{{ item.count }}</span>
        </button>
      </div>
    </aside>

    <!-- ===== 中间：搜索 + 结果表 ===== -->
    <section class="flex min-w-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <el-input
          ref="searchInput"
          v-model="keyword"
          placeholder="物料编码 / 名称"
          aria-label="搜索物料"
          clearable
          class="w-80"
          @keyup.enter="onSearchEnter"
          @clear="onSearchEnter"
        />
        <el-checkbox v-model="hasPrice" @change="applyFilters">只看有价</el-checkbox>
        <span class="ml-auto text-sm text-slate-500">
          <template v-if="refining">查询中…</template>
          <template v-else>
            共 <span class="font-semibold text-slate-900">{{ total }}</span> 个物料
          </template>
        </span>
      </div>

      <div class="relative flex min-h-0 flex-1 flex-col">
        <LoadingMask v-if="loading && !rows.length" />

        <PanelState
          v-else-if="error"
          type="error"
          title="暂时无法获取物料主数据"
          :description="error"
          action-text="重新加载"
          @action="fetchPage"
        />

        <PanelState
          v-else-if="rows.length === 0"
          :title="keyword || typeCode || statusFilter !== '' || hasPrice ? '没有符合条件的物料' : '还没有物料主数据'"
          :description="
            keyword || typeCode || statusFilter !== '' || hasPrice
              ? '换个关键词，或取消左侧筛选。'
              : '主数据由 SAP 导出后导入，见 docs/schema.sql 第 25 步。'
          "
        />

        <div v-else class="min-h-0 flex-1 overflow-auto">
          <table class="w-full min-w-[720px] table-fixed divide-y divide-line text-left">
            <colgroup>
              <col class="w-[100px]" />
              <col />
              <col class="w-[88px]" />
              <col class="w-[56px]" />
              <col class="w-[120px]" />
              <col class="w-[96px]" />
              <col class="w-[76px]" />
            </colgroup>
            <thead class="sticky top-0 z-10 bg-region">
              <tr>
                <th class="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">编码</th>
                <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">物料名称</th>
                <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">类型</th>
                <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">单位</th>
                <th class="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">价格</th>
                <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">上次更改</th>
                <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">状态</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr
                v-for="row in rows"
                :key="row.code"
                class="cursor-pointer transition hover:bg-region focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-ink"
                :class="selectedCode === row.code ? 'bg-region' : ''"
                tabindex="0"
                @click="pick(row)"
                @keydown.enter.prevent="pick(row)"
              >
                <td class="whitespace-nowrap px-3 py-2.5 font-mono text-sm text-slate-600">{{ row.code }}</td>
                <td class="px-3 py-2.5 text-sm text-slate-800">
                  <!-- 名字可以很长（备件带规格串），所以用 flex + truncate：
                       截断只作用于名字，徽标 shrink-0 不会被 ellipsis 吃掉 -->
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="truncate" :title="row.name">{{ row.name }}</span>
                    <span
                      v-if="row.valuationCount > 0"
                      class="shrink-0 rounded-full px-1.5 py-0.5 text-[11px]"
                      :class="STATUS_TONE.info"
                    >{{ row.valuationCount }} 种状态价</span>
                  </div>
                </td>
                <td class="whitespace-nowrap px-3 py-2.5 text-sm">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs"
                    :style="{ backgroundColor: `${row.typeColor}1a`, color: row.typeColor || '#475569' }"
                  >{{ row.typeName || row.typeCode }}</span>
                </td>
                <td class="whitespace-nowrap px-3 py-2.5 text-sm text-slate-500">{{ row.unit || '—' }}</td>

                <td class="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums" :class="row.price ? 'text-slate-800' : 'text-slate-500'">
                  {{ formatPrice(row) }}
                </td>
                <td class="whitespace-nowrap px-3 py-2.5 text-sm tabular-nums text-slate-500">{{ formatDate(row.changedAt) }}</td>
                <td class="whitespace-nowrap px-3 py-2.5 text-sm">
                  <span class="rounded-full px-2 py-0.5 text-xs" :class="statusClass(row.status)">
                    {{ STATUS_TEXT[row.status] || '—' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="flex shrink-0 items-center justify-between border-t border-line px-6 py-2">
        <span class="text-sm text-slate-500">
          第 <span class="font-semibold text-slate-900">{{ shownFrom }}–{{ shownTo }}</span> 条 / 共
          {{ total }} 条
        </span>
        <el-pagination
          layout="prev, pager, next"
          :current-page="pageNum"
          :page-count="pageCount"
          :pager-count="5"
          background
          @current-change="goPage"
        />
      </div>
    </section>

    <!-- ===== 右侧：详情 ===== -->
    <transition name="detail">
      <aside
        v-if="selectedCode"
        class="absolute inset-y-0 right-0 z-20 flex w-[380px] flex-col overflow-y-auto rounded-card border border-line bg-raised shadow-card"
        aria-label="物料详情"
      >
      <div class="flex items-center justify-between border-b border-line px-4 py-3">
        <p class="text-sm font-semibold text-slate-900">物料详情</p>
        <button
          v-if="selectedCode"
          type="button"
          class="text-xs text-slate-500 hover:text-slate-900"
          @click="closeDetail"
        >关闭</button>
      </div>
      <div v-if="detailLoading" class="px-4 py-10 text-center text-sm text-slate-500">读取中…</div>

      <div v-else-if="detail" class="px-4 py-3 text-sm">
        <p class="font-mono text-base font-semibold text-slate-900">{{ detail.material.code }}</p>
        <p class="mt-1 break-words text-slate-800">{{ detail.material.name }}</p>

        <div class="mt-2 flex flex-wrap items-center gap-2">
          <span
            class="rounded-full px-2 py-0.5 text-xs"
            :style="{
              backgroundColor: `${detail.material.typeColor}1a`,
              color: detail.material.typeColor || '#475569',
            }"
          >{{ detail.material.typeName || detail.material.typeCode }}</span>
          <span class="rounded-full px-2 py-0.5 text-xs" :class="statusClass(detail.material.status)">
            {{ STATUS_TEXT[detail.material.status] || '—' }}
          </span>
          <button
            type="button"
            class="rounded-full border border-line px-2 py-0.5 text-xs text-slate-600 hover:bg-region"
            @click="copyCode(detail.material.code)"
          >复制编码</button>
        </div>

        <p
          v-if="detail.material.status === 0"
          class="mt-3 rounded-lg px-3 py-2 text-xs" :class="STATUS_TONE.neutral"
        >该物料在 SAP 里已标记停用，新单据请勿选用。</p>
        <p
          v-else-if="detail.material.status === 2"
          class="mt-3 rounded-lg px-3 py-2 text-xs" :class="STATUS_TONE.warning"
        >该物料在 SAP 里标记为「待禁用」，下单前请确认。</p>

        <dl class="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt class="text-slate-500">物料组</dt>
            <dd class="mt-0.5 text-slate-800">{{ detail.material.group || '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">基本计量单位</dt>
            <dd class="mt-0.5 text-slate-800">{{ formatUnit(detail.material) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">采购组</dt>
            <dd class="mt-0.5 text-slate-800">
              {{ detail.material.procurementGroup || '—' }}
              <span v-if="detail.material.procurementGroupName" class="text-slate-500">
                （{{ detail.material.procurementGroupName }}）
              </span>
            </dd>
          </div>
          <div>
            <dt class="text-slate-500">MRP 类型</dt>
            <dd class="mt-0.5 text-slate-800">
              {{ detail.material.mrpType || '未维护' }}
              <span v-if="detail.material.mrpLabel" class="text-slate-500">（{{ detail.material.mrpLabel }}）</span>
            </dd>
          </div>
          <div>
            <dt class="text-slate-500">价格</dt>
            <dd class="mt-0.5 tabular-nums text-slate-800">{{ formatPrice(detail.material) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">价格控制</dt>
            <dd class="mt-0.5 text-slate-800">{{ detail.material.priceControl || '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">上次更改</dt>
            <dd class="mt-0.5 text-slate-800">{{ formatDate(detail.material.changedAt) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">创建人</dt>
            <dd class="mt-0.5 text-slate-800">{{ detail.material.creator || '—' }}</dd>
          </div>
        </dl>

        <div v-if="detail.valuations && detail.valuations.length" class="mt-5">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">评估类型价格（罐体状态）</p>
          <table class="mt-2 w-full text-left text-xs">
            <thead>
              <tr class="text-slate-500">
                <th class="py-1 font-medium">状态</th>
                <th class="py-1 font-medium">含义</th>
                <th class="py-1 text-right font-medium">价格</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr v-for="item in detail.valuations" :key="item.type">
                <td class="whitespace-nowrap py-1.5 text-slate-800">{{ item.label }}</td>
                <td class="py-1.5 text-slate-500">{{ item.meaning }}</td>
                <td class="whitespace-nowrap py-1.5 text-right tabular-nums text-slate-800">
                  {{ item.price === null || item.price === undefined ? '—' : `¥${Number(item.price).toFixed(2)}` }}
                </td>
              </tr>
            </tbody>
          </table>
          <p class="mt-2 text-[11px] leading-relaxed text-slate-500">
            表内价格是各状态的标准价（S）；主档价格是移动平均价（V），两者用途不同。
          </p>
        </div>
      </div>
      </aside>
    </transition>
  </div>
</template>
<style scoped>
/* 详情浮层：从右侧滑入一点点，够暗示「它是叠在列表上的」，又不会让人等动画 */
.detail-enter-active,
.detail-leave-active {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.detail-enter-from,
.detail-leave-to {
  transform: translateX(12px);
  opacity: 0;
}
</style>