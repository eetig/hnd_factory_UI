<script setup>
defineProps({
  label: { type: String, default: '正在加载' },
})
</script>

<template>
  <view class="loading-mask" :aria-label="label">
    <view class="loader" role="status" :aria-label="label">
      <text class="loader-text">Loading...</text>
      <view class="loader-bar"></view>
    </view>
  </view>
</template>

<style scoped>
/* 改造前后的差异都集中在「小程序 WXSS 不吃哪些写法」上：
   - inset: 0 简写 → 拆成 top/right/bottom/left
   - width: min(360px, 80%) → 用 width + max-width 表达同一意图
   - 其余（absolute / flex / rgba / @keyframes）小程序都支持，保持不变 */
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
  background-color: rgba(255, 255, 255, 0.72);
}

.loader {
  display: flex;
  width: 80%;
  max-width: 360px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.loader-text {
  align-self: center;
  margin-bottom: 20px;
  color: rgb(0, 0, 0);
  font-size: 24px;
}

.loader-bar {
  width: 30%;
  min-width: 110px;
  height: 10px;
  overflow: hidden;
  border-radius: 5px;
  background-color: rgb(0, 0, 0);
  animation: loader-bar-animation 2s ease-in-out infinite;
}

@keyframes loader-bar-animation {
  0% {
    transform: translateX(-100%);
  }

  50% {
    transform: translateX(100%);
  }

  100% {
    transform: translateX(-100%);
  }
}
</style>
