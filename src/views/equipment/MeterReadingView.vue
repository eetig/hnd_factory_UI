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
              { key: 'history', label: '抄表历史' },
            ]"
            :key="tab.key"
            type="button"
            class="rounded-md px-3 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            :class="view === tab.key ? 'bg-brand text-on-brand' : 'text-slate-600 hover:bg-region'"
            @click="view = tab.key"
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
                <td class="px-3 py-1.5 text-xs text-slate-500">{{ row.meterNo }}</td>
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
                <td class="px-3 py-1.5 text-xs text-slate-500">{{ row.meterNo }}</td>
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
  </div>
</template>

<style scoped>
.num {
  font-variant-numeric: tabular-nums;
}
</style>
