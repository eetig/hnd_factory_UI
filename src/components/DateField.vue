<script setup>
// 日期选择字段。
//
// 为什么要单独抽一层：原来 8 处都用 <el-date-picker type="date" value-format="YYYY-MM-DD">，
// 迁到 wot-design-uni 后 wd-datetime-picker 的默认外观是「标签 + 值的表单行」，
// 与原来那种独立输入框差异较大，且 8 处都要写一遍自定义触发器的插槽。
// 抽成组件后调用点仍是熟悉的 v-model + placeholder 写法。
//
// 事件语义：只在「点确定」时对外抛 change，不会随滚轮每次变化都抛 ——
// 调用方多是用它触发一次筛选请求，逐格触发会打爆接口。

defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '请选择日期' },
})

const emit = defineEmits(['update:modelValue', 'change'])

function handleConfirm(event) {
  const value = event?.value ?? ''
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<template>
  <wd-datetime-picker
    type="date"
    :model-value="modelValue"
    @confirm="handleConfirm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="date-field">
      <text class="date-field__text" :class="{ 'is-empty': !modelValue }">
        {{ modelValue || placeholder }}
      </text>
      <wd-icon name="calendar" size="16px" />
    </view>
  </wd-datetime-picker>
</template>

<style scoped lang="scss">
.date-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid $slate-300;
  border-radius: 8px;
  background-color: #fff;
  color: $slate-700;

  &__text {
    font-size: 14px;

    &.is-empty {
      color: $slate-400;
    }
  }
}
</style>
