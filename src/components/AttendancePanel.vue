<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useToast } from 'wot-design-uni'
import request from '../api/request'
import { hasPerm, isGuest } from '../api/auth'

/*
 * 个人考勤（2026-10-24，变更-171）。
 *
 * 使用方的用法是**事后录入 + 和人事对账**（他不在这打卡），所以这页是"台账"不是打卡器：
 *   · 打开就是**整月填好**的月历（后端按"周一到周五 + 每月最后一个周六 = 工作日；
 *     其余周末与法定节假日 = 休息"补的默认值），他只改有变动的那几天；
 *   · 工作日 2 段（上班/下班）、休息日加班 4 段（上午上班/午休/下午上班/下午下班）；
 *   · **不算迟到早退**，迟了早了就按段标"忘打卡"（他的原话）；
 *   · 调休 = 工作日被公司安排休息的另一种类型。
 *
 * 所有默认规则与统计口径都在**后端**（`/api/attendance/month` 返回整月 + 统计），
 * 这边不自己算 —— 否则 App 和将来的 PC 看板会出现两套口径。
 */

const toast = useToast()
const canEdit = computed(() => hasPerm('attendance:edit') || hasPerm('admin'))

/*
 * 游客能看见「考勤」这个入口，但不能用（2026-10-24 使用方口径：
 * 「游客能看到功能按钮，注册用户能使用」）。后端也拦了一道。
 */
const guest = isGuest()

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/**
 * 日历色块图例（2026-11-02）。色值与 .at__cell 的状态底色同源，
 * 改一处记得改另一处 —— 这里集中写一次，省得散落在模板里。
 */
const LEGEND = [
  { label: '加班', color: '#b45309' },
  { label: '值班', color: '#3f5d87' },
  { label: '节日', color: '#8a6a1f' },
  { label: '调休', color: '#7a4b5e' },
  { label: '休息', color: '#6b7280' },
  { label: '今天', color: '#b4551f' },
]

const TYPE_LABELS = {
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
  dutyCount: 0,
  dutyAmount: 0,
  restDays: 0,
  compDays: 0,
  totalMinutes: 0,
  missCount: 0,
  incompleteDays: 0,
})
const loading = ref(false)
const loadError = ref('')

/*
 * 默认时间（2026-10-24，变更-171 续）。
 *
 * 使用方给的标准作息：08:00 上班、12:00-13:30 午休、17:30 下班 ⇒ 一个工作日 **8 小时**。
 * 首次打开某月时后端就按这套把工作日铺好（所以打开是"出勤 19 天"而不是"缺段 19 天"）。
 * 这里只负责"改这套默认值"，改完只影响之后新生成的月份。
 */
const settings = reactive({
  workStart: '08:00',
  workEnd: '17:30',
  lunchStart: '12:00',
  lunchEnd: '13:30',
  standardMinutes: 480,
  dutyRate: 50,
})
const settingsOpen = ref(false)
const settingsSaving = ref(false)
const settingsError = ref('')
const settingsForm = reactive({ workStart: '', workEnd: '', lunchStart: '', lunchEnd: '' })

function openSettings() {
  settingsForm.workStart = settings.workStart
  settingsForm.workEnd = settings.workEnd
  settingsForm.lunchStart = settings.lunchStart
  settingsForm.lunchEnd = settings.lunchEnd
  settingsError.value = ''
  settingsOpen.value = true
}

async function saveSettings() {
  if (settingsSaving.value) return
  settingsError.value = ''
  const times = {
    workStart: normalizeTime(settingsForm.workStart),
    workEnd: normalizeTime(settingsForm.workEnd),
    lunchStart: normalizeTime(settingsForm.lunchStart),
    lunchEnd: normalizeTime(settingsForm.lunchEnd),
  }
  for (const [key, value] of Object.entries(times)) {
    if (!value) {
      settingsError.value = '时间格式应为 08:00'
      return
    }
  }
  settingsSaving.value = true
  try {
    const res = await request.post('/api/attendance/settings', times)
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '保存失败')
    toast.success('默认时间已保存')
    settingsOpen.value = false
    loadMonth()
  } catch (e) {
    settingsError.value = e?.response?.data?.msg || e?.message || '保存失败'
  } finally {
    settingsSaving.value = false
  }
}

function todayMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(delta) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  loadMonth()
}

async function loadMonth() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await request.get('/api/attendance/month', { params: { month: month.value } })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '加载失败')
    const data = body.data || {}
    days.value = Array.isArray(data.days) ? data.days : []
    summary.workDays = data.workDays || 0
    summary.overtimeDays = data.overtimeDays || 0
    summary.restDays = data.restDays || 0
    summary.compDays = data.compDays || 0
    summary.totalMinutes = data.totalMinutes || 0
    summary.missCount = data.missCount || 0
    summary.incompleteDays = data.incompleteDays || 0
    summary.dutyCount = data.dutyCount || 0
    summary.dutyAmount = Number(data.dutyAmount || 0)
    if (data.settings) {
      settings.workStart = (data.settings.workStart || '08:00').slice(0, 5)
      settings.workEnd = (data.settings.workEnd || '17:30').slice(0, 5)
      settings.lunchStart = (data.settings.lunchStart || '12:00').slice(0, 5)
      settings.lunchEnd = (data.settings.lunchEnd || '13:30').slice(0, 5)
      settings.standardMinutes = data.settings.standardMinutes || 480
      settings.dutyRate = Number(data.settings.dutyRate || 50)
    }
  } catch (e) {
    loadError.value = e?.response?.data?.msg || e?.message || '加载失败'
    days.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  month.value = todayMonth()
  if (!guest) loadMonth()
})

// ===== 月历格子（周一起始）=====
const grid = computed(() => {
  if (!days.value.length) return []
  const first = days.value[0].workDate // YYYY-MM-DD
  const [y, m] = first.split('-').map(Number)
  const firstDow = new Date(y, m - 1, 1).getDay() // 0=周日
  const pad = (firstDow + 6) % 7 // 周一起始 ⇒ 周一=0
  const cells = []
  for (let i = 0; i < pad; i += 1) cells.push(null)
  for (const d of days.value) cells.push(d)
  /*
   * 补齐到 **42 格（6 行）**（2026-10-24，使用方选"固定 6 行高度"）。
   * 有的月份 5 行、有的 6 行，若按实际行数，切月时整块会跳一下 —— 固定后不跳。
   */
  while (cells.length % 7 !== 0) cells.push(null)
  while (cells.length < 42) cells.push(null)
  return cells
})

function dowOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

function timesOf(day) {
  const out = []
  if (day.amIn) out.push(day.amIn.slice(0, 5))
  if (day.amOut) out.push(day.amOut.slice(0, 5))
  if (day.pmIn) out.push(day.pmIn.slice(0, 5))
  if (day.pmOut) out.push(day.pmOut.slice(0, 5))
  return out
}

function missCountOf(day) {
  return [day.missAmIn, day.missAmOut, day.missPmIn, day.missPmOut].filter(Boolean).length
}

function cellTone(day) {
  if (day.dayType === 'overtime') return 'is-overtime'
  // 法定节假日单独一层（2026-11-02）：要和"普通周末休息"在颜色上分开
  if (day.dayType === 'rest' && day.holidayName) return 'is-holiday'
  if (day.dayType === 'rest') return 'is-rest'
  if (day.dayType === 'comp') return 'is-comp'
  return timesOf(day).length ? 'is-work' : 'is-work-empty'
}

/*
 * 格子里的时长（2026-10-24，变更-171 续）。
 *
 * 使用方：「日期行的具体时间可以不要，太影响美观了，只标注时长就够了，比如 8h」
 * 口径和他一致：工作日 = 下班−上班−午休（08:00→17:30 记 **8h**）；
 * 加班日 = 两段之和（4+4 = 8h）。整数不带小数，非整写 8.5h。
 */
/**
 * 休息格上的文字（2026-11-02）：有节日名就显示节日名（国庆 / 春节 …），否则「休息」。
 * 后端 `AttendanceCalendar.holidayName()` 在生成整月时已填在每一天上。
 */
function restLabel(day) {
  return day && day.holidayName ? day.holidayName : '休息'
}

/**
 * 上下班区间与午休的**重叠分钟数**（2026-11-02）。
 *
 * 使用方：「假设 12:00 下班，那工时也不应该是 2.5h，而是 4 个小时啊」——
 * 原实现是无条件扣掉整段午休（1.5h），半天班被扣成了 2.5h。
 * 现在只扣真正重叠的部分：
 *   08:00~12:00 → 重叠 0            → 4h   ✓
 *   08:00~17:30 → 重叠 1.5h         → 8h   ✓
 *   08:00~13:00 → 重叠 1h(12~13)    → 4h   ✓
 * 任何一端缺失 ⇒ 不算重叠（少扣总比多扣好，缺的时长会由"缺段"提示出来）。
 */
function lunchOverlap(start, end) {
  if (!start || !end) return 0
  const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number)
    return h * 60 + m
  }
  const s = toMin(start)
  const e = toMin(end)
  const ls = toMin(settings.lunchStart)
  const le = toMin(settings.lunchEnd)
  const overlap = Math.min(e, le) - Math.max(s, ls)
  return overlap > 0 ? overlap : 0
}

function durationText(day) {
  const need = day.dayType === 'work' || day.dayType === 'overtime'
  if (!need) return ''
  let minutes = 0
  const span = (a, b) => {
    if (!a || !b) return 0
    const [ah, am] = a.split(':').map(Number)
    const [bh, bm] = b.split(':').map(Number)
    const diff = (bh * 60 + bm) - (ah * 60 + am)
    return diff > 0 ? diff : 0
  }
  if (day.dayType === 'overtime') {
    minutes = span(day.amIn, day.amOut) + span(day.pmIn, day.pmOut)
  } else {
    const gross = span(day.amIn, day.amOut)
    minutes = gross > 0 ? Math.max(gross - lunchOverlap(day.amIn, day.amOut), 0) : 0
  }
  if (!minutes) return ''
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`
}

/** 是不是今天（用本地日期字符串比较，避免时区/夏令时坑） */
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function minutesText(total) {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} 分`
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

/*
 * 左右滑动切换月份（2026-10-24，变更-171 续）。
 *
 * 使用方要「跟手拖动」（在"整页滑入"和"跟手"之间选了跟手）。做法：
 *   1. touchmove 时月历块跟着手指平移（只动 transform，不触发布局，不重绘格子）；
 *   2. 松手：位移超过 56px ⇒ 先滑出屏幕，再换月，让新月从另一侧就位后滑回 0；
 *      没超过 ⇒ 弹回原位（190ms ease-out）。
 * 只渲染"当前这一个月"的 DOM，不预取前后月 —— 手感够跟手，也不会多拉两份数据。
 * 竖向手势优先让给页面滚动（dx > dy*1.2 才判为横滑），避免"想上下翻却切了月"。
 */
const slide = reactive({ x: 0, animating: false })
const gridRef = ref(null)
let touchStartX = 0
let touchStartY = 0
let gestureAxis = '' // '' | 'h' | 'v'

function onTouchStart(e) {
  // 弹层开着时月历不该跟着动（使用方 2026-10-24：「录入抽屉改成不能左右滑动」）
  if (editorOpen.value || settingsOpen.value) return
  if (slide.animating) return
  const t = e.touches?.[0]
  if (!t) return
  touchStartX = t.clientX
  touchStartY = t.clientY
  gestureAxis = ''
}

function onTouchMove(e) {
  if (editorOpen.value || settingsOpen.value) return
  if (slide.animating) return
  const t = e.touches?.[0]
  if (!t) return
  const dx = t.clientX - touchStartX
  const dy = t.clientY - touchStartY
  if (!gestureAxis) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    gestureAxis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v'
  }
  if (gestureAxis !== 'h') return
  const limit = 120
  slide.x = Math.max(-limit, Math.min(limit, dx))
}

function onTouchEnd() {
  if (editorOpen.value || settingsOpen.value) return
  if (slide.animating) return
  const dx = slide.x
  gestureAxis = ''
  const width = gridRef.value?.getBoundingClientRect?.().width || 360

  if (Math.abs(dx) < 56) {
    slide.animating = true
    slide.x = 0
    setTimeout(() => {
      slide.animating = false
    }, 220)
    return
  }

  const dir = dx < 0 ? 1 : -1 // 向左拖 = 看下个月
  slide.animating = true
  slide.x = -dir * width
  setTimeout(() => {
    shiftMonth(dir)
    slide.x = dir * width
    setTimeout(() => {
      slide.x = 0
      setTimeout(() => {
        slide.animating = false
      }, 240)
    }, 30)
  }, 190)
}

