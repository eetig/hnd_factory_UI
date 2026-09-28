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
- **页面壳**：`pages/index/index` 声明了 `navigationStyle: custom`（页面自带标题栏，
  不再叠原生导航栏），代价是要自己用 `--status-bar-height` 给状态栏让位。
- **登录跳转**：`route.query.redirect` 在 uni-app 无对应物，改成「有上一页就返回，否则回首页」。
- **退出登录**：原来的 `router.replace('/')` 在单页应用里等价于留在本页，已省去。

---

## 6. 上线前置条件（**未完成，需逐项处理**）

### 6.1 小程序主包体积 —— 已解决

原先超限，压缩储罐底图后回落：

| 部分 | 压缩前 | 压缩后 |
|---|---|---|
| 代码（js/wxml/wxss/json） | 385 KB | 385 KB |
| `static/` 两张储罐底图 | **1689 KB** | **316 KB** |
| 合计（上传时按实际字节数） | ≈ 2010 KB | **≈ 701 KB** |
| 微信小程序主包上限 | 2 MB | 2 MB，余量 2.8× |

压缩方式见第 8.2 节。原图保留在 `resources/vessel-source/`，参数可重调。

> 若后续还要往 `static/` 加东西，记住这条经验：**图片资源在小程序端是全量打进包体的**，
> 没有「按需加载」可言。当前两张底图之所以还留在包内，是因为压缩后体积可接受；
> 再大就该考虑移出包外（走网络 + `downloadFile` 合法域名）或拆子包了。

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

### 8.2 储罐底图压缩

```bash
python resources/compress-vessel-images.py
```

输入 `resources/vessel-source/*.png`（未压缩原图），输出 `src/static/*.png`（实际打包版本）。

| 图 | 压缩前 | 压缩后 | 画质 |
|---|---|---|---|
| vessel.png | 2150×1060 · 630 KB | 1075×530 · 117 KB | PSNR 53.9 dB |
| vessel-product150.png | 1760×1938 · 1059 KB | 880×969 · 194 KB | PSNR 55.4 dB |

三个杠杆：

1. **去透明通道**。原图约 90% 像素 alpha=0（完全透明）、9% 不透明、1.5% 抗锯齿过渡
   —— 就是黑线稿 + 透明底。底图只被 canvas 用，而 canvas 所在卡片是 `bg-white`、
   canvas 自身没设背景，所以合成为白底后渲染结果一致，却省下一整个 alpha 通道。
   ⚠️ 这条依赖「画布底是白的」；若以后把储罐卡片改成深色，必须回头改成保留 alpha。
2. **降采样 1/2**。底图在画布上按逻辑宽 1075px 绘制，画布整体还要再缩到屏幕尺寸，
   实际显示只有 248（手机）~532（H5 桌面）CSS px —— 原图 2150 宽是需求的 2~4 倍。
   取 1/2 是刻意的：2150 → 1075 正好等于 `VESSEL_CANVAS_WIDTH`，于是代码里
   `s = IMAGE_W / bounds.width` 变成精确的 1.0，映射不再有舍入。
3. **PNG-8 调色板**。线稿只有黑白与抗锯齿灰阶，256 色量化后 PSNR 53+ dB
   （45 dB 以上人眼基本分辨不出）。

> ⚠️ **改了图就必须同步改代码里的 `imageBounds`。**
> `index.vue` 的 `VESSELS` 里那组 `imageBounds` 描述「罐体在原图像素坐标系中的位置」，
> 绘制时按 `s = IMAGE_W / bounds.width` 换算到画布坐标 —— 图片一缩放，坐标必须等比跟着改，
> 否则液位线会与图纸错位。脚本会直接打印出配套的新坐标，替换过去即可。
> 本次改动已验证：新旧坐标换算出的罐体路径**最大偏差 0.000000 px**，渲染完全一致。

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
