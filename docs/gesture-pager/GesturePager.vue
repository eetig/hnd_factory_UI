<template>
  <view
    class="gp"
    :class="{ 'is-animating': animating }"
    @touchstart.stop="onTouchStart"
    @touchmove.stop.prevent="onTouchMove"
    @touchend.stop="onTouchEnd"
    @touchcancel.stop="onTouchEnd"
  >
    <view class="gp__track" :style="[trackStyle, trackHeightStyle]">
      <view
        v-for="cell in windowItems"
        :key="cell.key"
        class="gp__page"
        :style="pageStyleAt(cell.i)"
      >
        <slot :item="cell.item" :i="cell.i" :active="cell.i === activeIndex" />
      </view>
    </view>
  </view>
</template>

<script setup>
/*
 * GesturePager —— 横向"连续跟手 + 惯性预测吸附"的卡片轨道（2026-11-11 从抄表页抽出）
 *
 * 和常见实现的区别：
 * 1. 没有"滑动超过 X% 就翻一页"的判定。手指拖动时轨道 1:1 跟手，寸步不离；
 * 2. 每张卡的缩放/透明度由"它离屏幕中心多远"实时算，所以拖到一半时
 *    两张卡都在中间尺寸 —— 不是松手才跳变；
 * 3. 松手用最近 60ms 的速度做预测：距离 = 速度 × TAU，时长 = 3×距离/速度，
 *    配合 easeOutCubic，起手速度正好等于松手速度（不"推一把"，也不"黏住"）；
 * 4. 滑行经过整数页时换页（把 scrollX 折回页内），轨道永远只有 5 张 DOM；
 * 5. 松手后必定收尾吸附到整数页，不会停在两张卡中间。
 *
 * 手感参数都在下面常量里，按项目调。
 */
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  /** 数据数组；每项要有 itemKey 指定的唯一字段 */
  items: { type: Array, default: () => [] },
  /** 当前页（v-model） */
  modelValue: { type: Number, default: 0 },
  /** 唯一键字段名 */
  itemKey: { type: String, default: 'id' },
  /** 轨道高度（px）。不传就由 CSS 决定 —— 但页是绝对定位，通常必须给 */
  height: { type: Number, default: 0 },
  /** 只渲染当前页前后各几张（省 DOM） */
  windowRadius: { type: Number, default: 2 },
  /** 离中心一整页时缩到 1 - peekScale */
  peekScale: { type: Number, default: 0.14 },
  /** 离中心一整页时淡到 1 - peekFade */
  peekFade: { type: Number, default: 0.45 },
  /** 相邻页往中间收几 px：让用户一眼看出"左右还有卡" */
  peekInset: { type: Number, default: 8 },
  /** 手指在轨道上拖动时，左右边缘留出的"不接管"区域（px），给返回手势让路 */
  edgeGuard: { type: Number, default: 24 },
  enabled: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'update:progress', 'page-change', 'drag-start', 'drag-end'])

const VELOCITY_WINDOW = 60 // 只取松手前 60ms：窗口越长，抬手前那点减速越会被平均进去
const GLIDE_TAU = 760 // 时间常数（ms）：越大滑得越远，时长也跟着变长
const GLIDE_BOOST = 3.6 // 把手指速度放大成甩动速度（拖动本身仍是 1:1）
const GLIDE_VMAX = 15 // 初速度上限，避免一甩飞到底
const GLIDE_MIN_MS = 420
const SNAP_MS_BRAKE = 150 // 按停之后自己拖一小段再松手：要"立刻贴齐"
const SNAP_MS_GLIDE = 220 // 远距离惯性滑完之后贴齐：慢一点才自然

const stageW = ref(375)
const scrollX = ref(0)
const animating = ref(false)
const inst = getCurrentInstance()

let flingToken = 0
let lastTickAt = 0
let touchBraked = false
let startX = 0
let startY = 0
let startScroll = 0
let axisLocked = ''
let lastClientX = 0
let dragging = false
let samples = []
let rafId = 0

const n = computed(() => props.items.length)
const maxScroll = computed(() => Math.max(0, (n.value - 1) * stageW.value))
const floatIndex = computed(() => scrollX.value / Math.max(1, stageW.value))
const activeIndex = computed(() => {
  const i = Math.round(floatIndex.value)
  return Math.max(0, Math.min(n.value - 1, i))
})

