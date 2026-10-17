<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  ElAutocomplete,
  ElButton,
  ElDatePicker,
  ElImage,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
} from 'element-plus'
import { hasPerm } from '../api/auth'
import { STATUS_ROW_TONE, STATUS_TONE } from '../constants/statusTones'
import { useLiveQuery } from '../composables/useLiveQuery'
import { useMaterialLookup } from '../composables/useMaterialLookup'
import {
  isStoredImage,
  storedImageThumb,
  usePurchaseTracking,
} from '../composables/usePurchaseTracking'
import DeliveryNoteUpload from './DeliveryNoteUpload.vue'

/**
 * 采购需求详情（原名「采购进度跟踪」，变更-091，2026-10-16；变更-092 改成表内录入；
 * 变更-096 加进度字段与汇总栏；变更-097 改名并挪到「数据统计」组）。
 *
 * 使用方原话：「PC端就不用这种卡片式，直接在行上面添加，物料名称可以搜索，实时搜索的形式，
 * 物料编码自动带出，也可以根据物料编码搜索，物料名称自动带出。」
 * ⇒ 去掉弹窗，改成**表格第一行直接填**（采购同事的心智就是 Excel：上面一行敲完就多一条），
 *   点某行的「编辑」时那一行**原地变成输入框**，不再跳弹窗。
 *
 * 物料两个框是 `el-autocomplete` 远程检索（`/api/stock/list`，见 useMaterialLookup）：
 * 打名称搜、打编码也搜，**选中**后互相带出（只是打字不互填 —— 否则半个名字会把编码冲掉）。
 *
 * 变更-096 加的进度能力（使用方：「要实时掌握它的进度，也要跟进，避免采购误了工期」）：
 *   · 顶部**汇总栏**（待提单 / 等货 / 临期 / 超期 / 已到货 / 部分到货），数字来自服务端聚合；
 *   · 行首**状态标签**，超期标红、临期标黄；口径由后端算好，前端只上色；
 *   · 新增 类别 / 数量+单位 / 实际到货日期 / 实际到货数量。
 *
 * ⚠️ 写操作按权限位 `purchase:edit` 显隐。**查询原先对所有人开放，变更-096 起收紧为仅 admin**
 * （后端 `SaTokenConfigure` 的 ADMIN_READ_PATTERNS 里有 /api/purchase/**）——
 * 界面和后端两层都要在：只藏前端 = 数据仍然公开。
 */
const {
  rows,
  total,
  summary,
  loading,
  saving,
  loadError,
  pageNum,
  pageSize,
  keyword,
  rangeStart,
  rangeEnd,
  statusFilter,
  categoryFilter,
  loadPurchase,
  loadPurchasePage,
  applyPurchaseFilters,
  setPurchasePageSize,
  savePurchase,
  deletePurchase,
} = usePurchaseTracking()

const { fetchMaterialSuggestions, cancelMaterialSearch } = useMaterialLookup()

// 关键字边打边查（防抖 + 查询签名去重 + 卸载撤销，公共接线见 useLiveQuery）；
// 回车 / 清空 = 显式意图，立刻发。日期区间是离散动作，直接 @change 触发。
const { flush: flushPurchaseQuery } = useLiveQuery(keyword, applyPurchaseFilters)

const canEdit = computed(() => hasPerm('purchase:edit'))

/** 新增行（表格第一行）的草稿。空着的字段就按"没有"处理 */
const draft = reactive({})
/** 正在原地编辑的那一行的草稿；null = 没有行在编辑 */
const edit = ref(null)
const message = ref('')

/** 类别枚举（与后端约定一致；统计时这是第一个会切的维度） */
const CATEGORY_OPTIONS = ['备件', '五金', '原料', '设备', '其他']

/**
 * 常见单位候选（`allow-create` 允许自己敲）：
 * 固定清单会挡住"公斤/桶/卷"这类，自由输入又会写成 个/只/件 三种并存 —— 折中成"给常用值、也能自填"。
 */
const UNIT_OPTIONS = ['个', '台', '套', '件', '只', '米', '公斤', '桶', '卷', '张']

function blankDraft() {
  return {
    requester: '',
    requestDate: '',
    materialName: '',
    materialCode: '',
    spec: '',
    purpose: '',
    category: '',
    quantity: '',
    unit: '',
    requiredArrivalDate: '',
    oaNo: '',
    deliveryNote: '',
    receivedQuantity: '',
    actualArrivalDate: '',
    remark: '',
  }
}

/**
 * 可编辑单元格的字段表 —— 新增行与编辑行共用一份，避免两处各写十几个 <td> 而慢慢写歪。
 *
 * kind 决定用哪个控件：text=input、date=el-date-picker、select=el-select、
 * materialName/materialCode=el-autocomplete、image=上传控件、
 * quantity=**一格两个控件**（数量 + 单位，因为它们分开填没意义、合起来又只是两列文字）。
 * **顺序与表头一一对应**（状态列是派生值，不在本表里，单独渲染）。
 */
