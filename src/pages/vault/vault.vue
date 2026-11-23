<template>
  <view class="vt" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart" @touchend="onEdgeEnd">
    <PageTitle title="密码箱" />

    <view v-if="!allowed" class="vt__deny">
      <text class="vt__deny-title">只有管理员能看</text>
      <text class="vt__deny-text">这是你自己账号的密码。换个管理员账号登录才有。</text>
    </view>

    <template v-else>
      <!-- 一级只有两格：拿它去「查密码」，还是去「抄配方」 -->
      <view class="vt__tabs">
        <view class="vt__tab is-on">密码</view>
        <view class="vt__tab" @click="goSnippets">配方</view>
      </view>

      <!-- 搜索 + 状态 -->
      <view class="vt__bar">
        <view class="vt__search">
          <text class="vt__search-icon">🔍</text>
          <input
            v-model="keyword"
            class="vt__search-input"
            placeholder="搜名称 / 地址 / 用户"
            placeholder-class="vt__search-ph"
            confirm-type="search"
          />
          <text v-if="keyword" class="vt__search-clear" @click="keyword = ''">✕</text>
        </view>
      </view>

      <view class="vt__meta">
        <text class="vt__meta-strong">{{ items.length }} 条</text>
        <text class="vt__meta-rest">{{ syncText }}</text>
      </view>

      <scroll-view class="vt__scroll" scroll-y :show-scrollbar="false">
        <!-- 空：两种情况，话不一样 -->
        <view v-if="!items.length" class="vt__empty">
          <text class="vt__empty-title">还没拉下来</text>
          <text class="vt__empty-text">
            电脑上的密码会自动同步过来。要是网不好，先点下面这个按钮，把内置的几条装上顶一下。
          </text>
          <view class="vt__empty-btn" @click="doSeed">载入我电脑上的这几条</view>
          <text class="vt__empty-tip">以后在电脑上跟 DSH 说「帮我记一下 XX」，这里就有了。</text>
        </view>

        <view v-else-if="!grouped.length" class="vt__empty">
          <text class="vt__empty-title">没搜到「{{ keyword }}」</text>
          <text class="vt__empty-text">换个词试试，或者点右上角叉清掉关键词。</text>
        </view>

        <!-- 分组平铺 -->
        <view v-for="group in grouped" :key="group.name" class="vt__group">
          <text class="vt__group-name">{{ group.name }}</text>
          <view
            v-for="item in group.items"
            :key="item.id"
            class="vt__card"
            @click="useItem(item)"
            @longpress="openSheet(item)"
          >
            <view class="vt__card-top">
              <text class="vt__card-name">{{ item.name }}</text>
              <text class="vt__chip">{{ typeLabel(item.type) }}</text>
            </view>
            <view class="vt__line">
              <text class="vt__line-key">地址</text>
              <text class="vt__line-val">{{ addressOf(item) || '没填' }}</text>
            </view>
            <view v-if="item.username" class="vt__line">
              <text class="vt__line-key">用户</text>
              <text class="vt__line-val">{{ item.username }}</text>
            </view>
            <view class="vt__line">
              <text class="vt__line-key">密码</text>
              <text class="vt__line-pass">{{ item.password || '（空）' }}</text>
            </view>
            <text v-if="item.note" class="vt__note">{{ item.note }}</text>
          </view>
        </view>

        <!-- 备份藏在最底下：平时用不到，换手机才用 -->
        <view class="vt__foot">
          <text class="vt__foot-link" @click="openBackup">换手机时用（备份 / 导入）</text>
        </view>
      </scroll-view>

      <view class="vt__bottom">
        <view class="vt__add" @click="goEdit()">＋ 记一条</view>
      </view>
    </template>

    <!-- 备份弹层 -->
    <AppPopup v-model="backupVisible" position="bottom" round custom-style="background-color: var(--ui-surface);">
      <view class="bk">
        <text class="bk__title">备份 / 导入</text>
        <text class="bk__hint">换手机、换账号时用。平时不用管，电脑上的会自动同步。</text>

        <view class="bk__row">
          <view class="bk__btn" @click="doExport">复制全部</view>
          <!-- #ifdef H5 -->
          <view class="bk__btn" @click="doDownload">下载文件</view>
          <!-- #endif -->
        </view>

        <textarea
          v-model="importText"
          class="bk__area"
          placeholder="把导出的内容粘在这里，然后点下面「导入」"
          placeholder-class="bk__area-ph"
          :maxlength="-1"
        />
        <view class="bk__btn bk__btn--main" @click="doImport">导入（重复的会跳过）</view>
      </view>
    </AppPopup>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import PageTitle from '../../components/PageTitle.vue'
