<script setup>
import { computed, nextTick, ref, watch } from 'vue'

/*
 * 左侧抽屉的**外壳**：弹层、跟手拖拽、开合吸附、底层锁滚动。
 * 抽屉的内容（品牌区、导航列表、底部账户区）由调用方通过默认插槽传进来 ——
 * 它在父组件里渲染，不参与这里的每帧更新。
 *
 * ===== 为什么单独拆一个组件（别合并回 index.vue）=====
 * 跟手拖拽每一帧都要改位移，而位移必须走响应式才能落到 DOM 上。
 * 如果这份状态留在 index.vue 里，**每帧都会重跑那个上万行的 render** ——
 * 12 个 Tab 的表格、弹层、筛选行全部重新 patch 一遍，手感就是"掉帧、发涩"。
 * 拆出来之后每帧只重渲染这个小壳，页面主体完全不动。
 * 真机上从"发涩"到"跟手"的差别就来自这一层隔离。
 *
 * ===== 为什么不用 wd-popup 自带的滑入动画 =====
 * 跟手要求"手指停在哪、抽屉就停在哪"，而组件只会在这两个端点之间做固定时长的补间。
 * 所以把 duration 设成 0（组件不做动画），位移完全由 drawerProgress 驱动、
 * 写进弹层的 custom-style，吸附动画交给我们自己挂的 transition。
 *
 * ⚠️ App 端的 Vue 跑在独立 JS 引擎里，**没有 window / document** ——
 *    取屏幕宽度只能用 uni.getSystemInfoSync()，别去碰 window。
 */
const DRAWER_EDGE = 22 // 左缘起手区宽度（CSS px）
const DRAWER_SNAP_MS = 260 // 松手吸附时长，与弹层上的 transition 保持一致
const DRAWER_SNAP_P = 0.33 // 位移超过抽屉宽度的这个比例就吸附过去
const DRAWER_FLING_V = 0.35 // 速度阈值（px/ms）；够快就不看位移
const DRAWER_AXIS_MIN = 6 // 方向判定阈值，小于它不算手势、不动抽屉

// 弹层的**静态**样式在 App.vue 的 .nav-drawer__popup 上（走 custom-class 挂上去）。
// custom-style 只放每帧会变的那一小段 —— 跟手拖拽每帧都要把这份串送过桥，
// 静态部分留在里面等于每帧白传 200 多个字符。

const visible = ref(false)

/*
 * ⚠️ 弹层是 **v-if="visible"**（见模板）：抽屉走完收起动画就整个卸载，**不留 wd-popup
 *    自带的 leave 淡出尾巴**。这条是"点汉堡有概率没反应"的另一半，别改回常驻渲染。
 *
 * 真机实测：点遮罩关抽屉，260ms 动画结束后 wd-popup 还会把遮罩再淡出 260ms 才
 * display:none。这 260ms 里遮罩已经全透明、却照样吃点击 —— 在它底下点汉堡，
 * 事件落在这个看不见的遮罩上，抽屉纹丝不动。用户看到的就是"关了之后有一阵子
 * 点汉堡没反应"（实测 +0.26s / +0.35s / +0.50s 三个采样点全失败，正好落在这段尾巴里）。
 *
 * 换成 v-if 之后没有尾巴，代价是遮罩也少了一段自己的淡出 —— 那一段改由
 * popupModalStyle 按 progress 亲自驱动（见那里的说明），观感一致。
 *
 * ⚠️ v-if 不会毁掉"从侧边滑出来"的入场动画：wd-transition 在 onBeforeMount 里
 *    发现 show 为真就会自己播 enter（源码里 enter() 走 pause() 分帧加类名）。
 *    真机上量过展开过程中弹层的 translateX 是连续变化的，不是一步到位。
 */

