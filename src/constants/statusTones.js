// 语义状态色的唯一来源。
//
// 立这个模块是因为同一组「浅底 + 深字」在五处各写了一遍，写法还各不相同：
// rose-500 压 rose-50 是 3.33、rose-500 压 rose-100 是 3.06、emerald-600 压 white
// 是 3.77、sky-600 压 sky-50 是 3.84 —— 一个都没过 AA。按「底色定档」收敛成三张表。
//
// ⚠️ 类名必须是完整字面量。Tailwind 是静态扫描源码收集类名的，`bg-${tone}-50`
//    这类拼接不会被生成（与 StatsTable.vue 里同一条注意事项）。本文件在
//    tailwind.config.js 的 content 范围内（src/**/*.js），字面量能正常产出。
//
// 比值按 WCAG 2.x 相对亮度公式实算，不是估的。阈值：正文 4.5:1；
// 大字号（≥24px，或 ≥18.66px 粗体）与纯图形 3:1。
// 改这里的任何一个值之前先把比值重算一遍 —— 本轮的返工就出在「-600 档三色都过」
// 这个想当然的假设上（实际只有 rose-600 过）。

/** 浅底横幅 / 胶囊：-700 压 -50 底 */
export const STATUS_TONE = {
  error: 'bg-rose-50 text-rose-700', // 5.72
  success: 'bg-emerald-50 text-emerald-700', // 5.21
  warning: 'bg-amber-50 text-amber-800', // 6.84
  info: 'bg-sky-50 text-sky-700', // 5.57
  neutral: 'bg-slate-100 text-slate-600', // 6.92
}

/** 圆形图标底（装的是 ! ✓ 这类符号，按文字算）：-700 压 -100 */
export const STATUS_ICON_TONE = {
  error: 'bg-rose-100 text-rose-700', // 5.24
  success: 'bg-emerald-100 text-emerald-700', // 4.84
  warning: 'bg-amber-100 text-amber-800', // 6.37
  info: 'bg-sky-100 text-sky-700', // 5.17
}

// 白底（或 slate-50 底）内联文字：取各色相**过 AA 的最低一档**，而不是统一取 -600。
// rose-600 白底 4.70 过；emerald-600 只有 3.77、sky-600 只有 4.10，都不过。
// 所以 success 是 -700：别照 rose 的样子「对齐」回 -600。
export const STATUS_TEXT = {
  error: 'text-rose-600', // 白底 4.70
  success: 'text-emerald-700', // 白底 5.48
  warning: 'text-amber-700', // 白底 5.02
}

// 形状不归这里管：面板级状态圆是 h-12 w-12 rounded-full，横幅级是 h-8 w-8
// rounded-full，内联胶囊又是另一套。色调与形状分开，换形状时不必动本文件。
