<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import request from '../../api/request'
import { isGuest } from '../../api/auth'

/*
 * 我的考勤 · PC 看板（2026-10-24 建立，2026-11-03 重做视觉）。
 *
 * 数据全部来自后端 `GET /api/attendance/month?month=YYYY-MM`：整月每天都返回
 * （没录的按默认规则补），统计口径在后端算 —— 所以和手机端一定一致，不会有"两套算法"。
 *
 * ## 2026-11-03 为什么重做（使用方原话）
 * 「PC 端的考勤一点都不直观。而且都不能看全一个月，还得向下滑动。体验很差。参考手机App的做法」
 *
 * 改前：格子 h-24（96px）× 6 行 = 576px，再加上统计卡与明细区 ⇒ 必然要滚；
 *      状态只靠几个灰底小标签，加班/值班/调休/休息一眼分不开。
 * 改后：
 *   ① **一屏看完** —— 整页 `h-full`，日历 `flex-1` + `grid-rows-6`，格子高度自适应，
 *      不再写死 96px；明细改成右侧浮层，点开也不挤压日历
 *   ② **状态配色与手机 App 同一套**（档案袋/排班表的语言）：
 *      加班 暖橙 · 值班 靛蓝徽章「值」 · 调休 紫褐 · 休息 冷灰（含法定节日名）· 今天 品牌橙描边
 *   ③ 加一行**色块图例** —— 颜色必须能被读懂，不然就是装饰
 */
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

const TYPE_TEXT = {
  work: '工作日',
  overtime: '休息日加班',
  rest: '休息',
  comp: '调休',
}

/*
 * 状态色（与 App 端 AttendancePanel 同一套，改一处记得改另一处）。
 * 底色用 12~14% 淡版、文字/描边用深版 ⇒ 对比度都过 AA。
 */
const TONE = {
  overtime: { bar: '#b45309', bg: 'rgba(180, 83, 9, 0.13)', border: 'rgba(180, 83, 9, 0.30)', text: '#9a4a1e' },
  comp: { bar: '#7a4b5e', bg: 'rgba(122, 75, 94, 0.12)', border: 'rgba(122, 75, 94, 0.26)', text: '#7a4b5e' },
  rest: { bar: '#6b7280', bg: 'rgba(107, 114, 128, 0.08)', border: 'rgba(107, 114, 128, 0.16)', text: '#4b5563' },
  work: { bar: 'transparent', bg: '#fffdf8', border: '#e7e2d8', text: '#1f2937' },
}

const LEGEND = [
  { label: '加班', color: '#b45309' },
  { label: '值班', color: '#3f5d87' },
  { label: '调休', color: '#7a4b5e' },
  { label: '休息', color: '#6b7280' },
  { label: '今天', color: '#b4551f' },
]

/*
 * 游客（roleKey = guest）能看到入口，但用不了（2026-10-24 使用方口径）。
 * 后端 `/api/attendance/**` 也拦了一道，这里只是不给"空月历"的错觉。
 */
const guest = isGuest()

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
  if (!guest) load()
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

/** 这天是不是还没到（未来日）—— 未来日不会有打卡记录，提示语要说清楚 */
function isFuture(day) {
  return day && day.workDate > todayStr()
}

/** 某天用哪一档状态色（与 App 的 cellTone 一致：法定节日并入"休息"） */
function toneOf(day) {
  if (day.dayType === 'overtime') return TONE.overtime
  if (day.dayType === 'comp') return TONE.comp
  if (day.dayType === 'rest') return TONE.rest
  return TONE.work
}

/** 格子内联样式：底色 + 描边 + 左侧 4px 状态条（颜色只在这三处出现） */
function cellStyle(day) {
  const tone = toneOf(day)
  return {
    backgroundColor: tone.bg,
    borderColor: tone.border,
    borderLeftColor: tone.bar,
    borderLeftWidth: tone.bar === 'transparent' ? '1px' : '4px',
    borderLeftStyle: 'solid',
  }
}

/** 状态标签文案：节日优先显示节日名，否则按类型 */
function tagText(day) {
  if (day.dayType === 'overtime') return '加班'
  if (day.dayType === 'comp') return '调休'
  if (day.dayType === 'rest') return day.holidayName || '休息'
  return ''
}

const completenessHint = computed(() => {
  const bits = []
  if (summary.missCount) bits.push(`忘打卡 ${summary.missCount} 段`)
  if (summary.incompleteDays) bits.push(`缺段 ${summary.incompleteDays} 天`)
  return bits.join(' · ')
})
</script>

