# hnd_factory_UI → uni-app 迁移说明

> **变更日期**：2026-09-28
> **分支**：`feat/uni-app`（`main` 保留改造前的纯 Web 版，可随时对比/回退）
> **目标端**：Android/iOS App、微信小程序（H5 同时可用，沿用现有 Nginx 部署）
> **本文用途**：记录改造范围、平台差异决策、上线前置条件与已知限制

---

## 1. 为什么要迁，迁成什么样

原项目是 Vue 3 + Vite + Element Plus + vue-router + Tailwind 的纯 Web 应用。
现在同一套源码通过 uni-app 编译到 App 与微信小程序，H5 端产物等价替换原有部署。

选型：

| 项 | 决策 | 原因 |
|---|---|---|
| 框架 | uni-app（Vue3 线，编译器 5.26） | 一套代码三端，Vue 语法基本不改 |
| UI 库 | wot-design-uni 1.14 | Element Plus 无法用于小程序；wot 组件最全、Vue3 原生 |
| 样式 | Tailwind 为主 + 问题处补 SCSS | 见第 4 节 |
| 路由 | `pages.json` + `uni.navigateTo` | uni-app 无 vue-router；本项目只有 2 个页面，改造很轻 |
| 请求 | `uni.request` 复刻 axios 契约 | 见第 3 节 |

---

## 2. 目录结构变化

```
src/
  App.vue            全局应用（onLaunch 里恢复鉴权）
  main.js            createSSRApp + createApp 导出（uni-app 入口约定）
  pages.json         页面注册 + wot-design-uni 的 easycom 规则
  manifest.json      各端配置（App 权限、小程序 appid、分包…）
  uni.scss           全局 SCSS 变量（仅变量/mixin，不能产出 CSS）
  pages/
    index/index.vue  原 views/WorkOrderList.vue
    login/login.vue  原 views/Login.vue
  components/
    WorkOrderImport.vue  原 views/ 下的同名文件（**仅 H5**，见 5.1）
    ImageParse.vue       原 views/ 下的同名文件
    DateField.vue        新增：日期选择字段（底部月历弹层，见 5.5）
    …其余原有组件
  api/
    request.js       uni.request 版 axios 兼容层
    upload.js        新增：uni.uploadFile 封装（含循环单文件）
    http-common.js   新增：请求/上传共用的鉴权头、错误整形、401 处理
    storage.js       新增：本地存储适配（小程序无 localStorage）
    config.js        新增：非 H5 端的接口 origin 与图片地址解析
  static/
    vessel.png            原 src/assets/vessel.png
    vessel-product150.png 原 src/assets/vessel-product150.png
```

已删除：`index.html`、`postcss.config.js`（内联进 `vite.config.js`）、`src/router/`、`src/style.css`。

---

## 3. 请求层：为什么刻意保持 axios 的形状

全项目有 20 多处调用点、6 个 composable，以及散落各处的
`error.response.data.msg` / `error.response.status === 404` 错误分支。
`src/api/request.js` 用 `uni.request` 复刻了 axios 的三个语义，使这些地方**一行都不用改**：

1. **非 2xx 走 reject** —— `uni.request` 对 404/500 也走 `success`，不补这条，
   所有 catch 分支和错误提示都会变成哑的；
2. 成功结果包成 `{ data }`；
3. 失败结果带 `error.response = { status, data }`。

**multipart 上传是特例**：`uni.request` 在任何端都发不了 FormData（H5 端也一样），
必须走 `uni.uploadFile`，而它**一次只能带一个文件**。因此：

| 接口 | 处理方式 |
|---|---|
| `/api/ocr/recognize` | 本来就是单文件，直接用 `uploadFile` |
| `/api/work-order/image/upload`（工单图片、周统计图片） | **循环单文件**请求同一接口（`uploadFiles`） |
| `/api/work-order/ocr/confirm`（确认入库） | ⚠️ **漏了没改**，仍走 `uni.request` + `FormData`，见下 |

> ⚠️ **需要后端确认**：上述循环调用要求 `/api/work-order/image/upload` 接受
> **单元素**的 `files` 数组。若后端声明的是 Spring 的 `MultipartFile[]`，天然合法；
> 若有「至少 N 张」之类的校验，需同步调整。

> ⚠️ **已知未修复：`/api/work-order/ocr/confirm` 现在发不出 body（三端一致）。**
> `src/composables/useOcrConfirm.js` 仍在用 `uni.request` + `FormData`（`payload` + 可选 `file`），
> 正是上面这条规则禁止的写法 —— 迁移时漏改了这个文件。
> H5 实测（拦截请求看服务端实收）：`Content-Type: application/json`、body 为 `{}`，
> **payload 与文件被静默丢弃**，而前端拿到的是成功响应、不报错。
> 结果是「确认入库」在页面上必然表现为「提示保存成功、库里没有数据」。
>
> 修法有两条，都涉及接口契约，按约定需先与后端确认再动，故先挂起：
> 前端改走 `uni.uploadFile`（`file` 是可选参数，需用占位空文件凑数），
> 或后端加一个纯 JSON 的入口。相关记录见 `前后端改动统筹.md` 变更-003 §8.8。

---

## 4. 样式：Tailwind 在三端的实际表现（实测结论）

用探针页面实测了各端编译产物，结论如下：

| 情况 | H5 / App | 微信小程序 |
|---|---|---|
| 纯工具类（`flex`/`p-4`/`bg-*`/`grid`/`truncate`…） | 正常 | 正常 |
| `divide-*`、`space-y-*` | 正常 | **weapp-tailwindcss 自动把 `:not([hidden])~:not([hidden])` 改写成 `view+view`**，正常 |
| `hover:` / `focus:` / `disabled:` / `sm:` / 任意值 `w-[180px]` | 正常 | **weapp-tailwindcss 自动改写类名**（`.hover\:bg-x` → `.hover_bg-x`），WXML 同步改写；媒体查询完整保留，手机上 `sm:`/`lg:` 自然不生效（正是 mobile-first 想要的） |
| `*` 通配符变量块 / `::backdrop` | — | 自动替换为 `view,text` / 移除 |
| **`<table>` 表格布局** | 正常 | ❌ **丢失**：`<table>/<tr>/<td>` 被编译成嵌套 `view`，没有任何表格算法；WXSS 也不支持 `display: table` |
| **内联 `<svg>`** | 正常 | ❌ 不支持 |
| **`<b>` / `<i>` / `<sub>`** | 正常（行内） | ❌ 被编译成**块级** `view`，行内排版直接崩（「L 筒体长度」会变成两行） |
| `<div>` / `<span>` / `<p>` / `<section>` / `<img>` / `<a>` | 正常 | ✅ 自动转换（`div→view`、`span→label`、`img→image`、`a→navigator`），可保留写法 |
| `<style scoped>` | 正常 | ✅ uni-app 实现为**附加 class**（`class="x data-v-xxx"`），不是属性选择器，安全 |

据此做的改造：