import AppPopup from '../../components/AppPopup.vue'
import { useTheme } from '../../composables/useTheme'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'
import { isAdmin } from '../../api/auth'
import { copyToClipboard } from '../../utils/clipboard'
import {
  addressOf,
  buildBackupText,
  groupItems,
  importBackup,
  lastSyncedAt,
  migrateGrouping,
  pullAndMerge,
  readItems,
  removeItem,
  seedBuiltin,
  sortGroupItems,
  touchItem,
  typeLabel,
} from '../../utils/vault'

const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const allowed = computed(() => isAdmin())
const items = ref([])
const keyword = ref('')
const backupVisible = ref(false)
const importText = ref('')
const syncedAt = ref('')
const syncing = ref(false)
const syncError = ref('')

const grouped = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return groupItems(items.value)

  const hit = items.value.filter((item) =>
    [item.name, item.host, item.username, item.note, item.group, typeLabel(item.type)]
      .join(' ')
      .toLowerCase()
      .includes(q)
  )
  const buckets = new Map()
  hit.forEach((item) => {
    const name = item.group || '未分组'
    if (!buckets.has(name)) buckets.set(name, [])
    buckets.get(name).push(item)
  })
  return Array.from(buckets.entries()).map(([name, rows]) => ({ name, items: sortGroupItems(rows) }))
})

const syncText = computed(() => {
  if (syncing.value) return '正在同步…'
  if (syncError.value) return `同步失败：${syncError.value}`
  const at = syncedAt.value
  if (!at) return '还没同步过'
  return `刚同步 · ${at.slice(11, 16)}`
})

function refresh() {
  migrateGrouping()
  items.value = readItems()
  syncedAt.value = lastSyncedAt()
}

/** 进页面静默拉一次：失败不弹窗，只在状态行里说一句，列表照旧能翻 */
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
  refresh()
  if (allowed.value) sync()
})

/** 点一下整张卡 = 复制密码（最常用的动作，不让人找按钮） */
async function useItem(item) {
  if (!item.password) {
    uni.showToast({ title: '这条没有密码，长按选别的', icon: 'none' })
    return
  }
  const ok = await copyToClipboard(item.password, '密码')
  if (ok) touchItem(item.id)
}

function openSheet(item) {
  const actions = ['复制密码', '复制用户名', '复制地址', '编辑这条', '删除这条']
  uni.showActionSheet({
    itemList: actions,
    success: async ({ tapIndex }) => {
      if (tapIndex === 0) {
        await copyToClipboard(item.password || '', '密码')
        return
      }
      if (tapIndex === 1) {
        await copyToClipboard(item.username || '', '用户名')
        return
      }
      if (tapIndex === 2) {
        await copyToClipboard(addressOf(item), '地址')
        return
      }
      if (tapIndex === 3) {
        goEdit(item.id)
        return
      }
      confirmRemove(item)
    },
  })
}

function confirmRemove(item) {
  uni.showModal({
    title: '删掉这条？',
    content: `${item.name} 删了就没了，电脑上同步下来也会跟着没。`,
    confirmText: '删',
    confirmColor: '#D14343',
    success: ({ confirm }) => {
      if (!confirm) return
      removeItem(item.id)
      refresh()
      uni.showToast({ title: '删了', icon: 'none' })
    },
  })
}

function goEdit(id) {
  const query = id ? `?id=${encodeURIComponent(id)}` : ''
  uni.navigateTo({ url: `/pages/vault/edit${query}` })
}

/** 切到「配方」页签：用 redirect 换页，返回键直接回首页，不在两页之间来回弹 */
function goSnippets() {
  uni.redirectTo({ url: '/pages/vault/snippets' })
}

function doSeed() {
  const added = seedBuiltin()
  refresh()
  uni.showToast({ title: added ? `装了 ${added} 条` : '已经是最全的了', icon: 'none' })
}

/* ===== 备份 ===== */

function openBackup() {
  importText.value = ''
  backupVisible.value = true
}

async function doExport() {
  if (!items.value.length) {
    uni.showToast({ title: '一条都没有，没什么可备份的', icon: 'none' })
    return
  }
  await copyToClipboard(buildBackupText(items.value), '备份内容')
}

/* #ifdef H5 */
function doDownload() {
  const payload = JSON.stringify(
    { app: 'hnd-vault', version: 1, exportedAt: new Date().toISOString(), items: items.value },
    null,
    2
  )
  const blob = new Blob([`# 密码备份，别乱发\n${payload}`], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hnd-vault-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  uni.showToast({ title: '已下载', icon: 'none' })
}
/* #endif */

function doImport() {
  const result = importBackup(importText.value)
  if (result.error) {
    uni.showToast({ title: result.error, icon: 'none' })
    return
  }
  refresh()
  backupVisible.value = false
  const tail = result.skipped ? `，跳过重复 ${result.skipped} 条` : ''
  uni.showToast({ title: `新增 ${result.added} 条${tail}`, icon: 'none' })
}
</script>

<style lang="scss" scoped>
.vt {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-bg);
  overflow: hidden;
}

