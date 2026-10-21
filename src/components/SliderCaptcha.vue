<script setup>
import { computed, ref } from 'vue'
import request from '../api/request'

/**
 * 滑动验证（2026-10-21，第二版；与网页端同一套后端接口）。
 *
 * 第一版是拼图，使用方说不好看，点名要 TMUI 的 xSlideVerify 那种形态：
 * 浅灰药丸轨道 + 白色圆钮 + 居中灰字 + 拖到目标位置变成功色。这一版照那个观感重做。
 *
 * 判定仍在服务端：服务端下发随机目标百分比（40%~85%），±6% 内算过，
 * 通过发一次性 ticket；注册必须带。
 *
 * ⚠️ 指示带画在界面上，脚本读得到 ⇒ 挡普通脚本，不挡针对性脚本（抗刷靠限流，见待办 D6）。
 */
defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const challenge = ref(null) // { id, targetPercent, tolerance }
const loading = ref(false)
const dragging = ref(false)
const offset = ref(0)
const status = ref('idle') // idle | verifying | ok | error
const message = ref('')

/** 与样式里保持一致：轨道高 88rpx、滑块 80rpx ⇒ 行程要按 rpx→px 换算 */
const TRACK_H_RPX = 88
const THUMB_RPX = 80

let startClientX = 0
let maxOffsetPx = 0
let trackWidthPx = 0

function rpxToPx(rpx) {
  const { windowWidth } = uni.getSystemInfoSync()
  return (windowWidth * rpx) / 750
}

const percent = computed(() => (trackWidthPx > 0 ? (offset.value / trackWidthPx) * 100 : 0))

async function load() {
  loading.value = true
  message.value = ''
  status.value = 'idle'
  offset.value = 0
  emit('update:modelValue', '')
  try {
    const res = await request.get('/api/captcha/new')
    const body = res.data || {}
    challenge.value = body.data || body
  } catch {
    message.value = '验证加载失败，点一下换一张'
  } finally {
    loading.value = false
  }
}

load()

function refreshMaxOffset() {
  const { windowWidth } = uni.getSystemInfoSync()
  // 轨道宽度 = 640rpx（与样式一致）；百分比按轨道宽算，和指示带定位口径一致
  trackWidthPx = rpxToPx(640)
  maxOffsetPx = Math.max(0, trackWidthPx - rpxToPx(THUMB_RPX))
}

function onTouchStart(event) {
  if (status.value === 'ok' || loading.value) return
  refreshMaxOffset()
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
  offset.value = Math.min(Math.max(0, touch.clientX - startClientX), maxOffsetPx)
}

async function onTouchEnd() {
  if (!dragging.value) return
  dragging.value = false

  const pct = Math.round(percent.value)
  status.value = 'verifying'
  try {
    const res = await request.post('/api/captcha/verify', { id: challenge.value?.id, percent: pct })
    const body = res.data || {}
    const ticket = (body.data || {}).ticket
    if (!ticket) throw new Error(body.msg || '验证失败')
    status.value = 'ok'
    message.value = '验证通过'
    emit('update:modelValue', ticket)
  } catch (error) {
    status.value = 'error'
    message.value = error?.response?.data?.msg || error?.message || '没对准，再试一次'
    offset.value = 0
    load()
  }
}
</script>

<template>
  <view class="sv" :class="`is-${status}`">
    <view
      class="sv__track"
      @touchmove.stop.prevent="onTouchMove"
      @touchend.stop.prevent="onTouchEnd"
      @touchcancel.stop.prevent="onTouchEnd"
    >
      <!-- 目标指示带：位置每次由服务端随机给 -->
      <view
        v-if="challenge && !loading"
        class="sv__target"
        :style="{ left: `${challenge.targetPercent}%` }"
      ></view>

      <view class="sv__progress" :style="{ width: `${offset * 2 + 40}rpx` }"></view>

      <text class="sv__tip">
        {{
          status === 'ok'
            ? '验证通过'
            : status === 'verifying'
              ? '校验中…'
              : loading
                ? '加载中…'
                : '按住滑块，拖到亮块处'
        }}
      </text>

      <view
        class="sv__thumb"
        :style="{ transform: `translateX(${offset * 2}rpx)` }"
        @touchstart.stop.prevent="onTouchStart"
      >
        <text class="sv__thumb-icon">{{ status === 'ok' ? '✓' : '›' }}</text>
      </view>
    </view>

    <text v-if="message" class="sv__msg">{{ message }}</text>
  </view>
</template>

<style lang="scss" scoped>
.sv {
  width: 100%;
}

/* 轨道照 TMUI xSlideVerify：浅灰药丸，无边框 */
.sv__track {
  position: relative;
  width: 640rpx;
  height: 88rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background-color: #eef0f3;

  .sv.is-ok & {
    background-color: #e8f5ec;
  }

  .sv.is-error & {
    background-color: #fdeced;
  }
}

/* 虚线指示带（不用语义色 token，避免与色板护栏打架） */
.sv__target {
  position: absolute;
  top: 10rpx;
  bottom: 10rpx;
  width: 80rpx;
  margin-left: -40rpx;
  border-radius: 999rpx;
  border: 1px dashed #c3c9d2;
  background-color: rgba(255, 255, 255, 0.9);
}

.sv__progress {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(17, 17, 17, 0.05);
}

.sv__tip {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7b8494;
  font-size: 25rpx;

  .sv.is-ok & {
    color: #15803d;
  }

  .sv.is-error & {
    color: #b91c1c;
  }
}

/* 白色圆钮 + 细投影 */
.sv__thumb {
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  display: flex;
  width: 80rpx;
  height: 80rpx;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  background-color: #fff;
  box-shadow: 0 4rpx 16rpx rgba(15, 23, 42, 0.14);

  .sv.is-ok & {
    background-color: #fff;
  }
}

.sv__thumb-icon {
  color: #111;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1;

  .sv.is-ok & {
    color: #15803d;
  }
}

.sv__msg {
  display: block;
  margin-top: 12rpx;
  color: #7b8494;
  font-size: 22rpx;

  .sv.is-error & {
    color: #b91c1c;
  }
}
</style>
