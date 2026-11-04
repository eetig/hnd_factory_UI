<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElDatePicker, ElInput, ElMessage, ElOption, ElSelect } from 'element-plus'
import request from '../../api/request'

/*
 * 电费抄表（2026-11-02，第一阶段：只记录）。
 *
 * 使用方：「我想先考虑记录，计算之后再处理。」
 * 所以这一页**不算钱**：不预提、不分摊、没有电价与金额 —— 只有抄表录入、台账、历史。
 *
 * ## 为什么是"一张 37 行的表"
 * 现场抄表是拿着本子走一圈、回来一次性录入。所以入口是「选一天 → 37 行 → 填读数 → 保存」，
 * 不是"一次录一块表"。每行只给三样：上次读数（参照）、本次读数（输入）、用量（预览）。
 *
 * ## 用量谁算
 * 服务端算（(本次 − 上次) × 倍率），前端只是即时预览。
 * 两个客户端算法不同就会有两种用量，所以存库以服务端为准。
 *
 * ## 关于"每周五抄，但有时别的时间"
 * 日期是**自由**的（不绑周）；用量永远等于"跟这块表**上一次**记录之间的差"。
 * 所以某周漏抄一次、或隔两天补抄，用量照样对，只是那一格的区间变长。
 */
const view = ref('entry') // entry | ledger | history

const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')

const meters = ref([])
const sections = ref([])

const entryDate = ref(new Date().toISOString().slice(0, 10))
const sheet = ref([])
const drafts = ref({})

/* ===== 矩阵视图（2026-11-03）===== */
const matrixMonth = ref(new Date().toISOString().slice(0, 7))
const matrixRows = ref([]) // 抄表记录（date, excelNo, meterName, section, usageQty…）
const matrixLoading = ref(false)
/** 单元格显示什么：用量（默认）| 读数 */
const matrixMode = ref('usage')

/** 行怎么排：day = 按天（默认）| period = 按抄表期（使用方周报的形状） */
const matrixRowMode = ref('day')
const periodData = ref({ periods: [], cells: {}, periodTotal: {} })
const periodLoading = ref(false)

async function loadPeriods() {
  periodLoading.value = true
  try {
    const [y, m] = matrixMonth.value.split('-').map(Number)
    const total = new Date(y, m, 0).getDate()
    const res = await request.get('/api/electricity/periods', {
      params: { from: `${matrixMonth.value}-01`, to: `${matrixMonth.value}-${String(total).padStart(2, '0')}` },
    })
    periodData.value = res.data?.data || { periods: [], cells: {}, periodTotal: {} }
  } catch (e) {
    periodData.value = { periods: [], cells: {}, periodTotal: {} }
    ElMessage.error(e?.response?.data?.msg || e?.message || '加载失败')
  } finally {
    periodLoading.value = false
  }
}

/** 按期的行（每个期间的最后一天 + 该期用量） */
const periodRows = computed(() =>
  (periodData.value.periods || []).map((date) => ({
    date,
    label: date.slice(5),
    values: periodData.value.cells?.[date] || {},
    total: periodData.value.periodTotal?.[date] ?? null,
  })),
)

function periodCell(row, meter) {
  const value = row.values?.[meter.meterNo]
  return value === undefined || value === null ? '' : fmtNum(value)
}


/*
 * 归属色：与全站那套同一组（赭/苔/靛/陶/青/石墨）。
 * 只用在表头组名的色条与组间分隔线，单元格保持中性 —— 数字要读，不能被彩色干扰。
 */
const SECTION_COLORS = ['#8A5A2B', '#5B6E4F', '#4A5A7B', '#7A4B5E', '#3F6E6A', '#5B6470']

function sectionColor(name) {
  if (!name) return '#5B6470'
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997
  return SECTION_COLORS[hash % SECTION_COLORS.length]
}

/** 当月天数 + 每天是周几（用来画"周末淡底"） */
const monthDays = computed(() => {
  const [y, m] = matrixMonth.value.split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  const out = []
  for (let d = 1; d <= total; d += 1) {
    const date = `${matrixMonth.value}-${String(d).padStart(2, '0')}`
    const dow = new Date(y, m - 1, d).getDay()
    out.push({ date, day: d, weekend: dow === 0 || dow === 6 })
  }
  return out
})

/*
 * 列的车间顺序（2026-11-03 使用方草图）：
 *   公用工程 → 一车间 → 二车间 → 乙炔车间
 * 同车间内按内部顺序（meter_no）排。
 *
 * 注意：这与"按编号排"是两回事 —— 编号会因此在表里跳（例如公用工程里出现 1,2,3,4,5,20,21…）。
 * 使用方要的是"按车间看"，编号只作为列头的标识，所以顺序按车间。
 */
/*
 * 列的车间顺序（2026-11-04 使用方定稿）：按他 Excel 汇总表的列顺序。
 * 总表与变压器放在最后 —— 它们是上游表，算分摊时不用，只作校验。
 */
/*
 * 列顺序（2026-11-04 使用方定稿：只合计 4 项）
 *   公用工程（含中控/污水/办公/其他）· 一车间（2#+4#）· 二车间（1#）· 乙炔
 * 总表与变压器放最后，只作校验。
 */
const SECTION_ORDER = ['公用工程', '一车间', '二车间', '乙炔车间', '总表', '变压器']

function sectionRank(name) {
  const index = SECTION_ORDER.indexOf(name || '')
  return index === -1 ? SECTION_ORDER.length : index
}

/** 列 = 电表：先按车间聚，再按内部顺序 */
const matrixMeters = computed(() =>
  meters.value
    .map((m) => ({ ...m }))
    .sort((a, b) => {
      const diff = sectionRank(a.section) - sectionRank(b.section)
      if (diff !== 0) return diff
      return (a.meterNo || 0) - (b.meterNo || 0)
    }),
)