const windowItems = computed(() => {
  const total = n.value
  if (!total) return []
  const from = Math.max(0, activeIndex.value - props.windowRadius)
  const to = Math.min(total - 1, activeIndex.value + props.windowRadius)
  const list = []
  for (let i = from; i <= to; i += 1) {
    const item = props.items[i]
    list.push({ i, item, key: `${item?.[props.itemKey] ?? i}` })
  }
  return list
})

function r2(v) {
  return Math.round(v * 100) / 100
}

function pageStyleAt(i) {
  const w = Math.max(1, stageW.value)
  const away = Math.abs(i * w - scrollX.value) / w
  // 太远的页直接不画：38 个合成层一起做 scale 会掉帧
  if (away > 1.6) return { display: 'none' }
  const d = Math.min(1, away)
  const scale = 1 - props.peekScale * d
  const opacity = 1 - props.peekFade * d
  // 相邻页往中间收一点，露出边缘，暗示"还能滑"
  const inset = props.peekInset * d * (i < floatIndex.value ? 1 : -1)
  return {
    width: `${Math.round(w)}px`,
    transform: `translate3d(${r2(i * w + inset)}px, 0, 0) scale(${r2(scale)})`,
    opacity: `${r2(opacity)}`,
    zIndex: away < 0.5 ? 2 : 1,
  }
}

const trackStyle = computed(() => ({
  transform: `translate3d(${r2(-scrollX.value)}px, 0, 0)`,
}))

const trackHeightStyle = computed(() => (props.height > 0 ? { height: `${props.height}px` } : null))

/* ----------------------------- 手势与惯性 ----------------------------- */

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

function rafTick(fn) {
  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(fn)
    return
  }
  rafId = setTimeout(fn, 16)
}

function cancelTick() {
  if (!rafId) return
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
  else clearTimeout(rafId)
  rafId = 0
}

function pushSample(x) {
  const t = nowMs()
  samples.push({ x, t })
  while (samples.length > 2 && t - samples[0].t > VELOCITY_WINDOW) samples.shift()
}

function releaseVelocity() {
  const t = nowMs()
  const recent = samples.filter((s) => t - s.t <= 120)
  if (recent.length < 2) return 0
  const first = recent[0]
  const last = recent[recent.length - 1]
  const dt = last.t - first.t
  if (dt <= 0) return 0
  return (last.x - first.x) / dt
}

/** 滑行中按下：立刻冻住，并把这次按下当成新的拖拽起点 */
function brake() {
  flingToken += 1
  cancelTick()
  animating.value = false
  lastTickAt = 0
  samples = []
}

function clampScroll(v) {
  // 到头了给一点橡皮筋，松手会被吸附拉回
  if (v > 0) return v * 0.35
  if (v < -maxScroll.value) return -maxScroll.value + (v + maxScroll.value) * 0.35
  return v
}

function syncPage() {
  const next = activeIndex.value
  if (next === props.modelValue) return
  emit('update:modelValue', next)
  emit('page-change', next)
}

function emitProgress() {
  emit('update:progress', floatIndex.value)
}

function onTouchStart(e) {
  if (!props.enabled) return
  const t = e.touches?.[0] || e.changedTouches?.[0]
  if (!t) return
  const rect = e.currentTarget?.getBoundingClientRect?.()
  if (rect && (t.clientX - rect.left < props.edgeGuard)) return // 左缘给系统返回手势
  // 后台标签页 rAF 会被暂停，动画停在半路；这里自愈
  if (animating.value && nowMs() - lastTickAt > 400) {
    animating.value = false
    scrollX.value = activeIndex.value * stageW.value
  }
  const wasAnimating = animating.value
  if (wasAnimating) brake()
  touchBraked = wasAnimating
  cancelTick()
  dragging = true
  axisLocked = ''
  startX = t.clientX
  startY = t.clientY
  lastClientX = t.clientX
  startScroll = scrollX.value
  samples = []
  pushSample(t.clientX)
  emit('drag-start')
}

function onTouchMove(e) {
  if (!dragging || !props.enabled) return
  const t = e.touches?.[0] || e.changedTouches?.[0]
  if (!t) return
  const dx = t.clientX - startX
  const dy = t.clientY - startY
  if (!axisLocked) {
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
    axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (axisLocked === 'y') {
      dragging = false
      return
    }
  }
  if (axisLocked !== 'x') return
  lastClientX = t.clientX
  pushSample(t.clientX)
  scrollX.value = clampScroll(startScroll - dx)
  emitProgress()
  syncPage()
}