- **7 张表格**重写为 flex 行（`.dt__row` / `.dt__cell` / `.dt__grow` / `.dt__empty`）。
  列宽仍沿用原 `columns[].width` 的 Tailwind `w-*` 类；周统计那张带边框的网格靠负边距
  还原 `border-collapse` 的 1px 单线效果。
  ⚠️ **表头行必须和数据行绑同一份 `column.width`**：flex 没有 `<colgroup>` 统一分配列宽，
  单元格只按内容宽撑开 —— 表头少绑一次，那一列的表头就会跟着文字宽度收缩、和数据行错位。
  工单汇总 / 领料汇总 / 入库汇总 / 工单报工 / 工单核算 / 原辅料核算这 6 张表的表头
  在改造时漏绑了，2026-09-30 补上（周统计那张一开始就绑对了）。
- **表格单元格显式声明 `box-sizing: border-box`**（见页面样式区 `.dt__row > view` / `.dt__empty`）。
  preflight 关掉后 `uni-view` 默认按 `content-box` 算：写了 `w-16` 的列实际占 64px + 左右内边距，
  9 列的表比设计宽出一两百 px，手机上看到的就是「列与列之间间距很大、每列都空一截」。
  显式声明后列宽 = 类名写的那个值，与改造前桌面端（preflight 生效时）的几何一致。
- **横向滚动表格的 `.dt` 撑到内容宽（`.dt--scroll`）**：flex 行里的单元格是 `flex-shrink: 0`
  的定宽项，列多时会溢出 `.dt` / `.dt__head` / `.dt__body` / `.dt__row` 这几个盒子
  （它们的宽度只等于滚动容器的可视宽），而底色是画在这些盒子上的 —— 横向滚动后右侧几列
  落到盒外，露出没有底色的白底。表现就是「表头灰底只到中间某一列、后面几列变白」
  「点过的那一行同理」，连 `divide-y` 的分隔线也一起半截（原生 `<table>` 时代不存在，
  table 盒子的宽度本来就等于全部列宽之和）。给这 6 张表加 `.dt--scroll`
  （`width: max-content`）后盒子宽度跟着内容走；内容比容器窄时仍由 `.dt` 的
  `min-width: 100%` 兜底（空表提示行也在其中）。周统计表各单元格自带 `border` /
  `bg-cyan-100`，没有这个现象，未加该类。

  ⚠️ **补记（2026-09-30）：只把盒子撑宽在 App 端并不稳** —— 真机上仍能看到「表头灰底只到
  中间某一列、hover 过的行半截」。根因是底色画在**盒子**上，而盒子宽度能否跟着内容走，
  各端渲染实现并不一致。现在把底色与分隔线改画到**单元格**上
  （`.dt--scroll .dt__head > .dt__row` + `.dt--scroll .dt__row > view` 继承底色），
  并把 Tailwind 画在盒子上的 `divide-y` 中和掉（用 `.dt.dt--scroll` 双类名提权重），
  再在单元格上重画 1px 线。`.dt` 的 `width: max-content` 保留（H5 上更"正统"、
  横向滚动范围也更准）。
- **列宽按手机屏整体收紧了一轮**：桌面端的 64/144/160px（序号/日期/工单号）在手机上每列都留
  一大片空白，改成按内容长度取的标准刻度 `w-10 / w-20 / w-24 / w-28 / w-40`，内边距
  `px-3 → px-2`、右对齐列 `pr-5 → pr-3`、表头 `py-4 → py-3`。顺带**不再使用 `w-[NNpx]`
  这类方括号类名**（产成品/物料名称列原本是 `w-[180px]`/`w-[200px]`/`w-[240px]`、周统计
  名称列 `w-[220px]`）—— 小程序端的方括号类名要靠构建期转义才生效，能不用就不用，
  与 `FilterHeaderCell` 把 `max-w-[110px]` 改成内联 style 是同一个考虑。
- **序号列一律居中**：主页面 6 张表与导入页的序号列表头、数据格统一 `text-center`
  （列定义里给序号列补 `align: 'center'`）。图片解析页的序号列本来就写了 `align: 'center'`，
  这次只是把它对齐到同一套规则，三处观感一致。
- **内联 `<svg>`** 全部换成 `wd-icon`（漏斗、图片占位、搜索、日历、箭头等）。
  若图标库里没有对应图形，用 `<image>` 引静态资源，不要把 svg 写回模板。
- **公式区的 `<i>`/`<sub>`** 换成 `<text class="mf-var">` / `<text class="mf-sub">`；
  同时把 `.frac`/`.sqrt` 依赖的 `> span:first-child` 换成显式类名
  —— 转换后子元素不再是 `span`，且结构伪类在小程序端不在官方保证范围内。
- **`weapp-tailwindcss` 只在小程序端启用**（`vite.config.js` 按 `UNI_PLATFORM` 判断）。
  App 端是 webview 渲染、H5 端是浏览器，都是完整 CSS 环境，跑它反而会去改写本来合法的类名。

### 4.1 双主题（深色 / 浅色 + 运行时切换）

颜色**只有一个来源**：`src/App.vue` 里的两组 CSS 变量（值写在 `src/uni.scss` 的
`@mixin theme-dark-vars` / `@mixin theme-light-vars` 里，两处 `@include` 出来各端才对得上）。

```
小程序 / App：
  page { --ui-bg: #0b0b0e; --ui-slate-200: #2a2a33; … }         深色（默认）
  .theme-light { --ui-bg: #f2f3f7; --ui-slate-200: #e3e6ee; … }  浅色（挂在页面根 view 上）

H5：
  body { --ui-bg: … }                                            深色
  body.theme-light { … }                                         浅色（类名由 JS 直接挂到 body）
```

⚠️ **H5 的变量必须挂在 `body` 上，不能挂在 `page` 上**。`page` 在 H5 会被编译成
`uni-page-body`，它一旦自己声明了深色值，就会盖掉 `body` 上的浅色（自定义属性是
"最近的声明点"胜出）—— 实测症状是"登录页能变浅、首页纹丝不动"。`body` 是页面内容与
原生标题栏 `<uni-page-head>` 的共同祖先，挂在这里一次到位；所以 `page` 规则里的
变量定义用 `/* #ifndef H5 */` 排除掉了。

两条消费路径都指向它，因此「切主题」= 换一个类名，样式不用重新编译：

| 写法 | 落点 | 例子 |
|---|---|---|
| Tailwind 工具类 | `tailwind.config.js` 把 `white`/`slate`/`sky`… 映射成 `var(--ui-*)` | `bg-white` → `background-color: var(--ui-white)` |
| 组件 SCSS | `src/uni.scss` 的令牌同样映射成 `var(--ui-*)` | `$ui-surface` → `var(--ui-surface)` |

- **状态与开关**：`src/composables/useTheme.js` + `src/components/ThemeToggle.vue`
  （按钮出现在顶栏与登录页右上角）。每个调用点各自持有一份 `ref`（响应式闭环在本组件内），
  切换时写 `uni.setStorageSync`（key = `uiTheme`）+ `uni.$emit` 广播，其它页面/组件
  `uni.$on` 收到后更新自己的 ref。**不要改回模块级单例**：uni-app 的 H5 把页面与组件切成
  不同 chunk 后，模块级 computed 在页面侧实测不触发重新渲染（按钮自己的图标会翻面、页面不动）。
