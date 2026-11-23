<template>
  <view
    class="vd"
    :class="themeClass"
    :style="[themeVars, frameStyle]"
    @touchstart="onEdgeStart"
    @touchend="onEdgeEnd"
  >
    <!-- 彩色弥散底：四团很淡的光从四角渗进来，卡片做成半透，光就透在缝里。
         不用模糊滤镜（安卓机上一糊就掉帧），靠 radial-gradient 自己做柔边。 -->
    <view class="vd__aurora" />

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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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

/* 换栏时把「多滑出来的位移」清零，否则万一某次手指抬起的事件没接住，
 * 轨道会停在两栏中间（画面上就是内容被裁掉一半） */
watch(tabIndex, () => {
  edgeOffset.value = 0
  dragging.value = false
})

function onEdgeDrag(offset) {
  if (!offset) {
    dragging.value = false
    edgeOffset.value = 0
    return
  }
  // 往左多滑（负）= 去第二栏；往右多滑（正）= 回第一栏；反方向就顶住
  const blocked = (tabIndex.value === 0 && offset > 0) || (tabIndex.value === 1 && offset < 0)
  dragging.value = true
  /* 顶住时不是同心缩水（那太软），而是越推越沉：起手还能动，后半段几乎推不动 */
  edgeOffset.value = blocked ? Math.sign(offset) * ((Math.abs(offset) * 0.34) / (1 + Math.abs(offset) / 150)) : offset
}

function onEdgeRelease(payload) {
  const offset = payload && typeof payload.offset === 'number' ? payload.offset : 0
  dragging.value = false
  // 换栏要「确实拉出去一大截」才认，避免轻轻一拂就跳栏
  const threshold = 96
  const toRecipe = tabIndex.value === 0 && offset < -threshold
  const toPassword = tabIndex.value === 1 && offset > threshold
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
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-bg);
  overflow: hidden;

  /* 卡片与胶囊半透：底下的光透上来一点点，页面才不是「白纸贴色块」 */
  --ui-surface: rgba(255, 255, 255, 0.62);
  --ui-raise: rgba(255, 255, 255, 0.4);

  /* 内容压在光层上面 */
  > *:not(.vd__aurora) {
    position: relative;
    z-index: 1;
  }

  &.theme-dark {
    --ui-surface: rgba(28, 30, 37, 0.76);
    --ui-raise: rgba(36, 38, 46, 0.56);
  }
}

/* 五团彩色弥散光：左上湖蓝、右上蜜桃、中右薄荷、左下暖沙、右下藕紫。
   低饱和、大半径，是「窗外的光」而不是霓虹灯；柔边全靠 gradient 自己画，
   不用 filter: blur（安卓机上一糊就掉帧）。 */
.vd__aurora {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    /* 四个大色域互相咬合，铺满整屏 —— 小圆点只在边角亮，中间还是白的 */
      radial-gradient(120% 78% at -10% -14%, rgba(86, 146, 255, 0.62) 0%, rgba(86, 146, 255, 0) 62%),
    radial-gradient(118% 74% at 110% -8%, rgba(255, 122, 180, 0.5) 0%, rgba(255, 122, 180, 0) 60%),
    radial-gradient(130% 84% at 116% 62%, rgba(48, 206, 184, 0.44) 0%, rgba(48, 206, 184, 0) 64%),
    radial-gradient(128% 82% at -16% 92%, rgba(255, 176, 92, 0.46) 0%, rgba(255, 176, 92, 0) 66%),
    linear-gradient(165deg, #e9f0ff 0%, #f4f1ff 42%, #fff4ec 100%);
}

.theme-dark .vd__aurora {
  background:
    radial-gradient(120% 78% at -10% -14%, rgba(52, 96, 214, 0.62) 0%, rgba(52, 96, 214, 0) 62%),
    radial-gradient(118% 74% at 110% -8%, rgba(190, 70, 130, 0.46) 0%, rgba(190, 70, 130, 0) 60%),
    radial-gradient(130% 84% at 116% 62%, rgba(24, 140, 128, 0.42) 0%, rgba(24, 140, 128, 0) 64%),
    radial-gradient(128% 82% at -16% 92%, rgba(170, 106, 40, 0.4) 0%, rgba(170, 106, 40, 0) 66%),
    linear-gradient(165deg, #12151d 0%, #14131c 45%, #191418 100%);
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
