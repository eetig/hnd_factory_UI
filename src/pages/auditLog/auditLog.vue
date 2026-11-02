<script setup>
import { computed, onMounted, ref } from 'vue'
import { isAdmin } from '../../api/auth'
import request from '../../api/request'
import { useTheme } from '../../composables/useTheme'

/*
 * 管控日志（App 版，2026-11-02）。
 *
 * 使用方要求：「手机 App 上找不到管控日志」⇒ 做一个手机版。
 *
 * ## 为什么不是表格
 * PC 端是 7 列表格（时间/账号/事件/IP/设备/路径/结果），手机上横着放不下，
 * 竖着读又串行。所以手机版改成**一页一条的记录卡**：从上往下按时间读，
 * 像翻一本值班记录本。
 *
 * ## 不变的三条
 * ① 只读 —— 没有任何删除按钮，这是审计日志的底线
 * ② 只有管理员能进 —— 不是管理员就一句话送回去（接口层也会拒）
 * ③ 不进 App 的首页/抽屉主列表，入口放在抽屉最底下的小字里（不显眼、只主动点）
 */
const { themeClass, themeVars } = useTheme()

const allowed = computed(() => isAdmin())

const loading = ref(false)
const errorMessage = ref('')
const rows = ref([])
const total = ref(0)

/** 筛选：只留真正会用的两个 + 日期区间 */
const filters = ref({ username: '', event: '', days: 7 })

const EVENT_META = {
  login: { label: '登录', color: '#3F5D87' },
  logout: { label: '退出', color: '#5B6470' },
  register: { label: '注册', color: '#5B6E4F' },
  write_ok: { label: '写操作', color: '#8A5A2B' },
  write_denied: { label: '写操作被拒', color: '#B45309' },
  locked_clicked: { label: '点锁定功能', color: '#7A4B5E' },
}

const EVENT_OPTIONS = [
  { value: '', label: '全部事件' },
  { value: 'login', label: '登录' },
  { value: 'logout', label: '退出' },
  { value: 'write_ok', label: '写操作' },
  { value: 'write_denied', label: '写操作被拒' },
]

const DAY_OPTIONS = [
  { value: 1, label: '今天' },
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
]

function metaOf(event) {
  return EVENT_META[event] || { label: event || '未知', color: '#5B6470' }
}

function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

/** yyyy-MM-dd（本地时区，不用 toISOString：那个是 UTC，会差一天） */
function dateStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

const range = computed(() => {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - Math.max(0, Number(filters.value.days) - 1))
  return { from: dateStr(from), to: dateStr(to) }
})

/** 时间只显示到分钟：审计关心"什么时候"，秒没意义还占宽 */
function timeOf(value) {
  if (!value) return ''
  return String(value).replace('T', ' ').slice(11, 16)
}

/** 日期分组标题：今天 / 昨天 / 10-31 */
function dayLabel(date) {
  const today = dateStr(new Date())
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (date === today) return '今天'
  if (date === dateStr(y)) return '昨天'
  return String(date).slice(5)
}

/** 把 /api/xxx/yyy 翻成人话；翻不出来就原样显示 */
function pathText(path) {
  if (!path) return ''
  const pairs = [
    ['/api/tank-level', '储罐液位'],
    ['/api/attendance', '考勤'],
    ['/api/material', '物料'],
    ['/api/work-order', '工单'],
    ['/api/equipment', '设备'],
    ['/api/archive', '资料归档'],
    ['/api/purchase', '采购'],
    ['/api/user', '账号'],
    ['/api/audit', '管控'],
  ]
  for (const [prefix, label] of pairs) {
    if (path.startsWith(prefix)) return label + path.slice(prefix.length)
  }
  return path
}

const groups = computed(() => {
  const out = []
  let currentKey = ''
  for (const row of rows.value) {
    const date = String(row.createdAt || '').slice(0, 10)
    if (date !== currentKey) {
      currentKey = date
      out.push({ type: 'day', key: 'day-' + date, label: dayLabel(date) })
    }
    out.push({ type: 'row', key: 'row-' + row.id, row })
  }
  return out
})

