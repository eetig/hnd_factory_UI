---
name: hnd-ship
description: HND 生产助手这套项目的发版与改动记录流程——桌面端(Tauri)安装包怎么发、网页怎么部署、手机端(uni-app)APK 怎么云打包和自动上线、版本号写在哪、构建守卫(build-guard)怎么看、台账「变更-N」怎么写，以及这条链路上反复踩过的坑(PowerShell/git/BOM/GBK/半包/排队)。当任务涉及：发版、发布、部署、打包、升版本号、写台账、发布失败排查、check-app-env、publish-desktop、deploy-web、auto-publish、latest.json，或在 HND 相关仓库里改完代码准备交付时使用。
---

# hnd-ship：HND 生产助手的发版与改动记录

改完代码不等于交付。这套项目的"交付"固定是三件事：**本地构建通过 → 写台账 → 两个仓都推**。
发版再加一步：**把产物推上线并回读线上确认**。

## 0. 先判断这次要不要发版

| 需求 | 要做的事 |
|---|---|
| 只改文档/台账 | 写台账 → 推 desktop 仓 |
| 改了网页(hnd_factory_UI 的 Vue) | 构建通过 → 台账 → 推两仓 → `deploy-web.ps1` |
| 改了桌面端(含 src-tauri) | 升桌面版本 → `tauri build` → `publish_desktop.sh` |
| 改了手机端(uni_APP) | 升 `src/manifest.json` → 构建通过 → 台账 → 推两仓 → **用户用 HBuilderX 云打包** |
| 改了后端(hnd_factory) | `.\gradlew.bat test` → 台账 → **用户跑** `db-apply.ps1` + `deploy-api.ps1` |

后端和云打包这两步**只有用户能做**（云打包要人工点 HBuilderX），你可以先把仓库和台账准备好，把这两条明确写进回复。

## 1. 三个仓

| 仓 | 路径 | 分支 | 角色 |
|---|---|---|---|
| hnd_factory_UI | `D:/project/hnd_factory_UI` | `x-minimalist` | **统筹仓**：网页、桌面端、台账、所有发布脚本 |
| hnd_factory_UI_uni_APP | `D:/project/hnd_factory_UI_uni_APP` | `feat/uni-app` | 手机端（uni-app + wot-design-uni） |
| hnd_factory | `D:/project/hnd_factory` | — | Spring Boot 后端（**Gradle**，没有 mvn） |

版本号在哪（改之前先看现值，别猜）：

- 桌面端：`package.json` 的 `version` **和** `src-tauri/tauri.conf.json` 的 `version`，**两处都要改**。
  `src-tauri/Cargo.toml` 的 `version` 是陈旧值（长期落后），**不用跟着改，也别拿它判断当前版本**。
- 手机端：`src/manifest.json` 的 `versionName`（如 `1.0.25`）和 `versionCode`（如 `125`，必须同步 +1）。
- 网页：没有独立版本号，桌面端设置页显示的"线上版本"来自 `/desktop/latest.json`。

## 2. 台账：`前后端改动统筹.md`（desktop 仓根）

每次改动追加一节，**四段式**，标题行固定格式：

```markdown
## 变更-257（2026-11-21）一句话说清改了什么（1.0.26）

**起因**：用户的哪句话/哪个现象。写人话，别写"优化体验"。

**根因**：一句话点到底是哪行代码/哪个机制错了；如果只是实现选择，就写"为什么这么做"。

**改法**（动过哪些文件）：
1. 按"为什么"组织，不是按文件组织。
2. 贴关键代码块（≤15 行），让人不用打开仓库就知道改了什么。
```css
/* 注释写明"为什么这样写"，例如"必须不透明，否则菜单文字会从底下透上来" */
```

**版本**：`src/manifest.json` → `1.0.26` / `126`；`npm run build:h5` 通过（`[build-guard] ✅ 环境自检通过`、`DONE  Build complete.`）。uni 仓 `<sha>`。

**验收**：装/刷新后具体看什么、点哪里、期望看到什么。能给数字就给数字（"844 = 844"）。
```

要点：**写"为什么"不写"做了什么"**；根因要能让半年后的自己看懂；验收要能照着复现。
台账**一律用 node 脚本写**（见 §7 第 4 条），不要用 PowerShell 拼字符串。

## 3. 网页发布（`hnd_factory_UI`）

```powershell
cd D:\project\hnd_factory_UI
.\scripts\deploy-web.ps1              # 门禁(lint/test) + 构建 + 发布 + 验收
.\scripts\deploy-web.ps1 -SkipVerify  # 急发时跳过门禁（不推荐）
```

它做三步且顺序不能换：备份现站 → 传 dist 到暂存目录 → **整目录原子切换**。
逐文件覆盖会出现"切换成功但线上还是旧 JS"——不要手工用 scp 覆盖文件。
验完让用户**硬刷新**（Ctrl+F5）再看，普通刷新可能吃到旧缓存。

## 4. 桌面端发版（Tauri）

```powershell
cd D:\project\hnd_factory_UI
# 1) 改两处版本号：package.json、src-tauri/tauri.conf.json
# 2) 构建（签名私钥必须给，否则 updater 的 .sig 出不来）
$env:TAURI_SIGNING_PRIVATE_KEY = "D:/keys/hnd-desktop.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "hnd-desktop-1.0"
npx tauri build
# 3) 产物在 src-tauri/target/release/bundle/nsis/
#    HND生产助手_<ver>_x64-setup.exe / .sig / latest.json  —— 三个都要在
# 4) 推送上线（Git Bash 脚本；PowerShell 里必须带 &）
& "C:\Program Files\Git\bin\bash.exe" scripts/publish_desktop.sh 1.0.44
```

