<script setup>
// 带漏斗的筛选表头：已筛选时显示选中值并高亮，可一键清除
defineProps({
  label: { type: String, required: true },
  selected: { type: String, default: '' },
  hint: { type: String, default: '' }, // 用于「点击选择X」提示与无障碍标签
  // 改造前是 Tailwind 类名（max-w-[110px]），小程序端方括号类名需要构建期转义才能生效。
  // 这里改成传数值走内联 style，三端行为一致且不依赖构建插件。
  maxWidth: { type: Number, default: 110 },
})

const emit = defineEmits(['open', 'clear'])
</script>

<template>
  <view class="filter-cell">
    <view
      class="filter-cell__trigger"
      :class="selected ? 'is-active' : ''"
      :style="{ maxWidth: `${maxWidth}px` }"
      :title="selected ? `已筛选：${selected}` : `点击选择${hint || label}`"
      @click="emit('open')"
    >
      <text class="filter-cell__label">{{ selected || label }}</text>
      <!-- 原来这里是内联 <svg> 漏斗图标；小程序不支持 svg 标签，换成组件库图标字体。
           外面套一层 view 是因为组件库内部元素带不了 scoped 的 data-v 标记，
           scoped 样式选不中它，只能靠外层容器控制 flex 收缩。 -->
      <view class="filter-cell__icon">
        <wd-icon name="filter" size="14px" />
      </view>
    </view>

    <view
      v-if="selected"
      class="filter-cell__clear"
      :aria-label="`清除${hint || label}筛选`"
      @click="emit('clear')"
    >
      <text>×</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.filter-cell {
  display: flex;
  align-items: center;
  gap: 4rpx;

  &__trigger {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 4rpx;
    border-radius: 8rpx;

    &.is-active {
      color: $sky-600;
    }
  }

  &__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__icon {
    flex-shrink: 0;
  }

  &__clear {
    padding: 0 4rpx;
    color: $slate-400;
    line-height: 1;
  }
}
</style>
