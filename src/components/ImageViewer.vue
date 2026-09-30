<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'

/**
 * 大图查看器：黑底全屏 + 手势缩放（fullscreen / inline 两种形态）
 *
 * 为什么不用 uni.previewImage（实测，不是推测）：
 *   · 小程序端它就是 wx.previewImage、App 端是原生查看器，观感与需求一致、也都支持缩放；
 *   · 但 H5 端 @dcloudio/uni-h5 的实现只是一个 Swiper 浮层（uni-h5.es.js 里的 ImagePreview），
 *     只有左右滑动切图，没有任何缩放逻辑 —— 「手势缩放」在 H5 上落不了地。
 *   本应用三端都要发，所以这里自建一套，三端表现一致。
 *
 * 缩放 / 平移交给 movable-view（平台自带实现）：
 *   · 小程序端与 App 端是原生组件；
 *   · H5 端 @dcloudio/uni-h5 也完整实现了它（含双指捏合，见 useMovableAreaState），
 *     而且 touch 与 mouse 都监听 —— 桌面浏览器也能拖动。
 *   movable-view 不提供点按手势，所以下面自己补三条：单击（1× 时关闭）、双击（放大 / 还原）、
 *   长按（按住 450ms 立刻弹自绘的「保存到相册」底部弹层，仅 App / 小程序，见 handleTouchStart / handleLongPress）。
 *   这些 touch 监听是只读的（不 preventDefault），不会和 movable-view 自己的手势抢事件。
 *
 * 形态：
 *   · fullscreen（默认）：固定铺满视口的黑底浮层，✕ / 单击关闭，多图带左右切换与计数；
 *   · inline：不脱离文档流的可缩放舞台，尺寸交给调用方
 *     （工单汇总 / 周统计卡片里的图片区，见 index.vue 的 .viewer-stage）。
 */
const props = defineProps({
  // 全屏形态的开关（v-model）。内嵌形态忽略它 —— 舞台随卡片一起渲染。
  modelValue: { type: Boolean, default: false },
  // 已过 resolveAssetUrl 的地址数组（后端给的是 /files、/thumbs 这类相对路径）
  urls: { type: Array, default: () => [] },
  // 初始展示第几张
  current: { type: Number, default: 0 },
  mode: { type: String, default: 'fullscreen' }, // 'fullscreen' | 'inline'
  minScale: { type: Number, default: 1 },
  maxScale: { type: Number, default: 4 },
  // 双击放大到的倍数（不超过 maxScale）
  doubleTapScale: { type: Number, default: 2.5 },
})

const emit = defineEmits(['update:modelValue', 'change'])

const isInline = computed(() => props.mode === 'inline')
const visible = computed(() => (isInline.value ? true : props.modelValue))
const list = computed(() => (Array.isArray(props.urls) ? props.urls.filter(Boolean) : []))
const multiple = computed(() => !isInline.value && list.value.length > 1)

const index = ref(0)
// scale 是「交给 movable-view 的目标倍数」（双击与复位时改它）；
// currentScale 是手捏过程中真实的倍数（由 @scale 回传）。两者用途不同不能合并 ——
// 手捏时不回写 scale，否则 prop 每帧变化会和 movable-view 自身的缩放互相顶。
const scale = ref(props.minScale)
const currentScale = ref(props.minScale)
const zoomed = ref(false)

// 保存层（自绘底部弹层，仅 App / 小程序；H5 端整块不编译）
const sheetVisible = ref(false)
const saving = ref(false)

const activeUrl = computed(() => list.value[index.value] || '')

function clampIndex(value) {
  if (!list.value.length) return 0
  const next = Number(value) || 0
  return Math.max(0, Math.min(list.value.length - 1, next))
}

function cancelPendingClose() {
  if (pendingCloseTimer) {
    clearTimeout(pendingCloseTimer)
    pendingCloseTimer = null
  }
}

function resetScale() {
  scale.value = props.minScale
  currentScale.value = props.minScale
  zoomed.value = false
  cancelPendingClose()
  cancelLongPress()
  viewOrigin = null
}

