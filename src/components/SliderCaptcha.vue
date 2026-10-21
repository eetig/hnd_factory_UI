<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import request from '../api/request'

/**
 * 滑动拼图验证码（2026-10-21）。
 *
 * 视觉与交互照网上那篇 vue3 滑动拼图：背景图 + 六边形缺口 + 跟着滑块走的拼图块 + 进度条。
 * **但比对在后端**：那篇文章是前端自己比 offsetX（±2px 算过），直接调接口就能绕过 ——
 * 这里拖动结束后把 offsetX 发给 `/api/captcha/verify`，由服务端判，通过后发一次性 ticket。
 *
 * 设计取舍：
 *   · 图与缺口都是服务端 Java2D 画的（不带二进制资源）—— 正确位置只存在服务端，前端拿不到
 *   · 拼接按"画布宽度等比缩放"：手机窄屏也不变形，offset 按比例换算回 320 宽的原坐标
 *   · 鼠标与触摸统一走 pointer 事件（桌面 + 手机浏览器一套代码）
 */
defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const CANVAS_WIDTH = 320
const TOLERANCE_LABEL = '拖动滑块完成拼图'

const captcha = ref(null) // { id, background, piece, width, height, pieceSize, pieceTop }
const loading = ref(false)
const dragging = ref(false)
const offset = ref(0)
const status = ref('idle') // idle | verifying | ok | error
const message = ref('')

const trackRef = ref(null)
let startX = 0
let scale = 1

const maxOffset = computed(() => {
  if (!captcha.value) return 0
  const canvasW = trackRef.value ? trackRef.value.clientWidth : CANVAS_WIDTH
  return Math.max(0, canvasW - captcha.value.pieceSize * (canvasW / CANVAS_WIDTH))
})
const thumbLeft = ref(0)

async function load() {
  loading.value = true
  message.value = ''
  status.value = 'idle'
  offset.value = 0
  thumbLeft.value = 0
  emit('update:modelValue', '')
  try {
    const res = await request.get('/api/captcha/new')
    const body = res.data || {}
    captcha.value = body.data || body
  } catch {
    message.value = '验证码加载失败，点这里重试'
  } finally {
    loading.value = false
  }
}

load()

function onPointerDown(event) {
  if (status.value === 'ok' || loading.value) return
  dragging.value = true
  startX = (event.touches ? event.touches[0].clientX : event.clientX) - offset.value
  status.value = 'idle'
  message.value = ''
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('touchmove', onPointerMove, { passive: false })
  window.addEventListener('touchend', onPointerUp)
}

function onPointerMove(event) {
  if (!dragging.value) return
  const clientX = event.touches ? event.touches[0].clientX : event.clientX
  const raw = clientX - startX
  offset.value = Math.min(Math.max(0, raw), maxOffset.value)
}

async function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('touchmove', onPointerMove)
  window.removeEventListener('touchend', onPointerUp)

  // 把屏幕上的位移换算回 320 宽画布的原坐标（前端缩放不能影响判定）
  const canvasW = trackRef.value ? trackRef.value.clientWidth : CANVAS_WIDTH
  scale = canvasW > 0 ? CANVAS_WIDTH / canvasW : 1
  const offsetX = Math.round(offset.value * scale)

  status.value = 'verifying'
  try {
    const res = await request.post('/api/captcha/verify', {
      id: captcha.value?.id,
      offsetX,
    })
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
    message.value =
      error?.response?.data?.msg || error?.message || '位置不对，再试一次'
    // 回位重来（真机上"差一点"是常事，别让人刷新页面）
    offset.value = 0
    setTimeout(() => {
      if (status.value === 'error') status.value = 'idle'
    }, 600)
    load()
  } finally {
    status.value = status.value === 'ok' ? 'ok' : status.value
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('touchmove', onPointerMove)
  window.removeEventListener('touchend', onPointerUp)
})
</script>

<template>
  <div class="slider-captcha">
    <div class="slider-captcha__stage" :style="{ aspectRatio: `${captcha?.width || 320} / ${captcha?.height || 160}`, maxHeight: '220px' }">
      <img v-if="captcha" :src="captcha.background" alt="滑动验证码背景" class="slider-captcha__bg" />
      <img
        v-if="captcha"
        :src="captcha.piece"
        alt=""
        aria-hidden="true"
        class="slider-captcha__piece"
        :style="{
          left: `${(offset * (100 / (maxOffset + 1))) * 0}px`,
          top: `${captcha.pieceTop}px`,
          transform: `translateX(${offset}px)`,
        }"
      />
      <button
        v-if="loading || status === 'error'"
        type="button"
        class="slider-captcha__reload"
        @click="load"
      >
        {{ loading ? '加载中…' : '看不清？换一张' }}
      </button>
    </div>

    <div ref="trackRef" class="slider-captcha__track" :class="{ 'is-ok': status === 'ok' }">
      <div class="slider-captcha__progress" :style="{ width: `${offset + 20}px` }"></div>
      <span class="slider-captcha__tip">
        {{ status === 'ok' ? '验证通过' : status === 'verifying' ? '校验中…' : TOLERANCE_LABEL }}
      </span>
      <button
        type="button"
        class="slider-captcha__thumb"
        :class="{ 'is-dragging': dragging, 'is-ok': status === 'ok' }"
        :style="{ transform: `translateX(${offset}px)` }"
        :aria-label="status === 'ok' ? '验证已通过' : '按住并拖动完成验证'"
        :disabled="status === 'ok'"
        @pointerdown.prevent="onPointerDown"
        @touchstart.prevent="onPointerDown"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
          <path v-if="status === 'ok'" d="M20 6L9 17l-5-5" />
          <path v-else d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>

    <p v-if="message" class="slider-captcha__msg" :class="{ 'is-error': status === 'error' }">
      {{ message }}
    </p>
  </div>
</template>

<style scoped>
.slider-captcha {
  width: 100%;
}

.slider-captcha__stage {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--line, #eaeaea);
  background: #f4f4f2;
  user-select: none;
}

.slider-captcha__bg {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
}

.slider-captcha__piece {
  position: absolute;
  width: 15%;
  pointer-events: none;
  filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.35));
}

.slider-captcha__reload {
  position: absolute;
  inset: 0;
  width: 100%;
  border: 0;
  background: rgb(0 0 0 / 0.35);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

.slider-captcha__track {
  position: relative;
  height: 40px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--region, #f1f1ef);
  border: 1px solid var(--line, #eaeaea);
}

.slider-captcha__track.is-ok {
  border-color: #a7d7b5;
  background: #f0f9f2;
}

.slider-captcha__progress {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgb(17 17 17 / 0.08);
  transition: width 60ms linear;
}

.slider-captcha__tip {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  font-size: 13px;
  letter-spacing: 0.02em;
  pointer-events: none;
}

.slider-captcha__thumb {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line, #e5e5e5);
  border-radius: 8px;
  background: #fff;
  color: #111;
  cursor: grab;
  touch-action: none;
  transition: background-color 120ms ease;
}

.slider-captcha__thumb.is-dragging {
  cursor: grabbing;
  background: #fafafa;
}

.slider-captcha__thumb.is-ok {
  border-color: #a7d7b5;
  background: #ecf7ef;
  color: #15803d;
  cursor: default;
}

.slider-captcha__thumb svg {
  width: 16px;
  height: 16px;
}

.slider-captcha__msg {
  margin-top: 6px;
  color: #6b7280;
  font-size: 12px;
}

.slider-captcha__msg.is-error {
  color: #b91c1c;
}
</style>