async function load() {
  if (!allowed.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const params = { pageNum: 1, pageSize: 100, from: range.value.from, to: range.value.to }
    if (filters.value.username.trim()) params.username = filters.value.username.trim()
    if (filters.value.event) params.event = filters.value.event
    const res = await request.get('/api/audit/page', { params })
    const data = res.data?.data || {}
    rows.value = data.rows || []
    total.value = Number(data.total || 0)
  } catch (e) {
    rows.value = []
    total.value = 0
    errorMessage.value = e?.data?.msg || e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function pickEvent(value) {
  filters.value.event = value
  load()
}

function pickDays(value) {
  filters.value.days = value
  load()
}

function pickUsername() {
  // 账号用系统键盘输入；输完点「查询」
  load()
}

function backHome() {
  uni.switchTab ? uni.reLaunch({ url: '/pages/index/index' }) : uni.navigateBack()
}

onMounted(() => {
  if (!allowed.value) {
    uni.showToast({ title: '只有管理员能查看管控日志', icon: 'none' })
    setTimeout(backHome, 900)
    return
  }
  load()
})
</script>

<template>
  <view class="audit" :class="themeClass" :style="themeVars">
    <!-- 不是管理员：一句话说明，不放任何数据 -->
    <view v-if="!allowed" class="audit__deny">
      <text class="audit__deny-title">只有管理员能查看</text>
      <text class="audit__deny-text">这个页面记录的是账号与操作留痕，普通账号看不到。</text>
    </view>

    <template v-else>
      <!-- 筛选：账号 + 事件 + 日期档位，三样就够 -->
      <view class="audit__filters">
        <view class="audit__search">
          <input
            v-model="filters.username"
            class="audit__input"
            type="text"
            placeholder="按账号筛（留空看全部）"
            placeholder-class="audit__placeholder"
            confirm-type="search"
            @confirm="pickUsername"
          />
          <text class="audit__search-btn" @click="pickUsername">查询</text>
        </view>

        <scroll-view class="audit__chips" scroll-x>
          <view class="audit__chip-row">
            <text
              v-for="opt in EVENT_OPTIONS"
              :key="'e' + opt.value"
              class="audit__chip"
              :class="{ 'is-on': filters.event === opt.value }"
              @click="pickEvent(opt.value)"
            >{{ opt.label }}</text>
          </view>
        </scroll-view>

        <view class="audit__chip-row audit__chip-row--days">
          <text
            v-for="opt in DAY_OPTIONS"
            :key="'d' + opt.value"
            class="audit__chip audit__chip--sm"
            :class="{ 'is-on': filters.days === opt.value }"
            @click="pickDays(opt.value)"
          >{{ opt.label }}</text>
          <text class="audit__count">共 {{ total }} 条</text>
        </view>
      </view>

      <view v-if="errorMessage" class="audit__error">{{ errorMessage }}</view>

      <scroll-view class="audit__list" scroll-y>
        <view v-for="item in groups" :key="item.key">
          <text v-if="item.type === 'day'" class="audit__day">{{ item.label }}</text>

          <view v-else class="audit__card" :style="{ borderLeftColor: metaOf(item.row.event).color }">
            <view class="audit__card-head">
              <text class="audit__event" :style="{ color: metaOf(item.row.event).color }">
                {{ metaOf(item.row.event).label }}
              </text>
              <text class="audit__time">{{ timeOf(item.row.createdAt) }}</text>
            </view>

            <text v-if="pathText(item.row.path)" class="audit__path">
              {{ pathText(item.row.path) }}
            </text>

            <view class="audit__meta">
              <text class="audit__meta-item">{{ item.row.username || '未登录' }}</text>
              <text class="audit__meta-sep">·</text>
              <text class="audit__meta-item">{{ item.row.ip || 'IP 未知' }}</text>
              <template v-if="item.row.device">
                <text class="audit__meta-sep">·</text>
                <text class="audit__meta-item">{{ item.row.device }}</text>
              </template>
            </view>

            <view class="audit__tags">
              <text v-if="item.row.result === 'denied'" class="audit__tag audit__tag--warn">被拒</text>
              <text v-if="item.row.target" class="audit__tag">{{ item.row.target }}</text>
            </view>
          </view>
        </view>

        <view v-if="!loading && !rows.length" class="audit__empty">
          <text class="audit__empty-title">{{ loading ? '正在读取…' : '这段时间没有记录' }}</text>
          <text class="audit__empty-text">换个日期档位或清掉筛选试试。</text>
        </view>

        <text v-if="rows.length" class="audit__foot">
          只显示最近 {{ filters.days }} 天的前 100 条 · 只读，不可删除
        </text>
      </scroll-view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.audit {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 20rpx 24rpx 0;
  box-sizing: border-box;
  background-color: var(--ui-bg);
}

/* ---------- 非管理员 ---------- */
.audit__deny {
  margin-top: 120rpx;
  padding: 40rpx 32rpx;
  border-radius: 24rpx;
  background-color: var(--ui-surface);
  text-align: center;
}

.audit__deny-title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.audit__deny-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
}

/* ---------- 筛选 ---------- */
.audit__filters {
  flex-shrink: 0;
  padding-bottom: 12rpx;
}

.audit__search {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.audit__input {
  flex: 1;
  height: 72rpx;
  padding: 0 20rpx;
  border-radius: 16rpx;
  border: 2rpx solid var(--ui-border);
  background-color: var(--ui-surface);
  font-size: 26rpx;
  color: var(--ui-text);
}

.audit__placeholder {
  color: var(--ui-text-3);
}

.audit__search-btn {
  padding: 0 24rpx;
  height: 72rpx;
  line-height: 72rpx;
  border-radius: 16rpx;
  background-color: var(--ui-raise);
  font-size: 26rpx;
  color: var(--ui-text);
}

.audit__chips {
  margin-top: 12rpx;
  white-space: nowrap;
}

.audit__chip-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.audit__chip-row--days {
  margin-top: 10rpx;
}

.audit__chip {
  flex-shrink: 0;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  border: 2rpx solid var(--ui-border);
  background-color: var(--ui-surface);
  font-size: 24rpx;
  color: var(--ui-text-2);

  &.is-on {
    border-color: var(--ui-text);
    background-color: var(--ui-text);
    color: var(--ui-surface);
  }
}

.audit__chip--sm {
  padding: 6rpx 16rpx;
  font-size: 22rpx;
}

.audit__count {
  margin-left: auto;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.audit__error {
  margin: 8rpx 0;
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background-color: rgba(180, 83, 9, 0.1);
  font-size: 24rpx;
  color: #9a4a1e;
}

/* ---------- 列表：值班记录本 ---------- */
.audit__list {
  flex: 1;
  min-height: 0;
  padding-top: 8rpx;
}

.audit__day {
  display: block;
  margin: 20rpx 0 10rpx;
  padding-left: 4rpx;
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  color: var(--ui-text-3);
}

.audit__card {
  margin-bottom: 14rpx;
  padding: 20rpx 22rpx;
  border-radius: 20rpx;
  border: 2rpx solid var(--ui-border);
  border-left-width: 6rpx;
  border-left-style: solid;
  background-color: var(--ui-surface);
}

.audit__card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16rpx;
}

.audit__event {
  font-size: 28rpx;
  font-weight: 700;
}

.audit__time {
  font-size: 24rpx;
  color: var(--ui-text-3);
  font-variant-numeric: tabular-nums;
}

.audit__path {
  display: block;
  margin-top: 6rpx;
  font-size: 26rpx;
  line-height: 1.5;
  color: var(--ui-text-2);
}

.audit__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8rpx;
  margin-top: 8rpx;
}

.audit__meta-item {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.audit__meta-sep {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.audit__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 10rpx;
}

.audit__tag {
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  border: 2rpx solid var(--ui-border);
  font-size: 20rpx;
  color: var(--ui-text-3);
}

.audit__tag--warn {
  border-color: rgba(180, 83, 9, 0.35);
  background-color: rgba(180, 83, 9, 0.1);
  color: #9a4a1e;
}

.audit__empty {
  padding: 120rpx 32rpx;
  text-align: center;
}

.audit__empty-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-text-2);
}

.audit__empty-text {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.audit__foot {
  display: block;
  padding: 24rpx 0 60rpx;
  text-align: center;
  font-size: 22rpx;
  color: var(--ui-text-3);
}
</style>
