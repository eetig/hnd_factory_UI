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
// 深色主题下的空/错状态：圆形徽标 + 居中标题 + 白胶囊动作按钮。
// min-h-72（18rem）这类任意值类名在小程序端要构建期转义，这里直接写死尺寸更稳。
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
    width: 112rpx;
    height: 112rpx;
    align-items: center;
    justify-content: center;
    margin-bottom: 32rpx;
    border: 1px solid transparent;
    border-radius: 50%;
    font-size: 40rpx;
    font-weight: 600;

    &.is-error {
      border-color: $ui-danger-line;
      background-color: $ui-danger-soft;
      color: $ui-danger;
    }

    &.is-empty {
      border-color: $ui-accent-strong;
      background-color: $ui-accent-soft;
      color: $ui-accent-text;
    }
  }

  &__title {
    color: $ui-text;
    font-size: 32rpx;
    font-weight: 600;
  }

  &__desc {
    margin-top: 16rpx;
    color: $ui-text-3;
    font-size: 26rpx;
    line-height: 1.6;
  }

  &__action {
    margin-top: 40rpx;
    @include pill-button;
  }
}
</style>
