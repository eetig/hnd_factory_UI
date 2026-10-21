<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import request from '../api/request'

/**
 * 滑动验证（2026-10-21，第二版）。
 *
 * **第一版是拼图**（背景图 + 六边形缺口），使用方看了说不好看，点名要 TMUI 的
 * xSlideVerify 那种形态 —— 那个组件其实没有图：一条浅灰轨道 + 白色圆形滑块 +
 * 居中灰字，拖到目标位置变成功色。这一版照那个观感重做，把图整个拿掉。
 *
 * 判定仍在服务端（这一点没让步）：
 *   · 服务端下发**随机目标百分比**（40%~85%），前端只知道"该停在哪"，不知道答案对不对
 *   · 停在 ±6% 内算过；一次性 ticket，错 3 次作废，2 分钟过期
 *
 * ⚠️ 指示带是画出来的，脚本读得到 ⇒ 它挡的是"随手写循环"的脚本，挡不住针对性脚本。
 * 真要抗刷得靠限流（待办 D6 记着）。
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

const trackRef = ref(null)
let startX = 0
let maxOffset = 0
let trackWidth = 0

/*
 * 百分比必须按**滑块中心**算，不能按位移算。
 *
 * 2026-10-21 使用方实测报 bug：「对准了也不通过」。原因是两边各取了一个基准：
 *   · 指示带画在 轨道宽 × targetPercent（以轨道左边为 0）
 *   · 而报给服务端的是 位移 / 轨道宽 —— 位移的 0 点是滑块**左边缘**（还带 2px 内缩）
 * 于是"眼睛把滑块中心对到指示带中心"时，报出去的百分比比目标小
 * (2 + 20) / 轨道宽 ≈ 5~9%，正好落在 ±6% 容差之外 ⇒ 永远不通过。
 *
 * 现在统一到**滑块中心**：中心 = 2px(内缩) + 位移 + 20px(半径)，指示带也以中心对齐。
 */
const THUMB_INSET = 2
const THUMB_SIZE = 40
const percent = computed(() =>
  trackWidth > 0 ? ((offset.value + THUMB_INSET + THUMB_SIZE / 2) / trackWidth) * 100 : 0,
)

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
    message.value = '验证加载失败，点这里重试'
  } finally {
    loading.value = false
  }
}

load()

function refreshMaxOffset() {
  const el = trackRef.value
  if (!el) return
  trackWidth = el.clientWidth
  // 滑块行程 = 轨道宽 - 滑块宽（滑块 40px）
  maxOffset = Math.max(0, trackWidth - 40)
}

function onPointerDown(event) {
  if (status.value === 'ok' || loading.value) return
  refreshMaxOffset()
  const clientX = event.touches ? event.touches[0].clientX : event.clientX
  dragging.value = true
  startX = clientX - offset.value
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
  offset.value = Math.min(Math.max(0, clientX - startX), maxOffset)
}

async function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('touchmove', onPointerMove)
  window.removeEventListener('touchend', onPointerUp)

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

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('touchmove', onPointerMove)
  window.removeEventListener('touchend', onPointerUp)
})
</script>

<template>
  <div class="slide-verify" :class="`is-${status}`">
    <div ref="trackRef" class="slide-verify__track">
      <!-- 目标指示带：告诉人"停在这一段里"，位置每次由服务端随机给 -->
      <div
        v-if="challenge && !loading"
        class="slide-verify__target"
        :style="{ left: `${challenge.targetPercent}%` }"
        aria-hidden="true"
      ></div>

      <div class="slide-verify__progress" :style="{ width: `${offset + 20}px` }"></div>

      <span class="slide-verify__tip">
        {{
          status === 'ok'
            ? '验证通过'
            : status === 'verifying'
              ? '校验中…'
              : loading
                ? '加载中…'
                : '按住滑块，拖到亮块处'
        }}
      </span>

      <button
        type="button"
        class="slide-verify__thumb"
        :style="{ transform: `translateX(${offset}px)` }"
        :aria-label="status === 'ok' ? '验证已通过' : '按住并拖动滑块'"
        :disabled="status === 'ok' || loading"
        @pointerdown.prevent="onPointerDown"
        @touchstart.prevent="onPointerDown"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
          <path v-if="status === 'ok'" d="M20 6L9 17l-5-5" />
          <path v-else d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <p v-if="message" class="slide-verify__msg">{{ message }}</p>
  </div>
</template>

<style scoped>
.slide-verify {
  width: 100%;
}

/* 轨道照 TMUI xSlideVerify 的观感：浅灰、整条药丸、无边框 */
.slide-verify__track {
  position: relative;
  height: 44px;
  overflow: hidden;
  border-radius: 999px;
  background: #eef0f3;
  user-select: none;
  transition: background-color 160ms ease;
}

.slide-verify.is-ok .slide-verify__track {
  background: #e8f5ec;
}

.slide-verify.is-error .slide-verify__track {
  background: #fdeced;
  animation: slide-shake 260ms ease;
}

/* 发丝级虚线指示带（不走 Tailwind 语义色，避免碰到色板护栏） */
.slide-verify__target {
  position: absolute;
  top: 7px;
  bottom: 7px;
  width: 40px;
  margin-left: -20px;
  border-radius: 999px;
  border: 1px dashed #c3c9d2;
  background: rgb(255 255 255 / 0.9);
  box-shadow: inset 0 0 0 3px rgb(255 255 255 / 0.6);
}

.slide-verify.is-ok .slide-verify__target {
  border-color: #a7d7b5;
}

.slide-verify__progress {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: rgb(17 17 17 / 0.05);
}

.slide-verify__tip {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7b8494;
  font-size: 13px;
  letter-spacing: 0.02em;
  pointer-events: none;
}

.slide-verify.is-ok .slide-verify__tip {
  color: #15803d;
}

.slide-verify.is-error .slide-verify__tip {
  color: #b91c1c;
}

/* 滑块：白色圆钮 + 细微投影（TMUI 的 btnColor=white + round=25 就是这个意思） */
.slide-verify__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: #fff;
  color: #111;
  box-shadow: 0 2px 8px rgb(15 23 42 / 0.14);
  cursor: grab;
  touch-action: none;
  transition: background-color 140ms ease;
}

.slide-verify__thumb:active {
  cursor: grabbing;
}

.slide-verify.is-ok .slide-verify__thumb {
  color: #15803d;
  cursor: default;
}

.slide-verify__thumb svg {
  width: 18px;
  height: 18px;
}

.slide-verify__msg {
  margin-top: 8px;
  color: #7b8494;
  font-size: 12px;
}

.slide-verify.is-error .slide-verify__msg {
  color: #b91c1c;
}

@keyframes slide-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-4px);
  }
  75% {
    transform: translateX(4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .slide-verify.is-error .slide-verify__track {
    animation: none;
  }
}
</style>
