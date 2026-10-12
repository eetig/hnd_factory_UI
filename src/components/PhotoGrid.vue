<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue'

/**
 * 相册式图片网格。
 *
 * <p>交互对齐手机相册（使用方 2026-10-10 给的参照）：
 * <ul>
 *   <li>轻击缩略图 → 调平台自带的图片查看器（可左右滑、可缩放、可长按保存）；</li>
 *   <li>右下角圆圈 → 轻击勾选 / 取消；</li>
 *   <li>手指按住圆圈左右滑 → 连续多选（勾选后出现批量删除栏）。</li>
 * </ul>
 *
 * <p>三个调用点：图片解析页（本地临时文件 + H5 blob）、储罐液位新增表单（临时路径，还没上传）、
 * 储罐液位图据弹层（后端相对路径，调用点自己 resolve 好再传进来）。
 *
 * <p>items 的元素可以是字符串（就是 url），也可以是对象：
 * key = item.key ?? item.imageId ?? item.id ?? item.url（缺省退回下标）；
 * url = item.url；thumb = item.thumb ?? item.url。
 */
const props = defineProps({
  items: { type: Array, required: true },
  // false = 只读：没有圆圈、没有删除栏，只剩轻击看大图（图据弹层给没有编辑权限的账号）
  selectable: { type: Boolean, default: true },
  // 只禁「勾选 + 删除」，**不禁预览** —— 识别中也要能对着原图核对
  disabled: { type: Boolean, default: false },
  deleteText: { type: String, default: '删除' },
  deleteBusy: { type: Boolean, default: false },
})

const emit = defineEmits(['delete-selected'])

// ------------------------------------------------------------------
// 取 key / url
// ------------------------------------------------------------------

function keyOf(item, index) {
  if (typeof item === 'string') return item || `#${index}`
  if (!item) return `#${index}`

  const raw = item.key ?? item.imageId ?? item.id ?? item.url
  return raw === undefined || raw === null || raw === '' ? `#${index}` : String(raw)
}

function urlOf(item) {
  return typeof item === 'string' ? item : item?.url || ''
}

function thumbOf(item) {
  return typeof item === 'string' ? item : item?.thumb || item?.url || ''
}

// 勾选状态存的是 key 而不是下标：删掉一张之后下标会整体前移，存下标会串位
const keys = computed(() => props.items.map((item, index) => keyOf(item, index)))

// ------------------------------------------------------------------
// 缩略图三级降级：thumb → 原图 → 隐藏
//
// 改造前这里是 getAttribute('src') / style.display —— 纯 DOM 写法，小程序端不成立，
// 改成按 key 记阶段，全部走状态。
// ------------------------------------------------------------------

const failed = ref({})

function srcOf(index) {
  const item = props.items[index]
  const stage = failed.value[keys.value[index]] || 0
  if (stage >= 2) return ''

  const thumb = thumbOf(item)
  const url = urlOf(item)
  return stage === 1 ? url || thumb : thumb || url
}

function isHidden(index) {
  return (failed.value[keys.value[index]] || 0) >= 2
}

function onImageError(index) {
  const key = keys.value[index]
  const stage = failed.value[key] || 0
  if (stage >= 2) return

  const thumb = thumbOf(props.items[index])
  const url = urlOf(props.items[index])
  // 缩略图与原图是同一个地址 = 没有第二级可退，直接隐藏，露出底座色
  const next = stage === 0 && url && url !== thumb ? 1 : 2
  failed.value = { ...failed.value, [key]: next }
}

// ------------------------------------------------------------------
// 勾选与批量删除
// ------------------------------------------------------------------

const selected = ref([])
const selectedSet = computed(() => new Set(selected.value))

function isSelected(index) {
  return selectedSet.value.has(keys.value[index])
}

function toggle(index) {
  const key = keys.value[index]
  if (!key) return

  selected.value = selectedSet.value.has(key)
    ? selected.value.filter((existing) => existing !== key)
    : [...selected.value, key]
}

function clearSelection() {
  if (selected.value.length) selected.value = []
}

function emitDelete() {
  if (props.disabled || props.deleteBusy || !selected.value.length) return

  const chosen = new Set(selected.value)
  // 传回**原始 item**（字符串就还是字符串，对象就是原对象），删除方式各调用点自己知道
  emit(
    'delete-selected',
    props.items.filter((item, index) => chosen.has(keyOf(item, index))),
  )
}

