<script setup>
defineProps({
  label: { type: String, default: '正在加载' },
})
</script>

<template>
  <div class="loading-mask" :aria-label="label">
    <div class="loader" role="status" :aria-label="label">
      <div class="loader-text">Loading...</div>
      <div class="loader-bar"></div>
    </div>
  </div>
</template>

<style scoped>
.loading-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.72);
}

.loader {
  display: flex;
  width: min(360px, 80%);
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