- **wot-design-uni** 靠 `wd-config-provider` 的 `theme` 一起切（`wot-theme-dark` / `wot-theme-light`），
  否则弹层、日期选择器、Toast 会留在另一套配色里。`theme-vars` 也跟着主题换强调色。
- **页面根节点之外**的三处由 JS / 内联样式兜住：下拉回弹区域的底色
  （`uni.setBackgroundColor`）、状态栏文字色（`uni.setNavigationBarColor`，`frontColor`
  只认 `#fff`/`#000`）、H5 原生标题栏（`pages.json` 的 `navigationBarBackgroundColor` 被编译成
  **内联样式**写在 `.uni-page-head` 上，只能用 `!important` 压掉；返回箭头是内联
  `<svg fill="#ffffff">`，用 `fill: currentColor` 跟随文字色）。

四条硬约束（踩过就别改回去）：

1. **颜色令牌不能再参与 SCSS 颜色运算**。`rgba($ui-bg, .5)` / `darken($ui-accent, 10%)`
   这类写法在编译期拿不到值，会直接报错；要半透明层次请用
   `$ui-raise` / `-2` / `-3`、`$ui-hairline`、`$ui-*-soft` 这些现成令牌。
2. **不要再写带透明度的颜色类**（`bg-slate-50/50`）。Tailwind 无法对 `var()` 求 alpha，
   那条声明会被**静默丢掉**（类名还在、样式没了）；`bg-black/50` 是例外 ——
   `black` 不在调色板里，仍是字面量。
3. **写死的颜色一律改掉**。渐变里原来写 `rgba(11,11,14,0)` 当作"过渡到透明"的，
   浅色下会压出一圈灰；要用 `transparent`。软拟态、遮罩、弹层内联样式
   （`wd-popup` 的 `custom-style`）都走同一组变量。
4. **深层里的变量声明点要谨慎**。`uni-app, uni-page, body` 这种"中间层"一起铺变量会把
   上层的浅色盖回深色；H5 只认 `body` 一处（见上）。

校验：产物级脚本（工作区外的 `logs/verify-theme2.js`）—— 变量是否全有定义、深色定义的变量
浅色是否都覆盖、关键工具类是否真的指向变量、已删的 alpha 类是否绝迹；
`logs/shoot-h5-theme.js` 用本机 Chrome 无头模式**真的去点主题按钮**并截图（深浅各一套），
是真机行为而不是静态检查。

---

### 4.2 卡片入场动效用 top，不用 transform（★ 弹层能否全屏就看这一条）

每个 Tab 面板（`section.panel`）都 `@include panel-in` 做轻推入场，位移最初用
`transform: translateY()` 实现，并配了 `animation-fill-mode: both`。两处写法单独看都没问题，
合起来却造成了一个与动画本身毫无关系的 bug。

现象（周统计 Tab → 点「起始日期」）：

- 底部弹层与遮罩只铺满**卡片面板**而不是全屏；面板矮时，弹层底边正好压在面板底边上；
- 弹层里的「确定」被顶到状态栏外（面板高时直接被顶出屏幕），点不到；
- 点遮罩、点确定**两条关闭路径同时失效**，弹层关不掉，只能刷新页面。

原因在 CSS 规范里：元素自身的 `transform` 只要不是 `none`，它就成为后代 `position: fixed`
元素的**包含块**。`wd-popup` 的弹层和遮罩都是 `position: fixed` + 全屏尺寸，本该相对视口
定位；面板一旦成为它们的包含块，`top` / `bottom` 便改为相对面板计算 —— 遮罩只盖住面板，
弹层则被「贴」到面板底边。而 `animation-fill-mode: both` 会把动画**终态**的
`transform: translateY(0)` 永久留在元素上（注意：`translateY(0)` 视觉上等于没偏移，但它
**不是** `none`，照样建立包含块）。所以这不是「动画播放时才会错位」，而是**打开就永远关不掉**。

> 为什么改造前没暴露：滚轮式 `wd-datetime-picker` 的年代，工单面板很高（底边≈屏幕底），
> 弹层恰好在视口底部，看起来一切正常；周统计的面板矮、底边落在屏幕中部，错位才现形。

修法（三处必须一起改）：

| 位置 | 改动 |
|---|---|
| `src/App.vue` 的 `@keyframes ui-panel-in` | 位移从 `transform: translateY(12rpx)` / `translateY(0)` 换成 `top: 12rpx` / `top: 0` |
| `src/uni.scss` 的 `@mixin panel-in` | 去掉 `both`，补上 `position: relative` |
| `src/pages/index/index.vue` 的 `.panel` | 规则不动，只补注释指向本节 |

- **位移为什么能换成 `top`**：`position: relative` 元素的 `top` 只做**绘制偏移**，不改布局、
  不挤动兄弟节点、不建包含块、不建层叠上下文，观感与 `translateY` 完全一致；顺带还消掉了
  「切 Tab 后 320ms 动画窗口内打开弹层」的瞬时错位。
- **`animation-fill-mode` 为什么能直接去掉**：关键帧终态（`opacity: 1` + `top: 0`）与元素
  本身样式一致，`none` 与 `both` 的终态视觉相同 —— 去掉它只为保证终态不驻留，动画效果不变。
- **`.panel` 加 `position: relative` 的副作用为零**：面板内需要定位上下文的绝对定位元素
  （缩略图上的删除钮、图片查看器的舞台等）各自都有更近的 `relative` 父级；悬浮按钮与
  LoadingMask 也不在任何 `.panel` 内。
- **为什么不走 `root-portal`**：把弹层搬到页面根同样能绕开包含块，但会把它搬出主题变量的
  作用域（`--ui-*` 定义在 `page` / `body` 与页面根 view 的 `.theme-light` 上），代价远大于
  改一行动画。

> 产物校验：`.panel` 的编译结果应为 `position: relative; animation: ui-panel-in 320ms …`
> （**无** `both`），且 `ui-panel-in` 关键帧里不应再出现 `transform`。

---

## 5. 功能层面的平台差异

### 5.1 Excel 文件导入 —— **仅 H5 保留**

App 与小程序端**整块排除**（条件编译 `#ifdef H5`，含组件导入、顶部 Tab、渲染块），
已验证小程序/App 产物里不含相关代码。

原因：

- 小程序端只能 `uni.chooseMessageFile` —— 用户必须先把 xlsx 发到微信会话里才能选，
  流程别扭；
- **App 端 uni-app 根本没有内置的 xlsx 文件选择器**（`uni.chooseFile` 仅 H5 支持），
  要做需要引入原生插件；
- 导入保存接口是「一次传 N 张图」的 multipart，落到单文件上传后语义需要重新设计。

如果后续要在 App/小程序端补上，见 `前后端改动统筹.md` 的接口契约流程。

> 依赖这一能力的只有「文件导入」Tab；App/小程序端保留「图片解析」作为录入入口。

