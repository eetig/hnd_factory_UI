<template>
  <view class="run" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart"
    @touchend="onEdgeEnd">
    <PageTitle :title="template.name || '巡检'" />

    <view class="run__head">
      <text v-if="template.kind" class="run__kind">{{ kindText(template.kind) }}</text>
      <text class="run__meta">{{ metaText }}</text>
      <text v-if="template.id" class="run__edit" @click="goEdit">编辑正文</text>
    </view>

    <scroll-view class="run__body" :scroll-y="true">
      <view v-if="booting" class="run__hint">正在取清单…</view>

      <template v-else>
        <!-- 正文就是现场那张检查单：一行一段，带序号的行自然当小标题 -->
        <view v-if="lines.length" class="sheet">
          <view v-for="(line, index) in lines" :key="index" class="sheet__line"
            :class="{ 'sheet__line--head': line.head, 'sheet__line--blank': !line.text }">
            <text v-if="line.text" class="sheet__text">{{ line.text }}</text>
          </view>
        </view>

        <view v-else class="run__empty">
          <text class="run__empty-title">这篇清单还没有正文</text>
          <text class="run__empty-sub">点右上「编辑正文」，把写好的检查内容贴进去</text>
        </view>

        <!-- 现场补充：有问题才写/拍，不挡提交 -->
        <view v-if="lines.length" class="extra">
          <view class="extra__head">
            <text class="extra__title">现场补充</text>
            <text class="extra__tip">有问题才写，没问题不用管</text>
          </view>

          <textarea class="extra__note" v-model="note" auto-height maxlength="500"
            placeholder="哪里不对劲、怎么处理的" placeholder-class="extra__ph" />

          <view class="extra__shots">
            <view v-for="(src, index) in photos" :key="index" class="shot">
              <image class="shot__img" :src="previewSrc(src)" mode="aspectFill" @click="preview(index)" />
              <text class="shot__del" @click.stop="removePhoto(index)">×</text>
            </view>
            <view v-if="photos.length < MAX_PHOTOS" class="shot shot--add" @click="sheetOpen = true">
              <text class="shot__plus">＋</text>
              <text class="shot__label">拍照</text>
            </view>
          </view>
        </view>

        <view class="run__bottom-space"></view>
      </template>
    </scroll-view>

    <view class="run__bar">
      <text class="run__bar-tip">{{ photos.length ? '已拍 ' + photos.length + ' 张' : '看完点一下就记一笔' }}</text>
      <button class="run__save" :class="{ 'run__save--busy': submitting }"
        :disabled="submitting || booting || !template.id" @click="submit">
        {{ submitting ? '提交中…' : '完成本次巡检' }}
      </button>
    </view>

    <!-- 图片来源选择：替掉 uni.chooseImage 自带的系统菜单（样式不可控），
         与 ImageParse 的 .source-sheet 同一套观感 -->
    <AppPopup v-model="sheetOpen" position="bottom" round safe-area-inset-bottom
      custom-style="background-color: var(--ui-sheet-fill);" @close="sheetOpen = false">
      <view class="source-sheet">
        <text class="source-sheet__title">现场照片</text>

        <view class="source-sheet__item" @click="pickPhoto('camera')">
          <view class="source-sheet__icon"><wd-icon name="camera" size="20px" /></view>
          <text class="source-sheet__label">拍摄</text>
        </view>

        <view class="source-sheet__item" @click="pickPhoto('album')">
          <view class="source-sheet__icon"><wd-icon name="picture" size="20px" /></view>
          <text class="source-sheet__label">从相册选择</text>
        </view>

        <view class="source-sheet__cancel" @click="sheetOpen = false">取消</view>
      </view>
    </AppPopup>

    <LoadingMask v-if="booting" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import AppPopup from '../../components/AppPopup.vue'
import { onBackPress, onLoad, onShow } from '@dcloudio/uni-app'
import { handleGlobalBack } from '../../utils/popupStack'

import { getTemplate, submitRecord, uploadRecordPhoto } from '../../api/inspect'
import { enqueue, makeClientUuid } from '../../utils/inspectOffline'
import { chooseImages } from '../../utils/chooseImages'
import { resolveAssetUrl } from '../../api/config'
import { useTheme } from '../../composables/useTheme'
import LoadingMask from '../../components/LoadingMask.vue'
import PageTitle from '../../components/PageTitle.vue'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'

const MAX_PHOTOS = 9

const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const template = ref({ id: 0, name: '', kind: '', body: '', charCount: 0 })
const note = ref('')
const photos = ref([])
const booting = ref(true)
const submitting = ref(false)
const sheetOpen = ref(false)
const loaded = ref(false)
const startedAt = ref(nowText())

/* 带序号的行当小标题：一、 / （一） / 1. / 1、 这几种现场最常用 */
const HEAD_RE = /^\s*(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十]+[）)]|\d+[.、．])/

