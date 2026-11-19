<template>
  <view class="run" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart"
    @touchend="onEdgeEnd">
    <PageTitle :title="template.name || '巡检'" />

    <view class="run__head">
      <text class="run__kind">{{ kindText(template.kind) }}</text>
      <text class="run__count">已检查 {{ doneCount }}/{{ items.length }}<text v-if="ngCount"> · 异常 {{ ngCount }}</text></text>
    </view>

    <scroll-view class="run__body" :scroll-y="true">
      <view v-if="booting" class="run__hint">正在取清单…</view>

      <template v-else>
        <view v-for="(item, index) in items" :key="item.key" class="run__item"
          :class="{ 'run__item--ng': item.result === 'ng', 'run__item--ok': item.result === 'ok' }">
          <view class="run__row">
            <view class="run__titles">
              <text class="run__title">{{ index + 1 }}. {{ item.title }}</text>
              <text v-if="item.hint" class="run__hint-text">{{ item.hint }}</text>
            </view>
            <view class="run__choices">
              <text class="run__choice" :class="{ 'run__choice--ok': item.result === 'ok' }"
                @click="mark(item, 'ok')">正常</text>
              <text class="run__choice" :class="{ 'run__choice--ng': item.result === 'ng' }"
                @click="mark(item, 'ng')">异常</text>
            </view>
          </view>

          <view v-if="item.result === 'ng'" class="run__ng">
            <textarea class="run__note" v-model="item.note" auto-height maxlength="200"
              placeholder="哪儿不对？写一句（必填）" placeholder-class="run__ph" />
            <view class="run__shots">
              <view v-for="(src, i) in item.images" :key="i" class="run__shot-wrap">
                <image class="run__shot" :src="previewSrc(src)" mode="aspectFill" @click="preview(item, i)" />
                <text class="run__shot-del" @click.stop="removeShot(item, i)">×</text>
              </view>
              <view class="run__shot-add" @click="addShot(item)">
                <text class="run__shot-plus">＋</text>
                <text class="run__shot-label">拍照</text>
              </view>
            </view>
          </view>
        </view>

        <view class="run__remark">
          <text class="run__remark-label">整单备注（选填）</text>
          <textarea class="run__note" v-model="note" auto-height maxlength="500"
            placeholder="这次巡检有什么要说明的" placeholder-class="run__ph" />
        </view>

        <view class="run__bottom-space"></view>
      </template>
    </scroll-view>

    <view class="run__bar">
      <text class="run__bar-tip">{{ items.length ? '逐项点完就能提交' : '' }}</text>
      <button class="run__save" :class="{ 'run__save--busy': submitting }" :disabled="submitting || !items.length"
        @click="submit">{{ submitting ? '提交中…' : '完成并提交' }}</button>
    </view>

    <LoadingMask v-if="booting" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onBackPress, onLoad } from '@dcloudio/uni-app'
import { handleGlobalBack } from '../../utils/popupStack'

import { getTemplate, submitRecord, uploadRecordPhoto } from '../../api/inspect'
import { enqueue, makeClientUuid } from '../../utils/inspectOffline'
import { resolveAssetUrl } from '../../api/config'
import { useTheme } from '../../composables/useTheme'
import LoadingMask from '../../components/LoadingMask.vue'
import PageTitle from '../../components/PageTitle.vue'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'

const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const template = ref({ id: 0, name: '', kind: '' })
const items = ref([])
const note = ref('')
const booting = ref(true)
const submitting = ref(false)
const startedAt = ref(nowText())

const doneCount = computed(() => items.value.filter((item) => item.result).length)
const ngCount = computed(() => items.value.filter((item) => item.result === 'ng').length)

function nowText() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function kindText(kind) {
  if (kind === 'pump') return '消防泵房'
  if (kind === 'shop') return '车间'
  return kind || ''
}

function previewSrc(src) {
  // 本地临时路径直接给 image 用；已上传的 /files/ 才需要拼 img 域名
  return src && src.indexOf('/files/') === 0 ? resolveAssetUrl(src) : src
}

async function loadTemplate(templateId) {
  booting.value = true
  try {
    const res = await getTemplate(templateId)
    const body = (res && res.data) || {}
    if (body.code !== 200) throw new Error(body.msg || '清单没取到')
    const data = body.data || {}
    template.value = { id: data.id, name: data.name, kind: data.kind }
    const list = Array.isArray(data.items) ? data.items : []
    items.value = list.map((one, index) => ({
      key: 'i' + index,
      group: one.group || '',
      title: one.title || '',
      hint: one.hint || '',
      result: '',
      note: '',
      images: [],
    }))
  } catch (error) {
    toast(errorText(error, '清单没取到'))
  } finally {
    booting.value = false
  }
}

function mark(item, result) {
  item.result = item.result === result ? '' : result
  if (item.result !== 'ng') {
    item.note = ''
    item.images = []
  }
}

function addShot(item) {
  const source = 'camera'
  const options = {
    count: 1,
    sizeType: ['compressed'],
    sourceType: [source],
    success: (res) => {
      const filePath = (res.tempFilePaths || [])[0]
      if (filePath) item.images.push(filePath)
    },
    fail: () => {},
  }
  uni.chooseImage(options)
}

