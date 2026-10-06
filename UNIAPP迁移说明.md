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
`src/api/request.js` 用 `uni.request` 复刻了 axios 的四个语义，使这些地方**一行都不用改**：

1. **非 2xx 走 reject** —— `uni.request` 对 404/500 也走 `success`，不补这条，
   所有 catch 分支和错误提示都会变成哑的；
2. 成功结果包成 `{ data }`；
3. 失败结果带 `error.response = { status, data }`；
4. **`config.params` 拼进 URL**（`withParams`）。

> ⚠️ **第 4 条是 2026-10-01 补的，漏了整整一轮**：`uni.request` 只认 `data`，
> axios 那套 `request.get(url, { params })` 在 uni 里没有任何人解析 —— 接口能通，
> 但**参数一个都没带上**，而且不报错，看起来像「后端没这条数据」。
> 实测症状（全部来自这一条）：
>   · `/api/material/match`（补物料编码）不带 `name` → **HTTP 400**，
>     页面上是那条「请求失败（HTTP 400）（物料编码将全部留空，可手工填写）」；
>   · `/api/material/search`（选物料弹窗）不带 `keyword` → 后端按空关键词处理、
>     返回 `data: []`，弹窗里就是「没有匹配的物料」——**物料明明存在**；
>   · `/api/work-order/image/list` 不带 `orderNo` → HTTP 400（工单汇总 / 周统计的图片列表）；
>   · `/api/goods-move/list` 不带日期 → 不报错，但把**全量**记录当成区间数据返回。
> 拼 URL 时**自己 `encodeURIComponent`**：中文直接出现在请求行里，Tomcat 会按
> RFC 7230 判非法字符回 400，且各端「谁来编码」并不一致，自己编码才可控。
> 取值口径与 axios 一致：跳过 `undefined` / `null`，保留空字符串。
> ⚠️ 修好之后 `/api/goods-move/list` 会真的按「当月初～今天」过滤，
> **原辅料核算里的「已报工数」会随之从全量变成当月量** —— 这是它本来该有的口径。

**multipart 上传是特例**：`uni.request` 在任何端都发不了 FormData（H5 端也一样），
必须走 `uni.uploadFile`，而它**一次只能带一个文件**。因此：

| 接口 | 处理方式 |
|---|---|
| `/api/ocr/recognize` | 本来就是单文件，直接用 `uploadFile` |
| `/api/work-order/image/upload`（工单图片、周统计图片） | **循环单文件**请求同一接口（`uploadFiles`） |
| `/api/work-order/ocr/confirm`（确认入库） | 单文件 + 一个 `payload` 字段，走 `uploadFile`（2026-10-01 补，见下） |
| `/api/work-order/import/preview`（Excel 预览） | 单文件，走 `uploadFile`（2026-10-01 补，见下）。**文件名必须带** |
| `/api/work-order/import/save`（Excel 保存） | 有图时**一次请求多个文件**（后端是 `MultipartFile[]`），走 `uploadFile` 的 `files` |

> ⚠️ **需要后端确认**：上述循环调用要求 `/api/work-order/image/upload` 接受
> **单元素**的 `files` 数组。若后端声明的是 Spring 的 `MultipartFile[]`，天然合法；
> 若有「至少 N 张」之类的校验，需同步调整。

> ✅ **已修复（2026-10-01）：`/api/work-order/ocr/confirm` 改走 `uni.uploadFile`。**
> 此前 `src/composables/useOcrConfirm.js` 用的是 `uni.request` + `FormData`
> （`payload` + 可选 `file`），正是上面这条规则禁止的写法 —— 迁移时漏改了这个文件。
> H5 实测（拦截请求看服务端实收）：`Content-Type: application/json`、body 为 `{}`，
> **payload 与文件被静默丢弃**，而前端拿到的是成功响应、不报错；
> 页面上表现为「提示保存成功、库里没有数据」。
>
> 两条候选路里选了「前端改走 `uni.uploadFile`」，**接口契约不变，后端一行没动**
> （后端 `consumes = MULTIPART_FORM_DATA_VALUE`，实测 JSON body 直接被 **415** 拒掉，
> 所以本来也只有这一条路）。2026-10-01 线上实测：
> multipart + 文件 → **401**（映射匹配、内容类型通过，只差 token）；JSON → 415。
>
> 实现要点：
>   · `payload` 走 `uploadFile` 的 `formData`（后端是 `@RequestParam String`，一个字符串）；
>   · 图片走 `filePath`、字段名固定 `file`（后端按 `@RequestPart("file")` 取）；
>   · ⚠️ `uni.uploadFile` **必须带文件**，发不出「只有 payload」的请求，
>     所以 `filePath` 改成**必填**（缺了直接抛错），**不要**退化成塞一个空文件 ——
>     那会在库里落一张假图，`file_name` 还让汇总列表的「线下单据」列显示成打不开的图。
>
> 相关记录见 `前后端改动统筹.md` 变更-003 §8.8。