const lines = computed(() => {
  const body = String(template.value.body || '')
  if (!body.trim()) return []
  return body.split('\n').map((text) => ({
    text,
    head: HEAD_RE.test(text),
  }))
})

const metaText = computed(() => {
  const chars = template.value.charCount || countChars(template.value.body)
  return chars ? '共 ' + chars + ' 字' : ''
})

function countChars(body) {
  return String(body || '').replace(/\s/g, '').length
}

function nowText() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
    + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function kindText(kind) {
  if (kind === 'pump') return '消防泵房'
  if (kind === 'shop') return '车间'
  return kind || ''
}

function previewSrc(src) {
  // 本地路径直接给 image 用；已上传的 /files/ 才需要拼 img 域名
  return src && src.indexOf('/files/') === 0 ? resolveAssetUrl(src) : src
}

async function loadTemplate(templateId) {
  booting.value = true
  try {
    const res = await getTemplate(templateId)
    const body = (res && res.data) || {}
    if (body.code !== 200) throw new Error(body.msg || '清单没取到')
    const data = body.data || {}
    template.value = {
      id: data.id,
      name: data.name || '',
      kind: data.kind || '',
      body: data.body || '',
      charCount: data.charCount || 0,
    }
    loaded.value = true
  } catch (error) {
    toast(errorText(error, '清单没取到'))
  } finally {
    booting.value = false
  }
}

function goEdit() {
  if (!template.value.id) return
  uni.navigateTo({ url: '/pages/inspect/template?id=' + template.value.id })
}

/* 拍照走系统相机；相册走 utils/chooseImages（App 端起手机自带相册，不是框架自绘那套） */
function pickPhoto(from) {
  sheetOpen.value = false
  const left = MAX_PHOTOS - photos.value.length
  if (left <= 0) return

  const options = {
    count: from === 'album' ? left : 1,
    sizeType: ['compressed'],
    sourceType: [from === 'album' ? 'album' : 'camera'],
    success: (res) => {
      const paths = res.tempFilePaths || []
      for (const path of paths) {
        if (path && photos.value.length < MAX_PHOTOS) photos.value.push(path)
      }
    },
    fail: () => {},
  }

  if (from === 'album') chooseImages(options)
  else uni.chooseImage(options)
}

function removePhoto(index) {
  photos.value.splice(index, 1)
}

function preview(index) {
  const urls = photos.value.map((src) => previewSrc(src))
  uni.previewImage({ urls, current: urls[index] || urls[0] })
}

function buildRecord() {
  return {
    clientUuid: makeClientUuid(),
    templateId: template.value.id,
    startedAt: startedAt.value,
    finishedAt: nowText(),
    note: String(note.value || '').trim(),
    images: photos.value.slice(),
  }
}

async function submit() {
  if (submitting.value || !template.value.id) return
  submitting.value = true
  const record = buildRecord()
  try {
    // 先把现场照片换成服务器路径，再整条提交
    const images = []
    for (const src of record.images) {
      if (src.indexOf('/files/') === 0) {
        images.push(src)
        continue
      }
      const res = await uploadRecordPhoto(src)
      const body = (res && res.data) || {}
      const remote = body?.data?.path
      if (body.code !== 200 || !remote) throw new Error(body.msg || '照片没传上去')
      images.push(remote)
    }

    const res = await submitRecord({ ...record, images })
    const body = (res && res.data) || {}
    if (body.code !== 200) {
      // 服务器明确回了错（比如清单被删了），这不是网络问题，别进队列反复重试
      toast(body.msg || '没提交上')
      return
    }
    toast('已记一笔')
    setTimeout(() => uni.navigateBack(), 600)
  } catch (error) {
    const hadResponse = error && (error.status || error.body)
    if (hadResponse) {
      toast(errorText(error, '没提交上'))
      return
    }
    // 连不上（泵房没信号）：整条进队列，照片先固化成持久文件，联网后自动补传
    try {
      await enqueue(record)
      toast('已暂存，联网后自动上传')
      setTimeout(() => uni.navigateBack(), 800)
    } catch (queueError) {
      toast('暂存失败，先别退出：' + errorText(queueError, '本地存不下'))
    }
  } finally {
    submitting.value = false
  }
}

function errorText(error, fallback) {
  return error?.body?.msg || error?.data?.msg || error?.message || fallback
}

function toast(title) {
  uni.showToast({ title, icon: 'none' })
}

onLoad((options) => {
  const templateId = Number((options && options.templateId) || 0)
  if (!templateId) {
    booting.value = false
    toast('没带清单编号')
    return
  }
  startedAt.value = nowText()
  loadTemplate(templateId)
})

onShow(() => {
  // 从「编辑正文」回来要看到新内容；首次进入由 onLoad 负责，不重复拉
  if (loaded.value && template.value.id) loadTemplate(template.value.id)
})

