# DESIGN.md — hnd_factory_UI 的 minimalist 令牌（分支 `x-minimalist`）

> 令牌来源：`ui-taste` 技能的 **`styles/minimalist.md`**（内置风格之一）。
> 选手它的理由与该 pack 自述一致：**「温暖的单色、编辑式文档感 —— 层次由字体与留白
> 承担，近乎没有阴影」**。本项目是中文内网工厂后台，长时间盯表，需要的正是
> 「安静、克制、不靠装饰分层」的语言。
>
> **但 pack 自己写着 `not_for: high-density dashboards, data-heavy tables`** ——
> 而这个项目的主体就是 15 Tab 宽表。所以这份文档的第 4 节是**密度例外条款**：
> 哪些 minimalist 规则进宽表、哪些不进。那条不是"偷偷混合"，是这次改造的正式契约。
>
> 只做**令牌/外观层**改造，不动组件结构与业务逻辑。
>
> **回退**：`git checkout x-ai`（linear 深色，commit `09977cb`）或 `main`（043 清水玻璃）。

## 0. 三个分支 = 三套配色，都在 git 里

| 分支 | 语言 | 画布 | 主色 | 材质 |
|---|---|---|---|---|
| `main` | 043 中性清水玻璃 | `#E9E9EE` 浅场 + 两团光斑 | 石墨 `#1D1D1F` | 两档半透明玻璃 + 折射层 |
| `x-ai` | linear 深色 | `#010102` 近黑 | 薰衣草蓝 `#5e6ad2` | 炭灰面板 + hairline |
| **`x-minimalist`** | **minimalist 文档感** | **纸 `#FFFFFF`／桌 `#F4F3EF`** | **墨色 `#111111`** | **白面 + 1px 发丝线，无玻璃** |

## 1. minimalist 的语言（取自 pack 原文，落点见括号）

- **画布**：纯白或暖骨（→ 两层：`canvas` 纯白纸 / `desk` 暖骨桌面）。
- **描边**：`exactly 1px solid #EAEAEA`（→ 新增令牌 `line`，取代 043 的玻璃白描边）。
- **形状**：卡片圆角 8px 上限、按钮 4–6px，**不许 rounded-full 用在大容器上**。
- **高程**：层次来自字阶、对比与空间；阴影"几乎不存在"，真要用也只允许「超大扩散、
  α < 0.05」（→ `shadow-card` 收到 0.04、`shadow-panel` 收到 0.03，两层玻璃内缘光学整组退役）。
- **颜色稀缺**：强调色只用于语义；主色就是**最深的墨**（→ `#111111` 实底 CTA，白字 18.9:1）。
- **动效**：`motion should be felt, not seen`；只动 `transform`/`opacity`，尊重 reduced-motion。
- **反模式（点名）**：Inter/Roboto/Open Sans 当默认字体；重阴影；渐变光斑；
  glassmorphism（只留给导航一条"subtle nav blur"的口子）；emoji；`rounded-full` 大容器；
  "John Doe / Acme / Lorem Ipsum"；AI 填充动词。

## 2. 令牌映射（`tailwind.config.js` 的 `colors`，**就地改值**）

⚠️ 这里有个机制坑值得记住：`tests/unit/visualTokens.spec.js` 的 `tokenHex()` 用正则取
配置里**第一处**匹配。x-ai 那版把 linear 值放在末尾 `...{ }` 覆盖块里 —— 于是 spec
读到的仍是 043 的旧值，**契约测试看不见新配色**（x-ai 唯一那条红灯就是这么来的）。
x-minimalist 改成**就地替换基础值**，单一事实来源，spec 直接读到。

| 角色 | 043 原值 | x-minimalist | 依据 / 实算账 |
|---|---|---|---|
| `desk` 桌面/外框 | `#DEDFE5` | **`#F4F3EF`** | 暖骨；与纸 **1.11:1**（≥1.08，外框看得见） |
| `canvas` 纸 | `#E9E9EE` | **`#FFFFFF`** | 纯白文档面；slate-900 压它 17.9:1 |
| `raised` 卡面 | `#FFFFFF` | **`#FFFFFF`** | 与纸同色，分层改由 `line` 承担 |
| `region` 垫底/表头 | `#EEEEF1` | **`#F7F7F5`** | 压白卡 **1.07**（≥1.046，表头带不丢） |
| `veil` 侧栏面 | `#CED0D4`（55% 玻璃） | **`#F7F6F3`** 不透明 | 与纸 **1.08**（深伴星那条线） |
| `line` 发丝线 | （无，用 `border-white`） | **`#EAEAEA`** | pack 直接点名的描边值 |
| `brand` 主色 | `#1D1D1F` | **`#111111`** | 签名 CTA；白字 **18.9** |
| `brand-deep` | `#171719` | **`#0E0E0E`** | = brand×0.8 = EP `dark-2`（同源交叉） |
| `brand-50/100/200` | `#E8E8E9/D2D2D2/BBBBBC` | **`#E7E7E7/#CFCFCF/#B8B8B8`** | = EP `light-9/8/7`（同源交叉） |
| `card` 圆角 | 20px → 8px | **8px** | pack：卡片 8px 上限 |
| `shadow-card` | 8px/28px 投影 + 两层内缘镜面 | **`0 2px 8px rgba(0,0,0,.04)`** | pack：α < 0.05 |
| `shadow-panel` | 12px/32px + 色散线 ×4 | **`0 1px 2px rgba(0,0,0,.03)`** | 同上；色散线是玻璃厚度光学，无玻璃即无镶边 |

