<template>
  <view
    class="vd"
    :class="themeClass"
    :style="[themeVars, frameStyle]"
    @touchstart="onEdgeStart"
    @touchend="onEdgeEnd"
  >
    <PageTitle title="密码箱" />

    <view v-if="!allowed" class="vd__deny">
      <text class="vd__deny-title">只有管理员能看</text>
      <text class="vd__deny-text">这是你自己账号的密码。换个管理员账号登录才有。</text>
    </view>

    <template v-else>
      <!-- 一级只有两格：拿它去「查密码」，还是去「抄配方」 -->
      <view class="vd__tabs">
        <view class="vd__seg-pill" :class="{ 'is-right': tabIndex === 1 }" />
        <view class="vd__tab" :class="{ 'is-on': tabIndex === 0 }" @click="goTab(0)">密码</view>
        <view class="vd__tab" :class="{ 'is-on': tabIndex === 1 }" @click="goTab(1)">配方</view>
      </view>

      <!-- 两栏并排常驻，点胶囊就是把这整条轨道左右平移 —— 同一块屏里滑，
           不是换页面，所以没有「重建 → 空一帧」的空档，也不会像抽屉那样从边上弹出来。 -->
      <view class="vd__viewport">
        <view class="vd__track" :class="{ 'is-dragging': dragging }" :style="trackStyle">
          <view class="vd__pane">
            <VaultPane
              ref="vaultPane"
              @edge-drag="onEdgeDrag"
              @edge-release="onEdgeRelease"
            />
          </view>
          <view class="vd__pane">
            <SnippetsPane
              ref="snippetsPane"
              @edge-drag="onEdgeDrag"
              @edge-release="onEdgeRelease"
            />
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import PageTitle from '../../components/PageTitle.vue'
import VaultPane from '../../components/vault/VaultPane.vue'
import SnippetsPane from '../../components/vault/SnippetsPane.vue'
import { useTheme } from '../../composables/useTheme'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'
import { isAdmin } from '../../api/auth'

const { themeClass, themeVars } = useTheme()
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

const allowed = computed(() => isAdmin())

const tabIndex = ref(0)
const vaultPane = ref(null)
const snippetsPane = ref(null)

/* 栏内滑到头之后，多出来的位移记在这儿，整条轨道跟着手指走（1:1，不另设阻尼） */
const edgeOffset = ref(0)
const dragging = ref(false)

/* 轨道宽 200%，每挪一格就是 50% —— 用百分比，屏宽变了也不用重新量 */
const trackStyle = computed(() => ({
  transform: `translate3d(calc(${-tabIndex.value * 50}% + ${edgeOffset.value}px), 0, 0)`,
}))

const panes = () => [vaultPane.value, snippetsPane.value]

function onEdgeDrag(offset) {
  if (!offset) {
    dragging.value = false
    edgeOffset.value = 0
    return
  }
  // 第一栏往左多滑 = 去第二栏；第二栏往右多滑 = 回第一栏；反方向就顶住
  const blocked = (tabIndex.value === 0 && offset < 0) || (tabIndex.value === 1 && offset > 0)
  dragging.value = true
  edgeOffset.value = blocked ? offset * 0.28 : offset
}

function onEdgeRelease(payload) {
  const offset = payload && typeof payload.offset === 'number' ? payload.offset : 0
  dragging.value = false
  const threshold = 56
  const toRecipe = tabIndex.value === 0 && offset > threshold
  const toPassword = tabIndex.value === 1 && offset < -threshold
  if (toRecipe) {
    tabIndex.value = 1
    snippetsPane.value?.focusFirst()
    reloadPane(1)
  } else if (toPassword) {
    tabIndex.value = 0
    vaultPane.value?.focusLast()
    reloadPane(0)
  }
  edgeOffset.value = 0
}

/** 组件里没有页面 onShow，回本页/切页签时由宿主挨个叫醒需要刷新的那一栏 */
async function reloadPane(index) {
  const pane = panes()[index]
  if (pane && typeof pane.reload === 'function') await pane.reload()
}

onLoad((query) => {
  // 支持 ?tab=recipe 直接落在配方那栏（比如从聊天里点链接过来）
  if (query && query.tab === 'recipe') tabIndex.value = 1
})

onShow(() => {
  reloadPane(tabIndex.value)
})

/* 冷启动时页面 onShow 可能早于两栏挂载完成（此时 ref 还是 null，onShow 那次就没刷到），
 * 所以挂载完再补一次；reload 里带了「已经在同步就跳过」，不会重复发请求。 */
onMounted(() => {
  nextTick(() => {
    reloadPane(tabIndex.value)
    // 另一栏不常用的那次也顺手拉一遍，切过去时不会先看到空列表
    reloadPane(tabIndex.value === 0 ? 1 : 0)
  })
})

function goTab(index) {
  if (index === tabIndex.value) return
  tabIndex.value = index
  reloadPane(index)
}
</script>

<style lang="scss" scoped>
.vd {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-bg);
  overflow: hidden;
}

.vd__deny {
  margin: 120rpx 40rpx;
  padding: 48rpx 32rpx;
  border-radius: 24rpx;
  background: var(--ui-surface);
  text-align: center;
}

.vd__deny-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.vd__deny-text {
  display: block;
  margin-top: 12rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--ui-text-2);
}

.vd__tabs {
  position: relative;
  display: flex;
  gap: 10rpx;
  margin: 0 16rpx;
  padding: 6rpx;
  border-radius: 22rpx;
  background: var(--ui-raise, var(--ui-surface));
}

/* 白底块跟着选中的那一格走，文字只换颜色 —— 底色连续，才像同一块在移动 */
.vd__seg-pill {
  position: absolute;
  left: 6rpx;
  top: 6rpx;
  bottom: 6rpx;
  width: calc(50% - 11rpx);
  border-radius: 18rpx;
  background: var(--ui-surface);
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
  transition: transform 260ms cubic-bezier(0.22, 0.68, 0.16, 1);

  &.is-right {
    transform: translateX(calc(100% + 10rpx));
  }
}

.vd__tab {
  position: relative;
  z-index: 1;
  flex: 1;
  height: 64rpx;
  line-height: 64rpx;
  text-align: center;
  font-size: 27rpx;
  color: var(--ui-text-2);
  transition: color 180ms ease;

  &.is-on {
    color: var(--ui-text);
    font-weight: 600;
  }
}

.vd__viewport {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.vd__track {
  display: flex;
  width: 200%;
  height: 100%;
  transition: transform 300ms cubic-bezier(0.22, 0.68, 0.16, 1);
  will-change: transform;

  /* 手指按着的时候不能有过渡，否则轨道会「跟不上」，手感就变重了 */
  &.is-dragging {
    transition: none;
  }
}

.vd__pane {
  width: 50%;
  height: 100%;
}
</style>
