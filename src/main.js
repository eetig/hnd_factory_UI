import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import request from './api/request'
import { getToken, saveAuth } from './api/auth'

/*
 * 样式导入顺序是有意的，别调换：
 *   element-plus/dist/index.css  先 —— EP 组件库自带样式
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
 */
import 'element-plus/dist/index.css'
import './theme.css'
import './style.css'
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
  if (!getToken() || localStorage.getItem('roleKey')) return

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