> ✅ **Excel 导入那两处同类问题也已修（2026-10-01）**。
> `src/components/WorkOrderImport.vue` 原先也是 `new FormData()` + `request.post`，
> 而后端这两个入口同样是 multipart-only：
>   · `/api/work-order/import/preview` —— `consumes = MULTIPART_FORM_DATA_VALUE`，
>     发 JSON body 直接 **415**；
>   · `/api/work-order/import/save` —— 有 JSON / multipart 两个映射，
>     「有图要传」那一支走的是 multipart，同样发不出去（JSON 那一支本来就是通的）。
>
> 顺手把 `onUploadProgress` 空转也一并解决了：`uni.uploadFile` 原生有
> `onProgressUpdate`，上传进度条这才真的是进度条。同时把接口壳
> （baseUrl / 鉴权头 / 超时 / 401 / 错误整形）走 `api/upload.js`，不再各写一份。
>
> ⚠️ **两条容易踩的坑**（都写在 `api/upload.js` 里了）：
>   1. **必须用 File 而不是 blob URL**。uni 的 H5 实现里，`filePath` 会被
>      `urlToFile()` 取回一个**无名 Blob**，再由 `blobToFile()` 命名成
>      `file-<时间戳>`（**连扩展名都没有**）。后端有两处认文件名：导入预览按
>      `.xlsx` 后缀决定是否清洗内嵌图、并按文件名兜底识别单据类型；导入保存按
>      `dispimgId` 匹配图片。所以 `uploadFile()` 加了 `file` / `files` / `fileName`
>      三个 H5 专用入参，直接给 File（`file.name` 原样带过去）。
>   2. **多次请求 ≠ 多文件**。`/import/save` 的签名是 `@RequestPart("files") MultipartFile[]`，
>      拆成多次单文件请求会让后端把入库**重跑 N 遍**。H5 端 `uni.uploadFile` 的
>      `files` 数组原生支持同名多文件，一次发完。

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

### 5.1 Excel 文件导入 —— **H5 与 App 保留，小程序端排除**

条件编译用 `#ifdef H5 || APP-PLUS`（含组件导入、Tab 项、渲染块）；
小程序端仍整块排除，产物里不含相关代码（已复验）。

**三端选文件的机制不同**（这是本节的重点）：

| 端 | 怎么选 | 选完拿到什么 | 备注 |
|---|---|---|---|
| H5 | 模板里隐藏的 `<input type="file">` | `File` 对象 | 可以先用 jszip 剥掉内嵌图再传（16MB → 0.13MB） |
| App | Android 系统的文档选择器（SAF），见 `utils/appFilePicker.js` | `_doc/` 下的**本地路径** | 没有 File 就没有剥图那一步，直接传原文件，内嵌图由后端从缓存里抽 |
| 小程序 | 无 | — | `uni.chooseMessageFile` 要求先把文件发进微信会话，流程别扭，暂不做 |

⚠️ **`uni.chooseFile` 在 App / 小程序端根本没有实现** —— 这不是文档说法，是在
`node_modules/@dcloudio` 里查实的：只有 `uni-h5` 有 `chooseFile`，`uni-app-plus` 与
`uni-mp-weixin` 里都没有这个 API。所以 App 端只能自己起系统选择器。

App 端这一路的实现要点（都在 `utils/appFilePicker.js` 里）：

- `Intent.ACTION_OPEN_DOCUMENT` + `startActivityForResult` 起选择器；
- 拿到的是 `content://` **授权凭据**而不是路径，必须用 ContentResolver 把内容
  拷进 App 私有目录才有本地路径 —— `uni.uploadFile` 在 App 端只认路径，
  喂 Blob / `blob:` URL 是 H5 的玩法，一定失败；
- 拷贝走「64KB 缓冲区分块读写」，不用 `android.os.FileUtils.copy`（那个要 API 29+）；
  桥接里创建 Java 数组必须 `Array.newInstance`，不能写 `new byte[]`；
- uni 自己也挂在 `main.onActivityResult` 上（chooseImage / previewImage 都走它），
  所以要**存下原处理器并在非本次请求时转交回去**，否则会把 uni 自己的回调顶掉；
- 每一步失败都带「第①/②/③步」前缀 —— 这层桥接代码在电脑上没法验证，
  真机上错误信息就是唯一的调试手段。

⚠️ **App 端这条路只在 Android 上接通了**（用的 `plus.android`）；iOS 要另写
`UIDocumentPicker`（`plus.ios`），当前调过去会给出明确提示而不是静默失败。

⚠️ **另一个坑（构建期）**：App 打的是 iife 单包，**包里出现 `import()` 就会报
「UMD and IIFE output formats are not supported for code-splitting builds」**。
本组件原有的两处动态导入（jszip 剥图 / 抽图）因此必须收进 `#ifdef H5` 里 ——
App 端本来也用不到它们。

> 依赖这一能力的只有「文件导入」Tab；小程序端保留「图片解析」作为录入入口。
> 导入保存接口的「一次传 N 张图」已改成 `uni.uploadFile`（见第 3 节），三端语义一致。

### 5.2 图片上传与选择

