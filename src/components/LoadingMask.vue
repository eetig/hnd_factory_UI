<script setup>
defineProps({
  label: { type: String, default: '正在加载' },
})
</script>

<template>
  <view class="loading-mask" :aria-label="label">
    <view class="loader" role="status" :aria-label="label">
      <view class="loader__dots">
        <view class="loader__dot is-1"></view>
        <view class="loader__dot is-2"></view>
        <view class="loader__dot is-3"></view>
      </view>
      <text class="loader__text">{{ label }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 加载遮罩：压暗（浅色主题下是提亮）整块面板 + 居中一张小卡片（三点脉冲 + 文案）。
   改造前后的差异都集中在「小程序 WXSS 不吃哪些写法」上：
   - inset: 0 简写 → 拆成 top/right/bottom/left
   - 不支持 backdrop-filter 模糊（小程序直接忽略），所以底色压得更实一点
   - 其余（absolute / flex / rgba / @keyframes）小程序都支持，保持不变
   ⚠️ 遮罩色与卡片色都走主题变量：深色下是"黑底压暗 + 深色卡片"，
      浅色下必须换成"白底提亮 + 白卡片"，写死 rgba(11,11,14,…) 会让浅色主题
      整块面板糊成黑的。 */
.loading-mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: $ui-scrim;
}

.loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
  padding: 44rpx 60rpx;
  border: 1px solid $ui-hairline;
  border-radius: $ui-radius-lg;
  background-color: $ui-surface-trans;
  box-shadow: 0 24rpx 60rpx -30rpx $ui-shadow-strong;

  &__dots {
    display: flex;
    align-items: center;
    gap: 14rpx;
  }

  &__dot {
    width: 16rpx;
    height: 16rpx;
    border-radius: 50%;
    background-color: $ui-accent;
    animation: loader-dot 1.05s $ui-ease infinite both;

    /* 用显式类名而不是 :nth-child —— 小程序的伪类支持不在官方保证范围内。
       两个跟拍的圆点取强调色的两个层次（弱 → 强），深浅主题下都看得见 */
    &.is-2 {
      background-color: $ui-accent-text;
      animation-delay: 140ms;
    }

    &.is-3 {
      background-color: $ui-accent;
      animation-delay: 280ms;
    }
  }

  &__text {
    color: $ui-text-2;
    font-size: 26rpx;
    letter-spacing: 0.04em;
  }
}

@keyframes loader-dot {
  0%,
  100% {
    opacity: 0.3;
    transform: translateY(0) scale(0.86);
  }

  45% {
    opacity: 1;
    transform: translateY(-10rpx) scale(1);
  }
}
</style>
