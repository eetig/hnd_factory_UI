<script setup>
import { computed, ref, watch } from 'vue'
import { ElDialog, ElMessage, ElPagination } from 'element-plus'
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
  // 投料列现在是"物料名 + 数量"的清单，必须给宽度（原来只有 104px 放个总数）
  { key: 'materials', label: '投料（物料 · 净重）', width: 'w-[300px]' },
  { key: 'perUnit', label: '单耗', width: 'w-[76px]', align: 'right' },
]

/**
 * 点击复制（使用方 2026-10-31：「点击工单号，数量，可以复制」，并明确要**单击**）。
 *
 * 我原来做成双击（怕打断拖选），使用方选了单击 —— 那就单击：
 * 单元格仍保留 `select-text`，需要拖选一段时照样能选（只是单击会先复制一次）。
 *
 * 降级：navigator.clipboard 在非 https / 老浏览器下不可用，退到 execCommand('copy')；
 * 两者都失败时明确告诉他"复制失败"，不假装成功（宁可报错，也别让他粘出旧内容）。
 */
async function copyText(value, label = '内容') {
  const text = value === null || value === undefined ? '' : String(value)
  if (!text || text === '—') {
    ElMessage.info(`${label}为空，没有可复制的内容`)
    return
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const input = document.createElement('textarea')
      input.value = text
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(input)
      if (!ok) throw new Error('execCommand copy 返回 false')
    }
    ElMessage.success(`已复制${label}：${text}`)
  } catch {
    ElMessage.error(`复制失败，请手动选中${label}后按 Ctrl+C`)
  }
}

/** 展开中的工单号（点行切换）；展开区显示按物料的投料明细 */
const expanded = ref('')

function toggleExpand(row) {
  if (!row?.material?.items?.length) return
  expanded.value = expanded.value === row.orderNo ? '' : row.orderNo
}

/*
 * 投料列：显示**具体物料名**（使用方 2026-10-31：'投料改为具体物料名称：比如电石，次钠等'）。
 *
 * 之前只给一个净投料总数（9,554.8 KG），看不出投的是哪几种料 —— 而这张表就是给核算看的，
 * 光有总数没法判断配比。
 *
 * 形如：`电石 8,443 · 次氯酸钠 978.8 · 无水氯化钙 133`（数量默认不重复单位，
 * 列尾统一标一次；单位不一致时每个物料各自带单位）。
 *
 * **全部铺开**（使用方 2026-10-31 明确：'全部铺开'）—— 不再截断成"前 4 种 + 等 N 种"。
 * 好处是不用展开就能看到全部投料；成本是投料种类特别多时这一行会换行变高，
 * 弹层本身可滚动，可以接受。
 */
function materialText(m) {
  if (!m?.items?.length) return '—'
  const items = [...m.items].sort((a, b) => (Number(b.qty) || 0) - (Number(a.qty) || 0))
  const show = items
  const parts = show.map((item) => {
    const name = shortMaterialName(item.materialDesc, item.materialCode)
    const qty = Number(item.qty)
    const qtyText = Number.isFinite(qty)
      ? qty.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
      : ''
    // 单位一致（绝大多数工单是 KG）时不逐项重复，省得一行太长
    return m.mixedUnit && item.unit ? `${name} ${qtyText}${item.unit}` : `${name} ${qtyText}`
  })
  let text = parts.join(' · ')
  // 全部铺开：不再追加「等 N 种」
  if (!m.mixedUnit && m.unit) text += ` (${m.unit})`
  return text
}

/** 物料名太长时截断（弹层是表格，一行放不下 22 个字的名字） */
function shortMaterialName(desc, code) {
  const name = String(desc ?? '').trim() || String(code ?? '').trim()
  if (!name) return '未知物料'
  return name.length > 12 ? `${name.slice(0, 12)}…` : name
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
              <!--
                行本身**不再可点**（使用方 2026-10-31：'点击最前面的小三角展开明细'）。
                两个原因：
                  · 整行可点会连带一个 focus 描边，看起来是"红框"，很难看；
                  · 整行可点还会挡住文字选中 —— 而使用方要能直接复制工单号、数量。
                所以可点区域收窄到最前面的小三角（真正的 <button>，键盘天然可达）。
              -->
              <tr class="border-b border-line transition hover:bg-region/60">
                <td class="px-2 py-2 text-slate-900">
                  <span class="flex items-center gap-1">
                    <button
                      v-if="row.material?.items?.length"
                      type="button"
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-slate-500 transition hover:bg-region hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                      :aria-expanded="expanded === row.orderNo ? 'true' : 'false'"
                      :aria-label="`展开工单 ${row.orderNo} 的投料明细`"
                      @click="toggleExpand(row)"
                    >
                      {{ expanded === row.orderNo ? '▾' : '▸' }}
                    </button>
                    <span v-else class="inline-block h-5 w-5 shrink-0"></span>
                    <!-- 工单号：单击即复制（使用方 2026-10-31 明确要单击）。
                         用 <button> 而不是 <span>：可点元素带键盘通路是仓库的硬规矩
                         （变更-033 守卫会拦 span 缺 role/tabindex/keydown）。 -->
                    <button
                      type="button"
                      class="cursor-copy select-text rounded px-0.5 text-left transition hover:bg-region focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                      title="点击复制工单号"
                      @click="copyText(row.orderNo, '工单号')"
                    >{{ row.orderNo }}</button>
                  </span>
                </td>
                <td class="px-2 py-2 whitespace-nowrap text-slate-600">{{ row.planStartDate || '—' }}</td>
                <td
                  class="cursor-copy select-text px-2 py-2 text-right text-slate-900"
                  title="点击复制"
                  @click="copyText(row.orderQty, '订单数量')"
                >{{ fmt(row.orderQty) }}</td>
                <td
                  class="cursor-copy select-text px-2 py-2 text-right text-slate-900"
                  title="点击复制"
                  @click="copyText(row.confirmedQty, '确认的产量')"
                >{{ fmt(row.confirmedQty) }}</td>
                <td
                  class="cursor-copy select-text px-2 py-2 text-right text-slate-600"
                  title="点击复制"
                  @click="copyText(row.deliveredQty, '已交货数量')"
                >{{ fmt(row.deliveredQty) }}</td>
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
                        {{ item.materialDesc || '—' }}
                        <span class="ml-1 text-slate-500">{{ item.materialCode }}</span>
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
