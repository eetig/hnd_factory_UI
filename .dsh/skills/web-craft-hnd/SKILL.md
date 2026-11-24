---
name: web-craft-hnd
description: HND PC 端（hnd-factory-ui：Vue3 + Element Plus + Vite，同一份代码出 Web 后台与 Tauri 桌面）这个仓的「套用说明书」——把全局 web-craft / -brief / -ui / -data / -ship / -debug 映射到本仓真实目录、真实命令、真实发版脚本与真实约定。当在这个仓里加页面、改接口、修样式、打桌面包、发 Web 时读本文件；具体发版与台账以统筹仓的规矩为准。
---

# web-craft-hnd · 本仓套用说明

全局六件套讲的是「怎么做」，这份讲的是「在这个仓里落在哪儿」。

## 一、这个仓是什么

- 目录 `D:\project\hnd_factory_UI`，包名 `hnd-factory-ui`，Vue 3 + Element Plus + Vite 6。
- **同一份代码出两端**：Web 后台（`vite build`）与 Tauri 2 桌面客户端（`vite build --mode desktop` + `tauri build`）。
- 桌面端标识 `cloud.hbhnd.hnd-factory`、产品名「HND生产助手」、窗口 1440×900（最小 1100×700）、`decorations:false` 自绘标题栏、安装包 nsis `currentUser` + 简体中文。
- 更新源 `https://hbhnd.cloud/desktop/latest.json`（MinIO 桶 `hnd-desktop`，公开读，minisign 签名）。

## 二、六个全局 skill 在本仓先看什么

| 全局 skill | 本仓先读的真实文件 |
|---|---|
| `web-craft`（总纲） | `package.json`、`src-tauri/tauri.conf.json`、`src/main.js` 顶部注释、`src/api/request.js` |
| `web-craft-brief`（需求） | `src/views/*` 已有哪些页面（先看邻页怎么做，再提方案） |
| `web-craft-ui`（界面） | `src/theme.css`、`src/style.css`、`src/main.js`（EP 按需清单）、`src/components/PanelState.vue` / `LoadingMask.vue` / `OfflineBanner.vue` |
| `web-craft-data`（数据） | `src/api/request.js`、`src/api/base.js`、`src/api/auth.js`、任一 `src/api/*.js`（模块形状） |
| `web-craft-ship`（发布） | `scripts/publish-desktop.mjs`、`scripts/deploy-web.ps1`、`src-tauri/tauri.conf.json` 的 `version`、`package.json` 的 `version` |
| `web-craft-debug`（排障） | `src/api/request.js`（业务失败也 200）、`src/api/desktopHttp.js`（CORS）、`src/layouts/WindowFrame.vue`（壳外页面） |

## 三、本仓既有约定（照做，别另立一套）

1. **接口**：页面不直接 `axios`，一律 `src/api/xxx.js` 导出函数；函数内 `body.code !== 200` 就 `throw new Error(body.msg || '兜底')`；页面 `catch` 必须把 msg 显示出来且**不关弹窗**。
2. **鉴权**：头名是 `satoken`（不是 `Bearer`）；`authState`（内存）+ localStorage（副本）双写，别只写 localStorage；`isAdmin()` 与后端 `checkRole("admin")` 同口径；403 保留登录态。
3. **样式**：只用 `src/theme.css` 的令牌与 Element Plus 变量；**整站只有一个高亮色**；改 `--el-color-primary` 必须六个色阶一起重算；新增 EP 组件必须在 `src/main.js` 补 `el-xxx.css` 并在 `tests/unit/elementPlusStyles.spec.js` 的 REQUIRED 里登记。
4. **样式导入顺序**不要动：EP 按需 → `theme.css` → `style.css`（Tailwind）→ `minimal-field.css`。
5. **桌面差异**：请求地址走 `API_BASE`、静态资源走 `assetUrl()`；桌面端请求走 `desktopHttp.js`（Rust 侧），不要在桌面端直接 `fetch` 相对路径；壳外整页由 `layouts/WindowFrame.vue` 兜底（否则窗口关不掉）。
6. **三态**：空/错/载分别用 `PanelState`、`OfflineBanner`、`LoadingMask`，不要每页自己写一套。
7. **组件**：优先复用 `src/components/` 现成的 22 个（详情弹窗 `WorkOrderDetailDialog`、图片 `ImageGalleryDialog`/`ZoomableImage`、成本下钻 `CostingDrilldownDialog`、筛选表头 `FilterHeaderCell` 等）。

## 四、命令与自检

```
npm run dev             # 本地 9091
npm run build           # Web 产物 dist/
npm run build:desktop   # 桌面产物（tauri build 会先跑这条）
npm run verify          # lint + vitest + build，提交前跑这个
npm run desktop:dev     # 桌面壳里调试（热更新）
node scripts/publish-desktop.mjs --version 1.0.46   # 桌面发版（改版本号+构建+签名+上传）
.\scripts\deploy-web.ps1                            # Web 部署（先备份产物）
```

- 版本号**两处必须同步**：`package.json` 与 `src-tauri/tauri.conf.json`（发版脚本会一起改，手改别漏）。
- Web 更新后必须强刷验证（`assets/*` 有 hash，但 `index.html` 会被缓存）。
- 桌面发版后打开 `https://hbhnd.cloud/desktop/latest.json` 核对版本、URL、签名。

## 五、别做的事

- 别为一个页面引入新 UI 库 / 新图标库（Element Plus 够用，加库要过打包体积这一关）。
- 别在组件里 `import 'element-plus/...css'`（顺序会乱，统一在 `main.js`）。
- 别用 `Bearer`、别自己拼 `fetch`、别绕过 `request.js`。
- 别把「业务失败」当成功（HTTP 200 + `success:false` 是本仓最常见的坑）。
- 别在桌面端用相对路径请求；别只改一端就发版。
- 别在没跑 `npm run verify` 的情况下提交。