const EDIT_FIELDS = [
  { key: 'requester', kind: 'text', placeholder: '需求人', aria: '需求人' },
  { key: 'requestDate', kind: 'date', aria: '提出需求日期' },
  { key: 'materialName', kind: 'materialName', placeholder: '打字搜物料名称', aria: '物料名称' },
  { key: 'materialCode', kind: 'materialCode', placeholder: '打字搜物料编码', aria: '物料编码' },
  { key: 'spec', kind: 'text', placeholder: '规格型号', aria: '规格型号' },
  { key: 'purpose', kind: 'text', placeholder: '用途（这料拿去干嘛）', aria: '用途' },
  { key: 'category', kind: 'select', aria: '类别' },
  { key: 'quantity', kind: 'quantity', aria: '数量与单位' },
  { key: 'requiredArrivalDate', kind: 'date', aria: '要求到货日期' },
  { key: 'oaNo', kind: 'text', placeholder: 'OA 单号', aria: 'OA 单号' },
  // 送货单是一张图片（变更-094，使用方：「送货单是一张图片」）—— 不再是文本框，
  // 换成上传控件（选图即传、显示缩略图、可重传/删除）。
  { key: 'deliveryNote', kind: 'image', aria: '送货单图片' },
  { key: 'actualArrivalDate', kind: 'date', aria: '实际到货日期' },
  { key: 'remark', kind: 'text', placeholder: '备注', aria: '备注' },
]

/**
 * 「全到」：把到货数量填成需求数量、到货日期填成今天。
 *
 * 为什么给这个按钮：变更-096 的「部分到货」判断要求两个数量都在。
 * 多数情况是一次到齐，逼人手动抄一遍数字，最后一定是没人填 —— 那就永远判不出部分到货。
 */
function markAllDelivered(target) {
  const need = (target.quantity ?? '').toString().trim()
  if (!need) {
    ElMessage.warning('先填需求数量，才知道"全到"是多少')
    return
  }
  target.receivedQuantity = need
  target.actualArrivalDate = new Date().toISOString().slice(0, 10)
}

/**
 * 状态标签的配色。
 *
 * 只做**上色**，不判断状态 —— `row.status` 是后端算好的（口径唯一）。
 * 用的是 `constants/statusTones.js` 那张语义色表（error/warning/success/info/neutral），
 * 不自己写 Tailwind 色阶：那张表的每个组合都按 WCAG 算过对比度，
 * 手写 `bg-rose-50 text-rose-500` 这类会悄悄掉到 AA 以下（那个坑已经踩过一次）。
 */
function statusClass(status) {
  switch (status) {
    case 'OVERDUE':
      return STATUS_TONE.error
    case 'DUE_SOON':
      return STATUS_TONE.warning
    case 'ARRIVED':
      return STATUS_TONE.success
    case 'PARTIAL':
      return STATUS_TONE.info
    case 'PENDING_OA':
    case 'WAITING':
    default:
      return STATUS_TONE.neutral
  }
}

/**
 * 整行淡底（变更-097）。与 `statusClass` 一一对应，只是换成行级色档。
 *
 * 使用方要求「待提单/已到货/部分到货/超期各一种颜色，直观好看」。
 * 分寸：**底色只负责分区，精确含义交给同行的胶囊标签** —— 六种状态全上重色会变迷宫。
 * 「等货」是最常见的常态，故意不上色（白底），这样它的邻居一染色就跳出来了。
 */
function rowTone(status) {
  switch (status) {
    case 'OVERDUE':
      return STATUS_ROW_TONE.error
    case 'DUE_SOON':
      return STATUS_ROW_TONE.warning
    case 'ARRIVED':
      return STATUS_ROW_TONE.success
    case 'PARTIAL':
      return STATUS_ROW_TONE.info
    case 'PENDING_OA':
      return STATUS_ROW_TONE.neutral
    case 'WAITING':
    default:
      return ''
  }
}

/** 「3 个」；数量为空显示「—」（历史数据没有数量列） */
function quantityText(row) {
  const qty = row.quantity === null || row.quantity === undefined ? '' : String(row.quantity)
  if (!qty) {
    return '—'
  }
  return row.unit ? `${qty} ${row.unit}` : qty
}

/**
 * OA 的「按单号筛列表」地址前缀（变更-099）。
 *
 * ⚠️ 这是 OA（蓝凌 EKP）前端的 hash 路由，**不是我们的接口**：
 *    `#/j_path=%2FlistAll`（= /listAll）+ `mydoc=all` + `criteria=docNumber%3A<单号>`
 * 实测 2026-10-18：粘上单号就能筛出唯一那张单，再从列表点进表单。
 * 若哪天 OA 升级改了路由，只需要改这一个常量（不用动库、不用动后端）。
 * 域名同理：换环境改这里。
 */
const OA_SEARCH_BASE =
  'https://ekp.batf.cn/ssc/fee/#/j_path=%2FlistAll&mydoc=all&criteria=docNumber%3A'

