<script setup>
/**
 * 内部推广落地页（2026-10-07）。
 *
 * ⚠️ 这个页面是给 design-taste-frontend 技能用的**落地页**，不是工作台的一部分。
 *    技能 Section 13 明确把它自己排除在 dashboard / 数据表 / 多步表单之外，
 *    工作台那些宽表格不归它管，两边的规矩不要互相套用。
 *
 * Design Read（技能 Section 0.B 要求先声明再动手）：
 *   「化工厂内部工具的导览页，给厂内同事与领导，trust-first 的克制语言，
 *     沿用项目已锁定的 Tailwind 3.4 + 自定令牌，不引入设计系统。」
 *
 * 三个 dial（技能 Section 1.A 的 trust-first/regulated 行，非基线 8/6/4）：
 *   DESIGN_VARIANCE 4 / MOTION_INTENSITY 3 / VISUAL_DENSITY 5
 *
 * 抄这个页面之前先读下面三处偏离说明，都是有意为之：
 *
 * 1. **填充按钮用 `brand`（石墨黑 #1D1D1F）。** 技能 Section 4.5 的按钮对比度
 *    检查是强制的：白字压它 **16.83:1**，大幅通过（041 蓝时代它是 4.70 的贴线档，
 *    那笔「#0A84FF 只有 3.65 过不了」的账随 brand-vivid 退役一起作废）。正文里的
 *    强调色用 `brand-deep`（#171719，白底 17.90）。—— 与工作台同一套阈值推理，
 *    见 tailwind.config 的 `brand` 段。（变更-041 之前这几行写的是 emerald-700 /
 *    emerald-600 的同一笔账。）
 *
 * 2. **没有加载任何外部字体。** 技能 Section 4.1 不建议把 Inter 当默认，但它推荐的
 *    Geist / Satoshi / Cabinet Grotesk 全是为拉丁文准备的，而这一页正文是中文。
 *    中文靠系统字体栈（苹方 / 微软雅黑 / 思源黑体）才清晰，且这是**内网**页面，
 *    引外部字体 CDN 会直接白屏。拉丁字母与数字沿用项目已有的 Inter，
 *    对应技能 Section 4.1 的 override 条款（中性、标准的产品语境）。
 *
 * 3. **图片是真实截图，不是占位图。** 技能 Section 4.8 优先级第一项是「有图像生成工具就必须用」，
 *    这里没有；第二项 picsum.photos 随机照片对一个化工厂储罐液位系统是错的。
 *    所以走第三项：抓真实界面。见 src/assets/landing/。
 *    无头浏览器没有登录态，所以六张 admin 专属台账页、文件导入、图片解析都没有截图，
 *    这一页也就不放它们的图，不编。
 *
 * 4. **Hero 图上叠了一块「演示玻璃」（变更-042）** —— 它落实 WWDC25 物料描述里的
 *    「真实透镜折射、扭曲下层背景图像」：`backdrop-filter: url(#lg-refract)` 用一张
 *    位移贴图（lg-map.png：圆角矩形 SDF 的缘带，36px 内把背景向内挤 ±14.7/9.3px）
 *    做逐通道色散（三条 feDisplacementMap 的 scale 28/32/36，最长波长弯得最多；
 *    这档链是实测定平台起点，理由写在模板滤镜注释第 5 条）。
 *    为什么只在这一页做：工作台三块玻璃背后永远是平滑天穹，**没有可折的高频内容**
 *    （主区栏模板注释自己写着「不会有内容从它下面过」）；这里的工程图有线条有液面，
 *    是天然背板。
 *    兼容性（实测调研，见 glass-effects.css 第 4 节与 _runlogs/refract-cdp.mjs）：
 *    这条链路**只有 Chromium 真渲染** —— WebKit bug 245510、Firefox 的 feImage/
 *    feDisplacementMap 实现不完整，而且三家对 `backdrop-filter: url()` 的 @supports
 *    全是假阳性，所以样式走**级联降级**（先写不含 url 的那条）而不是 @supports 探测。
 *    样张是装饰性的（aria-hidden、无交互），压在图上不压文字；「1250 mm」与
 *    figcaption 同源，不是编的数据。
 */