// ===== 单击 / 双击 / 长按（movable-view 不提供这些手势，自己补）=====
const TAP_MAX_MOVE = 12        // px：位移超过它就算拖动，不算点按
const TAP_MAX_DURATION = 320   // ms：按下超过它就不再判点按（长按计时见 handleTouchStart）
const LONG_PRESS_MS = 450      // ms：按住 450ms 立刻弹保存层（按下即计时，抬手不再判；见 handleTouchStart）
const DOUBLE_TAP_WINDOW = 300  // ms：两次点按的间隔上限，也是单击关闭的等待时长
const TOUCH_DEDUPE_MS = 50     // ms：同一次触摸冒泡到多层时的去重窗口

let lastTouchAt = 0
let startPoint = null
let startAt = 0
let lastTapAt = 0
let pendingCloseTimer = null
// 本次触摸里出现过双指（缩放）就一定不是长按：捏合收尾是两指先后抬起，
// 只按「按住不动」判的话，最后抬起那一下很容易被当成「长按保存」。
let pinched = false
// 长按计时器：touchstart 起；touchmove / movable-view 的 change / @scale / 多指 都会取消
let longPressTimer = null
// 本次触摸里 movable-view 收到的首个 change 坐标（拖动基线，见 handleViewChange）
let viewOrigin = null

function touchPoint(event) {
  const touches = event?.touches?.length ? event.touches : event?.changedTouches
  const touch = touches && touches.length ? touches[0] : null
  if (!touch) return null

  // H5 只有 clientX/clientY；小程序两端都给了 pageX/pageY，取可用的一组
  const x = typeof touch.clientX === 'number' ? touch.clientX : touch.pageX
  const y = typeof touch.clientY === 'number' ? touch.clientY : touch.pageY
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return { x, y }
}

function handleTouchStart(event) {
  const now = Date.now()
  const touches = event?.touches || []

  // 多指优先判：捏合这一下必然不是长按，还要把已记下的起点清掉 ——
  // 否则缩放收尾的 touchend 会拿第一根手指的起点去比，误判成长按。
  if (touches.length > 1) {
    pinched = true
    cancelLongPress()
    startPoint = null
    startAt = 0
    return
  }

  // 同一次触摸会冒泡到多层（页面根 / movable-area / movable-view），第二层几乎同一时刻到达
  if (now - lastTouchAt < TOUCH_DEDUPE_MS) return
  lastTouchAt = now

  const point = touchPoint(event)
  if (!point) return
  pinched = false
  startPoint = point
  startAt = now
  viewOrigin = null

  // 长按计时从「按下」就开跑：按住 450ms 当场弹保存层，不用等抬手。
  // 取消点见 cancelLongPress / handleTouchMove / handleViewChange / handleScale。
  cancelLongPress()
  longPressTimer = setTimeout(handleLongPress, LONG_PRESS_MS)
}

// 长按计时器：按下就起（见 handleTouchStart），任何「手指动了 / 多指 / 缩放」都取消。
function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

// 位移取消的第一手：能在本层收到 touchmove 就用它。
function handleTouchMove(event) {
  if (!longPressTimer || !startPoint) return
  const point = touchPoint(event)
  if (!point) return
  if (
    Math.abs(point.x - startPoint.x) > TAP_MAX_MOVE ||
    Math.abs(point.y - startPoint.y) > TAP_MAX_MOVE
  ) {
    cancelLongPress()
  }
}

