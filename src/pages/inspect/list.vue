<template>
  <view class="insp" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart"
    @touchend="onEdgeEnd">
    <PageTitle title="巡检" />

    <view class="insp__head">
      <view class="insp__tabs">
        <view class="insp__tab" :class="{ 'insp__tab--on': tab === 'template' }" @click="switchTab('template')">
          <text>清单</text>
        </view>
        <view class="insp__tab" :class="{ 'insp__tab--on': tab === 'record' }" @click="switchTab('record')">
          <text>记录</text>
        </view>
      </view>
      <text v-if="tab === 'template'" class="insp__act" @click="openNewTemplate">＋ 新建清单</text>
    </view>

    <!-- 离线提醒：有没传上去的记录时，别让用户以为丢了 -->
    <view v-if="pending > 0" class="insp__pending" @click="retryUpload">
      <text class="insp__pending-text">有 {{ pending }} 条还没传上去</text>
      <text class="insp__pending-act">{{ uploading ? '正在传…' : '点这里重试' }}</text>
    </view>

    <scroll-view class="insp__body" :scroll-y="true" :refresher-enabled="true" :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh">
      <view v-if="loading && !rows.length" class="insp__hint">正在取…</view>

      <view v-else-if="!rows.length" class="insp__empty">
        <text class="insp__empty-title">{{ tab === 'template' ? '还没有巡检清单' : '还没有巡检记录' }}</text>
        <text class="insp__empty-sub">{{ tab === 'template'
          ? '把要照着看的检查内容写成一篇，之后每次对着看就行'
          : '照着清单查完一次，记录会收在这里' }}</text>
      </view>

      <template v-else>
        <view v-for="row in rows" :key="row.key" class="insp__item" @click="open(row)">
          <view class="insp__item-main">
            <view class="insp__item-top">
              <text class="insp__item-title">{{ row.title }}</text>
              <text v-if="row.badge" class="insp__badge">{{ row.badge }}</text>
            </view>
            <text class="insp__item-sub">{{ row.sub }}</text>
          </view>
          <wd-icon name="arrow-right" size="14px" color="#9AA3B2" />
        </view>
      </template>

      <view class="insp__bottom-space"></view>
    </scroll-view>

    <!-- 记录详情：只回答「谁、什么时候、照着哪篇、留了什么」 -->
    <AppPopup v-model="detailOpen" position="bottom" round safe-area-inset-bottom
      custom-style="background-color: var(--ui-surface);">
      <view class="detail">
        <view class="detail__head">
          <view class="detail__titles">
            <text class="detail__title">{{ detail.title }}</text>
            <text class="detail__sub">{{ detail.sub }}</text>
          </view>
          <text class="detail__close" @click="detailOpen = false">关闭</text>
        </view>

        <scroll-view class="detail__body" :scroll-y="true">
          <view v-if="detail.note" class="detail__block">
            <text class="detail__label">备注</text>
            <text class="detail__note">{{ detail.note }}</text>
          </view>

          <view v-if="detail.images.length" class="detail__block">
            <text class="detail__label">照片 {{ detail.images.length }} 张</text>
            <view class="detail__shots">
              <image v-for="(src, index) in detail.images" :key="index" class="detail__shot"
                :src="resolveAssetUrl(src)" mode="aspectFill" @click="preview(detail.images, index)" />
            </view>
          </view>

          <view v-if="!detail.note && !detail.images.length" class="detail__quiet">
            <text class="detail__quiet-text">这次没写备注，也没拍照</text>
          </view>

          <view class="insp__bottom-space"></view>
        </scroll-view>
      </view>
    </AppPopup>

    <LoadingMask v-if="booting" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import AppPopup from '../../components/AppPopup.vue'
import { onBackPress, onShow } from '@dcloudio/uni-app'
import { handleGlobalBack } from '../../utils/popupStack'

import { listTemplates, listRecords } from '../../api/inspect'
import { flushQueue, pendingCount } from '../../utils/inspectOffline'
import { resolveAssetUrl } from '../../api/config'
import { useTheme } from '../../composables/useTheme'
import LoadingMask from '../../components/LoadingMask.vue'
import PageTitle from '../../components/PageTitle.vue'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'

const { themeClass, themeVars } = useTheme()

const tab = ref('template')
const templates = ref([])
const records = ref([])
const loading = ref(false)
const booting = ref(true)
const refreshing = ref(false)
const pending = ref(0)
const uploading = ref(false)

const detailOpen = ref(false)
const detail = ref({ title: '', sub: '', note: '', images: [] })

const rows = computed(() => {
  if (tab.value === 'template') {
    return templates.value.map((one) => ({
      key: 't' + one.id,
      raw: one,
      title: one.name,
      sub: kindText(one.kind) + ' · 共 ' + (one.charCount || countChars(one.body)) + ' 字',
      badge: kindShort(one.kind),
    }))
  }
  return records.value.map((one) => ({
    key: 'r' + (one.id || one.clientUuid),
    raw: one,
    title: one.templateName,
    sub: timeText(one.finishedAt) + ' · ' + (one.operatorName || ''),
    badge: one.photoCount ? one.photoCount + ' 张' : '',
  }))
})

function kindText(kind) {
  if (kind === 'pump') return '消防泵房'
  if (kind === 'shop') return '车间'
  return kind || '未分类'
}

function kindShort(kind) {
  if (kind === 'pump') return '泵房'
  if (kind === 'shop') return '车间'
  return ''
}

function countChars(body) {
  return String(body || '').replace(/\s/g, '').length
}

function timeText(text) {
  return String(text || '').slice(0, 16)
}

function pickList(res) {
  const body = (res && res.data) || {}
  if (body.code !== 200) throw new Error(body.msg || '没取到')
  return Array.isArray(body.data) ? body.data : []
}