// ⚠️ 初值必须是 0：`progress` 描述的是"抽屉露出来多少"，关着时就是 0。
//   曾经写成 1（想表达"打开时是全开"），结果是**单独点一下左缘**就能把抽屉打开 ——
//   因为那次手势没定轴、没改过进度，松手时按初值 1 判定成了"展开"。
const progress = ref(0) // 1 = 完全展开，0 = 完全收起
const dragging = ref(false) // 拖动中：关掉 transition，跟手
const settling = ref(false) // 松手后的吸附动画进行中（这段时间仍由我们控制位移）

// 弹层宽度 = min(width:78vw, max-width:620rpx)。rpx→px 是 屏宽/750。
function drawerWidthPx() {
  const info = (uni.getSystemInfoSync && uni.getSystemInfoSync()) || {}
  const w = info.windowWidth || 375
  return Math.min(w * 0.78, (620 / 750) * w)
}

// 一次拖动的会话。用普通对象而不是 ref：拖动过程每帧都要读写，
// 放进响应式只会白白触发重渲染。
let drag = null

// 这一次手势是不是落在导航列表里 —— 由父组件在列表上打标（列表在插槽里，这里够不着）。
// 用途见 innerMove：不在列表里的手势要挡掉默认行为，在列表里的要放行让它自己滚。
let gestureInList = false

function beginDrag(e, fromEdge) {
  const t = e.touches && e.touches[0]
  if (!t) return
  drag = {
    fromEdge,
    x0: t.clientX,
    y0: t.clientY,
    axis: '', // '' 未定向 | 'x' 拖抽屉 | 'y' 交还给页面滚动
    w: drawerWidthPx(),
    lastX: t.clientX,
    lastT: Date.now(),
    v: 0, // px/ms，向右为正
  }
}

function moveDrag(e) {
  if (!drag) return
  const t = e.touches && e.touches[0]
  if (!t) return
  const dx = t.clientX - drag.x0
  const dy = t.clientY - drag.y0

  if (!drag.axis) {
    if (Math.abs(dx) < DRAWER_AXIS_MIN && Math.abs(dy) < DRAWER_AXIS_MIN) return
    drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    // 判成纵向就整段交还给页面，别抢页面自己的滚动
    if (drag.axis === 'y') {
      drag = null
      return
    }
    if (drag.fromEdge) {
      // 方向一确认就立刻把抽屉挂上。触摸事件的 target 在 touchstart 时就定死了，
      // 所以后面的事件仍然归本元素，不会因为弹层出现而中断这次手势。
      visible.value = true
      progress.value = 0
    }
    dragging.value = true
  }

  const now = Date.now()
  if (now - drag.lastT > 12) {
    drag.v = (t.clientX - drag.lastX) / (now - drag.lastT)
    drag.lastX = t.clientX
    drag.lastT = now
  }

  const p = drag.fromEdge ? dx / drag.w : 1 + dx / drag.w
  progress.value = p < 0 ? 0 : p > 1 ? 1 : p
}

// 松手后的吸附动画期间仍要由我们控制位移（否则内联 transform 一撤，元素会瞬间跳到端点）
let settleTimer = null
function settle() {
  settling.value = true
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settling.value = false
  }, DRAWER_SNAP_MS)
}

// 收起时先走到 0 再卸载：不等动画走完就置 visible=false 的话，弹层会"啪"地消失
let unloadTimer = null
function unloadWhenClosed() {
  clearTimeout(unloadTimer)
  unloadTimer = setTimeout(() => {
    if (!progress.value) visible.value = false
  }, DRAWER_SNAP_MS)
}