import { RouterLink } from 'vue-router'
import workbenchShot from '../assets/landing/workbench.webp'
import vesselCanvas from '../assets/landing/vessel-canvas.webp'
import vesselCalcShot from '../assets/landing/vessel-calc.webp'
// 变更-042：真折射样张的位移贴图（探针箱 lg-map-gen.mjs 生成）。
// `?inline` 是必须的：feImage 的 href 要用 data URL（?inline 直接给 data:image/png;base64,
// 不赌 4KB 阈值 —— 这文件 6.4KB 已经超了默认内联上限，不带 ?inline 会变成 /assets 下的
// 外部文件）。构建检查：dist 里能 grep 到 data:image/png 且**没有** lg-map*.png 文件。
import lgMap from '../assets/landing/lg-map.png?inline'

/** 分组与页面：与 WorkOrderList.vue 的 TAB_GROUPS 同口径，改了那边记得同步 */
const GROUPS = [
  {
    key: 'order',
    label: '工单报工',
    count: 6,
    summary: '从领料到核算的整条链，六张表在同一个分组里。',
    pages: ['工单汇总', '领料汇总', '入库汇总单', '工单报工', '工单核算', '原辅料核算'],
    access: '仅管理员',
  },
  {
    key: 'stats',
    label: '数据统计',
    count: 3,
    summary: '三页都是按线下台账的口径存档，页面上的数与报表对得上。',
    // 这一格不用 pages 那个纯列表渲染：三条各配一句说明才撑得起版面，
    // 见下面 STATS_DETAIL。列表里的三项与它一一对应。
    access: '只读开放',
  },
  {
    key: 'tools',
    label: '工具',
    count: 3,
    summary: '物料查询覆盖 799 条记录，压力容器体积计算支持 4 台容器，另有电费预提。',
    pages: ['物料查询', '压力容器体积计算', '电费预提'],
    access: '只读开放',
  },
  {
    key: 'maintain',
    label: '数据维护',
    count: 3,
    summary: '设备台账 92 条，逐台可改；导入与图片解析把纸面记录转成数据。',
    pages: ['设备数据维护', '文件导入', '图片解析'],
    access: '需要权限',
  },
]

/** 能做体积与质量换算的容器（来自 /api/equipment/vessels，4 台） */
const VESSELS = ['150产品罐', '甲醇计量罐', '三氯氢硅储罐', '再沸器']

/** 未登录能看的页面：与 WorkOrderList 里那套权限过滤同口径 */
const OPEN_PAGES = [
  '物料查询',
  '周统计',
  '日报表记录',
  '月底储罐液位记录',
  '压力容器体积计算',
  '电费预提',
]

/**
 * 「数据统计」那一格的细节。
 * 三条都对着代码核过：周统计的换算系数在 useStatsData 里（如氯铂酸 1 比 20），
 * 液位记录一条可挂多张图在 TankLevelVO.images（数组）里。
 */
const STATS_DETAIL = [
  { term: '周统计', desc: '按物料编码汇总领用与入库，含计量单位换算系数。' },
  { term: '日报表记录', desc: '按日归档，与线下报表同口径。' },
  { term: '月底储罐液位记录', desc: '带图据，一条记录可挂多张现场照片。' },
]
</script>