/** 分组：连续相同 section 归一组，用于表头第一行跨列 */
const matrixGroups = computed(() => {
  const groups = []
  const seen = new Set()
  for (const meter of matrixMeters.value) {
    const name = meter.section || '未分组'
    const last = groups[groups.length - 1]
    if (last && last.name === name) {
      last.span += 1
      last.meters.push(meter)
      continue
    }
    /*
     * 同一个归属在表里会**分段出现**：Excel 是按编号排的，不是按车间排的
     * （「公用工程」在 3、24、29、33、35 号各出现一次）。
     * 组名只在**第一次**出现时写，后面重复的段只留一条色线 ——
     * 否则表头会出现一排重复的"公用工程 公用工程 公用工程"。
     */
    /*
     * 列已按车间聚在一起，每段必然只有一个车间 ⇒ 组名直接写。
     * （之前按编号排时同一车间会分段出现，所以才需要"首次才写"；现在不需要了，
     *   但仍保留 label 字段，模板不用改。）
     */
    groups.push({
      name,
      label: name,
      first: !seen.has(name),
      span: 1,
      color: sectionColor(name),
      meters: [meter],
    })
    seen.add(name)
  }
  return groups
})

/** 单元格索引：date → meterId → 记录 */
const matrixIndex = computed(() => {
  const index = new Map()
  for (const row of matrixRows.value) {
    const date = String(row.readDate || '').slice(0, 10)
    if (!date) continue
    if (!index.has(date)) index.set(date, new Map())
    index.get(date).set(row.meterNo, row)
  }
  return index
})

function cellOf(date, meter) {
  return matrixIndex.value.get(date)?.get(meter.meterNo) || null
}

function cellNumber(date, meter) {
  const cell = cellOf(date, meter)
  if (!cell) return null
  const value = matrixMode.value === 'usage' ? cell.usageQty : cell.reading
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function cellText(date, meter) {
  const n = cellNumber(date, meter)
  if (n === null) return ''
  const rounded = Math.round(n)
  return String(rounded)
}

/** 异常：负数（换表/抄错）或明显偏大 —— 只在"用量"模式下判断 */
function cellTone(date, meter) {
  if (matrixMode.value !== 'usage') return ''
  const n = cellNumber(date, meter)
  if (n === null) return ''
  if (n < 0) return 'is-regress'
  if (n > 20000) return 'is-big'
  return ''
}

/** 当天合计（用量模式才有意义） */
function dayTotal(date) {
  if (matrixMode.value !== 'usage') return null
  let sum = 0
  let filled = 0
  for (const meter of matrixMeters.value) {
    const n = cellNumber(date, meter)
    if (n !== null) {
      sum += n
      filled += 1
    }
  }
  return filled ? sum : null
}

async function loadMatrix() {
  matrixLoading.value = true
  try {
    const [y, m] = matrixMonth.value.split('-').map(Number)
    const total = new Date(y, m, 0).getDate()
    const from = `${matrixMonth.value}-01`
    const to = `${matrixMonth.value}-${String(total).padStart(2, '0')}`
    const res = await request.get('/api/electricity/readings', { params: { from, to } })
    matrixRows.value = res.data?.data || []
  } catch (e) {
    matrixRows.value = []
    ElMessage.error(e?.response?.data?.msg || e?.message || '加载失败')
  } finally {
    matrixLoading.value = false
  }
}

/* ===== 粘贴导入 + 分类汇总（2026-11-03）===== */
const importOpen = ref(false)
const importText = ref('')
const importing = ref(false)
const importHint = ref('')

/* ===== 预提分摊（2026-11-04）===== */
const shareRange = ref({ from: '', to: '' })
const shareRows = ref([])
const shareLoading = ref(false)
/** 预提总额（默认取使用方 Excel 里的 160000） */
const shareTotal = ref(160000)
/** 手工预提（组名 → 金额），留空表示按占比自动算 */
const shareManual = ref({})

/*
 * 电价档位（2026-11-04 使用方口径）：
 *   总电量 ≤ 10 万 kWh  ⇒ 全额 × 1.1
 *   10 ~ 20 万 kWh      ⇒ 全额 × 0.9
 *   > 20 万 kWh         ⇒ 全额 × 0.72
 * 是"按总电量命中一档、全额乘该档单价"，不是把电量拆成三段分别乘。
 * 三个上限与单价都可改（每年电价调整时改这里，不用改代码）。
 */
const priceTiers = ref([
  { upTo: 100000, price: 1.1 },
  { upTo: 200000, price: 0.9 },
  { upTo: null, price: 0.72 },
])

/** 按总电量命中哪一档 */
const matchedTier = computed(() => {
  const total = shareSum.value
  for (const tier of priceTiers.value) {
    if (tier.upTo === null || total <= Number(tier.upTo)) return tier
  }
  return priceTiers.value[priceTiers.value.length - 1]
})

const unitPrice = computed(() => Number(matchedTier.value?.price || 0))

/** 理论电费 = 总电量 × 命中档单价 */
const theoryFee = computed(() => shareSum.value * unitPrice.value)

const SHARE_UPSTREAM = ['总表', '变压器']

const shareBase = computed(() => shareRows.value.filter((r) => !SHARE_UPSTREAM.includes(r.section)))

const shareSum = computed(() => shareBase.value.reduce((sum, r) => sum + Number(r.usageQty || 0), 0))

const sharePlan = computed(() => {
  const total = Number(shareTotal.value) || 0
  const sum = shareSum.value || 1
  return shareBase.value.map((row) => {
    const usage = Number(row.usageQty || 0)
    const ratio = usage / sum
    const byUsage = ratio * total
    const manualRaw = shareManual.value[row.section]
    const manual = manualRaw === '' || manualRaw === undefined || manualRaw === null ? null : Number(manualRaw)
    return {
      section: row.section,
      usage,
      ratio,
      byUsage,
      manual,
      final: manual === null ? byUsage : manual,
      diff: manual === null ? 0 : manual - byUsage,
      // 这组的电费 = 用量 × 命中档单价（全厂同一个单价）
      fee: usage * unitPrice.value,
    }
  })
})

const shareManualTotal = computed(() => sharePlan.value.reduce((sum, r) => sum + r.final, 0))

async function loadShare() {
  shareLoading.value = true
  try {
    const params = {}
    if (shareRange.value.from) params.from = shareRange.value.from
    if (shareRange.value.to) params.to = shareRange.value.to
    const res = await request.get('/api/electricity/summary', { params })
    shareRows.value = res.data?.data || []
  } catch (e) {
    shareRows.value = []
    ElMessage.error(e?.response?.data?.msg || e?.message || '加载失败')
  } finally {
    shareLoading.value = false
  }
}

const summaryRange = ref({ from: '', to: '' })
const summaryRows = ref([])
const summaryLoading = ref(false)

async function doImport() {
  if (!importText.value.trim()) {
    importHint.value = '先把 Excel 里那几行复制粘贴进来'
    return
  }
  importing.value = true
  importHint.value = ''
  try {
    const res = await request.post('/api/electricity/readings/import', { text: importText.value })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '导入失败')
    const data = body.data || {}
    const warnings = data.warnings || []
    importHint.value = `已保存 ${data.saved ?? 0} 条读数` + (warnings.length ? `；${warnings.length} 行有问题：${warnings[0]}` : '')
    if (!warnings.length) {
      importOpen.value = false
      importText.value = ''
      await loadSheet()
      await loadSummary()
      ElMessage.success('导入完成')
    }
  } catch (e) {
    importHint.value = e?.response?.data?.msg || e?.message || '导入失败'
  } finally {
    importing.value = false
  }
}