function endDrag(e) {
  if (!drag) return
  // 补一次"落点"：有些机型（以及 adb 的 input swipe 这类注入）会漏掉中间的 touchmove 帧，
  // 整个手势只剩 touchend 的位置。不补的话，一次"滑得很快"会被当成"没滑过"而回弹。
  const t = e && e.changedTouches && e.changedTouches[0]
  if (t && !drag.axis) {
    const dx = t.clientX - drag.x0
    const dy = t.clientY - drag.y0
    if (Math.abs(dx) > DRAWER_AXIS_MIN && Math.abs(dx) > Math.abs(dy)) {
      drag.axis = 'x'
      if (drag.fromEdge) {
        visible.value = true
        progress.value = 0
      }
      const p = drag.fromEdge ? dx / drag.w : 1 + dx / drag.w
      progress.value = p < 0 ? 0 : p > 1 ? 1 : p
    }
  }

  const { fromEdge, v } = drag
  const wasTap = !drag.axis // 没定过轴 = 手指基本没动，这是一次点按
  const p = progress.value
  drag = null
  dragging.value = false

  /*
   * 收起动画里点到抽屉上 = 把它叫回来。
   *
   * ⚠️ 这是"点汉堡有概率没反应"的另一半（尾巴那半见 visible 上面的说明）。
   *    面板宽 78vw，汉堡在 x≈36 —— 收起时面板整个压着汉堡，点击的落点是面板
   *    （真机实测落中 `drawer__title`），汉堡根本收不到，抽屉就"点了没反应"。
   *    面板已经在往外走、这一下又是点按而不是拖动，那用户点的就是正在离开的这块玻璃，
   *    那就让它回来 —— 把点击透给下层页面反而更糟（真机实测会误触到下层表格里的
   *    日期控件，弹出选择器）。
   *
   * ⚠️ 必须排除拖动（wasTap）：左滑收起那一下绝不能被当成"点按"又把抽屉叫回来。
   * ⚠️ 排除 fromEdge：那是页面左缘起手的手势，不是点抽屉。
   */
  if (wasTap && !fromEdge && p < 1) {
    open()
    return
  }

  // ⚠️ 变量名不能叫 open：同名的函数 open() 在上面那段里被调用，局部 const 的
  //    TDZ 会让那次调用直接抛 ReferenceError。
  const willOpen = fromEdge
    ? p > DRAWER_SNAP_P || v > DRAWER_FLING_V
    : !(p < 1 - DRAWER_SNAP_P || v < -DRAWER_FLING_V)

  if (willOpen) {
    visible.value = true
    progress.value = 1
    settle()
  } else {
    progress.value = 0
    settle()
    unloadWhenClosed()
  }
}

function open() {
  // ⚠️ 这里**不能**写成 `if (visible.value) return`。
  //    收起动画那 260ms 里 visible 仍是 true（只是在等卸载），那样写会把这次点击
  //    整个丢掉 —— 真机上的表现就是"有时候点汉堡没反应"，正好是刚关完再点的那一下。
  clearTimeout(unloadTimer)
  if (visible.value && progress.value === 1) return // 已经全开，不用做事
  if (visible.value) {
    // 正在收起：别重新挂载（那会打断动画），把进度推回 1、用我们自己的 transition 滑回来
    progress.value = 1
    settle()
    return
  }
  // ⚠️ 这里**不要**再"先挂载成收起态、下一帧再置 1"。
  //   那条路要求我们自己把位移从 -100% 补到 0，可弹层刚挂上时还没有前值、
  //   transition 根本不会触发 —— 真机上的表现就是"啪"地出现，没有从侧边滑出来。
  //   改成：进度直接置 1、**不写内联 transform**，这样 wd-popup 自带的 slide-left
  //   入场动画就能跑（它才是"从侧边滑出来"）。内联 transform 只在拖动/吸附期间写。
  progress.value = 1
  dragging.value = false
  settling.value = false
  visible.value = true
}

// 收起统一走这里：点遮罩、菜单项、登录/退出都会走它。
// ⚠️ 不能直接把 visible 置 false —— 那样弹层立刻卸载、没有收起动画。
function close() {
  /*
   * ⚠️ 展开动画还没走完就先**不受理关闭**。
   * 那 260ms 里用户点到的其实是遮罩（它盖在顶栏上），不拦的话刚拉开的抽屉
   * 会被立刻关回去 —— 观感就是"点了没打开"。拦掉之后这一下等于没反应，抽屉保持打开。
   */
  if (settling.value && progress.value === 1) return
  /*
   * ⚠️ 收起途中（progress 已经是 0）再点遮罩，这里也是**故意**不受理、静默吞掉。
   *    那一段里的点击由"面板叫回来"（见 endDrag）和遮罩放行（见 popupModalStyle）负责，
   *    这里只是把 wd-popup 自己那条路径堵上，免得同一次点击被处理两遍。
   */
  if (dragging.value || !visible.value || !progress.value) return
  progress.value = 0
  settle()
  unloadWhenClosed()
}