### 5.2 图片上传与选择

- 选图：隐藏的 `<input type="file">` → `uni.chooseImage`（三端统一，App/小程序端可调相机）
- 预览大图：`el-image` 的 `preview-src-list` → `uni.previewImage`（调起平台原生查看器）
- 列表缩略图的**逐级降级**（变更-001：缩略图 → 原图 → 隐藏）改为**数据驱动**。
  原实现直接改 DOM（`el.dataset` / `el.src` / `el.style.display`），
  小程序与 App 端没有可操作的 DOM，uni 的 `<image>` 只给一个 errMsg 事件。
- H5 端的**拖拽上传保留**（条件编译，仅 H5 编译进去）——拖拽是纯 DOM 能力。

### 5.3 储罐示意图：canvas → 纯 CSS/DOM 图层

改造前是 `uni.createCanvasContext`（老版画布 API，当时唯一三端通用的路径）：每帧一次 `draw()`
把整幅图交给渲染层，绘制前还得用 `boundingClientRect` 异步量宽度（量到之前整块是空白）。
现在换成**纯 CSS/DOM 图层**：几何一律用百分比表达，随屏宽等比缩放交给渲染引擎，
JS 不再量尺寸、也不再每帧重绘 —— 只剩液位缓动一件事，缓动跑完即停帧。

图层（自下而上）：`__paper` 底图 → `__tank` 罐体裁剪层（液体 / 波峰带 / 差值带 / 起始虚线）
→ `__callout` 引线标注。三层都是普通 `<view>`，一行绘制代码都没有。

| 改造前的画布写法 | 现在的 DOM 写法 |
|---|---|
| 逻辑宽 1375（图 1075 + 标注栏 300）的画布，整体再缩到屏幕尺寸 | 面板宽 = `displayWidth` px + `max-width: 100%`；宽高比 `1375 / 逻辑高`（CSS `aspect-ratio`）；层内一律百分比 |
| `createPath()` 回放路径 + `clip()` 裁出罐体 | `__tank` 用 `overflow: hidden` + `border-radius` 斜杠语法（卧式 `x% / 50%`、立式 `50% 50% 0 0 / y% y% 0 0`） |
| `ellipseTo()` 三次贝塞尔逼近封头 | 斜杠圆角里的椭圆角就是同一套几何 |
| 每帧重算水波相位、插值成一条 140 段折线 | `radial-gradient` 平铺成拱 + `@keyframes vessel-wave` 匀速平移（时长 = 罐宽 ÷ 波速） |
| `ctx.setLineDash([9, 6])` 画起始液位线 | 一条 2px 高的 `linear-gradient` 虚线带（墨色走 `$ui-text` 令牌，深色主题自动变亮） |
| `fillText()` 把标注画在画布上 | `__callout` 的 1px 定位容器本身就是引线，圆点与文字用 `currentColor` 继承 |
| 缓动每帧重绘（`ctx.draw()`）；离开 Tab 仍在跑 | JS 只改两个 `ref`（`vesselStartDisplay` / `vesselEndDisplay`），水波交给 CSS 动画 |

保留的观感参数与改造前逐项对齐：波幅 3.5 / 波长 120 / 周期 2620ms、差值阈值 1mm、
引线锚点离罐体右端 30 逻辑像素。

**刻意的偏差**（改动时要一并考虑，代码注释里也标了）：

- `border-radius` 的**斜杠语法**是本轮新引入的写法（本项目此前没有先例）；
  三端产物已核对圆角与关键帧都在，但真机仍需看一眼，见 5.7。
- **差值带简化成矩形**：改造前是沿液位线的一段带子，矩形版只差上下边界那 1px 的斜切。
- **液面线**从 2px 实线变成同色 0.85 透明的拱形带 —— DOM 单元素画不出「拱形填充 + 等粗描边」。
- **斜纹 / 虚线的间距改成固定屏幕像素**：原来是随图缩放的逻辑像素，手机上只剩 2~3 个设备像素、糊成一片。
- **深色主题的底图不靠 CSS 反色**：`filter: invert(1)` 只能把白纸反成黑底、与主题底对不齐
  （底图只占整幅图左侧 78%，右侧标注栏会露出原始底色）；`filter` + `mix-blend-mode: screen`
  虽然能做到只留亮线，但 blend 在小程序端的支持面不明确。改成资源侧多出一张
  **透明底 + 亮线**的 `*-dark.png`，按主题换 `<image>` 的 `src` —— 见 8.2。
- **白色图纸面板整个去掉**：面板不画底色也不描边，图纸背景天然就是所在卡片的底色
  （深浅主题都不用对齐任何色值）。

### 5.4 其它

- **长按连续调节液位**：`pointerdown` + `window.addEventListener('pointerup')` →
  `@touchstart` + `@touchend`/`@touchcancel`（触点在元素上就归它，比全局监听更准）。
  ⚠️ 但**只绑 touch 会让 H5 桌面端整个按不动** —— 桌面浏览器根本不产生 touch 事件。
  现在 touch 与 mouse 两组都绑，再用 700ms 时间窗丢弃「触摸后浏览器补发的 mouse」，
  避免一次操作走两格（`startStepHoldByTouch` / `startStepHoldByMouse`）。
- **`<button>` 的 touch/mouse 不能只绑一组**：小程序与 App 真机只有 touch，
  H5 桌面只有 mouse，缺哪组哪端就是死键。凡「按下—抬起」型交互都要两组齐全。
- **`wd-pagination` 的 `change` 载荷是 `{ value: N }` 对象，不是页码**，且它
  **先于 `update:modelValue` 触发**（此时 v-model 还是旧值）。`el-pagination` 传的是数字，
  照旧写法直接绑处理函数会让页码被赋成对象 → `slice(NaN, NaN)` → **列表静默变空、不报错**。
  必须写成 `@change="(e) => getPageData(e.value)"`。工单/领料/入库汇总与导入页共 4 处。
  ⚠️ **另外**：`wd-pagination` 的 `.wd-pager` 是行内块，宽度只等于 `show-message` 那段文字，
  内部 `__content` 又是 `justify-content: flex-start` —— 容器用 `justify-end` 排时，按钮组会贴着
  这个窄块的右缘。现改成容器 `justify-center` + 组件上 `custom-style="max-width: 340px;"`
  （4 处），按钮组才在两处筛选行里稳定居中；限宽同时挡掉 H5 桌面端把按钮摊开的问题。
- **页面壳**：`pages/index/index` 声明了 `navigationStyle: custom`（页面自带标题栏，
  不再叠原生导航栏），代价是要自己用 `--status-bar-height` 给状态栏让位。
- **登录跳转**：`route.query.redirect` 在 uni-app 无对应物，改成「有上一页就返回，否则回首页」。
- **退出登录**：原来的 `router.replace('/')` 在单页应用里等价于留在本页，已省去。

---

### 5.5 日期选择弹层：手写月历，替掉 wd-datetime-picker

