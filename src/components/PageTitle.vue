<template>
  <view class="pt" :style="wrapStyle">
    <text class="pt__text">{{ title }}</text>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { TITLE_BAR_HEIGHT, getStatusBarHeight } from '../composables/usePageFrame'

/*
 * 极简标题（2026-11-18）
 *
 * 使用方原话：「移除带圆角容器的顶部栏、所有页面左上角三横线按钮全部取消，
 * 只在页面最上方居中放置纯文字页面标题，无背景框、无菜单按钮。」
 *
 * 所以这里只有一行字：不加背景、不加副标题、不加图标、不加右侧控件，
 * 连返回箭头也不画（安卓用系统返回手势，左侧边缘右滑由页面自己处理）。
 * 高度固定 = 状态栏 + 44px，与系统导航栏一致，页面内容从它下面开始。
 */
const props = defineProps({
  title: { type: String, default: '' },
})

const statusBar = getStatusBarHeight()

const wrapStyle = computed(() => ({
  paddingTop: statusBar + 'px',
  height: statusBar + TITLE_BAR_HEIGHT + 'px',
}))
</script>

<style scoped lang="scss">
.pt {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
  /* 不设背景：标题直接坐在页面的暖纸底上，这才是「无背景框」 */
}

.pt__text {
  max-width: 78%;
  overflow: hidden;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ui-text);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
