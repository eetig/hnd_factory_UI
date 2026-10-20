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
- **视觉护栏** `tests/unit/visualTokens.spec.js`：禁用 `text-slate-400`；卡片串必须完整
  `rounded-card border border-line bg-raised shadow-card`（**数量写死 19**，新增卡片要 +1）；
  `table-fixed` 下只许一列自适应；整行可点必须能键盘激活。
- **导航唯一真源**：`src/nav/index.js`（`NAV_ITEMS` / `perm`）；页面是薄壳 + 面板组件。