// 位移取消的第二手（小程序端 movable-view 拖动时的 touchmove 不一定冒泡到这里，得靠它兜底）：
// 拖动 / 缩放真正产生位移时 movable-view 一定会回调 change，detail.x/y 是它自身坐标。
// 先记首个 change 当基线再比 —— 直接看坐标绝对值不行：手指微抖会让它抖 1~2px，
// 那种抖动不该把长按掐掉。
function handleViewChange(event) {
  if (!longPressTimer || !startAt) return
  const x = Number(event?.detail?.x)
  const y = Number(event?.detail?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  if (!viewOrigin) {
    viewOrigin = { x, y }
    return
  }
  if (
    Math.abs(x - viewOrigin.x) > TAP_MAX_MOVE ||
    Math.abs(y - viewOrigin.y) > TAP_MAX_MOVE
  ) {
    cancelLongPress()
  }
}

function toggleScale() {
  if (zoomed.value) {
    scale.value = props.minScale
    zoomed.value = false
    return
  }

  scale.value = Math.min(props.doubleTapScale, props.maxScale)
  zoomed.value = true
}

function handleTouchEnd(event) {
  cancelLongPress()
  viewOrigin = null
  const now = Date.now()
  const point = touchPoint(event)
  const point0 = startPoint
  const started = startAt
  const wasPinched = pinched
  startPoint = null
  startAt = 0
  pinched = false

  if (!point || !point0 || !started) return
  if (Math.abs(point.x - point0.x) > TAP_MAX_MOVE || Math.abs(point.y - point0.y) > TAP_MAX_MOVE) return

  const duration = now - started

  // 长按兜底：正常路径下保存层已经由 handleTouchStart 起的计时器在按住 450ms 时弹出来了，
  // 走到这里只可能是计时器被系统饿死 —— 补一次，别让长按「没反应」。
  if (duration > TAP_MAX_DURATION) {
    if (!wasPinched && duration >= LONG_PRESS_MS && !sheetVisible.value) handleLongPress()
    return
  }

  // 双击：放大到 doubleTapScale / 还原
  if (now - lastTapAt < DOUBLE_TAP_WINDOW) {
    lastTapAt = 0
    cancelPendingClose()
    toggleScale()
    return
  }

  lastTapAt = now

  // 单击：只关全屏形态，且只在 1× 时关 —— 放大状态下单击留给「双击还原」，避免误关。
  // 必须等过双击窗口再关：立刻关的话第一次点按就把浮层关掉了，双击永远等不到第二次。
  if (isInline.value) return
  cancelPendingClose()
  pendingCloseTimer = setTimeout(() => {
    pendingCloseTimer = null
    if (currentScale.value > props.minScale + 0.01) return
    close()
  }, DOUBLE_TAP_WINDOW)
}

function handleScale(event) {
  const next = Number(event?.detail?.scale)
  if (!Number.isFinite(next)) return

  // 双指缩放的每一次回传都算「动过」：立刻取消长按计时，并记下 pinched，
  // 免得捏合收尾的那次 touchend 被兜底判成长按（见 handleTouchEnd）。
  cancelLongPress()
  pinched = true

  currentScale.value = next
  zoomed.value = next > props.minScale + 0.01
}

// ===== 长按保存到相册（App / 小程序；H5 不做，理由见下）=====
/**
 * 长按（按住 450ms）的反馈：先弹自绘保存层，选「保存到相册」再落盘。
 *
 * · 为什么不给 H5 做：浏览器自带长按 / 右键菜单（移动端「存储到照片」、桌面「图片另存为」），
 *   而 uni.saveImageToPhotosAlbum 在 H5 端是个空实现（uni-h5.es.js 用 createUnsupportedAsyncApi
 *   兜的，调用只会走 fail），自己再做一套只会和浏览器自己的菜单打架。
 * · 为什么保存前要 downloadFile：相册接口只吃本地文件路径（官方文档明确「不支持网络图片路径」），
 *   网络图必须先落成临时文件；小程序端这一步还要求图片域名在 downloadFile 合法域名里，
 *   否则真机保存必失败（见 api/config.js 顶部与 迁移说明 6.2）。
 */
function handleLongPress() {
  // #ifdef H5
  return
  // #endif

  // #ifndef H5
  // 计时器到点（手指还按着）→ 当场弹层；重复触发由「已在弹层里 / 正在保存」挡掉。
  longPressTimer = null
  if (sheetVisible.value || saving.value) return

  const url = activeUrl.value
  if (!url) return

  cancelPendingClose()
  sheetVisible.value = true
  // 弹层出现时轻震一下：这就是「长按有反馈」的那一下（H5 已被上面的 #ifdef 拦掉）
  uni.vibrateShort({ type: 'light' })
  // #endif
}

// #ifndef H5
function saveToAlbum(url) {
  if (saving.value) return
  saving.value = true

  // 已经是本地路径（比如 chooseImage 给的临时文件）就不必再下一遍
  if (!/^https?:/i.test(url)) {
    writeToAlbum(url)
    return
  }

  uni.downloadFile({
    url,
    success: (res) => {
      if (res.statusCode && res.statusCode !== 200) {
        handleSaveFail({ errMsg: `downloadFile:fail http ${res.statusCode}` })
        return
      }
      writeToAlbum(res.tempFilePath)
    },
    fail: (err) => handleSaveFail(err),
  })
}

function writeToAlbum(filePath) {
  uni.saveImageToPhotosAlbum({
    filePath,
    success: () => {
      saving.value = false
      sheetVisible.value = false
      uni.showToast({ title: '已保存到相册', icon: 'success' })
    },
    fail: (err) => handleSaveFail(err),
  })
}

function handleSaveFail(err) {
  saving.value = false
  const msg = String(err?.errMsg || err?.message || '')

  // 用户自己取消的（关掉权限框等）不打扰
  if (/cancel/i.test(msg)) return

  if (/auth|authoriz|permission|deny|denied/i.test(msg)) {
    // #ifdef MP-WEIXIN
    uni.showModal({
      title: '还没有相册权限',
      content: '请在设置里打开「保存到相册」后重试',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) uni.openSetting()
      },
    })
    return
    // #endif

    // #ifndef MP-WEIXIN
    // App 端没有「跳到本应用设置页」的跨端 API（openSetting 是小程序专有），
    // 只能文案引导用户去系统设置里开权限。
    uni.showModal({
      title: '还没有相册权限',
      content: '请在系统设置里允许本应用访问相册后重试',
      showCancel: false,
    })
    return
    // #endif
  }

  uni.showModal({
    title: '保存失败',
    content: '请稍后重试；若一直失败，确认图片域名已配进 downloadFile 合法域名',
    showCancel: false,
  })
}
// #endif

