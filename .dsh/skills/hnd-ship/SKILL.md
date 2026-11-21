---
name: hnd-ship
description: 手机端 HND 生产助手（uni-app + wot-design-uni）这一侧的改动规矩与发版入口。当任务涉及手机端页面/组件、升 versionName/versionCode、build:h5 或 build:app、HBuilderX 云打包、APK 目录、build-guard 报错时先读本文件；完整的发版/台账/踩坑流程在统筹仓的 hnd-ship 技能里。
---

# hnd-ship（手机端这一侧）

本仓 `D:/project/hnd_factory_UI_uni_APP`（分支 `feat/uni-app`）只放手机端源码。
**完整流程（台账四段式、桌面端发版、网页部署、自动发布四道守卫、踩坑清单）在统筹仓：**

```
D:/project/hnd_factory_UI/.dsh/skills/hnd-ship/SKILL.md
```

## 本仓只需要的三条稳定事实

1. **版本号只有一处**：`src/manifest.json` 的 `versionName`（如 `1.0.25`）+ `versionCode`（如 `125`），
   两个必须同步 +1，且**必须比线上大**。改完再点云打包，顺序反了会被自动发布的守卫 4 拦下。
2. **编译自检**：`npm run build:h5`（= `uni build && node resources/strip-vessel-images.mjs`），
   过没过看末尾 `[build-guard] ✅ 环境自检通过：无私网地址，命中 hbhnd.cloud` 与 `DONE  Build complete.`。
   `MODULE_TYPELESS_PACKAGE_JSON` 是既有噪音。
3. **包从哪来**：人工用 HBuilderX「发行 → 原生App-云打包」产出，落 `dist/release/apk/__<14位时间戳>.apk`；
   之后计划任务 `HND-app-auto-publish` 每分钟自动发布，不用手动传。

## 改完代码的固定收尾

`npm run build:h5` 通过 → 写台账（在统筹仓那个 md 里追加「变更-N」，四段式）→ 本仓 commit/push
→ 统筹仓 commit/push（台账）→ 告诉用户「用 HBuilderX 重新云打包」。