// 列表被外部换掉（清空、删完、重新拉取）后，把已经不存在的那几个 key 剔掉
watch(
  () => props.items,
  (list) => {
    if (!selected.value.length) return

    const valid = new Set((list || []).map((item, index) => keyOf(item, index)))
    const next = selected.value.filter((key) => valid.has(key))
    if (next.length !== selected.value.length) selected.value = next
  },
)

watch(
  () => props.selectable,
  (on) => {
    if (!on) clearSelection()
  },
)

defineExpose({ clearSelection })

// ------------------------------------------------------------------
// 大图预览
// ------------------------------------------------------------------

function openPreview(index) {
  // 拖选结束时浏览器可能把 click 补到松手那一格上，别让它顺手把大图打开
  if (takeClick()) return

  const urls = props.items.map((item) => urlOf(item)).filter(Boolean)
  const current = urlOf(props.items[index])
  if (!urls.length || !current) return

  // current 传**地址字符串**：小程序端只保证链接形式，H5 端内部是 urls.indexOf(current)
  uni.previewImage({ urls, current })
}

// ------------------------------------------------------------------
// 按住圆圈滑动连选
//
// 两个关键设计：
//  1. 「置值」而不是「取反」—— 起手是空圈就整段只勾、是实心圈就整段只取消。
//     于是手指来回蹭同一格不会反复切换，也天然不需要记「走过哪些格」。
//  2. 格子位置按**文档坐标**取（rect + 当时的 scrollTop）—— 文档坐标不随页面滚动漂移，
//     手势中途万一页面被滚了也不会串行。
// ------------------------------------------------------------------

const instance = getCurrentInstance()

const SWEEP_MIN_PX = 6 // 超过这个位移才算拖选，否则当轻击（同 NavDrawer 的 DRAWER_AXIS_MIN）

let sweep = null // 普通对象，刻意不进响应式

// 触摸端已经在 touchend 里处理过勾选，浏览器随后还会补一个 click（H5 / App 端）——
// 靠这个开关**一次性**吞掉紧跟的那一个，否则轻击圆圈会被处理两次、等于没点。
//
// ⚠️ 不能只按时间窗吞（读完仍留在"生效中"）：那样「点一下圆圈、紧接着点缩略图看大图」
//    会被一起吞掉，而这两个动作本来就挨在一起。读到就清零，所以只吞得掉一个。
let swallowClickUntil = 0

function takeClick() {
  if (!swallowClickUntil || Date.now() > swallowClickUntil) return false
  swallowClickUntil = 0
  return true
}

function pointOf(event) {
  const touch = event?.touches?.[0] || event?.changedTouches?.[0]
  if (!touch) return null

  return Number.isFinite(touch.pageX)
    ? { x: touch.pageX, y: touch.pageY }
    : { x: touch.clientX, y: touch.clientY + (sweep?.scrollTop0 || 0) }
}

function measure() {
  try {
    // .in() 不能省：小程序端页面级查询看不见自定义组件内部的节点
    const query = uni.createSelectorQuery().in(instance.proxy)
    query.selectAll('.pg__cell').boundingClientRect()
    query.selectViewport().scrollOffset() // 与上面同一次 exec，保证两者同一帧
    query.exec((res) => {
      if (!sweep) return // 手势已经结束，白量

      const rects = Array.isArray(res?.[0]) ? res[0] : []
      if (!rects.length) return // 量不到 → 退化成单格勾选，见 hitTest

      sweep.scrollTop0 = Number(res?.[1]?.scrollTop) || 0
      sweep.rects = rects.map((rect) => ({
        left: rect.left,
        right: rect.right,
        width: rect.width,
        top: rect.top + sweep.scrollTop0,
        bottom: rect.bottom + sweep.scrollTop0,
      }))
      // 行间距的一半：手指落在两行之间的缝里时，归属更近的那一行
      sweep.rowHalf =
        (rects.length > 3 ? Math.abs(rects[3].top - rects[0].top) : rects[0].height) / 2
    })
  } catch (error) {
    console.warn('[PhotoGrid] 量取格子位置失败，滑动连选退化为单格勾选', error)
  }
}

