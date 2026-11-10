<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import {
  ElAutocomplete,
  ElButton,
  ElDatePicker,
  ElDialog,
  ElInput,
  ElMessageBox,
  ElOption,
  ElSelect,
} from 'element-plus'
import request from '../../api/request'
import { STATUS_TONE } from '../../constants/statusTones'
import { useMaterialLookup } from '../../composables/useMaterialLookup'
import DeliveryNoteUpload from '../DeliveryNoteUpload.vue'
import {
  CATEGORY_OPTIONS,
  DRAWER_GROUPS,
  FOCUS_FIELD_ON_CREATE,
  UNIT_OPTIONS,
  blankDraft,
  fieldByKey,
} from './fields.js'

/**
 * 采购需求详情（2026-11-10，变更-181）：从「一条记录的表单」改成
 * **「一张 OA 单 = 一张单据」**，表单退成"点某一行进去改"的第二层。
 *
 * ## 为什么这么改
 *
 * 使用方原话（与看板 变更-180 同一段）：
 *   「每张卡片的不同之处是 OA 单号。一张 OA 单号对应多条物料需求。
 *     比如 提出日期-物料名称-物料编码-规格型号-用途-要求到货日期-需求人。
 *     原因是每隔一段时间，我会提出 OA 采购单。这个单包含这段时间不同人、
 *     不同时间提出的不同需求。」
 *
 * 也就是说：他脑子里的单位是**那张 OA 单**，不是单条物料。原来点一行直接进
 * 15 格的表单，等于逼他"只看这一条"——同一张单里另外 4 条料要退出去再点一次。
 * 现在点进来先看到**整张单**：抬头是单号与单据级编号（采购单 / 验收单），
 * 下面是一张小台账（提出 / 物料 / 编码 / 规格 / 用途 / 到货 / 需求人），
 * 一行一条物料。要改哪条，点那条。
 *
 * ## 两层结构
 *
 *   docket —— 单据视图（默认，有 OA 单号时）。只读：认单、看全貌。
 *   form   —— 表单视图。改一条 / 新加一条；从单据进来时底部有「返回单据」。
 *
 * 没有 OA 单号的历史行**不伪造单据**：直接落到表单，跟原来一样。
 *
 * ## 单据级字段从哪来
 *
 * 库里这些字段是按行存的（每行都有一份 oaNo / poNo / acceptanceNo），
 * 所以单据视图取的是**同单所有行里第一个非空值**，并显示"同单有多个单号"
 * 这类提示 —— 一行填错不会让抬头静默说谎。
 */
const props = defineProps({
  /*
   * 遮罩要不要挂到 body（默认 true，2026-10-22 变更-141）。
   *
   * 必须是 true：弹窗如果渲染在页面容器里，页面头卡所在的兄弟层叠上下文会把它压住。
   * 留成 prop 只为一件事 —— 组件测试可以传 false，让 DOM 留在原地供 wrapper.find 查询。
   */
  appendToBody: { type: Boolean, default: true },
  modelValue: { type: Boolean, default: false },
  mode: { type: String, default: 'edit' }, // 'create' | 'edit'
  row: { type: Object, default: null },
  canEdit: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
  /** 「在同一张单下再加一条」的预填值（父组件把 mode 切成 create 时一起给） */
  seed: { type: Object, default: null },
  /**
   * 新建时的默认单据类型（2026-11-10）。
   *
   * 采购看板给 CGSQ、费用申请给 ZCSG —— 使用方 2026-11-10 的要求是
   * 「新增需求默认类型分开，FWCGSQ 可下拉改」。只在**空表单**里生效：
   * 编辑已有行、或从某张单点「再加一条」时，类型跟着那张单走。
   */
  defaultOrderType: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'save', 'delete', 'add-line'])

const { fetchMaterialSuggestions, cancelMaterialSearch } = useMaterialLookup()

const form = ref(blankDraft())

/*
 * 内容入场动画（2026-10-22，变更-145 → 变更-151 收紧到 160ms / 4px）。
 * 只动 opacity / transform；时长与曲线只在下面一处。
 *
 * 注意位置：必须声明在用到它的 openForm / watch **之前**。
 * 第一版写在了下面「开合」小节里，而 immediate 的 watch 在 setup 期间就会调到
 * playEnterAnimation —— 于是"Cannot access 'entering' before initialization"（TDZ），
 * 组件直接挂不上。这类错只在运行时炸，lint 看不出来。
 */
