<script setup>
import { computed, onMounted, ref } from 'vue'
import { onPullDownRefresh } from '@dcloudio/uni-app'
import request from '../../api/request'
import { authState, isAdmin, isLoggedIn } from '../../api/auth'
import { useTheme } from '../../composables/useTheme'
import LoadingMask from '../../components/LoadingMask.vue'
import PanelState from '../../components/PanelState.vue'

/*
 * 电费（手机端，2026-11-04）
 *
 * 使用方的要求与决定：
 *   · 手机上看三个东西：汇总 / 分类汇总 / 预提单（矩阵视图与预提分摊不放手机 —— 38 块表 × 30 天横滑没人用）
 *   · 占比用**横向条形**（手机竖屏比饼图清楚，扇区标签也不会叠字）
 *   · 谁看得到金额：所有登录用户能看电量；**只有 admin 能看到电费金额**
 *   · 谁能录入电量：admin 与被 admin 授予「抄表员」的人（后端控制，这里只管入口显隐）
 *
 * 口径（与 PC 完全一致）：总电量 = 1 号高压计量表；四组按使用方 2026-11-04 的定义；
 * 抄表都在早上 08:00，所以跨月的期按"日窗口"折算，7/31 那天归 7 月。
 */

const { themeClass, themeVars } = useTheme()

const view = ref('overview') // overview | monthly | bill

/*
 * 页签手势（2026-11-06）
 * 三个平级页签要能左右滑切换。只做方向感：跟手位移 + 松手吸附，不做弹跳与视差 ——
 * 现场看数字的人需要"我翻了一页"，而不是"内容淡出了"。
 */
const tabDx = ref(0)
const tabDragging = ref(false)
let tabStartX = 0
let tabStartY = 0
let tabLocked = false

/** 滑块位置：索引 × 100%（宽度在 CSS 里按三段算） */
const thumbStyle = computed(() => ({
  transform: `translate3d(${Math.max(0, TABS.findIndex((t) => t.key === view.value)) * 100}%, 0, 0)`,
}))

/** 内容区：拖时无过渡（跟手），松手 240ms 吸附 */
const swipeStyle = computed(() => ({
  transform: `translate3d(${tabDx.value}px, 0, 0)`,
  transition: tabDragging.value ? 'none' : 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)',
}))

function onTabTouchStart(event) {
  const touch = event.touches?.[0]
  if (!touch) return
  tabStartX = touch.clientX
  tabStartY = touch.clientY
  tabDragging.value = true
  tabLocked = false
  tabDx.value = 0
}

function onTabTouchMove(event) {
  const touch = event.touches?.[0]
  if (!touch || !tabDragging.value) return
  const dx = touch.clientX - tabStartX
  const dy = touch.clientY - tabStartY
  // 方向锁：纵向为主就交回页面滚动，不跟页面抢
  if (!tabLocked && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
    tabDragging.value = false
    tabDx.value = 0
    return
  }
  if (Math.abs(dx) > 8) tabLocked = true
  const index = TABS.findIndex((t) => t.key === view.value)
  const atEdge = (index === 0 && dx > 0) || (index === TABS.length - 1 && dx < 0)
  tabDx.value = atEdge ? dx * 0.32 : dx
}

function onTabTouchEnd() {
  if (!tabDragging.value) return
  const width = uni.getSystemInfoSync().windowWidth || 375
  const threshold = width * 0.18
  const index = TABS.findIndex((t) => t.key === view.value)
  const dx = tabDx.value
  tabDragging.value = false
  tabDx.value = 0
  if (dx <= -threshold && index < TABS.length - 1) view.value = TABS[index + 1].key
  else if (dx >= threshold && index > 0) view.value = TABS[index - 1].key
}
const TABS = [
  { key: 'overview', label: '汇总' },
  { key: 'monthly', label: '分类汇总' },
  { key: 'bill', label: '预提单' },
]