- 选图：隐藏的 `<input type="file">` → `uni.chooseImage`（三端统一，App/小程序端可调相机）
- **选图的「拍摄 / 从相册选择」不再用平台自带的 ActionSheet（2026-10-01）。**
  `uni.chooseImage` 一次给两个 `sourceType` 时，App / 小程序会弹出**系统自己的**选择框 ——
  样式不可控、各机型还不一样，深色主题下是一块突兀的白板。改成两端各让一步：
    · H5：直接开选择器（H5 没有相机/相册之分，底层就是 `<input type="file">`）；
    · App / 小程序：先弹自绘的底部弹层（`ImageParse.vue` 的 `.source-sheet`），
      选完再带**单个** `sourceType` 调 `chooseImage` —— 只有一个来源时平台不再弹自己的框。
  ⚠️ 同一个道理：`wd-popup` 的 `.wd-popup` 写死了 `background: #fff`，只有挂
  `.wot-theme-dark` 时才变（本项目用的是自己那套主题变量，没有这个类）——
  **凡是 wd-popup 都要在 `custom-style` 里补 `background-color: var(--ui-surface)`**，
  否则深色主题下它是一块白板、里面的字反而是浅色，等于白底白字。
  2026-10-01 已逐个数过：全项目 8 处 `wd-popup` 全部补上（`DateField`、
  `ProductSelectDialog`、`ImageViewer`、`ImageParse` ×2、`index.vue` ×3）。
  新增弹层时照抄这一条。
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
- **uni 给每个 `<button>` 都预置了一套外观，自己写样式的按钮必须先清掉**。
  `uni.css` 的 `uni-button` 带着 `font-size: 18px`、`line-height: 2.5555`（≈47px 的行高）、
  `background-color: #f8f8f8`、`margin-left/right: auto`（按钮会被推到容器正中），
  外加一个用 `::after` 画的 1px 边框（`rgba(0,0,0,.2)` 再缩放 0.5 描出来的细线）。
  症状就是「自己写的按钮一个高一个矮、没待在预期的那一侧、平白多出一圈描边」——
  `ImageParse.vue` 的「删除本行」和「增加一行」两个胶囊原先就是这么对不上的
  （删除被 uni 的 `margin:auto` 推到了行中央，而不是靠右）。
  修法：把这几个类名圈起来统一 reset（`margin: 0; border: 0; line-height: 1;` 加
  `&::after { border: 0 }`），高度**写死**（32px）而不是靠内容撑。
  ⚠️ 别图省事写成裸 `button` 选择器：scoped 之后它是 `button[data-v-x]`，优先级 (0,1,1)
  **高于** Tailwind 的单个类 (0,1,0)，会把页面上所有走 Tailwind 的按钮
  （`bg-slate-900` 那类）一起打回透明底。
  ⚠️ **忘记 reset 会是什么样**：`ImageParse.vue` 的「清空」是唯一一个没写底色的按钮 ——
  uni 那层 `#f8f8f8` + `::after` 描边就直接露出来了，页面上是一个突兀的小灰方块。
  ⚠️ **reset 那块必须放在组件样式的最前面**：同为单类选择器，靠后的胜出。起初放在
  文件中间，结果它把前面已经写好的 `.clear-btn` 底色/字色一起清了，按钮变成一行
  几乎看不见的浅灰字。
- **`uni-scroll-view` 带 `width: 100%`，写横向 margin 要配 `width: auto`**。
  这是 CSS 本身的规则，不是 uni 的 bug：`width: 100%` 的值是**包含块的宽度，不扣 margin**，
  于是 `margin: 0 16px` 的 `scroll-view` 会比自己该占的位置宽出 32px、从父容器右侧挤出去。
  连带的症状是**整个弹层可以左右滑** —— `wd-popup` 的 `overflow-y: auto` 会把
  `overflow-x` 一并算成 auto，多出来的那截就成了可滚动区域（真机实测：物料选择器能横向拖走，
  列表和搜索框跟着飘）。改法是把 `width` 显式写成 `auto`（`.picker-list`）。
  项目里另外三个 `scroll-view`（`DateField` / `ProductSelectDialog` / 抽屉）都是用 padding
  而不是 margin 定位的，没这个问题。
- **图片解析的「解析结果」：一套 DOM、两种排版**（`src/components/ImageParse.vue`）。
  改造前是一张 9 列表格，手机屏宽下列宽被压到只剩一两个汉字 —— 表头直接竖排成单字，
  一屏之内既有信息又没法核对。现在用 CSS grid：`@media (min-width: 768px)` 走
  「表头 + 网格行」的表格观感（桌面 H5 与改造前基本一致），更窄则每行变成一张卡片、
  每个字段自带标签，完全不横向滚动。
  ⚠️ **一套 DOM 是刻意的**：两套模板意味着以后加一列要改两处，迟早漂移。
  ⚠️ 同时把**单据号 / 时间 / 线下单据缩略图**从「列」上提到了卡片顶部的单据信息区：
  这三项整张单据只有一个值，做成列就是逐行重复渲染（同一个单号出现 N 次，还白占两列宽）。
  `image.table.doc` 的数据结构没动，改一处全表同步的行为也没变；缩略图改由卡片头部
  那张（点开走 `uni.previewImage`）承担。
  ⚠️ 断点用 px 不用 rpx（判断的是「屏幕有多宽」，不是「设计稿缩放比」），
  且**必须写在组件自己的 `<style scoped>` 里**：它跟 `uni.scss` 的变量无关，
  不受「改完 uni.scss 要重启 dev」那条约束。
- **`wd-pagination` 的 `change` 载荷是 `{ value: N }` 对象，不是页码**，且它
  **先于 `update:modelValue` 触发**（此时 v-model 还是旧值）。`el-pagination` 传的是数字，
  照旧写法直接绑处理函数会让页码被赋成对象 → `slice(NaN, NaN)` → **列表静默变空、不报错**。
  必须写成 `@change="(e) => getPageData(e.value)"`。工单/领料/入库汇总与导入页共 4 处。
  ⚠️ **另外**：`wd-pagination` 的 `.wd-pager` 是行内块，宽度只等于 `show-message` 那段文字，
  内部 `__content` 又是 `justify-content: flex-start` —— 容器用 `justify-end` 排时，按钮组会贴着
  这个窄块的右缘。现改成容器 `justify-center` + 组件上 `custom-style="max-width: 340px;"`
  （4 处），按钮组才在两处筛选行里稳定居中；限宽同时挡掉 H5 桌面端把按钮摊开的问题。