/** 单号 → OA 筛选地址；单号里万一有 & # 这类字符也不会把 URL 拼坏 */
function oaSearchLink(oaNo) {
  const code = (oaNo ?? '').toString().trim()
  return code ? OA_SEARCH_BASE + encodeURIComponent(code) : ''
}

/**
 * 状态标签后面跟的「几天」（变更-097d）。
 *
 * 使用方原话：「进度下面的比如临期、超期之类的，要说明多少天」。
 * 只给两个状态补天数，因为只有这两个状态"差几天"才是行动信息：
 *   · 超期 → 已超 N 天
 *   · 临期 → 还剩 N 天（当天到期显示「今天」）
 * 等货还早、待提单还没提单、已到货已经结束 —— 给它们标天数是噪音。
 *
 * ⚠️ 天数来自后端（`overdueDays` / `daysToDue`），前端不自己算日期，
 * 免得和后端跨天的那一刻算出不同结果。
 */
function dayHint(row) {
  if (row.status === 'OVERDUE' && row.overdueDays) {
    return `${row.overdueDays}天`
  }
  if (row.status === 'DUE_SOON') {
    const days = row.daysToDue
    if (days === null || days === undefined) {
      return ''
    }
    return days === 0 ? '今天' : `${days}天`
  }
  return ''
}

/**
 * 汇总栏的按钮组：点数字＝按那个状态筛。
 *
 * 顺序按"最该先看的"排：超期 → 临期 → 待提单 → 等货 → 已到货 → 部分到货。
 * 「全部」放最前面当复位。数字全部来自服务端聚合，前端不做加减（见 composable 注释）。
 */
const statusChips = computed(() => [
  { value: '', label: '全部', count: summary.value.total },
  { value: 'OVERDUE', label: '超期', count: summary.value.overdue },
  { value: 'DUE_SOON', label: '临期', count: summary.value.dueSoon },
  { value: 'PENDING_OA', label: '待提单', count: summary.value.pendingOa },
  { value: 'WAITING', label: '等货', count: summary.value.waiting },
  { value: 'ARRIVED', label: '已到货', count: summary.value.arrived },
  { value: 'PARTIAL', label: '部分到货', count: summary.value.partial },
])

/** 点汇总按钮 = 设上状态筛选并回第 1 页重查（已选中的再点一次＝取消） */
function toggleStatusFilter(value) {
  statusFilter.value = statusFilter.value === value ? '' : value
  applyPurchaseFilters()
}

/**
 * 从下拉里选中一条物料后互相带出。
 *
 * · 选名字 → 带出编码；
 * · 选编码 → 带出名字（**主数据里没有名字时保持原样**，不要拿编码冒充名字 ——
 *   `/api/stock/list` 的注释写明名称可能为 null，那时显示编码只是显示层的兜底）；
 * · 规格只在**原本空着**时填，不覆盖人已经敲进去的内容。
 */
function pickMaterial(target, option, source) {
  if (!option) {
    return
  }
  if (source === 'name') {
    target.materialName = option.name || option.code
    target.materialCode = option.code
  } else {
    target.materialCode = option.code
    if (option.name) {
      target.materialName = option.name
    }
  }
  if (!target.spec) {
    target.spec = option.spec || ''
  }
}

function resetDraft() {
  Object.assign(draft, blankDraft())
  message.value = ''
}

function startEdit(row) {
  edit.value = {
    id: row.id,
    requester: row.requester ?? '',
    requestDate: row.requestDate ?? '',
    materialName: row.materialName ?? '',
    materialCode: row.materialCode ?? '',
    spec: row.spec ?? '',
    purpose: row.purpose ?? '',
    category: row.category ?? '',
    quantity: row.quantity ?? '',
    unit: row.unit ?? '',
    requiredArrivalDate: row.requiredArrivalDate ?? '',
    oaNo: row.oaNo ?? '',
    deliveryNote: row.deliveryNote ?? '',
    receivedQuantity: row.receivedQuantity ?? '',
    actualArrivalDate: row.actualArrivalDate ?? '',
    remark: row.remark ?? '',
  }
  message.value = ''
}

function cancelEdit() {
  edit.value = null
  message.value = ''
}

/** 必填口径与后端一致（界面先拦一次少一趟往返，后端拦住才是真的拦住） */
function requiredProblem(source) {
  if (!source.requester?.trim()) {
    return '需求人不能为空'
  }
  if (!source.materialName?.trim()) {
    return '物料名称不能为空'
  }
  return ''
}

