<script setup>
import { computed, ref, watch } from 'vue'
import { useKeyboardLift } from '../composables/useKeyboardLift'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  options: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
  label: { type: String, default: '产成品' },
  // 行首图标：走 wot 图标字体，调用方各自传（与这一列的业务语义对齐）。
  // 默认空 = 这一列整体不渲染 —— 有些场景给每行配一个图标反而是噪音。
  icon: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'select'])

const keyword = ref('')

const filteredOptions = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return props.options
  return props.options.filter((item) => item.toLowerCase().includes(query))
})

// 弹层里的搜索框会被软键盘盖住（弹层是 fixed 的，uni 的 adjust-position 管不着），
// 拿到键盘高度后垫成 padding-bottom，把内容顶到键盘上沿之上，见 useKeyboardLift
const {
  keyboardHeight: liftHeight,
  start: startKeyboardLift,
  stop: stopKeyboardLift,
} = useKeyboardLift()

const popupStyle = computed(() => {
  const base =
    'max-height: 80vh; display: flex; flex-direction: column; background-color: var(--ui-glass-fill); overscroll-behavior: contain;'
  const kb = liftHeight.value
  if (!kb) return base

  // 键盘弹起时用「底边上移 + 高度写成确定值」，不用 padding —— 理由见 ImageParse 的
  // pickerCustomStyle：本项目没有全局 box-sizing 重置，.wd-popup 是 content-box，
  // padding 不占 max-height 额度，会把弹层整体顶出屏幕上沿。
  // 高度必须是 height 而不是 max-height：键盘高度是系统报的、实测会偏大，
  // 只给上限的话内容矮时弹层就按内容撑，`bottom` 一偏大整块就被顶出屏幕。
  return `${base} bottom: ${kb}px; padding-bottom: 0; height: min(80vh, calc(100vh - ${kb}px - 12px));`
})

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      keyword.value = ''
      // 只在弹层开着的时候听键盘高度（监听是全局的，挂久了会和别的弹层互相覆盖）
      startKeyboardLift()
    } else {
      stopKeyboardLift()
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

function handleSelect(item) {
  emit('select', item)
  close()
}
</script>

<template>
  <!-- 改造前是 el-dialog（居中弹窗）。移动端选项多、要滚动，
       用底部弹层 + scroll-view 更顺手；scroll-view 也是必须的 ——
       小程序的 <view> 上写 overflow-y: auto 不会滚动。 -->
  <wd-popup
    :model-value="modelValue"
    position="bottom"
    round
    safe-area-inset-bottom
    :custom-style="popupStyle"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <view class="picker">
      <!-- 顶部抓手：底部弹层的通用暗示，也让弹层"贴手" -->
      <view class="picker__grabber"></view>

      <view class="picker__head">
        <text class="picker__title">选择{{ label }}</text>
        <view class="picker__close" @click="close">
          <wd-icon name="close" size="18px" />
        </view>
      </view>

      <view class="picker__search">
        <wd-input
          v-model="keyword"
          :placeholder="`输入关键词搜索${label}`"
          clearable
          no-border
        />
      </view>

      <scroll-view class="picker__list" scroll-y>
        <view
          v-for="item in filteredOptions"
          :key="item"
          class="picker__item"
          :class="item === selected ? 'is-selected' : ''"
          @click="handleSelect(item)"
        >
          <view v-if="icon" class="picker__item-icon">
            <wd-icon :name="icon" size="20px" />
          </view>
          <text class="picker__item-text">{{ item }}</text>
          <text v-if="item === selected" class="picker__item-flag">当前</text>
        </view>

        <view v-if="!filteredOptions.length" class="picker__empty">
          <text>没有匹配的{{ label }}</text>
        </view>
      </scroll-view>
    </view>
  </wd-popup>
</template>

<style lang="scss" scoped>
.picker {
  display: flex;
  max-height: 80vh;
  flex-direction: column;

  &__grabber {
    width: 72rpx;
    height: 8rpx;
    margin: 20rpx auto 0;
    border-radius: $ui-radius-pill;
    background-color: $ui-raise-3;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24rpx 32rpx 16rpx;
  }

  &__title {
    color: $ui-text;
    font-size: 32rpx;
    font-weight: 600;
  }

  &__close {
    display: flex;
    width: 56rpx;
    height: 56rpx;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: $ui-raise-2;
    color: $ui-text-3;
    transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;

    &:active {
      background-color: $ui-raise-3;
      color: $ui-text;
    }
  }

  &__search {
    padding: 0 32rpx 16rpx;
  }

  &__list {
    // scroll-view 必须有确定高度才会滚动
    height: 60vh;
    // 键盘弹起后弹层高度是确定的，列表靠 flex 把剩余空间吃掉 / 在不够时缩
    min-height: 0;
    flex-grow: 1;
    // 滑到头不要把滚动传给下层页面，否则弹层会跟着页面一起滚
    overscroll-behavior: contain;
    // uni 的 uni-scroll-view 带 width:100%，而 100% 不扣边框 —— 会平白溢出 2px
    width: auto;
    border-top: 1px solid $ui-hairline;
    padding: 10rpx 0 20rpx;
  }

  // 深色主题下不再用"整行铺满 + 分隔线"，改成一条条圆角块：
  // 每行都是一个可点的胶囊，选中态用强调色淡底标出。
  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 20rpx;
    padding: 26rpx 20rpx;
    border-radius: $ui-radius-md;
    color: $ui-text-2;
    font-size: 28rpx;
    transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;

    &:not(:first-child) {
      border-top: 1px solid $ui-hairline;
    }

    &.is-selected {
      background-color: $ui-accent-soft;
      color: $ui-accent-text;
      font-weight: 500;
    }
  }

  &__item-icon {
    display: flex;
    flex-shrink: 0;
    margin-right: 20rpx;
    color: $ui-text-3;
  }

  &__item.is-selected &__item-icon {
    color: $ui-accent-text;
  }

  &__item-text {
    flex: 1;
    word-break: break-all;
  }

  &__item-flag {
    flex-shrink: 0;
    margin-left: 24rpx;
    padding: 6rpx 18rpx;
    border-radius: $ui-radius-pill;
    background-color: $ui-accent-strong;
    color: $ui-text;
    font-size: 22rpx;
    line-height: 1.4;
  }

  &__empty {
    padding: 80rpx 32rpx;
    color: $ui-text-3;
    font-size: 28rpx;
    text-align: center;
  }
}
</style>
