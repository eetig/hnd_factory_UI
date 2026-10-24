<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import request from '../../api/request'

/*
 * 我的考勤 · PC 看板（2026-10-24，变更-171 续）。
 *
 * 数据全部来自后端的 `GET /api/attendance/month?month=YYYY-MM`：
 * 整月每一天都返回（没录的按默认规则补），统计口径也在后端算 ——
 * 所以这里和手机端看到的数一定一致，不会出现"两套算法"。
 *
 * 只读看板（使用方原话是"PC 端出个考勤看板"）：录入仍在手机端。
 * 点某一天 → 下面一块明细，显示四个时间点、忘打标记、备注、值班。
 *
 * 视觉沿用项目的 x-minimalist：暖白纸、1px 发丝线、近零阴影、不用彩色大块。
 */

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

const TYPE_TEXT = {
  work: '工作日',
  overtime: '休息日加班',
  rest: '休息',
  comp: '调休',
}

const month = ref('')
const days = ref([])
const summary = reactive({
  workDays: 0,
  overtimeDays: 0,
  restDays: 0,
  compDays: 0,
  dutyCount: 0,
  dutyAmount: 0,
  totalMinutes: 0,
  missCount: 0,
  incompleteDays: 0,
})
const settings = reactive({ workStart: '08:00', workEnd: '17:30', lunchStart: '12:00', lunchEnd: '13:30' })
const loading = ref(false)
const error = ref('')
const selected = ref(null)

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await request.get('/api/attendance/month', { params: { month: month.value } })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '加载失败')
    const data = body.data || {}
    days.value = Array.isArray(data.days) ? data.days : []
    for (const key of Object.keys(summary)) summary[key] = data[key] || 0
    if (data.settings) {
      settings.workStart = (data.settings.workStart || '08:00').slice(0, 5)
      settings.workEnd = (data.settings.workEnd || '17:30').slice(0, 5)
      settings.lunchStart = (data.settings.lunchStart || '12:00').slice(0, 5)
      settings.lunchEnd = (data.settings.lunchEnd || '13:30').slice(0, 5)
    }
    selected.value = null
  } catch (e) {
    error.value = e?.response?.data?.msg || e?.message || '加载失败'
    days.value = []
  } finally {
    loading.value = false
  }
}

function shift(delta) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  load()
}

onMounted(() => {
  month.value = thisMonth()
  load()
})

/** 42 格（6 行）固定，切月不跳高度 */
const grid = computed(() => {
  if (!days.value.length) return []
  const [y, m] = days.value[0].workDate.split('-').map(Number)
  const firstDow = new Date(y, m - 1, 1).getDay()
  const pad = (firstDow + 6) % 7
  const cells = new Array(pad).fill(null)
  for (const d of days.value) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  while (cells.length < 42) cells.push(null)
  return cells
})

function minutesBetween(a, b) {
  if (!a || !b) return 0
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  const diff = bh * 60 + bm - (ah * 60 + am)
  return diff > 0 ? diff : 0
}

/** 单日时长（分钟）：工作日扣午休；加班日两段相加 */
function dayMinutes(day) {
  if (day.dayType === 'overtime') {
    return minutesBetween(day.amIn, day.amOut) + minutesBetween(day.pmIn, day.pmOut)
  }
  if (day.dayType !== 'work') return 0
  const gross = minutesBetween(day.amIn, day.amOut)
  if (!gross) return 0
  return Math.max(gross - minutesBetween(settings.lunchStart, settings.lunchEnd), 0)
}

