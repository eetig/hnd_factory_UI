<script setup>
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog } from 'element-plus'
import request from '../api/request'

/**
 * 核算钻取弹窗（变更-140，2026-10-21）。
 *
 * 使用方要求："工单核算页面也要做弹窗功能，入库数来自入库汇总，已报工数来自工单汇总"，
 * 并确认了五件事：按**产成品编码**匹配、两边**各用各的日期口径但后端支持日期参数**、
 * **逐条**明细、负数**照实展示**、"三个视图都做"。
 *
 * ## 这个弹窗回答的问题
 *
 * 表里一行 `入库数 51643 / 已报工数 55244 / 未报工数 -3601` —— 每一个数都要能"点开看组成"：
 *   · 入库数 ← 入库汇总 → 明细 = 入库单（按**入库日期**）
 *   · 已报工数 ← 工单汇总（确认的产量）→ 明细 = 工单（按**工单基本开始日期**）
 *   · 原辅料核算同理：领料数 ← 领料明细（领料日期）、已报工数 ← 货物移动（**过账日期**）
 *
 * ## 两段各自带"自检"
 *
 * 每段底部把明细合计与行上的数字比一次：一致就写"与行上一致"，不一致就明确说差多少。
 * 这不是装饰 —— 明细对不上汇总时，使用者第一反应就是"系统算错了"，
 * 先告诉他到底是"口径不同"还是"真有差"。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 核算表的行：{ materialName, materialCode, inboundQty|pickQty, reportedQty, unreportedQty, drill } */
  row: { type: Object, default: null },
  /** 'costing'（工单核算）| 'materialCosting'（原辅料核算） */
  mode: { type: String, default: 'costing' },
  startDate: { type: String, default: '' },
  endDate: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

/** 一次拉多少条：核算表一行涉及的明细很少（几十条），200 足够；超了会明确标注 */
const FETCH_PAGE_SIZE = 200