`src/components/DateField.vue` 原来包的是 `wd-datetime-picker type="date"`（滚轮式：年 / 月 / 日
三列），本轮换成企业微信-会议同款的**底部月历**：灰底胶囊里嵌着当前选择 + 强调色
「确定」+ `日一二三四五六` 星期行 + 可按月滚动的月历（每月 1 号位显示「n月」而不是数字，
今天 / 选中那天是强调色圆点）。

为什么手写，而不是用 wot 的 `wd-calendar` / `wd-calendar-view`：那两者的外观是「标题 + 年/月
面板 + 今天标签」，要还原上面这套观感只能大量 `:deep()` 覆写库内部结构，与第 4 节「不再用
`:deep()` 覆写第三方结构」的约定冲突。自己画只有我们这一层类名，三端表现一致。

要点：

- **契约不变**：`v-model` / `change` 只进出 `'YYYY-MM-DD'` 字符串；点日期只改内部 `draft`，
  **只有点「确定」才发 `update:modelValue` + `change`** —— 4 组日期筛选都用 `change` 触发一次
  请求，逐格触发会打爆接口。点遮罩关闭 = 放弃本次选择，不发事件。
  因此只为滚轮选择器存在的 `dateStringToTimestamp` / `timestampToDateString` 两个转换函数
  已从 `utils/format.js` 删除（全仓只有 DateField 用过）。
- **月度窗口是有限的**：`MONTHS_BEFORE = 6` / `MONTHS_AFTER = 2`，共 9 个月（约 780 个节点），是
  「够用」与「小程序一次渲染的节点数」之间的折中。窗口每次打开都以当前选中月为锚点重建，
  连着往更早的月份翻几次也能到任意历史月份；要放宽改这两个常量即可。
- **滚动用 `scroll-view`**（小程序的 `view` 上写 `overflow` 不会滚），并用数值型 `scroll-top`
  在打开前就定位到选中月（行高由网格自己算、`uni.upx2px` 换算）—— 不用 `scroll-into-view`：
  `wd-popup` 的内容是懒渲染的，节点要等动画中间态才存在。
- **底色不写死**：浅色下「选中段」是纯白胶囊（`$ui-surface`，对齐企微那种"灰轨道 + 白胶囊"），
  深色下用 `$ui-surface-3`（深色里它本就是"比表面更亮"的选中填充）。这条覆盖靠 `.theme-light`
  （挂在页面根 view 上；`wd-popup` 默认不 teleport，所以选得到）。
- **日期范围默认不限制**：`min-date` / `max-date` 是可选 prop（默认空）。这几张报表的默认区间
  本来就在过去，任何历史日期都要能选。置灰态（`is-disabled`）与样式都已就绪，将来要收紧范围
  只要传 prop。

> ⚠️ 上面这套弹层能全屏铺开、两条关闭路径都能用，前提是卡片面板身上**没有 transform** ——
> 见第 4.2 节：`animation-fill-mode: both` 会让 transform 动画的终态永久驻留，
> 面板于是成了 `position: fixed` 弹层的包含块。

### 5.6 企微式下拉浮层：自己画，替掉 wd-picker

储罐选择器原先是 `wd-picker`（滚轮弹层）—— 只有 2 个罐却要滚，与「一屏铺开的短列表」不是一回事。
本轮把**小列表类**选择统一成企业微信-文档首页那个下拉浮层的观感：白底大圆角面板 + 大投影、
每行「图标 + 名称（+ 说明）」、当前项整行强调色淡底、行间一条内缩 hairline、行尾打勾。

| 控件 | 改造前 | 改造后 |
|---|---|---|
| 储罐选择器（压力容器体积计算） | `wd-picker` 滚轮 | `DropdownMenu` 浮层（2 项，带说明行） |
| 主题切换（顶栏 / 登录页右上） | 点一下直接翻面 | 同一枚按钮 + 2 项浮层（当前项打勾） |
| 6 处表头筛选 | 底部弹层 + 搜索 | 交互不变，只加行首图标与行间 hairline |

为什么自己画，而不是用 wot 的 `wd-picker` / `wd-popover` / `wd-drop-menu`：前者是滚轮弹层，后两者要还原
这套观感得大量 `:deep()` 覆写库内部结构 —— 与第 4 节「不再用 `:deep()` 覆写第三方结构」的约定冲突
（同 5.5 手写月历的理由）。

要点：

- **适用范围是硬边界**：`DropdownMenu` 只服务「≤6 项的短列表」。选项可能几十上百条、需要搜索的
  （6 处表头筛选）继续用 `ProductSelectDialog` 的底部弹层 —— 浮层里做滚动要同时面对「小程序
  `view` 写 `overflow` 不滚」与「`scroll-view` 必须有确定高度」，不值得。
- **锚点自己给，不依赖祖先**：顶栏 `.topbar` 没有 `position`，卡片 `.panel` 只有
  `position: relative`（`@mixin panel-in`）—— 两者定位链不同，靠祖先一定写歪。组件根 `.dd` 自带
  `position: relative`，且与 `.dd__anchor` 都带 `min-width: 0` / `max-width: 100%`，好让触发器里
  的长文本（储罐名 13 个字）仍能被省略号收住。
- **遮罩铺满全屏**的前提仍是第 4.2 节那条：从页面根到浮层没有 `transform` 祖先。
- **z-index 取 90 / 91**：高于页面内元素（`LoadingMask` 20），但**刻意低于** wot 自己的弹层
  （`floating-panel` 99 / `popover` 500）—— 抽屉、日期弹层、Toast 必须永远压在这层之上。
- 不用 `inset` 简写，写 `top/right/bottom/left` 四条（同本仓其它绝对定位元素）。
- **主题浮层的两行不用图标字体**：wot 图标集里没有太阳/月亮 —— 继续用「半明半暗」的 CSS 圆点
  （复用 App.vue 的全局 `.theme-dot`，浅色那行加 `is-light`）。左右两半都填色（`$ui-text-2` /
  `$ui-text-3`）：右半若留透明，可见实体只剩「左半直线 + 右半圆弧」，小尺寸下会被读成半月/椭圆 ——
  两半都上色后轮廓才是完整正圆。
- **契约与 `ProductSelectDialog` 一致**：状态由调用方持有（`selected` + `select` 事件），组件自己
  不写值，避免出现第二套语义。
- 改造前的 `wd-picker` 已全仓归零；只为滚轮格式存在的 `vesselColumns` 一并删除，换成带 `hint` 的
  `vesselOptions`（「罐型 + 主尺寸 + 密度」把两个罐分开）。

### 5.7 储罐示意图 DOM 层：两条要盯着的风险

这一块三端都用标准 WXSS 属性实现（没有画布那种「三端各有各的 API」的问题），
但有两处属于**新引入的组合**，上线前值得真机扫一眼：

1. **面板宽度必须写死 px + `max-width: 100%`，不能只写 `w-full`。**
   立式罐那一行是 `sm:w-auto`（收缩包裹）的父容器，子元素只写百分比宽度会算不出基准、
   整块塌成 0；写死 470px 又会在 360px 小屏上横向顶出卡片，所以用 `max-width: 100%` 兜底。
   同时**不能**给 `.vessel-diagram` 加 `overflow: hidden` —— 标注文字允许溢出一点，裁掉就看不全。