.vt__deny {
  margin: 120rpx 40rpx;
  padding: 48rpx 32rpx;
  border-radius: 24rpx;
  background: var(--ui-surface);
  text-align: center;
}

.vt__deny-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__deny-text {
  display: block;
  margin-top: 16rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--ui-text-2);
}

.vt__tabs {
  display: flex;
  gap: 10rpx;
  margin: 0 28rpx;
  padding: 6rpx;
  border-radius: 22rpx;
  background: var(--ui-raise, var(--ui-surface));
}

.vt__tab {
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  text-align: center;
  font-size: 28rpx;
  color: var(--ui-text-2);
  border-radius: 18rpx;
}

.vt__tab.is-on {
  color: var(--ui-text);
  font-weight: 600;
  background: var(--ui-surface);
}

.vt__bar {
  padding: 8rpx 28rpx 0;
}

.vt__search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 80rpx;
  padding: 0 24rpx;
  border-radius: 20rpx;
  background: var(--ui-surface);
}

.vt__search-icon {
  font-size: 26rpx;
  opacity: 0.5;
}

.vt__search-input {
  flex: 1;
  font-size: 28rpx;
  color: var(--ui-text);
}

.vt__search-ph {
  color: var(--ui-text-3);
}

.vt__search-clear {
  font-size: 26rpx;
  color: var(--ui-text-3);
  padding: 8rpx;
}

.vt__meta {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 20rpx 32rpx 8rpx;
}

.vt__meta-strong {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__meta-rest {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.vt__scroll {
  flex: 1;
  height: 0;
  padding: 0 28rpx;
  box-sizing: border-box;
}

.vt__group {
  padding-top: 20rpx;
}

.vt__group-name {
  display: block;
  padding: 8rpx 8rpx 12rpx;
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ui-text-3);
}

.vt__card {
  padding: 24rpx 26rpx;
  margin-bottom: 16rpx;
  border-radius: 22rpx;
  background: var(--ui-surface);
}

.vt__card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.vt__card-name {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__chip {
  flex-shrink: 0;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: var(--ui-accent);
  background: var(--ui-accent-soft);
}

.vt__line {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
  margin-top: 10rpx;
}

.vt__line-key {
  width: 60rpx;
  flex-shrink: 0;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.vt__line-val {
  flex: 1;
  font-size: 26rpx;
  color: var(--ui-text-2);
  word-break: break-all;
}

.vt__line-pass {
  flex: 1;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-text);
  word-break: break-all;
}

.vt__note {
  display: block;
  margin-top: 12rpx;
  font-size: 23rpx;
  line-height: 1.5;
  color: var(--ui-text-3);
}

.vt__empty {
  padding: 100rpx 32rpx 60rpx;
  text-align: center;
}

.vt__empty-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vt__empty-text {
  display: block;
  margin: 20rpx auto 0;
  max-width: 560rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--ui-text-2);
}

.vt__empty-btn {
  display: inline-block;
  margin-top: 40rpx;
  padding: 22rpx 48rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

.vt__empty-tip {
  display: block;
  margin-top: 28rpx;
  font-size: 23rpx;
  color: var(--ui-text-3);
}

.vt__foot {
  padding: 40rpx 0 32rpx;
  text-align: center;
}

.vt__foot-link {
  font-size: 24rpx;
  color: var(--ui-text-3);
  text-decoration: underline;
}

.vt__bottom {
  padding: 16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom));
}

.vt__add {
  height: 96rpx;
  line-height: 96rpx;
  text-align: center;
  border-radius: 24rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

/* 备份弹层 */
.bk {
  padding: 36rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
}

.bk__title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.bk__hint {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

.bk__row {
  display: flex;
  gap: 20rpx;
  margin-top: 28rpx;
}

.bk__btn {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  text-align: center;
  border-radius: 20rpx;
  font-size: 27rpx;
  color: var(--ui-text);
  background: var(--ui-raise);
}

.bk__btn--main {
  margin-top: 24rpx;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
}

.bk__area {
  width: 100%;
  height: 200rpx;
  margin-top: 24rpx;
  padding: 20rpx;
  box-sizing: border-box;
  border-radius: 20rpx;
  font-size: 24rpx;
  color: var(--ui-text);
  background: var(--ui-raise);
}

.bk__area-ph {
  color: var(--ui-text-3);
}
</style>