function removeShot(item, index) {
  item.images.splice(index, 1)
}

function preview(item, index) {
  const urls = item.images.map((src) => previewSrc(src))
  uni.previewImage({ urls, current: urls[index] || urls[0] })
}

function buildRecord() {
  return {
    clientUuid: makeClientUuid(),
    templateId: template.value.id,
    startedAt: startedAt.value,
    finishedAt: nowText(),
    note: String(note.value || '').trim(),
    items: items.value.map((item) => ({
      group: item.group,
      title: item.title,
      hint: item.hint,
      result: item.result,
      note: String(item.note || '').trim(),
      images: item.images.slice(),
    })),
  }
}

function checkBeforeSubmit() {
  const unchecked = items.value.findIndex((item) => !item.result)
  if (unchecked >= 0) {
    toast('第 ' + (unchecked + 1) + ' 项还没点')
    return false
  }
  const bad = items.value.find((item) => item.result === 'ng' && !String(item.note || '').trim())
  if (bad) {
    toast('「' + bad.title + '」异常了，写一句说明')
    return false
  }
  const noPhoto = items.value.find((item) => item.result === 'ng' && !item.images.length)
  if (noPhoto) {
    toast('「' + noPhoto.title + '」异常了，拍一张照片')
    return false
  }
  return true
}

async function submit() {
  if (submitting.value || !checkBeforeSubmit()) return
  submitting.value = true
  const record = buildRecord()
  try {
    // 先把现场照片换成服务器路径，再整单提交
    const uploaded = []
    for (const item of record.items) {
      const images = []
      for (const src of item.images) {
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
      uploaded.push({ ...item, images })
    }

    const res = await submitRecord({ ...record, items: uploaded })
    const body = (res && res.data) || {}
    if (body.code !== 200) {
      // 服务器明确回了错（比如清单被删了），这不是网络问题，别进队列反复重试
      toast(body.msg || '没提交上')
      return
    }
    toast('巡检已提交')
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
    toast('没带清单编号')
    return
  }
  startedAt.value = nowText()
  loadTemplate(templateId)
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
  justify-content: space-between;
  padding: 10rpx 24rpx 6rpx;
}

.run__kind {
  font-size: 24rpx;
  color: var(--ui-text-2);
  padding: 5rpx 16rpx;
  border-radius: 999rpx;
  background: var(--ui-raise-2);
}

.run__count {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.run__body {
  flex: 1;
  min-height: 0;
  padding: 8rpx 20rpx 0;
}

.run__hint {
  padding: 90rpx 0;
  text-align: center;
  font-size: 25rpx;
  color: var(--ui-text-3);
}

.run__item {
  margin-top: 14rpx;
  padding: 20rpx 22rpx;
  border-radius: 18rpx;
  background: var(--ui-surface);
}

.run__item--ok {
  border-left: 6rpx solid var(--ui-accent);
}

.run__item--ng {
  border-left: 6rpx solid var(--ui-amber-800);
}

.run__row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.run__titles {
  flex: 1;
  min-width: 0;
}

.run__title {
  display: block;
  font-size: 28rpx;
  color: var(--ui-text);
  line-height: 1.5;
}

.run__hint-text {
  display: block;
  margin-top: 6rpx;
  font-size: 23rpx;
  color: var(--ui-text-3);
  line-height: 1.5;
}

.run__choices {
  display: flex;
  gap: 10rpx;
  flex: 0 0 auto;
}

.run__choice {
  padding: 12rpx 22rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

.run__choice--ok {
  color: var(--ui-on-accent);
  background: var(--ui-accent);
  font-weight: 600;
}

.run__choice--ng {
  color: #fff;
  background: var(--ui-amber-800);
  font-weight: 600;
}

.run__ng {
  margin-top: 18rpx;
}

.run__note {
  width: 100%;
  min-height: 76rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2);
  font-size: 25rpx;
  color: var(--ui-text);
  line-height: 1.6;
  box-sizing: border-box;
}

.run__ph {
  color: var(--ui-text-3);
}

.run__shots {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 14rpx;
}

.run__shot-wrap {
  position: relative;
}

.run__shot {
  width: 132rpx;
  height: 132rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2);
}

.run__shot-del {
  position: absolute;
  top: -10rpx;
  right: -10rpx;
  width: 40rpx;
  height: 40rpx;
  line-height: 36rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 26rpx;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}

.run__shot-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 132rpx;
  height: 132rpx;
  border-radius: 14rpx;
  background: var(--ui-raise-2);
}

.run__shot-plus {
  font-size: 34rpx;
  color: var(--ui-text-3);
  line-height: 1;
}

.run__shot-label {
  margin-top: 6rpx;
  font-size: 21rpx;
  color: var(--ui-text-3);
}

.run__remark {
  margin-top: 22rpx;
}

.run__remark-label {
  display: block;
  margin-bottom: 12rpx;
  font-size: 23rpx;
  color: var(--ui-text-3);
}

.run__bottom-space {
  height: 40rpx;
}

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
  padding: 0 40rpx;
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
</style>
