/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /**
       * 配色系统 v5：中性清水玻璃（变更-043，使用方 2026-10-11）。
       *
       * 使用方看过 042 的蓝 Liquid Glass 后一句话：「不要蓝色，做成透明」。
       * 经问答拍板三颗棋子：①全站去蓝、主色换石墨黑（macOS 风）；②侧栏改
       * 浅色透明玻璃（文字翻深）；③底场改浅中性柔光渐变 + 玻璃改清水档
       * （填充大降、模糊升、去 saturate）。
       *
       * 041 的教训在本版反过来用：那张「有颜色的光场」去掉了颜色，但**亮度
       * 变化不能去掉** —— 一张纯色平纸上 blur 无物可糊（036 的老结论），所以
       * 浅场必须带渐变与两团极淡的中性光斑，玻璃才有东西可喝。透明感由
       * 「低填充 + 高模糊 + 边光学（042 保留）+ 柔光场」共同承担。
       *
       * 结构（每层都有且只有一个角色；night→desk、smoke→veil 是改名，值也换了）：
       *   desk    → 16px 外框 / 页面根 / body / theme-color（浅桌面灰）
       *   canvas  → 底场的底停（= .glass-field 渐变最深端，spec 逐位比对）
       *   raised  → 玻璃上抬起来的面（纯白；卡片 /95）
       *   region  → 垫下去的一层（表头 / 行 hover / 输入底，纯中性灰）
       *   veil    → 侧栏轻纱的基底（侧栏 /55 —— 比场深一档的「深伴星」；
       *             041 的深侧栏语义退役：三块玻璃不再深浅二分）
       *   brand*  → 高亮色族（实心按钮 / 选中胶囊 / 焦点环 / 浅底）
       *
       * 对比度锚点（spec 全部复算钉着）：
       *   白字压 brand #1D1D1F = **16.83** ✓✓ —— 石墨主色把「按钮底」的余量
       *   从 4.70 拉到 16.8，041 时代那些「白字贴线」的账全部退役。
       *   brand-deep = brand×0.8（= EP dark-2 同一来源），浅底上的一切文字用它。
       *   浅底三档 = EP light-9/8/7 混白公式的同步值；深字压 brand-200 也过
       *   AA（043 起旧「brand-200 上不许垫文字」的禁令退役）。
       */
      colors: {
        /*
         * 桌面 —— 最外圈。**x-minimalist：暖骨 #F4F3EF**（043 的浅冷灰 #DEDFE5
         * 已退役，值在 git 历史里）。16px 外框、body、NotFound / Login / 工作台
         * 的页面根、index.html 的 theme-color —— 五处同一个值。
         *
         * 「一张纸运行在桌面上」这个观感从 037 立起来，颜色换过四代
         * （暖白 → 天穹蓝 → 中性清水 → linear 近黑 → 现在这版暖骨），
         * **它比任何一版配色都长寿**：换的永远是纸的颜色，不是"有没有纸"。
         * 与 canvas 的分离比 1.11（spec 实算钉 ≥1.08）—— 外框与纸必须分得开，
         * 否则就是"整屏泛白、看不出有一张纸"（037 使用方原话）。
         */
        desk: '#F4F3EF',
        /*
         * 纸 —— **纯白 #FFFFFF**（x-minimalist；043 的浅中性场 #E9E9EE 已退役）。
         *
         * minimalist 的编辑式文档感：一张平的白纸 + 墨字 + 发丝线。036~043 的
         * 「场 + 三段渐变 + 两团光斑」整组退场 —— 那些是**给玻璃吸的**，这一代
         * 不要玻璃（minimalist 把 gradient blobs 与 glassmorphism 写进反模式）。
         * 现在只剩 `minimal-field.css` 里一道 α=0.035 的暖径向：让一大片白
         * "是纸"而不是"没画完"（minimalist：Minimalism is not emptiness）。
         * α 是硬上限 —— 再亮就在宽表里看出色斑，也会让白卡与纸的分离比跌破 1.046。
         * 深字（slate-900）压它 17.9:1。
         */
        canvas: '#FFFFFF',
        /*
         * 抬起来的一层 —— 也是**纯白**。
         *
         * 白纸上的白卡片不靠色差分层，靠 **1px 发丝线**（下面的 `line`）与间距：
         * minimalist 的高程条 —— "A border/divider replaces a card whenever
         * elevation isn't communicating hierarchy"，阴影"几乎不存在"，
         * 真要用也只允许「超大扩散、α < 0.05」那一档（tailwind 的 shadow-card
         * 已按这条收到 0.04）。
         *
         * ⚠️ 它与 canvas / region 的分工照旧（变更-037 立的规矩）：raised 是
         *    「压在纸上那张卡」，canvas 是「纸」，region 是「垫下去」。
         *    这一代三者**允许同值** —— 分层责任从颜色移交给描边；
         *    但**不许互借名字**：护栏分别钉着各自的约束（EP 的三档空白填充
         *    = raised、--el-fill-color = region，两条都要继续成立）。
         */
        raised: '#FFFFFF',
        /*
         * 区域底 —— 暖中性一档 #F7F7F5（043 的冷中性 #EEEEF1 已退役）。
         * 表头带、列表行 hover、输入框静止底、分组垫底。
         * 压白卡 1.07 —— 「看得见表头」的 1.046 底线由 spec 实算钉着
         * （宽表后台里这条比任何装饰都重要：表头带一没，15 个 tab 的读表速度就掉）。
         * 它是全站唯一的垫底档：不许 slate-50/100 之类的调色板灰回流
         * （spec 有一条反扫钉着这个角色）。EP 的 --el-fill-color 与它同值。
         */
        region: '#F7F7F5',
        /*
         * 侧栏面 —— 暖骨一档 #F7F6F3（043 的冷灰纱 #CED0D4 已退役）。
         *
         * 侧栏不再是一块半透明玻璃，而是**不透明的面 + 1px 发丝线** ——
         * minimalist 的分层是"用描边而不是材质"（它把 glassmorphism 列为反模式，
         * 只给导航留了"subtle nav blur"这一条口子，本项目连这条也没用）。
         * 与纸的分离比 1.08（「深伴星」那条线，spec 实算钉着）—— 靠"比纸深半档"
         * 的骨色，不再靠 043 那种"侧栏投影在脚下积成影子沟"的做法。
         * 纱面**托不住浅色字**（这条从 043 起没变）：侧栏字族是 slate 深字族，
         * 白色只留在选中胶囊（墨色实底，18.9）里面。
         */
        veil: '#F7F6F3',
        /*
         * 发丝线 —— **1px #EAEAEA**（minimalist 的形状条直接点名这个值）。
         *
         * 这一代它是**唯一的分层手段**：卡片、面板、分割线、`<kbd>` 键帽都用它
         * （043 用 `border-white/60` 这类"玻璃白描边"扮演同一个角色）。
         * 键名是 `line` 而不是 `border` —— 与 Tailwind 自己的 borderWidth 键区分开，
         * 也避免与 `borderColor` 的角色名撞车（spec §14 钉着命名不许撞）。
         */
        line: '#EAEAEA',
        /*
         * 品牌色族 —— **墨色 #111111**（x-minimalist；043 的石墨 #1D1D1F 与
         * x-ai 分支的薰衣草蓝 #5e6ad2 都在 git 历史里）。
         *
         * minimalist 的签名动作就是它："Solid #111 CTA button, white text,
         * 4–6px radius, no shadow"。它这套语言里**颜色是稀缺的**（只用于语义：
         * 状态标签、错误、成功），所以主色不是一个"好看的强调色"，而是最深的墨。
         *   brand       #111111 —— 实心按钮 / 选中胶囊 / 焦点环。
         *               白字 **18.9** ✓✓（比石墨那代余量还大 —— 阈值不是换代的
         *               理由，观感才是）。EP 主色（theme.css 的
         *               --el-color-primary = 它，spec 交叉钉）。
         *   brand-deep  #0E0E0E —— 浅底上的文字 / 链接 / hover = brand×0.8，
         *               与 EP 的 dark-2 混色公式**同源**（两边实算是同一个值）。
         * 浅底三档 = EP 的 light-9/8/7 混白公式（brand-50 #E7E7E7 = light-9……），
         * 同源可交叉验证：深字一律 brand-deep；三档全部中性（max−min = 0）。
         */
        brand: '#1E40AF',
        'brand-deep': '#18338C',
        'brand-50': '#E9ECF7',
        'brand-100': '#D2D9EF',
        'brand-200': '#BCC6E7',
      },
      borderRadius: {
        // 卡片 / 面板。linear 的卡片铬合金圆角 = rounded.sm（8px），原来是 20px
        card: '8px',
      },
      boxShadow: {
        /*
         * 两个 token，管两件不同的事，别互相套用：
         *
         *   card  —— 卡片**高程** + 上下缘镜面细线。
         *   panel —— 三块液态玻璃面板专用（**名字是踩过坑改的**，见下）。
         *
         *（043 退役了 glow —— 选中胶囊不再有光晕环，石墨实底自撑。）
         *
         * ⚠️⚠️ **它不叫 `glass` —— 这个名字是踩了坑改回来的**（2026-10-08）。
         * 第一版就叫 `glass`，而当时的 `colors` 里也有一个 `glass`（玻璃色调）。
         * 后果是 Tailwind 生成了两条同名的 `.shadow-glass`：来自 boxShadow 的
         * 那条与来自 shadowColor 的那条**选择器、优先级完全相同**，后者赢，
         * 于是 `--tw-shadow` 被换成「三笔颜色全取 --tw-shadow-color」的版本，
         * 外投影与内缘**统统变成不透明的实色**，面板周围糊了一圈。
         *
         * ⚠️ **要命的是没有任何东西会报错**：lint 绿、build 绿、单测绿。
         * 抓出它的是无头 Chrome 读回来的 computed `boxShadow`。
         * **起名规则：boxShadow / borderRadius 的 key 不许与 colors 的 key
         * 同名**（spec 对着整个 Tailwind 自带调色板钉这条）。
         * 变更-041/043 先后退役了 `glass` 与 `glow`，但这条规矩不退休。
         *
         * 为什么不写成 `shadow-card shadow-panel` 两个类：
         * Tailwind 的两条 shadow-* 都往同一个 `--tw-shadow` 上写，后者覆盖
         * 前者，不是叠加。所以内缘必须与外投影写在同一个 token 里。
         *
         * 内缘（inset）是「液态玻璃」最便宜也最见效的一层：上缘一道白
         * 1px（镜面高光）、下缘一道深 1px（厚度）——配合不透明的 border-white
         * 描边，就是 WWDC25 讲的「光在边缘聚拢」。用 inset 而不是伪元素，
         * 是因为主区栏与侧栏**自身就是滚动容器**：绝对定位的伪元素会跟着
         * 内容滚走，而 inset 阴影画在 border box 上，不随内容滚动。
         *
         * 投影色 043 从**带蓝的深色**换成**中性深**（rgba(18 18 22 /…)）：
         * 041 的蓝是「挡的是天穹的蓝光」；现在挡的是中性场的光，投影自然
         * 中性（纯黑压浅灰会发死，带一点冷调的 18/18/22 正好）。panel 的
         * 外投影 α 从 0.22 一路收到 **0.10**：第一版收到 0.20，实机发现浅底
         * 上这道投影在侧栏脚下积成一条「影子沟」，接缝两边的亮度差被吃掉、
         * 侧栏/场分离比从 1.09 压到 1.03；收到 0.10（与 card 同 α，靠更大的
         * blur/offset 分层级）之后沟没了、分离比回来了（见 veil 段与
         * _runlogs/ch043.md 的定档过程）。
         *
         * 变更-042 在 panel 上加了「边缘色散」两道（顶/左冷 150,190,255、
         * 底/右暖 255,180,175 —— 像光穿过有厚度的玻璃边时被掰开的色光），
         * 043 **逐字节保留**（使用方点名要过；冷线本身是淡蓝，但它是 1px
         * 光学不是配色），**顺序是载荷**：
         * CSS Backgrounds 3 原文「the first shadow is on top」，写了 7 段、
         * 第一段画在最上 —— 041 的顶缘 1px 白镜面线必须仍排在最前（它是最
         * 亮的一道），冷线退到第 2px；底缘同理：041 的深线在前、暖线在
         * 第 2px。另外 inset 阴影会被裁在 **padding box** 内（画在背景之上、
         * 描边之下）—— 三块玻璃都有 1px border-white，所以色散线是画在白
         * 描边**里侧**的，不会盖住描边。改顺序请一并改 spec 的顺序断言。
         * 043 只动了外投影与底深两笔的颜色值（3,12,40→18,18,22 与
         * 4,14,45→24,24,30）外加 panel 外投影的 α。
         */
        /*
         * x-minimalist：两层玻璃光学（内缘镜面线 + 边缘色散 + 外投影）**整组退役**。
         * minimalist 的高程来自字阶、对比与空间，不来自深度 —— 阴影"几乎不存在"，
         * 真要用也只允许「超大扩散、α < 0.05」这一档。分层交给 `line` 发丝线。
         *
         * 两个 token 仍然保留（key 不动）：card 给卡片一点纸上的轻微抬起，
         * panel 给整块面板近乎平贴的一档 —— α 分别是 0.04 / 0.03，都在 0.05 以内。
         * 原来的 rgb(150 190 255) / rgb(255 180 175) 两道色散线是"玻璃厚度"的
         * 光学，白色纸面上没有玻璃可镶边，一并去掉（含 §17 的样张）。
         */
        card: '0 2px 8px rgba(0, 0, 0, 0.04)',
        panel: '0 1px 2px rgba(0, 0, 0, 0.03)',
      },
    },
  },
  /*
   * ===== blocklist：不许生成的类名（x-minimalist，2026-10-15）=====
   *
   * **为什么需要它**：Tailwind 的内容扫描**不剥注释**。本仓的注释文化是"把退役的
   * 类名写下来记账"（`bg-white/55`、`glass-frost`、`backdrop-blur` …），而这些
   * 字面量会被当成候选类名**真的生成成 CSS** —— 于是产物里出现了 markup 从未使用、
   * 只是被文档提到的规则。实测：改这一版之前 `index-*.css` 里就有
   * `.backdrop-blur`、`.backdrop-blur-\[30px\]`、`.backdrop-filter` 三条，
   * 全部来自注释；产物 CSS 因此从 38.05 kB 掉到 36.16 kB（去掉任意值那两条）
   * 与 35 kB 上下（去掉裸名这几条）。
   *
   * **它比"把注释写歪"好在哪**：注释可以继续直书退役类名（历史记录最值钱的部分），
   * 不必为了躲开扫描器而写成 `backdrop-blur（32px）` 这种别扭形式。
   *
   * ⚠️ 它是**硬封禁**：列进来的类即使 markup 真用了也不会生成。所以只列
   *    「已经全仓确认零用法」的退役名 —— spec §1「禁用类名不得回流」扫的是
   *    src 文本，两边重复但角度不同：那条防"有人写回 markdown"，这条防
   *    "扫描器把它生成出来"。加新名字前先全仓 grep 一遍。
   *
   * ⚠️⚠️ 匹配是**精确候选串**（Tailwind 内部 `notClassCache.has(candidate)`），不是前缀：
   *    · `'backdrop-blur-'` 这种前缀**永远匹配不到任何候选**，是死条目（已删）；
   *    · 带任意值的形态（`backdrop-blur-[30px]`）与带 variant 的形态必须**逐个列出来** ——
   *      曾经漏了这一个，产物里一直带着 `.backdrop-blur-\[30px\]`（变更-066 修，
   *      生产者在 WorkOrderList.vue 的**注释**里：Tailwind 扫原始文本，注释也算）。
   */
  blocklist: [
    // 玻璃时代的材质名（043 及更早，全部已退役）
    'backdrop-blur',
    'backdrop-blur-[30px]',
    'backdrop-filter',
    'backdrop-saturate',
    'blur-xl',
    'blur-2xl',
    'border-white',
    'border-white/60',
    'border-white/70',
    'bg-white/55',
    'bg-white/85',
    'bg-raised/95',
    'glass-refract',
    'glass-veil',
    'glass-frost',
    'glass-field',
    'glass-scroll',
    'shadow-panel',
    'shadow-glow',
    'bg-glass',
    // 更早两代的遗留（041 及以前）
    'bg-smoke',
    'bg-night',
    'glass-sky',
    'glass-smoke',
  ],
  plugins: [],
}