/**
 * 命中哪一格：先按「行带」筛，再取最近的一列。
 *
 * 不能严格判「点是否落在矩形内」—— 圆圈在格子右下角，横滑时手指的高度正压在两行中间，
 * 严格包含会一路落空。
 */
function hitTest(x, y) {
  if (!sweep?.rects.length) return -1

  let best = -1
  let bestDx = Infinity
  for (let i = 0; i < sweep.rects.length; i++) {
    const rect = sweep.rects[i]
    if (Math.abs(y - (rect.top + rect.bottom) / 2) > sweep.rowHalf) continue

    const dx = Math.abs(x - (rect.left + rect.right) / 2)
    if (dx <= rect.width / 2 + 6 && dx < bestDx) {
      best = i
      bestDx = dx
    }
  }
  return best
}

function setOne(index) {
  const key = keys.value[index]
  if (!key) return

  const on = selectedSet.value.has(key)
  if (on === sweep.paint) return // 已经是画笔值了，什么都不做 —— 幂等的关键

  selected.value = on
    ? selected.value.filter((existing) => existing !== key)
    : [...selected.value, key]
}

function beginSweep(event, index) {
  if (!props.selectable || props.disabled) return

  sweep = { index0: index, x0: 0, y0: 0, started: false, paint: false, rects: [], rowHalf: 0, scrollTop0: 0 }
  const point = pointOf(event)
  if (point) {
    sweep.x0 = point.x
    sweep.y0 = point.y
  }
  measure()
}

function moveSweep(event) {
  if (!sweep) return
  if (event?.preventDefault) event.preventDefault() // 小程序端事件对象是普通对象，没这个方法

  const point = pointOf(event)
  if (!point) return

  if (!sweep.started) {
    if (Math.abs(point.x - sweep.x0) < SWEEP_MIN_PX && Math.abs(point.y - sweep.y0) < SWEEP_MIN_PX) {
      return
    }
    sweep.started = true
    sweep.paint = !isSelected(sweep.index0) // 画笔值 = 起手格的相反态
    setOne(sweep.index0) // 起手格立刻给反馈
  }

  const index = hitTest(point.x, point.y)
  if (index >= 0) setOne(index)
}

function endSweep() {
  if (!sweep) return

  const { started, index0 } = sweep
  sweep = null

  // 拖选（位移过了阈值）：勾选已经沿途做完了，只把随后那个 click 吞掉
  if (started) {
    swallowClickUntil = Date.now() + 400
    return
  }

  // 位移没过阈值 = 轻击圆圈，在这里就把勾选定下来
  swallowClickUntil = Date.now() + 400
  toggle(index0)
}

function cancelSweep() {
  if (!sweep) return
  sweep = null
  // 系统打断（来电、切 App、浏览器抢去滚页面）不解释成轻击；
  // 真拖过就顺手把可能补发的 click 吞掉
  swallowClickUntil = Date.now() + 400
}

function onCircleClick(index) {
  // 触摸端刚在 touchend 里处理过，这个 click 是补发的，吞掉；
  // 没有触摸序列时（H5 桌面鼠标）就是正常的一次点击
  if (takeClick()) return
  toggle(index)
}
</script>