/** 新增行保存 */
async function handleCreate() {
  const problem = requiredProblem(draft)
  if (problem) {
    message.value = problem
    ElMessage.error(problem)
    return
  }
  try {
    // gotoFirstPage：变更-093 的遗留问题 —— 原先保存完停在当前页，
    // 而排序是"提出需求日期倒序"，翻在第 2 页时新加的行根本看不见（只有一个 toast）。
    await savePurchase(draft, { gotoFirstPage: true })
    resetDraft()
    ElMessage.success('已保存')
  } catch (e) {
    // ⚠️ 失败**不清理已填内容**：api/request.js 已把「HTTP 200 + success:false」拦成拒绝
    // （变更-085），这里拿得到后端原话；清空输入框等于让人重敲一遍（变更-091 的弹窗版本
    // 就是靠"不关弹窗"保住这一点的，改成行内录入后由"不清 draft"接替）。
    message.value = `保存失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(message.value)
  }
}

/** 原地编辑保存 */
async function handleUpdate() {
  const problem = requiredProblem(edit.value)
  if (problem) {
    message.value = problem
    ElMessage.error(problem)
    return
  }
  try {
    await savePurchase(edit.value)
    edit.value = null
    ElMessage.success('已保存')
  } catch (e) {
    message.value = `保存失败：${e?.response?.data?.msg || e?.message || '未知错误'}`
    ElMessage.error(message.value)
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`删除「${row.materialName}」这条采购需求？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return // 取消
  }
  try {
    await deletePurchase(row.id)
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(`删除失败：${e?.response?.data?.msg || e?.message || '未知错误'}`)
  }
}

onMounted(() => {
  resetDraft()
  loadPurchase()
})
// 离开面板撤销待发的物料检索（免得已经不打字了还在打接口）
onUnmounted(cancelMaterialSearch)
</script>

