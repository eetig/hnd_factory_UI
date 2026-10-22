<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import request from '../../api/request'
import { hasPerm } from '../../api/auth'
import PurchaseCard from './PurchaseCard.vue'
import PurchaseDetailDrawer from './PurchaseDetailDrawer.vue'
import { BOARD_COLUMNS, OPEN_STATUSES, groupBoard } from './boardGroups.js'
import { savePurchase, deletePurchase, usePurchaseTracking } from '../../composables/usePurchaseTracking.js'

/*
 * `saving` 是 composable **返回对象里**的 ref，不是模块级具名导出 —— 不能
 * `import { saving }`（vitest 会放过，rollup 构建会直接报 "not exported"）。
 * 用 composable 取出来，抽屉的 loading 与录入页共享同一份状态。
 */
const { saving } = usePurchaseTracking()

/*
 * 采购看板（变更-148，2026-10-22）。
 *
 * ## 为什么要它
 *
 * 使用方对录入页的评价是「录入效果确实很好，但是用户体验观感不好」——
 * 那张表 10 列、规格型号折行把行高撑得忽高忽低，**读**起来累。
 * 所以录入页原样保留（它擅长填），另建这一页专门用来**看**：
 * 四列看板，每张卡只放"要判断要不要催"的五条信息。
 *
 * ## 三条硬约束（都写在代码里，别让下一个人推翻）
 *
 * 1. **不能拖拽改状态**：状态是后端按 OA 单号 / 送货单 / 距到货天数派生的，
 *    库里没有状态列。拖过去没有字段可写。推进一张卡的正确动作是点开抽屉填 OA、上传送货单。
 * 2. **一次只拉 200 条**（后端 `MAX_PAGE_SIZE` 的硬上限）。看板的定位是
 *    "今天要处理的未到货清单"，不是历史流水 —— 所以默认只请求未到货的四个状态，
 *    要翻历史请用录入页的筛选。
 * 3. **计数来自当前渲染**（列头数字 = 这一列实际有几张卡），
 *    不再单独请求 summary —— 两个数字对不上（一个含已到货、一个不含）比没有数字更糟。
 */

const rows = ref([])
const loading = ref(false)
const loadError = ref('')
const showArrived = ref(false)

const canEdit = computed(() => hasPerm('purchase:edit'))

/** 请求序号护栏：连点"刷新"时，过期响应整段丢弃（与录入页同一套） */
let seq = 0

async function loadBoard() {
  const mine = ++seq
  loading.value = true
  loadError.value = ''
  try {
    const params = { pageNum: 1, pageSize: 200 }
    // 默认只看未到货；勾了"显示已到货"就不带 statuses（= 不限）
    if (!showArrived.value) params.statuses = OPEN_STATUSES.join(',')
    const res = await request.get('/api/purchase/list', { params })
    if (mine !== seq) return
    if (res.data?.success === false) {
      rows.value = []
      loadError.value = res.data?.msg || '看板数据加载失败'
      return
    }
    rows.value = Array.isArray(res.data?.dataList) ? res.data.dataList : []
  } catch (e) {
    if (mine !== seq) return
    rows.value = []
    loadError.value = e?.response?.data?.msg || e?.message || '看板数据加载失败'
  } finally {
    if (mine === seq) loading.value = false
  }
}

const columns = computed(() => groupBoard(rows.value))
const totalShown = computed(() => rows.value.length)

function toggleArrived() {
  showArrived.value = !showArrived.value
  loadBoard()
}

// ===== 抽屉（点卡片直接进入编辑，与录入页共用同一个组件）=====
const drawerOpen = ref(false)
const drawerMode = ref('edit')
const drawerRow = ref(null)
const drawerMessage = ref('')

function openCard(row) {
  drawerMode.value = 'edit'
  drawerRow.value = row
  drawerMessage.value = ''
  drawerOpen.value = true
}

async function handleSave(payload) {
  // 必填口径与录入页一致（界面先拦一次，后端拦住才是真的拦住）
  if (!payload.requester?.trim()) return feedback('需求人不能为空')
  if (!payload.materialName?.trim()) return feedback('物料名称不能为空')
  try {
    await savePurchase(payload)
    drawerOpen.value = false
    drawerRow.value = null
    drawerMessage.value = ''
    ElMessage.success('已保存')
    await loadBoard()
  } catch (e) {
    drawerMessage.value = `保存失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(drawerMessage.value)
  }
}

async function handleDelete(row) {
  try {
    await deletePurchase(row.id)
    drawerOpen.value = false
    drawerRow.value = null
    ElMessage.success('已删除')
    await loadBoard()
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || '删除失败')
  }
}

function feedback(msg) {
  drawerMessage.value = msg
  ElMessage.error(msg)
}

onMounted(loadBoard)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- 顶部：说明 + 开关 + 刷新。刻意**不做**筛选条：看板是"今天要处理什么"，
         条件越多越看不见东西；要筛就去录入页。 -->
    <div class="mb-3 flex shrink-0 flex-wrap items-center gap-3">
      <p class="text-sm text-slate-600">
        共 <span class="font-semibold tabular-nums text-slate-900">{{ totalShown }}</span> 条待处理
        <span class="text-slate-500">（{{ BOARD_COLUMNS.map((c) => c.label).join(' / ') }}）</span>
      </p>

      <label
        class="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1 text-xs text-slate-700"
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-brand"
          :checked="showArrived"
          @change="toggleArrived"
        />
        显示已到货
      </label>

      <button
        type="button"
        class="rounded-md border border-line bg-raised px-2.5 py-1 text-xs text-slate-700 transition hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
        :disabled="loading"
        @click="loadBoard"
      >
        {{ loading ? '刷新中…' : '刷新' }}
      </button>

      <span v-if="!showArrived" class="text-xs text-slate-500">
        默认只看未到货；历史记录请到「采购录入」
      </span>
    </div>

    <p
      v-if="loadError"
      class="mb-3 shrink-0 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
    >
      {{ loadError }}
    </p>

    <!-- 四列：列内自己滚，页面不滚（与汇总页的定高方子一致） -->
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <section
        v-for="col in columns"
        :key="col.key"
        class="flex min-h-0 flex-col rounded-card border border-line bg-region/40"
        :aria-label="`${col.label}（${col.rows.length} 条）`"
      >
        <header class="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-slate-900">
              {{ col.label }}
              <span class="ml-1 font-normal tabular-nums text-slate-500">{{ col.rows.length }}</span>
            </h3>
            <p class="truncate text-[11px] text-slate-500">{{ col.hint }}</p>
          </div>
        </header>

        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
          <PurchaseCard
            v-for="row in col.rows"
            :key="row.id"
            :row="row"
            @click="openCard(row)"
          />

          <p
            v-if="!col.rows.length"
            class="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-slate-500"
          >
            {{ loading ? '加载中…' : '这一列是空的' }}
          </p>
        </div>
      </section>
    </div>

    <PurchaseDetailDrawer
      v-model="drawerOpen"
      :mode="drawerMode"
      :row="drawerRow"
      :can-edit="canEdit"
      :saving="saving"
      :error-message="drawerMessage"
      @save="handleSave"
      @delete="handleDelete"
    />
  </div>
</template>
