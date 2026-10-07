/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /**
       * 视觉三约束（使用方 2026-10-07 定）：浅色底 / 大圆角 / 单一高亮色。
       *
       * 这里只放「圆角」与「卡片投影」两个 token，高亮色**不放** ——
       * 它就是 Tailwind 内置的 sky-600（#0284c7），手写 markup 一直在用；
       * 另起一个别名只是把同一个值写两遍，没有视觉收益。Element Plus 那边
       * 靠 src/theme.css 覆盖 --el-color-primary 跟随，见那里的注释。
       */
      borderRadius: {
        // 卡片 / 面板。控件用内置的 rounded-xl（12px），小标签继续 rounded-full
        card: '20px',
      },
      boxShadow: {
        // 唯一的卡片投影。大圆角配 shadow-sm 会显得塌，两者要成套用
        card: '0 8px 28px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
}
