<script setup>
import { computed, onMounted, ref } from 'vue'
import request from '../../api/request'
import { isAdmin } from '../../api/auth'
import { useTheme } from '../../composables/useTheme'

/*
 * 用户名单（App 版，2026-11-13）
 *
 * 使用方原话：「有哪些注册用户、什么时候注册的，没有查看入口。这个功能只能手机 App 端能
 * 使用，而且除了管理员，其他人看不到这个功能。」
 *
 * ## 为什么只有 App 有
 * 这是个"偶尔核对一下"的页面，不是日常干活的地方。放在 PC 端会变成一个新的菜单项，
 * 而 PC 端业务菜单已经够长了；手机上点开看一眼、退出来，成本最低。
 *
 * ## 三条约束
 * ① 只有管理员能进 —— 入口在抽屉里也只对管理员渲染，接口层同样会拒（不是靠前端藏）
 * ② 只读 —— 不提供改角色/改密码/停用，这个页面只回答"有谁、什么时候来的"
 * ③ 不显示密码（后端也不返回），只列姓名、账号、角色、注册时间、是否启用
 */
const { themeClass, themeVars } = useTheme()

const allowed = computed(() => isAdmin())

const loading = ref(false)
const errorMessage = ref('')
const users = ref([])
const total = ref(0)
const enabled = ref(0)
const keyword = ref('')

/** 角色 key → 中文；后端已经给了 roleName，这里只在它为空时兜底 */
const ROLE_LABEL = {
  admin: '管理员',
  team_leader: '班组长',
  operator: '操作员',
  meter_clerk: '抄表员',
  member: '成员',
  guest: '游客',
}

function roleText(row) {
  return row.roleName || ROLE_LABEL[row.roleKey] || '未分配角色'
}

function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 后端给的是 ISO（2026-10-24T21:59:21），换成「2026-10-24 21:59」 */
function timeText(value) {
  if (!value) return '时间未知'
  const s = String(value)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return s
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
}

/** 「多少天前来的」—— 比一串时间戳好读 */
function daysAgoText(value) {
  if (!value) return ''
  const t = Date.parse(String(value).replace(' ', 'T'))
  if (!Number.isFinite(t)) return ''
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  return months === 1 ? '1 个月前' : `${months} 个月前`
}

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return users.value
  return users.value.filter((row) => {
    const hay = `${row.realName || ''} ${row.username || ''} ${roleText(row)}`.toLowerCase()
    return hay.includes(k)
  })
})