<template>
  <!-- 定高链（变更-088 的方子）：卡片撑满页签给的高度、表格区自己滚、**分页行钉在卡底** -->
  <section class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
    <div class="shrink-0 border-b border-line px-6 py-3">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p class="text-sm font-medium text-slate-700">采购需求详情</p>
        <p class="text-xs text-slate-500">
          <template v-if="loading">查询中…</template>
          <template v-else>共 {{ total }} 条</template>
        </p>
        <div class="ml-auto flex flex-wrap items-center gap-x-2 gap-y-2">
          <el-input
            v-model="keyword"
            placeholder="需求人 / 物料名称 / 物料编码 / OA单号 / 送货单"
            aria-label="搜索采购需求"
            clearable
            class="w-60"
            @keyup.enter="flushPurchaseQuery"
            @clear="flushPurchaseQuery"
          />
          <el-date-picker
            v-model="rangeStart"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="提出需求·起"
            aria-label="提出需求日期起"
            class="w-36"
            @change="applyPurchaseFilters"
          />
          <span class="text-xs text-slate-500">至</span>
          <el-date-picker
            v-model="rangeEnd"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="提出需求·止"
            aria-label="提出需求日期止"
            class="w-36"
            @change="applyPurchaseFilters"
          />
          <el-select
            v-model="categoryFilter"
            placeholder="全部类别"
            aria-label="按类别筛选"
            clearable
            class="w-28"
            @change="applyPurchaseFilters"
          >
            <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
          </el-select>
          <el-button @click="applyPurchaseFilters">查询</el-button>
        </div>
      </div>

      <!-- 汇总栏（变更-096）：数字全部来自服务端聚合，点一下＝按该状态筛。
           刻意不做图表 —— 这一栏要回答的是「有几条要催」，不是「趋势怎么样」。 -->
      <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span class="text-xs text-slate-500">状态概览</span>
        <button
          v-for="chip in statusChips"
          :key="chip.value || 'all'"
          type="button"
          class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors"
          :class="[
            statusFilter === chip.value
              ? 'border-slate-700 bg-slate-800 text-white'
              : 'border-line bg-region text-slate-600 hover:border-slate-400',
          ]"
          :aria-pressed="statusFilter === chip.value"
          @click="toggleStatusFilter(chip.value)"
        >
          {{ chip.label }}
          <span
            class="font-semibold"
            :class="statusFilter === chip.value ? 'text-white' : 'text-slate-800'"
          >{{ chip.count }}</span>
        </button>
        <span v-if="statusFilter" class="text-xs text-slate-500">（再点一次该状态可取消筛选）</span>
      </div>
    </div>

    <p
      v-if="loadError"
      role="alert"
      class="shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800"
    >
      {{ loadError }}
    </p>

    <p
      v-if="message"
      role="alert"
      class="shrink-0 border-b border-rose-200 bg-rose-50 px-6 py-2 text-xs text-rose-700"
    >
      {{ message }}
    </p>

    <div class="purchase-scroll min-h-0 flex-1 overflow-auto">
      <!-- 列宽写死（table-fixed + colgroup）：15 列用 table-layout:auto 时，浏览器会把每列压到
       "一个汉字"的宽度，长规格型号就变成竖排的一列 —— 2026-10-18 使用方截图就是这个现象。
       写死之后：窄列不再被压扁，长文本用 line-clamp/truncate 收口，悬停看全文。 -->
      <table class="w-full min-w-[1850px] table-fixed text-sm">
        <colgroup>
          <col class="w-[56px]" />
          <col class="w-[92px]" />
          <col class="w-[84px]" />
          <col class="w-[112px]" />
          <col class="w-[116px]" />
          <col class="w-[120px]" />
          <col class="w-[240px]" />
          <col class="w-[130px]" />
          <col class="w-[80px]" />
          <col class="w-[84px]" />
          <col class="w-[112px]" />
          <col class="w-[130px]" />
          <col class="w-[88px]" />
          <col class="w-[108px]" />
          <col class="w-[170px]" />
          <col class="w-[126px]" />
        </colgroup>
        <thead
          class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line,#e5e7eb)]"
        >
          <tr>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-right font-medium">序号</th>
            <!-- 状态列是**派生值**，不参与 EDIT_FIELDS（见 EDIT_FIELDS 的注释） -->
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">进度</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">需求人</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">提出需求日期</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">物料名称</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">物料编码</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">规格型号</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">用途</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">类别</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">数量</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">要求到货日期</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">OA 单号</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">送货单</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">实际到货</th>
            <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-left font-medium">备注</th>
            <th v-if="canEdit" scope="col" class="whitespace-nowrap px-3 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <!-- ★ 新增行：就摆在数据行**上面**，敲完点保存（或在本行文本框里回车）就多一条。
               不做弹窗 —— 采购同事的心智是 Excel，跳窗会打断连续录入。 -->
          <tr v-if="canEdit" class="border-t border-line bg-region/40">
            <td class="px-3 py-1.5 text-right align-middle text-base leading-none text-brand">＋</td>
            <!-- 状态列：新增行还没有状态（保存后才派生），给个占位保持列对齐 -->
            <td class="px-3 py-1.5 text-xs text-slate-500">—</td>
            <td v-for="f in EDIT_FIELDS" :key="f.key" class="px-2 py-1.5">
              <el-date-picker
                v-if="f.kind === 'date'"
                v-model="draft[f.key]"
                type="date"
                size="small"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                :aria-label="f.aria"
                class="w-full"
              />
              <el-autocomplete
                v-else-if="f.kind === 'materialName'"
                v-model="draft.materialName"
                class="w-full"
                size="small"
                value-key="label"
                :fetch-suggestions="fetchMaterialSuggestions"
                :trigger-on-focus="true"
                :debounce="0"
                :placeholder="f.placeholder"
                :aria-label="f.aria"
                @select="pickMaterial(draft, $event, 'name')"
              >
                <template #default="{ item }">
                  <span class="text-sm text-slate-800">{{ item.label }}</span>
                  <span v-if="item.code" class="ml-2 text-xs text-slate-500">{{ item.code }}</span>
                  <span v-if="item.spec" class="ml-2 text-xs text-slate-500">{{ item.spec }}</span>
                </template>
              </el-autocomplete>
              <el-autocomplete
                v-else-if="f.kind === 'materialCode'"
                v-model="draft.materialCode"
                class="w-full"
                size="small"
                value-key="code"
                :fetch-suggestions="fetchMaterialSuggestions"
                :trigger-on-focus="true"
                :debounce="0"
                :placeholder="f.placeholder"
                :aria-label="f.aria"
                @select="pickMaterial(draft, $event, 'code')"
              >
                <template #default="{ item }">
                  <span class="text-sm text-slate-800">{{ item.code }}</span>
                  <span v-if="item.label" class="ml-2 text-xs text-slate-500">{{ item.label }}</span>
                  <span v-if="item.spec" class="ml-2 text-xs text-slate-500">{{ item.spec }}</span>
                </template>
              </el-autocomplete>
              <el-select
                v-else-if="f.kind === 'select'"
                v-model="draft[f.key]"
                size="small"
                placeholder="类别"
                :aria-label="f.aria"
                clearable
                class="w-full"
              >
                <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
              </el-select>
              <!-- 数量与单位合成一格：分开填没意义、分开显示又占两列 -->
              <div v-else-if="f.kind === 'quantity'" class="flex items-center gap-1">
                <el-input
                  v-model="draft.quantity"
                  size="small"
                  type="number"
                  min="0"
                  placeholder="数量"
                  aria-label="需求数量"
                  class="w-16"
                />
                <el-select
                  v-model="draft.unit"
                  size="small"
                  placeholder="单位"
                  aria-label="单位"
                  clearable
                  filterable
                  allow-create
                  class="w-20"
                >
                  <el-option v-for="u in UNIT_OPTIONS" :key="u" :label="u" :value="u" />
                </el-select>
              </div>
              <div v-else-if="f.kind === 'image'" class="flex flex-col gap-1">
                <DeliveryNoteUpload
                  :value="draft[f.key]"
                  @update:value="draft[f.key] = $event"
                />
                <!-- 到货数量只在「已经上传送货单」时才可填：没到货就没有"到齐没到齐"这回事。
                     多数情况一次到齐，所以给个「全到」一键填满 —— 否则没人愿意手抄数字，
                     而「部分到货」恰恰要靠这两个数字才判得出来。 -->
                <div v-if="draft.deliveryNote" class="flex items-center gap-1">
                  <span class="text-[11px] text-slate-500">到货</span>
                  <el-input
                    v-model="draft.receivedQuantity"
                    size="small"
                    type="number"
                    min="0"
                    placeholder="数量"
                    aria-label="实际到货数量"
                    class="w-16"
                  />
                  <button
                    type="button"
                    class="text-[11px] text-brand hover:underline"
                    title="把到货数量填成需求数量、到货日期填成今天"
                    @click="markAllDelivered(draft)"
                  >
                    全到
                  </button>
                </div>
              </div>
              <el-input
                v-else
                v-model="draft[f.key]"
                size="small"
                :placeholder="f.placeholder"
                :aria-label="f.aria"
                @keyup.enter="handleCreate"
              />
            </td>
            <td class="px-3 py-1.5 text-right whitespace-nowrap">
              <!-- saving 是数据层的一个共享标志：编辑某行时它也会是 true。
                   所以这里用 `saving && !edit` —— 否则编辑行保存时，新增行的按钮也跟着转。 -->
              <el-button size="small" type="primary" :loading="saving && !edit" @click="handleCreate">
                保存
              </el-button>
              <el-button size="small" @click="resetDraft">清空</el-button>
            </td>
          </tr>

          <!-- 数据行：正在编辑的那一行原地变成输入框（同一份字段表，两种形态不会写歪） -->
          <!-- ⚠️ 只有「编辑」按钮能进入编辑态（使用方要求）：行级 @click / @keydown / tabindex 已移除。
               原先整行可点，导致点「送货单」缩略图时事件冒泡到行、直接切成编辑态，
               el-image 的原图预览根本打不开 —— 图片预览与行级编辑不能共存，二者取图片。 -->
          <tr
            v-for="(row, index) in rows"
            :key="row.id"
            class="border-t border-line"
            :class="[
              edit && edit.id === row.id ? 'bg-region/40' : rowTone(row.status),
            ]"
          >
            <!-- 序号跨页连续（不是每页从 1 开始）：使用方是照着序号核对，一翻页重新数会串 -->
            <td class="px-3 py-2 text-right text-xs text-slate-500">
              {{ (pageNum - 1) * pageSize + index + 1 }}
            </td>

            <template v-if="edit && edit.id === row.id">
              <!-- 编辑态下状态仍显示原值（改的是进度字段，状态要等保存后由后端重算） -->
              <td class="px-3 py-1.5">
                <span
                  class="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]"
                  :class="statusClass(row.status)"
                >{{ row.statusLabel }}</span>
              </td>
              <td v-for="f in EDIT_FIELDS" :key="f.key" class="px-2 py-1.5">
                <el-date-picker
                  v-if="f.kind === 'date'"
                  v-model="edit[f.key]"
                  type="date"
                  size="small"
                  value-format="YYYY-MM-DD"
                  placeholder="选择日期"
                  :aria-label="f.aria"
                  class="w-full"
                />
                <el-autocomplete
                  v-else-if="f.kind === 'materialName'"
                  v-model="edit.materialName"
                  class="w-full"
                  size="small"
                  value-key="label"
                  :fetch-suggestions="fetchMaterialSuggestions"
                  :trigger-on-focus="true"
                  :debounce="0"
                  :placeholder="f.placeholder"
                  :aria-label="f.aria"
                  @select="pickMaterial(edit, $event, 'name')"
                >
                  <template #default="{ item }">
                    <span class="text-sm text-slate-800">{{ item.label }}</span>
                    <span v-if="item.code" class="ml-2 text-xs text-slate-500">{{ item.code }}</span>
                    <span v-if="item.spec" class="ml-2 text-xs text-slate-500">{{ item.spec }}</span>
                  </template>
                </el-autocomplete>
                <el-autocomplete
                  v-else-if="f.kind === 'materialCode'"
                  v-model="edit.materialCode"
                  class="w-full"
                  size="small"
                  value-key="code"
                  :fetch-suggestions="fetchMaterialSuggestions"
                  :trigger-on-focus="true"
                  :debounce="0"
                  :placeholder="f.placeholder"
                  :aria-label="f.aria"
                  @select="pickMaterial(edit, $event, 'code')"
                >
                  <template #default="{ item }">
                    <span class="text-sm text-slate-800">{{ item.code }}</span>
                    <span v-if="item.label" class="ml-2 text-xs text-slate-500">{{ item.label }}</span>
                    <span v-if="item.spec" class="ml-2 text-xs text-slate-500">{{ item.spec }}</span>
                  </template>
                </el-autocomplete>
                <el-select
                  v-else-if="f.kind === 'select'"
                  v-model="edit[f.key]"
                  size="small"
                  placeholder="类别"
                  :aria-label="f.aria"
                  clearable
                  class="w-full"
                >
                  <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
                </el-select>
                <div v-else-if="f.kind === 'quantity'" class="flex items-center gap-1">
                  <el-input
                    v-model="edit.quantity"
                    size="small"
                    type="number"
                    min="0"
                    placeholder="数量"
                    aria-label="需求数量"
                    class="w-16"
                  />
                  <el-select
                    v-model="edit.unit"
                    size="small"
                    placeholder="单位"
                    aria-label="单位"
                    clearable
                    filterable
                    allow-create
                    class="w-20"
                  >
                    <el-option v-for="u in UNIT_OPTIONS" :key="u" :label="u" :value="u" />
                  </el-select>
                </div>
                <div v-else-if="f.kind === 'image'" class="flex flex-col gap-1">
                  <DeliveryNoteUpload
                    :value="edit[f.key]"
                    @update:value="edit[f.key] = $event"
                  />
                  <div v-if="edit.deliveryNote" class="flex items-center gap-1">
                    <span class="text-[11px] text-slate-500">到货</span>
                    <el-input
                      v-model="edit.receivedQuantity"
                      size="small"
                      type="number"
                      min="0"
                      placeholder="数量"
                      aria-label="实际到货数量"
                      class="w-16"
                    />
                    <button
                      type="button"
                      class="text-[11px] text-brand hover:underline"
                      title="把到货数量填成需求数量、到货日期填成今天"
                      @click="markAllDelivered(edit)"
                    >
                      全到
                    </button>
                  </div>
                </div>
                <el-input
                  v-else
                  v-model="edit[f.key]"
                  size="small"
                  :placeholder="f.placeholder"
                  :aria-label="f.aria"
                  @keyup.enter="handleUpdate"
                />
              </td>
              <td class="px-3 py-1.5 text-right whitespace-nowrap">
                <el-button size="small" type="primary" :loading="saving" @click.stop="handleUpdate">
                  保存
                </el-button>
                <el-button size="small" @click.stop="cancelEdit">取消</el-button>
              </td>
            </template>

            <template v-else>
              <!-- 进度标签：文案与颜色都来自后端派生值。
                   临期/超期后面直接跟"几天"（使用方 2026-10-18：要能一眼看出差几天），
                   「还差几天」比状态本身更能决定先催哪一条。 -->
              <td class="px-3 py-2">
                <span
                  class="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]"
                  :class="statusClass(row.status)"
                  :title="row.overdueDays ? `已超期 ${row.overdueDays} 天` : (row.daysToDue !== null && row.daysToDue !== undefined ? `距要求到货 ${row.daysToDue} 天` : '')"
                >
                  {{ row.statusLabel }}<template v-if="dayHint(row)"> · {{ dayHint(row) }}</template>
                </span>
              </td>
              <td class="px-3 py-2"><span class="block truncate text-slate-600" :title="row.requester || ''">{{ row.requester || '—' }}</span></td>
              <td class="px-3 py-2 text-slate-600">{{ row.requestDate || '—' }}</td>
              <td class="px-3 py-2 font-medium"><span class="block truncate" :title="row.materialName">{{ row.materialName }}</span></td>
              <!-- 编码可能还没有（采购/仓库后定）：空值显示「—」，不要显示成 0 或空白。
                   变更-097d：去掉原来的「总表可查」小胶囊 —— 使用方说它影响美观、又不影响功能
                   （后端仍然会把编码登记进 material_stock 的 0000 档，只是界面上不再标注）。 -->
              <td class="px-3 py-2 text-slate-600">
                <span class="block truncate" :title="row.materialCode || ''">{{ row.materialCode || '—' }}</span>
              </td>
              <td class="px-3 py-2 text-slate-600"><div class="line-clamp-2" :title="row.spec || ''">{{ row.spec || '—' }}</div></td>
              <td class="px-3 py-2 text-slate-600"><div class="line-clamp-2" :title="row.purpose || ''">{{ row.purpose || '—' }}</div></td>
              <td class="px-3 py-2 text-slate-600">
                <span
                  v-if="row.category"
                  class="rounded border border-line bg-region px-1.5 text-[11px] text-slate-600"
                >{{ row.category }}</span>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2 whitespace-nowrap text-slate-600">{{ quantityText(row) }}</td>
              <td class="px-3 py-2 text-slate-600">{{ row.requiredArrivalDate || '—' }}</td>
              <!-- OA 单号 → 点开 OA 的「单号筛选」列表（变更-099）。
                   为什么是列表而不是表单：表单要 fdId（OA 内部主键），而 URL 里没有单号；
                   但 OA 的 listAll 路由支持 criteria=docNumber:<单号> 精确筛一张单 ——
                   实测地址形如 /ssc/fee/#/j_path=%2FlistAll&mydoc=all&criteria=docNumber%3AF-ZCSG-20261001。
                   代价是多点一次（列表里就 1 行）；好处是那列表还顺带显示
                   「当前处理人 / 文档状态（审批中）」，比直接进表单信息更多。
                   没有单号就保持普通文字 —— 看着像链接点不动最恼人。 -->
              <td class="px-3 py-2 text-slate-600">
                <a
                  v-if="row.oaNo"
                  :href="oaSearchLink(row.oaNo)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block truncate text-brand hover:underline"
                  :title="`在 OA 里打开 ${row.oaNo}`"
                >{{ row.oaNo }}</a>
                <template v-else>—</template>
              </td>
              <!-- 送货单三态（变更-094）：图片 → 缩略图（点开看原图）；文本 → 原样显示
                   （这一列原本是「送货单号」文本，老数据不许当坏数据）；空 → 未到货。
                   这是「进度」这一列的核心信息，所以空着要用灰字说清楚而不是留白。 -->
              <td class="px-3 py-2 text-slate-600">
                <el-image
                  v-if="isStoredImage(row.deliveryNote)"
                  :src="storedImageThumb(row.deliveryNote)"
                  :preview-src-list="[row.deliveryNote]"
                  :preview-teleported="true"
                  fit="cover"
                  alt="送货单图片"
                  title="点击查看原图"
                  class="h-8 w-8 cursor-zoom-in rounded border border-line"
                  @click.stop
                />
                <template v-else-if="row.deliveryNote">{{ row.deliveryNote }}</template>
                <span v-else class="text-slate-500">未到货</span>
              </td>
              <!-- 实际到货：日期 + （部分到货时）到货数量/需求数量。
                   没有日期就显示「—」而不是「未到货」——"未到货"已经在送货单那列说过了，
                   这里再写一遍会让人以为两列各自有独立状态。 -->
              <td class="px-3 py-2 whitespace-nowrap text-slate-600">
                <template v-if="row.actualArrivalDate || row.receivedQuantity">
                  <div>{{ row.actualArrivalDate || '—' }}</div>
                  <div
                    v-if="row.receivedQuantity"
                    class="text-[11px]"
                    :class="row.partial ? 'font-medium text-slate-700' : 'text-slate-500'"
                  >
                    到货 {{ row.receivedQuantity }}<template v-if="row.quantity"> / 需求 {{ row.quantity }}</template>
                  </div>
                </template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2 text-slate-600"><div class="line-clamp-2" :title="row.remark || ''">{{ row.remark || '—' }}</div></td>
              <td v-if="canEdit" class="px-3 py-2 text-right whitespace-nowrap">
                <el-button size="small" @click.stop="startEdit(row)">编辑</el-button>
                <el-button size="small" @click.stop="handleDelete(row)">删除</el-button>
              </td>
            </template>
          </tr>

          <tr v-if="!rows.length">
            <td
              :colspan="canEdit ? 16 : 15"
              class="px-4 py-10 text-center text-sm text-slate-500"
            >
              {{ loading ? '正在加载…' : '还没有采购需求记录 —— 在第一行直接填就能加一条' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="rows.length" class="flex shrink-0 justify-end border-t border-line px-6 py-3">
      <el-pagination
        v-model:current-page="pageNum"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="loadPurchasePage"
        @size-change="setPurchasePageSize"
      />
    </div>
  </section>
</template>

<style scoped>
/*
 * 表格滚动条做细一点（与设备数据维护同一配方）。
 * 默认每页 10 行时这张表通常不会超出，所以这条多数时候看不见；
 * 小屏或自己切到 50 行时才出现，那时也不该是一条突兀的灰带。
 * 横向仍可滚：11 列在窄窗口下会溢出（新增行/编辑行的输入框也在这里，别改成 overflow-hidden）。
 */
.purchase-scroll {
  scrollbar-width: thin;
  scrollbar-color: #d4d4d8 transparent;
}
.purchase-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.purchase-scroll::-webkit-scrollbar-thumb {
  background: #d4d4d8;
  border-radius: 999px;
}
.purchase-scroll::-webkit-scrollbar-track {
  background: transparent;
}

/*
 * 单元格里的控件不许撑破列宽（2026-10-18 使用方截图反馈「上面的框都重叠了」）。
 *
 * 根因：Element Plus 的日期选择器自带 `width: var(--el-date-editor-width)`，默认 220px；
 * 而这一页是 table-fixed，日期那两列只有 112/108px —— 控件按 220px 渲染，于是向右溢出、
 * 盖住隔壁「OA 单号」「备注」的输入框。`w-full` 类权重不够（同为单类选择器，顺序不定），
 * 所以在组件里用 :deep() 提一级特异性，把宽度压回 100%。
 * min-width:0 是必须的：flex/grid 子项默认 min-width:auto，光设 width 仍会被内容撑住。
 */
.purchase-scroll :deep(.el-date-editor.el-input),
.purchase-scroll :deep(.el-date-editor .el-input__wrapper) {
  width: 100%;
  min-width: 0;
}
.purchase-scroll :deep(.el-input),
.purchase-scroll :deep(.el-select),
.purchase-scroll :deep(.el-autocomplete) {
  min-width: 0;
}
.purchase-scroll :deep(.el-select__wrapper) {
  min-width: 0;
}

</style>