- **底部弹层里的输入框必须自己躲软键盘**（2026-10-01）。弹层是 `position: fixed` 的，
  uni `<input>` 的 `adjust-position`（默认开）只滚动**页面** —— 对 fixed 元素毫无作用，
  于是键盘一弹就把「选择物料」弹层里的搜索框盖住，只露出标题那一行（真机实测）。
  做法：`composables/useKeyboardLift.js` 听 `uni.onKeyboardHeightChange`，拿到键盘高度后改弹层的
  `custom-style`：**`bottom: <键盘高>px`（底边上移到键盘上沿）+
  `height: min(80vh, calc(100vh - <键盘高>px - 12px))`**。
  ⚠️ **高度必须写成 `height`，不能只给 `max-height`**：键盘高度是系统报的、实测不可靠
  （同一台机器换个输入法就报得偏大）。只给上限时弹层高度由内容决定 —— 内容比上限矮时
  就按内容撑，`bottom` 一偏大整块被顶到屏幕外（真机现象：列表从一个被截断的行开始，
  搜索框跑到屏幕上方）。写成 `height` 后顶边恒等于 12px（height 与 bottom 联动），
  键盘报多少都只会让弹层变矮，不会溢出屏幕。实测：键盘高 0 / 291 / 575 三种取值下，
  弹层顶边分别是 169 / 12 / 12。
  ⚠️ 弹层里的列表要 `flex-grow: 1` + `min-height: 0`：弹层有了确定高度后由列表吃掉剩余空间，
  内容正好等于弹层高，弹层自身就不会溢出滚动。
  ⚠️ 列表还要 `overscroll-behavior: contain`：列表滑到头之后**不能**把滚动继续传给页面 ——
  真机上继续上滑会把下层的「图片解析」整页带着滚，弹层跟着页面一起跑。
  用它的两处：`ImageParse.vue` 的物料选择器、`ProductSelectDialog.vue`（工单汇总页 6 处）。
  ⚠️ **别用 `padding-bottom: <键盘高>px` 顶上去**（第一版就是这么写的，真机上是错的）：
  本项目**没有全局 box-sizing 重置**（preflight 关着，`uni.css` 只给 `uni-button`、
  `uni-page-*` 等少数元素设了 border-box），`.wd-popup` 是 **content-box** ——
  padding 不占 `max-height` 的额度，弹层会被撑得比 max-height 还高，整个顶出屏幕上沿，
  搜索框跑到状态栏里去了。同一条 `content-box` 也意味着 `wd-popup` 自动追加的那条
  「安全区 `padding-bottom`」会额外加高弹层，所以键盘态要显式写 `padding-bottom: 0`。
  ⚠️ 监听是全局的，**弹层打开时 start、关闭时 stop**，一直挂着会和别的弹层互相覆盖；
  H5 没有这个 API（浏览器自己会缩视口），composable 里已按不支持处理。
- **弹层里的搜索框位置不能随结果条数变**（2026-10-01）。物料选择器原先用
  `v-if / v-else` 在「空状态文案」和「结果列表」之间切换，而列表是 56vh 的
  `scroll-view` —— 结果少时弹层只有一百多像素、搜索框贴着键盘，结果一多弹层长到
  56vh、搜索框又跑到屏幕上半截。**人正在打字，位置一直在动**，真机上体验很差。
  改法：列表区**始终**渲染（固定 56vh），空状态/加载中作为它内部的一个占位行，
  不用 `v-if` 换掉整块。这样弹层高度只与「键盘在不在」有关，与结果条数无关
  （实测：键盘弹起时 0 / 2 / 20 条结果，弹层都是 511px、搜索框都在 y=68）。
  `ProductSelectDialog` 本来就是这个写法，两边现在一致。
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
| 储罐选择器（压力容器体积计算） | `wd-picker` 滚轮 | `DropdownMenu` 浮层（4 项，带说明行） |
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

### 6.1 包体体积 —— 已解决（底图已移出包外）

**做法：正式包里不再带容器底图，改由服务器按 URL 加载。**

原来底图放在 `src/static/`，而 `static/` 是**全量打进包体**的（没有按需加载）。
2026-10-06 底图又改回原图（见 §8.2），八张合计 **2.4 MB** —— 小程序主包上限 2 MB，
App 的 APK 也会白白胖一圈。

| 部分 | 全部打进包体（旧） | 底图移出包外（现） |
|---|---|---|
| 代码（js/wxml/wxss/json） | 370 KB | 370 KB |
| `static/` 容器底图（深浅各四张） | 859 KB → **2.4 MB**（改回原图后） | **0** |
| 合计（小程序主包） | 1229 KB，余量 1.67× | **≈ 370 KB，余量 5.5×** |
| 再加一种容器 | +原图两张 | **+0** |

**代码侧**（已改完，无需再动）：

- `image_file` / 深色版只写**文件名**（如 `'vessel.png'`，来自设备台账，见 变更-025）
- `src/api/config.js` 的 `resolveVesselImage()` 按环境补前缀：
  `local` → `/static/vessel.png`（包内，开发/联调离线可用）／
  `remote` → `https://hbhnd.cloud/vessels/vessel.png`
- ⚠️ 这个开关**跟着 `APP_ENV` 走，不是单独一个开关** —— 多一个「打包前记得切」
  就多一个会忘的地方（本项目在 `APP_ENV` 上已经吃过一次亏，见变更-006）。
  「打包前确认 `APP_ENV=remote`」这条既有规矩顺带把底图也管住了。
- `npm run build:{h5,app,mp-weixin}` 构建后都会跑 `resources/strip-vessel-images.mjs`：
  `remote` 下把**三端**产物里的 8 张底图剔掉（只剔小程序的话，App 的 APK 会白带 2.4 MB）；
  `local` 下跳过。忘了跑的后果是**包变大**，不是包坏掉
  （remote 下图片地址本来就是绝对的 https）。

**运维侧要做一次**（只这一件事）：

1. 在站点根目录（与 `index.html` 同级）建一个 `vessels/` 目录
2. 把 `src/static/` 下的 **8 个文件**原样传上去（改回原图后合计 **2.4 MB**）：

   ```
   vessel.png                  vessel-dark.png
   vessel-product150.png       vessel-product150-dark.png
   vessel-reboiler.png         vessel-reboiler-dark.png
   vessel-methanol.png         vessel-methanol-dark.png
   ```

   传的是**这个脚本的产物**（`src/static/` 里的），不是 `resources/vessel-source/` 里的原图 ——
   产物是「白纸版 / 亮线版」两版线稿，与坐标是配套的。换图时两边要一起换。

