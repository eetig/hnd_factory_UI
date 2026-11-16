<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  ElDatePicker,
  ElInput,
  ElOption,
  ElPagination,
  ElSelect,
} from 'element-plus'
import request from '../../api/request'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'
import PurchaseDetailDrawer from '../../components/purchase/PurchaseDetailDrawer.vue'
import { STATUS_TONE } from '../../constants/statusTones'
import { effectiveOrderType, quantityText } from '../../components/purchase/boardGroups'

/*
 * 采购 · 历史记录（2026-11-16，变更-215）。
 *
 * ## 为什么要有这一页
 *
 * 使用方的原话：「不论是采购看板，还是费用申请里的条目，都会在这个板块显示……
 * 这个模块的目的是方便溯源。」—— 看板回答「现在要做什么」，费用申请回答「这单报给谁」，
 * 两页都只看得到**自己那一半**。真出了事（这批料当初谁提的、OA 单号是多少、
 * 到底报的是采购申请还是资产申购），要来回切两个页面翻，还经常翻不到已归档的那条。
 * 所以这一页只做一件事：**把两边合并成一张可筛的历史台账**。
 *
 * ## 数据怎么取（不新增后端接口）
 *
 * `/api/purchase/list` 本身不带 `orderTypes` / `statuses` 时就是「全量」，
 * 所以这里只把**时间范围**交给服务端（`startDate/endDate` 打在 request_date 上，
 * 这是后端唯一支持的范围过滤），再把窗口内的数据按 200 一页拉全。
 * 为什么剩下的筛选放在本地：提出人、规格型号后端没有对应参数，
 * 若只把「物料/关键字」交给服务端、其余本地筛，用户会遇到「两个筛选器互相打架」
 * —— 服务端先砍掉一半，本地再砍，结果对不上直觉。窗口内总量是几百条量级，
 * 一次拉回来本地筛，改任何条件都是**立刻**出结果，没有转圈，也不会出现
 * 「明明填了条件却查不到」的解释成本。
 *
 * ## 安全边界
 *
 * 后端 `/api/purchase/**` 整组限 admin，这一页的 `meta.perm` 也是 `ADMIN_PERM`，
 * 与看板、费用申请同口径；详情抽屉以 `:can-edit="false"` 打开（只有查看，没有保存/删除），
 * 溯源页不应该顺手变成编辑页。
 */

/** 每页拉多少（后端 MAX_PAGE_SIZE = 200，超了会被截断，这里不要写更大） */
const PAGE_SIZE = 200
/** 拉全量的硬上限：窗口内超过这么多条就不硬拉了，页面底部会明说 */
const MAX_ROWS = 2000

const STATUS_OPTIONS = [
  { key: 'PENDING_OA', label: '待提单' },
  { key: 'WAITING', label: '等货' },
  { key: 'DUE_SOON', label: '临期' },
  { key: 'OVERDUE', label: '超期' },
  { key: 'PARTIAL', label: '部分到货' },
  { key: 'ARRIVED', label: '已到货' },
]

const TYPE_OPTIONS = [
  { key: 'CGSQ', label: '采购申请' },
  { key: 'ZCSG', label: '资产申购' },
  { key: 'FWCGSQ', label: '服务采购' },
]

const STATUS_TEXT = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.key, s.label]))
const TYPE_TEXT = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.key, t.label]))

function statusTone(status) {
  switch (status) {
    case 'OVERDUE':
      return STATUS_TONE.error
    case 'DUE_SOON':
      return STATUS_TONE.warning
    case 'ARRIVED':
      return STATUS_TONE.success
    case 'PARTIAL':
      return STATUS_TONE.info
    default:
      return STATUS_TONE.neutral
  }
}

