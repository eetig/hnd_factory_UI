<script setup>
import { computed, ref, watch } from 'vue'
import { ElDialog, ElPagination } from 'element-plus'
import request from '../api/request'
import { STATUS_TEXT } from '../constants/statusTones'
import { useOrderFilter } from '../composables/useOrderFilter'

/**
 * 工单明细弹窗（变更-126e）：点「核算 → 工单报工」的一行，看这一行由哪些工单组成。
 *
 * ## 筛选口径（使用方 2026-10-20 确认）
 *
 * 一行 = **工单类型（工单号前 4 位）+ 产成品** 的服务端聚合。所以明细 = **同类型 + 同产成品**，
 * 而且**不限日期** —— 因为那一行的汇总（`/api/work-order/summary-by-type-material`）本身
 * 就是全量聚合，加日期反而会让"明细加起来 ≠ 行上的数字"。
 *
 * ## 为什么把全量拉进内存再前端分页
 *
 * 使用方要两件事同时成立：① 弹窗里 20 条/页；② 底部有个合计，且**等于行上的订单数量**（自检）。
 * 服务端分页拿不到全量合计，所以这里按 200/页把全量拉下来（最多 10 页 = 2000 张工单，
 * 超过就只合计已拉到的并明确标注），然后前端分页 —— 数据量本来就小（几十张），一次拉完最省事。
 *
 * ## 那个"自检"是重点
 *
 * 底部会拿明细合计与行上的订单数量比：一致 → 绿字"与汇总一致"；不一致 → 琥珀字提示。
 * 这不是装饰：明细对不上汇总时，使用者第一反应就是"系统算错了"，先告诉他到底哪边不对。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  typeKey: { type: String, default: '' },
  typeLabel: { type: String, default: '' },
  materialDesc: { type: String, default: '' },
  /** 行上的订单数量（数字），用于底部自检 */
  summaryQty: { type: Number, default: null },
})

const emit = defineEmits(['update:modelValue'])

const COLUMNS = [
  { key: 'orderNo', label: '工单号', width: 'w-[130px]' },
  { key: 'planStartDate', label: '基本开始日期', width: 'w-[116px]' },
  { key: 'orderQty', label: '订单数量', width: 'w-[96px]', align: 'right' },
  { key: 'confirmedQty', label: '确认的产量', width: 'w-[96px]', align: 'right' },
  { key: 'deliveredQty', label: '已交货数量', width: 'w-[96px]', align: 'right' },
  /*
   * 投料与单耗（2026-10-31，变更-172）。
   *
   * 使用方：「工单详情页面，要显示投料情况」。
   * 投料来自 `material_movement` 的 261/262（不是领料单 —— 领料单里没有工单号），
   * 后端 `/api/work-order/materials` 已经按工单聚合成净投料。
   * 单耗 = 净投料 ÷ 确认的产量，单位一致时才有意义（mixedUnit 时只显示 "—"）。
   */
  { key: 'materials', label: '投料', width: 'w-[104px]', align: 'right' },
  { key: 'perUnit', label: '单耗', width: 'w-[76px]', align: 'right' },
]

/** 展开中的工单号（点行切换）；展开区显示按物料的投料明细 */
const expanded = ref('')

function toggleExpand(row) {
  if (!row?.material?.items?.length) return
  expanded.value = expanded.value === row.orderNo ? '' : row.orderNo
}