3. ⚠️ 路径**不能**落在 Nginx 已接管的 `/api`、`/files`、`/thumbs` 之下（前两条给后端与 img-service）。
   `/vessels/` 是空着的；若站点的 server 块用了 `try_files ... /index.html` 之类的 SPA 兜底，
   需要补一条 `location /vessels/ { }` 放行静态文件。
4. **不需要新增微信后台白名单**：`https://hbhnd.cloud` 本来就在 `downloadFile` 合法域名里
   （单据图片走的就是这条通道，见 §6.2）。

> 为什么要挪出包外，见 [UNIAPP迁移说明 §8.2] 与本文档开头那句经验：
> **图片资源在小程序端是全量打进包体的**，没有「按需加载」可言。

> 深色版（`*-dark.png`）按主题二选一，切主题只是换 `<image>` 的 `src`；
> 移出包外后这一点不变（两张都在服务器上）。


### 6.2 小程序 appid 与合法域名

- `src/manifest.json` 的 `mp-weixin.appid` 目前为空，需填实际 appid；
- 后端地址已收敛到 `src/api/env.js` 的两套预设（`local` / `remote`），
  **打包前必须确认 `APP_ENV === 'remote'`**（值为 `https://hbhnd.cloud`）——
  切换方式、服务清单与实测记录见第 10 节；
- 小程序端需在微信后台配置三处合法域名（`remote` 预设下三处都是 `https://hbhnd.cloud`）：
  - `request` 合法域名（`/api/*`）
  - `uploadFile` 合法域名（图片上传、OCR 识别）
  - `downloadFile` 合法域名（`/files`、`/thumbs` 单据图片；**长按保存到相册也走这条通道**，见 5.8）
- **逐条清单与 Nginx 侧设计**（25 个请求、上游端口、`^~` 与路径重写的必要性、线上实测、
  真机验收表）见 `D:\deploy\小程序HTTPS与Nginx.md`，可直接给运维的配置见 `D:\deploy\nginx\hbhnd.cloud.conf`；
- ⚠️ **小程序端超时是平台级 60s，不是代码里的 300s**：`src/api/http-common.js` 把超时放宽到了
  300s（Excel 解析很慢），但微信 `networkTimeout` 默认 60000 会先掐断（当前产物 `app.json` 里
  没有这一项 = 吃默认值），真机上传大图 / OCR 超 60s 会报成「超时」，看着像后端挂了。
  要改就在 `manifest.json` 的 `mp-weixin` 下加 `networkTimeout`（uni-app 认这个键）——
  目前**只记录未改**，等真机实测后再定，详见上述文档第六节第 2 条；

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

### 8.2 容器底图（深浅两版）

```bash
python resources/compress-vessel-images.py
```

输入 `resources/vessel-source/*.png`（原图），每个罐**输出两张同尺寸底图**：

> 📌 **2026-10-06 起不再降采样**（`FACTOR` 改回 1）—— 底图已在 变更-024 移出小程序包，
> 「压包体」这个动机没了。**两套前端现在共用同一份原图**，于是 `image_bounds` 直接是
> 原图像素坐标（曾用过「按图片宽度归一化」，那是为了兼容两份分辨率），两端通用、少一层换算。
>
> ⚠️ 代价要知道：**手机端首次进这个页面要下的是原图**，四台合计约 **1.18 MB**（此前 446 KB）。
> 嫌大的正解是在**服务器侧**放一份降采样版（那就又回到两份分辨率），
> 而不是再改 `FACTOR` —— 那会让两端的坐标对不上。
>
> 📌 产物落在 `src/static/`，但**正式包不会带它们**（`APP_ENV=remote` 时构建后会被
> `resources/strip-vessel-images.mjs` 从 **h5 / app / mp-weixin 三端**产物里剔掉，
> 改由服务器 `https://hbhnd.cloud/vessels/` 加载）。见 §6.1 —— 上传到服务器的是
> **这里的产物**，不是 `vessel-source/` 里的原图。

| 图 | 用途 | 原图 | 产物 | 画质 |
|---|---|---|---|---|
| `vessel.png` | 浅色主题 · 白纸版 | 2150×1060 · 630 KB | 2150×1060 · 253 KB | PSNR 54.3 dB |
| `vessel-dark.png` | 深色主题 · 亮线版 | （同一张原图） | 2150×1060 · 262 KB | 墨量互补差 0 阶 |
| `vessel-product150.png` | 浅色主题 · 白纸版 | 1760×1938 · 1059 KB | 1760×1938 · 475 KB | PSNR 54.9 dB |
| `vessel-product150-dark.png` | 深色主题 · 亮线版 | （同一张原图） | 1760×1938 · 494 KB | 墨量互补差 0 阶 |
| `vessel-reboiler.png` | 浅色主题 · 白纸版 | 1616×820 · 502 KB | 1616×820 · 280 KB | PSNR 58.5 dB |
| `vessel-reboiler-dark.png` | 深色主题 · 亮线版 | （同一张原图） | 1616×820 · 247 KB | 墨量互补差 0 阶 |
| `vessel-methanol.png` | 浅色主题 · 白纸版 | 708×1520 · 304 KB | 708×1520 · 170 KB | PSNR 61.2 dB |
| `vessel-methanol-dark.png` | 深色主题 · 亮线版 | （同一张原图） | 708×1520 · 159 KB | 墨量互补差 0 阶 |

