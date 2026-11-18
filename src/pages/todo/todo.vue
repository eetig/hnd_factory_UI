<template>
  <view class="td" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart" @touchend="onEdgeEnd">
    <PageTitle title="待办" />
    <!-- 顶部：一句话概况 + 两个页签 -->
    <view class="td__head">
      <view class="td__summary">
        <text class="td__count">{{ openItems.length }}</text>
        <text class="td__count-unit">件待办</text>
        <view class="td__pills">
          <text v-if="overdueCount" class="td__pill td__pill--late">逾期 {{ overdueCount }}</text>
          <text v-if="todayCount" class="td__pill td__pill--today">今天 {{ todayCount }}</text>
          <text v-if="!openItems.length && !loading" class="td__pill">都办完了</text>
        </view>
      </view>

      <view class="td__tabs">
        <view class="td__tab" :class="{ 'td__tab--on': tab === 'open' }" @click="switchTab('open')">
          <text>待办</text>
        </view>
        <view class="td__tab" :class="{ 'td__tab--on': tab === 'done' }" @click="switchTab('done')">
          <text>已完成</text>
        </view>
      </view>
    </view>

    <scroll-view class="td__list" :scroll-y="true" :refresher-enabled="true" :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh">
      <view v-if="loading && !current.length" class="td__hint">正在取…</view>

      <view v-else-if="!current.length" class="td__empty">
        <text class="td__empty-title">{{ tab === 'open' ? '现在没有待办' : '还没有办完的事' }}</text>
        <text class="td__empty-sub">{{ tab === 'open' ? '点下面「记一条」，把脑子里的事挪出来' : '勾掉的事会收在这里，翻得到' }}</text>
      </view>

      <template v-else>
        <view v-for="group in groups" :key="group.key" class="td__group">
          <view class="td__group-head">
            <text class="td__group-name">{{ group.name }}</text>
            <text class="td__group-count">{{ group.items.length }}</text>
          </view>

          <view v-for="item in group.items" :key="item.id" class="td__item"
            :class="{ 'td__item--late': group.key === 'overdue' }" @click="openEdit(item)">
            <view class="td__check" :class="{ 'td__check--on': item.done }" @click.stop="toggle(item)">
              <text v-if="item.done" class="td__check-mark">✓</text>
            </view>

            <view class="td__body">
              <text class="td__title" :class="{ 'td__title--done': item.done }">{{ item.title }}</text>
              <text v-if="item.note" class="td__note">{{ item.note }}</text>

              <view v-if="item.images && item.images.length" class="td__shots">
                <image v-for="(src, index) in item.images.slice(0, 3)" :key="index" class="td__shot"
                  :src="resolveAssetUrl(src)" mode="aspectFill" @click.stop="preview(item, index)" />
                <text v-if="item.images.length > 3" class="td__more">+{{ item.images.length - 3 }}</text>
              </view>

              <view class="td__meta">
                <text v-if="item.dueDate" class="td__due" :class="dueClass(item)">{{ dueText(item) }}</text>
                <text v-else class="td__due td__due--none">没定日子</text>
                <text v-if="item.done && item.doneAt" class="td__doneat">{{ item.doneAt }} 办完</text>
              </view>
            </view>
          </view>
        </view>
      </template>

      <view class="td__bottom-space"></view>
    </scroll-view>

    <view class="td__bar">
      <view class="td__add" @click="openCreate">
        <text class="td__add-plus">＋</text>
        <text class="td__add-text">记一条</text>
      </view>
    </view>

    <!-- 编辑 / 新建 -->
    <AppPopup v-model="sheetOpen" position="bottom" round safe-area-inset-bottom
      custom-style="background-color: var(--ui-surface);">
      <view class="td-sheet">
        <view class="td-sheet__head">
          <text class="td-sheet__title">{{ editingId ? '改这条' : '记一条' }}</text>
          <text class="td-sheet__close" @click="sheetOpen = false">关闭</text>
        </view>

        <input v-model="form.title" class="td-sheet__input td-sheet__input--title" placeholder="要办什么"
          :maxlength="200" confirm-type="done" />

        <textarea v-model="form.note" class="td-sheet__area" placeholder="补充说明（可不填）" :maxlength="1000"
          auto-height />

        <view class="td-sheet__row">
          <text class="td-sheet__label">截止</text>
          <view class="td-sheet__value">
            <DateField v-model="form.dueDate" placeholder="没定日子" @change="onDueChange" />
          </view>
          <text v-if="form.dueDate" class="td-sheet__clear" @click="form.dueDate = ''">清空</text>
        </view>

        <view class="td-sheet__shots">
          <view v-for="(src, index) in form.images" :key="index" class="td-sheet__shot-wrap">
            <image class="td-sheet__shot" :src="resolveAssetUrl(src)" mode="aspectFill" @click="previewForm(index)" />
            <text class="td-sheet__shot-del" @click.stop="removeShot(index)">×</text>
          </view>
          <view v-if="form.images.length < 6" class="td-sheet__shot-add" @click="photoOpen = true">
            <text class="td-sheet__shot-plus">＋</text>
            <text class="td-sheet__shot-label">附图</text>
          </view>
        </view>

        <view class="td-sheet__actions">
          <view v-if="editingId" class="td-sheet__del" @click="removeItem">删除</view>
          <view v-else class="td-sheet__ghost" @click="sheetOpen = false">取消</view>
          <view class="td-sheet__save" :class="{ 'td-sheet__save--busy': saving }" @click="save">
            <text>{{ saving ? '保存中…' : '保存' }}</text>
          </view>
        </view>
      </view>
    </AppPopup>

    <!-- 附图来源 -->
    <AppPopup v-model="photoOpen" position="bottom" round safe-area-inset-bottom
      custom-style="background-color: var(--ui-sheet-fill);">
      <view class="photo-sheet">
        <text class="photo-sheet__title">附图</text>
        <view class="photo-sheet__item" @click="pick('camera')">
          <wd-icon name="camera" size="20px" />
          <text>拍一张</text>
        </view>
        <view class="photo-sheet__item" @click="pick('album')">
          <wd-icon name="picture" size="20px" />
          <text>从相册选择</text>
        </view>
        <view class="photo-sheet__cancel" @click="photoOpen = false">取消</view>
      </view>
    </AppPopup>

    <!-- LoadingMask 没有 visible 属性，挂载即显示；必须用 v-if 控制，否则遮罩永远盖在页面上 -->
    <LoadingMask v-if="booting" />
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import AppPopup from '../../components/AppPopup.vue'
import { onBackPress, onShow } from '@dcloudio/uni-app'
import { handleGlobalBack } from '../../utils/popupStack'

