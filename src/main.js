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
 *   ./glass-effects.css          再最后 —— 液态玻璃的折射层（顶部柔光、颗粒、
 *                                     底场、跟滚动走的高光）
 *
 * 原先 EP 的样式是在 WorkOrderList.vue / WorkOrderImport.vue 里各自 import 的，
 * 覆盖规则排在其后就只能靠「哪个组件先加载」来保证，太脆。
 * 顺带修掉一个潜在缺陷：ImageParse.vue 用着 el-dialog / el-image 却从没 import 过
 * EP 样式，之前只是沾了「WorkOrderList 一定先加载」的光；放到这里之后，
 * 任何按路由单独加载的页面都不会裸奔。
 *
 * glass-effects.css 排在 style.css 之后，是因为它要往 `.glass-refract` / `.glass-field`
 * 上写 `background-image` —— 与 Tailwind 的 `bg-white/55`、`bg-veil/55`（写的是
 * background-color）属性不重叠、按理不会打架，但**排序上让它赢**可以免掉一整类
 * 「谁覆盖谁」的排查；将来那些底色若改成写 background-image，这里仍是对的。
 */
import 'element-plus/dist/index.css'
import './theme.css'
import './style.css'
import './linear-theme.css'
import './glass-effects.css'

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

// 最多等待 3 秒，避免后端不可用时阻塞页面加载
Promise.race([
  restoreAuth(),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]).finally(() => {
  createApp(App).use(router).mount('#app')
})