function step(offset) {
  if (!multiple.value) return
  const total = list.value.length
  index.value = (index.value + offset + total) % total
  emit('change', index.value)
}

// touchcancel 只清状态、不判定手势：被系统打断的那一下不该被解释成长按
function handleTouchCancel() {
  cancelLongPress()
  viewOrigin = null
  startPoint = null
  startAt = 0
  pinched = false
}

function close() {
  cancelPendingClose()
  cancelLongPress()
  sheetVisible.value = false
  emit('update:modelValue', false)
}

// 打开、切图、外部 current 变化时都回到 1×；:key 重挂 movable-view 让平移一并归零
watch(() => props.current, (value) => { index.value = clampIndex(value) }, { immediate: true })
watch(list, () => { index.value = clampIndex(index.value) })
watch(index, () => resetScale())
watch(() => props.modelValue, (open) => { if (open) resetScale() })

onUnmounted(() => {
  cancelPendingClose()
  cancelLongPress()
})
</script>

<template>
  <!-- 全屏形态：固定铺满视口的黑底浮层。
       ⚠️ 底色刻意写死 #000：看图的观感与主题无关（原生查看器也都是纯黑），浅色主题下同样黑底。 -->
  <view v-if="visible" class="iv" :class="isInline ? 'iv--inline' : 'iv--full'">
    <!-- 下层：接住落在图片之外的点击（点空白关闭），并拦住背景滚动。
         ⚠️ 不把 @touchmove.stop 挂到 movable-area 的祖先上 —— 小程序端 catchtouchmove
            对 movable-view 拖动的影响没有保证，这里只挂在同级的下层节点。 -->
    <view v-if="!isInline" class="iv__backdrop" @click="close" @touchmove.stop></view>

    <movable-area
      class="iv__area"
      :scale-area="true"
      @touchmove="handleTouchMove"
      @touchstart="handleTouchStart"
      @touchend="handleTouchEnd"
      @touchcancel="handleTouchCancel"
    >
      <!-- :key 让「切图 / 重新打开」时重挂一次：平移与缩放随之归零，
           不用手工回写 translate（理由见文件头）。 -->
      <movable-view
        v-if="activeUrl"
        :key="`${index}-${activeUrl}`"
        class="iv__view"
        direction="all"
        :scale="true"
        :scale-min="minScale"
        :scale-max="maxScale"
        :scale-value="scale"
        :out-of-bounds="false"
        @change="handleViewChange"
        @touchmove="handleTouchMove"
        @scale="handleScale"
        @touchstart="handleTouchStart"
        @touchend="handleTouchEnd"
        @touchcancel="handleTouchCancel"
      >
        <!-- touch 监听同时挂在 movable-area 与 movable-view 上：两端冒泡行为不同，
             哪一层收到都算数（重复的那次由 TOUCH_DEDUPE_MS 丢掉）。
             挪到根节点会额外收到「✕ / 左右切换」上的点击，所以那两处自己 catch 掉。 -->
        <image class="iv__img" :src="activeUrl" mode="aspectFit" alt="单据大图" />
      </movable-view>
    </movable-area>

    <template v-if="!isInline">
      <view
        v-if="multiple"
        class="iv__nav iv__nav--prev"
        aria-label="上一张"
        @touchstart.stop
        @touchend.stop
        @click.stop="step(-1)"
      >
        <text>‹</text>
      </view>

      <view
        v-if="multiple"
        class="iv__nav iv__nav--next"
        aria-label="下一张"
        @touchstart.stop
        @touchend.stop
        @click.stop="step(1)"
      >
        <text>›</text>
      </view>

      <view v-if="multiple" class="iv__counter">{{ index + 1 }} / {{ list.length }}</view>

      <view
        class="iv__close"
        aria-label="关闭预览"
        @touchstart.stop
        @touchend.stop
        @click.stop="close"
      >
        <wd-icon name="close" size="18px" />
      </view>
    </template>

    <!-- 长按保存层：替掉原生 uni.showActionSheet 那两块大白按钮，只给 App / 小程序。
         层级 z-index 96 —— 高过本组件 .iv(95)，低过 message-box(99) / toast(100)，见说明 5.6。
         必须 root-portal：inline 形态挂在 wd-popup(center) 里，而 .wd-popup--center 带
         translate3d，fixed 子元素会以它为包含块（说明 4.2），不脱离组件树遮罩就只盖住卡片。
         弹出时机：按住 450ms 就弹（不再是「抬手才弹」），兜底见 handleTouchEnd。 -->
    <!-- #ifndef H5 -->
    <wd-popup
      v-model="sheetVisible"
      position="bottom"
      root-portal
      safe-area-inset-bottom
      z-index="96"
      :close-on-click-modal="!saving"
      custom-style="background-color: var(--ui-surface); border-radius: 32rpx 32rpx 0 0;"
    >
      <view class="iv-sheet">
        <view class="iv-sheet__head">
          <image class="iv-sheet__thumb" :src="activeUrl" mode="aspectFill" />
          <view class="iv-sheet__meta">
            <text class="iv-sheet__title">保存图片</text>
            <text class="iv-sheet__sub">将当前图片存入系统相册</text>
          </view>
        </view>

        <view
          class="iv-sheet__action"
          :class="{ 'is-busy': saving }"
          @click="saveToAlbum(activeUrl)"
        >
          <wd-loading v-if="saving" size="20" />
          <wd-icon v-else name="download" size="18px" />
          <text>{{ saving ? '保存中…' : '保存到相册' }}</text>
        </view>

        <view class="iv-sheet__cancel" @click="sheetVisible = false">取消</view>
      </view>
    </wd-popup>
    <!-- #endif -->
  </view>