<template>
  <view class="pg">
    <view v-if="selectable && selected.length" class="pg__bar">
      <text class="pg__bar-text">已勾选 {{ selected.length }} 张</text>
      <view
        class="pg__bar-btn"
        :class="{ 'is-disabled': disabled, 'is-busy': deleteBusy }"
        @click="emitDelete"
      >
        <text>{{ deleteBusy ? '删除中…' : deleteText }}</text>
      </view>
    </view>

    <view class="pg__grid" @touchend="endSweep" @touchcancel="cancelSweep">
      <view v-for="(item, index) in items" :key="keys[index]" class="pg__cell" @click="openPreview(index)">
        <view class="pg__ratio">
          <image
            v-if="!isHidden(index)"
            class="pg__img"
            :src="srcOf(index)"
            mode="aspectFill"
            @error="onImageError(index)"
          />
        </view>

        <!--
          圆圈上的四个 .stop 一个都不能省，各管各的：
          touchstart.stop 只切那一个事件对象；click 是**独立于 touch 序列的另一个事件**
          （小程序端编译成 bindtap），只写 touchstart.stop 的话点圆圈会同时把大图也打开。
          click.stop 在小程序端编译成 catchtap、H5/App 端是 withModifiers 先断冒泡，两种都拦得住。
        -->
        <view
          v-if="selectable"
          class="pg__check"
          :class="{ 'is-on': isSelected(index) }"
          @touchstart.stop="beginSweep($event, index)"
          @touchmove.stop.prevent="moveSweep($event)"
          @touchend.stop="endSweep"
          @touchcancel.stop="cancelSweep"
          @click.stop="onCircleClick(index)"
        >
          <view class="pg__check-ring"></view>
          <view class="pg__check-mark"><wd-icon name="check" size="12px" /></view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.pg {
  &__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
    margin-bottom: 20rpx;
    border: 1px solid $ui-accent-strong;
    border-radius: $ui-radius-md;
    padding: 10rpx 10rpx 10rpx 24rpx;
    background-color: $ui-accent-soft;
  }

  &__bar-text {
    color: $ui-accent-text;
    font-size: 26rpx;
  }

  &__bar-btn {
    display: flex;
    height: 60rpx;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid $ui-danger-line;
    border-radius: $ui-radius-pill;
    padding: 0 28rpx;
    background-color: $ui-danger-soft;
    color: $ui-danger;
    font-size: 26rpx;

    &.is-disabled {
      opacity: 0.5;
      pointer-events: none;
    }

    &.is-busy {
      pointer-events: none;
    }
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16rpx;
  }

  // 桌面端（H5）放得下就多排几列
  @media (min-width: 640px) {
    &__grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  @media (min-width: 1024px) {
    &__grid {
      grid-template-columns: repeat(6, 1fr);
    }
  }

  // 刻意不写 overflow: hidden —— 圆圈的热区要探出格子右下角，会被裁掉
  &__cell {
    position: relative;
  }

  // 正方形靠 padding-bottom: 100% 撑，不用 aspect-ratio：
  // 那要 Chrome 88+ / Safari 15+，而 App 端跑的是**系统 WebView**（车间机器偏旧），
  // 没理由让一层 <view> 去赌内核版本。反正圆圈也需要这层 wrapper 定位。
  &__ratio {
    position: relative;
    width: 100%;
    padding-bottom: 100%;
  }

  &__img {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: $ui-radius-md;
    background-color: $ui-surface-2;
  }

  // 热区 88rpx（≈44px，Apple 的最小触摸目标），探出格子 12rpx —— 所以圆圈的视觉位置
  // 比「贴住角上」往里收了一点，指头更好按，也不会盖住照片角上的内容。
  &__check {
    position: absolute;
    right: -12rpx;
    bottom: -12rpx;
    display: flex;
    width: 88rpx;
    height: 88rpx;
    align-items: center;
    justify-content: center;
    // 拦页面滚动的主力：把滚动决策提前到合成器，不依赖 JS 时序，
    // 也不会因为「浏览器已经决定要滚」而甩一个 touchcancel 过来把连选打断。
    // 只挂在这 88rpx 上、不挂整格 —— 挂整格会让「手指落在照片上滑」彻底不能滚页面。
    touch-action: none;
  }

  &__check-ring,
  &__check-mark {
    position: absolute;
    display: flex;
    width: 44rpx;
    height: 44rpx;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background-color $ui-dur $ui-ease, border-color $ui-dur $ui-ease;
  }

  // 未选：白描边空心圈。
  //
  // ⚠️ 这里的白色与暗底是**刻意写死的，不要去套主题 token** —— 它压在「任意一张照片」上，
  //    而 $ui-scrim 在浅色主题下是**浅色**蒙版，压到照片上会直接消失。
  //    同 ImageViewer 写死 #000、旧格子写死 bg-black/50。
  &__check-ring {
    box-sizing: border-box;
    border: 4rpx solid rgba(255, 255, 255, 0.92);
    background-color: rgba(6, 10, 19, 0.24);
    box-shadow: 0 2rpx 8rpx rgba(6, 10, 19, 0.45);
  }

  &__check-mark {
    opacity: 0;
  }

  &__check.is-on &__check-ring {
    border-color: transparent;
    background-color: $ui-accent;
  }

  &__check.is-on &__check-mark {
    opacity: 1;
    color: $ui-on-accent;
  }
}
</style>
