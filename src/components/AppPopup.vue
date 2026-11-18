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
 * 透传：position / round / custom-style / lock-scroll / z-index 等 wd-popup 的
 * 属性全部用 v-bind="$attrs" 透下去（inheritAttrs: false，避免挂到外层多余的节点上），
 * 所以把 <wd-popup> 换成 <AppPopup> 时，原来的属性一个都不用改。
 *
 * 栈的顺序 = 打开的先后：同一次手势只关最后打开的那一层，
 * 关掉后如果下面还压着别的弹窗，下一次手势才轮到它。
 */
import { onBeforeUnmount, watch } from 'vue'
import { pushPopup, removePopup } from '../utils/popupStack'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

/** 每个实例一个稳定 id：同一页里开三个弹窗也不会互相顶掉 */
const stackId = `popup-${Math.random().toString(36).slice(2, 10)}`

let registered = false

function enterStack() {
  if (registered) return
  registered = true
  // 守卫层只会调「关」这个动作，具体怎么关由这里转成 v-model=false，
  // 于是业务弹窗不用关心返回手势这回事
  pushPopup(stackId, () => emit('update:modelValue', false))
}

function leaveStack() {
  if (!registered) return
  registered = false
  removePopup(stackId)
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) enterStack()
    else leaveStack()
  },
  { immediate: true },
)

// 弹窗被 v-if / 路由切换直接干掉时，栈里不能留一个永远关不掉的影子
onBeforeUnmount(leaveStack)
</script>

<template>
  <wd-popup
    :model-value="modelValue"
    v-bind="$attrs"
    @update:model-value="(value) => emit('update:modelValue', value)"
  >
    <slot />
  </wd-popup>
</template>