> **甲醇计量罐的 `bounds` 多一个 `tangentBottom`**（下封头与筒体的切线）—— 这台罐**上下都有封头**，
> 150 产品储罐是平底、没有这一段。脚本对 `bounds` 是逐键除以 `FACTOR`，加键不用改脚本逻辑。
>
> ⚠️ 量这台罐的坐标时有个坑：**穹顶被顶部三个管口（N1/N4/M1）挡着，顶点量不到**。
> 直接扫「每列最上墨点」得到的是管口法兰，不是穹顶（我一开始就量成了 y≈71，实际穹顶在 y≈115）。
> 可靠办法是用**对称位置的干净列**反解椭圆：x=655 与 x=720 都在 y=116 且不受管口影响，
> 配合罐壁竖线的上端点，解出上切线 250 / 顶点 115；下封头同理得切线 1146 / 顶点 1279。
> 复核方式：画出的长径比 2.095 与几何推出的 2.082 差 0.65%。
>
> 原始图纸（1312×1664，白底不透明）右下角有「豆包AI生成」水印（x 1079~1283 / y 1593~1639），
> 与罐体（x 348~1038 / y 42~1543）不重叠，按裁剪框 (338,32,1046,1552) 裁到 708×1520 即自然排除。

> **再沸器那张原图与另两张不同**：它不是「深色线稿 + 透明底」，而是一张白底不透明的
> AI 生成图纸（`1920×1184`，右下角还带「豆包AI生成」水印）。入库前先裁掉水印
> （裁剪框 `200,174,1816,994` → `1616×820`，取偶数是为了 1/2 降采样落到整数），
> 所以 `compress-vessel-images.py` 里该条目的 `orig_size` / `bounds` 用的都是**裁剪后**坐标系。
> 脚本「合成白底 → 反相取墨量」这条链路对白底不透明图同样成立（alpha 全 255 时
> 白纸版就是原图本身，亮线版取的是「比纯白暗了多少」），不需要为它改脚本逻辑。

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

> ⚠️ **改了图就必须同步改库里的 `equipment_ledger.image_bounds`**（变更-025 起坐标在库里，
> 不再写在前端）。它描述「罐体在底图里的位置」，绘制时按 `s = VESSEL_IMAGE_WIDTH / bounds.width`
> 换算 —— 图一换，坐标就得跟着改，否则液位线会与图纸错位。
>
> 坐标是**按图片宽度归一化**的（`width` 恒为 1、`height` 是长宽比，其余是占图宽的比例）——
> 因为**两套前端用不同分辨率的同一张图**（电脑端原图 / uni-app 1/2 压图），像素坐标差 2 倍，
> 不归一化两边必然打架。本脚本会把归一化后的坐标打印成一行 JSON，**整行贴进库里那一行**即可。
>
> **深浅两版必须同尺寸**（脚本里有断言）：尺寸不一致时切主题会让液位线跳一下。

---

## 9. 常用命令

```bash
npm run dev:h5           # H5 开发（代理指向哪套后端由 src/api/env.js 的 APP_ENV 决定）
npm run dev:mp-weixin    # 小程序开发，产物导入微信开发者工具
npm run dev:app          # App 开发，产物导入 HBuilderX 运行

npm run build:h5
npm run build:mp-weixin
npm run build:app        # 会自动同步 App 图标到产物

npm run sync:app-icons          # 仅同步图标到 dist/build/app
npm run sync:app-icons -- dev   # 同步到 dist/dev/app
```

各端产物输出到 `dist/build/<平台>/`。

> 后端环境的切换方式、两套地址清单与打包前检查项见第 10 节。

---

## 10. 后端环境切换（local / remote）

> 「装到手机上却发现连的是开发机」就是这里没切 —— **打正式包前先过一遍 10.2 的检查项**。

### 10.1 两套配置与服务清单

唯一开关是 `src/api/env.js` 的 `APP_ENV`（`'local'` | `'remote'`）。
它同时被两处读取，所以不会出现「前端切了、代理没切」这种只在 H5 上暴露的错配：

| 读取方 | 用途 |
|---|---|
| `src/api/config.js` | App / 小程序用的**绝对** origin（`API_ORIGIN` / `IMG_ORIGIN` / `OCR_ORIGIN`）|
| `vite.config.js` | H5 开发代理的四条路由（`/api/ocr`、`/api`、`/files`、`/thumbs`）|

服务清单（`172.26.20.69` 是开发机的局域网 IP，写在 `env.js` 的 `LAN_HOST`）：

| 服务 | 前端用它做什么 | `local`（本机联调） | `remote`（线上部署） |
|---|---|---|---|
| `hnd_factory` | 业务接口 `/api/*` | `http://172.26.20.69:8084` | `https://hbhnd.cloud`（Nginx 反代；另有直连端口 `124.220.60.154:9091`（OpenResty）与 `:8084`（FRP），**三者是同一套后端同一份数据**）|
| `img-service` | 单据图片 `/files`、`/thumbs` | `http://172.26.20.69:8082`，需重写成 `/api/img/file`、`/api/img/thumb` | `https://hbhnd.cloud/files`、`/thumbs`（Nginx 同源路由，不重写）|
| `myocr` | 图片识别 `/api/ocr/*` | `http://172.26.20.69:8085` | `https://hbhnd.cloud/api/ocr`（Nginx 分流）|
| `excel-import-service` | 导入解析，**前端不直连**（由 `hnd_factory` 调用）| 随本机 Nacos 注册 | 随远端 Nacos 注册 |
| Nacos | 注册中心 / 配置，**前端不直连、不需要任何 Nacos 资料** | `http://127.0.0.1:8848`（实测 2.5.4 / standalone / 未开鉴权）| **不占公网端口**（FRP 以 `stcp` 暴露）；线上服务注册在 1Panel 的 Nacos 容器内。详见 `Nacos与FRP隧道说明.md` |
| MinIO | 图片对象存储（`img-service` 的下游）| 本机 `9005` | 备份链路 `124.220.60.154:9025`（见 `minio同步手册.md`）|