import request from '../../api/request'
import { uploadFile } from '../../api/upload'
import { resolveAssetUrl } from '../../api/config'
import { chooseImages } from '../../utils/chooseImages'
import { useTheme } from '../../composables/useTheme'
import DateField from '../../components/DateField.vue'
import LoadingMask from '../../components/LoadingMask.vue'
import PageTitle from '../../components/PageTitle.vue'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'

const { themeClass, themeVars } = useTheme()

const tab = ref('open')
const openItems = ref([])
const doneItems = ref([])
const loading = ref(false)
const booting = ref(true)
const refreshing = ref(false)

const sheetOpen = ref(false)
const photoOpen = ref(false)
const saving = ref(false)
const editingId = ref(null)
const form = ref(blankForm())

const current = computed(() => (tab.value === 'open' ? openItems.value : doneItems.value))
const overdueCount = computed(() => groupOf(openItems.value).overdue.length)
const todayCount = computed(() => groupOf(openItems.value).today.length)

/*
 * 分组只按截止日算：今天 / 本周（7 天内）/ 以后 / 没定。
 * 逾期的单独提到最上面并要求「逾期」口径，因为使用方最需要先看到那些漏掉的。
 */
const groups = computed(() => {
  if (tab.value === 'done') {
    return doneItems.value.length
      ? [{ key: 'done', name: '办完的', items: doneItems.value }]
      : []
  }
  const bucket = groupOf(openItems.value)
  return [
    { key: 'overdue', name: '逾期', items: bucket.overdue },
    { key: 'today', name: '今天', items: bucket.today },
    { key: 'week', name: '本周', items: bucket.week },
    { key: 'later', name: '以后', items: bucket.later },
    { key: 'none', name: '没定日子', items: bucket.none },
  ].filter((group) => group.items.length)
})

function blankForm() {
  return { title: '', note: '', dueDate: '', images: [] }
}

