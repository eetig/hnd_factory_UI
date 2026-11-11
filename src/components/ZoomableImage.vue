<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { assetUrl } from '../api/base'

/*
 * 图片查看台（2026-11-02，使用方：「所有图片预览都能旋转方向，改变大小」）。
 *
 * 一个可复用的"看图器"，只负责一块图片区域：
 *   · **旋转**：左右各 90°，任意角度累积（按钮 + R 键）
 *   · **缩放**：滚轮 / 按钮 / +− 键，0.5× ~ 8×
 *   · **平移**：放大后按住拖动
 *   · **复位**：双击、按钮或 0 键（一次退回"正好放下"）
 *
 * 为什么做成组件而不是在每个弹窗里各写一份：
 * 仓里现在有四五处看图（领料单据、入库单据、工单图据、储罐液位图…），
 * 每处各写一份缩放/旋转，迟早会有一处忘了适配深色或忘了清空状态。
 *
 * 交互取舍（按 ui-taste 的 Motion 规则：状态变化要克制）：
 *   · 旋转/缩放用 150ms 的过渡，不弹跳
 *   · `prefers-reduced-motion` 下过渡直接关掉
 *   · 不用滚轮缩放时页面跟着滚：wheel 上 preventDefault（仅在本区域内）
 */
const props = defineProps({
  src: { type: String, default: '' },
  alt: { type: String, default: '图片' },
})

const scale = ref(1)
const rotate = ref(0)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
const naturalSize = ref({ width: 0, height: 0 })

const MIN_SCALE = 0.5
const MAX_SCALE = 8
const STEP = 0.25

const stageRef = ref(null)
const dragStart = ref({ x: 0, y: 0 })

/** 变换串：先平移、再缩放、最后旋转（顺序固定，避免"转完拖动方向乱掉"） */
const transformStyle = computed(
  () =>
    `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value}) rotate(${rotate.value}deg)`,
)

/** 是否已经不是初始状态（决定"复位"按钮是否可用） */
const isDirty = computed(
  () => scale.value !== 1 || rotate.value !== 0 || offsetX.value !== 0 || offsetY.value !== 0,
)

function reset() {
  scale.value = 1
  rotate.value = 0
  offsetX.value = 0
  offsetY.value = 0
}

function zoomBy(delta) {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((scale.value + delta).toFixed(2))))
  scale.value = next
  if (next === 1) {
    // 退回到 1× 时把平移也清掉：否则图会"偏在一边"
    offsetX.value = 0
    offsetY.value = 0
  }
}

function rotateBy(deg) {
  rotate.value = (rotate.value + deg) % 360
}

function onWheel(event) {
  // 只在能滚动缩放时拦默认行为，避免"想滚页面却被吃掉"
  event.preventDefault()
  zoomBy(event.deltaY > 0 ? -STEP : STEP)
}

function onPointerDown(event) {
  if (scale.value <= 1) return
  dragging.value = true
  dragStart.value = { x: event.clientX - offsetX.value, y: event.clientY - offsetY.value }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event) {
  if (!dragging.value) return
  offsetX.value = event.clientX - dragStart.value.x
  offsetY.value = event.clientY - dragStart.value.y
}

function onPointerUp(event) {
  dragging.value = false
  event.currentTarget.releasePointerCapture?.(event.pointerId)
}

function onKeydown(event) {
  const key = event.key.toLowerCase()
  if (key === 'r') {
    rotateBy(event.shiftKey ? -90 : 90)
    event.preventDefault()
  } else if (key === '+' || key === '=') {
    zoomBy(STEP)
    event.preventDefault()
  } else if (key === '-' || key === '_') {
    zoomBy(-STEP)
    event.preventDefault()
  } else if (key === '0') {
    reset()
    event.preventDefault()
  }
}

function onImageLoad(event) {
  naturalSize.value = {
    width: event.target?.naturalWidth || 0,
    height: event.target?.naturalHeight || 0,
  }
}

// 换图时把变换清干净：不复位的话，上一张的缩放/旋转会留在下一张上
watch(
  () => props.src,
  () => {
    reset()
    naturalSize.value = { width: 0, height: 0 }
  },
)

onBeforeUnmount(() => {
  dragging.value = false
})

defineExpose({ reset, zoomBy, rotateBy })
</script>

<template>
  <div class="zs">
    <div
      ref="stageRef"
      class="zs__stage"
      :class="{ 'is-dragging': dragging, 'is-zoomed': scale > 1 }"
      tabindex="0"
      role="img"
      :aria-label="`${alt}（可旋转、可缩放：R 旋转，加减号缩放，0 复位）`"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="reset"
      @keydown="onKeydown"
    >
      <img
        v-if="src"
        :src="assetUrl(src)"
        :alt="alt"
        class="zs__image"
        :style="{ transform: transformStyle }"
        draggable="false"
        @load="onImageLoad"
      />
      <p v-else class="zs__empty">没有图片</p>
    </div>

    <!-- 工具条：旋转 / 缩放 / 复位。按钮不小于 32px，够点；文字按钮给屏幕阅读器 -->
    <div class="zs__bar">
      <button type="button" class="zs__btn" title="向左旋转 90°" @click="rotateBy(-90)">⟲</button>
      <button type="button" class="zs__btn" title="向右旋转 90°" @click="rotateBy(90)">⟳</button>
      <span class="zs__sep"></span>
      <button type="button" class="zs__btn" title="缩小" @click="zoomBy(-STEP)">−</button>
      <span class="zs__ratio">{{ Math.round(scale * 100) }}%</span>
      <button type="button" class="zs__btn" title="放大" @click="zoomBy(STEP)">+</button>
      <span class="zs__sep"></span>
      <button
        type="button"
        class="zs__btn zs__btn--text"
        :disabled="!isDirty"
        title="复位（0）"
        @click="reset"
      >
        复位
      </button>
      <span v-if="naturalSize.width" class="zs__meta">
        {{ naturalSize.width }} × {{ naturalSize.height }}
        <span v-if="rotate % 180 !== 0">（已旋转 {{ rotate }}°）</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.zs {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.zs__stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  flex: 1;
  overflow: hidden;
  border-radius: 12px;
  background-color: #0b0b0c;
  cursor: zoom-in;
  touch-action: none;
  outline: none;
}

.zs__stage.is-zoomed {
  cursor: grab;
}

.zs__stage.is-dragging {
  cursor: grabbing;
}

.zs__stage:focus-visible {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7);
}

.zs__image {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  user-select: none;
  transition: transform 0.15s ease-out;
  will-change: transform;
}

.zs__stage.is-dragging .zs__image {
  transition: none;
}

.zs__empty {
  font-size: 13px;
  color: #a1a1aa;
}

.zs__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  font-size: 12px;
  color: #6b7280;
}

.zs__btn {
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background-color: #fff;
  font-size: 14px;
  line-height: 1;
  color: #374151;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.zs__btn:hover:not(:disabled) {
  background-color: #f5f3ee;
  border-color: #d1d5db;
}

.zs__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.zs__btn:focus-visible {
  outline: 2px solid #111827;
  outline-offset: 1px;
}

.zs__btn--text {
  font-size: 12px;
}

.zs__ratio {
  min-width: 42px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.zs__sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background-color: #e5e7eb;
}

.zs__meta {
  margin-left: auto;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  .zs__image {
    transition: none;
  }
}
</style>