> `hbhnd.cloud` 解析到 `124.220.60.154`，与 `:9091` 同机 —— 但**前端必须走域名**：
> `:9091` 只暴露了 `hnd_factory`，上面没有 `/files`、`/thumbs`、`/api/ocr`
> 三条路由（见 10.3 实测）。`:9091` 适合用 curl / Postman 直连调后端接口。

两套预设的差异只有三点，`env.js` 里逐项注明了原因：

| 差异点 | `local` | `remote` |
|---|---|---|
| `/api/ocr/*` 归属 | 另一台服务（8085），非 H5 端由 `buildUrl` 单独指过去 | 与业务接口同源，`OCR_ORIGIN` 留空即跟随 `apiOrigin`，由 Nginx 分流 |
| `/files`、`/thumbs` | 直连 `img-service`，手工重写为 `/api/img/*`（`IMG_REWRITE=true`）| Nginx 同源路由，原样透传（`IMG_REWRITE=false`）|
| H5 开发代理 | 四条路由分别指 8084 / 8085 / 8082 并带 rewrite | 三条路由原样透传给域名 |

### 10.2 打 App 正式包：完整清单（★ 每次更新 App 都照这个走）

> 八步，顺序不能乱。**第 ① 步切 `remote`，第 ⑦ 步切回 `local`** —— 两步都容易漏，漏了各自有各自的坑。

**① 切环境**（`src/api/env.js`，唯一开关）

```js
export const APP_ENV = 'remote'    // 打正式包用；日常联调是 'local'
```

**② 删旧产物**（这一步是 10.5 那次事故的根因，别省）

```bash
rm -rf dist/build dist/cache dist/release      # dist/dev 可以留
```

**③ 重新编译**

```bash
npm run build:app        # 末尾自动跑 check-app-env
```

> 云打包时 HBuilderX 会**自己再编译一次**，所以这一步的价值是「提前暴露问题 + 给自检一个基准」，
> 真正保证顺序的是第 ④ 步的 IDE 刷新。

**④ HBuilderX 出包**

- **先在 IDE 里刷新项目**（右键 → 刷新）：IDE 可能抱着内存里的旧文件，刷新才是把磁盘改动读进去
- 菜单「发行 → 原生App-云打包」→ 平台勾 Android
- **证书、包名保持弹窗里已有的值，不要改**（改包名 = 手机上多一个图标；改证书 = 覆盖安装失败）
- 版本名称 / 版本号应显示 `src/manifest.json` 里的新值。**显示的是旧值就停下，回去刷新**
- 产物落在 `dist/release/apk/__UNI__BE0BD40__<时间戳>.apk`
  —— **文件名里的时间戳必须晚于第 ① 步的时刻**，这就是「产物是不是这次编的」的证据

**⑤ 过验收闸门**（必须退出码 0）

```bash
npm run check:app-env
```

四类产物（App / App-Plus / wgt 缓存 / **APK 本身**）逐项应是「私网地址: 无、线上域名: 命中」。
APK 那一项会解包读 `www/app-service.js` —— 这是唯一能证明「要发出去的那个包是对的」的检查。

**⑥ 归档并记档**：APK 拷成 `D:\deploy\HND生产助手-<版本>.apk`，把 **文件名 / 大小 / md5 / 版本号**
记进当次的交付清单与统筹文档。

**⑦ 切回 `local`**（★ 最容易漏，后果比打错包更隐蔽）

```js
export const APP_ENV = 'local'
```

留着 `remote` 的话，本地 `npm run dev:*` 会**静默指向生产**；开发时通常正是用 admin 登录的，
写操作会落进工厂的真实库 —— 看不见，也撤不回。

**⑧ 真机升级注意**（每次更新都要过一遍）

- 包名变了 → 桌面出现**两个图标**（本项目当前是 `uni.app.UNIBE0BD40`）
- 签名变了 → 覆盖安装被拒，手机只提示「应用未安装」→ **先卸载旧版再装**（数据都在服务端，无损失）
- **证书 / keystore 必须留档**：丢了以后永远只能卸载重装。当前这张是**自有证书**（非 DCloud 云端证书），
  指纹、有效期与序列号记在 `D:\deploy\部署清单.md` 第一节

> **这条链路的原理**（出问题时回来看）：
>
> - vite 每次启动 / 构建都会打印当前环境，扫一眼终端即可确认：
>   `[env] APP_ENV=remote → 线上部署（hbhnd.cloud 同源入口）（接口 base = https://hbhnd.cloud）`
> - origin 是**编译期**内联进产物的（`API_ORIGIN` 是常量，不是运行时配置），
>   所以「装到手机上才发现连的是开发机」只能靠重新打包解决，改后端或改 hosts 都没用。
> - **APK 是另一条路**：`npm run build:app` 只产出 `dist/build/app`，
>   APK 要回 HBuilderX 走「发行 → 原生App-云打包」；**打 APK 前必须先重新 build**，
>   否则打出来的就是「新壳 + 旧 JS」，装到手机上照样连开发机（复盘见 10.5）。
> - **小程序端没有这道闸门**：`check-app-env` 只查 App 侧那四类产物，不查 `mp-weixin`。
>   要让小程序连线上，同样先切 `remote`，但只能人工核对（变更-018 记过这一条）。

### 10.3 远程四路由实测（2026-10-01，开发机直连公网）

