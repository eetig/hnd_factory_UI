# AGENTS.md — 前端仓库（hnd_factory_UI）

> 项目级约定（同步规矩、记账、部署顺序、协作偏好）写在**后端仓库**的 `AGENTS.md`：
> `../hnd_factory/AGENTS.md`，或用浏览器看
> <https://github.com/eetig/hnd_factory/blob/main/AGENTS.md>。**先读它**。

## 这个仓库特有的

- **工作分支是 `x-minimalist`**，不是 `main`。`main` 停在很老的一次提交上；**不要**在 `main` 上改，
  也不要把 `main` 合进来。家里那台也请 `git switch x-minimalist` 后再开工。
- **开工先 `git pull --ff-only`，收工必须 `git push`** —— 这个仓库会在公司/家里两台电脑上同时改。
- **待办清单不在本仓库**：在 `../hnd_factory/docs/待办清单.md`（唯一真源，只追加不重排）。
- **变更账在本仓库**：`前后端改动统筹.md`，每次改动加一行 `变更-NNN`（写为什么 + 怎么验证）。
- **门禁**：`npm run verify` = lint + build + vitest（当前 33 文件 / 499 用例），**不绿不许部署**。
- **包管理器只有 npm**（2026-10-22 定）：
  - 锁文件**只有** `package-lock.json`。**不许**生成/提交 `pnpm-lock.yaml`、`yarn.lock`。
  - 装依赖用 `npm ci`（严格按锁文件装），不要用 `npm install`——它会把锁文件往上漂。
  - 背景：`pnpm-lock.yaml` 曾因 `git add -A` 被误提交（在「切页淡入」那次纯 CSS 改动里扫进去 3283 行），
    结果**两台机器装出不同的依赖树**：同一份源码，公司那台构建出的 `vendor`/`element-plus` chunk 哈希
    和家里那台不一样。症状是"线上和本地包都一样长、但文件名不同"，排查时极费时间。
  - 若某台机器已经用 pnpm 装过：`rm -rf node_modules && npm ci` 重装一次，再构建。
- **视觉护栏** `tests/unit/visualTokens.spec.js`：禁用 `text-slate-400`；卡片串必须完整
  `rounded-card border border-line bg-raised shadow-card`（**数量写死 19**，新增卡片要 +1）；
  `table-fixed` 下只许一列自适应；整行可点必须能键盘激活。
- **导航唯一真源**：`src/nav/index.js`（`NAV_ITEMS` / `perm`）；页面是薄壳 + 面板组件。