`theme.css`（EP 变量）同步：`--el-color-primary: #111111` + 六个派生色按 EP 混色公式重算；
圆角 base 6px / small 4px / 分页 6px / 浮层与弹窗 8px；三档空白填充 = `raised`（纯白），
`--el-fill-color` = `region`。**§5 那组同源交叉断言一条没改就仍然成立** —— 这是刻意的：
EP 与 Tailwind 两侧同值，是这套令牌最容易漂移也最容易守住的地方。

## 3. 材质层：删掉两层，留下一层

| 动作 | 对象 | 原因 |
|---|---|---|
| **删除** | `src/glass-effects.css`（307 行） | 渐变场、两团光斑、顶部柔光条、115° 斜光带、跟滚动的高光、颗粒层、真折射样张 —— 全是 pack 点名的反模式（gradient blobs / glassmorphism） |
| **删除** | `src/linear-theme.css` | x-ai 那条分支的深色覆盖（`#010102 !important`），与本分支相反 |
| **新增** | `src/minimal-field.css` | 「纸」= 纯白 + **一道 α=0.035 的暖径向** + `.minimal-figure`（原来放真折射样张的位置改成一张带发丝线的平图） |
| **改** | 三块面板（侧栏/导航条/主区栏） | `glass-refract glass-veil/frost + bg-*/55 + blur 32/30 + border-white + shadow-panel` → **不透明面 + `border-line`**，无模糊、无阴影 |
| **改** | 卡片配方 ×17 | `bg-raised/95 border-white/60 backdrop-blur-xl` → `bg-raised border-line` |
| **改** | `src/style.css` 字体栈 | **去掉 Inter**（pack 点名的反模式），换系统人文无衬线（拉丁 Segoe UI Variable → 中文 PingFang SC / 微软雅黑）；不引入 webfont（内网离线、体积、首屏） |
| **改** | `index.html` theme-color / `style.css` `:root` 底色 | `#dedfe5` → `#f4f3ef`（= `desk`，与页面外框同值，回弹不出第二条边） |

`minimal-field.css` 里还留了一段**三代病史**（036 的"平纸上 blur 无物可糊" → 041 蓝底
让这句话过期 → 043 去色留亮度 → x-minimalist 换的是问题本身：不要玻璃）。留着是因为
"为什么这次不这么做"和"这次怎么做"同样值钱。

## 4. 密度例外条款（**这份改造的正式契约**）

minimalist 的 `not_for` 写着 `high-density dashboards, data-heavy tables`，而本项目的
主体是 15 个 Tab 的宽表。处理办法不是"那就别用 minimalist"，而是把它拆成两层：

| minimalist 的层 | 进不进宽表 | 落点 |
|---|---|---|
| **令牌层**（画布/墨色/发丝线/小圆角/近零阴影/颜色稀缺） | **全站进** | `tailwind.config.js` + `theme.css`，一次到位 |
| **版式层**（`py-24~32` 大留白、编辑式大标题、bento 网格、全出血图片） | **不进宽表** | 只给首屏三页（Login / Intro / NotFound）与面板空态 |
| **语义色**（rose / emerald / amber / sky 状态） | **保留** | pack 里"颜色稀缺只用于语义"恰好支持这条：状态色是**功能信号**，不是装饰 |
| **表格行高与密度** | **保留现状** | 表头 12px 中灰小字、紧凑行高不动；minimalist 的留白会直接降低 15 个 Tab 的读表速度 |

一句话：**宽表换皮（令牌）不换骨（版式），首屏三页换全套。**

## 5. 本轮未做（下一轮的清单）

1. **`tests/unit/visualTokens.spec.js` 重写** —— 现在它在 import 期就抛
   `ENOENT: src/glass-effects.css`，整个契约套件停摆（其余 16 个套件 224 条全绿）。
   重写目标：把 §10 场配方 / §11 霜面 / §12 两档玻璃 / §13 玻璃上的文字 / §17 折射样张
   这五组换成 minimalist 契约（纸+发丝线+不透明面），其余 13 组（对比度、EP 同源、
   焦点环、可访问名、reduced-motion、侧栏宽度、卡片内滚、键盘通路、液位滑块…）原样保留。
2. **首屏三页整页构图**（Login / Intro / NotFound）—— 版式层真正落地的地方。
3. **`glass-scroll` 标记清理** —— 折射层没了，`--main-scroll` 与那 7 处 `:class` 绑定
   都是死重量；本轮**故意留着**，因为同时要动 `scrollsInsideCard` 这类 JS 变量与
   spec §15 的三条断言，混在一起改容易把 lint 与契约同时弄红。
4. **Intro 的 SVG 折射滤镜链**（`#lg-refract` + 三条降级路径）删除 —— 现在已无消费者，是死代码。
5. **图表配色**（周统计 / V150 产量）换墨色 + 灰阶，语义红绿保留。
6. 视觉复核后把 `[class*=…]` 选择器逐步收敛成语义化 token。

## 6. 验证

- `npm run build` ✅ 通过（6.12s，产物 CSS 38.05 kB / gzip 7.80 —— 043 那版含 16KB 玻璃层时更大）。
- `vitest run`：**224 passed**，16/17 套件绿；唯一红的是 `visualTokens.spec.js`
  在 import 期读 `glass-effects.css` 失败（见 §5.1，属预期，下一轮重写）。
- 视觉验证：`npm run dev` → http://127.0.0.1:9091/ ，重点看**工单列表宽表**（发丝线与
  表头带）、**侧栏**（不透明面 + 选中墨色胶囊）、**登录页**（纸 + 白卡）。
- 对比基准：`x-ai`（linear 深色）/ `main`（043 清水玻璃）。