2. **罐体裁剪层靠 `overflow: hidden` + `border-radius` 裁子节点。**
   - 圆角是**运行时内联**给的字面量（不走编译期 CSS 处理），拿不到构建器对老语法的兜底：
     若某端不认斜杠语法，表现是罐体退化成直角矩形（液位线仍是对的，只是轮廓方了）。
     真遇到，兜底是给卧式罐改用一元 `border-radius`（会把筒体两端也圆掉，但比直角更接近原观感）。
   - `@keyframes` 会被 scoped 样式**重命名**，产物里声明与 `animation-name` 必须同名。
     本轮三端已核对：H5 / 小程序 / App 都是 `vessel-wave-<hash>`，两处同名。
   - `currentColor` 用来把颜色从引线容器带到圆点、文字与差值带斜纹（改色只改一处），
     三端产物都原样保留；某端若不认，表现是这几处丢色，不会报错。

### 5.8 单据大图查看器：自建全屏可缩放浮层，替掉三处旧弹窗

改造前有三处「看图」入口，观感与能力都不一致：

| 入口 | 改造前 | 问题 |
|---|---|---|
| 领料 / 入库列表的「线下单据」 | `wd-popup` 居中卡片（90vw + 圆角 + 内边距） | 图片的类名 `.simple-viewer__img` **没有任何样式规则**，走 uni `<image>` 默认的 320×240，单据被压成一个横向小框；全程不可缩放 |
| 工单汇总 / 周统计的图片区 | 卡片内 `<image height: 56vh>` | 同样不可缩放 |

现在统一到 `src/components/ImageViewer.vue`，两种形态共用同一个缩放内核：

- **fullscreen（领料 / 入库）**：`position: fixed` 铺满视口、纯黑底、`mode="aspectFit"` 居中；
  双击放大 / 还原（1× ↔ 2.5×）、双指捏合（1× ~ 4×）、放大后单指拖动、1× 时点按或点右上角 ✕ 关闭；
  多图时带左右切换与 `n/m` 计数。
- **inline（工单汇总 / 周统计）**：不脱离文档流的可缩放舞台，高度由 `.viewer-stage` 的 56vh 给，
  卡片原有的头信息 / 计数 / 删除 / 上传 / 上下张按钮全部保留。

**为什么不用 `uni.previewImage`**（读三端产物得出的结论，不是推测）：

| 端 | 行为 | 缩放 |
|---|---|---|
| 小程序 | `wx.previewImage`（原生查看器） | ✅ |
| App | 原生查看器（产物里有「保存图片 / 保存成功」文案） | ✅ |
| **H5** | `@dcloudio/uni-h5` 自建的 `Swiper` 浮层（`uni-h5.es.js` 的 `ImagePreview`） | ❌ **只有左右滑动切图，没有任何缩放逻辑** |

三端都要发、H5 又必须能缩放，所以自建一套，顺带三端观感一致。
别处用得上原生能力的地方（`ImageParse.vue` 的识别图预览）保持原样不动。

**缩放内核用 `movable-area` + `movable-view`**：三端都是平台自带实现，H5 也完整实现了它
（`uni-h5.es.js` 的 `useMovableAreaState` 里有双指捏合，`useTouchtrack` 同时监听 touch 与 mouse，
所以桌面浏览器也能拖动）。它不提供点按手势，单击 / 双击由组件自己的只读 touch 监听补齐：

1. **单击关闭必须延迟**：立刻关的话第一次点按就把浮层关掉，双击永远等不到第二次 ——
   所以先挂 300ms 定时器，期间来了第二次点按就撤销它、改为缩放。
2. **放大状态下单击不关闭**，留给「双击还原」，避免误关。
3. **同一次触摸会冒泡到多层**（movable-area / movable-view），用 50ms 去重窗口丢掉重复的那次；
   ✕ 与左右切换按钮上挂 `.stop`（小程序端编译成 `catch` 前缀），不参与点按判定。
4. **防背景滚动**只挂在图片之外的下层节点（`@touchmove.stop`），不挂在 movable-area 的祖先上 ——
   小程序端 `catchtouchmove` 对 movable-view 拖动的影响没有保证。
5. 切图 / 重开靠 `:key` 重挂 movable-view 复位（1× 且无平移），不手工回写 translate。

**长按保存（App / 小程序）**：按住图片约 450ms，当场弹出**自绘的底部保存层**
（缩略图 + 「保存到相册」+「取消」），选「保存到相册」后走
`uni.downloadFile` → `uni.saveImageToPhotosAlbum`。六点值得记：

1. **计时从「按下」开始，不再等抬手**。手势回调里没有「长按」这种事件，所以 `touchstart` 就起一个
   450ms 计时器，到点立刻把弹层推出来（手指还按着，反馈是即时的）；
   抬手那一下只做**兜底** —— `handleTouchEnd` 里 `duration >= LONG_PRESS_MS` 且弹层没开才补一次，
   防的是「定时器被系统饿死」这种情况。
2. **取消计时器有三条路**，缺一条都会误弹：
   - **`@change`（`movable-view` 拖动 / 缩放的位移回传）** —— 主力。小程序端 `movable-view` 拖动时的
     `touchmove` 不保证能冒泡到我们这层只读监听上，光靠位移取消是不够的；`change` 是**一定会回调**的，
     拿 `detail.x/y` 与首个 `change` 记下的基线比（偏移超过 12px 才算「动了」）——
     不能直接看坐标绝对值：手指微抖会让它抖 1~2px，那种抖动不该把长按掐掉。
   - **`@touchmove` 位移**（`movable-area` 与 `movable-view` 都挂，重复的那次由 50ms 去重窗口丢掉）——
     能收到就用它，H5 桌面端的鼠标拖动也走这条。
   - **多指 / 缩放**：多指 `touchstart` 与 `@scale` 都会取消计时并置 `pinched`。
     捏合收尾是两指先后抬起，只按「按住不动」判的话，最后抬起那一下会被兜底判成保存。
     `touchcancel` 只清状态、不判定手势 —— 被系统打断的那一下不该被解释成长按。
3. **弹层是自绘的 `wd-popup`，不再是 `uni.showActionSheet`**：原生动作表在小程序端就是
   「上下两块大白按钮」，样式改不了。换成 `wd-popup position="bottom"` + 自绘内容
   （缩略图 / 主操作行 / 取消行），配色全走 `$ui-*` 令牌，与页面其它弹层一致。两点必须照抄：
   - **`root-portal`**：inline 形态的查看器挂在 `wd-popup position="center"` 里，而 `.wd-popup--center`
     带 `translate3d`，`fixed` 子元素会以它为包含块（同 4.2）—— 不脱离组件树，遮罩就只盖住那张卡片、
     弹层会被贴到卡片底边。它三端都有实现：小程序用微信原生 `root-portal`（需基础库 >= 2.25.4），
     H5 走 teleport、App 走 renderjs 把节点挪到 body，所以三端一致，只是小程序端有基础库门槛。
   - **`z-index="96"`**：高过本组件 `.iv`(95)，低过 message-box(99) / toast(100)，沿用 5.6。