async function loadSummary() {
  summaryLoading.value = true
  try {
    const params = {}
    if (summaryRange.value.from) params.from = summaryRange.value.from
    if (summaryRange.value.to) params.to = summaryRange.value.to
    const res = await request.get('/api/electricity/summary', { params })
    summaryRows.value = res.data?.data || []
  } catch (e) {
    summaryRows.value = []
    ElMessage.error(e?.response?.data?.msg || e?.message || '加载失败')
  } finally {
    summaryLoading.value = false
  }
}

const historyFilters = ref({ from: '', to: '', section: '' })
const historyRows = ref([])
const historyLoading = ref(false)

const ledgerDrafts = ref({})

function fmtNum(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

async function loadMeters() {
  const res = await request.get('/api/electricity/meters')
  meters.value = res.data?.data || []
  const res2 = await request.get('/api/electricity/sections')
  sections.value = res2.data?.data || []
}

async function loadSheet() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await request.get('/api/electricity/sheet', { params: { date: entryDate.value } })
    sheet.value = res.data?.data || []
    const next = {}
    for (const row of sheet.value) {
      next[row.meterId] = row.reading === null || row.reading === undefined ? '' : String(row.reading)
    }
    drafts.value = next
  } catch (e) {
    sheet.value = []
    errorMessage.value = e?.response?.data?.msg || e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

/** 前端预览：用量 = (本次 − 上次) × 倍率 */
function previewUsage(row) {
  const raw = drafts.value[row.meterId]
  if (raw === '' || raw === undefined || raw === null) return null
  const current = Number(raw)
  if (!Number.isFinite(current)) return null
  if (row.prevReading === null || row.prevReading === undefined) return null
  return (current - Number(row.prevReading)) * Number(row.multiplier || 1)
}

const filledCount = computed(
  () => Object.values(drafts.value).filter((v) => v !== '' && v !== null && v !== undefined).length,
)

const regressRows = computed(() =>
  sheet.value.filter((row) => {
    const usage = previewUsage(row)
    return usage !== null && usage < 0
  }),
)

async function saveEntry() {
  const items = []
  for (const row of sheet.value) {
    const raw = drafts.value[row.meterId]
    if (raw === '' || raw === undefined || raw === null) continue
    const reading = Number(raw)
    if (!Number.isFinite(reading)) {
      ElMessage.error(`${row.meterName} 的读数不是数字`)
      return
    }
    items.push({ meterId: row.meterId, reading })
  }
  if (!items.length) {
    ElMessage.error('还没有填任何读数')
    return
  }
  saving.value = true
  try {
    const res = await request.post('/api/electricity/readings/batch', { date: entryDate.value, items })
    const data = res.data?.data || {}
    ElMessage.success(`已保存 ${data.saved ?? items.length} 块表的读数`)
    const warnings = data.warnings || []
    if (warnings.length) {
      ElMessage.warning(warnings[0])
    }
    await loadSheet()
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const params = {}
    if (historyFilters.value.from) params.from = historyFilters.value.from
    if (historyFilters.value.to) params.to = historyFilters.value.to
    if (historyFilters.value.section) params.section = historyFilters.value.section
    const res = await request.get('/api/electricity/readings', { params })
    historyRows.value = res.data?.data || []
  } catch (e) {
    historyRows.value = []
    ElMessage.error(e?.response?.data?.msg || e?.message || '加载失败')
  } finally {
    historyLoading.value = false
  }
}

function startLedgerEdit(row) {
  ledgerDrafts.value = {
    ...ledgerDrafts.value,
    [row.id]: {
      meterName: row.meterName,
      meterCode: row.meterCode,
      section: row.section,
      multiplier: row.multiplier,
    },
  }
}

async function saveLedger(row) {
  const draft = ledgerDrafts.value[row.id]
  if (!draft) return
  try {
    await request.put(`/api/electricity/meters/${row.id}`, draft)
    ElMessage.success('已保存')
    const next = { ...ledgerDrafts.value }
    delete next[row.id]
    ledgerDrafts.value = next
    await loadMeters()
    await loadSheet()
  } catch (e) {
    ElMessage.error(e?.response?.data?.msg || e?.message || '保存失败')
  }
}

function cancelLedger(row) {
  const next = { ...ledgerDrafts.value }
  delete next[row.id]
  ledgerDrafts.value = next
}

function switchView(next) {
  view.value = next
  if (next === 'matrix' && !matrixRows.value.length) loadMatrix()
  if (next === 'summary' && !summaryRows.value.length) loadSummary()
  if (next === 'share' && !shareRows.value.length) loadShare()
}

onMounted(async () => {
  try {
    await loadMeters()
    await loadSheet()
  } catch (e) {
    errorMessage.value = e?.response?.data?.msg || e?.message || '加载失败'
  }
})
</script>

<template>
  <div class="elec flex h-full flex-col">
    <section class="flex min-h-0 flex-1 flex-col rounded-card border border-line bg-raised shadow-card">
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <h1 class="text-base font-semibold text-slate-900">电费抄表</h1>
        <p class="text-xs text-slate-500">只记录读数与用量 · 电费计算另做</p>

        <div class="ml-auto flex items-center gap-1 rounded-lg border border-line p-0.5">
          <button
            v-for="tab in [
              { key: 'entry', label: '抄表录入' },
              { key: 'ledger', label: '电表台账' },
              { key: 'matrix', label: '矩阵视图' },
              { key: 'summary', label: '分类汇总' },
              { key: 'share', label: '预提分摊' },
              { key: 'history', label: '抄表历史' },
            ]"
            :key="tab.key"
            type="button"
            class="rounded-md px-3 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            :class="view === tab.key ? 'bg-brand text-on-brand' : 'text-slate-600 hover:bg-region'"
            @click="switchView(tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <!-- ============ 抄表录入 ============ -->
      <template v-if="view === 'entry'">
        <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
          <span class="text-xs text-slate-600">抄表日期</span>
          <el-date-picker
            v-model="entryDate"
            type="date"
            value-format="YYYY-MM-DD"
            aria-label="抄表日期"
            :first-day-of-week="1"
            class="!w-[150px]"
            @change="loadSheet"
          />
          <span class="text-xs text-slate-500">已填 {{ filledCount }} / {{ sheet.length }} 块</span>
          <span v-if="regressRows.length" class="text-xs text-amber-700">
            {{ regressRows.length }} 块表读数比上次小（换表？）
          </span>
          <button
            type="button"
            class="ml-auto rounded-md bg-brand px-3.5 py-1.5 text-xs font-medium text-on-brand transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:opacity-50"
            :disabled="saving"
            @click="saveEntry"
          >
            {{ saving ? '保存中…' : '保存这一天的读数' }}
          </button>
        </div>

        <p
          v-if="errorMessage"
          class="mx-6 mt-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700"
        >
          {{ errorMessage }}
        </p>

        <div class="min-h-0 flex-1 overflow-auto">
          <table class="ledger-table w-full min-w-[980px] table-fixed text-sm">
            <colgroup>
              <col class="w-[56px]" />
              <col class="w-[240px]" />
              <col class="w-[110px]" />
              <col class="w-[70px]" />
              <col class="w-[150px]" />
              <col class="w-[150px]" />
              <col class="w-[130px]" />
            </colgroup>
            <thead class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line)]">
              <tr>
                <th class="px-3 py-2.5 text-left font-medium">序号</th>
                <th class="px-3 py-2.5 text-left font-medium">电表名称</th>
                <th class="px-3 py-2.5 text-left font-medium">归属</th>
                <th class="px-3 py-2.5 text-right font-medium">倍率</th>
                <th class="px-3 py-2.5 text-right font-medium">上次读数</th>
                <th class="px-3 py-2.5 text-right font-medium">本次读数</th>
                <th class="px-3 py-2.5 text-right font-medium">用量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sheet" :key="row.meterId" class="border-t border-line">
                <td class="px-3 py-1.5 text-xs text-slate-500">{{ row.excelNo || '—' }}</td>
                <td class="px-3 py-1.5">
                  <span class="block truncate" :title="row.meterName">{{ row.meterName }}</span>
                  <span v-if="row.meterCode" class="text-[11px] text-slate-500">{{ row.meterCode }}</span>
                </td>
                <td class="px-3 py-1.5 text-slate-600">
                  <span class="block truncate">{{ row.section || '—' }}</span>
                </td>
                <td class="num px-3 py-1.5 text-right text-slate-500">{{ row.multiplier }}</td>
                <td class="num px-3 py-1.5 text-right text-slate-600">
                  {{ fmtNum(row.prevReading) }}
                  <span v-if="row.prevDate" class="ml-1 text-[11px] text-slate-500">
                    {{ String(row.prevDate).slice(5) }}
                  </span>
                </td>
                <td class="px-3 py-1 text-right">
                  <el-input
                    v-model="drafts[row.meterId]"
                    size="small"
                    placeholder="读数"
                    :aria-label="`${row.meterName} 本次读数`"
                    class="!w-[120px]"
                  />
                </td>
                <td
                  class="num px-3 py-1.5 text-right font-medium"
                  :class="
                    previewUsage(row) === null
                      ? 'text-slate-500'
                      : previewUsage(row) < 0
                        ? 'text-amber-700'
                        : 'text-slate-900'
                  "
                >
                  {{ previewUsage(row) === null ? '—' : fmtNum(previewUsage(row)) }}
                </td>
              </tr>
              <tr v-if="!loading && !sheet.length">
                <td colspan="7" class="px-4 py-10 text-center text-sm text-slate-500">
                  {{ loading ? '正在加载…' : '还没有电表台账' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ============ 台账 ============ -->
      <template v-else-if="view === 'ledger'">
        <div class="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
          <p class="text-xs text-slate-500">
            共 {{ meters.length }} 块表。归属与倍率会影响以后所有用量，所以只有管理员能改。
          </p>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <table class="ledger-table w-full min-w-[980px] table-fixed text-sm">
            <colgroup>
              <col class="w-[56px]" />
              <col class="w-[250px]" />
              <col class="w-[110px]" />
              <col class="w-[140px]" />
              <col class="w-[80px]" />
              <col class="w-[120px]" />
            </colgroup>
            <thead class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line)]">
              <tr>
                <th class="px-3 py-2.5 text-left font-medium">序号</th>
                <th class="px-3 py-2.5 text-left font-medium">电表名称</th>
                <th class="px-3 py-2.5 text-left font-medium">柜号</th>
                <th class="px-3 py-2.5 text-left font-medium">归属</th>
                <th class="px-3 py-2.5 text-right font-medium">倍率</th>
                <th class="px-3 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in meters" :key="row.id" class="border-t border-line">
                <td class="px-3 py-1.5 text-xs text-slate-500">{{ row.excelNo || '—' }}</td>
                <td class="px-3 py-1.5">
                  <el-input
                    v-if="ledgerDrafts[row.id]"
                    v-model="ledgerDrafts[row.id].meterName"
                    size="small"
                    :aria-label="`第 ${row.meterNo} 块表名称`"
                  />
                  <span v-else class="block truncate" :title="row.meterName">{{ row.meterName }}</span>
                </td>
                <td class="px-3 py-1.5">
                  <el-input
                    v-if="ledgerDrafts[row.id]"
                    v-model="ledgerDrafts[row.id].meterCode"
                    size="small"
                    :aria-label="`第 ${row.meterNo} 块表柜号`"
                  />
                  <span v-else class="text-slate-600">{{ row.meterCode || '—' }}</span>
                </td>
                <td class="px-3 py-1.5">
                  <el-input
                    v-if="ledgerDrafts[row.id]"
                    v-model="ledgerDrafts[row.id].section"
                    size="small"
                    :aria-label="`第 ${row.meterNo} 块表归属`"
                  />
                  <span v-else class="text-slate-600">{{ row.section || '—' }}</span>
                </td>
                <td class="num px-3 py-1.5 text-right">
                  <el-input
                    v-if="ledgerDrafts[row.id]"
                    v-model.number="ledgerDrafts[row.id].multiplier"
                    size="small"
                    class="!w-[70px]"
                    :aria-label="`第 ${row.meterNo} 块表倍率`"
                  />
                  <span v-else :class="row.multiplier > 1 ? 'font-medium text-amber-700' : 'text-slate-600'">
                    {{ row.multiplier }}
                  </span>
                </td>
                <td class="px-3 py-1.5 text-right">
                  <template v-if="ledgerDrafts[row.id]">
                    <button
                      type="button"
                      class="rounded border border-line px-2 py-0.5 text-[11px] text-slate-700 hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                      @click="saveLedger(row)"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      class="ml-1 px-1.5 py-0.5 text-[11px] text-slate-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                      @click="cancelLedger(row)"
                    >
                      取消
                    </button>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="px-1.5 py-0.5 text-[11px] text-slate-600 underline decoration-dotted hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                    @click="startLedgerEdit(row)"
                  >
                    改
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ============ 矩阵视图（只读：表 = 列 · 日期 = 行）============ -->
      <template v-else-if="view === 'matrix'">
        <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
          <el-date-picker
            v-model="matrixMonth"
            type="month"
            value-format="YYYY-MM"
            aria-label="矩阵月份"
            class="!w-[130px]"
            @change="loadMatrix"
          />
          <div class="flex items-center gap-1 rounded-lg border border-line p-0.5">
            <button
              v-for="opt in [
                { key: 'usage', label: '当天用量' },
                { key: 'reading', label: '原始读数' },
              ]"
              :key="opt.key"
              type="button"
              class="rounded-md px-2.5 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              :class="matrixMode === opt.key ? 'bg-brand text-on-brand' : 'text-slate-600 hover:bg-region'"
              @click="matrixMode = opt.key"
            >
              {{ opt.label }}
            </button>
          </div>

          <!-- 行怎么排（2026-11-03）：使用方的周报是"每期一行" -->
          <div class="flex items-center gap-1 rounded-lg border border-line p-0.5">
            <button
              v-for="opt in [
                { key: 'day', label: '按天' },
                { key: 'period', label: '按抄表期' },
              ]"
              :key="opt.key"
              type="button"
              class="rounded-md px-2.5 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              :class="matrixRowMode === opt.key ? 'bg-brand text-on-brand' : 'text-slate-600 hover:bg-region'"
              @click="matrixRowMode = opt.key; if (opt.key === 'period' && !periodData.periods.length) loadPeriods()"
            >
              {{ opt.label }}
            </button>
          </div>
          <span class="text-xs text-slate-500">
            只读 · 黄色 = 用量为负（换表）或异常大（疑似抄错）
          </span>
          <button
            type="button"
            class="ml-auto rounded-md border border-line px-3 py-1.5 text-xs text-slate-700 transition hover:bg-region focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            @click="loadMatrix"
          >
            {{ matrixLoading ? '加载中…' : '刷新' }}
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <table class="matrix-table">
            <thead>
              <!-- 第一行：归属分组（跨列） -->
              <tr>
                <th class="matrix-sticky-col matrix-corner" rowspan="2">日期</th>
                <th
                  v-for="group in matrixGroups"
                  :key="'g-' + group.name"
                  :colspan="group.span"
                  class="matrix-group"
                  :style="{ borderTopColor: group.color }"
                >
                  <span class="matrix-group__dot" :style="{ backgroundColor: group.color }"></span>
                  {{ group.label }}
                </th>
                <th class="matrix-total" rowspan="2">当日合计</th>
              </tr>
              <!-- 第二行：表名 + 编号 + 倍率 -->
              <tr>
                <th
                  v-for="meter in matrixMeters"
                  :key="'m-' + meter.id"
                  class="matrix-meter"
                  :title="`${meter.excelNo || '—'} ${meter.meterName} ${meter.meterCode || ''}${
                    meter.multiplier > 1 ? ' ×' + meter.multiplier : ''
                  }`"
                >
                  <span class="matrix-meter__no">{{ meter.excelNo || '—' }}</span>
                  <span class="matrix-meter__name">{{ meter.meterName }}</span>
                  <span v-if="meter.multiplier > 1" class="matrix-meter__mult">×{{ meter.multiplier }}</span>
                </th>
              </tr>
            </thead>
            <tbody v-if="matrixRowMode === 'period'">
              <tr v-for="p in periodRows" :key="'p-' + p.date">
                <th class="matrix-sticky-col matrix-date">{{ p.label }}</th>
                <td
                  v-for="meter in matrixMeters"
                  :key="'p-' + p.date + '-' + meter.id"
                  class="matrix-cell num"
                >
                  {{ periodCell(p, meter) }}
                </td>
                <td class="matrix-total num">{{ p.total === null ? '' : fmtNum(p.total) }}</td>
              </tr>
              <tr v-if="periodLoading">
                <td :colspan="matrixMeters.length + 2" class="px-4 py-8 text-center text-xs text-slate-500">
                  正在按期汇总…
                </td>
              </tr>
              <tr v-else-if="!periodRows.length">
                <td :colspan="matrixMeters.length + 2" class="px-4 py-8 text-center text-xs text-slate-500">
                  这个月还没有抄表记录（先录两期以上才看得出"期"）
                </td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr
                v-for="d in monthDays"
                :key="d.date"
                :class="d.weekend ? 'is-weekend' : ''"
              >
                <th class="matrix-sticky-col matrix-date" :class="d.weekend ? 'is-weekend' : ''">
                  {{ d.day }}
                </th>
                <td
                  v-for="meter in matrixMeters"
                  :key="d.date + '-' + meter.id"
                  class="matrix-cell num"
                  :class="cellTone(d.date, meter)"
                >
                  {{ cellText(d.date, meter) }}
                </td>
                <td class="matrix-total num">{{ dayTotal(d.date) === null ? '' : fmtNum(dayTotal(d.date)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ============ 分类汇总（各车间求和）============ -->
      <template v-else-if="view === 'summary'">
        <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
          <el-date-picker
            v-model="summaryRange.from"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="从"
            aria-label="汇总起始日期"
            :first-day-of-week="1"
            class="!w-[140px]"
          />
          <el-date-picker
            v-model="summaryRange.to"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="到"
            aria-label="汇总结束日期"
            :first-day-of-week="1"
            class="!w-[140px]"
          />
          <button
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-xs text-slate-700 transition hover:bg-region focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            @click="loadSummary"
          >
            汇总
          </button>
          <button
            type="button"
            class="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-on-brand transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            @click="importOpen = true"
          >
            粘贴导入
          </button>
          <span class="text-xs text-slate-500">只算用电量，不含电费</span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <table class="ledger-table w-full min-w-[620px] table-fixed text-sm">
            <colgroup>
              <col class="w-[200px]" />
              <col class="w-[200px]" />
              <col class="w-[120px]" />
            </colgroup>
            <thead class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line)]">
              <tr>
                <th class="px-4 py-2.5 text-left font-medium">车间 / 系统</th>
                <th class="px-4 py-2.5 text-right font-medium">用电量（kWh）</th>
                <th class="px-4 py-2.5 text-right font-medium">占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in summaryRows" :key="row.section" class="border-t border-line">
                <td class="px-4 py-2 font-medium text-slate-800">{{ row.section }}</td>
                <td class="num px-4 py-2 text-right tabular-nums">{{ fmtNum(row.usageQty) }}</td>
                <td class="num px-4 py-2 text-right tabular-nums text-slate-600">
                  {{ (Number(row.share || 0) * 100).toFixed(2) }}%
                </td>
              </tr>
              <tr v-if="!summaryLoading && !summaryRows.length">
                <td colspan="3" class="px-4 py-10 text-center text-sm text-slate-500">
                  {{ summaryLoading ? '正在汇总…' : '选好日期区间再点「汇总」' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ============ 预提分摊（2026-11-04）============ -->
      <template v-else-if="view === 'share'">
        <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3">
          <el-date-picker
            v-model="shareRange.from"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="从"
            aria-label="分摊起始日期"
            :first-day-of-week="1"
            class="!w-[140px]"
          />
          <el-date-picker
            v-model="shareRange.to"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="到"
            aria-label="分摊结束日期"
            :first-day-of-week="1"
            class="!w-[140px]"
          />
          <button
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-xs text-slate-700 transition hover:bg-region focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            @click="loadShare"
          >
            取数
          </button>
          <span class="text-xs text-slate-600">预提总额</span>
          <el-input
            v-model.number="shareTotal"
            aria-label="预提总额"
            class="!w-[120px]"
            size="small"
          />
          <span class="text-xs text-slate-500">分母 = 分表加总（总表只作校验，不参与分摊）</span>
        </div>

        <!-- 电价档位（2026-11-04）：按总电量命中一档、全额乘该档单价 -->
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-region/40 px-6 py-2">
          <span class="text-xs text-slate-600">电价档位</span>
          <span class="text-[11px] text-slate-500">≤</span>
          <el-input v-model.number="priceTiers[0].upTo" size="small" aria-label="第一档上限" class="!w-[100px]" />
          <el-input v-model.number="priceTiers[0].price" size="small" aria-label="第一档单价" class="!w-[70px]" />
          <span class="text-[11px] text-slate-500">｜≤</span>
          <el-input v-model.number="priceTiers[1].upTo" size="small" aria-label="第二档上限" class="!w-[100px]" />
          <el-input v-model.number="priceTiers[1].price" size="small" aria-label="第二档单价" class="!w-[70px]" />
          <span class="text-[11px] text-slate-500">｜超过则</span>
          <el-input v-model.number="priceTiers[2].price" size="small" aria-label="第三档单价" class="!w-[70px]" />
          <span
            v-if="sharePlan.length"
            class="ml-2 rounded-md border border-line bg-raised px-2 py-1 text-[11px] text-slate-700"
          >
            总电量 {{ fmtNum(shareSum) }} kWh ⇒ 命中
            <b>{{ unitPrice }}</b> 元/kWh
            <span v-if="matchedTier.upTo">（≤ {{ fmtNum(matchedTier.upTo) }}）</span>
            <span v-else>（超过 {{ fmtNum(priceTiers[1].upTo) }}）</span>
          </span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <table class="ledger-table w-full min-w-[860px] table-fixed text-sm">
            <colgroup>
              <col class="w-[160px]" />
              <col class="w-[130px]" />
              <col class="w-[90px]" />
              <col class="w-[140px]" />
              <col class="w-[120px]" />
              <col class="w-[110px]" />
              <col class="w-[130px]" />
            </colgroup>
            <thead class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line)]">
              <tr>
                <th class="px-4 py-2.5 text-left font-medium">组</th>
                <th class="px-4 py-2.5 text-right font-medium">用量（kWh）</th>
                <th class="px-4 py-2.5 text-right font-medium">占比</th>
                <th class="px-4 py-2.5 text-right font-medium">电费（元）</th>
                <th class="px-4 py-2.5 text-right font-medium">按占比预提</th>
                <th class="px-4 py-2.5 text-right font-medium">实际预提</th>
                <th class="px-4 py-2.5 text-right font-medium">差</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sharePlan" :key="row.section" class="border-t border-line">
                <td class="px-4 py-2 font-medium text-slate-800">{{ row.section }}</td>
                <td class="num px-4 py-2 text-right tabular-nums">{{ fmtNum(row.usage) }}</td>
                <td class="num px-4 py-2 text-right tabular-nums text-slate-600">
                  {{ (row.ratio * 100).toFixed(2) }}%
                </td>
                <td class="num px-4 py-2 text-right tabular-nums text-slate-700">{{ fmtNum(row.fee) }}</td>
                <td class="num px-4 py-2 text-right tabular-nums text-slate-700">{{ fmtNum(row.byUsage) }}</td>
                <td class="px-4 py-1.5 text-right">
                  <el-input
                    v-model.number="shareManual[row.section]"
                    size="small"
                    aria-label="实际预提金额"
                    placeholder="自动"
                    class="!w-[110px]"
                  />
                </td>
                <td
                  class="num px-4 py-2 text-right tabular-nums"
                  :class="Math.abs(row.diff) < 1 ? 'text-slate-500' : row.diff > 0 ? 'text-amber-700' : 'text-slate-600'"
                >
                  {{ row.diff === 0 ? '—' : (row.diff > 0 ? '+' : '') + fmtNum(row.diff) }}
                </td>
              </tr>
              <tr v-if="!shareLoading && !sharePlan.length">
                <td colspan="7" class="px-4 py-10 text-center text-sm text-slate-500">
                  {{ shareLoading ? '正在取数…' : '选好日期区间再点「取数」' }}
                </td>
              </tr>
            </tbody>
            <tfoot v-if="sharePlan.length" class="border-t-2 border-line bg-region/60">
              <tr>
                <td class="px-4 py-2 font-semibold text-slate-800">合计</td>
                <td class="num px-4 py-2 text-right font-semibold tabular-nums">{{ fmtNum(shareSum) }}</td>
                <td class="num px-4 py-2 text-right text-slate-600">100%</td>
                <td class="num px-4 py-2 text-right font-semibold tabular-nums">{{ fmtNum(theoryFee) }}</td>
                <td class="num px-4 py-2 text-right font-semibold tabular-nums">{{ fmtNum(shareTotal) }}</td>
                <td class="num px-4 py-2 text-right font-semibold tabular-nums">{{ fmtNum(shareManualTotal) }}</td>
                <td class="num px-4 py-2 text-right tabular-nums text-slate-600">
                  {{ Math.abs(shareManualTotal - Number(shareTotal)) < 1 ? '平' : fmtNum(shareManualTotal - Number(shareTotal)) }}
                </td>
              </tr>
            </tfoot>
          </table>

          <p v-if="sharePlan.length" class="border-t border-line px-6 py-2.5 text-[11px] text-slate-500">
            分母是分表加总（{{ fmtNum(shareSum) }}）—— 按你的口径「总表不为准，按分表各自算」。
            总表（1 号高压计量）只作校验：本页不拿它缩放任何数。
            电费 = 用量 × 命中档单价（{{ unitPrice }} 元/kWh）；理论电费 {{ fmtNum(theoryFee) }} 元
            vs 预提总额 {{ fmtNum(shareTotal) }} 元 ⇒
            {{ Math.abs(shareTotal - theoryFee) < 1 ? '两者一致' : '差 ' + fmtNum(shareTotal - theoryFee) + ' 元' }}。
            「实际预提」留空 = 按占比自动算；填了就以你填的为准，右边「差」告诉你偏了多少。
          </p>
        </div>
      </template>

      <!-- ============ 历史 ============ -->
      <template v-else>
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-6 py-3">
          <el-date-picker
            v-model="historyFilters.from"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="从"
            aria-label="起始日期"
            :first-day-of-week="1"
            class="!w-[140px]"
          />
          <el-date-picker
            v-model="historyFilters.to"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="到"
            aria-label="结束日期"
            :first-day-of-week="1"
            class="!w-[140px]"
          />
          <el-select v-model="historyFilters.section" placeholder="全部归属" clearable class="w-[140px]">
            <el-option v-for="s in sections" :key="s" :label="s" :value="s" />
          </el-select>
          <button
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-xs text-slate-700 transition hover:bg-region focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            @click="loadHistory"
          >
            查询
          </button>
          <span class="ml-auto text-xs text-slate-500">{{ historyRows.length }} 条</span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <table class="ledger-table w-full min-w-[900px] table-fixed text-sm">
            <colgroup>
              <col class="w-[120px]" />
              <col class="w-[220px]" />
              <col class="w-[110px]" />
              <col class="w-[130px]" />
              <col class="w-[130px]" />
              <col class="w-[130px]" />
            </colgroup>
            <thead class="sticky top-0 z-10 bg-region text-xs text-slate-500 shadow-[0_1px_0_0_var(--color-line)]">
              <tr>
                <th class="px-3 py-2.5 text-left font-medium">抄表日期</th>
                <th class="px-3 py-2.5 text-left font-medium">电表</th>
                <th class="px-3 py-2.5 text-left font-medium">归属</th>
                <th class="px-3 py-2.5 text-right font-medium">读数</th>
                <th class="px-3 py-2.5 text-right font-medium">上次读数</th>
                <th class="px-3 py-2.5 text-right font-medium">用量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in historyRows" :key="row.id" class="border-t border-line">
                <td class="num px-3 py-2 text-slate-600">{{ row.readDate }}</td>
                <td class="px-3 py-2">
                  <span class="block truncate text-slate-800">{{ row.meterName }}</span>
                </td>
                <td class="px-3 py-2 text-slate-600">{{ row.section || '—' }}</td>
                <td class="num px-3 py-2 text-right text-slate-700">{{ fmtNum(row.reading) }}</td>
                <td class="num px-3 py-2 text-right text-slate-500">{{ fmtNum(row.prevReading) }}</td>
                <td class="num px-3 py-2 text-right font-medium text-slate-900">{{ fmtNum(row.usageQty) }}</td>
              </tr>
              <tr v-if="!historyLoading && !historyRows.length">
                <td colspan="6" class="px-4 py-10 text-center text-sm text-slate-500">
                  {{ historyLoading ? '正在加载…' : '选好日期区间再点查询' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <!-- 粘贴导入（2026-11-03）-->
    <div
      v-if="importOpen"
      class="fixed inset-0 z-30 flex items-center justify-center bg-black/15 p-6"
      @click.self="importOpen = false"
    >
      <div class="flex max-h-[80vh] w-[680px] flex-col rounded-card border border-line bg-raised shadow-card">
        <div class="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <p class="text-sm font-semibold text-slate-900">粘贴导入</p>
            <p class="mt-0.5 text-[11px] text-slate-500">
              在 Excel 里选中那几行（含日期）→ 复制 → 粘到下面。每行一期，第一列日期，后面按编号 1~37 依次是读数（150车间那列也要占一位）
            </p>
          </div>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-xs text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            @click="importOpen = false"
          >
            关闭
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-5 py-3">
          <textarea
            v-model="importText"
            rows="10"
            aria-label="粘贴要导入的表格"
            placeholder="2026-08-07	10782264	2477.5	1047.5	…&#10;2026-08-14	…"
            class="w-full rounded-md border border-line bg-desk p-3 font-mono text-xs text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand-100"
          ></textarea>
          <p v-if="importHint" class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {{ importHint }}
          </p>
        </div>

        <div class="flex items-center justify-between border-t border-line px-5 py-2.5">
          <p class="text-[11px] text-slate-500">列数必须和台账一致（38 块表）；不一致的那一行会被跳过并告诉你原因</p>
          <button
            type="button"
            class="rounded-md bg-brand px-3.5 py-1.5 text-xs font-medium text-on-brand transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:opacity-50"
            :disabled="importing"
            @click="doImport"
          >
            {{ importing ? '导入中…' : '开始导入' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== 矩阵视图：车间墙上那张大表 ===== */
.matrix-table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}

.matrix-table thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background-color: #f6f3ec;
  border-bottom: 1px solid #e7e2d8;
  padding: 3px 4px;
  font-weight: 500;
  color: #4b5563;
  white-space: nowrap;
}

/* 组名那一行再粘高一点（两行表头） */
.matrix-table thead tr:first-child th {
  top: 0;
  z-index: 4;
  border-top: 3px solid transparent;
}

.matrix-table thead tr:nth-child(2) th {
  top: 26px;
}

.matrix-group {
  text-align: left;
  font-weight: 600;
  color: #374151;
}

.matrix-group__dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 2px;
  margin-right: 5px;
  vertical-align: 1px;
}

.matrix-meter {
  min-width: 62px;
  max-width: 62px;
  padding: 2px 3px !important;
  border-left: 1px solid #f0ece3;
  vertical-align: bottom;
}

.matrix-meter__no {
  display: block;
  font-size: 10px;
  color: #9ca3af;
  line-height: 1.2;
}

.matrix-meter__name {
  display: block;
  font-size: 10px;
  color: #374151;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.matrix-meter__mult {
  display: block;
  font-size: 10px;
  color: #9a4a1e;
  line-height: 1.2;
}

/* 左列固定 */
.matrix-sticky-col {
  position: sticky !important;
  left: 0;
  z-index: 5 !important;
  background-color: #f6f3ec !important;
  width: 44px;
  min-width: 44px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: #4b5563;
}

.matrix-corner {
  z-index: 6 !important;
}

.matrix-date {
  font-weight: 500;
  border-bottom: 1px solid #f0ece3;
}

.matrix-cell {
  text-align: right;
  padding: 2px 4px;
  border-bottom: 1px solid #f5f1e8;
  border-left: 1px solid #f5f1e8;
  color: #1f2937;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

tr.is-weekend .matrix-cell,
tr.is-weekend .matrix-date {
  background-color: #faf8f3;
}

/* 异常：负数（换表）与异常大（疑似抄错） */
.matrix-cell.is-regress {
  background-color: rgba(180, 83, 9, 0.14) !important;
  color: #9a4a1e;
  font-weight: 600;
}

.matrix-cell.is-big {
  background-color: rgba(138, 106, 31, 0.12) !important;
  color: #7a5c18;
}

.matrix-total {
  position: sticky !important;
  right: 0;
  z-index: 3 !important;
  background-color: #f6f3ec !important;
  text-align: right;
  padding: 2px 6px;
  font-weight: 600;
  color: #374151;
  white-space: nowrap;
}

.num {
  font-variant-numeric: tabular-nums;
}
</style>
