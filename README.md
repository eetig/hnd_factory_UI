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
├── components/     通用组件（加载遮罩、面板态、筛选表头、图片弹窗、汇总表、储罐液位面板…）
├── composables/    数据层：既当 store 也当业务逻辑
├── constants/      工单类型等常量
├── utils/          纯函数（格式化、图片归一化、Excel 剥图）
├── views/          页面（WorkOrderList 承载 12 个 Tab，另有登录/导入/图片解析）
├── router/         路由（只有一个业务路由 `/`）
└── main.js         入口（挂路由 + 恢复登录态）
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
7. **Element Plus 组件要按需显式 import**：`main.js` 里**没有** `app.use(ElementPlus)`。
   模板里写了 `<el-input>` 却没 `import { ElInput }` 时，Vue 不会白屏，而是把它当成
   原生标签渲染成**空元素** + 控制台 `Failed to resolve component` —— 页面看着还在、
   功能悄悄没了（搜索框不见了、复选框不见了），比白屏更难发现。
   两道防线都拦不住它：ESLint 只在「import 了没用」时报警（这是反过来的一种），
   组件测试又因为全局装了 `plugins: [ElementPlus]` 把它兜住。
   排查办法：逐个 `.vue` 比对「模板里出现的 `el-*` 标签」与「从 element-plus import 的名字」。

## 工程现状与后续计划

`WorkOrderList.vue` 是承载 12 个 Tab 的大页面，已做过一轮拆分（**3046 → 2133 行，-30%**）：

已完成
- 图片弹窗 → `useOrderImages`（状态/请求）+ `<OrderImageDialog>`（渲染），工单汇总与周统计共用一份
- 周统计 Tab 内不可达代码（重复的图片弹窗、产成品筛选、工单列表）已删除
- 工单报工 / 工单核算 / 原辅料核算 → `<StatsTable>` + `useStatsData.js`（纯函数，有单测）
- 月底储罐液位记录 Tab 接入接口（变更-004）：数据层 `useTankLevelData.js`，
  后端 hnd_factory 的 `/api/tank-level/*`，库表 `tank_level_record`（见后端 `docs/schema.sql`）
- vite 手动拆包；`npm run verify` 一条命令做完整校验

### 月底储罐液位记录（变更-004 只读 / 变更-008 行内编辑 / 变更-011 图据多张）

| 项 | 值 |
|---|---|
| 读接口 | `GET /api/tank-level/list`（记录日期区间 / 属地 / 所属 / 关键字，参数全可选）、`GET /api/tank-level/locations`（属地下拉，取库中实际值）、`GET /api/tank-level/image/list?recordId=`（某条记录的图据）。**均免登录** |
| 写接口 | `POST /api/tank-level/save`（`id` 空即新增）、`DELETE /api/tank-level/delete?id=`、`POST /api/tank-level/image/upload`（multipart：`recordId` + `files[]`，一次可多张）、`DELETE /api/tank-level/image/delete?imageId=`。**均需 `tank_level:edit` / `tank_level:delete`，当前只授给 admin** |
| 库表 | `tank_level_record`（唯一键 `记录日期 + 容器编号`）+ `tank_level_image`（图据子表，按 `record_id` 关联；原单列 `file_name` 已于变更-011 废弃）|
| 数据层 | `useTankLevelData.js`（列表查询 + 记录增删改）、`useTankLevelImages.js`（图据弹窗的状态与请求）|
| 组件 | `TankLevelPanel.vue`（面板，变更-008 从 WorkOrderList 拆出）、`TankLevelImageDialog.vue` + `ImageGalleryDialog.vue`（图据弹窗，与工单图片弹窗共用渲染）|

几个刻意的选择，改动前先看一眼：

- **默认查询区间是「本年度」而不是「本月」**：记录按月产生（每月月底下午 3 点抄录），默认本月的话一年里绝大多数时间打开都是空表。
- **首次进入该 Tab 才请求**（`ensureTankLevelLoaded`，由 `watch(activeTab)` 触发）：Tab 是 `v-show` 常驻的，不这样会每次切换都打接口。
- **加载失败不置 `loaded`**：离开再回来会重试，比停在一张「空表」上好 —— 空表会被当成「没有数据」。
- **图据可多张**（变更-011）：列表画首张缩略图 + 右下角数量角标，点开弹窗看大图、加图、删图。图据**不随表单提交**（表单里的旧值会覆盖刚传上去的图），走独立接口；上传要求该行已保存（有 `id`）—— 新增行须先保存再传图。
- **「图据」「操作」两列不跟着编辑态写两份**：图据在编辑态与只读态行为完全一致（都点开弹窗），行内编辑只管文字与数值，所以这两列放在两个状态分支之外。
- **编辑行 key 用 `id`，不是「日期 + 编号」**：行内编辑时这两个字段正被用户改，拿它们做 key 会让 Vue 每次按键都重建 `<tr>`，输入框当场失焦。
- **写成功后重新拉全量列表**（`fetchTankLevelRecords({ keepPage: true })`），不就地改内存那一行：列表是前端本地分页 + 后端按 (日期, 属地, 编号) 排序，就地改会让「序号」与分页位置和库里对不上。`keepPage` 是为了不把用户从正在看的那页弹走。
- **「新增一行」渲染成独立草稿行**（`editingId === 'new'`），**不混进 `tankLevelTableData`** —— 那是个参与本地分页切片的数据源，混进去会把序号搅乱。
- **后端业务失败的消息原样展示**（如「同一天已存在容器编号为 X 的记录」）：前端不重复实现一套校验规则，免得两处规则各自演化、口径不一致。
- 表尾的「记录说明」与线下台账一字不差，**改一处要同步改另一处**。
- **表头带单位**（2026-09-30 优化）：数值列写作 `容器液位 (mm)` / `理论质量 (kg)`。线下台账没标单位，标在表头上免得与「压力容器体积计算」里的 m³ 混读；单位口径若变，只改列标签一处，列宽已放到 `w-28`。
- **容器编号列**（2026-09-30，变更-004-1）：插在「容器名称」与「容器液位」之间。它是台账的业务键 —— 库表唯一键就是 `记录日期 + 容器编号`。接口没给编号时这一格留空，**不拿容器名称兜底**，免得页面上出现一个看似真实、实则编造的编号。
- **「理论质量」目前是手工录入**（变更-008 明确不做自动换算）：`tank_level_record.tank_code` 还是占位值，而 `equipment_ledger` 的 `equipment_code` 全是空串、`mass_per_mm`/`density` 全为 NULL，两张表一条也关联不上。等业务补齐位号与密度后另开变更。

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
- `tests/component/WorkOrderList.spec.js` 是**整页冒烟**：挂载 12 个 Tab 的页面并断言
  子组件与列配置接线正确。拆组件后最容易犯的错（模板引用了已删除的东西、构建能过但页面白屏）
  由它兜住，改大页面后请先跑它。
- ⚠️ Windows 上请用**盘符大小写一致**的工作目录执行（`D:\project\hnd_factory_UI`）。
  若先 `cd d:\project\hnd_factory_UI`（小写盘符）再跑 `npm run test`，Node 会把
  `file:///d:/…` 与 `file:///D:/…` 当成两个模块，spec 里 `import { describe } from 'vitest'`
  拿到的是第二份实例，全部用例在收集阶段就报
  `TypeError: Cannot read properties of undefined (reading 'config')`（`validateTags(runner.config, …)` 中 `runner` 未初始化）。

## 相关文档

跨服务接口契约、权限决策与变更记录统一维护在 `前后端改动统筹.md`。
本 README 只讲前端自身怎么跑、怎么改、还有哪些坑。
