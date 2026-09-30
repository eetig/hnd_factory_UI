<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  options: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
  label: { type: String, default: '产成品' },
  // 行首图标：走 wot 图标字体，调用方各自传（与这一列的业务语义对齐）。
  // 默认空 = 这一列整体不渲染 —— 有些场景给每行配一个图标反而是噪音。
  icon: { type: String, default: '' },
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
      <!-- 顶部抓手：底部弹层的通用暗示，也让弹层"贴手" -->
      <view class="picker__grabber"></view>

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
          <view v-if="icon" class="picker__item-icon">
            <wd-icon :name="icon" size="20px" />
          </view>
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

  &__grabber {
    width: 72rpx;
    height: 8rpx;
    margin: 20rpx auto 0;
    border-radius: $ui-radius-pill;
    background-color: $ui-raise-3;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24rpx 32rpx 16rpx;
  }

  &__title {
    color: $ui-text;
    font-size: 32rpx;
    font-weight: 600;
  }

  &__close {
    display: flex;
    width: 56rpx;
    height: 56rpx;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: $ui-raise-2;
    color: $ui-text-3;
    transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;

    &:active {
      background-color: $ui-raise-3;
      color: $ui-text;
    }
  }

  &__search {
    padding: 0 32rpx 16rpx;
  }

  &__list {
    // scroll-view 必须有确定高度才会滚动
    height: 60vh;
    border-top: 1px solid $ui-hairline;
    padding: 10rpx 0 20rpx;
  }

  // 深色主题下不再用"整行铺满 + 分隔线"，改成一条条圆角块：
  // 每行都是一个可点的胶囊，选中态用强调色淡底标出。
  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 20rpx;
    padding: 26rpx 20rpx;
    border-radius: $ui-radius-md;
    color: $ui-text-2;
    font-size: 28rpx;
    transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;

    &:not(:first-child) {
      border-top: 1px solid $ui-hairline;
    }

    &.is-selected {
      background-color: $ui-accent-soft;
      color: $ui-accent-text;
      font-weight: 500;
    }
  }

  &__item-icon {
    display: flex;
    flex-shrink: 0;
    margin-right: 20rpx;
    color: $ui-text-3;
  }

  &__item.is-selected &__item-icon {
    color: $ui-accent-text;
  }

  &__item-text {
    flex: 1;
    word-break: break-all;
  }

  &__item-flag {
    flex-shrink: 0;
    margin-left: 24rpx;
    padding: 6rpx 18rpx;
    border-radius: $ui-radius-pill;
    background-color: $ui-accent-strong;
    color: $ui-text;
    font-size: 22rpx;
    line-height: 1.4;
  }

  &__empty {
    padding: 80rpx 32rpx;
    color: $ui-text-3;
    font-size: 28rpx;
    text-align: center;
  }
}
</style>