</template>

<style lang="scss" scoped>
/* 全屏形态：固定铺满视口。
   能铺满的前提是「从页面根到这里没有 transform 祖先」（UNIAPP迁移说明.md 4.2），
   所以本组件挂在页面根节点附近，不放进任何带位移动效的卡片里。 */
.iv {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  /* z-index 取 95：高于页面元素与 DropdownMenu 的浮层（90 / 91），
     低于 wot 的 message-box（99）与 toast（100）—— 同说明 5.6 的层级约定。 */
  z-index: 95;
  overflow: hidden;
  /* 刻意写死纯黑：看图的观感与主题无关（原生查看器也是纯黑），浅色主题下同样黑底 */
  background-color: #000;
  /* 只对 H5 有效：交给我们自己的手势，别再让浏览器做页面滚动 / 双指缩放 */
  touch-action: none;
}

/* 内嵌形态：留在文档流里，尺寸由调用方给（工单汇总 / 周统计的 .viewer-stage） */
.iv--inline {
  position: relative;
  width: 100%;
  height: 100%;
  z-index: auto;
  background-color: transparent;
  touch-action: pan-y;
}

.iv__backdrop {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}

.iv__area {
  position: relative;
  width: 100%;
  height: 100%;
}

/* movable-view 必须给显式宽高：小程序端不写就退化成 10px */
.iv__view {
  width: 100%;
  height: 100%;
}

