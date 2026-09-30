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
</style>
