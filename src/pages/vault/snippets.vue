<template>
  <view class="sn" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart" @touchend="onEdgeEnd">
    <PageTitle title="MCP & Skills" />

    <view class="sn__tabs">
      <view class="sn__tab" @click="goVault">密码</view>
      <view class="sn__tab is-on">配方</view>
    </view>

    <view class="sn__intro">
      <text class="sn__intro-text">
        点一下就是复制，粘给新电脑的 DSH，它自己就装好了。
      </text>
    </view>

    <view class="sn__bar">
      <view class="sn__search">
        <text class="sn__search-icon">🔍</text>
        <input
          v-model="keyword"
          class="sn__search-input"
          placeholder="搜名字或说明，比如 rea、部署、cad"
          placeholder-class="sn__search-ph"
          confirm-type="search"
        />
        <text v-if="keyword" class="sn__search-clear" @click="keyword = ''">✕</text>
      </view>

      <view class="sn__kinds">
        <text
          v-for="item in KINDS"
          :key="item.key"
          class="sn__kind"
          :class="{ 'is-on': kind === item.key }"
          @click="kind = item.key"
        >{{ item.label }}</text>
        <text v-if="filtering" class="sn__count">{{ rows.length }} / {{ all.length }}</text>
      </view>
    </view>

    <scroll-view class="sn__scroll" scroll-y :show-scrollbar="false">
      <view v-if="!all.length" class="sn__empty">
        <text class="sn__empty-title">还没记过</text>
        <text class="sn__empty-text">
          以后我看到好用的，你让我记一下，我读完就写在这儿。你自己刷到了也可以点下面加。
        </text>
      </view>

      <view v-else-if="!rows.length" class="sn__empty">
        <text class="sn__empty-title">没搜到「{{ keyword || kindLabel }}」</text>
        <text class="sn__empty-text">换个词试试，或者把标签点回「全部」。</text>
        <view class="sn__empty-btn" @click="resetFilter">看全部 {{ all.length }} 条</view>
      </view>

      <view
        v-for="row in rows"
        :key="row.id"
        class="sn__card"
        @click="useItem(row)"
        @longpress="openSheet(row)"
      >
        <view class="sn__card-head">
          <text class="sn__name">{{ row.name }}</text>
          <text class="sn__copy">复制</text>
        </view>
        <text v-if="row.desc" class="sn__desc">{{ row.desc }}</text>
        <text class="sn__snippet">{{ brief(row.text) }}</text>
      </view>

      <view class="sn__sync">
        <text class="sn__sync-text">{{ syncText }}</text>
      </view>
    </scroll-view>

    <view class="sn__bottom">
      <view class="sn__add" @click="goEdit()">＋ 记一条</view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PageTitle from '../../components/PageTitle.vue'
import { useTheme } from '../../composables/useTheme'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'
import { isAdmin } from '../../api/auth'
import { copyToClipboard } from '../../utils/clipboard'
import { lastSyncedAt, pullAndMerge, readSnippets, removeSnippet } from '../../utils/vault'

const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const KINDS = [
  { key: 'all', label: '全部' },
  { key: 'pkg', label: '安装包' },
  { key: 'mcp', label: 'MCP' },
  { key: 'skill', label: 'Skill' },
]

/* 条目一多就翻不动了（25 条时使用方原话：「想找个 skill 得翻好久」）。
 * 分类不额外存字段，直接看名字前缀 —— 条目本来就按 `包 · ` / `mcp · ` / `skill · ` 命名，
 * 以后新增照这个前缀起名，分类自动对上，不用维护第二份数据。 */
const KIND_ORDER = { pkg: 0, mcp: 1, skill: 2 }

function kindOf(row) {
  const name = String(row.name || '')
  if (name.startsWith('包')) return 'pkg'
  if (name.startsWith('skill')) return 'skill'
  // 「密码箱」这种老条目本身就是装 MCP 的，归到 mcp
  return 'mcp'
}

const all = ref([])
const keyword = ref('')
const kind = ref('all')

const kindLabel = computed(() => (KINDS.find((item) => item.key === kind.value) || KINDS[0]).label)
const filtering = computed(() => Boolean(keyword.value.trim()) || kind.value !== 'all')

const rows = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return all.value
    .filter((row) => kind.value === 'all' || kindOf(row) === kind.value)
    .filter((row) => {
      if (!q) return true
      return [row.name, row.desc, row.text].some((field) => String(field || '').toLowerCase().includes(q))
    })
    .sort((a, b) => (KIND_ORDER[kindOf(a)] ?? 9) - (KIND_ORDER[kindOf(b)] ?? 9))
})

function resetFilter() {
  keyword.value = ''
  kind.value = 'all'
}

const syncedAt = ref('')
const syncing = ref(false)
const syncError = ref('')

const syncText = computed(() => {
  if (!isAdmin()) return ''
  if (syncing.value) return '正在同步…'
  if (syncError.value) return `同步失败：${syncError.value}`
  const at = syncedAt.value
  return at ? `刚同步 · ${at.slice(11, 16)}` : '还没同步过'
})

