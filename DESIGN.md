# DESIGN.md — hnd_factory_UI 的 linear 深色令牌（分支 `x-ai`）

> 令牌来源：`design-md` 技能库的 **`linear.app/DESIGN.md`**（VoltAgent/awesome-design-md，MIT）。
> 选它的理由（该文件自述）：**"dense, technical, and quietly luxurious"** —— 为密集产品界面而生的深色系统，正好服务本项目的 15 Tab 宽表后台。
> 历史：本分支先试过 `x.ai`，但其"近黑 + 大留白 + 极少量文字"的营销页语言用在宽表后台偏"平、闷"，已换掉（详见提交记录）。
>
> 只做**令牌/外观层**改造，不动组件结构与业务逻辑；`main` 不受影响。
> **回退**：删掉 `src/main.js` 里的 `import './linear-theme.css'` 一行；或 `git checkout main`。

## 1. linear 的设计语言（取自其 DESIGN.md 原文）

- **画布 `#010102`** —— 该文件称它是"本合集中所有工具里最深的深色面"；**无渐变、无光斑**。
- **炭灰面板 + hairline 分层**：`surface-1 #0f1011`、`surface-2 #141516`、`surface-3 #18191a`；描边 `hairline #23252a` / `hairline-strong #34343a`。**卡片靠描边而不是阴影**。
- **唯一彩色强调**：薰衣草蓝 `primary #5e6ad2`（hover `#828fff`、focus `#5e69d1`），**只出现在品牌标记、焦点环和少量 CTA 上，从不做装饰**。
- **文字四档**：`ink #f7f8f8`、`ink-muted #d0d6e0`、`ink-subtle #8a8f98`、`ink-tertiary #62666d`。
- **排版**：Linear Display（缺失 → SF Pro/Inter 回退），标题 500–700、克制的负字距。
- 另有语义色 `semantic-success #27a644`（本主题未覆盖，保留项目原有红/绿/琥珀语义色）。

## 2. 角色映射（`tailwind.config.js` 里 `...{...}` 覆盖块，放在最后生效）

| 我方角色 | 043 原值（浅色玻璃） | linear 值 | linear 语义 |
|---|---|---|---|
| `desk` / `canvas` | #DEDFE5 / #E9E9EE | **#010102** | canvas（最深深色面） |
| `veil`（侧栏） | #CED0D4 | **#23252a** | hairline（侧栏纱） |
| `raised`（卡面） | #FFFFFF | **#141516** | surface-2 |
| `region`（表头/垫底） | #EEEEF1 | **#18191a** | surface-3 |
| `brand`（主色/CTA） | #1D1D1F | **#5e6ad2** | primary（薰衣草蓝） |
| `brand-deep`（正文） | #171719 | **#f7f8f8** | ink |
| `brand-50/100/200` | 浅灰三档 | **#3e3e44 / #8a8f98 / #828fff** | hairline-tertiary / ink-subtle / primary-hover |
| `card` 圆角 | 20px | **8px** | 密集界面用小圆角 |
| 新增 | — | `ln-hairline` `ln-primary` `ln-primary-focus` | — |

## 3. 新增文件 `src/linear-theme.css`（在 `style.css` 之后引入）

原先我往 `style.css` 里塞过几块 `!important` 快刀覆盖（已用 `git checkout` 还原干净）。现在全部集中在这一个文件里：

1. 画布 → `#010102`（无渐变）；正文 → `#d0d6e0`；
2. **关掉**浅色玻璃遗留的 `backdrop-filter` 与所有 `box-shadow`（近黑底上只会浑浊）；
3. 表面阶梯 `#010102 → #0f1011 → #141516 → #18191a` + hairline 描边；
4. 文字四档；5. 表格表头 `#18191a` + 12px 中灰小字（**不做大写/加字距**——中文会歪）；
6. 主按钮 = 薰衣草蓝 CTA；次级按钮透明 + `#34343a` 描边；焦点环 `#5e6ad2`；
7. 弹窗/输入框/标签/滚动条统一深色；8. 标题负字距；9. 滚动条重绘。

## 4. 未做（有意留给后续提交）

1. **图表配色**：周统计 / V150 产量图换 `#5e6ad2` + `#828fff` + 灰阶（语义红绿保留）；
2. **首屏三页**（Login / Intro / NotFound）整页构图；
3. `tailwind.config.js` 覆盖块里的**行内注释仍是旧文案**（写着"= linear canvas-card"这类不准确的语义名，实际对应 surface-1/2/3），下次清理；
4. 视觉复核后把 `[class*=...]` 选择器逐步收敛成语义化 token。

## 5. 验证

- `npm run build` ✅ 通过；产物 CSS 中确认含 `#5e6ad2` 与 `#010102`；
- ⚠️ `npm run verify`：334 条里 **1 条失败**（设计令牌基线断言，需一并更新，未提交）；
- 视觉验证：`npm run dev` → http://127.0.0.1:9091/ ，重点看**工单列表宽表**与**图片解析**页；
- 对比基准：`main` 分支（浅色清水玻璃 043）。
