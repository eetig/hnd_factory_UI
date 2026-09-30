<script setup>
// 企微式下拉浮层（企业微信-文档首页「与我相关 / 最近查看 / 全部 / 回收站」那个观感）。
//
// 为什么自己画，而不用库里的现成组件：
//   · wd-picker 是滚轮选择器（储罐选择器改造前用的就是它），与「一屏铺开的短列表」不是一回事；
//   · wd-popover / wd-drop-menu 要还原这套观感得大量 :deep() 覆写库内部结构，与第 4 节
//     「不再用 :deep() 覆写第三方结构」的约定冲突（同 DateField 手写月历的理由）。
//   自己画只有我们这一层类名，三端表现一致，也不用跟库的选择器较劲。
//
// 适用范围：**≤6 项的短列表**（储罐 2 项、主题 2 项）。选项可能几十上百条、需要搜索的
//   6 处表头筛选继续用 ProductSelectDialog 的底部弹层 —— 浮层里做滚动要同时面对
//   「小程序 view 写 overflow 不滚」与「scroll-view 必须有确定高度」，而浮层高度是跟着
//   触发器位置算出来的，不值得。别越界使用。
//
// 定位与层级（三端都按这三条走）：
//   · 锚点由本组件根节点自己提供，**不依赖祖先**：顶栏 .topbar 身上没有任何 position，
//     而卡片 .panel 只有 position: relative（见 uni.scss 的 @mixin panel-in），
//     两者定位链不同，靠祖先一定会把行为写歪；
//   · 遮罩是 position: fixed：从页面根到这里没有 transform 祖先（详见 UNIAPP迁移说明.md 4.2），
//     所以能铺满全屏；
//   · z-index 取 90 / 91：高于页面内元素（LoadingMask 是 20）与吸顶内容，但**刻意低于**
//     wot 自己的弹层（floating-panel 99 / popover·tooltip 500）—— 抽屉、日期弹层、Toast
//     必须永远压在这层浮层之上。
//
// 契约：状态由调用方持有（selected + select 事件），与 ProductSelectDialog 一致，
//   组件自己不写值，避免出现第二套语义。
//   ⚠️ 可见性（modelValue）也必须由调用方 v-model 绑上：遮罩与面板都是 v-if="modelValue"，
//      漏绑时点击只会 emit 一个没人监听的事件 —— 表现就是「点了没反应」（本项目踩过一次）。

defineProps({
  modelValue: { type: Boolean, default: false },
  // { value, label, hint?, icon?, dot?, dotLight? }
  //   icon     —— 走 wot 图标字体（写错会渲染成空白方块，取值见 wd-icon/index.scss）；
  //   dot      —— 用 CSS 圆点占位，不引图标字体（主题切换用它：图标字体里没有太阳/月亮）；
  //   dotLight —— 圆点用「浅色态」（全局 .theme-dot.is-light 那一支：亮的那半翻到右边）。
  options: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
  // 面板与触发器哪条边对齐。默认右对齐 —— 触发器多半落在行的右侧。
  align: { type: String, default: 'right' },
  width: { type: Number, default: 240 },
  ariaLabel: { type: String, default: '展开选项' },
})

const emit = defineEmits(['update:modelValue', 'select'])

function open() {
  emit('update:modelValue', true)
}

function close() {
  emit('update:modelValue', false)
}

function handleSelect(value) {
  emit('select', value)
  close()
}
</script>