4. **保存中的态留在弹层里**：点「保存到相册」后按钮换成 `wd-loading` + 「保存中…」，重复点无效、
   遮罩也不可点关（`:close-on-click-modal="!saving"`）；成功后自动收层再 toast「已保存到相册」。
   原先的 `uni.showLoading` 已去掉 —— 避免「自绘弹层 + 原生 loading」两层指示器打架。
5. **H5 不做**：浏览器自带长按 / 右键菜单（移动端「存储到照片」、桌面「图片另存为」），
   而 `uni.saveImageToPhotosAlbum` 在 H5 端是空实现（`uni-h5.es.js` 用 `createUnsupportedAsyncApi`
   兜的，调用只会走 fail），自己再做一套只会和浏览器自己的菜单打架。
   模板、样式块（`/* #ifndef H5 */`）与保存函数整块被剥离，H5 产物里搜不到「保存到相册」或 `iv-sheet`。
   同理**没有**去加 `-webkit-touch-callout: none`，浏览器的原生保存入口留着。
6. **前置条件与失败反馈**：相册接口只吃本地路径（官方文档明确「不支持网络图片路径」），
   所以网络图先 `downloadFile` 落临时文件；小程序端还要求图片域名在 `downloadFile` 合法域名里
   （见 6.2），否则真机保存必失败。失败会弹「保存失败」；权限被拒会引导去设置
   （小程序 `uni.openSetting`，App 端没有对应跨端 API，只能文案引导）。

**写死的黑底**：`#000` 是刻意写死的，与本仓「颜色只走 `$ui-*` 令牌」的规则不冲突 ——
看图观感与主题无关（原生查看器也是纯黑），浅色主题下同样是黑底；
浮层控件（✕ / 计数 / 箭头）用白色 + 低透明度黑，两种主题下都清晰。

**z-index 取 95**：高于页面元素与 `DropdownMenu` 的浮层（90 / 91），低于 wot 的 message-box（99）
与 toast（100）—— 沿用 5.6 那条层级线。浮层挂在**页面根节点**附近，不能放进任何带 `transform`
的容器（同 4.2）；长按保存层另取 **96**（夹在 `.iv` 与 message-box 之间），见 5.8。

---

## 6. 上线前置条件（**未完成，需逐项处理**）

### 6.1 小程序主包体积 —— 已解决

原先超限，压缩储罐底图后回落：

| 部分 | 压缩前 | 压缩后 |
|---|---|---|
| 代码（js/wxml/wxss/json） | 385 KB | 370 KB |
| `static/` 四张储罐底图（深浅各两张） | **1689 KB** | **608 KB** |
| 合计（上传时按实际字节数） | ≈ 2010 KB | **≈ 978 KB** |
| 微信小程序主包上限 | 2 MB | 2 MB，余量 2.0× |

压缩方式见第 8.2 节。原图保留在 `resources/vessel-source/`，参数可重调。

> 深色版（`*-dark.png`，四张里多出的两张，约 296 KB）是为深色主题加的，见 8.2；
> 它按主题二选一，不会同时下载 —— 切主题只是换 `<image>` 的 `src`。

> 若后续还要往 `static/` 加东西，记住这条经验：**图片资源在小程序端是全量打进包体的**，
> 没有「按需加载」可言。当前四张底图（深浅各两张）之所以还留在包内，是因为压缩后体积可接受；
> 再大就该考虑移出包外（走网络 + `downloadFile` 合法域名）或拆子包了。

### 6.2 小程序 appid 与合法域名

- `src/manifest.json` 的 `mp-weixin.appid` 目前为空，需填实际 appid；
- `src/api/config.js` 的 `API_ORIGIN` / `IMG_ORIGIN` 目前是**开发期直连局域网地址**
  （`http://172.26.20.69:8084` / `:8082`），上线前必须换成 Nginx 域名；
- 换域名后需在微信后台配置三处合法域名：
  - `request` 合法域名（`/api/*`）
  - `uploadFile` 合法域名（图片上传、OCR 识别）
  - `downloadFile` 合法域名（`/files`、`/thumbs` 单据图片；**长按保存到相册也走这条通道**，见 5.8）

### 6.3 超时

`api/http-common.js` 里请求超时设为 5 分钟（沿用改造前的取值，为 Excel 导入放宽）。
小程序端另有天花板：`app.json` 的 `networkTimeout.request` / `networkTimeout.uploadFile`
默认 60s，真机大文件上传可能被它先掐断，需要一并放宽。

### 6.4 后端对接确认

见第 3 节末尾：`/api/work-order/image/upload` 需确认能接受单元素 `files` 数组。

### 6.5 iOS 相册权限文案（App 打包前）

长按保存到相册在 iOS 上要声明相册用途，否则系统直接拒绝写入：
在 HBuilderX 的 manifest 可视化界面 → App模块权限配置 → **iOS隐私信息访问的许可描述**里，
给 `NSPhotoLibraryAddUsageDescription`（写入相册）与 `NSPhotoLibraryUsageDescription`（读取相册）填文案。
可视化的写法落在 `app-plus.distribute.ios.privacyDescription` 下，但**本仓没有真机验证过这个键名**，
落地时以可视化界面保存出来的结果为准。

Android 侧不用动：云端打包默认就带 `READ/WRITE_EXTERNAL_STORAGE`，`src/manifest.json` 里也已显式声明
（另加了 Android 13 的 `READ_MEDIA_IMAGES`）。

---

## 7. 已知限制 / 未做的事

- **`<table>` 不能写回模板**（小程序无表格布局），必须用 `.dt__*` 那套 flex 结构。
- **焦点态样式**：Tailwind 的 `focus:*` 变体在小程序端只有类名改写、没有真正的焦点样式；
  表单类控件建议直接用 SCSS 写（参考 `.weekly-input`、`.picker-search`）。
- 图片查看器已统一成 `src/components/ImageViewer.vue`（见 5.8）：工单汇总 / 周统计走 inline 形态、
  领料 / 入库走 fullscreen 形态，模板上的重复随之消失。
- `pages/login/login.vue` 与其它页面的样式已改为 SCSS 为主的写法，
  未做进一步的样式体系统一。
- 未做真机联调：三端**构建**均通过，但 App/小程序的实机行为（相机、文件、储罐示意图的
  圆角裁剪与深色底图切换）尚未验证。

---

## 8. 图片资源流水线

`resources/` 下放着两个可重跑的生成脚本。**产物都不要手工替换** ——
换图或调参数时改脚本重跑，脚本会连同「代码里那组必须同步改的数字」一起打印出来。

### 8.1 应用图标与站点图标

图标由脚本从一张原始 logo 生成，**不要手工替换产物文件**：

```bash
python resources/generate-icons.py     # 需要 Pillow
```

