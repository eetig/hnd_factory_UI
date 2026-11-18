<template>
  <view class="pt" :style="wrapStyle">
    <text class="pt__text">{{ title }}</text>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { TITLE_BAR_HEIGHT, getTitleBarMetrics } from '../composables/usePageFrame'

/*
 * 极简标题（2026-11-18）
 *
 * 使用方原话：「移除带圆角容器的顶部栏、所有页面左上角三横线按钮全部取消，
 * 只在页面最上方居中放置纯文字页面标题，无背景框、无菜单按钮。」
 *
 * 所以这里只有一行字：不加背景、不加副标题、不加图标、不加右侧控件，
 * 连返回箭头也不画（安卓用系统返回手势，左侧边缘右滑由页面自己处理）。
 *
 * 2026-11-18 二次调整：使用方看真机截图后要求「标题再往上、贴到状态栏下面」。
 * 行高从 44 压到 28，行顶再向上吃 12px 状态栏间距（见 usePageFrame 注释），
 * 字心因此正好坐在状态栏下沿，整块比原来高约 20px。
 */
const props = defineProps({
  title: { type: String, default: '' },
})

const metrics = getTitleBarMetrics()

const wrapStyle = computed(() => ({
  paddingTop: metrics.top + 'px',
  height: metrics.height + 'px',
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
  /* 标题与下方内容的呼吸位放在这里，页面根节点就不用再留顶部内边距（否则会叠成两层空白） */
  margin-bottom: 6px;
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