`publish_desktop.sh <ver>` 会：校验三个产物都在 → `scp -P 9002` 传到 `eetig@124.220.60.154` →
`docker cp` 进容器 `myOpenresty` 的 `/www/sites/hnd-ui/index/desktop/` → 顺手刷一份稳定别名
`HND生产助手_最新版_x64-setup.exe`（落地页/二维码/邮件里只写这一个地址）。

**上线后回读确认**（别信"脚本跑完了"）：

```bash
curl -s https://hbhnd.cloud/desktop/latest.json | head -c 200     # version 对不对
curl -s https://hbhnd.cloud/desktop/latest.json | head -c 3 | xxd  # 前三字节不能是 efbbbf(BOM)
```

`latest.json` 由 `tauri build` 生成。**需要魔改就用 node 写**（`fs.writeFileSync(p,'...','utf8')`），
用 PowerShell `Set-Content -Encoding UTF8` 会带 BOM，结果是客户端"检查更新永远失败/永远已是最新"。
另一条更老的链路 `scripts/publish-desktop.mjs`（改版本→build→生成 latest.json→`mc cp` 到 MinIO）
已经不在用，它存在的价值是示范"latest.json 必须声明 `content-type: application/json`"。

## 5. 手机端发版（uni-app + HBuilderX 云打包）

```powershell
cd D:\project\hnd_factory_UI_uni_APP
# 1) 改 src/manifest.json：versionName +1、versionCode +1（必须比线上大）
# 2) 编译自检（不是发版产物，只验证代码能过）
npm run build:h5        # 看 [build-guard] ✅ 与 DONE  Build complete.
# 3) 交给人：HBuilderX →「发行 → 原生App-云打包」
#    APK 落到 dist/release/apk/__<14位时间戳>.apk
# 4) 之后全自动：计划任务 HND-app-auto-publish 每分钟跑 scripts/auto-publish-app.mjs
```

自动发布四道守卫（任一不过就拦下并通知「手机端没有自动发布 + 原因」）：

1. **包写完了**（云打包先写临时名再改名，1 分钟一跑很容易撞上半包）
2. **体积合理**（正常 14~16 MB）
3. **仓库 manifest 的版本 > 线上**
4. **APK 里的真实 versionName == 仓库 manifest**（解压二进制 AndroidManifest，utf16le 抓第一个 `x.y.z`）

守卫 3/4 是这条链最容易犯的错：**先改 manifest、再点云打包**。反了的话包里是旧版本号，
线上就会"检测到更新 → 下载 → 装完还是旧版本"死循环。守卫拦下时告诉你"包和仓库版本不一致，
请按当前版本重新打包"——照做就行，不用改脚本。

回读确认：`curl -s https://hbhnd.cloud/desktop/app/latest.json`。

## 6. 构建守卫 `[build-guard]`

`hnd_factory_UI_uni_APP/resources/check-app-env.mjs` 在构建尾部跑：必须命中 `hbhnd.cloud`
（一个 b，别写成 hbhnd.clod / hbbhnd）；`APP_ENV=remote` 时会剔掉 8 张容器底图（约 2325 KB）。
看到 `[build-guard] ✅ 环境自检通过：无私网地址，命中 hbhnd.cloud` 才算过。
`npm run build:h5` 末尾的 `MODULE_TYPELESS_PACKAGE_JSON` 是既有噪音，不是错误。

## 7. 踩坑清单（都是真踩过的）

1. **PowerShell 调 bash** 必须 `& "C:\Program Files\Git\bin\bash.exe" xxx.sh`，不带 `&` 会 `UnexpectedToken`。
2. **`git push` 成功也报 exit 1**：git 把进度写 stderr，PS 5.1 当致命错误。判成功看有没有 `old..new  branch -> branch`。
3. **`$ErrorActionPreference` 别设 Stop**：PS 5.1 会把原生命令的 stderr 警告（vitest 的 `[Vue warn]`）抛成 `NativeCommandError`。脚本里用 `Continue` + 每步查 `$LASTEXITCODE`。
4. **台账/JSON 用 node 写**：PowerShell 回显/重写含反斜杠的文本会把 `\r`、`\s` 吃掉（历史台账里已经出现过 `.scriptsdb-apply.ps1` 这种被吃坏的路径）。
5. **给程序读的 JSON 必须无 BOM**，写完打印前三字节 hex 核对。
6. **`publish_desktop.sh` 是 GBK 编码**：用支持 GBK 的编辑器/工具读，别按 UTF-8 判断乱码就"修"它。
7. **换桌面图标后要刷图标缓存**：覆盖桌面/任务栏的 `.lnk` + `ie4uinit.exe -show`，必要时重启 explorer。
8. **dev server 端口不固定**：`npm run dev:h5` 可能自己挑到 9092 之类的端口，以日志里 `Local:` 那行为准。
9. **`uni.disablePullDownRefresh` 在 App 端是空实现**（那是小程序 API），要关原生下拉刷新得走 `page.$getAppWebview().setStyle({pullToRefresh:{support:false}})`。
10. **`git add -A` 前清掉一次性脚本**（`.cjs` / `.ps1` 调试文件落在仓里会被一起提交）。

## 8. 一句话收尾模板

> 改了什么 → 为什么（根因）→ 版本号 → 构建结果 → 台账 变更-N / 两个仓的 sha → 用户要做的两步（后端脚本 / 云打包）。
