<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '../../api/request'
import { hasPerm } from '../../api/auth'
import PurchaseCard from './PurchaseCard.vue'
import PurchaseDetailDrawer from './PurchaseDetailDrawer.vue'
import {
  BOARD_COLUMNS,
  EXPENSE_ORDER_TYPES,
  OPEN_STATUSES,
  groupBoardByOa,
  groupExpenseBoardByOa,
  needsAcceptance,
} from './boardGroups.js'
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

/*
 * `scope`：这一个看板管哪一批单据（2026-11-10，变更-182）。
 *
 *   purchase 采购看板 → 四列（待提单/等货/超期/已到货），默认只看未到货
 *   expense  费用申请 → 三列（待提单/待验收/已验收），没有"超期"，全量拉（要看到已验收）
 *
 * 两个页签共用这一个组件：列定义、请求口径、开关显隐都按 scope 分叉，
 * 而不是复制一份文件 —— 复制之后"改一处忘一处"是必然的。
 */
const props = defineProps({
  scope: { type: String, default: 'purchase' },
})

const isExpense = computed(() => props.scope === 'expense')

const rows = ref([])
const loading = ref(false)
const loadError = ref('')
const showArrived = ref(false)
/* 只看待验收（2026-11-10）：使用方说看板上"待验收"看不见 */
const onlyToAccept = ref(false)

const canEdit = computed(() => hasPerm('purchase:edit'))

/** 请求序号护栏：连点"刷新"时，过期响应整段丢弃（与录入页同一套） */
let seq = 0