function hoursText(minutes) {
  if (!minutes) return ''
  const h = minutes / 60
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

function totalText(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} 分`
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

function missOf(day) {
  return [day.missAmIn, day.missAmOut, day.missPmIn, day.missPmOut].filter(Boolean).length
}

function timesOf(day) {
  const rows = []
  if (day.amIn || day.amOut) rows.push([day.dayType === 'overtime' ? '上午' : '上下班', fmt(day.amIn), fmt(day.amOut)])
  if (day.pmIn || day.pmOut) rows.push(['下午', fmt(day.pmIn), fmt(day.pmOut)])
  return rows
}

function fmt(t) {
  return t ? t.slice(0, 5) : '—'
}

function pick(day) {
  selected.value = selected.value?.workDate === day.workDate ? null : day
}

const completenessHint = computed(() => {
  const bits = []
  if (summary.missCount) bits.push(`忘打卡 ${summary.missCount} 段`)
  if (summary.incompleteDays) bits.push(`缺段 ${summary.incompleteDays} 天`)
  return bits.join(' · ')
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- 头部：月份 + 四个数 -->
    <section class="rounded-card border border-line bg-raised shadow-card">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div class="flex items-center gap-3">
          <button
            class="flex h-8 w-8 items-center justify-center rounded-full border border-line text-slate-500 transition hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
            aria-label="上一个月"
            @click="shift(-1)"
          >
            ‹
          </button>
          <span class="text-base font-semibold tabular-nums text-slate-900">{{ month }}</span>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-full border border-line text-slate-500 transition hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
            aria-label="下一个月"
            @click="shift(1)"
          >
            ›
          </button>
        </div>
        <p class="text-xs text-slate-500">
          默认口径：周一到周五 + 每月最后一个周六上班，法定节假日休息
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3 px-6 py-4 sm:grid-cols-5">
        <div class="rounded-card border border-line bg-raised px-4 py-3 shadow-card">
          <p class="text-xs text-slate-500">出勤</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-slate-900">{{ summary.workDays }}<span class="ml-1 text-xs font-normal text-slate-500">天</span></p>
        </div>
        <div class="rounded-card border border-line bg-raised px-4 py-3 shadow-card">
          <p class="text-xs text-slate-500">加班</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-slate-900">{{ summary.overtimeDays }}<span class="ml-1 text-xs font-normal text-slate-500">天</span></p>
        </div>
        <div class="rounded-card border border-line bg-raised px-4 py-3 shadow-card">
          <p class="text-xs text-slate-500">调休</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-slate-900">{{ summary.compDays }}<span class="ml-1 text-xs font-normal text-slate-500">天</span></p>
        </div>
        <div class="rounded-card border border-line bg-raised px-4 py-3 shadow-card">
          <p class="text-xs text-slate-500">值班</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-slate-900">
            {{ summary.dutyCount }}<span class="ml-1 text-xs font-normal text-slate-500">次 · ￥{{ summary.dutyAmount }}</span>
          </p>
        </div>
        <div class="rounded-card border border-line bg-raised px-4 py-3 shadow-card">
          <p class="text-xs text-slate-500">合计工时</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-slate-900">{{ totalText(summary.totalMinutes) }}</p>
        </div>
      </div>

      <p v-if="completenessHint" class="border-t border-line px-6 py-2.5 text-xs text-amber-700">
        {{ completenessHint }}
      </p>
      <p v-if="error" class="border-t border-line px-6 py-2.5 text-xs text-rose-600">
        {{ error }}（点月份箭头重试）
      </p>
    </section>

    <!-- 月历 -->
    <section class="rounded-card border border-line bg-raised shadow-card">
      <div class="grid grid-cols-7 border-b border-line">
        <div v-for="w in WEEK" :key="w" class="px-2 py-2 text-center text-xs text-slate-500">{{ w }}</div>
      </div>

      <div class="grid grid-cols-7">
        <template v-for="(cell, i) in grid" :key="cell ? cell.workDate : `pad-${i}`">
          <div v-if="!cell" class="h-24 rounded-none border-b border-r border-line/60"></div>
          <button
            v-else
            class="flex h-24 flex-col items-start gap-1 border-b border-r border-line/60 px-2.5 py-2 text-left transition hover:bg-canvas focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
            :class="[
              cell.workDate === todayStr() ? 'ring-1 ring-inset ring-brand-ink' : '',
              selected?.workDate === cell.workDate ? 'rounded-card bg-canvas' : '',
              cell.dayType === 'rest' ? 'text-slate-500' : '',
            ]"
            @click="pick(cell)"
          >
            <span class="flex w-full items-center justify-between">
              <span
                class="text-sm font-semibold tabular-nums"
                :class="cell.workDate === todayStr() ? 'text-brand-ink' : 'text-slate-900'"
              >
                {{ Number(cell.workDate.slice(-2)) }}
              </span>
              <!-- 值班标记：绿只保留"成功"语义，这里用小圆点 + slate 墨色（视觉上一样醒目） -->
              <span
                v-if="cell.hasDuty"
                class="h-1.5 w-1.5 rounded-full bg-slate-900"
                title="值班"
              ></span>
            </span>

            <span v-if="hoursText(dayMinutes(cell))" class="text-xs tabular-nums text-slate-600">
              {{ hoursText(dayMinutes(cell)) }}
            </span>

            <span class="flex flex-wrap items-center gap-1 text-xs leading-4">
              <span v-if="cell.dayType === 'overtime'" class="rounded-sm border border-line px-1 text-slate-600">加班</span>
              <span v-else-if="cell.dayType === 'comp'" class="rounded-sm border border-line px-1 text-slate-600">调休</span>
              <span v-if="cell.hasDuty" class="rounded-sm border border-line px-1 text-slate-600">值班</span>
              <span v-if="missOf(cell)" class="text-amber-700">忘{{ missOf(cell) }}</span>
            </span>
          </button>
        </template>
      </div>
    </section>

    <!-- 明细 -->
    <section v-if="selected" class="rounded-card border border-line bg-raised shadow-card">
      <div class="flex items-center justify-between border-b border-line px-6 py-3">
        <h3 class="text-sm font-semibold text-slate-800">
          {{ selected.workDate }} · {{ TYPE_TEXT[selected.dayType] }}
          <span v-if="selected.hasDuty" class="ml-2 text-slate-600">值班</span>
        </h3>
        <button class="text-xs text-slate-500 transition hover:text-slate-900" @click="selected = null">收起</button>
      </div>
      <div class="grid gap-3 px-6 py-4 sm:grid-cols-2">
        <div v-for="row in timesOf(selected)" :key="row[0]" class="flex items-center justify-between rounded-card border border-line bg-raised px-4 py-2 shadow-card">
          <span class="text-xs text-slate-500">{{ row[0] }}</span>
          <span class="text-sm tabular-nums text-slate-900">{{ row[1] }} — {{ row[2] }}</span>
        </div>
        <div class="flex items-center justify-between rounded-card border border-line bg-raised px-4 py-2 shadow-card">
          <span class="text-xs text-slate-500">时长</span>
          <span class="text-sm tabular-nums text-slate-900">{{ hoursText(dayMinutes(selected)) || '—' }}</span>
        </div>
        <div class="flex items-center justify-between rounded-card border border-line bg-raised px-4 py-2 shadow-card">
          <span class="text-xs text-slate-500">忘打卡</span>
          <span class="text-sm text-slate-900">{{ missOf(selected) ? `${missOf(selected)} 段` : '无' }}</span>
        </div>
        <div v-if="selected.note" class="flex items-center justify-between rounded-card border border-line bg-raised px-4 py-2 shadow-card sm:col-span-2">
          <span class="text-xs text-slate-500">备注</span>
          <span class="text-sm text-slate-900">{{ selected.note }}</span>
        </div>
      </div>
      <p class="border-t border-line px-6 py-2.5 text-xs text-slate-500">
        这一页是只读看板；录改在手机 App 的「考勤」页。
      </p>
    </section>
  </div>
</template>