// ===== 编辑 =====
const editorOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  workDate: '',
  dayType: 'work',
  amIn: '',
  amOut: '',
  pmIn: '',
  pmOut: '',
  missAmIn: false,
  missAmOut: false,
  missPmIn: false,
  missPmOut: false,
  hasDuty: false,
  note: '',
  persisted: false,
})

function openDay(day) {
  if (!day) return
  form.workDate = day.workDate
  form.dayType = day.dayType
  form.amIn = day.amIn ? day.amIn.slice(0, 5) : ''
  form.amOut = day.amOut ? day.amOut.slice(0, 5) : ''
  form.pmIn = day.pmIn ? day.pmIn.slice(0, 5) : ''
  form.pmOut = day.pmOut ? day.pmOut.slice(0, 5) : ''
  form.missAmIn = Boolean(day.missAmIn)
  form.missAmOut = Boolean(day.missAmOut)
  form.missPmIn = Boolean(day.missPmIn)
  form.missPmOut = Boolean(day.missPmOut)
  form.hasDuty = Boolean(day.hasDuty)
  form.note = day.note || ''
  form.persisted = Boolean(day.persisted)

  /*
   * 打开时若这天还没录过时间（默认铺出来的日子就是这样），直接按默认作息填好
   * （2026-11-02）。原来留空、让灰色占位文字去"暗示"，使用方看到 17:00 以为默认是 17:00。
   * 填成实值后：打开就是 08:00 / 17:30，保存即 8 小时。
   */
  if (!form.amIn && !form.amOut) {
    if (form.dayType === 'work') {
      form.amIn = settings.workStart
      form.amOut = settings.workEnd
    } else if (form.dayType === 'overtime') {
      form.amIn = settings.workStart
      form.amOut = settings.lunchStart
      form.pmIn = settings.lunchEnd
      form.pmOut = settings.workEnd
    }
  }

  formError.value = ''
  editorOpen.value = true
}

const needsTimes = computed(() => form.dayType === 'work' || form.dayType === 'overtime')

/** 弹层标题右侧的摘要（例如「工作日 · 值班」） */
const dutySummaryText = computed(() => (form.hasDuty ? ' · 值班' : ''))

/** 值班单价（来自「默认时间」设置里的 duty_rate，默认 50 元/次） */
const dutyRateText = computed(() => {
  const rate = Number(settings.dutyRate ?? 50)
  if (!Number.isFinite(rate)) return '50'
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(2)
})
const isOvertime = computed(() => form.dayType === 'overtime')

function pickType(type) {
  form.dayType = type
  if (type === 'rest' || type === 'comp') {
    form.amIn = ''
    form.amOut = ''
    form.pmIn = ''
    form.pmOut = ''
    form.missAmIn = false
    form.missAmOut = false
    form.missPmIn = false
    form.missPmOut = false
  }
  if (type === 'work') {
    form.pmIn = ''
    form.pmOut = ''
    form.missPmIn = false
    form.missPmOut = false
  }
  /*
   * 切到「休息日加班」：按标准作息把 4 段预填好
   * （使用方：「休息日加班时间是 8:00-12:00、13:30-17:30，和平常一样，
   *   只不过加班日人事要查午休卡」）⇒ 上午 上班→午休、下午 上班→下班 各一段。
   */
  /*
   * 「工作日」也预填（2026-11-02）：使用方的操作是"周六上班了 ⇒ 把那天改成工作日"，
   * 原来只有加班会预填，改成工作日会得到一条"类型=工作日、四段全空"的行 ——
   * 格子上没有 8h，还报缺段，看起来像没存上。
   */
  if (type === 'work' && !form.amIn && !form.amOut) {
    /*
     * 工作日只有两段：上班 / 下班（2026-11-02 修）
     * 原来错用加班的四段填法，把「下班」填成午休 12:00 ⇒ 工时算成 2.5h ✗
     * 使用方看到的就是"12:00 下班、2.5 小时"，而他要的是 08:00~17:30 = 8h。
     */
    form.amIn = settings.workStart
    form.amOut = settings.workEnd
    form.pmIn = ''
    form.pmOut = ''
  } else if (type === 'overtime' && !form.amIn && !form.amOut) {
    // 休息日加班才是四段（上午上班→午休、下午上班→下班）
    form.amIn = settings.workStart
    form.amOut = settings.lunchStart
    form.pmIn = settings.lunchEnd
    form.pmOut = settings.workEnd
  }
}

/** "8:5" → "08:05"；非法返回 '' */
/**
 * 时间选择器回调（2026-11-02：上下班时间从文本框换成原生时间选择器）。
 * uni 的 picker 回传的是 { detail: { value: 'HH:mm' } }。
 */
function onTimePicked(field, event) {
  const value = event && event.detail ? event.detail.value : ''
  if (value) form[field] = value
}