function isoToday() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function daysFromToday(dateText) {
  if (!dateText) return null
  const today = new Date(`${isoToday()}T00:00:00`)
  const target = new Date(`${String(dateText).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  return Math.round((target - today) / 86400000)
}

function groupOf(list) {
  const bucket = { overdue: [], today: [], week: [], later: [], none: [] }
  list.forEach((item) => {
    const days = daysFromToday(item.dueDate)
    if (days === null) bucket.none.push(item)
    else if (days < 0) bucket.overdue.push(item)
    else if (days === 0) bucket.today.push(item)
    else if (days <= 7) bucket.week.push(item)
    else bucket.later.push(item)
  })
  Object.keys(bucket).forEach((key) => {
    if (key === 'none') return
    bucket[key].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
  })
  return bucket
}

function dueText(item) {
  const days = daysFromToday(item.dueDate)
  if (days === null) return ''
  if (days < 0) return `逾期 ${-days} 天`
  if (days === 0) return '今天到期'
  if (days === 1) return '明天到期'
  if (days <= 7) return `${days} 天后 · ${String(item.dueDate).slice(5)}`
  return String(item.dueDate).slice(0, 10)
}

function dueClass(item) {
  const days = daysFromToday(item.dueDate)
  if (days === null) return 'td__due--none'
  if (days < 0) return 'td__due--late'
  if (days === 0) return 'td__due--today'
  return ''
}

async function load(showBoot = false) {
  if (showBoot) booting.value = true
  loading.value = true
  try {
    const openRes = await request.get('/api/todo/list?scope=open')
    openItems.value = pickList(openRes)
    if (tab.value === 'done') await loadDone()
  } catch (error) {
    toast(errorText(error, '待办没取到'))
  } finally {
    loading.value = false
    booting.value = false
  }
}

async function loadDone() {
  const res = await request.get('/api/todo/list?scope=done')
  doneItems.value = pickList(res)
}

function pickList(res) {
  const body = res?.data || {}
  if (body.code !== 200) throw new Error(body.msg || '取待办失败')
  const rows = Array.isArray(body.data) ? body.data : []
  return rows.map((row) => ({
    ...row,
    images: Array.isArray(row.images) ? row.images : [],
  }))
}

function switchTab(next) {
  if (tab.value === next) return
  tab.value = next
  if (next === 'done') loadDone().catch((error) => toast(errorText(error, '已完成没取到')))
}

function onRefresh() {
  refreshing.value = true
  Promise.all([load(), tab.value === 'done' ? loadDone() : Promise.resolve()])
    .catch(() => {})
    .finally(() => {
      refreshing.value = false
    })
}

function openCreate() {
  editingId.value = null
  form.value = blankForm()
  form.value.dueDate = isoToday()
  sheetOpen.value = true
}

function openEdit(item) {
  editingId.value = item.id
  form.value = {
    title: item.title || '',
    note: item.note || '',
    dueDate: item.dueDate ? String(item.dueDate).slice(0, 10) : '',
    images: Array.isArray(item.images) ? [...item.images] : [],
  }
  sheetOpen.value = true
}

function onDueChange(value) {
  form.value.dueDate = value || ''
}

function preview(item, index) {
  const urls = item.images.map((src) => resolveAssetUrl(src))
  uni.previewImage({ urls, current: urls[index] })
}

function previewForm(index) {
  const urls = form.value.images.map((src) => resolveAssetUrl(src))
  uni.previewImage({ urls, current: urls[index] })
}

function removeShot(index) {
  form.value.images.splice(index, 1)
}

function pick(source) {
  const options = {
    count: 1,
    sizeType: ['compressed'],
    sourceType: [source],
    success: (res) => {
      const path = (res.tempFilePaths || [])[0]
      if (path) uploadShot(path)
    },
    fail: () => {},
  }
  // 相册走系统相册（框架自绘那套界面与项目其它页不一致）
  if (source === 'album') chooseImages(options)
  else uni.chooseImage(options)
}

async function uploadShot(filePath) {
  photoOpen.value = false
  uni.showLoading({ title: '上传中', mask: true })
  try {
    const res = await uploadFile({ url: '/api/todo/photo', filePath, name: 'file' })
    const body = res?.data || {}
    const path = body?.data?.path
    if (body.code !== 200 || !path) throw new Error(body.msg || '上传失败')
    form.value.images.push(path)
  } catch (error) {
    toast(errorText(error, '图片没传上去'))
  } finally {
    uni.hideLoading()
  }
}

async function save() {
  const title = String(form.value.title || '').trim()
  if (!title) {
    toast('先写一句要办什么')
    return
  }
  if (saving.value) return
  saving.value = true
  try {
    const payload = {
      title,
      note: String(form.value.note || '').trim(),
      dueDate: form.value.dueDate || '',
      images: form.value.images,
    }
    if (editingId.value) await request.put(`/api/todo/${editingId.value}`, payload)
    else await request.post('/api/todo/create', payload)
    sheetOpen.value = false
    toast(editingId.value ? '改好了' : '记下了')
    await load()
  } catch (error) {
    toast(errorText(error, '没保存上'))
  } finally {
    saving.value = false
  }
}

async function toggle(item) {
  try {
    await request.post(`/api/todo/${item.id}/done?done=${item.done ? 'false' : 'true'}`)
    await load()
    if (tab.value === 'done') await loadDone()
  } catch (error) {
    toast(errorText(error, '没改成'))
  }
}

function removeItem() {
  if (!editingId.value) return
  uni.showModal({
    title: '删掉这条？',
    content: '删了就找不回来了',
    confirmText: '删掉',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await request.delete(`/api/todo/${editingId.value}`)
        sheetOpen.value = false
        toast('删掉了')
        await load()
        if (tab.value === 'done') await loadDone()
      } catch (error) {
        toast(errorText(error, '没删掉'))
      }
    },
  })
}

function errorText(error, fallback) {
  return error?.body?.msg || error?.data?.msg || error?.message || fallback
}

function toast(title) {
  uni.showToast({ title, icon: 'none' })
}

onShow(() => {
  load(booting.value)
})

/* 弹窗入栈改由 AppPopup 组件内部负责（2026-11-18 全局化），本页不再手工登记。 */

onBackPress(() => {
  // 统一走全局守卫（2026-11-18 全局化）：本页没有抽屉，关掉弹窗就交回框架返回上一页
  return handleGlobalBack() !== 'root'
})
// 极简标题（2026-11-18）：顶栏只剩一行居中文字，抽屉入口改为左侧边缘右滑
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

</script>

<style lang="scss" scoped>
.td {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-scene-bg);
}

.td__head {
  padding: 20rpx 28rpx 0;
}

.td__summary {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}

.td__count {
  font-size: 76rpx;
  font-weight: 700;
  line-height: 1;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.td__count-unit {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.td__pills {
  display: flex;
  gap: 10rpx;
  margin-left: 12rpx;
}

.td__pill {
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

.td__pill--late {
  color: var(--ui-amber-800);
  background: var(--ui-amber-50);
}

.td__pill--today {
  color: var(--ui-accent);
  background: var(--ui-accent-soft, var(--ui-raise-2));
}

.td__tabs {
  display: flex;
  gap: 12rpx;
  margin: 22rpx 0 6rpx;
}

.td__tab {
  padding: 14rpx 30rpx;
  border-radius: 999rpx;
  background: var(--ui-raise-2);
  color: var(--ui-text-2);
  font-size: 27rpx;
}

.td__tab--on {
  background: var(--ui-accent);
  color: var(--ui-on-accent);
  font-weight: 600;
}

.td__list {
  flex: 1;
  height: 0;
  padding: 0 28rpx;
}

.td__group {
  margin-top: 22rpx;
}

.td__group-head {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  padding: 0 6rpx 10rpx;
}

.td__group-name {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--ui-text-2);
  letter-spacing: 1rpx;
}

.td__group-count {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.td__item {
  display: flex;
  gap: 18rpx;
  padding: 22rpx 22rpx 20rpx;
  margin-bottom: 12rpx;
  border-radius: 20rpx;
  background: var(--ui-surface);
  border: 2rpx solid var(--ui-hairline);
}

.td__item--late {
  border-color: var(--ui-amber-200);
}

.td__check {
  width: 44rpx;
  height: 44rpx;
  flex: 0 0 44rpx;
  margin-top: 2rpx;
  border-radius: 999rpx;
  border: 3rpx solid var(--ui-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
}

.td__check--on {
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}

.td__check-mark {
  font-size: 26rpx;
  line-height: 1;
  color: var(--ui-on-accent);
}

.td__body {
  flex: 1;
  min-width: 0;
}

.td__title {
  font-size: 30rpx;
  line-height: 1.35;
  color: var(--ui-text);
  font-weight: 600;
}

.td__title--done {
  color: var(--ui-text-2);
  text-decoration: line-through;
}

.td__note {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  line-height: 1.45;
  color: var(--ui-text-2);
}

.td__shots {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 12rpx;
}

.td__shot {
  width: 96rpx;
  height: 96rpx;
  border-radius: 12rpx;
  background: var(--ui-raise-2);
}

.td__more {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.td__meta {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 12rpx;
}

.td__due {
  font-size: 23rpx;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
}

.td__due--late {
  color: var(--ui-amber-800);
  font-weight: 600;
}

.td__due--today {
  color: var(--ui-accent);
  font-weight: 600;
}

.td__due--none {
  color: var(--ui-text-3);
}

.td__doneat {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.td__hint,
.td__empty {
  padding: 120rpx 20rpx;
  text-align: center;
}

.td__empty-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.td__empty-sub {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--ui-text-2);
}

.td__bottom-space {
  height: 40rpx;
}

.td__bar {
  padding: 16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom, 0px));
  background: var(--ui-surface);
  border-top: 2rpx solid var(--ui-hairline);
}

.td__add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  height: 96rpx;
  border-radius: 24rpx;
  background: var(--ui-accent);
  color: var(--ui-on-accent);
}

.td__add-plus {
  font-size: 34rpx;
  line-height: 1;
}

.td__add-text {
  font-size: 30rpx;
  font-weight: 600;
}

/* 表单弹层 */
.td-sheet {
  padding: 24rpx 28rpx calc(20rpx + env(safe-area-inset-bottom, 0px));
}

.td-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.td-sheet__title {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.td-sheet__close {
  font-size: 26rpx;
  color: var(--ui-text-3);
}

.td-sheet__input {
  height: 92rpx;
  padding: 0 22rpx;
  border-radius: 18rpx;
  background: var(--ui-raise-2);
  font-size: 30rpx;
  color: var(--ui-text);
}

.td-sheet__input--title {
  font-weight: 600;
}

.td-sheet__area {
  width: 100%;
  min-height: 120rpx;
  margin-top: 14rpx;
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background: var(--ui-raise-2);
  font-size: 27rpx;
  line-height: 1.5;
  color: var(--ui-text);
  box-sizing: border-box;
}

.td-sheet__row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 14rpx;
  padding: 0 22rpx;
  min-height: 92rpx;
  border-radius: 18rpx;
  background: var(--ui-raise-2);
}

.td-sheet__label {
  font-size: 26rpx;
  color: var(--ui-text-2);
  flex: 0 0 auto;
}

.td-sheet__value {
  flex: 1;
  min-width: 0;
}

.td-sheet__clear {
  font-size: 24rpx;
  color: var(--ui-text-3);
  flex: 0 0 auto;
}

.td-sheet__shots {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 18rpx;
}

.td-sheet__shot-wrap {
  position: relative;
}

.td-sheet__shot {
  width: 130rpx;
  height: 130rpx;
  border-radius: 16rpx;
  background: var(--ui-raise-2);
}

.td-sheet__shot-del {
  position: absolute;
  top: -10rpx;
  right: -10rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 999rpx;
  background: var(--ui-text);
  color: var(--ui-surface);
  font-size: 24rpx;
  line-height: 40rpx;
  text-align: center;
}

.td-sheet__shot-add {
  width: 130rpx;
  height: 130rpx;
  border-radius: 16rpx;
  border: 2rpx dashed var(--ui-border-strong);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}

.td-sheet__shot-plus {
  font-size: 34rpx;
  line-height: 1;
  color: var(--ui-text-3);
}

.td-sheet__shot-label {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.td-sheet__actions {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.td-sheet__ghost,
.td-sheet__del {
  flex: 0 0 190rpx;
  height: 92rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  background: var(--ui-raise-2);
  color: var(--ui-text-2);
}

.td-sheet__del {
  color: var(--ui-amber-800);
}

.td-sheet__save {
  flex: 1;
  height: 92rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 600;
  background: var(--ui-accent);
  color: var(--ui-on-accent);
}

.td-sheet__save--busy {
  opacity: 0.6;
}

/* 附图来源弹层 */
.photo-sheet {
  padding: 20rpx 16rpx calc(12rpx + env(safe-area-inset-bottom, 0px));
}

.photo-sheet__title {
  display: block;
  padding: 0 12rpx 16rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.photo-sheet__item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 12rpx;
  padding: 26rpx 22rpx;
  border-radius: 20rpx;
  background: var(--ui-raise-2);
  font-size: 29rpx;
  color: var(--ui-text);
}

.photo-sheet__cancel {
  margin-top: 4rpx;
  padding: 24rpx;
  border-radius: 999rpx;
  text-align: center;
  font-size: 29rpx;
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}
</style>
