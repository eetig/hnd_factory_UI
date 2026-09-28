<script setup>
// 面板内的空状态 / 错误状态占位
defineProps({
  type: { type: String, default: 'empty' }, // 'empty' | 'error'
  title: { type: String, required: true },
  description: { type: String, default: '' },
  actionText: { type: String, default: '' },
})

const emit = defineEmits(['action'])
</script>

<template>
  <view class="panel-state">
    <view class="panel-state__badge" :class="type === 'error' ? 'is-error' : 'is-empty'">
      <text>{{ type === 'error' ? '!' : '∅' }}</text>
    </view>

    <text class="panel-state__title">{{ title }}</text>
    <text v-if="description" class="panel-state__desc">{{ description }}</text>

    <button v-if="actionText" class="panel-state__action" @click="emit('action')">
      {{ actionText }}
    </button>
  </view>
</template>

<style lang="scss" scoped>
// min-h-72（18rem）这类任意值类名在小程序端要构建期转义，这里直接写死尺寸更稳
.panel-state {
  display: flex;
  min-height: 288px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 48rpx;
  text-align: center;

  &__badge {
    display: flex;
    width: 96rpx;
    height: 96rpx;
    align-items: center;
    justify-content: center;
    margin-bottom: 32rpx;
    border-radius: 50%;
    font-size: 36rpx;

    &.is-error {
      background-color: $rose-50;
      color: $rose-500;
    }

    &.is-empty {
      background-color: $sky-50;
      color: $sky-600;
    }
  }

  &__title {
    color: $slate-900;
    font-size: 32rpx;
    font-weight: 600;
  }

  &__desc {
    margin-top: 16rpx;
    color: $slate-500;
    font-size: 28rpx;
  }

  &__action {
    margin-top: 40rpx;
    padding: 16rpx 32rpx;
    border: 0;
    border-radius: 16rpx;
    background-color: $slate-900;
    color: #fff;
    font-size: 28rpx;
    font-weight: 500;
    line-height: 1.4;

    &::after {
      border: 0;
    }
  }
}
</style>
