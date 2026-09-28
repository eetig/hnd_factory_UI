<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  options: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
  label: { type: String, default: '产成品' },
})

const emit = defineEmits(['update:modelValue', 'select'])

const keyword = ref('')

const filteredOptions = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return props.options
  return props.options.filter((item) => item.toLowerCase().includes(query))
})

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) keyword.value = ''
  },
)

function close() {
  emit('update:modelValue', false)
}

function handleSelect(item) {
  emit('select', item)
  close()
}
</script>

<template>
  <!-- 改造前是 el-dialog（居中弹窗）。移动端选项多、要滚动，
       用底部弹层 + scroll-view 更顺手；scroll-view 也是必须的 ——
       小程序的 <view> 上写 overflow-y: auto 不会滚动。 -->
  <wd-popup
    :model-value="modelValue"
    position="bottom"
    round
    safe-area-inset-bottom
    custom-style="max-height: 80vh; display: flex; flex-direction: column;"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="picker">
      <view class="picker__head">
        <text class="picker__title">选择{{ label }}</text>
        <view class="picker__close" @click="close">
          <wd-icon name="close" size="18px" />
        </view>
      </view>

      <view class="picker__search">
        <wd-input
          v-model="keyword"
          :placeholder="`输入关键词搜索${label}`"
          clearable
          no-border
        />
      </view>

      <scroll-view class="picker__list" scroll-y>
        <view
          v-for="item in filteredOptions"
          :key="item"
          class="picker__item"
          :class="item === selected ? 'is-selected' : ''"
          @click="handleSelect(item)"
        >
          <text class="picker__item-text">{{ item }}</text>
          <text v-if="item === selected" class="picker__item-flag">当前</text>
        </view>

        <view v-if="!filteredOptions.length" class="picker__empty">
          <text>没有匹配的{{ label }}</text>
        </view>
      </scroll-view>
    </view>
  </wd-popup>
</template>

<style lang="scss" scoped>
.picker {
  display: flex;
  max-height: 80vh;
  flex-direction: column;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 32rpx 32rpx 16rpx;
  }

  &__title {
    color: $slate-900;
    font-size: 32rpx;
    font-weight: 600;
  }

  &__close {
    padding: 8rpx;
    color: $slate-400;
  }

  &__search {
    padding: 0 32rpx 16rpx;
  }

  &__list {
    // scroll-view 必须有确定高度才会滚动
    height: 60vh;
    border-top: 1px solid $slate-200;
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 28rpx 32rpx;
    color: $slate-700;
    font-size: 28rpx;

    &.is-selected {
      background-color: $sky-50;
      color: $sky-700;
      font-weight: 500;
    }
  }

  &__item-text {
    flex: 1;
    word-break: break-all;
  }

  &__item-flag {
    flex-shrink: 0;
    margin-left: 24rpx;
    color: $sky-600;
    font-size: 24rpx;
  }

  &__empty {
    padding: 80rpx 32rpx;
    color: $slate-400;
    font-size: 28rpx;
    text-align: center;
  }
}
</style>