| 请求 | 结果 |
|---|---|
| `GET https://hbhnd.cloud/api/work-order/list` | `200` + `application/json` ✓ |
| `GET https://hbhnd.cloud/api/ocr/health` | `200` ✓ |
| `GET https://hbhnd.cloud/files/<已存在的 fileName>` | `200` + `image/jpeg` ✓ |
| `GET https://hbhnd.cloud/thumbs/<同一 fileName>` | `200` + `image/jpeg` ✓ |
| `GET http://124.220.60.154:9091/api/work-order/list` | `200`（`hnd_factory` 直连端口）✓ |
| 同上端口 + `/api/ocr/health`、`/files/*`、`/thumbs/*` | `404` ✗ —— **App 不能直连该端口** |

### 10.4 远程入口的真实拓扑（FRP，2026-10-01 实测）

`124.220.60.154` 上除 Nginx 之外还跑着 **frps**；`8082 / 8084 / 8085` 这些「服务端口」
其实是 **FRP 隧道**（面板显示由一台 Windows 客户端发布，出口 IP 为家宽 / 办公网），
不是云主机上的本机进程。Nacos 则以 **`stcp`** 方式暴露，**公网不开端口**。

| 公网目标 | 实测 | 判定 |
|---|---|---|
| `:8084`（hnd_factory）| `200`，工单 **594** 条 | FRP 隧道 → 线上后端 |
| `:8082`（img-service）| 通，非本服务路径返回 Spring `No static resource`（与本机行为一致）| FRP 隧道 |
| `:8085`（myocr）| `/api/ocr/health` → `200`（`engine=tencent`）| FRP 隧道 |
| `:9091`（OpenResty）| 仅 `/api/*` 通（其余 404），数据与 `:8084` 一致 | 另一种入口，同一后端 |
| `:8848` / `:9848` / `:8080`（Nacos）| **全部不通** | 与面板一致：走 `stcp`，不对公网开放 |

> ⚠️ **公网 `:8084` 与本机 `:8084` 不是同一套后端**：同一接口，公网 594 条、首条 id 941；
> 本机 585 条、首条 id 940（各连测 3 次均稳定）。说明线上后端 + 线上库跑在**另一台机器**上，
> 具体是哪台、谁维护、怎么备份，需运维书面确认（见 `Nacos与FRP隧道说明.md` 第 8 节）。

**前端侧结论不变**：只认 `https://hbhnd.cloud` 一个域名入口，不连 Nacos、不直连这三个端口。

> Nacos 的 stcp 要不要改成 TCP、上云还需要哪些 Nacos 资料 —— 完整结论见 `Nacos与FRP隧道说明.md`。

---

### 10.5 事故复盘：手机上装的还是旧包（2026-10-01）

**现象**：`APP_ENV` 改成 `remote`、`npm run build:app` 也跑过了，但手机上那个 APK 仍然连 `172.26.20.69`（打开就报网络错误）。

**时间线（全部有据可查）**：

| 时刻 | 动作 | 产物里内联的地址 |
|---|---|---|
| 10:35 | HBuilderX 编译（app-plus + wgt）| `http://172.26.20.69:8082`（开发机）|
| 10:36 | HBuilderX 云打包 → APK | 同上 —— **这个 APK 是错的**（文件名即证据：`__UNI__BE0BD40__20261001103510.apk` = 打包时刻 10:35:10，早于 11:00 才写入的 `APP_ENV = remote`）|
| 10:55 | `config.js` / `vite.config.js` 改双环境（变更-004）| 源码还没改完，产物仍是旧的 |
| 11:00 | `src/api/env.js` 写入 `APP_ENV = remote` | 源码从这里开始才是对的 |
| 11:01 | `npm run build:app` | `dist/build/app` 干净了（IP × 0、域名 × 1）|
| — | **没有再打 APK** | 📌 手机上装的仍是 10:36 那个包 |

**根因（一句话）**：`API_ORIGIN` 是**构建期内联的常量** —— 改后端、改 hosts、重装 App 都无效；
**只有重新编译 + 重新打包**才有效，而「编译」和「打 APK」是**两个**动作，那次只做了一半。

**为什么旧的检查没拦住**：老检查只 grep `dist/build/app/app-service.js`，而那次它是干净的 ——
**脏的是 `dist/cache/wgt`（热更新包）与 `dist/release/apk/*.apk`（真正装到手机上的）**。
典型的「检查通过、错包照样发出去」。

**闭环措施（已落地）**：

| 措施 | 位置 |
|---|---|
| 自检同时扫 4 类产物：`dist/build/app`、`dist/build/app-plus`、`dist/cache/wgt`、`dist/release/apk/*.apk`（读 APK 内 `www/app-service.js`）| `resources/check-app-env.mjs`（新增）|
| `remote` 下出现私网地址（RFC1918）或缺线上域名 → **退出码 1**，并在输出里直接给出修法 | 同上 |
| 产物比 `dist/build/app/app-service.js` 旧 → 额外警告「它不是刚打出来的」 | 同上 |
| 挂进构建链：`build:app` 之后自动跑；另开 `npm run check:app-env` 手工复验 | `package.json` |
| 抽屉底部显示当前环境（`线上 · hbhnd.cloud` / `本机联调 · …`）| `src/pages/index/index.vue` |

**留下的规矩**：装到手机之前先跑 `npm run check:app-env`；红了不要装。

> 反向验证：把这次那个旧 APK 留在 `dist/release/apk/` 里跑自检，
> 它会准确报出 `私网地址: 172.26.20.69 / 线上域名: 缺失` 并以退出码 1 结束 —— 这就是回归测试。

> 实测（2026-10-01）：`npm run check:app-env` → **退出码 1**；涉及产物 = `dist/build/app-plus/app-service.js` / `dist/cache/wgt/__UNI__BE0BD40/app-service.js` / `dist/release/apk/__UNI__BE0BD40__20261001103510.apk`。