const entering = ref(false)
let enterTimer = null

function playEnterAnimation() {
  entering.value = false
  clearTimeout(enterTimer)
  requestAnimationFrame(() => {
    entering.value = true
    enterTimer = setTimeout(() => {
      entering.value = false
    }, 460)
  })
}

/** 'docket'（整张单）| 'form'（改一条） */
const view = ref('form')
/** 表单是从单据视图点进来的 —— 底部要给一个返回入口 */
const cameFromDocket = ref(false)
/** 正在编辑的那一条（null = 新建） */
const editingRow = ref(null)
/** 点「加一条」时先本地兜住的预填值：父组件还没把 seed 传回来的那一帧也能用 */
const pendingSeed = ref(null)

/* ─────────── 单据视图的数据 ─────────── */

const orderRows = ref([])
const orderLoading = ref(false)
const orderError = ref('')

const STATUS_TEXT = {
  OVERDUE: '超期',
  DUE_SOON: '临期',
  PENDING_OA: '待提单',
  WAITING: '等货',
  ARRIVED: '已到货',
  PARTIAL: '部分到货',
}

const TYPE_TEXT = {
  CGSQ: '采购申请',
  FWCGSQ: '服务采购申请',
  ZCSG: '资产申购',
}

function statusClass(key) {
  switch (key) {
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

function oaNoOf(row) {
  return String(row?.oaNo || '').trim()
}

/**
 * 单号本身就带类型码（CG-CGSQ-… / F-WCGSQ-… / F-ZCSG-…），
 * 老数据 order_type 是空的，抬头就别写「单据类型未填」了，按单号认。
 */
function inferOrderType(oaNo) {
  const no = String(oaNo || '').toUpperCase()
  if (!no) return ''
  if (no.includes('FWCGSQ')) return 'FWCGSQ'
  if (no.includes('ZCSG')) return 'ZCSG'
  if (no.includes('CGSQ')) return 'CGSQ'
  return ''
}

function todayIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `2026-10-22` → `10-22`；认不出的原样给（外加破折号，别让格子塌成空白） */
function md(value) {
  const raw = String(value || '').trim()
  const m = raw.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}-${m[2]}` : raw || '—'
}

/** 逐条的急慢提示，口径与列表一致：天数由后端给，前端不算日期 */
function dueHint(row) {
  const status = String(row?.status || '').toUpperCase()
  if (status === 'OVERDUE' && row.overdueDays) return `超 ${row.overdueDays} 天`
  if (status === 'DUE_SOON') {
    const d = row?.daysToDue
    if (d === null || d === undefined) return ''
    return d === 0 ? '今天到期' : `剩 ${d} 天`
  }
  return ''
}

function quantityText(row) {
  const q = String(row?.quantity ?? '').trim()
  const u = String(row?.unit ?? '').trim()
  return q ? `${q}${u}` : '—'
}

/**
 * 同单明细：**按提出日期正序**（早提的在上）。
 *
 * 为什么不像列表那样倒序：列表是"最新发生了什么"，单据是"这张单按时间攒了哪些需求"，
 * 顺着读才看得出这单是分几次提的。同一天按 id 兜底，保证顺序稳定。
 */
const sortedRows = computed(() => {
  const rows = orderRows.value.length ? orderRows.value : props.row ? [props.row] : []
  return [...rows].sort((a, b) => {
    const x = String(a?.requestDate || '')
    const y = String(b?.requestDate || '')
    if (x !== y) return x < y ? -1 : 1
    return (a?.id ?? 0) - (b?.id ?? 0)
  })
})

const docket = computed(() => {
  const rows = sortedRows.value
  const distinct = (key) => {
    const out = []
    for (const r of rows) {
      const v = String(r?.[key] ?? '').trim()
      if (v && !out.includes(v)) out.push(v)
    }
    return out
  }
  const dates = rows
    .map((r) => String(r?.requestDate || '').trim())
    .filter(Boolean)
    .sort()
  const people = distinct('requester')
  const poNos = distinct('poNo')
  const acceptanceNos = distinct('acceptanceNo')
  const types = distinct('orderType')
  const oaNo = oaNoOf(props.row) || String(rows[0]?.oaNo || '').trim()

  return {
    rows,
    oaNo,
    oaUrl: distinct('oaUrl')[0] || '',
    orderType: types[0] || inferOrderType(oaNo),
    orderTypeExtra: types.length > 1,
    poNo: poNos[0] || '',
    poUrl: distinct('poUrl')[0] || '',
    poExtra: poNos.length > 1,
    acceptanceNo: acceptanceNos[0] || '',
    acceptanceUrl: distinct('acceptanceUrl')[0] || '',
    acceptanceExtra: acceptanceNos.length > 1,
    people,
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
  }
})

/** 抬头次行：几条需求 · 谁提的 · 什么时候提的 */
const docketMeta = computed(() => {
  const d = docket.value
  const count = `${d.rows.length} 条需求`
  const people =
    d.people.length > 3 ? `${d.people.slice(0, 3).join('、')} 等 ${d.people.length} 人` : d.people.join('、')
  let when = ''
  if (d.firstDate && d.lastDate && d.firstDate !== d.lastDate) {
    when = `提出 ${d.firstDate} 至 ${d.lastDate}`
  } else if (d.firstDate) {
    when = `提出 ${d.firstDate}`
  }
  return [count, people, when].filter(Boolean).join(' · ')
})

/** 抬头那枚类型签（没有类型就不显示，不编） */
const typeLabel = computed(() => {
  const t = docket.value.orderType
  if (!t) return ''
  return TYPE_TEXT[t] ? `${TYPE_TEXT[t]} ${t}` : t
})

const isDocket = computed(() => view.value === 'docket')
const isCreate = computed(() => props.mode === 'create')
const title = computed(() => (isCreate.value ? '新增采购需求' : '编辑采购需求'))

const dirty = computed(() => JSON.stringify(form.value) !== snapshot)

/* ─────────── 取同单明细 ─────────── */

/**
 * 关键字检索把 OA 单号也包含在模糊匹配里，所以用单号捞一遍、再按**全等**过滤。
 * pageSize 给 200：一张单几十条已经离谱，200 足够，且不会把整表拖下来。
 */
async function loadOrder(oaNo) {
  if (!oaNo) return
  orderLoading.value = true
  orderError.value = ''
  try {
    const res = await request.get('/api/purchase/list', {
      params: { keyword: oaNo, pageNum: 1, pageSize: 200 },
    })
    if (res.data?.success === false) {
      throw new Error(res.data.msg || '取不到这张单的其它明细。')
    }
    const all = Array.isArray(res.data?.dataList) ? res.data.dataList : []
    const exact = all.filter((r) => oaNoOf(r) === oaNo)
    orderRows.value = exact.length ? exact : props.row ? [props.row] : []
  } catch (error) {
    orderRows.value = props.row ? [props.row] : []
    orderError.value =
      error?.response?.data?.msg || error?.message || '取不到这张单的其它明细，下面只显示当前这一条。'
  } finally {
    orderLoading.value = false
  }
}

/* ─────────── 表单 ─────────── */

/** 打开时的快照，用来判断"有没有改过" */
let snapshot = JSON.stringify(blankDraft())

const materialNameRef = ref(null)

const suggestedOrderType = computed(() => {
  const no = String(form.value?.oaNo || '').toUpperCase()
  if (!no) return ''
  if (no.includes('FWCGSQ')) return 'FWCGSQ'
  if (no.includes('ZCSG')) return 'ZCSG'
  if (no.includes('CGSQ')) return 'CGSQ'
  return ''
})

function setMaterialNameRef(el) {
  materialNameRef.value = el
}

/** 用某一条装填表单（row 为空 = 新建；新建时吃 seed / pendingSeed） */
function openForm(row, fromDocket = false) {
  editingRow.value = row
  const seed = row ? null : props.seed || pendingSeed.value || null
  const base = row ? { ...blankDraft(), ...row } : { ...blankDraft(), ...(seed || {}) }
  // 纯新建（没有行、也没有从某张单带过来的值）才落页面默认类型
  if (!row && !base.orderType && props.defaultOrderType) base.orderType = props.defaultOrderType
  form.value = base
  snapshot = JSON.stringify(base)
  view.value = 'form'
  // 从整张单里点进来的，才给「返回单据」；独立新建没有单可回
  cameFromDocket.value = fromDocket
  playEnterAnimation()
  nextTick(() => {
    if (!row) setTimeout(() => materialNameRef.value?.focus?.(), 60)
  })
}

/** 回到整张单：有未保存改动先问一句 */
async function backToDocket() {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('这一条还没保存，返回单据会丢掉改动，继续吗？', '未保存的改动', {
        confirmButtonText: '丢改返回',
        cancelButtonText: '继续编辑',
        type: 'warning',
      })
    } catch {
      return
    }
  }
  view.value = 'docket'
  cameFromDocket.value = false
  pendingSeed.value = null
  await loadOrder(docket.value.oaNo)
}

/** 点某一行 → 改那一条 */
function openLine(row) {
  if (!props.canEdit) return
  openForm(row, true)
}

/** 在同一张单下再加一条：把单据级字段带过去，别让人重填一遍 */
function addLine() {
  const d = docket.value
  const seed = {
    oaNo: d.oaNo,
    oaUrl: d.oaUrl,
    orderType: d.orderType,
    poNo: d.poNo,
    poUrl: d.poUrl,
    acceptanceNo: d.acceptanceNo,
    acceptanceUrl: d.acceptanceUrl,
    requestDate: todayIso(),
    // 需求人默认沿用这张单最后一个填的人：一张单常是同一个人报的
    requester: d.people[d.people.length - 1] || '',
  }
  pendingSeed.value = seed
  emit('add-line', seed)
  openForm(null, true)
}

/*
 * 打开：有 OA 单号先给单据视图，没有就还是表单。
 * 多看一眼 mode：父组件从「单据里加一条」把 mode 切成 create 时，
 * modelValue 一直是 true（弹窗没关），只靠 modelValue 的 watch 收不到。
 */
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      cancelMaterialSearch()
      orderRows.value = []
      return
    }
    pendingSeed.value = null
    cameFromDocket.value = false
    if (props.mode === 'edit' && props.row) {
      const oaNo = oaNoOf(props.row)
      if (oaNo) {
        view.value = 'docket'
        orderRows.value = [props.row]
        playEnterAnimation()
        await loadOrder(oaNo)
        return
      }
    }
    openForm(props.mode === 'edit' ? props.row : null)
  },
  { immediate: true },
)

watch(
  () => props.mode,
  (mode) => {
    if (!props.modelValue) return
    if (mode === 'create' && view.value === 'docket') openForm(null, true)
  },
)

/* ─────────── 开合 ─────────── */

function close() {
  emit('update:modelValue', false)
}

/** 关闭前问一句：有改动就别让它悄悄丢（单据视图只读，直接关） */
async function requestClose() {
  if (isDocket.value || !dirty.value) {
    close()
    return
  }
  try {
    await ElMessageBox.confirm('关闭后未保存的改动会丢失，确定关闭？', '未保存的改动', {
      confirmButtonText: '关闭',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
  } catch {
    return
  }
  close()
}

function beforeClose(done) {
  if (isDocket.value || !dirty.value) {
    done()
    return
  }
  requestClose()
}

/**
 * 保存成功后"接着录下一条"（2026-10-22，变更-142）。
 * 只清物料三件套 + 数量复位 1；需求人 / 日期 / 类别 / 用途 / 单号都留着。
 */
function resetForNextEntry() {
  form.value.materialName = ''
  form.value.materialCode = ''
  form.value.spec = ''
  form.value.quantity = 1
  snapshot = JSON.stringify(form.value)
  cancelMaterialSearch()
  nextTick(() => materialNameRef.value?.focus?.())
}

/**
 * 在单据里加完一条：回到整张单并刷新明细（父组件保存成功后调）。
 *
 * 为什么不复用 resetForNextEntry：那是「同一批连着录」的语义 —— 表单一动不动、
 * 只清物料三件套。而这里人是站在一张单上补一条，补完该看见整张单多了一行。
 */
async function afterLineAdded() {
  pendingSeed.value = null
  cameFromDocket.value = false
  view.value = 'docket'
  await loadOrder(docket.value.oaNo)
}

defineExpose({ resetForNextEntry, afterLineAdded })

/** 回车提交，但只在输入框里提交（下拉/日期面板里回车不能顺手把表存了） */
function onEnter(event) {
  const tag = event.target?.tagName
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
  event.preventDefault()
  submit()
}

function submit() {
  if (!props.canEdit || props.saving) return
  emit('save', { ...form.value })
}

function pickMaterial(option, source) {
  if (!option) return
  if (source === 'name') {
    form.value.materialName = option.name || option.code
    form.value.materialCode = option.code
  } else {
    form.value.materialCode = option.code
    if (option.name) form.value.materialName = option.name
  }
  if (!form.value.spec) form.value.spec = option.spec || ''
}

function fillAllDelivered() {
  form.value.receivedQuantity = form.value.quantity
  form.value.actualArrivalDate = todayIso()
}

function onDelete() {
  emit('delete', editingRow.value || props.row)
}

function fieldsOf(group) {
  return group.keys.map((k) => fieldByKey(k)).filter(Boolean)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :append-to-body="appendToBody"
    width="min(1040px, 96vw)"
    top="6vh"
    :close-on-press-escape="false"
    :close-on-click-modal="false"
    :before-close="beforeClose"
    :show-close="false"
    class="purchase-dialog"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <template #header>
      <!-- 单据视图：抬头就是这张单 -->
      <div v-if="isDocket" class="flex w-full items-start justify-between gap-6">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span
              v-if="typeLabel"
              class="rounded border border-line px-1.5 py-0.5 text-[11px] tracking-wide text-slate-600"
            >
              {{ typeLabel }}<template v-if="docket.orderTypeExtra"> 等</template>
            </span>
            <span v-else class="text-[11px] tracking-wide text-slate-500">单据类型未填</span>
            <span class="text-[11px] tabular-nums text-slate-500">{{ docketMeta }}</span>
          </div>
          <h2 class="mt-1.5 truncate text-[26px] leading-tight font-semibold tracking-tight tabular-nums text-slate-900">
            {{ docket.oaNo }}
          </h2>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <a
            v-if="docket.oaUrl"
            :href="docket.oaUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
          >
            在 OA 里打开
            <span aria-hidden="true">↗</span>
          </a>
          <button
            type="button"
            class="shrink-0 rounded-full p-1.5 text-slate-500 transition-colors hover:bg-region hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
            aria-label="关闭"
            @click="requestClose"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 表单视图：改一条 / 新加一条 -->
      <div v-else class="flex w-full items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate font-serif text-lg font-bold tracking-tight text-slate-900">
            {{ title }}
          </h2>
          <p v-if="!isCreate && editingRow" class="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span class="rounded-full px-2 py-0.5" :class="statusClass(editingRow.status)">
              {{ STATUS_TEXT[editingRow.status] || '等货' }}
            </span>
            <span v-if="dueHint(editingRow)">{{ dueHint(editingRow) }}</span>
            <span class="truncate">{{ editingRow.materialName }}</span>
          </p>
          <p v-else-if="isCreate && docket.oaNo" class="mt-1 truncate text-xs text-slate-500">
            加到 {{ docket.oaNo }} 这张单下
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-full p-1.5 text-slate-500 transition-colors hover:bg-region hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
          aria-label="关闭"
          @click="requestClose"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </template>

    <div
      class="drawer-enter"
      :class="{ 'is-entering': entering }"
      @keydown.enter.exact="onEnter"
      @keydown.esc.stop.prevent="isDocket ? requestClose() : backToDocket()"
    >
      <p
        v-if="errorMessage"
        role="alert"
        class="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
      >
        {{ errorMessage }}
      </p>

      <!-- ══════════ 单据视图：一张 OA 单 + 它装着的所有物料需求 ══════════ -->
      <div v-if="isDocket" class="flex flex-col">
        <!-- 单据级编号：采购单 / 验收单。库里按行存，这里取同单第一个非空值 -->
        <dl class="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
          <div class="flex min-w-0 items-baseline gap-2 bg-raised px-3 py-2">
            <dt class="shrink-0 text-[11px] tracking-wide text-slate-500">采购单</dt>
            <dd class="min-w-0 truncate text-xs">
              <a
                v-if="docket.poNo && docket.poUrl"
                :href="docket.poUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="tabular-nums text-brand-ink hover:underline"
              >{{ docket.poNo }} ↗</a>
              <span v-else-if="docket.poNo" class="tabular-nums text-slate-700">{{ docket.poNo }}</span>
              <span v-else class="text-slate-500">未关联</span>
              <span v-if="docket.poExtra" class="ml-1 text-slate-500">（同单有多个单号）</span>
            </dd>
          </div>
          <div class="flex min-w-0 items-baseline gap-2 bg-raised px-3 py-2">
            <dt class="shrink-0 text-[11px] tracking-wide text-slate-500">验收单</dt>
            <dd class="min-w-0 truncate text-xs">
              <a
                v-if="docket.acceptanceNo && docket.acceptanceUrl"
                :href="docket.acceptanceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="tabular-nums text-brand-ink hover:underline"
              >{{ docket.acceptanceNo }} ↗</a>
              <span v-else-if="docket.acceptanceNo" class="tabular-nums text-slate-700">{{ docket.acceptanceNo }}</span>
              <span v-else class="text-slate-500">
                {{ docket.orderType === 'CGSQ' ? '采购申请一般无验收单' : '未关联' }}
              </span>
              <span v-if="docket.acceptanceExtra" class="ml-1 text-slate-500">（同单有多个单号）</span>
            </dd>
          </div>
        </dl>

        <!-- 明细台账：一行一条物料，列就是使用方口述的那七项（外加状态与数量） -->
        <div class="mt-3 overflow-hidden rounded-md border border-line">
          <table class="w-full table-fixed border-collapse text-left">
            <colgroup>
              <col style="width: 74px" />
              <col style="width: 62px" />
              <col style="width: 25%" />
              <col style="width: 104px" />
              <col />
              <col style="width: 118px" />
              <col style="width: 92px" />
              <col style="width: 64px" />
              <col style="width: 62px" />
              <col style="width: 48px" />
            </colgroup>
            <thead>
              <tr class="bg-region text-[11px] tracking-wide text-slate-500">
                <th scope="col" class="px-2.5 py-1.5 font-normal">状态</th>
                <th scope="col" class="px-1 py-1.5 font-normal">提出</th>
                <th scope="col" class="px-2 py-1.5 font-normal">物料名称</th>
                <th scope="col" class="px-2 py-1.5 font-normal">物料编码</th>
                <th scope="col" class="px-2 py-1.5 font-normal">规格型号</th>
                <th scope="col" class="px-2 py-1.5 font-normal">用途</th>
                <th scope="col" class="px-2 py-1.5 font-normal">要求到货</th>
                <th scope="col" class="px-2 py-1.5 font-normal">需求人</th>
                <th scope="col" class="px-2 py-1.5 text-right font-normal">数量</th>
                <th scope="col" class="px-2 py-1.5"><span class="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody class="text-xs">
              <tr
                v-for="line in sortedRows"
                :key="line.id"
                class="border-t border-line align-top transition-colors focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                :class="canEdit ? 'cursor-pointer hover:bg-region focus-within:bg-region' : ''"
                :tabindex="canEdit ? 0 : undefined"
                @keydown.enter="openLine(line)"
                @click="openLine(line)"
              >
                <td class="px-2.5 py-2">
                  <span class="rounded-full px-1.5 py-0.5 text-[11px]" :class="statusClass(line.status)">
                    {{ STATUS_TEXT[line.status] || '等货' }}
                  </span>
                </td>
                <td class="px-1 py-2 tabular-nums text-slate-500">{{ md(line.requestDate) }}</td>
                <td class="px-2 py-2">
                  <span class="line-clamp-2 font-medium leading-snug text-slate-900">{{ line.materialName || '未填物料' }}</span>
                </td>
                <td class="truncate px-2 py-2 tabular-nums text-slate-600" :title="line.materialCode || ''">
                  {{ line.materialCode || '—' }}
                </td>
                <td class="px-2 py-2 text-slate-600" :title="line.spec || ''">
                  <span class="line-clamp-2 leading-snug">{{ line.spec || '—' }}</span>
                </td>
                <td class="px-2 py-2 text-slate-600" :title="line.purpose || ''">
                  <span class="line-clamp-2 leading-snug">{{ line.purpose || '—' }}</span>
                </td>
                <td class="px-2 py-2">
                  <span class="tabular-nums text-slate-600">{{ md(line.requiredArrivalDate) }}</span>
                  <span
                    v-if="dueHint(line)"
                    class="mt-0.5 block text-[11px] tabular-nums"
                    :class="line.status === 'OVERDUE' ? 'text-rose-700' : 'text-amber-700'"
                  >
                    {{ dueHint(line) }}
                  </span>
                </td>
                <td class="truncate px-2 py-2 text-slate-600" :title="line.requester || ''">
                  {{ line.requester || '—' }}
                </td>
                <td class="px-2 py-2 text-right tabular-nums text-slate-600">{{ quantityText(line) }}</td>
                <td class="px-2 py-2 text-right">
                  <button
                    v-if="canEdit"
                    type="button"
                    class="rounded px-1.5 py-1 text-[11px] text-slate-600 transition-colors hover:bg-raised hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                    :aria-label="`编辑 ${line.materialName || '这条物料'}`"
                    @click.stop="openLine(line)"
                  >
                    编辑
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 载入中 / 取不到 -->
          <p v-if="orderLoading" class="border-t border-line bg-raised px-3 py-2 text-xs text-slate-500">
            正在取这张单的其它明细…
          </p>
          <p
            v-else-if="orderError"
            class="border-t border-line bg-raised px-3 py-2 text-xs text-amber-700"
            role="status"
          >
            {{ orderError }}
            <button
              type="button"
              class="ml-1 underline underline-offset-2 hover:text-amber-800"
              @click="loadOrder(docket.oaNo)"
            >
              重试
            </button>
          </p>
        </div>

        <p class="mt-2 text-[11px] leading-relaxed text-slate-500">
          这批需求挂在同一张 OA 单下。点任意一行改那一条；要补一条新的，用右下角「再加一条需求」。
        </p>
      </div>

      <!-- ══════════ 表单视图：改一条 / 新加一条 ══════════ -->
      <div v-else class="flex min-h-full flex-col gap-6 pb-2">
        <section v-for="group in DRAWER_GROUPS" :key="group.title" class="space-y-3">
          <h3 class="text-xs font-semibold tracking-wide text-slate-500">{{ group.title }}</h3>

          <div
            v-for="field in fieldsOf(group)"
            :key="field.key"
            class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1"
          >
            <label :for="`pf-${field.key}`" class="text-sm text-slate-600">{{ field.aria }}</label>

            <div class="min-w-0">
              <el-input
                v-if="field.kind === 'text'"
                :id="`pf-${field.key}`"
                v-model="form[field.key]"
                :placeholder="field.placeholder"
                :aria-label="field.aria"
                :disabled="!canEdit"
                size="default"
              />

              <el-date-picker
                v-else-if="field.kind === 'date'"
                :id="`pf-${field.key}`"
                v-model="form[field.key]"
                type="date"
                value-format="YYYY-MM-DD"
                :placeholder="field.aria"
                :aria-label="field.aria"
                :disabled="!canEdit"
                class="!w-full"
              />

              <el-input
                v-else-if="field.kind === 'number'"
                :id="`pf-${field.key}`"
                v-model="form[field.key]"
                inputmode="decimal"
                :placeholder="field.placeholder"
                :aria-label="field.aria"
                :disabled="!canEdit"
              />

              <el-select
                v-else-if="field.kind === 'select'"
                :id="`pf-${field.key}`"
                v-model="form[field.key]"
                clearable
                :placeholder="`选择${field.aria}`"
                :aria-label="field.aria"
                :disabled="!canEdit"
                class="!w-full"
              >
                <el-option v-for="c in CATEGORY_OPTIONS" :key="c" :label="c" :value="c" />
              </el-select>

              <el-autocomplete
                v-else-if="field.kind === 'materialName' || field.kind === 'materialCode'"
                :id="`pf-${field.key}`"
                :ref="field.key === FOCUS_FIELD_ON_CREATE ? setMaterialNameRef : undefined"
                v-model="form[field.key]"
                :fetch-suggestions="fetchMaterialSuggestions"
                :placeholder="field.placeholder"
                :aria-label="field.aria"
                :disabled="!canEdit"
                value-key="label"
                class="w-full"
                @select="(opt) => pickMaterial(opt, field.kind === 'materialName' ? 'name' : 'code')"
              />

              <div v-else-if="field.kind === 'quantity'" class="flex items-center gap-2">
                <el-input
                  v-model="form.quantity"
                  inputmode="decimal"
                  placeholder="数量"
                  aria-label="需求数量"
                  :disabled="!canEdit"
                  class="!w-28"
                />
                <el-select
                  v-model="form.unit"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="单位"
                  aria-label="单位"
                  :disabled="!canEdit"
                  class="!w-24"
                >
                  <el-option v-for="u in UNIT_OPTIONS" :key="u" :label="u" :value="u" />
                </el-select>
                <button
                  v-if="canEdit && !isCreate"
                  type="button"
                  class="shrink-0 rounded-full border border-line px-2 py-1 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
                  title="把到货数量填成需求数量、到货日期填成今天"
                  @click.prevent="fillAllDelivered"
                >
                  全部到货
                </button>
              </div>

              <div v-else-if="field.kind === 'oaNoWithLink'" class="space-y-2">
                <el-input
                  v-model="form.oaNo"
                  :placeholder="field.placeholder"
                  aria-label="OA 单号"
                  :disabled="!canEdit"
                />
                <el-input
                  v-model="form.oaUrl"
                  placeholder="OA 表单链接（粘一次，之后可直接点开）"
                  aria-label="OA 表单链接"
                  :disabled="!canEdit"
                />

                <div class="flex items-center gap-2">
                  <el-select
                    v-model="form.orderType"
                    clearable
                    placeholder="单据类型"
                    aria-label="单据类型"
                    class="!w-[160px]"
                    :disabled="!canEdit"
                  >
                    <el-option label="CGSQ 采购申请" value="CGSQ" />
                    <el-option label="FWCGSQ 服务采购申请" value="FWCGSQ" />
                    <el-option label="ZCSG 资产申购" value="ZCSG" />
                  </el-select>
                  <button
                    v-if="canEdit && suggestedOrderType && suggestedOrderType !== form.orderType"
                    type="button"
                    class="rounded-full border border-line px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-900"
                    @click="form.orderType = suggestedOrderType"
                  >
                    按单号推断：{{ suggestedOrderType }}
                  </button>
                </div>

                <div class="space-y-2">
                  <el-input
                    v-model="form.poNo"
                    placeholder="采购单号（OA 采购订单）"
                    aria-label="采购单号"
                    :disabled="!canEdit"
                  />
                  <el-input
                    v-model="form.poUrl"
                    placeholder="采购单链接（粘贴后可直接点开）"
                    aria-label="采购单链接"
                    :disabled="!canEdit"
                  />
                </div>

                <div v-if="form.orderType !== 'CGSQ'" class="space-y-2">
                  <el-input
                    v-model="form.acceptanceNo"
                    placeholder="验收单号（填了就算已验收）"
                    aria-label="验收单号"
                    :disabled="!canEdit"
                  />
                  <el-input
                    v-model="form.acceptanceUrl"
                    placeholder="验收单链接（粘贴后可直接点开）"
                    aria-label="验收单链接"
                    :disabled="!canEdit"
                  />
                </div>
                <p v-else class="text-xs text-slate-500">
                  CGSQ（采购申请）一般没有验收单据；确实有就先把类型改掉再填。
                </p>
              </div>

              <DeliveryNoteUpload
                v-else-if="field.kind === 'image'"
                :value="form.deliveryNote"
                @update:value="(v) => (form.deliveryNote = v)"
              />
            </div>
          </div>

          <div
            v-if="group.title === '数量与到货' && !isCreate && editingRow"
            class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3"
          >
            <span class="text-sm text-slate-600">进度</span>
            <div class="flex items-center gap-2 text-sm">
              <span class="rounded-full px-2 py-0.5" :class="statusClass(editingRow.status)">
                {{ STATUS_TEXT[editingRow.status] || '等货' }}
              </span>
              <span class="text-xs text-slate-500">{{ dueHint(editingRow) || '由后端按到货日期判定' }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <template #footer>
      <!-- 单据视图：只读，底部只给"再加一条" -->
      <div v-if="isDocket" class="flex w-full items-center justify-between gap-3">
        <span class="text-[11px] tabular-nums text-slate-500">
          共 {{ docket.rows.length }} 条 · 最早提出 {{ docket.firstDate || '—' }}
        </span>
        <div class="flex items-center gap-2">
          <el-button @click="requestClose">关闭</el-button>
          <el-button v-if="canEdit" type="primary" @click="addLine">再加一条需求</el-button>
        </div>
      </div>

      <!-- 表单视图：改一条 -->
      <div v-else class="flex w-full items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <el-button v-if="cameFromDocket" plain @click="backToDocket">← 返回单据</el-button>
          <el-button v-if="canEdit && !isCreate && editingRow" type="danger" plain :disabled="saving" @click="onDelete">
            删除
          </el-button>
        </div>
        <div class="flex items-center gap-2">
          <el-button :disabled="saving" @click="requestClose">取消</el-button>
          <el-button v-if="canEdit" type="primary" :loading="saving" @click="submit">保存</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 弹窗内滚动不带动页面（全局 style.css 已有一条，这里按组件再兜一次） */
.purchase-dialog :deep(.el-dialog__body) {
  overscroll-behavior: contain;
}

/*
 * 内容入场：淡入 + 上移 4px，160ms（变更-151 从 420ms/12px 收紧）。
 * 只动 opacity / transform（合成层），不动 height / margin。
 */
.drawer-enter.is-entering {
  animation: purchase-dialog-enter 160ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes purchase-dialog-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .drawer-enter.is-entering {
    animation-duration: 1ms;
  }
}
</style>
