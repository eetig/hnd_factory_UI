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
    DateField.vue        新增：日期选择字段
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

> ⚠️ **需要后端确认**：上述循环调用要求 `/api/work-order/image/upload` 接受
> **单元素**的 `files` 数组。若后端声明的是 Spring 的 `MultipartFile[]`，天然合法；
> 若有「至少 N 张」之类的校验，需同步调整。

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
- **内联 `<svg>`** 全部换成 `wd-icon`（漏斗、图片占位、搜索、日历、箭头等）。
  若图标库里没有对应图形，用 `<image>` 引静态资源，不要把 svg 写回模板。
- **公式区的 `<i>`/`<sub>`** 换成 `<text class="mf-var">` / `<text class="mf-sub">`；
  同时把 `.frac`/`.sqrt` 依赖的 `> span:first-child` 换成显式类名
  —— 转换后子元素不再是 `span`，且结构伪类在小程序端不在官方保证范围内。
- **`weapp-tailwindcss` 只在小程序端启用**（`vite.config.js` 按 `UNI_PLATFORM` 判断）。
  App 端是 webview 渲染、H5 端是浏览器，都是完整 CSS 环境，跑它反而会去改写本来合法的类名。

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

### 5.3 储罐 canvas

`canvas.getContext('2d')` + `Path2D` + `devicePixelRatio` 在小程序/App 都不存在，
改用 `uni.createCanvasContext`（老版画布 API，是唯一三端通用的路径）。它缺的三样东西与替代：

| 缺失 | 替代 |
|---|---|
| `Path2D`（且 `clip()`/`fill()`/`stroke()` 不吃参数） | `createPath()` 记录路径指令后回放 |
| `ellipse()` | `ellipseTo()` 用三次贝塞尔逼近（≤90° 分段，误差远小于 1px） |
| 不自动上屏 | 每次绘制结尾必须 `ctx.draw()`，**少了这句画布永远是空白** |

另外两处：
- 缩放比改由**布局实测尺寸**决定（`boundingClientRect`），等价于原来的 `dpr` 方案；
  取 `Math.min(宽比, 高比)` 而不是只按宽度，避免某端不支持 CSS `aspect-ratio` 时裁掉底部。
- 动画时钟统一用 `Date.now()`。`requestAnimationFrame` 给的是 `performance.now()` 基准，
  而小程序端没有它（退回 `setTimeout`），两个时钟混用会让缓动算出天文数字。

### 5.4 其它

- **长按连续调节液位**：`pointerdown` + `window.addEventListener('pointerup')` →
  `@touchstart` + `@touchend`/`@touchcancel`（触点在元素上就归它，比全局监听更准）
- **页面壳**：`pages/index/index` 声明了 `navigationStyle: custom`（页面自带标题栏，
  不再叠原生导航栏），代价是要自己用 `--status-bar-height` 给状态栏让位。
- **登录跳转**：`route.query.redirect` 在 uni-app 无对应物，改成「有上一页就返回，否则回首页」。
- **退出登录**：原来的 `router.replace('/')` 在单页应用里等价于留在本页，已省去。

---

## 6. 上线前置条件（**未完成，需逐项处理**）

### 6.1 小程序主包超限 —— 必须先解决

实测主包构成：

| 部分 | 大小 |
|---|---|
| 代码（js/wxml/wxss/json） | **385 KB** |
| `static/` 两张储罐底图 | **1.7 MB**（vessel.png 630KB + vessel-product150.png 1059KB） |
| 合计 | **≈ 2.1 MB** ← **超过微信小程序 2 MB 主包上限，当前无法上传** |

可选处理方向（需定夺）：

1. **压缩底图**：两张都是线条图纸，转 PNG-8 / 降分辨率可大幅缩小，通常能压到 150KB 级；
2. **底图移出包外**：放到 img-service 或静态托管，用网络地址加载
   —— 需把域名加进小程序后台的 `downloadFile` 合法域名，且首屏会多一次网络往返；
3. **分包**：把「压力容器体积计算」Tab 拆成子包（子包上限也是 2MB）。

### 6.2 小程序 appid 与合法域名

- `src/manifest.json` 的 `mp-weixin.appid` 目前为空，需填实际 appid；
- `src/api/config.js` 的 `API_ORIGIN` / `IMG_ORIGIN` 目前是**开发期直连局域网地址**
  （`http://172.26.20.69:8084` / `:8082`），上线前必须换成 Nginx 域名；
- 换域名后需在微信后台配置三处合法域名：
  - `request` 合法域名（`/api/*`）
  - `uploadFile` 合法域名（图片上传、OCR 识别）
  - `downloadFile` 合法域名（`/files`、`/thumbs` 单据图片）

### 6.3 超时

`api/http-common.js` 里请求超时设为 5 分钟（沿用改造前的取值，为 Excel 导入放宽）。
小程序端另有天花板：`app.json` 的 `networkTimeout.request` / `networkTimeout.uploadFile`
默认 60s，真机大文件上传可能被它先掐断，需要一并放宽。

### 6.4 后端对接确认

见第 3 节末尾：`/api/work-order/image/upload` 需确认能接受单元素 `files` 数组。

---

## 7. 已知限制 / 未做的事

- **`<table>` 不能写回模板**（小程序无表格布局），必须用 `.dt__*` 那套 flex 结构。
- **焦点态样式**：Tailwind 的 `focus:*` 变体在小程序端只有类名改写、没有真正的焦点样式；
  表单类控件建议直接用 SCSS 写（参考 `.weekly-input`、`.picker-search`）。
- 两个图片查看器（工单汇总 / 周统计）在模板上仍有重复，迁移时**刻意保持原样**
  以免在换平台的同时改变行为；后续可抽成 `ImageViewer` 组件。
- `pages/login/login.vue` 与其它页面的样式已改为 SCSS 为主的写法，
  未做进一步的样式体系统一。
- 未做真机联调：三端**构建**均通过，但 App/小程序的实机行为（相机、文件、canvas
  在低端机的性能）尚未验证。

---

## 8. 常用命令

```bash
npm run dev:h5           # H5 开发（vite 代理仍指向本机 8084/8082/8085）
npm run dev:mp-weixin    # 小程序开发，产物导入微信开发者工具
npm run dev:app          # App 开发，产物导入 HBuilderX 运行

npm run build:h5
npm run build:mp-weixin
npm run build:app
```

各端产物输出到 `dist/build/<平台>/`。
