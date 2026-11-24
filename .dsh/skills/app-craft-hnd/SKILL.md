---
name: app-craft-hnd
description: HND 生产助手（手机端 uni-app + wot-design-uni）这个仓的「套用说明书」——把全局七件套 app-craft / -brief / -ui / -data / -motion / -ship / -debug 映射到本仓的真实目录、真实组件、真实命令与原版本号规则。当在这个仓里做页面、改交互、加数据同步、发版，或要把别处的做法搬进来时读本文件；具体发版与台账流程仍以 hnd-ship 为准。
---

# app-craft-hnd（本仓的落地说明）

全局那七件套讲的是「怎么做」，本文件只讲「在这个仓里对应到哪儿」。

## 一、这个仓是什么

- 仓库：`D:\project\hnd_factory_UI_uni_APP`，uni-app + Vue 3 + Vite + wot-design-uni，产物走 **HBuilderX 云打包 APK**，另有 H5 构建。
- 使用方是**同一个人**（也是唯一验收者）：工厂现场 + 出差用，要的是「打开就能查、点了就有反应」，不是炫技。
- 行为准则与发版规矩：以 `~/.dsh/AGENTS.md` 和本仓 `.dsh/skills/hnd-ship` 为准；两者与全局 skill 冲突时，**以本仓/本机为准**。

## 二、七件套在本仓的入口

| 全局 skill | 在本仓先看什么 |
|---|---|
| `app-craft` | 本文件 + `.dsh/skills/hnd-ship/SKILL.md`（发版与台账） |
| `app-craft-brief` | `~/.dsh/AGENTS.md` 的「先 grill 再动手」；需求确认过再写代码 |
| `app-craft-ui` | `src/uni.scss`（`--ui-*` 令牌）、`src/components/PageTitle.vue`、`src/components/AppPopup.vue`、`src/pages/userAdmin/userAdmin.vue`（列表页参考） |
| `app-craft-data` | `src/api/storage.js`（`getItem/setItem/removeItem`）、`src/utils/vault.js`（本地 + 服务器总账 + 合并的完整范例） |
| `app-craft-motion` | `src/components/GesturePager.vue`（横滑分页实现）、`src/pages/vault/vault.vue`（两栏轨道 + 果冻药丸） |
| `app-craft-ship` | `src/manifest.json` 的 `versionName`/`versionCode`、`package.json` 的 `build:h5` / `build:app`、`.dsh/skills/hnd-ship` |
| `app-craft-debug` | 与 `docs/` 里的排障记录配合用；`src/api/http-common.js`（登录硬闸）是很多「看起来没数据」的根源 |

## 三、本仓的既有约定（照抄，别另起一套）

- **页面骨架**：根节点 `:class="themeClass"` + `:style="[themeVars, frameStyle]"`，配 `PageTitle`；返回手势用 `useEdgeSwipe(() => uni.navigateBack())`。
- **主题**：颜色只用 `--ui-*`，深浅色靠根节点 `.theme-dark`；不要写死色值（弥散背景除外，它本身就是色彩层）。
- **弹层**：一律用 `AppPopup`，它自带弹层栈与滚动锁；不要自己写 `position:fixed` 遮罩。
- **吸底按钮**：`padding-bottom: calc(12rpx + env(safe-area-inset-bottom))`，表单页用页面级滚动（别用固定高 scroll-view，安卓键盘会顶坏）。
- **权限**：管理员判定 `isAdmin()`（来自 `src/api/auth.js`）；入口用 `v-if` 渲染，不要「能进去但报错」。
- **横向手势**：需要「一屏一组跟手翻页」直接引 `src/components/GesturePager.vue`，别重写；它的 `pageWidth` 必须由父级实测传入。
- **数据**：本地用 `src/api/storage.js`；要跨设备就照 `src/utils/vault.js` 的模式（服务器总账 + `pullAndMerge` + 幂等迁移）。

## 四、命令与自检

```bash
npm run dev:h5      # 本地看页面（端口 9092）
npm run build:h5    # 发版前必跑；结尾要看到 build-guard ✅ 与 DONE  Build complete.
npm run build:app   # 产出给 HBuilderX 云打包的工程
```

- 版本号只改 `src/manifest.json` 的 `versionName` 与 `versionCode`，两者同步 +1。
- 改完必须自己先验一遍（H5 或真机），再交付；交付说明写清「去哪儿点、看到什么算成功」。

## 五、别做的事

- 不要为了「看起来高级」加装饰性动效；使用方要的是快和准。
- 不要新增第二套视觉语言（第二套令牌、第二套卡片样式）。
- 不要跳过 grilling 直接改代码；不要跳过 `ui-taste` 直接写界面。
- 不要在这台机器上凭记忆改线上数据（vault.json 之类），先备份再动，且只加不改。
