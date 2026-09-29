# hnd_factory_UI

工厂工单 / 出入库管理前端。单页应用，全部页面在一个入口里按 Tab 切换。

## 技术栈

| 项 | 选型 |
|---|---|
| 框架 | Vue 3（`<script setup>`，无 TypeScript） |
| 构建 | Vite 6（开发端口 **9091**） |
| UI | Element Plus + Tailwind CSS |
| 请求 | axios（统一封装在 `src/api/request.js`） |
| 状态 | 无 Pinia/Vuex —— 用模块级 `composables` 当轻量单例 store |
| 测试 | Vitest + @vue/test-utils（jsdom） |
| 规范 | ESLint 9（扁平配置）+ Prettier |

## 运行

```bash
npm install
npm run dev          # http://localhost:9091
```

前端依赖以下后端服务（本地开发经 Vite 代理，见 `vite.config.js`）：

| 路径 | 目标 | 说明 |
|---|---|---|
| `/api/ocr` | `localhost:8085` | myocr 识别服务。**代理顺序必须在 `/api` 之前**，否则会被 8084 吃掉而 404 |
| `/api` | `localhost:8084` | hnd_factory 业务后端（不做路径重写） |
| `/files` | `localhost:8082` | img-service 原图，重写为 `/api/img/file/*` |
| `/thumbs` | `localhost:8082` | img-service 缩略图，重写为 `/api/img/thumb/*` |

三个服务都起着，列表页的图片列才不会全空。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建到 `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm run lint` | ESLint（`--max-warnings=0`，有告警即失败） |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run format` | Prettier 格式化 `src/` 与 `tests/` |
| `npm run format:check` | 只检查不写入 |
| `npm run test` | 跑全部测试（单测 + 组件冒烟） |
| `npm run test:watch` | 监听模式 |
| `npm run verify` | **提交前跑这个**：lint + test + build |

> ESLint 只开「正确性」规则，格式交给 Prettier —— 两个工具职责分开，避免互相打架。
> 格式类规则不强行铺到历史代码上，改动哪个文件就顺手格式化哪个文件。

## 目录结构

```
src/
├── api/            axios 实例与鉴权（satoken 头、401 全局登出、hasPerm）
├── components/     通用组件（加载遮罩、面板态、筛选表头、图片弹窗、汇总表…）
├── composables/    数据层：既当 store 也当业务逻辑
├── constants/      工单类型等常量
├── utils/          纯函数（格式化、图片归一化、Excel 剥图）
├── views/          页面（WorkOrderList 承载 11 个 Tab，另有登录/导入/图片解析）
├── router/         路由（只有一个业务路由 `/`）
└── main.js         入口（Element Plus 全量注册）
tests/
├── unit/           纯函数与 composable 单测
└── component/      整页冒烟测试
```

## 关键约定（改动前先看）

1. **业务失败也是 HTTP 200**：列表/写入接口失败时返回 `{ success: false, msg }`。
   所有读取处必须自己判断 `success`，不能只看状态码。
   myocr 例外：它用 `code !== 200` 表示失败。
2. **401 会全局清凭据并跳登录**；403 不会（只是权限不足，界面按权限隐藏入口即可）。
3. **`hasPerm()` 只做界面显隐，不是安全边界**。后端必须自己鉴权。
   新增写入入口时，前端按钮要用 `hasPerm(...)` 包住，否则会出现「按钮在、一按就报错」。
4. **composables 是模块级单例**：组件直接 `useXxxData()` 就能拿到同一份状态，
   不需要层层传 props。新拆出来的面板组件请沿用这个方式，不要改成 props 透传。
5. **图片地址是相对路径**（`/files/...`、`/thumbs/...`），字段名各接口不完全统一，
   统一用 `src/utils/image.js` 的 `normalizeImageList()` 归一化，不要自己拼字段。
6. **未登录默认只读浏览**（决策-002）：读接口本就免登录，写入类 Tab 与按钮按权限隐藏。

## 工程现状与后续计划

`WorkOrderList.vue` 是承载 11 个 Tab 的大页面，已做过一轮拆分（**3046 → 2133 行，-30%**）：

已完成
- 图片弹窗 → `useOrderImages`（状态/请求）+ `<OrderImageDialog>`（渲染），工单汇总与周统计共用一份
- 周统计 Tab 内不可达代码（重复的图片弹窗、产成品筛选、工单列表）已删除
- 工单报工 / 工单核算 / 原辅料核算 → `<StatsTable>` + `useStatsData.js`（纯函数，有单测）
- vite 手动拆包；`npm run verify` 一条命令做完整校验

待继续（按收益从高到低）
1. **压力容器体积计算面板**（现约 900 行：脚本 ~530 + 模板 ~218 + 样式 152）
   拆成 `VesselPanel.vue` 时可整体搬走，注意三处联动要一起搬：
   `onMounted` 里的首屏加载、`onUnmounted` 的 `stopVesselLoop/stopStepHold`、
   `watch(activeTab)` 里「切到 vessel 才加载底图 + 启动波纹动画」的分支
   （同一个 watch 还兼管「离开导入页刷新数据」，需要拆成两段）。
   这是纯画布代码，没有自动化测试兜底，改动后要人工过一遍罐型切换与液位动画。
2. **领料汇总 / 入库汇总面板**（模板各约 160 行）：两块结构高度相似，
   可抽 `SummaryListPanel.vue`；数据直接从 `usePickData()` / `useInboundData()` 取。
3. 日报表记录、电费预提两个 Tab 目前是 `PanelState` 占位，功能未实现（见 `前后端改动统筹.md`）。

## 测试说明

- `tests/setup.js` 补了 jsdom 缺的能力：canvas 2D 上下文用「什么方法都能调」的代理兜底，
  以及 `ResizeObserver` / `matchMedia`。
- `tests/component/WorkOrderList.spec.js` 是**整页冒烟**：挂载 11 个 Tab 的页面并断言
  子组件与列配置接线正确。拆组件后最容易犯的错（模板引用了已删除的东西、构建能过但页面白屏）
  由它兜住，改大页面后请先跑它。

## 相关文档

跨服务接口契约、权限决策与变更记录统一维护在 `前后端改动统筹.md`。
本 README 只讲前端自身怎么跑、怎么改、还有哪些坑。