<template>
  <!--
    两层与工作台同构、**纸是例外**（使用方 2026-10-07 定：落地页也要「跑在那张卡片上」）：
    桌面（`desk`，p-4）→ **白纸**（rounded-card bg-white）→ 页内的白色分区。
    041 那一代全站纸是天穹、唯独这一页保持白纸（长页正文，蓝底读长文是受罪）；
    043 全站纸换成浅中性场之后，这条例外**换了个说法继续成立**：工作台那三页的纸
    是 `.minimal-field` 柔光场（有玻璃要吸光），而这一页是**纯白纸**（内容全是不透明
    分区，没有玻璃）—— 差异由 spec 白名单显式表达（「页面根 bg-desk」三页都成立，
    「纸 = .minimal-field」只对工作台 / 登录 / 404 成立，落地页禁挂）。
  -->
  <div class="min-h-screen bg-desk p-4 text-slate-900">
    <!--
      overflow-clip 是**必须的**，不是为了保险：页内有两块整幅的带色分区
      （`bg-white` 与页尾那条 `bg-brand`），它们的直角会从卡片 20px 的圆角里戳出来。
      用 clip 而不是 hidden 也是必须的 —— hidden 会把这张卡片变成滚动容器，
      下面那个 sticky 头部就再也贴不住（它变成「相对一个永远不滚的容器」定位，等于失效）。
      clip 不建立滚动容器，只负责切边。
    -->
    <div class="overflow-clip rounded-card bg-white shadow-card">
      <!--
      导航：单行、高 64px（技能 Section 4.7 上限 80px）。
      右侧那个 CTA 与页尾的 CTA 用**同一个标签**「进入工作台」。
      技能 Section 4.5 禁止同一页面出现两个同义不同词的 CTA。

      sticky 的落点保持 top-0 **不改**。改成与卡片顶边对齐的 top-4 看着更"对"，
      实测反而坏了：头部钉在视口下 16px 处不动，而卡片已经滚上去一屏多，
      于是**头部上面那 16px 会露出一条正在滚动的页面内容**（截图里能看见
      「物料查询」那行从导航上方划过去）。top-0 时头部贴着视口最上沿，上面没有位置可露；
      卡片左右那 16px 夜边条仍在，头部在自己的横向范围内贴着上沿 —— 这就是 sticky 导航的常态。
      rounded-t-card 是给**未滚动**那一刻用的：那时头部恰好压在卡片顶边上，
      不圆就会用直角把卡片的 20px 圆角涂掉。
      底色用白纸的 85% + backdrop-blur，滚起来是纸面在毛玻璃下面穿过去。
    -->
      <header
        class="sticky top-0 z-40 rounded-t-card border-b border-slate-200 bg-white/85 backdrop-blur"
      >
        <div class="mx-auto flex h-16 max-w-[1400px] items-center gap-8 px-6">
          <span class="text-sm font-semibold tracking-tight">HND生产助手</span>
          <nav class="hidden items-center gap-7 text-sm text-slate-600 md:flex">
            <a class="transition hover:text-slate-900" href="#features">功能</a>
            <a class="transition hover:text-slate-900" href="#vessel">储罐换算</a>
            <a class="transition hover:text-slate-900" href="#access">登录与权限</a>
          </nav>
          <RouterLink
            to="/"
            class="ml-auto rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-deep active:scale-[0.98]"
          >
            进入工作台
          </RouterLink>
        </div>
      </header>

      <!--
      Hero：非对称分栏（左文案 / 右真实界面图），不是居中英雄区。
      技能 Section 4.7 限死 hero 最多 4 个文字元素，这里只有 3 个：
      标题、副文案、两个 CTA。没有 eyebrow、没有 CTA 下方小字、没有「他们都在用」条。
      用 min-h-[100dvh] 而不是 h-screen：iOS Safari 地址栏会吃掉 h-screen 的高度。
    -->
      <section
        class="mx-auto grid max-w-[1400px] items-center gap-12 px-6 pb-20 pt-16 lg:min-h-[100dvh] lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pb-24 lg:pt-20"
      >
        <div>
          <!--
          ⚠️ 行高写进 font-size 的斜杠里（text-[..]/[..]），不要另写一个 leading-[..]。
          Tailwind 生成 CSS 时把**带变体的**工具类排在后面，所以
          「不带前缀的 leading-[1.15]」压不过「带前缀的 sm:text-4xl」自带的 line-height。
          这里正是这么踩的：xl:text-[3.2rem] 把字号提到 51.2px，可 sm:text-4xl 自带的
          40px 行高仍然生效，两行标题重叠 25px（实测行盒 376-441 / 416-481）。
          斜杠写法把字号与行高绑成同一条声明，也就没有谁压谁的问题。

          注意这与「text-sm leading-relaxed」那种写法不同：两者都不带变体时，
          leading-* 在后面，是能正常生效的（项目里那 14 处实测都没问题）。
        -->
          <h1
            class="text-[2rem]/[1.2] font-semibold tracking-tight sm:text-[2.25rem]/[1.15] lg:text-[2.6rem]/[1.15] xl:text-[3.2rem]/[1.15]"
          >
            工单、物料、储罐液位，<br class="hidden md:inline" />一个入口查完
          </h1>
          <p class="mt-6 max-w-[52ch] text-base leading-relaxed text-slate-600 md:text-lg">
            六仓制造系统的生产数据工作台。未登录可以只读浏览物料与统计，写入类功能按角色开放。
          </p>
          <div class="mt-9 flex flex-wrap items-center gap-3">
            <RouterLink
              to="/"
              class="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white transition hover:bg-brand-deep active:scale-[0.98]"
            >
              进入工作台
            </RouterLink>
            <a
              href="#features"
              class="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 active:scale-[0.98]"
            >
              看功能清单
            </a>
          </div>
        </div>

        <!--
        真实的容器工程图（150产品罐，液位 1250mm）。这一张是抓的界面，不是画的。
        青色水面是产品里那套「按 id 取色」的罐体分类色，不是页面的高亮色，
        它属于内容，跟页面的品牌蓝（brand）同属蓝青一系，不打架。
      -->
        <figure class="w-full justify-self-center lg:justify-self-end">
          <div class="relative">
            <img
              :src="vesselCanvas"
              alt="150产品罐的工程图，罐内液面停在 1250 毫米处"
              class="mx-auto h-auto w-full max-w-full rounded-card border border-slate-200 bg-white shadow-card"
              width="1400"
              height="1206"
              fetchpriority="high"
            />
            <!--
            真折射样张（变更-042，见文件头偏离 4）。放右下角压在罐体工程线上
            —— 折射要有线条可掰才看得出来。aspect-[300/190] 与 lg-map.png 的
            贴图同纵横比（600×380 @2x）：feImage 用 preserveAspectRatio="none"
            铺满元素盒，盒子比例与贴图设计比例一致时位移才是等向的。
            max-w-[62%] 管窄屏：375 视口下 Hero 图只有 ~295px 宽，固定 300px 会出图。
            圆片与胶囊各带一圈 ring-1 ring-slate-900/5 的 hairline：白霜玻璃上再放
            bg-white/85，在工程图的白区里圆片会「消失」（042 实机 2× 截图发现），
            1px 5% 黑环保证任何底子上都读得出是按钮。
            ⚠️ 祖先链上不许出现 filter / opacity<1 / backdrop-filter / mask
            （backdrop root 会被截断，折射会「看不到背景」而不是报错）。
            -->
            <div
              id="minimal-figure"
              class="minimal-figure absolute bottom-[9%] right-[7%] aspect-[300/190] w-[300px] max-w-[62%] select-none rounded-card"
              aria-hidden="true"
            >
              <div class="flex h-full flex-col items-center justify-center gap-2.5">
                <div class="flex items-center gap-2.5">
                  <span
                    class="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-slate-700 ring-1 ring-slate-900/5"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      class="h-4 w-4"
                    >
                      <circle cx="11" cy="11" r="6" />
                      <path d="m15.5 15.5 4 4" />
                    </svg>
                  </span>
                  <span
                    class="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-slate-700 ring-1 ring-slate-900/5"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="h-4 w-4"
                    >
                      <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" />
                    </svg>
                  </span>
                  <span
                    class="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-slate-700 ring-1 ring-slate-900/5"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="h-4 w-4"
                    >
                      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" />
                    </svg>
                  </span>
                </div>
                <span
                  class="rounded-full bg-white/85 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-900/5"
                >
                  1250 mm
                </span>
              </div>
            </div>
          </div>
          <figcaption class="mt-3 text-center text-xs text-slate-500">
            150产品罐，液位 1250 mm。图与几何参数都来自设备台账。
          </figcaption>
        </figure>
      </section>

      <!--
      真折射样张的滤镜定义（变更-042）。给 #minimal-figure 的 backdrop-filter 用。
      ⚠️ 六条硬规矩，每条都对应一个「不报错、只是没效果」的坑：
      1. filterUnits/x/y/width/height = 滤镜区域**必须**钉成元素边框盒
         （objectBoundingBox 0,0,1,1）。留默认的 -10%/120% 外边距，贴图会被
         缩小成中间一小块、边缘全在区域外 —— 看起来「完全没效果」且控制台干净。
      2. feImage 必须 preserveAspectRatio="none"（初始值 xMidYMid meet 会等比留白）。
      3. feImage **不写** x/y/width/height（默认铺满滤镜区域；写了会踩 Blink 对
         primitiveUnits 百分比的解析差异，svgwg #1012）。因此也不能出现 primitiveUnits。
      4. color-interpolation-filters="sRGB" 必须写：贴图的「128 = 零位移」只在 sRGB
         解释下成立，默认 linearRGB 会把 128 变成 ≈0.216 → 整块恒定偏移（看着是
         「错位」而不是折射）。
      5. 色散 = 三条 feDisplacementMap 并行（scale 28/32/36，蓝弯得最多），各接一条
         feColorMatrix 隔离单通道再 screen 合成。feColorMatrix 第 4 行必须
         `0 0 0 1 0`（保 alpha），否则合成完整块透明。
         scale 链是**实测定的**（refract-tune.mjs，2026-10-11）：spread 从 4 拉到
         20（[30,32,34]→[24,32,40]），虹边信号只从 4/255 涨到 7/255 —— 这张底图的
         高频内容是 1–3px 细线，通道错位超过线宽后两通道都「跨过」了线，色差不再
         增长（自相关限制），再拉大只会让内容发虚。28/32/36 是平台起点。上游还有
         blur(10px) 固定衰减 ~5 倍，所以「轻微」是物理结论不是谦虚。
      6. 容器用 h-0 w-0 absolute overflow-hidden，**绝不 display:none** ——
         feImage 从 display:none 的树里取图会静默失败。
      属性大小写是载荷（preserveAspectRatio / xChannelSelector / feImage…）：
      SFC 模板不乱改大小写，这段**别搬去 index.html**（in-DOM 模板会小写化）。
      ⚠️ Vue 模板里 feImage/feDisplacementMap/feColorMatrix/feBlend 都在 @vue/shared
      的 SVG_TAGS 表里（按这个驼峰拼写登记的），会被当原生 SVG 元素直出，不是组件。
      -->
      <svg
        class="pointer-events-none absolute h-0 w-0 overflow-hidden"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter
            id="lg-refract"
            filterUnits="objectBoundingBox"
            x="0"
            y="0"
            width="1"
            height="1"
            color-interpolation-filters="sRGB"
          >
            <feImage :href="lgMap" preserveAspectRatio="none" result="map" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale="28"
              xChannelSelector="R"
              yChannelSelector="G"
              result="dispR"
            />
            <feColorMatrix
              in="dispR"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="chR"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale="32"
              xChannelSelector="R"
              yChannelSelector="G"
              result="dispG"
            />
            <feColorMatrix
              in="dispG"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="chG"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale="36"
              xChannelSelector="R"
              yChannelSelector="G"
              result="dispB"
            />
            <feColorMatrix
              in="dispB"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="chB"
            />
            <feBlend in="chR" in2="chG" mode="screen" result="blendRG" />
            <feBlend in="blendRG" in2="chB" mode="screen" />
          </filter>
        </defs>
      </svg>

      <!--
      功能清单：4 个分组 → **4 个格子**（技能 Section 4.7 的 bento 格子数规则：
      有几个内容就几个格子，不许留空格）。用 4/2 与 2/4 的错落，不是四个等宽卡片。
      技能 Section 9.C 直接禁掉了「三个一模一样的功能卡」那一排。
      至少三个格子要有真实的视觉差异（图 / 底色 / 强调细节），不能四张白底文字卡。
    -->
      <section id="features" class="border-t border-slate-200 bg-white py-20 lg:py-24">
        <div class="mx-auto max-w-[1400px] px-6">
          <h2 class="max-w-[24ch] text-3xl font-semibold tracking-tight md:text-4xl">
            四类功能，十五个页面
          </h2>
          <p class="mt-4 max-w-[62ch] text-base leading-relaxed text-slate-600">
            分组只是帮你找得到，不是权限。同一组里各页的可见性由角色决定。
          </p>

          <div class="mt-12 grid gap-5 lg:grid-cols-6">
            <!-- 格子 A：工单报工，占 4 列，带真实界面截图 -->
            <article
              class="overflow-hidden rounded-card border border-slate-200 bg-slate-50 lg:col-span-4"
            >
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-7">
                <h3 class="text-xl font-semibold tracking-tight">{{ GROUPS[0].label }}</h3>
                <span
                  class="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600"
                >
                  {{ GROUPS[0].count }} 个页面
                </span>
                <span
                  class="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-brand-deep"
                >
                  {{ GROUPS[0].access }}
                </span>
              </div>
              <p class="max-w-[46ch] px-7 text-sm leading-relaxed text-slate-600">
                {{ GROUPS[0].summary }}
              </p>
              <ul class="mt-5 flex flex-wrap gap-x-2 gap-y-2 px-7">
                <li
                  v-for="page in GROUPS[0].pages"
                  :key="page"
                  class="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600"
                >
                  {{ page }}
                </li>
              </ul>
              <img
                :src="workbenchShot"
                alt="工作台界面：左侧是四个功能分组，右侧是物料查询表格，共 799 条记录"
                class="mt-7 h-56 w-full border-t border-slate-200 object-cover object-top"
                width="2000"
                height="1143"
                loading="lazy"
              />
            </article>

            <!-- 格子 B：数据统计，占 2 列，底色与 A 拉开 -->
            <article class="rounded-card border border-slate-200 bg-brand-50 p-7 lg:col-span-2">
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 class="text-xl font-semibold tracking-tight">{{ GROUPS[1].label }}</h3>
                <span
                  class="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600"
                >
                  {{ GROUPS[1].count }} 个页面
                </span>
              </div>
              <p class="mt-4 text-sm leading-relaxed text-slate-700">{{ GROUPS[1].summary }}</p>
              <dl class="mt-6 space-y-4">
                <div v-for="item in STATS_DETAIL" :key="item.term">
                  <dt class="text-sm font-medium text-slate-800">{{ item.term }}</dt>
                  <dd class="mt-1 text-sm leading-relaxed text-slate-600">{{ item.desc }}</dd>
                </div>
              </dl>
            </article>

            <!-- 格子 C：工具，占 2 列 -->
            <article class="rounded-card border border-slate-200 bg-white p-7 lg:col-span-2">
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 class="text-xl font-semibold tracking-tight">{{ GROUPS[2].label }}</h3>
                <span
                  class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                >
                  {{ GROUPS[2].count }} 个页面
                </span>
              </div>
              <p class="mt-4 text-sm leading-relaxed text-slate-600">{{ GROUPS[2].summary }}</p>
              <ul class="mt-6 space-y-2.5">
                <li v-for="page in GROUPS[2].pages" :key="page" class="text-sm text-slate-600">
                  {{ page }}
                </li>
              </ul>
            </article>

            <!-- 格子 D：数据维护，占 4 列。底色给了浅灰，凑够技能 Section 4.7
               「bento 至少 2 到 3 个格子要有真实视觉差异」那条：现在是
               A 灰底+真实截图 / B 浅蓝底（brand-50） / C 白底 / D 灰底，
               三格有差异、一格留白做节奏 -->
            <article class="rounded-card border border-slate-200 bg-slate-50 p-7 lg:col-span-4">
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 class="text-xl font-semibold tracking-tight">{{ GROUPS[3].label }}</h3>
                <span
                  class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                >
                  {{ GROUPS[3].count }} 个页面
                </span>
                <span
                  class="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-deep"
                >
                  {{ GROUPS[3].access }}
                </span>
              </div>
              <p class="mt-4 max-w-[52ch] text-sm leading-relaxed text-slate-600">
                {{ GROUPS[3].summary }}
              </p>
              <ul class="mt-6 flex flex-wrap gap-x-2 gap-y-2">
                <li
                  v-for="page in GROUPS[3].pages"
                  :key="page"
                  class="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600"
                >
                  {{ page }}
                </li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <!--
      储罐换算：整幅宽的媒体段 + 一条窄文案带。
      这是与前后都不同的版式族（技能 Section 4.7：同一个版式族一页只能用一次）。
    -->
      <section id="vessel" class="py-20 lg:py-24">
        <div class="mx-auto max-w-[1400px] px-6">
          <div class="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-14">
            <div>
              <h2 class="text-3xl font-semibold tracking-tight md:text-4xl">
                把液位读成体积和质量
              </h2>
              <p class="mt-5 text-base leading-relaxed text-slate-600">
                几何参数取自设备台账：内径、筒体长度、直边、封头深度。椭圆封头按分段积分，卧式与再沸器按弓形面积。
              </p>
              <ul class="mt-7 flex flex-wrap gap-x-2 gap-y-2">
                <li
                  v-for="name in VESSELS"
                  :key="name"
                  class="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs text-slate-600"
                >
                  {{ name }}
                </li>
              </ul>
            </div>
            <img
              :src="vesselCalcShot"
              alt="压力容器体积计算页：左侧选容器与液位，右侧是罐体剖面与起止液位的差值标注"
              class="w-full rounded-card border border-slate-200 bg-white shadow-card"
              width="2000"
              height="1224"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      <!--
      登录与权限：两列纯文字 + 细分隔线，**没有卡片**。
      技能 Section 4.4 说卡片只在层级真需要表达时才用；这一段的层级用留白和分割线就够。
    -->
      <section id="access" class="border-t border-slate-200 bg-white py-20 lg:py-24">
        <div class="mx-auto max-w-[1400px] px-6">
          <h2 class="max-w-[26ch] text-3xl font-semibold tracking-tight md:text-4xl">
            不登录就能看，要写数据才需要权限
          </h2>

          <div class="mt-12 grid gap-x-14 gap-y-12 md:grid-cols-2">
            <div>
              <h3 class="text-base font-semibold">未登录：只读浏览</h3>
              <p class="mt-3 text-sm leading-relaxed text-slate-600">
                打开地址就能用，不需要账号。以下六页对所有人开放。
              </p>
              <!--
              六项用**胶囊**而不是带分隔线的列表。
              技能在两处点名禁止了这个写法：Section 4.9「超过 5 项的列表不要用默认 ul +
              divide-y」、Section 9.F「不要给长列表的每一行都画上下边框」。
              上一版正是 6 行 divide-y + border-t，正好踩中。
              胶囊还与本页别处（功能清单、容器名）的写法一致。
            -->
              <ul class="mt-6 flex flex-wrap gap-x-2 gap-y-2.5">
                <li
                  v-for="page in OPEN_PAGES"
                  :key="page"
                  class="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs text-slate-600"
                >
                  {{ page }}
                </li>
              </ul>
            </div>

            <div>
              <h3 class="text-base font-semibold">登录后：按角色开放写入</h3>
              <p class="mt-3 text-sm leading-relaxed text-slate-600">
                账号由管理员分配。权限到位后，对应入口才会出现，没有权限的入口不会显示成点不动的死按钮。
              </p>
              <ul class="mt-6 space-y-4">
                <li class="border-l-2 border-brand pl-4">
                  <p class="text-sm font-medium">台账明细六页</p>
                  <p class="mt-1 text-sm text-slate-600">
                    工单汇总、领料汇总、入库汇总单、工单报工、工单核算、原辅料核算，只对管理员开放。
                  </p>
                </li>
                <li class="border-l-2 border-brand pl-4">
                  <p class="text-sm font-medium">数据维护三页</p>
                  <p class="mt-1 text-sm text-slate-600">
                    设备数据维护、文件导入、图片解析，需要相应的写入权限。
                  </p>
                </li>
                <li class="border-l-2 border-slate-300 pl-4">
                  <p class="text-sm font-medium">储罐液位记录</p>
                  <p class="mt-1 text-sm text-slate-600">
                    只读对所有人开放；增删改需要记录维护权限。
                  </p>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- 收尾：整幅强调色带，只有一个 CTA，标签与导航、hero 完全一致 -->
      <section class="bg-brand py-16 lg:py-20">
        <div class="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-8 gap-y-5 px-6">
          <p class="text-xl font-medium text-white md:text-2xl">
            地址发给你就能打开，未登录先看看。
          </p>
          <RouterLink
            to="/"
            class="ml-auto rounded-xl bg-white px-6 py-3 text-sm font-medium text-brand-deep transition hover:bg-brand-50 active:scale-[0.98]"
          >
            进入工作台
          </RouterLink>
        </div>
      </section>

      <footer class="mx-auto max-w-[1400px] px-6 py-10 text-xs text-slate-500">
        HND生产助手 · 六仓制造系统生产数据工作台
      </footer>
    </div>
  </div>
</template>
