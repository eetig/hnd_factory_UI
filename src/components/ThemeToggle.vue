<script setup>
import { ref } from 'vue'
import DropdownMenu from './DropdownMenu.vue'
import { useTheme } from '../composables/useTheme'

// 主题切换：触发器是「半明半暗」的圆点按钮，点开是企微式的两项浮层（浅色 / 深色，当前项打勾）。
//
// 改造前是「点一下直接翻面」的开关。改成浮层有两个理由：
//   · 开关只能靠图标朝向猜「现在哪套」，浮层能把当前项明确标出来；
//   · 与本轮其它小列表（储罐选择器）统一观感。
//
// 为什么两行不引图标字体（而用 CSS 圆点）：wot 的图标集里没有太阳/月亮，而用 emoji 或
// 中文字形在不同机型上差异太大 —— 半明半暗的圆点是「光照 / 对比度」的通用隐喻，
// 与触发器同一个隐喻（全局类 .theme-dot 见 App.vue）。两半都填色，所以轮廓是完整正圆。

// 顶栏与登录页共用本组件，所以两处入口一起改：调用方模板一个字都不用动。
const { theme, isLight, setTheme } = useTheme()

// 浮层的开关状态：必须 v-model 绑给 DropdownMenu —— 它的遮罩与面板都是
// v-if="modelValue"，只声明 prop 不绑的话，点击触发器只会 emit 一个没人监听的事件，
// 表现就是「点了没反应」。这行别删。
const menuOpen = ref(false)

// 两项的 label / hint 写死。顺序固定「浅色在上、深色在下」：深色是本项目的默认外观，
// 把它放在贴近触发器的位置，少动一次手。
const THEME_OPTIONS = [
  { value: 'light', label: '浅色', hint: '白底 · 高对比', dot: true, dotLight: true },
  { value: 'dark', label: '深色', hint: '默认 · 纯黑底', dot: true, dotLight: false },
]
</script>

<template>
  <!-- 触发器仍是原来那枚按钮（84rpx 方框 + CSS 圆点）。浮层交给 DropdownMenu：
       状态由本组件持有：v-model 控浮层开关、select 回传选中项，由这里写回 useTheme。 -->
  <DropdownMenu
    v-model="menuOpen"
    :options="THEME_OPTIONS"
    :selected="theme"
    aria-label="切换主题"
    @select="setTheme"
  >
    <button
      class="theme-toggle"
      :aria-label="isLight ? '切换到深色主题' : '切换到浅色主题'"
    >
      <view class="theme-dot" :class="{ 'is-light': isLight }"></view>
    </button>
  </DropdownMenu>
</template>

<style lang="scss" scoped>
.theme-toggle {
  display: flex;
  width: 84rpx;
  height: 84rpx;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid $ui-border;
  border-radius: 26rpx;
  background-color: $ui-raise;
  transition: background-color $ui-dur $ui-ease, transform 160ms $ui-ease;

  // 小程序 button 自带 ::after 描边，不清掉胶囊边上会多一条灰线
  &::after {
    border: 0;
  }

  &:active {
    transform: scale(0.94);
    background-color: $ui-surface-3;
  }
}
</style>