<template>
  <div class="att flex h-full min-h-0 flex-col gap-3">
    <!-- 游客：看得见入口，但不能用 -->
    <section
      v-if="guest"
      class="rounded-card border border-line bg-raised px-6 py-10 text-center shadow-card"
    >
      <p class="text-sm font-semibold text-slate-800">该功能需要注册账号</p>
      <p class="mt-2 text-xs text-slate-500">
        考勤按人隔离，每个账号只能看到自己的记录。注册并登录后即可使用。
      </p>
    </section>

    <template v-else>
      <!-- ① 顶部一条：月份 + 五个数 + 图例（不再单独占一张高卡片） -->
      <section class="shrink-0 rounded-card border border-line bg-raised shadow-card">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <div class="flex items-center gap-2">
            <button
              class="flex h-7 w-7 items-center justify-center rounded-full border border-line text-slate-500 transition hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              aria-label="上一个月"
              @click="shift(-1)"
            >
              ‹
            </button>
            <span class="text-sm font-semibold tabular-nums text-slate-900">{{ month }}</span>
            <button
              class="flex h-7 w-7 items-center justify-center rounded-full border border-line text-slate-500 transition hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              aria-label="下一个月"
              @click="shift(1)"
            >
              ›
            </button>
          </div>

          <div class="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs text-slate-500">
            <span>
              出勤 <b class="text-sm tabular-nums text-slate-900">{{ summary.workDays }}</b> 天
            </span>
            <span>
              加班 <b class="text-sm tabular-nums text-slate-900">{{ summary.overtimeDays }}</b> 天
            </span>
            <span>
              调休 <b class="text-sm tabular-nums text-slate-900">{{ summary.compDays }}</b> 天
            </span>
            <span>
              值班 <b class="text-sm tabular-nums text-slate-900">{{ summary.dutyCount }}</b> 次
              <span class="text-slate-500">· ￥{{ summary.dutyAmount }}</span>
            </span>
            <span>
              合计 <b class="text-sm tabular-nums text-slate-900">{{ totalText(summary.totalMinutes) }}</b>
            </span>
          </div>

          <!-- 色块图例（2026-11-03）：颜色必须能被读懂，否则就是装饰 -->
          <div class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            <span v-for="item in LEGEND" :key="item.label" class="flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-[3px]" :style="{ backgroundColor: item.color }"></span>
              <span class="text-[11px] text-slate-500">{{ item.label }}</span>
            </span>
          </div>
        </div>

        <p v-if="completenessHint" class="border-t border-line px-5 py-1.5 text-[11px] text-amber-700">
          {{ completenessHint }}
        </p>
        <p v-if="error" class="border-t border-line px-5 py-1.5 text-[11px] text-rose-600">
          {{ error }}（点月份箭头重试）
        </p>
      </section>

      <!-- ② 月历：flex-1 + grid-rows-6 ⇒ 永远一屏，格子高度自适应 -->
      <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-raised shadow-card">
        <div class="grid shrink-0 grid-cols-7 border-b border-line bg-region/50">
          <div v-for="w in WEEK" :key="w" class="px-2 py-1.5 text-center text-[11px] text-slate-500">
            {{ w }}
          </div>
        </div>

        <div class="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
          <template v-for="(cell, i) in grid" :key="cell ? cell.workDate : `pad-${i}`">
            <div v-if="!cell" class="border-b border-r border-line/60 bg-desk/40"></div>
            <button
              v-else
              type="button"
              class="group flex min-h-[58px] flex-col items-start gap-0.5 overflow-hidden border-b border-r border-line/60 px-2 py-1.5 text-left transition hover:brightness-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-ink"
              :style="cellStyle(cell)"
              :class="cell.workDate === todayStr() ? 'ring-2 ring-inset ring-brand-ink' : ''"
              :aria-label="`${cell.workDate} ${TYPE_TEXT[cell.dayType]}${cell.hasDuty ? ' 值班' : ''}`"
              @click="pick(cell)"
            >
              <span class="flex w-full items-center justify-between gap-1">
                <span
                  class="text-sm font-semibold tabular-nums"
                  :class="cell.workDate === todayStr() ? 'text-brand-ink' : 'text-slate-900'"
                >
                  {{ Number(cell.workDate.slice(-2)) }}
                </span>
                <!-- 值班：靛蓝实色小徽章，比小圆点明确得多 -->
                <span
                  v-if="cell.hasDuty"
                  class="rounded-[3px] px-1 text-[11px] font-bold leading-4 text-white"
                  style="background-color: #3f5d87"
                  title="值班"
                >
                  值
                </span>
              </span>

              <span v-if="hoursText(dayMinutes(cell))" class="text-xs tabular-nums text-slate-600">
                {{ hoursText(dayMinutes(cell)) }}
              </span>

              <span class="flex flex-wrap items-center gap-1 text-[11px] leading-4">
                <span v-if="tagText(cell)" :style="{ color: toneOf(cell).text }" class="font-medium">
                  {{ tagText(cell) }}
                </span>
                <span v-if="missOf(cell)" class="text-amber-700">忘{{ missOf(cell) }}</span>
              </span>
            </button>
          </template>
        </div>
      </section>

      <!--
        ③ 明细（2026-11-03 重做）：从"右侧整条白板"改成**居中弹窗**。
        原来点未来日（例如今天看 11-04）时没有任何时间块，只剩「时长 —」「忘打卡 无」，
        右侧 340×720 一整条几乎空白，看着像坏了。现在：
        · 宽 380、高度自适应、最高 80vh —— 内容少时它自己就小
        · 未来日/没录时间时明确说明，并把**默认作息**写出来（别让人以为没数据）
        · 补上「状态」行（工作日/休息/加班/调休 + 节日名）
      -->
      <div
        v-if="selected"
        class="fixed inset-0 z-30 flex items-center justify-center bg-black/15 p-6"
        @click.self="selected = null"
      >
        <div class="flex max-h-[80vh] w-[380px] flex-col rounded-card border border-line bg-raised shadow-card">
          <div class="flex items-start justify-between border-b border-line px-5 py-3">
            <div>
              <p class="text-sm font-semibold tabular-nums text-slate-900">{{ selected.workDate }}</p>
              <p class="mt-0.5 text-[11px] text-slate-500">
                {{ TYPE_TEXT[selected.dayType] }}
                <span v-if="selected.holidayName"> · {{ selected.holidayName }}</span>
              </p>
            </div>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-xs text-slate-500 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              @click="selected = null"
            >
              关闭
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-auto px-5 py-3">
            <!-- 状态 -->
            <div class="mb-2 flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span class="text-xs text-slate-500">状态</span>
              <span class="flex items-center gap-2 text-sm text-slate-900">
                <span
                  class="h-2.5 w-2.5 rounded-[3px]"
                  :style="{ backgroundColor: toneOf(selected).bar === 'transparent' ? '#e7e2d8' : toneOf(selected).bar }"
                ></span>
                {{ TYPE_TEXT[selected.dayType] }}
                <span
                  v-if="selected.hasDuty"
                  class="rounded-[3px] px-1 text-[11px] font-bold leading-4 text-white"
                  style="background-color: #3f5d87"
                >值班</span>
              </span>
            </div>

            <!-- 时间：有记录就列出来；没有就说明为什么没有 -->
            <div
              v-for="row in timesOf(selected)"
              :key="row[0]"
              class="mb-2 flex items-center justify-between rounded-md border border-line px-3 py-2"
            >
              <span class="text-xs text-slate-500">{{ row[0] }}</span>
              <span class="text-sm tabular-nums text-slate-900">{{ row[1] }} — {{ row[2] }}</span>
            </div>

            <div
              v-if="!timesOf(selected).length"
              class="mb-2 rounded-md border border-dashed border-line px-3 py-2.5"
            >
              <p class="text-[11px] leading-relaxed text-slate-500">
                {{ isFuture(selected) ? '这天还没到，还没有打卡记录。' : '这天没有录打卡时间。' }}
              </p>
              <p class="mt-1 text-[11px] leading-relaxed text-slate-500">
                默认作息：{{ settings.workStart }} 上班 · {{ settings.lunchStart }}–{{
                  settings.lunchEnd
                }}
                午休 · {{ settings.workEnd }} 下班（合计 {{ hoursText(dayMinutes(selected)) || '8h' }} 的前提）
              </p>
            </div>

            <div class="mb-2 flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span class="text-xs text-slate-500">时长</span>
              <span class="text-sm tabular-nums text-slate-900">{{ hoursText(dayMinutes(selected)) || '—' }}</span>
            </div>
            <div class="mb-2 flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span class="text-xs text-slate-500">忘打卡</span>
              <span class="text-sm text-slate-900">{{ missOf(selected) ? `${missOf(selected)} 段` : '无' }}</span>
            </div>
            <div v-if="selected.note" class="mb-2 rounded-md border border-line px-3 py-2">
              <p class="text-xs text-slate-500">备注</p>
              <p class="mt-1 text-sm text-slate-900">{{ selected.note }}</p>
            </div>
          </div>

          <p class="border-t border-line px-5 py-2 text-[11px] text-slate-500">
            这一页是只读看板；录改在手机 App 的「考勤」页。
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