function normalizeTime(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const m = s.match(/^(\d{1,2})[:：.]?(\d{1,2})?$/)
  if (!m) return ''
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (h > 23 || min > 59) return ''
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

async function save() {
  if (saving.value) return
  formError.value = ''
  const payload = {
    workDate: form.workDate,
    dayType: form.dayType,
    amIn: needsTimes.value ? normalizeTime(form.amIn) || null : null,
    amOut: needsTimes.value ? normalizeTime(form.amOut) || null : null,
    pmIn: isOvertime.value ? normalizeTime(form.pmIn) || null : null,
    pmOut: isOvertime.value ? normalizeTime(form.pmOut) || null : null,
    missAmIn: needsTimes.value ? form.missAmIn : false,
    missAmOut: needsTimes.value ? form.missAmOut : false,
    missPmIn: isOvertime.value ? form.missPmIn : false,
    missPmOut: isOvertime.value ? form.missPmOut : false,
    // 值班：按次计费（默认 50 元/次），与白班/加班可并存，不占时间字段
    hasDuty: form.hasDuty,
    note: form.note || '',
  }

  // 填了但格式不对 ⇒ 明确报错，不要静默丢掉
  const typed = [
    ['上班', form.amIn],
    ['下班', form.amOut],
    ['下午上班', form.pmIn],
    ['下午下班', form.pmOut],
  ]
  for (const [label, raw] of typed) {
    if (String(raw ?? '').trim() && !normalizeTime(raw)) {
      formError.value = `${label}时间格式应为 08:30`
      return
    }
  }

  saving.value = true
  try {
    const res = await request.post('/api/attendance/save', payload)
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '保存失败')
    toast.success('已保存')
    editorOpen.value = false
    loadMonth()
  } catch (e) {
    formError.value = e?.response?.data?.msg || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeDay() {
  const ok = await new Promise((resolve) => {
    uni.showModal({
      title: '清除这一天',
      content: `清除 ${form.workDate} 的记录？会回到默认值。`,
      success: (r) => resolve(Boolean(r.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!ok) return
  try {
    const res = await request.delete('/api/attendance/day', { params: { date: form.workDate } })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '清除失败')
    toast.success('已清除')
    editorOpen.value = false
    loadMonth()
  } catch (e) {
    formError.value = e?.response?.data?.msg || e?.message || '清除失败'
  }
}

// ===== 复制本月（贴给人事）=====
async function copyMonth() {
  const lines = [`${month.value} 考勤`]
  for (const day of days.value) {
    if (day.dayType === 'rest') continue
    const t = timesOf(day)
    const miss = missCountOf(day)
    const parts = [day.workDate, TYPE_LABELS[day.dayType] || day.dayType, t.join(' / ') || '未录']
    if (miss) parts.push(`忘打卡 ${miss} 段`)
    if (day.note) parts.push(day.note)
    lines.push(parts.join('  '))
  }
  lines.push(
    `出勤 ${summary.workDays} 天，加班 ${summary.overtimeDays} 天，调休 ${summary.compDays} 天，合计 ${minutesText(summary.totalMinutes)}`,
  )
  try {
    uni.setClipboardData({ data: lines.join('\n') })
  } catch {
    toast.error('复制失败，请手动选择')
  }
}

/*
 * 弹层背景不再用纯白（使用方：「抽屉最下方的白色感觉跟 App 颜色不搭，难看」）。
 * 取 App 自己的"抬升面"色（跟随主题/配色），底部按钮条再浅一档，并压一条发丝线做分界。
 */
/*
 * 弹层宽度用 **100vw** 硬定，并 `overflow: hidden`
 * （2026-10-24 第三次修「输入框超出右边界」）。
 *
 * 前两次都在调 flex / padding，但真机上仍溢出 —— 说明问题不在某一层，而在
 * "整块宽度依赖祖先计算"这件事本身不可靠（uni 的 popup/scroll-view 都会插一层包装）。
 * 现在：弹层自身钉死 100vw，内部块级元素宽度用 `calc(100vw − 48rpx)` 算，
 * 与祖先宽度无关，也不依赖 box-sizing 的继承，溢出在数学上不可能。
 */
const popupStyle =
  'width: 100vw; max-width: 100vw; max-height: 88vh; display: flex; flex-direction: column;' +
  'overflow: hidden; background-color: var(--ui-sheet-fill);'
</script>

<template>
  <view class="at">
    <!-- 游客：看得见入口，不能用 -->
    <view v-if="guest" class="at__guest">
      <text class="at__guest-title">该功能需要注册账号</text>
      <text class="at__guest-sub">考勤按人隔离，每个账号只能看到自己的记录。注册并登录后即可使用。</text>
    </view>

    <template v-else>
    <!-- 月份切换 + 汇总 -->
    <view class="at__head">
      <view class="at__month">
        <text class="at__arrow" @click="shiftMonth(-1)">‹</text>
        <text class="at__month-text">{{ month }}</text>
        <text class="at__arrow" @click="shiftMonth(1)">›</text>
      </view>
      <view class="at__actions">
        <view class="at__copy" @click="openSettings">
          <text>默认时间</text>
        </view>
        <view class="at__copy" @click="copyMonth">
          <text>复制本月</text>
        </view>
      </view>
    </view>

    <view class="at__summary">
      <view class="at__sum-item">
        <text class="at__sum-num">{{ summary.workDays }}</text>
        <text class="at__sum-label">出勤</text>
      </view>
      <view class="at__sum-item">
        <text class="at__sum-num">{{ summary.overtimeDays }}</text>
        <text class="at__sum-label">加班</text>
      </view>
      <view class="at__sum-item">
        <text class="at__sum-num">{{ summary.compDays }}</text>
        <text class="at__sum-label">调休</text>
      </view>
      <view class="at__sum-item at__sum-item--wide">
        <text class="at__sum-num">{{ minutesText(summary.totalMinutes) }}</text>
        <text class="at__sum-label">合计工时</text>
      </view>
    </view>

    <view v-if="summary.dutyCount" class="at__duty">
      <text>值班 {{ summary.dutyCount }} 次 · ￥{{ summary.dutyAmount }}</text>
    </view>

    <view v-if="summary.missCount || summary.incompleteDays" class="at__warn">
      <text v-if="summary.missCount">忘打卡 {{ summary.missCount }} 段</text>
      <text v-if="summary.incompleteDays">缺段 {{ summary.incompleteDays }} 天</text>
    </view>

    <view v-if="loadError" class="at__error" @click="loadMonth">
      <text>{{ loadError }}（点一下重试）</text>
    </view>

    <!-- 月历 -->
    <!--
      色块图例（2026-11-02）：颜色必须能被读懂，不然橙色、靛蓝各是什么要猜。
      色值与格子底色同源（见下方 .at__cell 的 is-overtime / is-holiday 等）。
    -->
    <view class="at__legend">
      <view v-for="item in LEGEND" :key="item.label" class="at__legend-item">
        <view class="at__legend-swatch" :style="{ backgroundColor: item.color }"></view>
        <text class="at__legend-text">{{ item.label }}</text>
      </view>
    </view>

    <view class="at__week">
      <text v-for="w in WEEK_LABELS" :key="w" class="at__week-cell">{{ w }}</text>
    </view>

    <view
      ref="gridRef"
      class="at__grid-wrap"
      @touchstart.stop="onTouchStart"
      @touchmove.stop.prevent="onTouchMove"
      @touchend.stop="onTouchEnd"
      @touchcancel.stop="onTouchEnd"
    >
      <view
        class="at__grid"
        :class="{ 'is-dragging': !slide.animating, 'is-snapping': slide.animating }"
        :style="{ transform: `translate3d(${slide.x}px, 0, 0)` }"
      >
        <view
          v-for="(cell, index) in grid"
          :key="cell ? cell.workDate : `pad-${index}`"
          class="at__cell"
          :class="[
            cell ? cellTone(cell) : 'is-pad',
            cell && cell.hasDuty ? 'is-duty' : '',
            cell && cell.workDate === todayStr() ? 'is-today' : '',
          ]"
          @click="cell && openDay(cell)"
        >
          <template v-if="cell">
            <text class="at__day">{{ Number(cell.workDate.slice(-2)) }}</text>
            <!-- 值班徽章（2026-11-02）：原来是 10rpx 的小绿点，太小；改成右上角实色「值」 -->
            <text v-if="cell.hasDuty" class="at__duty-badge">值</text>
            <text v-if="durationText(cell)" class="at__dur">{{ durationText(cell) }}</text>
            <!--
              标签压成一行（2026-10-24）：原来「加班」「值班」各占一行，加上日期和时长共 4 行，
              比格子还高，字直接溢出边框。现在加班/调休 + 忘打并排一行；
              值班靠**整格绿底 + 右上角绿点**表达（已经够显眼，不再占一行文字）。
            -->
            <view class="at__tags">
              <text v-if="cell.dayType === 'overtime'" class="at__tag">加班</text>
              <text v-else-if="cell.dayType === 'comp'" class="at__tag">调休</text>
              <!--
                休息日标出来（2026-11-02 使用方：「休息的地方标出来，这样更直观」）。
                原来休息日只靠格底变淡 + 没有 8h 来表达，扫一眼分不清
                "休息"还是"这天忘了填"。
                再进一步（同日）：「10.3、10.4 都是国庆假期，节日也要体现出来」
                ⇒ 后端给了 holidayName（元旦/春节/清明/劳动/端午/中秋/国庆），
                   有就用节日名，没有才是「休息」。周末与法定节假日在对账里意义不同
                   （节假日加班按 3 倍），不该长得一样。
              -->
              <text v-else-if="cell.dayType === 'rest'" class="at__tag at__tag--rest">{{ restLabel(cell) }}</text>
              <text v-if="missCountOf(cell)" class="at__miss">忘{{ missCountOf(cell) }}</text>
            </view>
          </template>
        </view>
      </view>
    </view>

    <view class="at__hint">
      <text>默认已按「周一到周五 + 每月最后一个周六上班、法定节假日休息」填好，有变动点那天改</text>
    </view>

    <!-- 默认时间（首次生成新月份时用这套值） -->
    <wd-popup v-model="settingsOpen" position="center" round :lock-scroll="true" :duration="220" custom-style="width: 86%;">
      <view class="st">
        <text class="st__title">默认上下班时间</text>
        <text class="st__hint">
          标准工作日按「下班 − 上班 − 午休」算，现在每天 {{ Math.round(settings.standardMinutes / 60 * 10) / 10 }} 小时。
          只影响之后新生成的月份，已生成的不动。
        </text>

        <view v-if="settingsError" class="st__error"><text>{{ settingsError }}</text></view>

        <view class="st__row">
          <text class="st__label">上班</text>
          <input v-model="settingsForm.workStart" class="st__input" placeholder="08:00" />
        </view>
        <view class="st__row">
          <text class="st__label">午休开始</text>
          <input v-model="settingsForm.lunchStart" class="st__input" placeholder="12:00" />
        </view>
        <view class="st__row">
          <text class="st__label">午休结束</text>
          <input v-model="settingsForm.lunchEnd" class="st__input" placeholder="13:30" />
        </view>
        <view class="st__row">
          <text class="st__label">下班</text>
          <input v-model="settingsForm.workEnd" class="st__input" placeholder="17:30" />
        </view>

        <view class="st__foot">
          <view class="ed__btn ed__btn--ghost" @click="settingsOpen = false"><text>取消</text></view>
          <view class="ed__btn ed__btn--primary" :class="{ 'is-busy': settingsSaving }" @click="saveSettings">
            <text>{{ settingsSaving ? '保存中…' : '保存' }}</text>
          </view>
        </view>
      </view>
    </wd-popup>

    <!-- 编辑弹层 -->
    <wd-popup
      v-model="editorOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      :lock-scroll="true"
      :duration="280"
      :custom-style="popupStyle"
    >
      <view class="ed">
        <view class="ed__grabber"></view>

        <view class="ed__head">
          <view class="ed__head-main">
            <text class="ed__date">{{ form.workDate }}</text>
            <text class="ed__meta">{{ TYPE_LABELS[form.dayType] }}{{ dutySummaryText }}</text>
          </view>
          <text class="ed__close" @click="editorOpen = false">关闭</text>
        </view>

        <view v-if="formError" class="ed__error"><text>{{ formError }}</text></view>

        <scroll-view class="ed__body" scroll-y>
          <!-- 类型：四个胶囊，独占一行 -->
          <view class="ed__block">
            <text class="ed__label">类型</text>
            <view class="ed__types">
              <view
                v-for="(label, key) in TYPE_LABELS"
                :key="key"
                class="ed__type"
                :class="{ 'is-on': form.dayType === key }"
                @click="pickType(key)"
              >
                <text>{{ label }}</text>
              </view>
            </view>
          </view>

          <!-- 值班：独立开关（使用方 2026-10-24 说"没找到录入值班"，做成明显的开关 + 金额） -->
          <view class="ed__block">
            <!--
              值班开关（2026-11-02 使用方：「值班的选择框不明显，完全意识不到这是一个选择框」）。
              原来是一个 28rpx 的空心小方框，和旁边的说明文字混在一起看不出来能点；
              现在：整行进一个带底色的行 + 右侧一个 96×52rpx 的滑动开关 + 「开 / 关」文字，
              选中时整块变绿。点整行都能切。
            -->
            <view class="ed__switch" :class="{ 'is-on': form.hasDuty }" @click="form.hasDuty = !form.hasDuty">
              <view class="ed__switch-text">
                <text class="ed__switch-title">值班（夜班 20:00-次日 08:00）</text>
                <text class="ed__switch-sub">按次计费 ￥{{ dutyRateText }} / 次 · 与白班、加班可同时存在</text>
              </view>
              <view class="ed__toggle" :class="{ 'is-on': form.hasDuty }">
                <view class="ed__toggle-knob"></view>
              </view>
              <text class="ed__toggle-label">{{ form.hasDuty ? '开' : '关' }}</text>
            </view>
          </view>

          <!-- 时间：标签在上、输入框占满整行，右侧只放一个小「忘打」chip -->
          <view v-if="needsTimes" class="ed__block">
            <text class="ed__label">时间</text>
            <!--
              每一段时间改成**上下两行**（2026-10-24，使用方：「输入框都超出右边界了」）。
              原来名称+输入框+忘打挤在一行，uni 的 input 有默认宽度、不肯收缩 ⇒ 必然溢出。
              现在：第一行 = 名称 + 忘打 chip，第二行 = 输入框占满整宽，永远塞得下。
            -->
            <view class="ed__time">
              <view class="ed__time-head">
                <text class="ed__time-name">{{ isOvertime ? '上午上班' : '上班' }}</text>
                <view class="ed__chip" :class="{ 'is-on': form.missAmIn }" @click="form.missAmIn = !form.missAmIn">
                  <text>{{ form.missAmIn ? '忘打卡' : '记忘打' }}</text>
                </view>
              </view>
              <picker mode="time" :value="form.amIn || settings.workStart" @change="onTimePicked('amIn', $event)">
                <view class="ed__time-input" :class="{ 'is-empty': !form.amIn }">
                  {{ form.amIn || settings.workStart }}
                </view>
              </picker>
            </view>

            <view class="ed__time">
              <view class="ed__time-head">
                <text class="ed__time-name">{{ isOvertime ? '午休' : '下班' }}</text>
                <view class="ed__chip" :class="{ 'is-on': form.missAmOut }" @click="form.missAmOut = !form.missAmOut">
                  <text>{{ form.missAmOut ? '忘打卡' : '记忘打' }}</text>
                </view>
              </view>
              <picker mode="time" :value="form.amOut || settings.workEnd" @change="onTimePicked('amOut', $event)">
                <view class="ed__time-input" :class="{ 'is-empty': !form.amOut }">
                  {{ form.amOut || settings.workEnd }}
                </view>
              </picker>
            </view>

            <template v-if="isOvertime">
              <view class="ed__time">
                <view class="ed__time-head">
                  <text class="ed__time-name">下午上班</text>
                  <view class="ed__chip" :class="{ 'is-on': form.missPmIn }" @click="form.missPmIn = !form.missPmIn">
                    <text>{{ form.missPmIn ? '忘打卡' : '记忘打' }}</text>
                  </view>
                </view>
                <picker mode="time" :value="form.pmIn || settings.lunchEnd" @change="onTimePicked('pmIn', $event)">
                <view class="ed__time-input" :class="{ 'is-empty': !form.pmIn }">
                  {{ form.pmIn || settings.lunchEnd }}
                </view>
              </picker>
              </view>
              <view class="ed__time">
                <view class="ed__time-head">
                  <text class="ed__time-name">下午下班</text>
                  <view class="ed__chip" :class="{ 'is-on': form.missPmOut }" @click="form.missPmOut = !form.missPmOut">
                    <text>{{ form.missPmOut ? '忘打卡' : '记忘打' }}</text>
                  </view>
                </view>
                <picker mode="time" :value="form.pmOut || settings.workEnd" @change="onTimePicked('pmOut', $event)">
                <view class="ed__time-input" :class="{ 'is-empty': !form.pmOut }">
                  {{ form.pmOut || settings.workEnd }}
                </view>
              </picker>
              </view>
            </template>
          </view>

          <view class="ed__block">
            <text class="ed__label">备注</text>
            <input v-model="form.note" class="ed__note" placeholder="请假事由等（选填）" placeholder-style="color: var(--ui-text-3)" />
          </view>
        </scroll-view>

        <view class="ed__foot">
          <view v-if="form.persisted && canEdit" class="ed__del" @click="removeDay">
            <text>清除</text>
          </view>
          <view class="ed__btn ed__btn--ghost" @click="editorOpen = false"><text>取消</text></view>
          <view
            v-if="canEdit"
            class="ed__btn ed__btn--primary"
            :class="{ 'is-busy': saving }"
            @click="save"
          >
            <text>{{ saving ? '保存中…' : '保存' }}</text>
          </view>
          <view v-else class="ed__btn ed__btn--disabled"><text>无编辑权限</text></view>
        </view>
      </view>
    </wd-popup>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.at {
  padding: 16rpx 20rpx 40rpx;
  box-sizing: border-box;
  /* 页面本体也不允许横向拖动（弹层打开时最容易被看到） */
  overflow-x: hidden;
  touch-action: pan-y;
}

.at__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.at__month {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.at__arrow {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  color: var(--ui-text-2);
  border-radius: 28rpx;
  background-color: var(--ui-raise-2);
}

.at__month-text {
  font-size: 32rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.at__actions {
  display: flex;
  gap: 10rpx;
}

.at__copy {
  height: 56rpx;
  padding: 0 22rpx;
  border-radius: 28rpx;
  display: flex;
  align-items: center;
  font-size: 24rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
}

.at__summary {
  display: flex;
  gap: 12rpx;
  margin-top: 16rpx;
}

.at__sum-item {
  flex: 1;
  padding: 14rpx 10rpx;
  border-radius: 16rpx;
  text-align: center;
  background-color: var(--ui-surface);
  border: 2rpx solid var(--ui-border);

  &--wide {
    flex: 1.6;
  }
}

.at__sum-num {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.at__sum-label {
  display: block;
  margin-top: 2rpx;
  font-size: 20rpx;
  color: var(--ui-text-3);
}

.at__duty {
  margin-top: 12rpx;
  padding: 10rpx 16rpx;
  border-radius: 14rpx;
  font-size: 22rpx;
  color: #3f9d6b;
  background-color: rgba(63, 157, 107, 0.12);
}

.at__tag--duty {
  color: #3f9d6b;
}

.at__guest {
  margin: 60rpx 20rpx;
  padding: 48rpx 32rpx;
  border-radius: 20rpx;
  text-align: center;
  background-color: var(--ui-surface);
  border: 2rpx solid var(--ui-border);
}

.at__guest-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.at__guest-sub {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
}

.at__warn {
  display: flex;
  gap: 16rpx;
  margin-top: 12rpx;
  padding: 10rpx 16rpx;
  border-radius: 14rpx;
  font-size: 22rpx;
  color: #e6a23c;
  background-color: rgba(230, 162, 60, 0.12);
}

.at__error {
  margin-top: 12rpx;
  padding: 12rpx 16rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.at__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10rpx 18rpx;
  padding: 0 8rpx 12rpx;
}

.at__legend-item {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.at__legend-swatch {
  width: 18rpx;
  height: 18rpx;
  border-radius: 5rpx;
}

.at__legend-text {
  font-size: 20rpx;
  color: var(--ui-text-3);
}

.at__week {
  display: flex;
  margin-top: 18rpx;
}

.at__week-cell {
  flex: 1;
  text-align: center;
  font-size: 20rpx;
  color: var(--ui-text-3);
}

/*
 * 固定 6 行高度（2026-10-24）：42 格 × 每格 112rpx = 672rpx。
 * 切月时高度不变，看起来才"稳"（使用时选的固定高度）。
 */
.at__grid-wrap {
  margin-top: 6rpx;
  overflow: hidden;
  /* 6 行 × 120rpx（2026-10-24：原来 112rpx 装不下"日期+时长+加班+值班"四行，字溢出边框） */
  height: 720rpx;
}

.at__grid {
  display: flex;
  flex-wrap: wrap;
  will-change: transform;

  &.is-snapping {
    transition: transform 190ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
}

.at__cell {
  width: calc(100% / 7);
  height: 120rpx;
  overflow: hidden;
  padding: 6rpx 4rpx;
  box-sizing: border-box;
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rpx;

  &.is-pad {
    background: transparent;
  }

  /*
   * ===== 状态配色（2026-11-02 重做）=====
   * 概念：贴在墙上的排班表 —— 普通工作日安静（白底），不寻常的日子才跳跃。
   * 六个状态互不撞色（改前加班与值班都是绿，一眼分不开 ✗）：
   *   加班 暖橙 · 值班 靛蓝 · 调休 紫褐 · 节日 金棕 · 休息 冷灰 · 工作日 白
   */
  &.is-rest {
    background-color: rgba(107, 114, 128, 0.08);
    border: 2rpx solid rgba(107, 114, 128, 0.16);
  }

  /* 法定节假日：金棕 + 左侧 4rpx 色条，与"普通周末"的冷灰分开 */
  &.is-holiday {
    background-color: rgba(138, 106, 31, 0.14);
    border: 2rpx solid rgba(138, 106, 31, 0.28);
    border-left-width: 6rpx;
    border-left-color: #8a6a1f;

    .at__tag {
      color: #7a5c18;
      font-weight: 700;
    }
  }

  &.is-comp {
    background-color: rgba(122, 75, 94, 0.12);
    border: 2rpx solid rgba(122, 75, 94, 0.26);

    .at__tag {
      color: #7a4b5e;
      font-weight: 700;
    }
  }

  &.is-work {
    background-color: var(--ui-surface);
    border: 2rpx solid var(--ui-border);
  }

  &.is-work-empty {
    background-color: var(--ui-surface);
    border: 2rpx dashed var(--ui-line-strong, rgba(0, 0, 0, 0.18));
  }

  /*
   * 加班：暖橙（最跳的一档）。使用方最想"一眼看到哪些天加班了"，
   * 所以把最暖最亮的色留给它，并用左侧 6rpx 色条再强调一次。
   */
  &.is-overtime {
    background-color: rgba(180, 83, 9, 0.13);
    border: 2rpx solid rgba(180, 83, 9, 0.3);
    border-left-width: 6rpx;
    border-left-color: #b45309;

    .at__tag {
      color: #9a4a1e;
      font-weight: 700;
    }
  }

  /*
   * 值班：靛蓝（夜班的语义色）+ 右上角实色徽章「值」。
   * 2026-10-24 使用方就要求"值班要显眼"；2026-11-02 进一步把颜色从绿改蓝，
   * 因为绿色原来和"加班"撞在一起，两个都绿根本分不开。
   */
  &.is-duty {
    border: 3rpx solid rgba(63, 93, 135, 0.55) !important;
    position: relative;

    .at__tag--duty {
      color: #3f5d87;
      font-weight: 700;
    }
  }

  /* 今天：品牌色描边 + 淡品牌底，在一堆灰淡格里最跳（使用方要求"一目了然"） */
  &.is-today {
    border: 3rpx solid var(--ui-brand, #b4551f) !important;
    background-color: rgba(180, 85, 31, 0.1) !important;

    .at__duty-badge {
  position: absolute;
  top: -2rpx;
  right: -2rpx;
  min-width: 26rpx;
  height: 26rpx;
  padding: 0 4rpx;
  border-radius: 0 0 0 10rpx;
  background-color: #3f5d87;
  color: #fff;
  font-size: 16rpx;
  font-weight: 700;
  line-height: 26rpx;
  text-align: center;
}

.at__day {
      color: var(--ui-brand, #b4551f);
      font-weight: 800;
    }
  }
}

.at__day {
  font-size: 24rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.at__tags {
  display: flex;
  align-items: center;
  gap: 6rpx;
  height: 24rpx;
  overflow: hidden;
  white-space: nowrap;
}

.at__tag {
  font-size: 18rpx;
  line-height: 1;
  color: var(--ui-text-2);
}

.at__tag--rest {
  color: var(--ui-text-3);
}

.at__dur {
  font-size: 20rpx;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-2);
}

.at__miss {
  font-size: 17rpx;
  line-height: 1;
  color: #e6a23c;
}

.at__hint {
  margin-top: 18rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

/* ===== 默认时间弹层 ===== */
.st {
  padding: 26rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
}

.st__title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.st__hint {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

.st__error {
  margin-top: 12rpx;
  padding: 10rpx 16rpx;
  border-radius: 12rpx;
  font-size: 23rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.st__row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 12rpx 0;
}

.st__label {
  flex-shrink: 0;
  width: 130rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.st__input {
  flex: 1;
  height: 72rpx;
  padding: 0 18rpx;
  border-radius: 14rpx;
  font-size: 26rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);
}

.st__foot {
  display: flex;
  gap: 14rpx;
  margin-top: 18rpx;
}

/* ===== 编辑弹层（2026-10-24 重排：标签在上、输入占满、忘打不再被挤出屏幕）===== */
/*
 * 弹层不能被左右拖走（2026-10-24，使用方：「弹层本身能被左右拖动」）。
 *
 * 根因不是弹层在拖，而是**整页在横向跟手**：弹层是固定层，页面一动，
 * 看起来就像抽屉被拖走。`touch-action: pan-y` 明确只允许竖向手势，
 * 横向的 pan 由浏览器直接忽略；再关掉横向溢出与弹性回弹。
 */
.ed {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 88vh;
  width: 100vw;
  max-width: 100vw;
  box-sizing: border-box;
  overflow: hidden;
  touch-action: pan-y;
  overscroll-behavior: contain;
}

.ed__grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 12rpx auto 0;
  border-radius: 4rpx;
  background-color: var(--ui-border-strong);
}

.ed__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 20rpx 32rpx 6rpx;
}

.ed__head-main {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  min-width: 0;
}

.ed__date {
  font-size: 34rpx;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.ed__meta {
  font-size: 23rpx;
  color: var(--ui-text-3);
}

.ed__close {
  flex-shrink: 0;
  padding: 8rpx 4rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.ed__error {
  margin: 6rpx 32rpx 0;
  padding: 12rpx 18rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.ed__body {
  flex: 1;
  min-height: 0;
  padding: 4rpx 24rpx 8rpx;
  box-sizing: border-box;
  width: 100vw;
  max-width: 100vw;
  overflow-x: hidden;
  touch-action: pan-y;
  overscroll-behavior: contain;
}

/* 块宽度 = 100vw − 左右各 24rpx 留白（与祖先无关，永不溢出） */
.ed__block {
  padding: 14rpx 0;
  width: calc(100vw - 48rpx);
  max-width: calc(100vw - 48rpx);
  box-sizing: border-box;
  overflow: hidden;
}

.ed__label {
  display: block;
  margin-bottom: 10rpx;
  font-size: 23rpx;
  font-weight: 600;
  color: var(--ui-text-3);
}

.ed__types {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.ed__type {
  height: 64rpx;
  padding: 0 22rpx;
  border-radius: 32rpx;
  display: flex;
  align-items: center;
  font-size: 25rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);

  &.is-on {
    color: #fff;
    font-weight: 600;
    background-color: var(--ui-brand, #b4551f);
    border-color: transparent;
  }
}

/* 值班开关：整行可点，带勾选框与单价说明 */
.ed__switch {
  display: flex;
  align-items: center;
  gap: 16rpx;
  width: calc(100vw - 48rpx);
  max-width: calc(100vw - 48rpx);
  box-sizing: border-box;
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);
  transition: background-color 160ms ease, border-color 160ms ease;

  &.is-on {
    background-color: rgba(63, 157, 107, 0.12);
    border-color: rgba(63, 157, 107, 0.42);
  }
}

.ed__toggle {
  position: relative;
  width: 96rpx;
  height: 52rpx;
  border-radius: 26rpx;
  background-color: var(--ui-surface-2);
  border: 2rpx solid var(--ui-border);
  flex-shrink: 0;
  transition: background-color 0.15s ease, border-color 0.15s ease;

  &.is-on {
    background-color: #3f8f5f;
    border-color: #3f8f5f;
  }
}

.ed__toggle-knob {
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background-color: #fff;
  box-shadow: 0 1rpx 4rpx rgba(0, 0, 0, 0.18);
  transition: transform 0.15s ease;

  .ed__toggle.is-on & {
    transform: translateX(44rpx);
  }
}

.ed__toggle-label {
  flex-shrink: 0;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.ed__switch-box {
  flex-shrink: 0;
  width: 44rpx;
  height: 44rpx;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3rpx solid var(--ui-border-strong);
  background-color: transparent;

  .ed__switch.is-on & {
    border-color: #3f9d6b;
    background-color: #3f9d6b;
  }
}

.ed__switch-tick {
  font-size: 26rpx;
  font-weight: 700;
  color: #fff;
  line-height: 1;
}

.ed__switch-text {
  min-width: 0;
}

.ed__switch-title {
  display: block;
  font-size: 26rpx;
  color: var(--ui-text);
}

.ed__switch-sub {
  display: block;
  margin-top: 4rpx;
  font-size: 21rpx;
  color: var(--ui-text-3);
}

/* 每一段时间：上下两行（名称 + 忘打 在上，输入框整宽在下） */
.ed__time {
  margin-bottom: 14rpx;
  width: calc(100vw - 48rpx);
  max-width: calc(100vw - 48rpx);
  box-sizing: border-box;
  overflow: hidden;
}

.ed__time-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 8rpx;
}

.ed__time-name {
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.ed__time-input {
  display: flex;
  align-items: center;
  min-height: 80rpx;

  &.is-empty {
    color: var(--ui-text-3);
  }

  display: block;
  width: calc(100vw - 48rpx);
  max-width: calc(100vw - 48rpx);
  box-sizing: border-box;
  height: 76rpx;
  padding: 0 18rpx;
  border-radius: 14rpx;
  font-size: 28rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);
}

.ed__chip {
  flex-shrink: 0;
  height: 52rpx;
  padding: 0 18rpx;
  border-radius: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 21rpx;
  color: var(--ui-text-3);
  background-color: var(--ui-raise-2);
  border: 2rpx solid transparent;

  &.is-on {
    color: #e6a23c;
    font-weight: 600;
    border-color: rgba(230, 162, 60, 0.45);
    background-color: rgba(230, 162, 60, 0.14);
  }
}

.ed__note {
  display: block;
  width: calc(100vw - 48rpx);
  max-width: calc(100vw - 48rpx);
  box-sizing: border-box;
  height: 80rpx;
  padding: 0 18rpx;
  border-radius: 14rpx;
  font-size: 26rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);
}

.ed__foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
  width: 100vw;
  max-width: 100vw;
  box-sizing: border-box;
  padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid var(--ui-hairline);
  /* 用 App 的"抬升面"而不是纯白：纯白压在粉色场景上像贴纸（使用方原话：跟 App 颜色不搭） */
  background-color: var(--ui-raise);

  /* 底部安全区也一起上色，避免最下面露出一条白 */
  box-shadow: 0 -1rpx 0 var(--ui-hairline);
}

.ed__del {
  flex-shrink: 0;
  height: 80rpx;
  padding: 0 22rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.ed__btn {
  height: 80rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 600;

  &--ghost {
    flex: 0 0 140rpx;
    color: var(--ui-text-2);
    background-color: var(--ui-raise-2);
  }

  &--primary {
    flex: 1;
    color: #fff;
    background-color: var(--ui-brand, #b4551f);

    &.is-busy {
      opacity: 0.6;
    }
  }

  &--disabled {
    flex: 1;
    color: var(--ui-text-3);
    background-color: var(--ui-raise-2);
  }
}
</style>