function onTouchEnd() {
  if (!dragging || !props.enabled) return
  dragging = false
  const v = releaseVelocity()
  emit('drag-end')
  if (touchBraked) touchBraked = false
  startGlide(-v)
}

/**
 * 松手后的滑行：用速度直接决定距离，easeOutCubic 让起手速度等于松手速度。
 * 结束时一定 snapNearest()，所以不会停在两张卡中间。
 */
function startGlide(v0) {
  const speed = Math.abs(v0)
  if (speed < 0.05) {
    snapNearest(touchBraked ? SNAP_MS_BRAKE : SNAP_MS_GLIDE)
    return
  }
  const vTrack = Math.max(-GLIDE_VMAX, Math.min(GLIDE_VMAX, v0 * GLIDE_BOOST))
  const snapMs = touchBraked ? SNAP_MS_BRAKE : SNAP_MS_GLIDE
  const want = scrollX.value + vTrack * GLIDE_TAU
  const target = Math.max(-maxScroll.value, Math.min(0, want))
  const dist = Math.abs(target - scrollX.value)
  if (dist < 1) {
    snapNearest(snapMs)
    return
  }
  const ms = Math.max(GLIDE_MIN_MS, (dist / Math.abs(vTrack)) * 3)
  animateTo(target, vTrack, ms, () => snapNearest(SNAP_MS_GLIDE))
}

function snapNearest(ms = SNAP_MS_GLIDE) {
  const w = Math.max(1, stageW.value)
  const page = Math.round(scrollX.value / w)
  const target = Math.max(-maxScroll.value, Math.min(0, page * w))
  animateTo(target, 0, ms)
}

function animateTo(target, v = 0, forceMs = 0, onDone = null) {
  const from = scrollX.value
  const dist = Math.abs(target - from)
  if (dist < 0.6) {
    scrollX.value = target
    emitProgress()
    syncPage()
    animating.value = false
    if (onDone) onDone()
    return
  }
  const w = Math.max(1, stageW.value)
  const speed = Math.max(0.9, Math.abs(v))
  const ms = forceMs || Math.max(180, Math.min(900, (dist / speed) * 1.15))
  const token = ++flingToken
  const t0 = nowMs()
  animating.value = true
  const tick = () => {
    if (token !== flingToken) return
    const p = Math.min(1, (nowMs() - t0) / ms)
    const eased = 1 - Math.pow(1 - p, 3)
    const x = from + (target - from) * eased
    scrollX.value = x
    emitProgress()
    syncPage()
    lastTickAt = nowMs()
    if (p < 1) {
      rafTick(tick)
      return
    }
    scrollX.value = target
    emitProgress()
    syncPage()
    animating.value = false
    if (onDone) onDone()
  }
  tick()
}

/** 跳到第 i 页（点标签 / 点预览卡） */
function goTo(i) {
  const total = n.value
  if (!total) return
  const target = Math.max(0, Math.min(total - 1, Math.round(i)))
  const w = Math.max(1, stageW.value)
  animating.value = true
  animateTo(-target * w, 0, 0)
  emit('update:modelValue', target)
  emit('page-change', target)
}

function measure() {
  const el = inst?.proxy?.$el
  const rect = el?.getBoundingClientRect?.()
  if (rect && rect.width) stageW.value = rect.width
  scrollX.value = activeIndex.value * Math.max(1, stageW.value)
}

onMounted(() => {
  nextTick(() => {
    measure()
    emit('update:modelValue', activeIndex.value)
  })
})

onBeforeUnmount(() => {
  cancelTick()
})

watch(
  () => props.modelValue,
  (v) => {
    const w = Math.max(1, stageW.value)
    const want = Math.max(0, Math.min(n.value - 1, Math.round(Number(v) || 0)))
    if (Math.abs(scrollX.value + want * w) > 1) scrollX.value = -want * w
    emitProgress()
  },
)

watch(n, () => {
  nextTick(() => {
    measure()
    emitProgress()
  })
})

defineExpose({ goTo, snapNearest, measure, startDrag: onTouchStart, moveDrag: onTouchMove, endDrag: onTouchEnd, stop: brake })
</script>

<style scoped>
.gp {
  position: relative;
  flex: none;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}

.gp__track {
  position: relative;
  width: 100%;
  min-height: 0;
  will-change: transform;
  backface-visibility: hidden;
}

.gp__page {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  transform-origin: center;
  will-change: transform, opacity;
}
</style>