/** 把 '51,643' / '—' / null 这类显示值折成数字（拿不到就是 NaN，不假装是 0） */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return Number.NaN
  const text = String(value).replace(/[,，\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return Number.NaN
  return Number(text)
}

function formatQty(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('zh-CN')
}

const rangeText = computed(() => {
  const from = props.startDate
  const to = props.endDate
  if (!from && !to) return '全部'
  return `${from || '不限'} ~ ${to || '不限'}`
})

const title = computed(() =>
  props.mode === 'materialCosting' ? '原辅料核算 · 明细' : '工单核算 · 明细',
)

const sourceLabel = computed(() => (props.mode === 'materialCosting' ? '领料数' : '入库数'))

/**
 * 两段的定义。每段自己说清：数据从哪个接口来、按哪个日期口径、数量字段叫什么、
 * 要不要乘换算系数、要不要按库位筛。
 */
const sources = computed(() => {
  const row = props.row || {}
  const materialCode = String(row.materialCode ?? '').trim()
  const materialName = String(row.materialName ?? '').trim()

  if (props.mode === 'materialCosting') {
    /*
     * 原辅料核算有两类行，明细来源完全不同（配方由 useStatsData 挂在 row.drill 上）：
     *   · 基础行：领料看自己、报工看自己的货物移动，不换算；
     *   · 派生行（氯铂酸_171 这类）：领料来自**源物料** ×20，报工来自派生编码
     *     **且只算指定库位** 的货物移动 ×1000。
     *
     * ⚠️ 2026-10-21 实测踩过：派生行漏了「×1000 + 库位筛选」，明细 75 vs 行上 25，
     * 弹窗自己都判"对不上"。系数必须与 buildMaterialCostingRows 的算式同源。
     */
    const pick = row.drill?.pick || { materialCode, materialName, multiplier: 1 }
    const move = row.drill?.move || { materialCode, multiplier: 1 }
    const pickNote = `来源：领料汇总 · 按领料日期${
      pick.multiplier && pick.multiplier !== 1 ? ` · 行上的数已 ×${pick.multiplier} 换算` : ''
    }`
    const moveNote = `来源：货物移动 · 按过账日期（取绝对值）${
      move.fromLocation ? ` · 仅来源库位 ${move.fromLocation}` : ''
    }${move.multiplier && move.multiplier !== 1 ? ` · 行上的数已 ×${move.multiplier} 换算` : ''}`

    return [
      {
        key: 'pick',
        title: '领料明细',
        note: pickNote,
        url: '/api/pick/list',
        params: { materialCode: pick.materialCode, materialName: pick.materialName },
        qtyKey: 'pickQty',
        dateKey: 'pickDate',
        multiplier: pick.multiplier ?? 1,
        rowTotal: toNumber(row.pickQty),
        columns: [
          { key: 'documentNo', label: '单据号' },
          { key: 'pickDate', label: '领料日期' },
        ],
      },
      {
        key: 'move',
        title: '报工明细',
        note: moveNote,
        url: '/api/goods-move/list',
        params: { materialCode: move.materialCode },
        qtyKey: 'moveQty',
        dateKey: 'moveDate',
        absQty: true,
        multiplier: move.multiplier ?? 1,
        fromLocation: move.fromLocation || '',
        rowTotal: toNumber(row.reportedQty),
        columns: [
          { key: 'moveNo', label: '移动单号' },
          { key: 'moveDate', label: '过账日期' },
          { key: 'moveType', label: '移动类型' },
          { key: 'fromLocation', label: '来源库位' },
        ],
      },
    ]
  }

  return [
    {
      key: 'inbound',
      title: '入库明细',
      note: '来源：入库汇总 · 按入库日期',
      url: '/api/inbound/list',
      params: { materialCode, materialName },
      qtyKey: 'inboundQty',
      dateKey: 'inboundDate',
      multiplier: 1,
      rowTotal: toNumber(row.inboundQty),
      columns: [
        { key: 'documentNo', label: '单据号' },
        { key: 'inboundDate', label: '入库日期' },
      ],
    },
    {
      key: 'workorder',
      title: '报工明细',
      note: '来源：工单汇总（确认的产量）· 按工单基本开始日期',
      url: '/api/work-order/list',
      /*
       * 按**产成品编码**过滤（不是名称）：
       * 入库侧的物料名常是长包材名，工单侧的 material_desc 是另一种写法（空格/下划线差异）
       * —— 按名称查一条都查不到，而那一行的"已报工数"却有值（汇总是按编码对上的），
       * 使用者会以为明细丢了。
       */
      params: { materialCode: row.drill?.workorder?.materialCode || materialCode },
      qtyKey: 'confirmedQty',
      dateKey: 'planStartDate',
      unwrapKey: 'workOrder',
      multiplier: 1,
      rowTotal: toNumber(row.reportedQty),
      columns: [
        { key: 'orderNo', label: '工单号' },
        { key: 'planStartDate', label: '基本开始日期' },
      ],
    },
  ]
})

/** 每段拉回来的结果：{ loading, error, items, count, excluded, total, truncated } */
const sections = ref({})

function sectionOf(key) {
  return (
    sections.value[key] || {
      loading: false,
      error: '',
      items: [],
      count: 0,
      excluded: 0,
      total: 0,
      truncated: false,
    }
  )
}

async function loadSection(source) {
  sections.value = {
    ...sections.value,
    [source.key]: {
      loading: true,
      error: '',
      items: [],
      count: 0,
      excluded: 0,
      total: 0,
      truncated: false,
    },
  }

  try {
    const res = await request.get(source.url, {
      params: {
        ...source.params,
        startDate: props.startDate || undefined,
        endDate: props.endDate || undefined,
        pageNum: 1,
        pageSize: FETCH_PAGE_SIZE,
      },
    })

    const body = res.data || {}
    if (body.success === false) {
      throw new Error(body.msg || '接口返回异常')
    }

    const rawList = Array.isArray(body.dataList) ? body.dataList : []
    const mapped = rawList.map((item) => {
      const flat = source.unwrapKey ? item?.[source.unwrapKey] || item : item
      return flattenRow(flat, source)
    })

    // 来源库位筛选只能在客户端做（货物移动接口没有库位参数）—— 与表里口径一致，
    // 差额必须体现在"小计"上，否则自检会一直不平
    let items = mapped
    let excluded = 0
    if (source.fromLocation) {
      const wanted = String(source.fromLocation).trim()
      items = mapped.filter((item) => String(item.fromLocation ?? '').trim() === wanted)
      excluded = mapped.length - items.length
    }

    const sum = items.reduce((acc, item) => acc + (Number(item.__qty) || 0), 0)
    const total = Number(body.total) || mapped.length

    sections.value = {
      ...sections.value,
      [source.key]: {
        loading: false,
        error: '',
        items,
        count: items.length,
        excluded,
        total: sum,
        truncated: total > mapped.length,
      },
    }
  } catch (error) {
    sections.value = {
      ...sections.value,
      [source.key]: {
        loading: false,
        error: error?.response?.data?.msg || error?.message || '明细加载失败',
        items: [],
        count: 0,
        excluded: 0,
        total: Number.NaN,
        truncated: false,
      },
    }
  }
}

/**
 * 明细行拍平：数量取绝对值（货物移动的报工口径与表里一致）、按行上的口径换算、
 * 日期只留日期部分。
 */
function flattenRow(raw, source) {
  const qtyRaw = toNumber(raw?.[source.qtyKey])
  const base = Number.isNaN(qtyRaw) ? 0 : source.absQty ? Math.abs(qtyRaw) : qtyRaw
  const multiplier = Number(source.multiplier ?? 1) || 1
  const dateValue = source.dateKey ? String(raw?.[source.dateKey] ?? '') : ''

  return {
    ...raw,
    __rawQty: base,
    __qty: base * multiplier,
    [source.dateKey]: dateValue.slice(0, 10),
  }
}

function reload() {
  sections.value = {}
  for (const source of sources.value) {
    loadSection(source)
  }
}

watch(
  () => [props.modelValue, props.row, props.mode],
  ([visible]) => {
    if (visible) reload()
  },
  { immediate: true },
)

function close() {
  emit('update:modelValue', false)
}

/** 一段的自检结论：明细合计 vs 行上的数字 */
function checkText(source) {
  const section = sectionOf(source.key)
  if (section.loading || section.error) return ''
  const onRow = source.rowTotal
  if (Number.isNaN(onRow)) return '行上这个数是「—」（数据没拿到），明细合计仅供参考'
  const diff = section.total - onRow
  const excludedNote = section.excluded
    ? `（另有 ${section.excluded} 条属于其它库位，按表里的口径不计入）`
    : ''
  if (Math.abs(diff) < 0.0001) return `与行上一致（${formatQty(onRow)}）${excludedNote}`
  if (section.truncated) {
    return `明细只取了前 ${FETCH_PAGE_SIZE} 条，合计 ${formatQty(section.total)} ≠ 行上 ${formatQty(onRow)}，差额可能来自未取回的明细`
  }
  return `明细合计 ${formatQty(section.total)} 与行上 ${formatQty(onRow)} 差 ${formatQty(diff)} —— 口径可能不同（见上方每段的日期说明）${excludedNote}`
}

function checkOk(source) {
  const section = sectionOf(source.key)
  const onRow = source.rowTotal
  if (Number.isNaN(onRow)) return false
  return !section.loading && !section.error && Math.abs(section.total - onRow) < 0.0001
}

/** 底部差额：与表里的"未报工数"是同一个算式 */
const difference = computed(() => {
  const row = props.row || {}
  const base = props.mode === 'materialCosting' ? toNumber(row.pickQty) : toNumber(row.inboundQty)
  const reported = toNumber(row.reportedQty)
  if (Number.isNaN(base) || Number.isNaN(reported)) return { value: Number.NaN, text: '—' }
  return { value: base - reported, text: formatQty(base - reported) }
})

const negative = computed(() => !Number.isNaN(difference.value.value) && difference.value.value < 0)

const baseQty = computed(() => {
  const row = props.row || {}
  return props.mode === 'materialCosting' ? toNumber(row.pickQty) : toNumber(row.inboundQty)
})
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="min(1080px, 94vw)"
    append-to-body
    class="costing-drill-dialog"
    @update:model-value="close"
  >
    <div v-if="row" class="space-y-5">
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p class="text-sm font-semibold text-slate-800">
          {{ row.materialName || '（无名称）' }}
          <span v-if="row.materialCode" class="ml-2 font-mono text-xs text-slate-500">
            {{ row.materialCode }}
          </span>
        </p>
        <p class="text-xs text-slate-500">统计范围 {{ rangeText }}</p>
      </div>

      <section v-for="source in sources" :key="source.key" class="rounded-lg border border-line">
        <header class="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
          <h4 class="text-sm font-semibold text-slate-800">
            {{ source.title }}
            <span class="ml-2 text-xs font-normal text-slate-500">{{ source.note }}</span>
          </h4>
          <p class="text-sm text-slate-600">
            小计
            <span class="num ml-1 font-semibold text-slate-900">{{
              formatQty(sectionOf(source.key).total)
            }}</span>
            <span class="ml-3 text-xs text-slate-500">共 {{ sectionOf(source.key).count }} 条</span>
          </p>
        </header>

        <p v-if="sectionOf(source.key).loading" class="px-4 py-6 text-center text-sm text-slate-500">
          正在读取{{ source.title }}…
        </p>
        <p v-else-if="sectionOf(source.key).error" class="px-4 py-6 text-center text-sm text-amber-700">
          {{ source.title }}加载失败：{{ sectionOf(source.key).error }}
        </p>
        <p
          v-else-if="!sectionOf(source.key).items.length"
          class="px-4 py-6 text-center text-sm text-slate-500"
        >
          这个范围内没有{{ source.title }}（明细为空不等于数算错：可能来自其它日期口径，见上方说明）
        </p>
        <div v-else class="max-h-[240px] overflow-auto">
          <table class="w-full text-left text-sm">
            <thead class="sticky top-0 bg-surface text-xs text-slate-500">
              <tr>
                <th class="px-3 py-2 font-medium">序号</th>
                <th v-for="col in source.columns" :key="col.key" class="px-3 py-2 font-medium">
                  {{ col.label }}
                </th>
                <th class="px-3 py-2 text-right font-medium">数量</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(item, index) in sectionOf(source.key).items"
                :key="`${source.key}-${index}`"
                class="border-t border-line"
              >
                <td class="px-3 py-1.5 text-xs text-slate-500">{{ index + 1 }}</td>
                <td v-for="col in source.columns" :key="col.key" class="px-3 py-1.5 text-slate-700">
                  {{ item[col.key] || '—' }}
                </td>
                <td class="num px-3 py-1.5 text-right text-slate-700">
                  {{ formatQty(item.__qty) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p
          v-if="checkText(source)"
          class="border-t border-line px-4 py-2 text-xs"
          :class="checkOk(source) ? 'text-slate-600' : 'text-amber-700'"
        >
          {{ checkText(source) }}
        </p>
      </section>

      <div class="rounded-lg bg-region px-4 py-3 text-sm">
        <p class="text-slate-700">
          {{ sourceLabel }}
          <span class="num font-semibold">{{ formatQty(baseQty) }}</span>
          − 已报工数
          <span class="num font-semibold">{{ formatQty(toNumber(row.reportedQty)) }}</span>
          = 未报工数
          <span class="num font-semibold" :class="negative ? 'text-amber-800' : 'text-slate-900'">
            {{ difference.text }}
          </span>
        </p>
        <p v-if="negative" class="mt-1 text-xs text-amber-700">
          已报工数大于{{ sourceLabel }}：工单报工的确认产量里，有一部分还没入库（在制/待检）。
          这不是算错 —— 想核清楚就看上面两段的日期口径是否覆盖同一批产出。
        </p>
      </div>
    </div>

    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>