| 路径 | 说明 |
|---|---|
| `resources/source-logo.png` | 原始 logo（1536×1536） |
| `resources/icons/*.png` | App 全套尺寸（19 个），`_preview.png` 是预览拼图 |
| `public/favicon.ico` | H5 站点图标（16 / 32 / 48 多尺寸） |
| `public/apple-touch-icon.png` | iOS 添加到主屏时的图标（180） |

脚本做的四件事：

1. **擦水印**：原图右下角有「豆包AI生成」水印。经像素级验证，水印完全落在八边形
   **之外**的白色背景上（水印框 x≥1263，而同高度处八边形右边界仅到 x≈897），
   所以填白是无损的。⚠️ **以后换图务必先确认新图没有水印或其它来源标注。**
2. **抠底**：八边形近似凸多边形，逐行扫描左右边界，把边界外刷成背景。
   凸形状下逐行扫是精确的，且比 floodfill 快一个量级（纯 Python 无 numpy 时差别明显）。
3. **缩到安全区**：八边形占画布 72%，其余是边距 —— iOS/Android 启动器会把图标
   裁成圆角矩形或圆形，铺满画布时八边形的四个尖角会被切掉。
4. **套渐变底**：深蓝径向渐变。这一步踩了两个坑，都写在注释里了：
   - 外围填充**不能**用固定纯色，否则贴入矩形的四角与渐变对不上，
     图标上会出现一圈肉眼可见的方块接缝；必须取该位置上的真实渐变来回填。
   - 填充必须在 `crop` **之前**做。`crop` 返回的是副本，裁完再改原图改不到 badge 上，
     那样四角会保留原始白底，贴上去变成一块白方块。

App 图标的接入：

- 尺寸与路径写在 `src/manifest.json` 的 `app-plus.distribute.icons`
  （Android 6 档 + iOS 18 档，含 App Store 用的 1024）
- 全程 RGB、不带 alpha —— iOS 的 App Store 图标不允许透明通道
- `resources/` 刻意放在 `src/` **之外**：`src/static/` 会被打进每一端的包体，
  而 `static/` 里的东西在小程序端是**全量打进包体**的（没有按需加载可言），
  1MB 多的图标塞进去纯属浪费 —— App 图标只用于原生打包，与包体无关
- 代价是 uni-app 的 App 构建**不会**把 `resources/` 带进 `dist/build/app`，
  而 HBuilderX 导入的正是那个目录 —— 所以 `build:app` 里挂了
  `resources/sync-app-icons.mjs` 自动同步。手工处理 `dev:app` 的产物用
  `npm run sync:app-icons -- dev`

> **小程序头像不在这里配。** 小程序头像是在「微信公众平台 → 设置 → 基本设置 →
> 小程序头像」上传的，与仓库代码无关，需要手动传一个 ≥144×144 的方形图。

### 8.2 储罐底图（深浅两版）与压缩

```bash
python resources/compress-vessel-images.py
```

输入 `resources/vessel-source/*.png`（未压缩原图），每个罐**输出两张同尺寸底图**：

| 图 | 用途 | 压缩前 | 压缩后 | 画质 |
|---|---|---|---|---|
| `vessel.png` | 浅色主题 · 白纸版 | 2150×1060 · 630 KB | 1075×530 · 117 KB | PSNR 53.9 dB |
| `vessel-dark.png` | 深色主题 · 亮线版 | （同一张原图） | 1075×530 · 109 KB | 墨量互补差 2 阶 |
| `vessel-product150.png` | 浅色主题 · 白纸版 | 1760×1938 · 1059 KB | 880×969 · 194 KB | PSNR 55.4 dB |
| `vessel-product150-dark.png` | 深色主题 · 亮线版 | （同一张原图） | 880×969 · 188 KB | 墨量互补差 2 阶 |

三个压缩杠杆：

1. **去透明通道**。原图约 90% 像素 alpha=0（完全透明）、8% 不透明、1.6% 抗锯齿过渡 ——
   就是深色线稿 + 透明底（抗锯齿走的是 RGB 灰阶，alpha 本身只有 0/255）。
   白纸版把透明区域合成为白色：底图显示在卡片上，而浅色卡片本身就是白的，
   渲染结果与保留 alpha 逐像素一致，却省下一整个 alpha 通道。
2. **降采样 1/2**。底图在页面上按逻辑宽 1075px 显示（`VESSEL_IMAGE_WIDTH`），实际还要再
   缩到屏幕尺寸，只有 248（手机）~532（H5 桌面）CSS px —— 原图 2150 宽是需求的 2~4 倍。
   取 1/2 是刻意的：2150 → 1075 正好等于 `VESSEL_IMAGE_WIDTH`，于是代码里
   `s = VESSEL_IMAGE_WIDTH / bounds.width` 变成精确的 1.0，映射不再有舍入。
3. **PNG-8 调色板**。线稿只有黑白与抗锯齿灰阶，256 色量化后 PSNR 53+ dB
   （45 dB 以上人眼基本分辨不出）。

**亮线版（深色主题）**：深色卡片底是 `#17171c`，白纸版那块白纸会成为整个界面上最亮的一块
（为什么不用 CSS 反色，见 5.3）。做法是取原图算**墨量** `c = α × (1 − 灰度/255)` ——
也就是「白纸版比纯白暗了多少」—— 把 `c` 当 alpha、线色 `#cbd5e1` 当 RGB 写出去，
与白纸版**严格互补**：同一组抗锯齿、同一组线宽，两张图叠在同一位置上连笔画粗细都对得上。
存法用 PNG-8 调色板 + tRNS（调色板 256 项全是线色、索引本身就是不透明度），
比 RGBA 小约 1/3，解码后与逐像素 RGBA 完全一致。

接线（`src/pages/index/index.vue`）：`VESSELS[].image` 配白纸版、`VESSELS[].imageDark` 配亮线版，
模板里 `:src="isLight ? selectedVessel.image : selectedVessel.imageDark"` ——
`vesselImageReady` 那个锁存只管「切到储罐 Tab 才真的去加载」，与主题无关。

> ⚠️ **改了图就必须同步改代码里的 `imageBounds`。**
> `VESSELS` 里那组 `imageBounds` 描述「罐体在原图像素坐标系中的位置」，
> 显示时按 `s = VESSEL_IMAGE_WIDTH / bounds.width` 换算 —— 图片一缩放，坐标必须等比跟着改，
> 否则液位线会与图纸错位。脚本会直接打印出配套的新坐标，替换过去即可。
> **深浅两版必须同尺寸**（脚本里有断言）：尺寸不一致时切主题会让液位线跳一下。

---

## 9. 常用命令

```bash
npm run dev:h5           # H5 开发（vite 代理仍指向本机 8084/8082/8085）
npm run dev:mp-weixin    # 小程序开发，产物导入微信开发者工具
npm run dev:app          # App 开发，产物导入 HBuilderX 运行

npm run build:h5
npm run build:mp-weixin
npm run build:app        # 会自动同步 App 图标到产物

npm run sync:app-icons          # 仅同步图标到 dist/build/app
npm run sync:app-icons -- dev   # 同步到 dist/dev/app
```

各端产物输出到 `dist/build/<平台>/`。