<template>
  <view class="dd">
    <!-- 触发器：调用方自己画，这里只负责「点击打开」与提供定位锚点（.dd 是 relative） -->
    <view class="dd__anchor" :aria-label="ariaLabel" @click="open">
      <slot></slot>
    </view>

    <!-- 遮罩：点空白关闭。能铺满全屏的前提是「从页面根到这里没有 transform 祖先」（说明 4.2）；
         .stop 拦掉滑动 —— 浮层开着时不该带着页面一起滚（小程序端 .stop 编译成 catch 前缀）。 -->
    <view v-if="modelValue" class="dd__mask" @click="close" @touchmove.stop></view>

    <view
      v-if="modelValue"
      class="dd__panel"
      :class="`is-${align}`"
      :style="{ width: `${width}px` }"
    >
      <view
        v-for="option in options"
        :key="option.value"
        class="dd__item"
        :class="{ 'is-selected': option.value === selected }"
        @click="handleSelect(option.value)"
      >
        <!-- 首列：图标字体 / CSS 圆点 / 都没有（不渲染，省一格宽度） -->
        <view
          v-if="option.dot"
          class="dd__dot theme-dot"
          :class="{ 'is-light': option.dotLight }"
        ></view>
        <view v-else-if="option.icon" class="dd__icon">
          <wd-icon :name="option.icon" size="20px" />
        </view>

        <view class="dd__text">
          <text class="dd__label">{{ option.label }}</text>
          <text v-if="option.hint" class="dd__hint">{{ option.hint }}</text>
        </view>

        <view v-if="option.value === selected" class="dd__check">
          <wd-icon name="check" size="16px" />
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
// 根节点：锚点（position: relative）由我们自己提供，理由见文件头「定位与层级」第 1 条。
// min-width: 0 + max-width: 100% 是给「触发器里放可省略的长文本」留收缩空间
//（储罐名 13 个字，窄屏要靠省略号收住 —— 见 index.vue 的 .vessel-select）。
.dd {
  position: relative;
  display: flex;
  min-width: 0;
  max-width: 100%;
}

.dd__anchor {
  display: flex;
  min-width: 0;
  max-width: 100%;
}

/* 遮罩：点空白关闭。z-index 见文件头第 3 条（90 = 页面元素之上、wot 弹层之下） */
.dd__mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 90;
}

/* 面板本体：白底 + 大圆角 + 大投影。宽度由 :style 传数值进来（不用 w-[NNpx] 这类
   方括号类名 —— 小程序端要靠构建期转义才生效）。 */
.dd__panel {
  position: absolute;
  top: calc(100% + 8rpx);
  z-index: 91;
  /* 永不窄于触发器：参考图里卡包比按钮宽，而储罐胶囊可有 200px+。
     min-width: 100% 让它至少与触发器同宽（100% 即 .dd 的宽度）。 */
  min-width: 100%;
  max-width: calc(100vw - 32px);
  padding: 8rpx;
  border: 1px solid $ui-border;
  border-radius: $ui-radius-md;
  background-color: $ui-surface;
  box-shadow: 0 24rpx 60rpx -24rpx $ui-shadow-strong;

  &.is-right {
    right: 0;
  }

  &.is-left {
    left: 0;
  }
}

.dd__item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 20rpx;
  border-radius: $ui-radius-sm;
  color: $ui-text-2;
  transition: background-color $ui-dur $ui-ease, color $ui-dur $ui-ease;

  /* 分隔线落在「与上一项之间」，并跟着内边距一起内缩 —— 参考图里那条线也不顶到面板边 */
  &:not(:first-child) {
    border-top: 1px solid $ui-hairline;
  }

  &.is-selected {
    background-color: $ui-accent-soft;
    color: $ui-accent-text;
  }
}

.dd__icon {
  display: flex;
  flex-shrink: 0;
  color: $ui-text-3;
}

/* 主题切换用的 CSS 圆点：复用 App.vue 的全局 .theme-dot（半明半暗 = 光照/对比度的通用隐喻，
   两半都填色所以轮廓是完整正圆），只把尺寸收小一档 —— scoped 的 .dd__dot 权重更高，
   能盖住全局那条 width/height。 */
.dd__dot {
  width: 24rpx;
  height: 24rpx;
  flex-shrink: 0;
}

.dd__text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.dd__label {
  color: inherit;
  font-size: 28rpx;
}

.dd__hint {
  margin-top: 4rpx;
  color: $ui-text-3;
  font-size: 22rpx;
}

.dd__check {
  display: flex;
  flex-shrink: 0;
  color: $ui-accent-text;
}

/* 选中行：图标与标签一起转强调色（参考图里图标也变蓝）。
   图标不是 <text>，拿不到 color: inherit，得显式指定。 */
.dd__item.is-selected .dd__icon {
  color: $ui-accent-text;
}

.dd__item.is-selected .dd__label {
  font-weight: 500;
}
</style>