.iv__img {
  display: block;
  width: 100%;
  height: 100%;
}

/* ===== 全屏形态的浮层控件（黑底上的白色半透明胶囊）===== */
.iv__close {
  position: absolute;
  top: calc(var(--status-bar-height, 0px) + 24rpx);
  right: 24rpx;
  z-index: 2;
  display: flex;
  width: 68rpx;
  height: 68rpx;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.18);
  color: #fff;
}

.iv__nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: flex;
  width: 72rpx;
  height: 72rpx;
  align-items: center;
  justify-content: center;
  /* 负 margin 做垂直居中，省掉 translateY，两端表现更稳 */
  margin-top: -36rpx;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 40rpx;
  line-height: 1;

  &--prev {
    left: 16rpx;
  }

  &--next {
    right: 16rpx;
  }
}

.iv__counter {
  position: absolute;
  bottom: 40rpx;
  left: 50%;
  z-index: 2;
  padding: 8rpx 24rpx;
  transform: translateX(-50%);
  border-radius: $ui-radius-pill;
  background-color: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 24rpx;
}

/* #ifndef H5 */
/* ===== 长按保存层（仅 App / 小程序，H5 端整块不编译）=====
   自绘一套替掉原生 actionSheet 的白块观感：配色全走 $ui-* 令牌，
   深色下是「黑底 + 逐层变亮」、浅色下是「浅灰底 + 白卡」，与页面其它弹层一致。 */
.iv-sheet {
  padding: 28rpx 28rpx 16rpx;
}

.iv-sheet__head {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 0 8rpx 24rpx;
}

/* 缩略图：让用户确认「存的是哪一张」 */
.iv-sheet__thumb {
  width: 96rpx;
  height: 96rpx;
  flex-shrink: 0;
  border: 1px solid $ui-border;
  border-radius: $ui-radius-md;
  background-color: $ui-surface-2;
}

.iv-sheet__meta {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}

.iv-sheet__title {
  color: $ui-text;
  font-size: 30rpx;
  font-weight: 600;
}

.iv-sheet__sub {
  color: $ui-text-3;
  font-size: 24rpx;
}

/* 两个操作块同一套尺寸：主操作走强调色淡填充，取消走中性填充 */
.iv-sheet__action,
.iv-sheet__cancel {
  display: flex;
  height: 104rpx;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  border-radius: $ui-radius-md;
  font-size: 30rpx;
  transition: opacity $ui-dur $ui-ease, background-color $ui-dur $ui-ease;
}

.iv-sheet__action {
  background-color: $ui-accent-soft;
  color: $ui-accent-text;
}

/* 保存中：文案换成「保存中…」，整体压暗一点，表示这次点击已受理 */
.iv-sheet__action.is-busy {
  opacity: 0.7;
}

.iv-sheet__action:active,
.iv-sheet__cancel:active {
  opacity: 0.86;
}

.iv-sheet__cancel {
  margin-top: 16rpx;
  background-color: $ui-surface-2;
  color: $ui-text-2;
}
/* #endif */
</style>