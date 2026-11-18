<template>
  <view v-if="visible" class="upd" @touchmove.stop.prevent>
    <view class="upd__card">
      <view class="upd__head">
        <text class="upd__title">{{ phase === 'installing' ? '正在打开安装器' : '正在下载新版本' }}</text>
        <text v-if="version" class="upd__chip">v{{ version }}</text>
      </view>

      <view class="upd__figure">
        <text class="upd__num">{{ shownPercent }}</text>
        <text class="upd__unit">%</text>
      </view>

      <view class="upd__track" :class="{ 'upd__track--done': phase === 'installing' }">
        <view class="upd__fill" :style="{ width: shownPercent + '%' }">
          <view class="upd__glow" />
        </view>
      </view>

      <text class="upd__meta">{{ metaText }}</text>

      <view class="upd__acts">
        <view v-if="phase !== 'installing'" class="upd__btn" hover-class="upd__btn--hover" @click="$emit('cancel')">
          取消
        </view>
        <view v-else class="upd__btn upd__btn--quiet">请稍等…</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'

/*
 * 下载进度弹层（2026-11-19）。
 *
 * 为什么自己画、不用 uni.showLoading：
 *   showLoading 是**系统原生**弹窗，样式改不了（就是那个深灰小方框抄着「下载中 50%」）；
 *   更糟的是每次调用都会把原生弹窗销毁重建 —— 原来每 5% 调一次，于是每 5% 闪一下、卡一下。
 * 自己画以后：进度条宽度靠 CSS transition 平滑推进，文字只是改个值，不会重建任何原生窗口。
 *
 * 数据口径：0~100 的整数百分比 + 已下载/总量（字节）+ 速度文字 + 剩余时间文字，
 * 全部由父组件算好传进来，这里只管画 —— 弱网下也不会出现「从 60% 退回 55%」这种抖动。
 */

const props = defineProps({
  visible: { type: Boolean, default: false },
  version: { type: String, default: '' },
  percent: { type: Number, default: 0 },
  loadedText: { type: String, default: '' },
  totalText: { type: String, default: '' },
  speedText: { type: String, default: '' },
  etaText: { type: String, default: '' },
  /** downloading | installing */
  phase: { type: String, default: 'downloading' },
})

defineEmits(['cancel'])

/** 百分比只做上下限保护：不进位、不倒吸 */
const shownPercent = computed(() => Math.max(0, Math.min(100, Math.round(props.percent || 0))))

const metaText = computed(() => {
  if (props.phase === 'installing') return '下载完成，正在唤起系统安装界面'
  const parts = []
  if (props.loadedText && props.totalText) parts.push(`${props.loadedText} / ${props.totalText}`)
  else if (props.totalText) parts.push(`共 ${props.totalText}`)
  if (props.speedText) parts.push(props.speedText)
  if (props.etaText) parts.push(props.etaText)
  return parts.join(' · ') || '正在连接更新服务器…'
})
</script>

<style lang="scss" scoped>
.upd {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 9800;
  display: flex;
  align-items: center;
  justify-content: center;
/* 这层要"压得住"：下载是阻塞操作，比 App 里那些轻蒙版（LoadingMask 的 $ui-scrim）
   需要更明显的压暗，否则卡片像浮在正常页面上，用户以为还能点。 */
  background-color: rgba(16, 22, 32, 0.32);
}

.upd__card {
  width: 560rpx;
  box-sizing: border-box;
  padding: 40rpx 36rpx 30rpx;
  border-radius: 32rpx;
  /* 用实色 surface 而不是半透明的 --ui-sheet-fill：弹层下面常是表格，
     半透明会把表头文字透上来，进度数字看着发虚 */
  background-color: var(--ui-surface, #ffffff);
  border: 1px solid $ui-border;
  box-shadow: 0 24rpx 64rpx rgba(16, 22, 32, 0.22);
}

.upd__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.upd__title {
  font-size: 30rpx;
  font-weight: 700;
  color: $ui-text;
}

.upd__chip {
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background-color: $ui-accent-soft;
  color: $ui-accent-text;
  font-size: 22rpx;
  font-weight: 600;
}

.upd__figure {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
  margin-top: 26rpx;
}

/* 等宽数字：百分比跳动时宽度不抖（大厂进度条上很常见的一个细节） */
.upd__num {
  font-size: 68rpx;
  font-weight: 700;
  line-height: 1;
  color: $ui-text;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}

.upd__unit {
  font-size: 28rpx;
  font-weight: 600;
  color: $ui-text-3;
}

.upd__track {
  position: relative;
  margin-top: 24rpx;
  height: 12rpx;
  border-radius: 999rpx;
  background-color: $ui-surface-3;
  overflow: hidden;
}

.upd__fill {
  position: relative;
  height: 100%;
  border-radius: 999rpx;
  background-image: linear-gradient(90deg, $ui-accent 0%, $ui-accent-2 100%);
  /* 平滑的关键：宽度变化交给浏览器补间，js 只是每 100ms 交一个新值 */
  transition: width 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.upd__glow {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 24rpx;
  background-image: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.55) 100%);
}

.upd__track--done .upd__fill {
  background-image: linear-gradient(90deg, $ui-success 0%, $ui-success 100%);
}

.upd__meta {
  display: block;
  margin-top: 18rpx;
  font-size: 24rpx;
  color: $ui-text-3;
  font-variant-numeric: tabular-nums;
}

.upd__acts {
  margin-top: 30rpx;
  display: flex;
  justify-content: flex-end;
}

.upd__btn {
  padding: 16rpx 40rpx;
  border-radius: 999rpx;
  border: 1px solid $ui-border;
  font-size: 26rpx;
  color: $ui-text-2;
}

.upd__btn--hover {
  background-color: $ui-raise-2;
}

.upd__btn--quiet {
  border-color: transparent;
  color: $ui-text-3;
}
</style>