async function load() {
  if (!allowed.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await request.get('/api/user-admin/list')
    const body = res?.data || {}
    if (body.code && body.code !== 200) {
      throw new Error(body.msg || '读不到名单')
    }
    const payload = body.data || {}
    users.value = Array.isArray(payload.users) ? payload.users : []
    total.value = Number(payload.total || users.value.length)
    enabled.value = Number(payload.enabled || 0)
  } catch (e) {
    errorMessage.value = e?.body?.msg || e?.message || '读不到名单，检查一下网络'
    users.value = []
    total.value = 0
    enabled.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <view class="ua" :class="themeClass" :style="themeVars">
    <!-- 不是管理员：一句话说明，连条数都不显示 -->
    <view v-if="!allowed" class="ua__deny">
      <text class="ua__deny-title">只有管理员能看</text>
      <text class="ua__deny-text">这里是账号名单，只有管理员能看到。</text>
    </view>

    <template v-else>
      <view class="ua__head">
        <view class="ua__head-main">
          <text class="ua__count">{{ total }}</text>
          <text class="ua__count-unit">个账号</text>
        </view>
        <text class="ua__head-sub">{{ enabled }} 个启用 · {{ total - enabled }} 个停用</text>
      </view>

      <view class="ua__search">
        <input
          v-model="keyword"
          class="ua__input"
          type="text"
          placeholder="搜姓名 / 账号 / 角色"
          placeholder-class="ua__placeholder"
          confirm-type="search"
        />
        <text v-if="keyword" class="ua__clear" @click="keyword = ''">清空</text>
      </view>

      <view v-if="errorMessage" class="ua__error" @click="load">{{ errorMessage }}（点这里重试）</view>

      <scroll-view class="ua__list" scroll-y>
        <view
          v-for="row in filtered"
          :key="row.id"
          class="ua__card"
          :class="{ 'is-off': Number(row.status) !== 1 }"
        >
          <view class="ua__card-head">
            <text class="ua__name">{{ row.realName || row.username }}</text>
            <text class="ua__role">{{ roleText(row) }}</text>
          </view>
          <view class="ua__card-meta">
            <text class="ua__account">@{{ row.username }}</text>
            <text v-if="Number(row.status) !== 1" class="ua__off">已停用</text>
          </view>
          <text class="ua__time">{{ timeText(row.createTime) }} 注册 · {{ daysAgoText(row.createTime) }}</text>
        </view>

        <view v-if="!loading && !filtered.length" class="ua__empty">
          <text class="ua__empty-title">{{ loading ? '正在读取…' : (keyword ? '没有匹配的账号' : '还没有注册账号') }}</text>
          <text class="ua__empty-text">{{ keyword ? '换个姓名或账号试试。' : '有人在 App 或网页注册后，这里就会出现。' }}</text>
        </view>

        <text v-if="filtered.length" class="ua__foot">
          按注册时间从新到旧 · 只读，不能在这里改角色或停用
        </text>
      </scroll-view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.ua {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 20rpx 24rpx 0;
  box-sizing: border-box;
  background-color: var(--ui-bg);
}

/* ---------- 非管理员 ---------- */
.ua__deny {
  margin-top: 120rpx;
  padding: 40rpx 32rpx;
  border-radius: 24rpx;
  background-color: var(--ui-surface);
  text-align: center;
}

.ua__deny-title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.ua__deny-text {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
}

/* ---------- 头部统计 ---------- */
.ua__head {
  flex-shrink: 0;
  padding: 20rpx 24rpx;
  border-radius: 24rpx;
  background-color: var(--ui-surface);
}

.ua__head-main {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
}

.ua__count {
  font-size: 60rpx;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.ua__count-unit {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.ua__head-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

/* ---------- 搜索 ---------- */
.ua__search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
  margin-top: 16rpx;
}

.ua__input {
  flex: 1;
  height: 76rpx;
  padding: 0 22rpx;
  border-radius: 18rpx;
  border: 2rpx solid var(--ui-border);
  background-color: var(--ui-surface);
  font-size: 26rpx;
  color: var(--ui-text);
}

.ua__placeholder {
  color: var(--ui-text-3);
}

.ua__clear {
  padding: 0 20rpx;
  height: 76rpx;
  line-height: 76rpx;
  border-radius: 18rpx;
  background-color: var(--ui-raise);
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.ua__error {
  flex-shrink: 0;
  margin-top: 16rpx;
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  background-color: var(--ui-amber-50);
  font-size: 24rpx;
  line-height: 1.5;
  color: var(--ui-amber-800);
}

/* ---------- 名单 ---------- */
.ua__list {
  flex: 1;
  min-height: 0;
  margin-top: 16rpx;
}

.ua__card {
  margin-bottom: 14rpx;
  padding: 22rpx 24rpx;
  border-radius: 22rpx;
  background-color: var(--ui-surface);
}

.ua__card.is-off {
  opacity: 0.66;
}

.ua__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.ua__name {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.ua__role {
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  background-color: var(--ui-accent-soft);
  font-size: 22rpx;
  color: var(--ui-on-accent-soft);
}

.ua__card-meta {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 8rpx;
}

.ua__account {
  font-size: 24rpx;
  color: var(--ui-text-2);
}

.ua__off {
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background-color: var(--ui-amber-50);
  font-size: 20rpx;
  color: var(--ui-amber-800);
}

.ua__time {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.ua__empty {
  padding: 80rpx 24rpx;
  text-align: center;
}

.ua__empty-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.ua__empty-text {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

.ua__foot {
  display: block;
  padding: 20rpx 0 40rpx;
  text-align: center;
  font-size: 22rpx;
  color: var(--ui-text-3);
}
</style>
