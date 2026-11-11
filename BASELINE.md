# hnd_factory_UI 基线（2026-11-11）

> 只写**确定生效**的东西。后续对话以此为准，更早的调试过程不再带入。
> 更新方式：改这里，并同步一条 git 提交。

## 1. 项目与技术栈

- 仓库：`D:\project\hnd_factory_UI`；App 端在 `D:\project\hnd_factory_UI_uni_APP`，分支 `feat/uni-app`。
- 前端：**uni-app**（Vue 3 `<script setup>` + `<view>` + `wot-design-uni`）。
  - 注意：不是 uni-app x 的 uvue/uts。写法按 uni-app，效果按 uni-app x 的要求做（真机手感优先）。
- 后端：`D:\project\hnd_factory`（Java 21 / Spring Boot 3.5 / gradle），未变。
- 部署：PC 站 `https://hbhnd.cloud`，站点根 `SITE=/opt/1panel/apps/openresty/openresty/www/sites/hnd-ui`，发版＝`mv index → index.prev.$STAMP` + `mkdir` + `cp -r`。

## 2. 抄表页（`src/pages/meterRead/meterRead.vue`）

### 2.1 手势翻页（**不许改动**）

一条连续轨道，只有 `translate3d` 在动；进度 `floatIndex = scrollX / stageW` 是唯一真值。

| 参数 | 值 | 含义 |
|---|---|---|
| `VELOCITY_WINDOW` | 60ms | 松手取速度的时间窗 |
| `GLIDE_TAU` | 760 | 预测滑行距离 = 初速 × 760ms |
| `GLIDE_BOOST` | 3.6 | 松手速度放大 |
| `GLIDE_VMAX` | 15 px/ms | 速度上限 |
| `GLIDE_MIN_MS` | 420ms | 最短滑行时长 |
| `SNAP_MS_GLIDE` | 220ms | 惯性滑行后的吸附 |
| `SNAP_MS_BRAKE` | 150ms | 刹车拖动松开后的吸附 |
| `PEEK_SCALE` / `PEEK_FADE` | 0.14 / 0.45 | 邻页缩放与淡出 |
| `PEEK_PX` | 8px | 邻页内收，露一点边暗示可滑 |
| `WINDOW_RADIUS` | 2 | 只渲染 ±2 页（其余 `display:none`） |

行为：

- 拖动 1:1 跟手，拖动中不做分页判定；
- 松手按「初速 × τ」预测落点，easeOut 减速，结束时吸附对齐整页；
- 滑行中按住立刻刹车，本次按下当拖拽起点；
- 手指停住再松手不算高速（只认最近 120ms 样本）；
- 首尾有 0.35 阻尼，不回弹乱甩。

### 2.2 液体胶囊 tab

- 选中态是一条**独立胶囊**，位置/宽度/高度全部由 `floatIndex` 插值算出，**没有第二个定时器**；
- 液体画在标签**下层**（`z-index:0`），标签自己用不透明底色（`--ui-surface-2`），保证任何时刻文字都有稳定底色；
- 前缘 easeOut 先冲，后缘过 **45%** 才跟；半页处**鼓包 7px**（上移 3.5px）；吸附套 `easeOutBack` **1.18**；拉扯时 `blur` 最大 1.1px；
- 静止时液体与选中胶囊完全重合。

### 2.3 底部操作栏（固定）

- `.mr` 为定位容器（`position: relative`），底部预留 `--mr-bar: 120rpx` + 安全区 + 键盘高（`--mr-kb`）；
- `.mr__actions` 绝对定位 `left/right/bottom` 相对 `.mr`，`z-index: 8`，浮在卡片上方；
- 卡片区 `.mr__stage` 用 `flex: 1 1 auto; min-height: 0` 吃掉中间剩余高度，卡片在这块里垂直居中滑动；
- 安全区走 `env(safe-area-inset-bottom)`，**不用 `position: fixed`**；
- 栏内：`‹` 翻页 / `提交全部（N）+ 还有 M 块没填` / `›`，样式不变。

**CSS 陷阱（已踩过，勿回退）**：祖先只要带 `position: relative` 或 `will-change: transform`，就会成为绝对定位的包含块——会把底部栏拖回舞台底边，卡片一矮栏就跟着跳。舞台这两项都必须为空。

## 3. 视觉目标

- DSH 式**通透磨砂**：浅色底 + 半透明层 + 细描边，拒绝传统后台的厚重色块；
- 只用项目已有 token（`--ui-*`），不新起配色；
- 文案短：按钮与提示不写解释性长句；
- 可读性底线：正文对比度 ≥ 4.5:1，触控目标 ≥ 44px。

## 4. 路线与边界

1. 先调真机手感（正在等用户实测反馈）；
2. 手感定稿后再考虑「纯 SVG 液体胶囊」版本；
3. 功能优先：原有业务逻辑、提交逻辑、字段一律不动，只改交互与视觉；
4. `docs/gesture-pager/`（组件 + 接线说明）与 `scripts/verify-pager.mjs`（CDP 量测）已在仓库，接线属独立任务，未做。

## 5. 当前状态（2026-11-11）

- App 仓 `feat/uni-app` 最新：`3db0651` 底部栏固定；上一笔 `2ad822c` 液体胶囊。
- 待用户真机验收：液体鼓包是否被裁、半页时两张标签字是否清楚、吸附回弹是否够果冻。
