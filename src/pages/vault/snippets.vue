<template>
  <view class="sn" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart" @touchend="onEdgeEnd">
    <PageTitle title="MCP & Skills" />

    <view class="sn__intro">
      <text class="sn__intro-text">
        刷到好用的工具就记这儿。换电脑时点一下复制，粘给那边的 DSH，它自己就装好了。
      </text>
    </view>

    <scroll-view class="sn__scroll" scroll-y :show-scrollbar="false">
      <view v-if="!rows.length" class="sn__empty">
        <text class="sn__empty-title">还没记过</text>
        <text class="sn__empty-text">
          以后我看到好用的，你让我记一下，我读完就写在这儿。你自己刷到了也可以点下面加。
        </text>
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

const rows = ref([])
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
  rows.value = readSnippets()
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
