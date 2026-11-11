# 桌面版（Windows）怎么装、怎么发

这份只管一件事：**让别人也能像你一样双击图标开 HND 生产助手**。
网页版照旧，桌面版是同一个前端仓多出的一份产物，改网页不会动它，改它也不会动网页。

---

## 一、给车间装（一次性）

1. 把 `HND生产助手_1.0.0_x64-setup.exe` 拷过去（U 盘、内网共享、企业微信都行）。
2. 双击安装。**不需要管理员权限**，默认装到当前用户目录（`%LOCALAPPDATA%\HND生产助手`）。
3 . 第一次打开如果被 SmartScreen / 360 拦：选「仍要运行」，或在 360 的信任区里把这个 exe 加白。
   软件本身没签名 —— 内部系统，签名证书一年几千块，不值当；内网分发时告诉对方"点更多信息→仍要运行"即可。
4. 桌面版第一次启动会问要不要开机自启：勾上，以后开机自己就起来了。

升级不用人管：每次启动会去 `https://hbhnd.cloud/desktop/latest.json` 看一眼，有新版本会弹窗问。
点了「立即更新」会自动下载、装好、重启。

---

## 二、发一个新版本（你自己操作）

```bash
cd D:/project/hnd_factory_UI

# 私钥密码只有你知道，别写进仓库、别贴群里
export PATH="$HOME/.cargo/bin:$PATH"
export TAURI_SIGNING_PRIVATE_KEY="D:/keys/hnd-desktop.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<你生成时设的密码>"

npm run publish:desktop -- --version 1.0.1
```

这一条命令会：改两个版本号 → 构建（首次 10 分钟，之后 1.5 分钟）→ 生成 `latest.json` → 传到 MinIO 的 `hnd-desktop` 桶。

**只构建不上传**（想先自己装一遍看看）：

```bash
node scripts/publish-desktop.mjs --version 1.0.1 --no-upload
```

产物位置：

```
src-tauri/target/release/bundle/nsis/
  HND生产助手_1.0.1_x64-setup.exe      ← 给人装的
  HND生产助手_1.0.1_x64-setup.exe.sig  ← 更新校验用，别删
  latest.json                          ← 客户端读的"有新版本"清单
```

---

## 三、两个不能丢的东西

| 东西 | 位置 | 丢了会怎样 |
| --- | --- | --- |
| 更新私钥 | `D:/keys/hnd-desktop.key` | **再也发不出更新**，所有人只能重装新包（而且装上后也永远收不到下一次更新） |
| 私钥密码 | 只有你知道 | 同上 |

建议：把 `hnd-desktop.key` 复制一份到你自己的网盘/U 盘。它就是一个文本文件，不加密也无法重新生成。

---

## 四、MinIO 那边要准备什么（一次性）

1. 1Panel 里建桶 `hnd-desktop`，**设为公开读**（客户端要能匿名下载 exe 和 latest.json）。
2. 反代一条路径：`https://hbhnd.cloud/desktop/` → `http://127.0.0.1:9000/hnd-desktop/`。
3. 本机装个 `mc`（MinIO 客户端），配好别名：

```bash
mc alias set hnd https://hbhnd.cloud <ACCESS_KEY> <SECRET_KEY>
mc anonymous set download hnd/hnd-desktop
```

> `latest.json` 必须以 `content-type: application/json` 返回，脚本已经用 `--attr` 处理了；
> 手工传的话记得加，否则客户端会把 JSON 当附件，表现是"永远显示已是最新"。

---

## 五、关闭与托盘

点右上角 ✕ 不会直接退出，而是先问一句：

- **最小化到托盘** —— 窗口藏起来，任务栏右下角留一个图标；点图标（或右键菜单「打开主界面」）回到窗口，右键「退出」才真的结束进程。
- **退出程序** —— 直接结束，托盘图标一起消失。

为什么要问：车间电脑上这个程序是"挂机"用的，误点 ✕ 就退出的话，下一次想用又得去桌面找图标。藏起来更省事。

实现分工：Rust 侧（`src-tauri/src/lib.rs`）拦下 `CloseRequested` 并发 `app://close-requested` 事件，只负责"别关"；弹框与选择在 `src/desktop/closeBehavior.js`，改文案不用重编 Rust。

---

## 六、排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 打开是白屏 | 打包时 `dist` 不是 desktop 模式（`base` 没变 `./`） | 重新 `npm run build:desktop` 再 `tauri build` |
| 登录一直失败 / 控制台跨域 | **1.0.2 起不该再出现**：桌面版请求改由 Rust 发（`src/api/desktopHttp.js`），不经过浏览器的同源策略。若仍报错，先看错误文案里那个地址对不对 | 地址不对 → 查 `src/api/base.js`；地址对 → 查 `capabilities/default.json` 的 http 白名单有没有含这个域名 |
| 点检查更新没反应 | `latest.json` 拿不到或格式不对 | 浏览器直接打开 `https://hbhnd.cloud/desktop/latest.json` 看能不能看到 JSON |
| 提示"签名不匹配" | `latest.json` 里的 signature 和安装包不是同一次构建 | 重跑发布脚本，别手工拼 |
| 送货单图片裂开 | 桌面版页面地址是 `tauri.localhost`，`/files/...` 相对路径指到了本地 | 用 `src/api/base.js` 的 `assetUrl()` 包一层（**尚未接入**，见待办） |

---

## 七、还没做的

- **代码签名证书**：现在没签名，首次运行必然被 SmartScreen 拦一次。
- **图片地址**：`assetUrl()` 写好了但没接到采购送货单、识图上传这些地方。
- **断网写入**：断网时界面能开、能看上次读到的数据，但**提交会失败**（没有离线队列）。
- **车间实机验证**：只在本机起过窗口，没在真正的车间电脑上走过一遍。