function refresh() {
  all.value = readSnippets()
  syncedAt.value = lastSyncedAt()
}

async function sync() {
  if (syncing.value) return
  syncing.value = true
  syncError.value = ''
  try {
    await pullAndMerge()
    refresh()
  } catch (err) {
    syncError.value = (err && err.message) || '网络不通'
  } finally {
    syncing.value = false
  }
}

onShow(() => {
  if (!isAdmin()) {
    uni.showToast({ title: '只有管理员能看', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 600)
    return
  }
  refresh()
  sync()
})

/** 切回「密码」页签：redirect 换页，返回键回首页，不来回弹 */
function goVault() {
  uni.redirectTo({ url: '/pages/vault/vault' })
}

/** 卡片上只放前三行，剩下的留白，反正点一下就是复制整段 */
function brief(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const lines = raw.split('\n').filter((line) => line.trim())
  const head = lines.slice(0, 3).join('\n')
  return lines.length > 3 ? `${head}\n…` : head
}

async function useItem(row) {
  const ok = await copyToClipboard(row.text, `${row.name} 的安装说明`)
  if (ok) {
    uni.showToast({ title: '已复制，去电脑上粘给 DSH', icon: 'none' })
  }
}

function openSheet(row) {
  uni.showActionSheet({
    itemList: ['复制这段话', '改一下', '删掉'],
    success: ({ tapIndex }) => {
      if (tapIndex === 0) {
        useItem(row)
        return
      }
      if (tapIndex === 1) {
        goEdit(row.id)
        return
      }
      uni.showModal({
        title: '删掉这条？',
        content: '电脑那边同步下来也会跟着没。',
        confirmText: '删',
        confirmColor: '#D14343',
        success: ({ confirm }) => {
          if (!confirm) return
          removeSnippet(row.id)
          refresh()
          uni.showToast({ title: '删了', icon: 'none' })
        },
      })
    },
  })
}

function goEdit(id) {
  const query = id ? `?id=${encodeURIComponent(id)}` : ''
  uni.navigateTo({ url: `/pages/vault/snippet${query}` })
}
</script>

<style lang="scss" scoped>
.sn {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-bg);
  overflow: hidden;
}

.sn__intro {
  padding: 4rpx 32rpx 8rpx;
}

.sn__intro-text {
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--ui-text-2);
}

.sn__tabs {
  display: flex;
  gap: 10rpx;
  margin: 0 28rpx;
  padding: 6rpx;
  border-radius: 22rpx;
  background: var(--ui-raise, var(--ui-surface));
}

.sn__tab {
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  text-align: center;
  font-size: 28rpx;
  color: var(--ui-text-2);
  border-radius: 18rpx;
}

.sn__tab.is-on {
  color: var(--ui-text);
  font-weight: 600;
  background: var(--ui-surface);
}

.sn__bar {
  padding: 8rpx 28rpx 0;
}

.sn__search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 80rpx;
  padding: 0 24rpx;
  border-radius: 20rpx;
  background: var(--ui-surface);
}

.sn__search-icon {
  font-size: 26rpx;
  opacity: 0.5;
}

.sn__search-input {
  flex: 1;
  font-size: 28rpx;
  color: var(--ui-text);
}

.sn__search-ph {
  color: var(--ui-text-3);
}

.sn__search-clear {
  font-size: 26rpx;
  color: var(--ui-text-3);
  padding: 8rpx;
}

.sn__kinds {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 0 2rpx;
}

.sn__kind {
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  font-size: 24rpx;
  color: var(--ui-text-2);
  background: var(--ui-surface);
}

.sn__kind.is-on {
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

.sn__count {
  margin-left: auto;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.sn__empty-btn {
  margin: 28rpx auto 0;
  width: 400rpx;
  height: 76rpx;
  line-height: 76rpx;
  border-radius: 999rpx;
  font-size: 26rpx;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

.sn__scroll {
  flex: 1;
  height: 0;
  padding: 16rpx 28rpx 0;
  box-sizing: border-box;
}

.sn__card {
  padding: 24rpx 26rpx;
  margin-bottom: 16rpx;
  border-radius: 22rpx;
  background: var(--ui-surface);
}

.sn__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.sn__name {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.sn__copy {
  flex-shrink: 0;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  font-size: 23rpx;
  color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.sn__desc {
  display: block;
  margin-top: 10rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--ui-text-2);
}

.sn__snippet {
  display: block;
  margin-top: 14rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
  background: var(--ui-raise);
  word-break: break-all;
}

.sn__empty {
  padding: 110rpx 32rpx;
  text-align: center;
}

.sn__empty-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.sn__empty-text {
  display: block;
  margin: 20rpx auto 0;
  max-width: 540rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-2);
}

.sn__sync {
  padding: 24rpx 0 40rpx;
  text-align: center;
}

.sn__sync-text {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.sn__bottom {
  padding: 16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom));
}

.sn__add {
  height: 96rpx;
  line-height: 96rpx;
  text-align: center;
  border-radius: 24rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}
</style>