async function load(showBoot = false) {
  if (showBoot) booting.value = true
  loading.value = true
  try {
    if (tab.value === 'template') {
      templates.value = pickList(await listTemplates())
    } else {
      records.value = pickList(await listRecords(50))
    }
  } catch (error) {
    toast(errorText(error, '没取到数据'))
  } finally {
    loading.value = false
    booting.value = false
    refreshPending()
  }
}

function refreshPending() {
  pending.value = pendingCount()
}

function switchTab(next) {
  if (tab.value === next) return
  tab.value = next
  load()
}

function onRefresh() {
  refreshing.value = true
  flushQueue()
    .catch(() => {})
    .finally(() => {
      refreshPending()
      load().finally(() => {
        refreshing.value = false
      })
    })
}

async function retryUpload() {
  if (uploading.value) return
  uploading.value = true
  try {
    const res = await flushQueue()
    refreshPending()
    if (res.uploaded) {
      toast('传上去 ' + res.uploaded + ' 条')
      if (tab.value === 'record') await load()
    } else {
      toast('暂时还传不上去，等有信号再试')
    }
  } catch (error) {
    toast(errorText(error, '没传上去'))
  } finally {
    uploading.value = false
  }
}

function open(row) {
  if (tab.value === 'template') {
    uni.navigateTo({ url: '/pages/inspect/run?templateId=' + row.raw.id })
    return
  }
  const one = row.raw
  const photos = Array.isArray(one.images) ? one.images : []
  detail.value = {
    title: one.templateName || '巡检记录',
    sub: timeText(one.finishedAt) + ' · ' + (one.operatorName || '')
      + (photos.length ? ' · ' + photos.length + ' 张照片' : ''),
    note: one.note || '',
    images: photos,
  }
  detailOpen.value = true
}

function openNewTemplate() {
  uni.navigateTo({ url: '/pages/inspect/template' })
}

function preview(images, index) {
  const urls = images.map((src) => resolveAssetUrl(src))
  uni.previewImage({ urls, current: urls[index] || urls[0] })
}

function errorText(error, fallback) {
  return error?.body?.msg || error?.data?.msg || error?.message || fallback
}

function toast(title) {
  uni.showToast({ title, icon: 'none' })
}

onShow(() => {
  // 回到这个页面先补传上次没发出去的记录 —— 用户从泵房出来、刚连上信号时最需要这一步
  flushQueue()
    .then((res) => {
      if (res.uploaded) toast('补传了 ' + res.uploaded + ' 条')
    })
    .catch(() => {})
    .finally(() => {
      refreshPending()
      load(booting.value)
    })
})

onBackPress(() => handleGlobalBack() !== 'root')

const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())
</script>

<style lang="scss" scoped>
.insp {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-scene-bg);
}

.insp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rpx 20rpx 0;
}

.insp__tabs {
  display: flex;
  gap: 12rpx;
  margin: 16rpx 0 6rpx;
}

.insp__tab {
  padding: 14rpx 30rpx;
  border-radius: 999rpx;
  background: var(--ui-raise-2);
  color: var(--ui-text-2);
  font-size: 27rpx;
}

.insp__tab--on {
  background: var(--ui-accent);
  color: var(--ui-on-accent);
  font-weight: 600;
}

.insp__act {
  font-size: 25rpx;
  color: var(--ui-accent);
  padding: 10rpx 4rpx;
}

.insp__pending {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12rpx 20rpx 0;
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  background: var(--ui-amber-50);
}

.insp__pending-text {
  font-size: 25rpx;
  color: var(--ui-amber-800);
}

.insp__pending-act {
  font-size: 25rpx;
  color: var(--ui-amber-800);
  font-weight: 600;
}

.insp__body {
  flex: 1;
  min-height: 0;
  padding: 0 20rpx;
}

.insp__hint,
.insp__empty {
  padding: 90rpx 20rpx;
  text-align: center;
}

.insp__hint {
  font-size: 25rpx;
  color: var(--ui-text-3);
}

.insp__empty-title {
  display: block;
  font-size: 30rpx;
  color: var(--ui-text);
}

.insp__empty-sub {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
  line-height: 1.6;
}

.insp__item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 14rpx;
  padding: 22rpx;
  border-radius: 18rpx;
  background: var(--ui-surface);
}

.insp__item-main {
  flex: 1;
  min-width: 0;
}

.insp__item-top {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.insp__item-title {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.insp__item-sub {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.insp__badge {
  flex: 0 0 auto;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

.insp__bottom-space {
  height: 60rpx;
}

.detail {
  display: flex;
  flex-direction: column;
  height: 72vh;
  padding: 0 24rpx;
  background: var(--ui-surface);
}

.detail__head {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  padding: 24rpx 0 18rpx;
}

.detail__titles {
  flex: 1;
  min-width: 0;
}

.detail__title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.detail__sub {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.detail__close {
  font-size: 25rpx;
  color: var(--ui-text-3);
  padding: 6rpx 0;
}

.detail__body {
  flex: 1;
  min-height: 0;
}

.detail__block {
  padding: 20rpx 22rpx;
  margin-bottom: 14rpx;
  border-radius: 16rpx;
  background: var(--ui-raise-2);
}

.detail__label {
  display: block;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.detail__note {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  color: var(--ui-text);
  line-height: 1.7;
}

.detail__shots {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 14rpx;
}

.detail__shot {
  width: 140rpx;
  height: 140rpx;
  border-radius: 14rpx;
  background: var(--ui-surface);
}

.detail__quiet {
  padding: 40rpx 0;
  text-align: center;
}

.detail__quiet-text {
  font-size: 24rpx;
  color: var(--ui-text-3);
}
</style>