onBackPress(() => handleGlobalBack() !== 'root')
</script>

<style lang="scss" scoped>
.run {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-scene-bg);
}

.run__head {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 6rpx 24rpx 0;
}

.run__kind {
  flex: 0 0 auto;
  padding: 5rpx 16rpx;
  border-radius: 999rpx;
  font-size: 23rpx;
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

.run__meta {
  flex: 1;
  min-width: 0;
  font-size: 23rpx;
  color: var(--ui-text-3);
}

.run__edit {
  flex: 0 0 auto;
  padding: 8rpx 4rpx;
  font-size: 24rpx;
  color: var(--ui-accent);
}

.run__body {
  flex: 1;
  min-height: 0;
  padding: 10rpx 20rpx 0;
}

.run__hint {
  padding: 90rpx 0;
  text-align: center;
  font-size: 25rpx;
  color: var(--ui-text-3);
}

.run__empty {
  padding: 80rpx 24rpx;
  text-align: center;
}

.run__empty-title {
  display: block;
  font-size: 29rpx;
  color: var(--ui-text);
}

.run__empty-sub {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: var(--ui-text-3);
  line-height: 1.6;
}

/* ---------------- 正文：像一张现场贴的检查单 ---------------- */
.sheet {
  padding: 30rpx 28rpx 34rpx;
  border-radius: 20rpx;
  background: var(--ui-surface);
}

.sheet__line {
  font-size: 29rpx;
  line-height: 1.95;
  color: var(--ui-text);
}

/* 行首缩进保留：稿子里怎么排，这里就怎么排 */
.sheet__text {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
}

.sheet__line--blank {
  height: 18rpx;
}

.sheet__line--head {
  margin-top: 14rpx;
  font-size: 31rpx;
  font-weight: 600;
  line-height: 1.8;
}

.sheet__line--head:first-child {
  margin-top: 0;
}

/* ---------------- 现场补充 ---------------- */
.extra {
  margin-top: 26rpx;
  padding: 24rpx 24rpx 20rpx;
  border-radius: 20rpx;
  background: var(--ui-surface);
}

.extra__head {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.extra__title {
  font-size: 26rpx;
  color: var(--ui-text);
  font-weight: 600;
}

.extra__tip {
  flex: 1;
  min-width: 0;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.extra__note {
  width: 100%;
  min-height: 96rpx;
  margin-top: 16rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2);
  font-size: 26rpx;
  color: var(--ui-text);
  line-height: 1.65;
  box-sizing: border-box;
}

.extra__ph {
  color: var(--ui-text-3);
}

.extra__shots {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 14rpx;
}

.shot {
  position: relative;
  width: 148rpx;
  height: 148rpx;
  border-radius: 14rpx;
  overflow: hidden;
  background: var(--ui-raise-2);
}

.shot__img {
  width: 100%;
  height: 100%;
}

.shot__del {
  position: absolute;
  top: 0;
  right: 0;
  width: 40rpx;
  height: 40rpx;
  line-height: 36rpx;
  text-align: center;
  border-radius: 0 0 0 12rpx;
  font-size: 26rpx;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
}

.shot--add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.shot__plus {
  font-size: 34rpx;
  line-height: 1;
  color: var(--ui-text-3);
}

.shot__label {
  margin-top: 6rpx;
  font-size: 21rpx;
  color: var(--ui-text-3);
}

.run__bottom-space {
  height: 40rpx;
}

/* ---------------- 底部单一主动作 ---------------- */
.run__bar {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom));
  background: var(--ui-surface);
}

.run__bar-tip {
  flex: 1;
  min-width: 0;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.run__save {
  flex: 0 0 auto;
  margin: 0;
  padding: 0 34rpx;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  color: var(--ui-on-accent);
  background: var(--ui-accent);
  border: none;
}

.run__save--busy {
  opacity: 0.6;
}

/* ---------------- 来源选择弹层（与 ImageParse 同一套） ---------------- */
.source-sheet {
  padding: 20px 16px 12px;
}

.source-sheet__title {
  display: block;
  padding: 0 4px 14px;
  color: var(--ui-text-3);
  font-size: 13px;
}

.source-sheet__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  background-color: var(--ui-raise-2);
  color: var(--ui-text);
  font-size: 15px;
}

.source-sheet__item + .source-sheet__item {
  margin-top: 8px;
}

.source-sheet__icon {
  display: flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background-color: var(--ui-accent-soft, var(--ui-raise-2));
  color: var(--ui-accent);
}

.source-sheet__label {
  flex: 1;
  min-width: 0;
}

.source-sheet__cancel {
  margin-top: 18px;
  padding: 15px;
  border-radius: 999px;
  background-color: var(--ui-raise-2);
  color: var(--ui-text-2);
  font-size: 15px;
  text-align: center;
}
</style>