function todayIso(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/* ─────────── 筛选状态 ─────────── */

const startDate = ref(todayIso(-89))
const endDate = ref(todayIso())
const typeFilter = ref('')
const requesterFilter = ref('')
const materialFilter = ref('')
const specFilter = ref('')
/** 多选状态：空数组 = 全部 */
const statusFilter = ref([])

/* ─────────── 数据 ─────────── */

const rows = ref([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
/** 窗口内条数超过 MAX_ROWS 时为真（只拉了前 MAX_ROWS 条） */
const truncated = ref(false)

const pageNum = ref(1)
const pageSize = ref(50)

function normalize(row) {
  const day = String(row.requestDate || '').slice(0, 10)
  return {
    ...row,
    _type: effectiveOrderType(row),
    _day: day,
    _qty: quantityText(row),
    _requester: String(row.requester || '').trim(),
    _material: String(row.materialName || '').trim(),
    _code: String(row.materialCode || '').trim(),
    _spec: String(row.spec || '').trim(),
    _purpose: String(row.purpose || '').trim(),
    _status: String(row.status || '').trim(),
  }
}

async function loadAll() {
  loading.value = true
  error.value = ''
  truncated.value = false
  const collected = []
  let fetchedTotal = 0
  try {
    for (let page = 1; page <= Math.ceil(MAX_ROWS / PAGE_SIZE); page += 1) {
      const res = await request.get('/api/purchase/list', {
        params: {
          pageNum: page,
          pageSize: PAGE_SIZE,
          startDate: startDate.value || undefined,
          endDate: endDate.value || undefined,
        },
      })
      const list = res?.data?.dataList ?? []
      fetchedTotal = Number(res?.data?.total ?? 0)
      collected.push(...list)
      if (!list.length || collected.length >= fetchedTotal) break
    }
    rows.value = collected.slice(0, MAX_ROWS).map(normalize)
    total.value = fetchedTotal
    truncated.value = fetchedTotal > rows.value.length
    pageNum.value = 1
  } catch (e) {
    error.value =
      e?.response?.data?.message || e?.message || '加载失败，请稍后重试。'
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/* 时间换了才回服务端；其余筛选都在本地算，改一个字就出结果 */
watch([startDate, endDate], () => loadAll())

onMounted(loadAll)

/* ─────────── 本地筛选 ─────────── */

/** 提出人下拉：从窗口内数据里取，按出现次数排序（谁提得多谁在前） */
const requesterOptions = computed(() => {
  const counter = new Map()
  for (const r of rows.value) {
    if (!r._requester) continue
    counter.set(r._requester, (counter.get(r._requester) || 0) + 1)
  }
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([name, count]) => ({ name, count }))
})

function includes(haystack, needle) {
  return String(haystack || '').toLowerCase().includes(needle.toLowerCase())
}

const filtered = computed(() => {
  const mat = materialFilter.value.trim()
  const spec = specFilter.value.trim()
  const req = requesterFilter.value
  const type = typeFilter.value
  const statuses = statusFilter.value
  return rows.value.filter((r) => {
    if (type && r._type !== type) return false
    if (req && r._requester !== req) return false
    if (statuses.length && !statuses.includes(r._status)) return false
    if (mat && !includes(r._material, mat) && !includes(r._code, mat)) return false
    if (spec && !includes(r._spec, spec)) return false
    return true
  })
})

const pageRows = computed(() => {
  const start = (pageNum.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch([filtered, pageSize], () => {
  const maxPage = Math.max(1, Math.ceil(filtered.value.length / pageSize.value))
  if (pageNum.value > maxPage) pageNum.value = maxPage
})

const hasFilter = computed(
  () =>
    Boolean(typeFilter.value) ||
    Boolean(requesterFilter.value) ||
    Boolean(materialFilter.value.trim()) ||
    Boolean(specFilter.value.trim()) ||
    statusFilter.value.length > 0,
)

function toggleStatus(key) {
  const i = statusFilter.value.indexOf(key)
  if (i === -1) statusFilter.value = [...statusFilter.value, key]
  else statusFilter.value = statusFilter.value.filter((s) => s !== key)
}

function resetFilters() {
  typeFilter.value = ''
  requesterFilter.value = ''
  materialFilter.value = ''
  specFilter.value = ''
  statusFilter.value = []
}

function applyRange(days) {
  startDate.value = todayIso(-(days - 1))
  endDate.value = todayIso()
}

/* ─────────── 溯源：打开只读单据 ─────────── */

const drawerOpen = ref(false)
const drawerRow = ref(null)

function openDetail(row) {
  drawerRow.value = row
  drawerOpen.value = true
}
</script>

<template>
  <div class="flex h-full flex-col">
    <section class="flex min-h-0 flex-1 flex-col rounded-card bg-raised">
      <!-- 第一行：时间窗口 + 条数。时间换一次才回服务端，所以放最左、最显眼 -->
      <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-4">
        <span class="shrink-0 text-xs text-slate-500">提出日期</span>
        <el-date-picker
          v-model="startDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="起始"
          aria-label="起始日期"
          :first-day-of-week="1"
          class="!w-[132px]"
        />
        <span class="shrink-0 text-sm text-slate-500">至</span>
        <el-date-picker
          v-model="endDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="结束"
          aria-label="结束日期"
          :first-day-of-week="1"
          class="!w-[132px]"
        />
        <button type="button" class="quick-btn" @click="applyRange(30)">近 30 天</button>
        <button type="button" class="quick-btn" @click="applyRange(90)">近 90 天</button>
        <button type="button" class="quick-btn" @click="applyRange(365)">近一年</button>

        <span class="ml-auto text-sm text-slate-500">
          共 <span class="font-semibold text-slate-900">{{ total }}</span> 条
          <template v-if="hasFilter">
            · 筛出 <span class="font-semibold text-slate-900">{{ filtered.length }}</span> 条
          </template>
        </span>
      </div>

      <!-- 第二行：条件。类型/提出人/状态都是点选，物料与规格是打字 -->
      <div class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 px-6 pb-3 pt-2">
        <el-select
          v-model="typeFilter"
          placeholder="采购类型"
          clearable
          class="!w-[132px]"
          aria-label="采购类型"
        >
          <el-option label="全部类型" value="" />
          <el-option
            v-for="t in TYPE_OPTIONS"
            :key="t.key"
            :label="t.label"
            :value="t.key"
          />
        </el-select>

        <el-select
          v-model="requesterFilter"
          placeholder="提出人"
          clearable
          filterable
          class="!w-[124px]"
          aria-label="提出人"
        >
          <el-option label="全部提出人" value="" />
          <el-option
            v-for="p in requesterOptions"
            :key="p.name"
            :label="`${p.name}（${p.count}）`"
            :value="p.name"
          />
        </el-select>

        <el-input
          v-model="materialFilter"
          placeholder="物料名称 / 编码"
          clearable
          class="!w-[188px]"
          aria-label="物料名称或编码"
        />
        <el-input
          v-model="specFilter"
          placeholder="规格型号"
          clearable
          class="!w-[168px]"
          aria-label="规格型号"
        />

        <div class="flex items-center gap-1.5">
          <button
            v-for="s in STATUS_OPTIONS"
            :key="s.key"
            type="button"
            class="chip"
            :class="{ 'is-on': statusFilter.includes(s.key) }"
            @click="toggleStatus(s.key)"
          >
            {{ s.label }}
          </button>
        </div>

        <button
          v-if="hasFilter"
          type="button"
          class="ml-1 text-xs text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline"
          @click="resetFilters"
        >
          清空条件
        </button>
      </div>

      <div class="relative flex min-h-0 flex-1 flex-col">
        <LoadingMask v-if="loading" />

        <PanelState
          v-else-if="error"
          type="error"
          title="暂时无法获取历史记录"
          :description="error"
          action-text="重新加载"
          @action="loadAll"
        />

        <PanelState
          v-else-if="!filtered.length"
          :title="rows.length ? '没有符合条件的记录' : '这段时间里没有采购记录'"
          :description="
            rows.length
              ? '换个条件试试，或点「清空条件」看全部。'
              : '把时间范围放宽一些，或去采购看板 / 费用申请新增一条。'
          "
        />

        <template v-else>
          <div class="min-h-0 flex-1 overflow-auto">
            <table class="ledger-table w-full text-[13px]">
              <colgroup>
                <col style="width: 76px" />
                <col style="width: 92px" />
                <col style="width: 96px" />
                <col />
                <col style="width: 112px" />
                <col style="width: 220px" />
                <col style="width: 104px" />
                <col style="width: 84px" />
                <col style="width: 100px" />
                <col style="width: 88px" />
                <col style="width: 152px" />
              </colgroup>
              <thead>
                <tr>
                  <th class="text-left">状态</th>
                  <th class="text-left">提出</th>
                  <th class="text-left">采购类型</th>
                  <th class="text-left">物料名称</th>
                  <th class="text-left">物料编码</th>
                  <th class="text-left">规格型号</th>
                  <th class="text-left">用途</th>
                  <th class="text-right">数量</th>
                  <th class="text-left">要求到货</th>
                  <th class="text-left">需求人</th>
                  <th class="text-left">单据</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in pageRows"
                  :key="row.id"
                  tabindex="0"
                  class="cursor-pointer transition-colors hover:bg-region focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-ink"
                  @click="openDetail(row)"
                  @keydown.enter.self="openDetail(row)"
                  @keydown.space.self.prevent="openDetail(row)"
                >
                  <td>
                    <span class="status-pill" :class="statusTone(row._status)">
                      {{ STATUS_TEXT[row._status] || '—' }}
                    </span>
                  </td>
                  <td class="tabular-nums text-slate-600">{{ row._day || '—' }}</td>
                  <td class="text-slate-600">{{ TYPE_TEXT[row._type] || '采购申请' }}</td>
                  <td class="cell-name" :title="row._material">{{ row._material || '—' }}</td>
                  <td class="tabular-nums text-slate-600">{{ row._code || '—' }}</td>
                  <td class="cell-spec" :title="row._spec">{{ row._spec || '—' }}</td>
                  <td class="cell-purpose" :title="row._purpose">
                    {{ row._purpose || '—' }}
                  </td>
                  <td class="tabular-nums text-right text-slate-700">{{ row._qty }}</td>
                  <td
                    class="tabular-nums"
                    :class="row._status === 'OVERDUE' ? 'text-rose-600' : 'text-slate-600'"
                  >
                    {{ row.requiredArrivalDate || '—' }}
                  </td>
                  <td class="text-slate-600">{{ row._requester || '—' }}</td>
                  <td class="text-slate-600">
                    <span v-if="row.oaNo" class="tabular-nums">{{ row.oaNo }}</span>
                    <span v-else class="text-slate-500">无 OA 单号</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            class="flex shrink-0 flex-wrap items-center gap-3 px-6 py-3 text-xs text-slate-500"
          >
            <span>
              点任意一行可打开这张单的完整明细（只读）
              <template v-if="truncated">
                · 这段时间超过 {{ rows.length }} 条，只显示前 {{ rows.length }} 条，缩小范围更准
              </template>
            </span>
            <el-pagination
              v-model:current-page="pageNum"
              v-model:page-size="pageSize"
              class="ml-auto"
              :total="filtered.length"
              :page-sizes="[20, 50, 100]"
              layout="sizes, prev, pager, next"
              size="small"
              background
            />
          </div>
        </template>
      </div>
    </section>

    <PurchaseDetailDrawer
      v-model="drawerOpen"
      mode="edit"
      :row="drawerRow"
      :can-edit="false"
    />
  </div>
</template>

<style scoped>
/* 筛选胶囊与表格材质都复用既有 token：这一页不新造配色，
   只补两个 `.ledger-table` 里没有的小件（快捷按钮 / 状态胶囊 / 省略单元格）。 */

.quick-btn {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(16, 24, 40, 0.1);
  background: transparent;
  font-size: 12px;
  color: rgb(71 85 105);
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}
.quick-btn:hover {
  background: rgba(16, 24, 40, 0.04);
  color: rgb(15 23 42);
}

.chip {
  flex-shrink: 0;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid rgba(16, 24, 40, 0.1);
  background: transparent;
  font-size: 12px;
  color: rgb(100 116 139);
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}
.chip:hover {
  border-color: rgba(16, 24, 40, 0.2);
  color: rgb(15 23 42);
}
.chip.is-on {
  border-color: rgba(16, 24, 40, 0.72);
  background: rgba(16, 24, 40, 0.72);
  color: #fff;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11.5px;
  line-height: 18px;
  white-space: nowrap;
}

/* 规格型号是长句（法兰参数几十个字），一行截断 + 原生 title 看全文；
   不换行是为了让 44px 行高稳住，长表里一行变两行会立刻失去节奏 */
.cell-spec,
.cell-purpose,
.cell-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-name {
  font-weight: 500;
  color: rgb(15 23 42);
}
.cell-spec,
.cell-purpose {
  color: rgb(100 116 139);
}
</style>