// ===== 暴露给调用方的三个入口 =====
// 页面左缘起手（父组件的 .page 上绑着 touch 事件）与抽屉内起手都从这里进。
// 用命令式方法而不是把状态提到父组件：调用这些方法**不会**触发父组件重渲染，
// 每帧的开销才被关在这个组件里 —— 这是这个组件存在的全部理由。
function edgeStart(e) {
  if (visible.value) return
  const t = e.touches && e.touches[0]
  if (!t || t.clientX > DRAWER_EDGE) return
  beginDrag(e, true)
}
function edgeMove(e) {
  if (drag && drag.fromEdge) moveDrag(e)
}
function innerStart(e) {
  beginDrag(e, false)
}
function innerMove(e) {
  /*
   * ⚠️ 这一行是"抽屉打开时，在它的空白处上下滑不能带动底层"的**唯一**手段。
   * 抽屉里那块空白（导航列表下面的空档）不属于任何滚动容器，不挡默认行为的话，
   * 浏览器会顺着滚动链一路找到页面本体、把底层滚走。
   * 真机实测：在空白处上滑，底层 scrollingElement.scrollTop 从 0 变成 154；
   * 在 `.nav-drawer` 上加 preventDefault 之后恒为 0。
   *
   * 但**不能无条件挡** —— 那样导航列表自己也滚不动了（实测列表 scrollTop 恒为 0）。
   * 所以按"这次手势起手在哪"分：列表里的放行，其余（空白、品牌区、底部账户区）挡掉。
   * 列表内部滚到头之后会不会把底层带起来，由 .drawer__list 里的
   * overscroll-behavior: contain 负责（见 App.vue）。
   */
  if (visible.value && !gestureInList && e && e.preventDefault) e.preventDefault()
  if (drag && !drag.fromEdge) moveDrag(e)
}

// 给父组件用：列表起手/松手时打标
function setListGesture(v) {
  gestureInList = v
}

defineExpose({ open, close, edgeStart, edgeMove, innerStart, innerMove, setListGesture, endDrag })