/** 本月 YYYY-MM */
function currentMonth() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${month}`
}

const month = ref(currentMonth())
const loading = ref(false)
const errorText = ref('')

const monthly = ref(null)
const bill = ref(null)

/** 金额只有 admin 能看 */
const showMoney = computed(() => isAdmin())

/** 能否录入电量（入口显隐；真正的判定在后端） */
const canWrite = computed(() => isAdmin() || authState.roleKey === 'meter_clerk')

/** 提示：当前显示的月份不是本月时，说明是自动回退过来的 */
const fallbackHint = ref('')

/** 取某个月的汇总 + 预提单；没有抄表期就抛错，交给上层判断 */
async function fetchMonth(targetMonth) {
  const [monthlyRes, billRes] = await Promise.all([
    request.get('/api/electricity/monthly', { params: { month: targetMonth } }),
    request.get('/api/electricity/bill', { params: { month: targetMonth } }),
  ])
  const monthlyBody = monthlyRes.data || {}
  const billBody = billRes.data || {}
  if (monthlyBody.success === false) throw new Error(monthlyBody.msg || '汇总加载失败')
  if (billBody.success === false) throw new Error(billBody.msg || '预提单加载失败')
  const monthlyData = monthlyBody.data || null
  const billData = billBody.data || null
  /*
   * 2026-11-04：只有一期、而且那一期跨月时，按 08:00 日窗口折算后落在本月天数是 0
   * ⇒ 总电量 0，但"月末补"又把整期量补了进来 ⇒ 四组几十万、总电量 0，自相矛盾。
   * 这种月份直接当成"没有数据"，让上层继续往前找。
   */
  const total = Number(monthlyData?.total || 0)
  const estimate = Number(billData?.estimateKwh || 0)
  if (total <= 0 || estimate <= 0) {
    throw new Error('这个月的抄表期不足，算不出当月用量')
  }
  return { monthly: monthlyData, bill: billData }
}

/**
 * 加载当前选中的月份。
 *
 * 2026-11-04：手机上默认落在本月，而本月往往还没抄表（比如 11 月 4 号只有 10 月的数据），
 * 一进来就报「这段区间里没有抄表期」，观感像坏了。所以本月取不到就**自动往前找**，
 * 最多找 6 个月，找到有数据的那一个月停；找到了会在顶部说明是自动回退的。
 */
async function load() {
  if (!isLoggedIn()) {
    errorText.value = '请先登录'
    return
  }
  loading.value = true
  errorText.value = ''
  fallbackHint.value = ''
  const original = month.value
  try {
    try {
      const first = await fetchMonth(month.value)
      monthly.value = first.monthly
      bill.value = first.bill
    } catch (inner) {
      // 本月没数据 → 往前找最多 6 个月
      let found = null
      let probe = month.value
      for (let step = 0; step < 6; step += 1) {
        const [y, m] = probe.split('-').map(Number)
        const prev = new Date(y, m - 2, 1)
        probe = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
        try {
          const got = await fetchMonth(probe)
          found = { month: probe, ...got }
          break
        } catch {
          // 继续往前
        }
      }
      if (!found) throw inner
      month.value = found.month
      monthly.value = found.monthly
      bill.value = found.bill
      fallbackHint.value = `${original.replace('-', ' 年 ')} 月还没有抄表数据，已自动显示 ${found.month.replace('-', ' 年 ')} 月`
    }
  } catch (e) {
    errorText.value = e?.response?.data?.msg || e?.message || '加载失败'
    monthly.value = null
    bill.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
onPullDownRefresh(async () => {
  await load()
  uni.stopPullDownRefresh()
})

/** 上/下个月 */
function shiftMonth(delta) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  load()
}

function fmt(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}

function fmt2(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 汇总页的四组（从预提单拿，口径与 PC 一致） */
const groupRows = computed(() => bill.value?.shares || [])

/** 占比条：以四组之和为分母（金额归一的口径） */
function groupRatio(row) {
  const sum = Number(bill.value?.groupSum || 0)
  return sum > 0 ? (Number(row.estimateKwh || 0) / sum) * 100 : 0
}

/** 分类汇总：每期卡片，展示总电量 + 前四列，点开看全部 */
const expandedPeriod = ref('')
function togglePeriod(key) {
  expandedPeriod.value = expandedPeriod.value === key ? '' : key
}

/** 一个期卡片里要展示的列（手机上先给最能看懂的几列） */
const COMPACT_COLUMNS = ['总电量', '公用工程', '乙炔车间', '1#厂房', '2#厂房', '其它']

function columnOf(period, name) {
  return Number(period?.values?.[name] || 0)
}

/** 全部列（详情用） */
const allColumns = computed(() => (monthly.value?.rows || []).filter((r) => !r.viewOnly))

function goRead() {
  uni.navigateTo({ url: '/pages/meterRead/meterRead' })
}
</script>

<template>
  <view :class="['el-page', themeClass]" :style="themeVars">
    <LoadingMask v-if="loading" />

    <!-- 顶部：月份切换 -->
    <view class="el-head">
      <view class="el-month">
        <view class="el-month-btn" hover-class="el-tap" @tap="shiftMonth(-1)">‹</view>
        <text class="el-month-text">{{ month }}</text>
        <view class="el-month-btn" :class="{ 'el-month-btn--off': month >= currentMonth() }" hover-class="el-tap" @tap="shiftMonth(1)">
          ›
        </view>
      </view>
      <view v-if="canWrite" class="el-read" hover-class="el-tap" @tap="goRead">去抄表</view>
      <view v-else class="el-read el-read--off">抄表需授权</view>
    </view>

    <!-- 自动回退提示（本月还没抄表时） -->
    <view v-if=fallbackHint class=el-fallback>
      <text class=el-fallback-text>{{ fallbackHint }}</text>
    </view>

    <!-- 页签 -->
    <view class="el-tabs">
      <!-- 滑块（2026-11-06）：位置 = 当前页签索引，切换时平移一格 -->
      <view class="el-tabs-thumb" :style="thumbStyle"></view>
      <view
        v-for="tab in TABS"
        :key="tab.key"
        class="el-tab"
        :class="{ 'el-tab--active': view === tab.key }"
        @tap="view = tab.key"
      >
        {{ tab.label }}
      </view>
    </view>

    <PanelState v-if="errorText" type="error" :title="errorText" description="下拉可重试" />
    <PanelState v-else-if="!loading && !monthly" type="empty" title="这个月还没有抄表数据" description="换个月份，或先在 PC 上录入" />

        <view
      v-else-if="monthly"
      class="el-swipe"
      :style="swipeStyle"
      @touchstart.stop="onTabTouchStart"
      @touchmove.stop.prevent="onTabTouchMove"
      @touchend.stop="onTabTouchEnd"
    >

      <!-- ============ 汇总 ============ -->
      <view v-if="view === 'overview'" class="el-body">
        <view class="el-hero">
          <text class="el-hero-label">本月总电量</text>
          <view class="el-hero-value">
            {{ fmt(monthly.total) }}<text class="el-hero-unit">度</text>
          </view>
          <view v-if="showMoney" class="el-hero-sub">
            预估电费 {{ fmt(bill?.advanceTotal) }} 元 · 单价 {{ bill?.price || '—' }} 元/度
          </view>
          <view v-else class="el-hero-sub">约 {{ fmt(monthly.total / 1000) }} 千度</view>
        </view>

        <!-- 四组 + 占比条 -->
        <view class="el-card">
          <view class="el-card-title">四组用量</view>
          <view v-for="row in groupRows" :key="row.section" class="el-bar-row">
            <view class="el-bar-head">
              <text class="el-bar-name">{{ row.section }}</text>
              <text class="el-bar-value">{{ fmt(row.estimateKwh) }} 度</text>
            </view>
            <view class="el-bar-track">
              <view class="el-bar-fill" :style="{ width: Math.max(2, groupRatio(row)) + '%' }"></view>
            </view>
            <view class="el-bar-foot">
              <text class="el-bar-pct">{{ Math.round(groupRatio(row)) }}%</text>
              <text v-if="showMoney" class="el-bar-money">{{ fmt(row.amount) }} 元</text>
            </view>
          </view>
        </view>

        <!-- 分类汇总的一行摘要（点击切到该页签） -->
        <view class="el-card el-link" hover-class="el-tap" @tap="view = 'monthly'">
          <view class="el-card-title">分类汇总</view>
          <view class="el-link-sub">{{ monthly.periods.length }} 期明细，点开看每期各区域用量 ›</view>
        </view>

        <view v-if="bill" class="el-card el-link" hover-class="el-tap" @tap="view = 'bill'">
          <view class="el-card-title">预提单</view>
          <view class="el-link-sub">
            <template v-if="showMoney">建议预提 {{ fmt(bill.advanceTotal) }} 元 ›</template>
            <template v-else>预估 {{ fmt(bill.estimateKwh) }} 度 ›</template>
          </view>
        </view>

        <!--
          抄表入口（2026-11-04）
          使用方是管理员却说「没看到抄表」：原来的入口只有「抽屉最底部一行灰色小字」和
          「右上角一个小按钮」，太隐蔽。这里放一张明显的卡 + 大按钮。
          只有 admin 或被授予「抄表员」的人看到；别人看到的是"需要管理员授权"。
        -->
        <view class="el-card el-read-card">
          <view class="el-card-title">抄表</view>
          <view class="el-read-desc">
            <template v-if="canWrite">
              38 块表（37 块按编号 + 150车间那块不编号）按顺序读，右滑提交、左滑跳过，可以拍照存档
            </template>
            <template v-else>抄表需要管理员授权（我在 PC「电表台账」页底部授权）</template>
          </view>
          <view
            v-if="canWrite"
            class="el-read-btn"
            hover-class="el-tap"
            @tap="goRead"
          >
            开始抄表
          </view>
          <view v-else class="el-read-btn el-read-btn--off">无权限</view>
        </view>
      </view>

      <!-- ============ 分类汇总 ============ -->
      <view v-else-if="view === 'monthly'" class="el-body">
        <view
          v-for="(period, index) in monthly.periods"
          :key="period.from + period.to"
          class="el-period"
        >
          <view class="el-period-head" hover-class="el-tap" @tap="togglePeriod(period.from + period.to)">
            <view>
              <text class="el-period-name">第 {{ index + 1 }} 周</text>
              <text class="el-period-date">{{ period.from.slice(5) }} → {{ period.to.slice(5) }}</text>
            </view>
            <view class="el-period-total">
              <text class="el-period-kwh">{{ fmt(columnOf(period, '总电量')) }}</text>
              <text class="el-period-unit">度</text>
            </view>
          </view>

          <view class="el-period-grid">
            <view v-for="name in COMPACT_COLUMNS" :key="name" class="el-period-cell">
              <text class="el-period-cell-name">{{ name }}</text>
              <text class="el-period-cell-value">{{ fmt(columnOf(period, name)) }}</text>
            </view>
          </view>

          <!-- 展开：全部 9 列（不含两只"只看运转"的空压机） -->
          <view v-if="expandedPeriod === period.from + period.to" class="el-period-all">
            <view v-for="col in allColumns" :key="col.name" class="el-period-all-row">
              <text class="el-period-all-name">{{ col.name }}</text>
              <text class="el-period-all-value">{{ fmt(columnOf(period, col.name)) }}</text>
            </view>
          </view>
        </view>

        <!-- 合计 -->
        <view class="el-total">
          <text class="el-total-label">合计</text>
          <text class="el-total-value">{{ fmt(monthly.total) }} 度</text>
        </view>
      </view>

      <!-- ============ 预提单 ============ -->
      <view v-else-if="view === 'bill' && bill" class="el-body">
        <view class="el-hero el-hero--bill">
          <text class="el-hero-label">
            {{ showMoney ? '建议预提（走 OA 的数）' : '预估总电量' }}
          </text>
          <view class="el-hero-value">
            <template v-if="showMoney">{{ fmt(bill.advanceTotal) }}<text class="el-hero-unit">元</text></template>
            <template v-else>{{ fmt(bill.estimateKwh) }}<text class="el-hero-unit">度</text></template>
          </view>
          <view class="el-hero-sub">
            区间 {{ bill.from }} → {{ bill.to }}
            <text v-if="bill.tailDays > 0">（含月末补 {{ bill.tailDays }} 天）</text>
          </view>
        </view>

        <view class="el-card">
          <view class="el-card-title">算法链</view>
          <view class="el-trace-row">
            <text class="el-trace-name">已抄总电量</text>
            <text class="el-trace-value">{{ fmt(bill.doneTotal) }} 度</text>
          </view>
          <view class="el-trace-row">
            <text class="el-trace-name">月末补 {{ bill.tailDays }} 天</text>
            <text class="el-trace-value">{{ fmt(bill.tailTotal) }} 度</text>
          </view>
          <view class="el-trace-row">
            <text class="el-trace-name">预估总电量</text>
            <text class="el-trace-value">{{ fmt(bill.estimateKwh) }} 度</text>
          </view>
          <view class="el-trace-row">
            <text class="el-trace-name">× 1.05</text>
            <text class="el-trace-value">{{ fmt(bill.advanceKwh) }} 度</text>
          </view>
          <view class="el-trace-row">
            <text class="el-trace-name">命中电价</text>
            <text class="el-trace-value">{{ bill.price }} 元/度</text>
          </view>
          <view v-if="showMoney" class="el-trace-row">
            <text class="el-trace-name">理论电费</text>
            <text class="el-trace-value">{{ fmt2(bill.amount) }} 元</text>
          </view>
          <view v-if="showMoney" class="el-trace-row el-trace-row--strong">
            <text class="el-trace-name">万位向上取整</text>
            <text class="el-trace-value">{{ fmt(bill.advanceTotal) }} 元</text>
          </view>
        </view>

        <view class="el-card">
          <view class="el-card-title">四组分摊</view>
          <view v-for="row in groupRows" :key="row.section" class="el-share-row">
            <text class="el-share-name">{{ row.section }}</text>
            <text class="el-share-kwh">{{ fmt(row.estimateKwh) }} 度</text>
            <text class="el-share-pct">{{ Math.round(Number(row.ratio) * 100) }}%</text>
            <text v-if="showMoney" class="el-share-money">{{ fmt(row.amount) }} 元</text>
          </view>
          <view class="el-share-note">
            公用工程 = 公用工程 + 中控 + 污水 + 办公 + 其它；一车间 = 2# + 4#；二车间 = 1#；乙炔 = 乙炔
          </view>
        </view>

        <view v-if="!showMoney" class="el-hint">
          电费金额只对管理员显示；你看到的是电量与单价，金额请找厂长或财务
        </view>
      </view>
        </view>
  </view>
</template>

<style scoped>
/*
 * 手机端样式：沿用全站暖纸基底与 --ui-* 变量，
 * 所有颜色都走变量（暗色主题自动跟随），字号用 px（rpx 在平板/大屏会缩得离谱）。
 */
.el-page {
  min-height: 100vh;
  padding-bottom: 24px;
  /*
   * 弥散背景（2026-11-04，使用方：「背景都改成弥散渐变色，当前的都好单调」）
   *
   * 配方与 uni.scss 的 @mixin scene-bg 同源（三团柔光：淡紫 / 暖琥珀 / 灰粉），
   * 这里多铺一团强调色柔光、并把定位从固定 px 换成百分比 ——
   * 手机屏幕宽窄差很大，固定 px 在小屏上会只剩一团。
   */
  background-color: var(--ui-scene-bg);
  background-image:
    radial-gradient(circle at 88% -6%, var(--ui-scene-blob-1) 0%, transparent 58%),
    radial-gradient(circle at 6% 12%, var(--ui-scene-blob-2) 0%, transparent 52%),
    radial-gradient(circle at 92% 62%, var(--ui-scene-blob-3) 0%, transparent 56%),
    radial-gradient(circle at 12% 92%, var(--ui-accent-soft) 0%, transparent 54%);
  background-repeat: no-repeat;
  background-attachment: scroll;
}

/* ===== 入场动画（2026-11-04）=====
 * 卡片轻微上浮 + 淡入，按出现顺序错开；不改变布局高度（只在 transform/opacity 上做）。
 * 系统开启「减少动态效果」时下面有兜底，直接出静态结果。
 */
@keyframes el-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.el-hero,
.el-card,
.el-period,
.el-total,
.el-fallback {
  animation: el-rise 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.el-card:nth-of-type(1) {
  animation-delay: 40ms;
}

.el-card:nth-of-type(2) {
  animation-delay: 80ms;
}

.el-card:nth-of-type(3) {
  animation-delay: 120ms;
}

.el-card:nth-of-type(4) {
  animation-delay: 160ms;
}

@media (prefers-reduced-motion: reduce) {
  .el-hero,
  .el-card,
  .el-period,
  .el-total,
  .el-fallback {
    animation: none;
  }
}

.el-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
}

.el-month {
  display: flex;
  align-items: center;
  gap: 4px;
}

.el-month-btn {
  width: 28px;
  height: 28px;
  line-height: 26px;
  text-align: center;
  border-radius: 8px;
  color: var(--ui-text-2);
  background: var(--ui-raise);
  border: 1px solid var(--ui-border);
  font-size: 16px;
}

.el-month-btn--off {
  opacity: 0.35;
}

.el-month-text {
  min-width: 84px;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.el-read {
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

.el-read--off {
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

.el-tap {
  opacity: 0.72;
}

.el-fallback {
  margin: 0 16px 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--ui-amber-50);
  border: 1px solid var(--ui-amber-200);
}

.el-fallback-text {
  font-size: 11px;
  line-height: 1.5;
  color: var(--ui-amber-800);
}

/* 页签滑块（2026-11-06） */

.el-tabs-thumb {
    /* 2026-11-06：滑块就是那个蓝色胶囊本身（页签自己不再上色，否则两层叠在一起、还错位） */
    position: absolute;
    top: 0;
    left: 16px;
    width: calc((100% - 32px) / 3);
    height: 32px;
    border-radius: 8px;
    background: var(--ui-accent);
    box-shadow: 0 2px 8px rgba(47, 106, 176, 0.28);
    transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }


/* 内容区手势容器：只让 transform 参与动画 */

.el-swipe {

  will-change: transform;

}


@media (prefers-reduced-motion: reduce) {

  .el-tabs-thumb {

    transition: none;

  }

}


.el-tabs {
    display: flex;
    gap: 0;
    padding: 0 16px 10px;
    position: relative;
    overflow: hidden;
  }

.el-tab {
    position: relative;
    z-index: 1;
    flex: 1;
    height: 32px;
    line-height: 32px;
    text-align: center;
    border-radius: 8px;
    font-size: 13px;
    color: var(--ui-text-2);
    background: transparent;
    transition: color 180ms ease;
  }

.el-tab--active {
    color: var(--ui-on-accent);
    font-weight: 600;
  }

.el-body {
  padding: 0 16px;
}

.el-hero {
  padding: 16px;
  border-radius: 12px;
  /* 2026-11-04：弥散背景下用不透明表面，否则彩光透进来、字发虚 */
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  margin-bottom: 10px;
}

.el-hero--bill {
  border-color: var(--ui-accent);
}

.el-hero-label {
  font-size: 12px;
  color: var(--ui-text-2);
}

.el-hero-value {
  margin-top: 4px;
  font-size: 30px;
  font-weight: 700;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.el-hero-unit {
  margin-left: 4px;
  font-size: 13px;
  font-weight: 400;
  color: var(--ui-text-2);
}

.el-hero-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ui-text-2);
}

.el-card {
  padding: 14px;
  border-radius: 12px;
  /* 2026-11-04：弥散背景下用不透明表面，否则彩光透进来、字发虚 */
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  margin-bottom: 10px;
}

.el-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text);
  margin-bottom: 10px;
}

.el-link-sub {
  font-size: 12px;
  color: var(--ui-text-2);
}

/* 横向条形 */
.el-bar-row {
  margin-bottom: 12px;
}

.el-bar-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.el-bar-name {
  font-size: 13px;
  color: var(--ui-text);
}

.el-bar-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.el-bar-track {
  height: 8px;
  border-radius: 4px;
  background: var(--ui-raise-2);
  overflow: hidden;
}

.el-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--ui-accent), var(--ui-accent-2, var(--ui-accent)));
  /* 宽度变化有过渡：数据加载完是"长出来"，不是"啪"地出现（2026-11-04） */
  transition: width 500ms cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .el-bar-fill {
    transition: none;
  }
}

.el-bar-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}

.el-bar-pct,
.el-bar-money {
  font-size: 11px;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
}

/* 分类汇总：每期一张卡 */
.el-period {
  border-radius: 12px;
  /* 2026-11-04：弥散背景下用不透明表面，否则彩光透进来、字发虚 */
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  margin-bottom: 10px;
  overflow: hidden;
}

.el-period-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--ui-border);
}

.el-period-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text);
}

.el-period-date {
  margin-left: 8px;
  font-size: 11px;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
}

.el-period-total {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.el-period-kwh {
  font-size: 17px;
  font-weight: 700;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.el-period-unit {
  font-size: 11px;
  color: var(--ui-text-2);
}

.el-period-grid {
  display: flex;
  flex-wrap: wrap;
  padding: 8px 8px 4px;
}

.el-period-cell {
  width: 33.33%;
  padding: 4px 6px;
  box-sizing: border-box;
}

.el-period-cell-name {
  display: block;
  font-size: 11px;
  color: var(--ui-text-2);
}

.el-period-cell-value {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.el-period-all {
  border-top: 1px dashed var(--ui-border);
  padding: 6px 14px 10px;
}

.el-period-all-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
}

.el-period-all-name {
  font-size: 12px;
  color: var(--ui-text-2);
}

.el-period-all-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.el-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--ui-raise-2);
  border: 1px solid var(--ui-border);
}

.el-total-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text);
}

.el-total-value {
  font-size: 17px;
  font-weight: 700;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

/* 预提单：算法链 */
.el-trace-row {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px dashed var(--ui-border);
}

.el-trace-row:last-child {
  border-bottom: 0;
}

.el-trace-row--strong .el-trace-name,
.el-trace-row--strong .el-trace-value {
  color: var(--ui-text);
  font-weight: 700;
}

.el-trace-name {
  font-size: 12px;
  color: var(--ui-text-2);
}

.el-trace-value {
  font-size: 13px;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.el-share-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px dashed var(--ui-border);
}

.el-share-row:last-of-type {
  border-bottom: 0;
}

.el-share-name {
  flex: 1;
  font-size: 13px;
  color: var(--ui-text);
}

.el-share-kwh,
.el-share-pct,
.el-share-money {
  font-size: 12px;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
  margin-left: 10px;
}

.el-share-money {
  min-width: 76px;
  text-align: right;
  color: var(--ui-text);
  font-weight: 600;
}

.el-share-note {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ui-text-2);
}

/* 抄表卡：这是给现场用的入口，必须显眼 */
.el-read-card {
  border-color: var(--ui-accent);
}

.el-read-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ui-text-2);
  margin-bottom: 12px;
}

.el-read-btn {
  height: 44px;
  line-height: 44px;
  text-align: center;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

.el-read-btn--off {
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

.el-hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--ui-raise-2);
  font-size: 11px;
  line-height: 1.6;
  color: var(--ui-text-2);
}
</style>
