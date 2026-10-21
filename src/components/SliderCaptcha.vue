<script setup>
import { computed, ref } from 'vue'
import request from '../api/request'

/**
 * 滑动拼图验证码（2026-10-21，与网页端 components/SliderCaptcha.vue 同一套后端接口）。
 *
 * 三端共用 `/api/captcha/new` 与 `/api/captcha/verify`：图与缺口由服务端 Java2D 生成，
 * **正确位置只存在服务端**，通过后发一次性 ticket，注册时必须带。
 *
 * 与网页端的差异只有交互层：这边用 touchstart / touchmove / touchend（小程序与 App 没有
 * mouse 事件）；尺寸用 rpx，画布固定 640rpx × 320rpx（= 320×160 px），**不做宽度拉伸** ——
 * 一旦按宽度等比缩放，拼图块的上下位置和触点在两端就对不上，判定会偏。
 */
defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const CANVAS_WIDTH = 320
const DISPLAY_RPX = 640 // 画布显示宽度（rpx）；高度 = 320rpx，等比

const captcha = ref(null)
const loading = ref(false)
const dragging = ref(false)
const offset = ref(0)
const status = ref('idle') // idle | verifying | ok | error
const message = ref('')

let startClientX = 0
let displayWidthPx = 320

/** 1px → rpx 的换算（设计稿 750rpx 对应 windowWidth） */
function rpxToPx(rpx) {
  const { windowWidth } = uni.getSystemInfoSync()
  return (windowWidth * rpx) / 750
}

async function load() {
  loading.value = true
  message.value = ''
  status.value = 'idle'
  offset.value = 0
  emit('update:modelValue', '')
  try {
    const res = await request.get('/api/captcha/new')
    const body = res.data || {}
    captcha.value = body.data || body
    displayWidthPx = rpxToPx(DISPLAY_RPX)
  } catch {
    message.value = '验证码加载失败，点一下换一张'
  } finally {
    loading.value = false
  }
}

load()

const scale = computed(() => (displayWidthPx > 0 ? CANVAS_WIDTH / displayWidthPx : 1))
const maxOffsetPx = computed(() => Math.max(0, displayWidthPx - 48 * (displayWidthPx / CANVAS_WIDTH)))

function onTouchStart(event) {
  if (status.value === 'ok' || loading.value) return
  const touch = event.touches?.[0] || event.changedTouches?.[0]
  if (!touch) return
  dragging.value = true
  startClientX = touch.clientX - offset.value
  status.value = 'idle'
  message.value = ''
}

function onTouchMove(event) {
  if (!dragging.value) return
  const touch = event.touches?.[0] || event.changedTouches?.[0]
  if (!touch) return
  const raw = touch.clientX - startClientX
  offset.value = Math.min(Math.max(0, raw), maxOffsetPx.value)
}

async function onTouchEnd() {
  if (!dragging.value) return
  dragging.value = false

  // 屏幕位移换算回 320 宽画布的原坐标：服务端只认画布坐标
  const offsetX = Math.round(offset.value * scale.value)
  status.value = 'verifying'
  try {
    const res = await request.post('/api/captcha/verify', { id: captcha.value?.id, offsetX })
    const body = res.data || {}
    const ticket = (body.data || {}).ticket
    if (!ticket) {
      throw new Error(body.msg || '验证失败')
    }
    status.value = 'ok'
    message.value = '验证通过'
    emit('update:modelValue', ticket)
  } catch (error) {
    status.value = 'error'
    message.value = error?.response?.data?.msg || error?.message || '位置不对，再试一次'
    offset.value = 0
    load()
  }
}
</script>

<template>
  <view class="cap">
    <view class="cap__stage" :class="{ 'is-ok': status === 'ok' }">
      <image
        v-if="captcha"
        class="cap__bg"
        :src="captcha.background"
        mode="scaleToFill"
        @click="load"
      />
      <image
        v-if="captcha"
        class="cap__piece"
        :src="captcha.piece"
        mode="scaleToFill"
        :style="{ top: `${captcha.pieceTop * 2}rpx`, transform: `translateX(${offset * 2}rpx)` }"
      />
      <view v-if="loading" class="cap__reload">
        <text class="cap__reload-text">加载中…</text>
      </view>
      <view v-else-if="status === 'error'" class="cap__reload" @click="load">
        <text class="cap__reload-text">看不清？换一张</text>
      </view>
    </view>

    <view
      class="cap__track"
      :class="{ 'is-ok': status === 'ok' }"
      @touchmove.stop.prevent="onTouchMove"
      @touchend.stop.prevent="onTouchEnd"
      @touchcancel.stop.prevent="onTouchEnd"
    >
      <view class="cap__progress" :style="{ width: `${offset * 2 + 40}rpx` }"></view>
      <text class="cap__tip">
        {{ status === 'ok' ? '验证通过' : status === 'verifying' ? '校验中…' : '按住滑块，拖动完成拼图' }}
      </text>
      <view
        class="cap__thumb"
        :class="{ 'is-ok': status === 'ok' }"
        :style="{ transform: `translateX(${offset * 2}rpx)` }"
        @touchstart.stop.prevent="onTouchStart"
      >
        <text class="cap__thumb-icon">{{ status === 'ok' ? '✓' : '›' }}</text>
      </view>
    </view>

    <text v-if="message" class="cap__msg" :class="{ 'is-error': status === 'error' }">{{ message }}</text>
  </view>
</template>

<style lang="scss" scoped>
.cap {
  width: 100%;
}

/* 画布固定 640rpx × 320rpx（= 320×160 px）：**不按宽度拉伸**，
   否则拼图块的纵向位置与触点换算会偏。 */
.cap__stage {
  position: relative;
  width: 640rpx;
  height: 320rpx;
  overflow: hidden;
  border-radius: 16rpx;
  border: 1px solid $ui-border;
  background-color: $ui-surface-2;
}

.cap__bg {
  width: 100%;
  height: 100%;
}

.cap__piece {
  position: absolute;
  left: 0;
  width: 96rpx; /* 48px */
  height: 96rpx;
}

.cap__reload {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.35);

  &-text {
    color: #fff;
    font-size: 24rpx;
  }
}

.cap__track {
  position: relative;
  width: 640rpx;
  height: 80rpx;
  margin-top: 16rpx;
  overflow: hidden;
  border-radius: 16rpx;
  border: 1px solid $ui-border;
  background-color: $ui-surface-2;

  &.is-ok {
    border-color: #a7d7b5;
    background-color: #f0f9f2;
  }
}

.cap__progress {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(17, 17, 17, 0.08);
}

.cap__tip {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $ui-text-3;
  font-size: 24rpx;
}

.cap__thumb {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  width: 80rpx;
  height: 80rpx;
  align-items: center;
  justify-content: center;
  border-radius: 16rpx;
  border: 1px solid $ui-border;
  background-color: #fff;

  &.is-ok {
    border-color: #a7d7b5;
    background-color: #ecf7ef;
  }
}

.cap__thumb-icon {
  color: $ui-text;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1;
}

.cap__msg {
  display: block;
  margin-top: 12rpx;
  color: $ui-text-3;
  font-size: 22rpx;

  &.is-error {
    color: $ui-danger;
  }
}
</style>
