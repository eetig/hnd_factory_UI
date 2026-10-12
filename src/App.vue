<script setup>
import { onLaunch } from '@dcloudio/uni-app'
import request from './api/request'
import { getToken, saveAuth } from './api/auth'
import { hasStoredRole } from './api/storage'

// 启动后恢复角色与权限：token 在本地存储里，角色信息需重新拉取。
// 沿用改造前的策略 —— 最多等 3 秒，避免后端不可用时阻塞启动。
function restoreAuth() {
  if (!getToken() || hasStoredRole()) return Promise.resolve()

  return Promise.race([
    request.get('/api/user/info').then((res) => saveAuth(res.data || {})),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).catch(() => {
    // token 失效时由 request 的响应处理统一清理并跳登录页
  })
}

onLaunch(() => {
  restoreAuth()
})
</script>

<style lang="scss">
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ==========================================================================
   主题变量（深色 / 浅色两套）
   --------------------------------------------------------------------------
   改造前颜色是「构建期写死」的：tailwind.config.js 把 slate/white 直接映射成
   深色字面量，uni.scss 里也是 #0b0b0e 这种常量 —— 想换主题只能重新编一份样式，
   运行时切不了。

   现在颜色只剩一个来源：这一组 CSS 变量（值放在 src/uni.scss 的两个 mixin 里，
   这里 @include 出来）。两条消费路径都指向它：
     · Tailwind 工具类 → tailwind.config.js 里映射成 var(--ui-*)
     · 组件 SCSS 令牌 → src/uni.scss 里同样映射成 var(--ui-*)
   于是「切主题」= 换一个类名，样式不用重新编译，也不会有漏网的写死色。

   ⚠️ 深色默认值的挂载点两端不同：
       小程序 / App：page（uni-app 没有 body/:root），浅色类挂在页面根 view 上；
        H5：body —— 见下面 page 规则与 #ifdef H5 段的注释（踩过的坑都在那里）。
   ⚠️ 变量值必须是完整的颜色字面量：SCSS 侧拿不到运行时值，
      所以令牌不能再参与 rgba()/darken() 这类编译期颜色运算。
   ========================================================================== */

// ===== 深色（默认）=====
// ⚠️ H5 端不要把变量挂在 page 上：page 在 H5 会被编译成 uni-page-body，
//    它自己一旦声明了深色值，就会**盖掉** body 上的浅色类（自定义属性是"最近的
//    声明点"胜出）—— 这正是实测里"浅色只对登录页生效、首页纹丝不动"的原因。
//    H5 的变量统一由下面的 body 规则提供（body 是页面内容与原生标题栏的共同祖先）。
page {
  /* #ifndef H5 */
  @include theme-dark-vars;
  /* #endif */

  // uni-app 没有 body/:root，等价选择器是 page。
  // 注意 page 只覆盖页面根，各页面的内容容器仍有自己的背景
  //（见 .page / .login-page），这样弹层、状态栏区域不会出现色差。
  min-height: 100vh;
  background-color: $ui-bg;
  color: $ui-text;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI',
    'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 28rpx;
  line-height: 1.5;
  // 深色底上禁用系统字体加粗渲染，避免小字号发虚
  -webkit-font-smoothing: antialiased;
}

// 全局动效定义（只此一份，组件里通过 @mixin panel-in 引用）。
// 放在 App.vue 而不是 uni.scss：uni.scss 会被注入到每个组件，
// 写 @keyframes 会造成重复产出、包体膨胀。
// ⚠️ 位移只能写 top，绝不能写 transform（踩过，别改回去）：
//    按 CSS 规范，元素上只要有一个非 none 的 transform，它就会成为后代
//    position: fixed 的包含块 —— 弹层与遮罩会被锁在面板范围内，弹层底边还会
//    跟着面板底边跑（周统计的日期弹层就是这样：面板矮、底边在屏幕中部，弹层
//    底部的「确定」被顶出可视区，点遮罩与点确定两条关闭路径同时失效）。
//    用 top 是纯绘制偏移，不建包含块、不建层叠上下文，观感与 transform 版一致；
//    配套的 position: relative 见 src/uni.scss 的 @mixin panel-in。
@keyframes ui-panel-in {
  from {
    opacity: 0;
    top: 12rpx;
  }

  to {
    opacity: 1;
    top: 0;
  }
}

// ===== 浅色：只覆盖同一组变量，结构 / 圆角 / 动效全部复用 =====
// 挂在各页面根 view 上（类名由 src/composables/useTheme.js 提供）。
.theme-light {
  @include theme-light-vars;
}

/* #ifdef MP-WEIXIN */
/* ⚠️ 微信小程序**原生不支持 backdrop-filter**（小程序不是浏览器，CSS 是子集）。
   玻璃膜（--ui-glass-fill 是 8% 白 / 66% 白）在小程序端会退化成"半透明但不模糊" ——
   背后表格的字和面板里的字叠在一起，两边都看不清。所以整块膜换成近不透明：
   配色、描边、三层投影都保留，只是失去透明的错觉。这就是玻璃在小程序端的兜底。
   （颗粒用的是 SVG data URI，WXSS 对它的支持不保证；不生效也只是少一层质感，不影响可读性。） */
page {
  --ui-glass-fill: rgba(20, 35, 58, 0.96);
  --ui-glass-fill-hover: rgba(28, 46, 74, 0.98);
}

.theme-light {
  --ui-glass-fill: rgba(255, 255, 255, 0.96);
  --ui-glass-fill-hover: #ffffff;
}
/* #endif */

/* #ifdef APP-PLUS */
/* App：page 之外还有 html / body 两层，**它们默认是白的**。
   App 里 100vh 不含系统栏，页面与 page 都只铺到约 96% 屏高，底下那条约 27px
   露出来的就是这层白 —— 真机实测底部是 rgb(255,255,255)，而再往上一格是
   rgb(227,228,233)（场景边缘色），两个色摆在一起就是"最底层跟 App 不是一个颜色"。
   设成透明，让下面那层「窗口底色」透上来；那个颜色由 useTheme 的 applyNativeChrome
   用 uni.setBackgroundColor 按主题设过（底部给的就是场景边缘色），接得上。
   ⚠️ 用 APP-PLUS 而不是 #ifndef H5：小程序里根本没有 html/body，
      而且它的页面本来就铺满整屏、不存在这条缝；写进去只会留两条永不被选中的死声明。
   ⚠️ 也不要顺手在 H5 加这条：H5 的主题变量挂在 body 上，body 还得留着底色。 */
html,
body {
  background-color: transparent;
}
/* #endif */

/* #ifdef H5 */
/* H5 端的主题入口是 body —— 页面内容与原生标题栏的共同祖先，一次到位：
     1) 深色默认值铺在 body 上（page/uni-page-body 不再自己声明，见上面 page 的注释）；
     2) 浅色靠 body 上的 .theme-light 覆盖（由 src/composables/useTheme.js 直接挂类，
        不依赖页面组件的重新渲染）；
     3) 标题栏 <uni-page-head> 的颜色来自 pages.json 编译出的**内联样式**，
        只能用 !important 压掉；返回箭头是内联 <svg fill="#ffffff">，
        用 fill: currentColor 跟着文字色走（表现属性优先级低于任何 CSS 规则）。 */
body {
  @include theme-dark-vars;
}

uni-page-head .uni-page-head {
  background-color: $ui-bg !important;
  color: $ui-text !important;
}

uni-page-head .uni-page-head svg path {
  fill: currentColor;
}

/* 抽屉展开时锁住底层滚动。
   触摸那一路由遮罩负责（wd-overlay 带 @touchmove.stop.prevent，且铺满整屏压在最上层，
   真机实测抽屉展开后滑动页面区域，scrollTop 不动）；**滚轮不受 touchmove 约束**，
   桌面浏览器上照样能把底层滚走，所以这里单独关掉 body 的滚动。
   类名由 index.vue 的 watch(menuVisible) 挂/摘，仅 H5 端（App 逻辑层没有 document）。 */
body.is-drawer-open {
  overflow: hidden;
}
/* #endif */

// 主题切换按钮上的「半明半暗」圆点（两个页面共用，所以放全局）。
// 用纯 CSS 画，不依赖图标字体 —— wot 的图标集里没有太阳/月亮。
//
// 左右两半都要填色：右半留透明时，可见实体只剩「左半直线 + 右半圆弧」，
// 小尺寸下会被读成半月 / 椭圆（顶栏那枚 32rpx 的点上尤其明显）。两侧都上色后
// 轮廓才是完整正圆，明暗指向仍是「光照 / 对比度」的隐喻。
.theme-dot {
  width: 32rpx;
  height: 32rpx;
  flex: 0 0 auto; // 不被 flex 压扁，几何上保证是正圆
  box-sizing: border-box; // 外径就是 32rpx（描边画在框内）
  border: 2rpx solid $ui-text-2;
  border-radius: 50%;
  background-image: linear-gradient(90deg, $ui-text-2 0 50%, $ui-text-3 50% 100%);
  transition: transform $ui-dur $ui-ease;
}

// 浅色下整体翻面 + 转半圈：亮的那半从左边转到右边，像把「光」翻了过来
.theme-dot.is-light {
  transform: rotate(180deg);
}

// H5 端 scroll-view 会显示一条浅色滚动条，深色主题下很刺眼，统一隐藏。
// （小程序端 scroll-view 自带 scrollbar 由 show-scrollbar 属性控制，不冲突。）
::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

/* ===== 玻璃：wot 弹层（玻璃预算里的"浮层"档）=====
   wot 弹层的表面色来自它自己的主题变量、不是本仓的 token，所以在这里统一套上玻璃材质。
   膜色由各弹层的 custom-style 用 var(--ui-glass-fill) 指定（见各 Dialog 组件），
   这里只补"模糊 / 饱和增强 / 描边 / 三层投影"—— 两处分工，避免同一个属性各写一份。

   ⚠️ 排除抽屉（.wd-popup--left）：它自己就是一块玻璃（.drawer 上有完整材质），
      在这里再套一层会叠成两层 blur，把抽屉调好的手感改掉。
   ⚠️ 整块包在 #ifndef MP-WEIXIN 里：微信小程序不支持 backdrop-filter，
      留在产物里就是两条被忽略的死声明（本项目一贯不留）。小程序端靠上面那段
      MP 兜底把膜换成近不透明。 */

/* #ifndef MP-WEIXIN */
/* ⚠️ 模糊画在 ::before 上，**绝不能直接写在 .wd-popup 上**。
   带 backdrop-filter / filter / transform 的元素会成为后代 `position: fixed` 的
   **包含块**，而 wd-popup 本身正是 fixed、又几乎总是"外层"（表单弹层里再开日期、
   物料选择器，页面筛选行里再开日期弹层）。它一旦成了包含块，内层弹层就会被钉进
   它的盒子里、并被它的 overflow 裁掉：
     真机实测（月底储罐液位记录 → 新增 → 选「记录日期」）：日期弹层被摆成 x=1 / 宽 392
     —— 正好是对话框内容盒内缩 1px 边框；头部（胶囊 +「确定」）在 y=285..334，
     整个落在对话框上边界 y=336 之外被裁掉。日期选完没有可点的「确定」，
     人就被关在日历里出不来（就是使用方报的那条）。
   挪到 ::before 之后弹层不再造包含块，内层弹层照常按视口定位、也不会被裁。
   ⚠️ ::before 必须 pointer-events: none，否则这一层会挡住弹层里所有点击。
   （同一个坑的"面板版"早就踩过并绕开了，见 pages/index/index.vue 的 .panel 注释：
     面板因此**故意**不加 backdrop-filter。弹层这次是漏网的同一个坑。） */
.wd-popup:not(.wd-popup--left)::before {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: -1; // 膜在弹层自身底色之下（和原来"先模糊背景、再叠底色"的次序一致）
  border-radius: inherit; // 圆角来自各弹层的 custom-style，这里跟着走
  content: '';
  backdrop-filter: blur($ui-glass-blur) saturate($ui-glass-sat);
  -webkit-backdrop-filter: blur($ui-glass-blur) saturate($ui-glass-sat);
  pointer-events: none;
}

/* 描边与投影留在弹层根元素上：它们不造包含块，放这儿也少一层合成 */
.wd-popup:not(.wd-popup--left) {
  border: 1px solid $ui-glass-line;
  box-shadow: $ui-glass-elev;
}
/* #endif */

/* 导航列表滚到头之后，不要把滚动链传给底层页面。
   真机实测（抽屉展开、列表已滚到尽头再上滑）：不加这条时底层
   scrollingElement.scrollTop 会跟着涨；加上之后恒为 0。
   ⚠️ 目标是 uni-app 内部生成的滚动容器（`.drawer__list` 里那个
      class="uni-scroll-view" 的 div，overflow-y 是 auto、内容 1085 > 可见 435），
      所以选择器只能这么写、也只能放全局样式里 —— scoped 够不到别人家的内部类。 */
.drawer__list .uni-scroll-view {
  overscroll-behavior-y: contain;
}

/* ===== 导航抽屉的弹层（静态样式）=====
   跟手拖拽每帧都要把 custom-style 送过桥，所以静态部分挪到这里、由 custom-class 挂上，
   custom-style 里只剩 transform / transition。改抽屉宽度或投影时改这里。
   ⚠️ 必须是全局样式：custom-class 挂在 wot 弹层自己的根元素上，不在 NavDrawer 的
      scoped 作用域里。 */
.nav-drawer__popup {
  box-sizing: border-box;
  width: 78vw;
  max-width: 620rpx;
  height: 100vh;
  background-color: transparent;
  box-shadow: 20rpx 0 60rpx -16rpx $ui-glass-shadow;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ===== wot 分页器 =====
   .wd-pager 自带**不透明**底色（浅色 wot 写死 #fff，深色是 --wot-dark-background）。
   压在半透明玻璃面板上，就是"面板中间忽然多出一块实色"，边界很硬 —— 真机截图里
   分页那一块看着像贴上去的白色矩形，就是它。
   文字色 / 描边 / 行距走 useTheme 的 themeVars（那边是内联自定义属性，优先级必胜），
   这里只管两件 themeVars 管不到的事：底色，以及按钮行的居中。

   ⚠️ 这两条必须 !important：wot 的样式是**带作用域属性选择器**编译出来的
      （`.wd-pager[data-v-51068025]`，等效 0,2,0），普通类名压不过它 ——
      抬到重复类名也只是打平，胜负仍取决于产物里的先后，而那个顺序不受本仓控制。
      （同样的理由见上面压原生标题栏那两条。改这三条前先确认 wot 的产物形态没变。） */
.wd-pager {
  background-color: transparent !important;
}

/* wot 的 __content 默认 justify-content: flex-start。调用点原来靠 max-width 限宽
   加容器居中来摆中间，但那样下面那行页码说明也被一起限宽了，与按钮组对不齐；
   限宽已从调用点移除，这里直接把内容居中。 */
.wd-pager__content {
  justify-content: center !important;
  gap: 10px;
}

/* ===== 分页停靠栏 =====
   5 个列表（工单/领料/入库/物料/储罐液位）与文件导入预览的分页器，
   容器统一挂 .pager-dock，贴屏幕底常驻。

   起因：分页器原来在正常文档流里，纵向位置由表格总高决定；而 .dt__cell 没有
   任何规则、行高全由内容撑开，9 列里只有「产成品」会折行（w-40 + break-words），
   于是每页折行条数不同 → 表高不同 → 翻页按钮逐页跳动。真机反馈"每页按钮都在
   不同位置"。固定到屏幕底部后，无论第几页、哪个 Tab，按钮位置恒定，
   且不必滚到列表底部就能翻页。

   ⚠️⚠️ 这里只加 position / z-index / 背景 / 内边距 ——
   绝不能顺手加 transform / filter / backdrop-filter / will-change / contain：
   它们会给后代 position: fixed 建**包含块**，底栏会被钉进 panel 的盒子里
   （面板矮时被顶到屏幕中部），面板内的 DateField 弹层、ProductSelectDialog、
   ImageViewer 会一起失灵。同一条坑的完整记录见 index.vue 的 .panel 注释。

   ⚠️ 为什么除 --wot-* 之外都要 !important：与上面 .wd-pager 那两条同理 ——
   wot 编译出来的是带作用域属性的选择器（`.` 开头的等效 0,2,0）。 */

/* 底栏高度只在这里定义一次：
     · .pager-dock 用它定高；
     · index.vue 的 .page 用它算底部补白（否则列表最后一行会被底栏压住）。
   必须挂在 page 上 —— 变量只能自上而下继承，定义在 .pager-dock 里 .page 读不到；
   两边各写一个数字则会漂移。
   用 px 不用 rpx：rpx 随屏宽缩放，底栏就不能"永远在同一个地方"了。 */
page {
  --ui-dock-h: 62px;
}

.pager-dock {
  /* 贴屏幕底；宽屏下与 .page__shell（max-w-7xl = 1280px）左右边缘严格对齐。
     ⚠️ 不写 inset 简写（WXSS 不支持）；box-sizing 必须显式给 ——
        缺了它 left/right:0 定的是**内容盒**，内边距会撑出横向滚动条。 */
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  /* 必须 < 10：wd-popup 默认 z-index 就是 10（NavDrawer 用默认值，未传 z-index），
     一旦 >= 10 会盖住抽屉那块**全透明遮罩** —— 而"点外面关抽屉"完全靠它接点击。
     5 同时保证 LoadingMask(20) 能压住底栏、各弹层(90/95/99/100)都盖得住。 */
  z-index: 5;
  box-sizing: border-box;
  max-width: 1280px;
  margin: 0 auto;

  /* 定高 + 垂直居中：翻页器内部行高怎么变都不带动这条栏。
     安全区不占内容高度，垫在 padding 里（border-box 下两者相加不重复）。 */
  display: flex;
  align-items: center;
  justify-content: center;
  height: calc(var(--ui-dock-h) + var(--ui-safe-bottom, 0px));
  padding-bottom: var(--ui-safe-bottom, 0px);

  /* --ui-surface-trans 是本仓为"没有模糊的浮层"准备的近不透明兜底，
     深浅两套都有值（深 rgba(16,32,58,.92) / 浅 rgba(255,255,255,.94)）。
     刻意不叠 backdrop-filter：① 小程序端不支持；② 它会造包含块（见上）。 */
  background-color: $ui-surface-trans;
  border-top: 1px solid $ui-hairline;
  box-shadow: 0 -8px 24px -18px $ui-shadow-strong;

  /* 把 wot 分页器压到能塞进这条栏。走 wot 自己的 CSS 变量（它编译出来就是
     `padding: var(--wot-pagination-content-padding, ...)`，见 wd-pagination/index.scss），
     靠自定义属性继承生效 —— 不用 !important 去抢优先级，也只作用于挂了
     .pager-dock 的子树，不波及别处。变量名取自 wot 1.14.0，升级后失效不报错、
     只会让内容顶到上下边缘（看得出来）。 */
  --wot-pagination-content-padding: 2px 15px; /* 默认 10px 15px，省 16px */
  --wot-pagination-message-padding: 0; /* 盖掉 themeVars 里的 2px 0 0 0 */
  --wot-button-small-height: 36px; /* 默认 28px，把按钮抬到手指够得着 */
}

/* 翻页请求进行中：底栏留在原地（不闪），但不接第二次点击 ——
   5 个 composable 都是"发请求 → 覆盖式写 tableData/total"，没有请求序号，
   连续两次翻页谁后回谁作数，页码与表格就会对不上。 */
.pager-dock.is-busy {
  pointer-events: none;
}
</style>