/** 投料显示：净投料 + 单位；混合单位时只给"多种物料" */
function materialText(m) {
  if (!m) return '—'
  if (m.mixedUnit) return `${m.materialCount} 种`
  const n = Number(m.net)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}${m.unit ? ' ' + m.unit : ''}`
}

/** 单耗：净投料 ÷ 确认产量；缺任意一边或单位混合就不给（宁可不显示，也不给错数） */
function perUnitText(row) {
  const m = row?.material
  const out = Number(row?.confirmedQty)
  if (!m || m.mixedUnit || !Number.isFinite(out) || out <= 0) return '—'
  const n = Number(m.net)
  if (!Number.isFinite(n)) return '—'
  return (n / out).toFixed(2)
}

/*
 * 日期区间取**工单组共享的那一份**（模块级 ref，见 useOrderFilter 的注释）。
 *
 * ⚠️ 这一条是被使用方纠正过的（2026-10-20）：
 * 我第一版按"不限日期"查，弹窗合计出 218,065（库里乙炔全部 46 张），
 * 而行上是 22,000 —— 使用方明确"行上的 22,000 是对的"。
 * 原因：那一行的汇总 `/api/work-order/summary-by-type-material` 带的是
 * `dateRangeParams()`，默认范围是「本月 1 号 ~ 今天」；我漏了这个参数，
 * 于是明细把**范围外**的工单也算进来了。
 * 所以这里必须与汇总用同一个区间 —— 明细与行上数字才能对得上。
 */
const { startDate, endDate } = useOrderFilter()

/** 弹窗里写出来的统计范围（不要让"筛选"是隐形的） */
const rangeText = computed(() => {
  const from = startDate.value
  const to = endDate.value
  if (!from && !to) return '全部'
  return `${from || '不限'} ~ ${to || '不限'}`
})

const PAGE_SIZE = 20
/** 一次拉多少、最多拉几页（防病态数据把浏览器打爆） */
const FETCH_PAGE_SIZE = 200
const MAX_PAGES = 10

const rows = ref([])
const loading = ref(false)
const error = ref('')
const pageNum = ref(1)
const truncated = ref(false)

const totalQty = computed(() =>
  rows.value.reduce((sum, row) => sum + (Number(row.orderQty) || 0), 0),
)

/** 与行上的汇总比：一致 / 不一致 / 无从比较（截断或没给汇总） */
const check = computed(() => {
  if (truncated.value || props.summaryQty === null || props.summaryQty === undefined) {
    return null
  }
  return Math.abs(totalQty.value - Number(props.summaryQty)) < 0.0001
})

const pagedRows = computed(() => {
  const start = (pageNum.value - 1) * PAGE_SIZE
  return rows.value.slice(start, start + PAGE_SIZE)
})

function fmt(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return value ?? ''
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
}

/**
 * 批量取投料（一次请求多张工单，不按行发请求）。
 * 失败**不阻塞**明细：投料那一列显示「—」，并在弹层里给一句提示 ——
 * 明细本身有用，不能因为投料接口挂了整张表不可读。
 */
const materialError = ref('')

async function loadMaterials(list) {
  materialError.value = ''
  const orderNos = list.map((r) => r?.orderNo).filter(Boolean)
  if (!orderNos.length) return
  try {
    const { data } = await request.get('/api/work-order/materials', {
      params: { orderNos: orderNos.slice(0, 200).join(',') },
    })
    const map = data?.data && typeof data.data === 'object' ? data.data : {}
    rows.value = rows.value.map((row) => ({ ...row, material: map[row.orderNo] || null }))
  } catch (e) {
    materialError.value = e?.response?.data?.msg || e?.message || '投料加载失败'
  }
}

/** 拉全量（有上限）。失败时保留错误文案，弹窗里显示，不静默空表。 */
async function load() {
  rows.value = []
  error.value = ''
  truncated.value = false
  pageNum.value = 1
  if (!props.typeKey || !props.materialDesc) return

  loading.value = true
  try {
    let fetched = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await request.get('/api/work-order/list', {
        params: {
          type: props.typeKey,
          materialDesc: props.materialDesc,
          pageNum: page,
          pageSize: FETCH_PAGE_SIZE,
          // 与汇总同一区间（空则不带 —— 与 useWorkOrderData#dateRangeParams 的写法保持一致）
          ...(startDate.value ? { startDate: startDate.value } : {}),
          ...(endDate.value ? { endDate: endDate.value } : {}),
        },
      })
      const list = Array.isArray(data?.dataList) ? data.dataList : []
      /*
       * ⚠️ 接口返回的是**嵌套**结构：{ workOrder: {...}, imageList: [] }。
       * 字段在 workOrder 里面 —— 直接读 item.orderNo 会全是 undefined，表现为"每格都是 —"。
       * 这里照 useWorkOrderData#normalizeWorkOrder 的做法拍平；item.workOrder 缺失时兜底用 item 本身，
       * 免得接口哪天改成扁平结构就整张表空掉。
       */
      fetched = fetched.concat(list.map((item) => item?.workOrder || item))
      const total = Number(data?.total) || 0
      if (fetched.length >= total || list.length === 0) {
        break
      }
      if (page === MAX_PAGES) {
        truncated.value = fetched.length < total
      }
    }
    rows.value = fetched
    await loadMaterials(fetched)
  } catch (e) {
    error.value = e?.response?.data?.msg || e?.message || '加载明细失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load()
  },
  { immediate: true },
)
</script>

<template>
  <el-dialog
    append-to-body
    :model-value="modelValue"
    :title="`${typeLabel || ''} · ${materialDesc || ''}`"
    width="900px"
    align-center
    class="work-order-detail-dialog"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <p v-if="error" role="alert" class="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
      {{ error }}
    </p>
    <p v-if="materialError" class="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      投料数没取到（{{ materialError }}）—— 工单明细仍然可用，投料列显示「—」
    </p>

    <div class="max-h-[60vh] overflow-auto">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-line text-left text-xs font-medium text-slate-500">
            <th v-for="col in COLUMNS" :key="col.key" scope="col"
                class="whitespace-nowrap px-2 py-2" :class="[col.width, col.align === 'right' ? 'text-right' : '']">
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td :colspan="COLUMNS.length" class="px-2 py-10 text-center text-sm text-slate-500">加载中…</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td :colspan="COLUMNS.length" class="px-2 py-10 text-center text-sm text-slate-500">
              这段时间里没有匹配的工单
            </td>
          </tr>
          <template v-else>
            <template v-for="row in pagedRows" :key="row.orderNo">
              <!-- 整行可点 ⇒ 必须同时能被键盘激活（仓库的变更-033 守卫会拦） -->
              <tr
                class="border-b border-line transition"
                :class="row.material?.items?.length ? 'cursor-pointer hover:bg-region focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-ink' : ''"
                :tabindex="row.material?.items?.length ? 0 : -1"
                @click="toggleExpand(row)"
                @keydown.enter.prevent="toggleExpand(row)"
                @keydown.space.prevent="toggleExpand(row)"
              >
                <td class="px-2 py-2 text-slate-900">
                  <span v-if="row.material?.items?.length" class="mr-1 text-xs text-slate-500">
                    {{ expanded === row.orderNo ? '▾' : '▸' }}
                  </span>
                  {{ row.orderNo }}
                </td>
                <td class="px-2 py-2 whitespace-nowrap text-slate-600">{{ row.planStartDate || '—' }}</td>
                <td class="px-2 py-2 text-right text-slate-900">{{ fmt(row.orderQty) }}</td>
                <td class="px-2 py-2 text-right text-slate-900">{{ fmt(row.confirmedQty) }}</td>
                <td class="px-2 py-2 text-right text-slate-600">{{ fmt(row.deliveredQty) }}</td>
                <td class="px-2 py-2 text-right text-slate-900">{{ materialText(row.material) }}</td>
                <td class="px-2 py-2 text-right text-slate-600">
                  {{ perUnitText(row) }}
                  <span v-if="perUnitText(row) !== '—'" class="ml-0.5 text-xs text-slate-500">
                    {{ row.material?.unit }}/{{ row.material?.unit }}
                  </span>
                </td>
              </tr>
              <!-- 展开：按物料的投料明细（261/262 相抵后的净重） -->
              <tr v-if="expanded === row.orderNo" class="border-b border-line bg-region">
                <td :colspan="COLUMNS.length" class="px-3 py-3">
                  <p class="mb-2 text-xs text-slate-500">
                    投料明细 · 净重（261 投料与 262 冲销相抵，按物料汇总）
                  </p>
                  <div class="grid gap-1">
                    <div
                      v-for="item in row.material.items"
                      :key="item.materialCode"
                      class="flex items-center justify-between rounded-md border border-line bg-raised px-3 py-1.5 text-xs"
                    >
                      <span class="min-w-0 truncate text-slate-700">
                        {{ item.materialCode }} · {{ item.materialDesc || '—' }}
                      </span>
                      <span class="ml-3 shrink-0 tabular-nums text-slate-900">
                        {{ fmt(item.qty) }} {{ item.unit || '' }}
                        <span class="ml-1 text-slate-500">
                          {{ item.issueRows }} 笔{{ item.reversed ? ' · 有冲销' : '' }}
                        </span>
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
        <tfoot v-if="rows.length">
          <tr class="border-t border-line bg-region">
            <td colspan="2" class="px-2 py-2 text-sm font-semibold text-slate-900">
              合计
              <span class="ml-2 text-xs font-normal text-slate-500">共 {{ rows.length }} 张工单</span>
            </td>
            <td class="px-2 py-2 text-right text-sm font-semibold text-slate-900">{{ fmt(totalQty) }}</td>
            <td colspan="2" class="px-2 py-2 text-right text-xs">
              <span v-if="check === true" :class="STATUS_TEXT.success">✓ 与汇总一致</span>
              <span v-else-if="check === false" class="text-amber-600">
                ⚠️ 与行上的 {{ fmt(summaryQty) }} 不一致
              </span>
              <span v-else-if="truncated" class="text-amber-600">⚠️ 工单太多，只合计了前 {{ rows.length }} 张</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="mt-3 flex items-center justify-between gap-3">
      <span class="text-xs text-slate-500">
        口径：同工单类型 + 同产成品 · 统计范围 {{ rangeText }}（与汇总同一区间）
      </span>
      <el-pagination
        v-model:current-page="pageNum"
        :page-size="PAGE_SIZE"
        :total="rows.length"
        layout="prev, pager, next"
        background
        small
        :hide-on-single-page="true"
      />
    </div>
  </el-dialog>
</template>