// 弹层的位移与过渡。拖动中关掉 transition（否则每帧都在补间，跟不上手）；
// 松手后交回 transition，由它把抽屉吸附到端点。
const popupStyle = computed(() => {
  const transition = dragging.value
    ? 'none'
    : `transform ${DRAWER_SNAP_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
  // 只有"位移由我们驱动"的时候才写 transform：
  //   拖动中 / 吸附动画中 / 还没展开（收起态要停在 -100%）。
  // **点汉堡展开时不写** —— 让弹层上没有内联 transform，wd-popup 的 slide-left 才有戏。
  const own = dragging.value || settling.value || progress.value < 1
  const shift = (progress.value - 1) * 100
  return `transition: ${transition};` + (own ? ` transform: translateX(${shift}%);` : '')
})

/*
 * 遮罩的明暗**由 progress 亲自驱动**，不再借 wd-popup 自己的淡出。
 *
 * ⚠️ 因为弹层改成了 v-if（见 visible 上面的说明），visible 一置假它就整个卸载，
 *    wd-transition 那套 enter/leave 淡出没有机会播 —— 遮罩的淡出得我们自己来，
 *    否则抽屉滑走那一刻整块页面会"啪"地亮起来。
 *
 * progress 在同一时刻跳 1→0，而遮罩自带 DRAWER_SNAP_MS 的 transition，于是它和
 * 面板的滑出**同时起步、同步淡完**（比原来"抽屉先走完、遮罩再淡 260ms"更整）。
 * 拖动中把 transition 关掉，让明暗跟手（不然会慢半拍）。
 *
 * ⚠️ 只在 progress < 1 时写内联值：展开那一下 progress 就是 1，留空才能让
 *    wd-popup 自带的入场淡入照常播（内联 opacity 会压掉它的类名动画）。
 */
const popupModalStyle = computed(() => {
  if (progress.value >= 1) return 'background: transparent;'
  const ease = dragging.value ? 'none' : `opacity ${DRAWER_SNAP_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
  /*
   * ⚠️ pointer-events: none 是这条的另一半，别删。
   *    面板滑到一半之后右缘就离开汉堡了（实测 130ms 左右），那之后盖住汉堡的只剩这块遮罩；
   *    遮罩若照常吃点击，点汉堡就还是"没反应"（真机实测落点就是 wd-overlay，
   *    它底下紧挨着 topbar__btn）。这一段遮罩的 opacity 已经淡到 0.3 以下、几乎看不见，
   *    用户这时候点的本来就是他看到的页面 —— 放行落点正是他要的东西。
   *    面板那一半由 endDrag 里的"叫回来"负责（面板压在遮罩之上，先接住点击）。
   */
  return `background: transparent; transition: ${ease}; opacity: ${progress.value}; pointer-events: none;`
})

// 抽屉展开时锁住底层滚动。
// App 端：遮罩（wd-overlay）自带 `@touchmove.stop.prevent`，而它铺满整屏、
//   压在页面之上，所以触摸滚动本来就被挡住了 —— 真机实测：抽屉展开后在右侧
//   页面区域连续上滑，document.scrollingElement.scrollTop 一动不动。
// H5 端：**滚轮**不受 touchmove 影响，遮罩挡不住，得单独把 body 的 overflow 关掉。
//   （逻辑层在 App 端没有 document，所以这段只在 H5 编进去。）
watch(visible, (open) => {
  // #ifdef H5
  try {
    document.body.classList.toggle('is-drawer-open', open)
  } catch {
    // 拿不到 document 就只靠遮罩
  }
  // #endif
})
</script>

<template>
  <!-- ⚠️ v-if 不是可有可无的：它砍掉 wd-popup 自带的 leave 淡出尾巴（那 260ms 里
       遮罩已经全透明却照样吃点击，是"点汉堡有概率没反应"的成因之一）。
       详见 script 里 visible 上面的说明，别改成常驻渲染。 -->
  <wd-popup
    v-if="visible"
    :model-value="visible"
    :duration="DRAWER_SNAP_MS"
    position="left"
    safe-area-inset-bottom
    :modal-style="popupModalStyle"
    custom-class="nav-drawer__popup"
    :custom-style="popupStyle"
    @update:model-value="close"
  >
    <!-- 这一层只为了接手势：它必须包住插槽内容，因为"抽屉内左滑收起"要让触摸
         从内容冒泡上来。flex:1 是为了把弹层的 flex 布局原样传给里面的 .drawer。 -->
    <view
      class="nav-drawer"
      @touchstart="innerStart"
      @touchmove="innerMove"
      @touchend="endDrag"
      @touchcancel="endDrag"
    >
      <slot />
    </view>
  </wd-popup>
</template>

<style lang="scss" scoped>
.nav-drawer {
  display: flex;
  flex: 1;
  flex-direction: column;
  /* min-height: 0 是 flex 子项能正确收缩的前提，否则里面的 scroll-view 撑不出滚动条 */
  min-height: 0;
  /*
   * ⚠️ 别删。抽屉里是一个纵向 scroll-view，浏览器判定"这手势归谁滚"时会**取消**它不认的
   * 触摸序列（touchcancel）—— 表现是横向拖到一半突然断掉、后面的位移全丢（真机实测：
   * 十段位移只有前五段生效，后面直接 snap）。
   * pan-y = 只允许纵向平移：内层列表照常上下滚，横向手势不会被判成"要滚页面"而取消，
   * 稳稳交给我们自己的跟手逻辑。
   */
  touch-action: pan-y;
}
</style>