async function loadBoard() {
  const mine = ++seq
  loading.value = true
  loadError.value = ''
  try {
    const params = { pageNum: 1, pageSize: 200 }
    if (isExpense.value) {
      // 费用申请：只拉这两类单据，且**不按状态筛** —— 已验收列要的正是"已到货/已办完"的行
      params.orderTypes = EXPENSE_ORDER_TYPES.join(',')
    } else if (!showArrived.value) {
      // 采购看板默认只看未到货；勾了"显示已到货"就不带 statuses（= 不限）
      params.statuses = OPEN_STATUSES.join(',')
    }
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

// 按 **OA 单号** 合并成卡片（变更-168）：一个 OA 通常就是一批采购，含多条物料。
// 卡片归哪一列由组内**最急**那条的状态决定，见 boardGroups.groupBoardByOa。
/** 当前数据里"已到货但没录验收单"的条数（含 OA 合并前的明细行） */
const toAcceptCount = computed(() => rows.value.filter((r) => needsAcceptance(r)).length)

/** 看板渲染用的行：开了"只看待验收"就只留待验收的 */
const boardRows = computed(() =>
  onlyToAccept.value ? rows.value.filter((r) => needsAcceptance(r)) : rows.value,
)

/** 费用申请的三列 + 30 天窗口外的条数（纯函数在 boardGroups 里，单测钉住口径） */
const expenseGroups = computed(() => groupExpenseBoardByOa(rows.value))
const columns = computed(() =>
  isExpense.value ? expenseGroups.value.columns : groupBoardByOa(boardRows.value),
)

/**
 * 关掉「显示已到货」时，已到货那一列**永远为空**（那些状态根本没请求）——
 * 留一个空列白占 1/4 宽度是纯浪费，所以它跟着开关一起消失。
 */
const visibleColumns = computed(() => {
  if (isExpense.value) return columns.value
  return showArrived.value ? columns.value : columns.value.filter((c) => c.key !== 'arrived')
})
const totalShown = computed(() => rows.value.length)

/** 费用申请：已验收里更早的条数（界面底部提示，别让人以为记录丢了） */
const staleAccepted = computed(() => (isExpense.value ? expenseGroups.value.staleCount : 0))

/** 栅格列数跟着可见列走：3 列时用 xl:grid-cols-3，4 列时才用 4 */
const gridClass = computed(() => {
  const n = visibleColumns.value.length
  if (n <= 1) return 'grid-cols-1'
  if (n === 2) return 'grid-cols-1 md:grid-cols-2'
  if (n === 3) return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
  return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
})

/**
 * 切换「待验收」筛选（2026-11-10）。
 *
 * 待验收 = 已到货但没录验收单，而已到货的行默认**不请求** ——
 * 所以开过滤时要顺带把"显示已到货"打开并重新拉数，否则永远 0 条。
 */
function toggleToAccept() {
  onlyToAccept.value = !onlyToAccept.value
  if (onlyToAccept.value && !showArrived.value) {
    showArrived.value = true
    loadBoard()
  }
}

function toggleArrived() {
  showArrived.value = !showArrived.value
  loadBoard()
}

// ===== 抽屉（点卡片直接进入编辑，与录入页共用同一个组件）=====
const drawerOpen = ref(false)
const drawerMode = ref('edit')
const drawerRow = ref(null)
/** 「在一张已有的 OA 单下补一条」的预填值（票据视图 → 再加一条需求） */
const drawerSeed = ref(null)
const drawerMessage = ref('')

function openCard(row) {
  drawerMode.value = 'edit'
  drawerRow.value = row
  drawerMessage.value = ''
  drawerOpen.value = true
}

/**
 * 从看板直接新增一条（2026-11-10）。
 *
 * 抽屉本来就支持 create（与录入页共用），这里只是给它一个入口 —— 以前想新建
 * 只能去「采购录入」，所以看板上「看」和「填」是断开的：看到缺料，还得换页。
 */
function openCreate() {
  drawerMode.value = 'create'
  drawerRow.value = null
  drawerSeed.value = null
  drawerMessage.value = ''
  drawerOpen.value = true
}

/**
 * 在弹出单据里点「再加一条需求」（2026-11-10，变更-181）。
 *
 * 抽屉自己会开表单，这里只切 mode + 记预填值；不关弹窗、不清 row ——
 * 人是从这张单上点出来的，关掉再开就丢了上下文。
 */
function handleAddLine(seed) {
  drawerSeed.value = seed || null
  drawerMode.value = 'create'
  drawerMessage.value = ''
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
  /*
   * 删除确认（2026-11-10）。原来这里**没有**二次确认 —— 抽屉里点一下红色按钮
   * 就直接物理删除了（后端是 deleteById，连送货单图片一起删，没有回收站）。
   * 文案带上单号与物料名：删除是不可恢复的，至少让人在按下去之前看清楚删的是哪条。
   */
  const label = row.oaNo ? `${row.oaNo} · ${row.materialName}` : row.materialName
  try {
    await ElMessageBox.confirm(
      `删除「${label}」？删除后不可恢复，送货单图片也会一起删掉。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return // 点了取消/关闭：什么都不做
  }
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
        <template v-if="isExpense">
          共 <span class="font-semibold tabular-nums text-slate-900">{{ totalShown }}</span> 条
          <span class="text-slate-500">（{{ columns.map((c) => c.label).join(' / ') }}）</span>
        </template>
        <template v-else>
          共 <span class="font-semibold tabular-nums text-slate-900">{{ totalShown }}</span> 条待处理
          <span class="text-slate-500">（{{ BOARD_COLUMNS.map((c) => c.label).join(' / ') }}）</span>
        </template>
      </p>

      <!-- 待验收胶囊：点一下只看已到货但还没录验收单的卡片（费用申请自带"待验收"列，不需要） -->
      <button
        v-if="!isExpense"
        type="button"
        class="rounded-md border px-2.5 py-1 text-xs transition-colors"
        :class="onlyToAccept ? 'border-transparent bg-brand-ink text-white' : 'border-line bg-raised text-slate-700 hover:border-slate-400'"
        :aria-pressed="onlyToAccept"
        @click="toggleToAccept"
      >
        待验收 <span class="tabular-nums">{{ toAcceptCount }}</span>
      </button>

      <label
        v-if="!isExpense"
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

      <!-- 新增：从看板直接开一张空抽屉（2026-11-10）。没有 purchase:edit 的人看不到 -->
      <button
        v-if="canEdit"
        type="button"
        class="rounded-md bg-brand-ink px-3 py-1 text-xs font-medium text-white transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-1 focus-visible:outline-none"
        @click="openCreate"
      >
        ＋ 新增需求
      </button>

      <!-- 页签就在上面，不用再教人去哪个页面（2026-11-10 并页后简化） -->
      <span v-if="!isExpense && !showArrived" class="text-xs text-slate-500">默认只看未到货</span>

      <!-- 费用申请：已验收只展开近 30 天，更早的给一句交代，别让人以为记录丢了 -->
      <span v-if="isExpense && staleAccepted" class="text-xs text-slate-500">
        另有 {{ staleAccepted }} 条更早的已验收，去「录入 / 历史」看
      </span>
    </div>

    <p
      v-if="loadError"
      class="mb-3 shrink-0 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
    >
      {{ loadError }}
    </p>

    <!-- 四列：列内自己滚，页面不滚（与汇总页的定高方子一致） -->
    <div class="grid min-h-0 flex-1 gap-3" :class="gridClass">
      <section
        v-for="col in visibleColumns"
        :key="col.key"
        class="flex min-h-0 flex-col rounded-card border border-line bg-region/60"
        :aria-label="`${col.label}（${col.cardCount} 张卡，${col.rowCount} 条物料）`"
      >
        <!--
          列头（2026-11-02）：左侧 3px 状态色条 + 同色数量徽章。
          颜色只说明"这列卡在哪一步"，与设备看板同一套规则。
        -->
        <header
          class="flex shrink-0 items-center justify-between gap-2 px-3 py-2"
          :style="{ borderLeft: `3px solid ${col.color}` }"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-slate-900">{{ col.label }}</h3>
              <span
                class="rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                :style="{ color: col.color, backgroundColor: col.color + '14' }"
              >
                {{ col.cardCount }} 张 · {{ col.rowCount }} 条
              </span>
            </div>
            <p class="mt-0.5 truncate text-[11px] text-slate-500">{{ col.hint }}</p>
          </div>
        </header>

        <!--
          pt-2 是给**悬停阴影**留位置的（变更-166）。
          原来只有 px-2 pb-2：第一张卡贴着滚动容器上边缘，hover 的 shadow 与
          -translate-y 一起工作时，上边框会被容器裁掉/被阴影糊住 ——
          使用方看到的就是"鼠标放到第一张卡上，上边缘那条线被覆盖了"。
          顺手也去掉了 -translate-y-px：位移会把上边框推上去和列头叠在一起。
        -->
        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2 pt-2">
          <PurchaseCard
            v-for="card in col.cards"
            :key="card.key"
            :card="card"
            :color="col.color"
            :show-due="!isExpense"
            @open="openCard(card.lead)"
            @open-row="openCard($event)"
          />

          <p
            v-if="!col.cards.length"
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
      :seed="drawerSeed"
      :default-order-type="isExpense ? 'ZCSG' : 'CGSQ'"
      :can-edit="canEdit"
      :saving="saving"
      :error-message="drawerMessage"
      @save="handleSave"
      @delete="handleDelete"
      @add-line="handleAddLine"
    />
  </div>
</template>
