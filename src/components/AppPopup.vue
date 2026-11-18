<script setup>
/**
 * 统一弹窗（2026-11-18）
 *
 * 为什么要有这一层：返回手势（手机上从屏幕边缘往里滑）要「先关弹出的东西」，
 * 而项目里弹窗有十来个，若让每个业务弹窗自己记 push/pop，
 * 迟早漏一个 —— 漏的那个就是「弹窗开着、手势把抽屉拉出来」的 bug。
 *
 * 所以规矩是：**业务只写 v-model，入栈出栈由这里自己做**。
 *   <AppPopup v-model="visible" position="bottom" round>…</AppPopup>
 *
 * 单向绑定也要能关（2026-11-18 补）：有的弹窗状态不是布尔，而是「有没有这条数据」，
 * 于是写成 `:model-value="!!detailCard"` —— 这种没有 v-model 回写，父级收不到
 * update:modelValue。若只发事件，手势会把栈摘掉、界面却不动（用户看到的正是
 * 「详情弹窗返回手势关不掉」）。所以这里自己留一个 shown 内部态：
 * 关闭时先把 shown 置 false（界面立刻收），再同时发 update:modelValue 和 close，
 * 让父级有机会把 detailCard 之类一起清干净。
 *
 * 透传：position / round / custom-style / lock-scroll / z-index 等 wd-popup 的
 * 属性全部用 v-bind="$attrs" 透下去（inheritAttrs: false，避免挂到外层多余的节点上），
 * 所以把 <wd-popup> 换成 <AppPopup> 时，原来的属性一个都不用改。
 *
 * 栈的顺序 = 打开的先后：同一次手势只关最后打开的那一层，
 * 关掉后如果下面还压着别的弹窗，下一次手势才轮到它。
 */
import { computed, onBeforeUnmount, ref, useAttrs, watch } from 'vue'
import { pushPopup, removePopup } from '../utils/popupStack'
import { lockPageScroll, unlockPageScroll } from '../utils/scrollLock'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'close'])

/*
 * 安全区不再交给 wd-popup 画（2026-11-18，用户 m10197）
 *
 * wd-popup 的 safe-area-inset-bottom 是拿 `padding-bottom` 画在**弹窗根节点**上的，
 * 那块 padding 继承根节点自己的底色（我们传的 custom-style 里是 --ui-sheet-fill，纯白），
 * 而内容区是一堆浅灰卡片 —— 于是每一处底部弹窗，按钮下面都多出一条更白的带子。
 *
 * 现在把这个属性拦下来不透传：安全区改成各弹窗自己的底栏用
 * `padding-bottom: calc(x + env(safe-area-inset-bottom))` 处理（已经这么写的那些组件照旧），
 * 底栏既然不吃底色，安全区那段也就是弹窗本体的一部分，不会再有异色条。
 */
const attrs = useAttrs()

const popupAttrs = computed(() => {
  const { safeAreaInsetBottom, 'safe-area-inset-bottom': dashed, ...rest } = attrs
  return rest
})


/** 每个实例一个稳定 id：同一页里开三个弹窗也不会互相顶掉 */
const stackId = `popup-${Math.random().toString(36).slice(2, 10)}`

/** 内部可见态：父级不回写时也能自己收起来，避免「栈空了但界面还开着」 */
const shown = ref(props.modelValue)

let registered = false

function enterStack() {
  if (registered) return
  registered = true
  // 守卫层只会调「关」这个动作，具体怎么关由这里转成 v-model=false + close，
  // 于是业务弹窗不用关心返回手势这回事
  pushPopup(stackId, close)
}

function leaveStack() {
  if (!registered) return
  registered = false
  removePopup(stackId)
}

/** 返回手势 / 点遮罩 / 点关闭按钮 都走这里 */
function close() {
  shown.value = false
  emit('update:modelValue', false)
  emit('close')
}

/** wd-popup 自己也发 update:model-value（点遮罩等）：开就同步，关就统一走 close */
function onInnerUpdate(value) {
  if (value) {
    shown.value = true
    return
  }
  close()
}

watch(
  () => props.modelValue,
  (open) => {
    shown.value = open
    if (open) enterStack()
    else leaveStack()
  },
  { immediate: true },
)

// 弹窗被 v-if / 路由切换直接干掉时，栈里不能留一个永远关不掉的影子
onBeforeUnmount(leaveStack)

/*
 * 锁底层滚动（2026-11-18）
 *
 * 用户报的是「弹窗开着，手指在遮罩上划，底下页面还在滚」，而且是所有弹窗都有。
 * 根因在 wd-popup 的 lock-scroll 只锁了 body.overflow，挡不住 webview 里真正的滚动容器。
 * 弹窗全都经过这里，于是统一在这一层加锁，业务组件一个都不用改；
 * 计数在 scrollLock 里，弹窗套弹窗时不会互相解开。
 */
let scrollLocked = false

function syncScrollLock(open) {
  if (open === scrollLocked) return
  scrollLocked = open
  if (open) lockPageScroll()
  else unlockPageScroll()
}

watch(shown, (open) => syncScrollLock(!!open))

onBeforeUnmount(() => syncScrollLock(false))
</script>

<template>
  <wd-popup
    :model-value="shown"
    v-bind="popupAttrs"
    @update:model-value="onInnerUpdate"
  >
    <slot />
  </wd-popup>
</template>
