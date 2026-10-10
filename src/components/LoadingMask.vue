<script setup>
defineProps({
  label: { type: String, default: '正在加载' },
  /*
   * label 给读屏，text 是屏幕上那行字，两者分开。
   * 默认值刻意保持 'Loading...'：现有 6 个调用点都没传 text，改默认值会一起
   * 改掉六个面板的可见文案 —— 那是文案决定，不是本次去重的范围。
   * （要中文化只需把这里改成 '加载中...'，一处生效六个面板。）
   */
  text: { type: String, default: 'Loading...' },
})
</script>

<template>
  <div class="loading-mask" :aria-label="label">
    <div class="loader" role="status" :aria-label="label">
      <div class="loader-text">{{ text }}</div>
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
  /* 全站墨色是 slate-900；纯黑只在两处 loader 里出现过，那是个孤立字面量 */
  color: #0f172a;
  font-size: 24px;
}

.loader-bar {
  width: 30%;
  min-width: 110px;
  height: 10px;
  overflow: hidden;
  /* 10px 高的条上 5px 与全圆角渲染几乎一致，取全站一致的胶囊惯例 */
  border-radius: 9999px;
  background-color: #0f172a;
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

/*
 * 前庭不适的触发源是「大幅位移」与「无限循环」——这条来回平移正是。
 *
 * ⚠️ 这条**必须**写在本组件的 scoped 块里，不能挪到 src/style.css 当全局规则。
 *    scoped 样式编译后是 `.loader-bar[data-v-xxx]`（0,2,0），全局的
 *    `.loader-bar`（0,1,0）**压不过它** —— 媒体查询不加特异性。曾这么写过，
 *    产物里两条规则并存、规则看着也在，实际从未生效（grep 只能证明存在，
 *    证明不了赢）。
 *    写在这里与上面那条 animation 同特异性，靠源码顺序在后取胜，无需 !important。
 */
@media (prefers-reduced-motion: reduce) {
  .loader-bar {
    animation: none;
  }
}
</style>
