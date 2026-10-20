import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import request from './api/request'
import { getToken, saveAuth } from './api/auth'

/*
 * 样式导入顺序是有意的，别调换：
 *   EP 按需组件样式  先 —— EP 组件库自带样式（原来是 dist/index.css 全量，见文末变更-076）
 *   ./theme.css                  后 —— 覆盖 --el-color-primary 与圆角变量；
 *                                     两者同优先级（都是 :root），谁后加载谁赢
 *   ./style.css                  最后 —— Tailwind 与全局基础样式
 *   ./minimal-field.css          再最后 —— 「纸」的暖径向与面板材质的说明层
 *
 * 原先 EP 的样式是在 WorkOrderList.vue / WorkOrderImport.vue 里各自 import 的，
 * 覆盖规则排在其后就只能靠「哪个组件先加载」来保证，太脆。
 * 顺带修掉一个潜在缺陷：ImageParse.vue 用着 el-dialog / el-image 却从没 import 过
 * EP 样式，之前只是沾了「WorkOrderList 一定先加载」的光；放到这里之后，
 * 任何按路由单独加载的页面都不会裸奔。
 *
 * 历史（这条链换过三代，读起来才不奇怪）：
 *   glass-effects.css（036~043 的液态玻璃折射层）与 linear-theme.css（x-ai 的
 *   深色令牌覆盖）都在 x-minimalist 上**整份退场** —— 前者的活（渐变、光斑、
 *   颗粒、跟滚动的高光、真折射样张）是 minimalist 点名不要的装饰；后者是另一条
 *   分支的配色方向（近黑 + 薰衣草蓝），与本分支相反。两份都还在 git 里可回退：
 *   linear 那套 = x-ai 分支 09977cb。
 *
 * 变更-076（2026-10-16 性能审查）：原来是 `element-plus/dist/index.css` 全量
 * （产物 352.2KB 且 render-blocking），而全仓只用到下面这些组件 —— 全量那份里
 * `.el-col-*` 750 条、`.el-tabs__*` 252 条、`.el-upload` 160 条、`.el-cascader` 100 条
 * 等规则**没有任何元素会匹配**。改为按需后只留用到的部分。
 * ⚠️ 新增 EP 组件时**必须**在这里补上对应的 el-xxx.css。这条从 080 起不再只靠肉眼：
 *   tests/unit/elementPlusStyles.spec.js 会拿本文件的导入清单与 dist/index.css 的类名
 *   做差集、再按「源码里实际用到的组件」筛一遍 —— 漏了就红，并直接告诉你缺哪个类名。
 *   新增组件时在那份 spec 的 REQUIRED 表里登记即可（未登记的组件会让它失败，提醒你补）。
 */
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/el-var.css'
import 'element-plus/theme-chalk/el-icon.css'
import 'element-plus/theme-chalk/el-button.css'
import 'element-plus/theme-chalk/el-input.css'
import 'element-plus/theme-chalk/el-select.css'
import 'element-plus/theme-chalk/el-option.css'
import 'element-plus/theme-chalk/el-date-picker.css'
// ⚠️ 日期选择器是**两个文件**（变更-080 补）：el-date-picker.css 只管输入框那截，
// 弹出来的日历面板全在下面这份里 —— .el-picker-panel / .el-date-table /
// .el-date-table-cell / .el-month-table / .el-year-table / .el-date-editor / .el-time-panel。
//
// 076 漏了它，2026-10-16 被用户在生产截图里抓出来：日历格子挤成一团、
// 「《 2026 年 9 月 》」这种排版错位。**输入框看起来完全正常** —— 所以当时只截
// 「没打开弹层」的页面（还对比过像素完全相同）根本发现不了。教训：按需引入的
// 验证必须**逐个打开弹层**，或干脆交给下面的自动护栏。
import 'element-plus/theme-chalk/el-date-picker-panel.css'
import 'element-plus/theme-chalk/el-popper.css'
import 'element-plus/theme-chalk/el-tooltip.css'
import 'element-plus/theme-chalk/el-overlay.css'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/el-loading.css'
import 'element-plus/theme-chalk/el-pagination.css'
import 'element-plus/theme-chalk/el-image.css'
// el-image 点开预览大图用的是**独立组件**（ImageParse.vue:1224 用了
// :preview-src-list + :preview-teleported），它的样式不在 el-image.css 里 —— 漏了会
// 出现「遮罩层没样式、大图直接叠在页面上」。这条正是上面注释里警告的那类漏项。
import 'element-plus/theme-chalk/el-image-viewer.css'
import 'element-plus/theme-chalk/el-checkbox.css'
import 'element-plus/theme-chalk/el-autocomplete.css'
import 'element-plus/theme-chalk/el-slider.css'
// 变更-117：采购需求的右抽屉 + 列配置 popover
import 'element-plus/theme-chalk/el-drawer.css'
import 'element-plus/theme-chalk/el-popover.css'
import 'element-plus/theme-chalk/el-scrollbar.css'
import './theme.css'
import './style.css'
import './table.css'
import './minimal-field.css'

// 日历滚轮翻页（变更-039）：一条 document 级监听，与登录态 / 数据都无关，顶层装一次即可。
// 放这里而不是某个组件里 —— 日期面板是 teleport 到 body 的，组件级钩子够不着它
//（面板与按键映射的来龙去脉见 utils/datePickerWheel.js 的头部注释）。
import { installDatePickerWheel } from './utils/datePickerWheel'
installDatePickerWheel()

// 日历翻页滑动动效（变更-040）：同样一条 document 级 capture click 监听 —— 滚轮翻页
// 走的程序化 .click() 会路过这里，一处覆盖「滚轮 + 手点箭头 + 键盘 Enter」三条路径
//（防闪三件套与连翻状态机见 utils/datePickerFlip.js 的头部注释）。
import { installDatePickerFlip } from './utils/datePickerFlip'
installDatePickerFlip()

// 刷新页面后恢复角色与权限：token 在 localStorage，角色信息需重新拉取
async function restoreAuth() {
  // 变更-129d：昵称（realName）是后加的，老会话里只有 roleKey —— 缺昵称也要补拉一次，
  // 否则刷页面后侧栏账号块只能显示角色名
  if (!getToken()) return
  if (localStorage.getItem('roleKey') && localStorage.getItem('realName')) return

  try {
    const res = await request.get('/api/user/info')
    saveAuth(res.data || {})
  } catch {
    // token 失效时由 request 响应拦截器统一清理并跳转登录页
  }
}

// 先挂载，再在后台补拉角色（2026-10-16 性能审查，变更-075）。
//
// 原写法是 Promise.race([restoreAuth(), 3 秒兜底]).finally(() => mount())：
// 而 LCP 元素就在 #app 里 —— 于是「接口慢 800ms，首屏就晚 800ms」，最坏情况白屏 3 秒。
// 冷缓存 trace 实测 LCP 1032ms 中 1023ms 是纯渲染延迟，mount 正是被这个 Promise 串在最后。
//
// 为什么不需要「先拿到角色再挂载」：
//   ① authState 是 reactive 镜像（api/auth.js:24-31），台账类 Tab 与按钮都从它读，
//      后台请求回来写入 saveAuth() 后界面自会跟着变；
//   ② 路由守卫只判断 token（router/index.js:50），而 token 在模块加载时就已从
//      localStorage 同步读入，与这次请求无关 —— 所以不存在「挂早了被弹到登录页」。
// 顺序即语义：mount 在前、restoreAuth 在后，别调换。
createApp(App).use(router).mount('#app')

restoreAuth()
