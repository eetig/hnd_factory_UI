/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{vue,js,ts,jsx,tsx}'],

  // preflight 关掉。
  // 它注入的 `*` 通配符重置与 `:root` 自定义属性在小程序 WXSS 里不被支持，
  // 且 uni-app 自身已有基础样式，两者叠加还会互相打架。
  corePlugins: {
    preflight: false,
  },

  theme: {
    extend: {
      // ===== 双主题调色板（与 src/App.vue 的 CSS 变量逐字对应）=====
      // 为什么在这里整体换调色板：模板里已经有上千个 bg-white / text-slate-900 /
      // border-slate-200，逐个改既费时又容易漏。
      //
      // 改造前这里写的是深色**字面量**，那份样式在构建期就定死了，运行时切不了主题。
      // 现在改成指向 CSS 变量：变量按主题定义在 src/App.vue
      //   page { --ui-slate-200: #2a2a33; … }        深色（默认）
      //   .theme-light { --ui-slate-200: #e3e6ee; … } 浅色
      // 于是「切主题」只是换根节点上的一个类名，工具类不用重编。
      //
      // 语义靠"层次"保持：slate-50 依旧是最贴近背景的一层，slate-900 依旧是最亮的
      // 前景（正文色），white 即"卡片表面"。两种主题下同一套类名都成立。
      //
      // ⚠️ 因为是变量而不是颜色字面量，**不要再写带透明度的类**（bg-slate-50/50）：
      //    Tailwind 无法对 var() 求 alpha，那条声明会被直接丢掉（静默失效）。
      //    要半透明请用 SCSS 侧的 $ui-raise / -2 / -3、$ui-hairline 或 $ui-*-soft。
      colors: {
        // white 代表"卡片/表面"（浅色下才是真白）
        white: 'var(--ui-white)',
        slate: {
          50: 'var(--ui-slate-50)',
          100: 'var(--ui-slate-100)',
          200: 'var(--ui-slate-200)',
          300: 'var(--ui-slate-300)',
          400: 'var(--ui-slate-400)',
          500: 'var(--ui-slate-500)',
          600: 'var(--ui-slate-600)',
          700: 'var(--ui-slate-700)',
          800: 'var(--ui-slate-800)',
          900: 'var(--ui-slate-900)',
        },
        sky: {
          50: 'var(--ui-sky-50)',
          100: 'var(--ui-sky-100)',
          400: 'var(--ui-sky-400)',
          500: 'var(--ui-sky-500)',
          600: 'var(--ui-sky-600)',
          700: 'var(--ui-sky-700)',
        },
        rose: {
          50: 'var(--ui-rose-50)',
          100: 'var(--ui-rose-100)',
          200: 'var(--ui-rose-200)',
          500: 'var(--ui-rose-500)',
          600: 'var(--ui-rose-600)',
          700: 'var(--ui-rose-700)',
        },
        emerald: {
          50: 'var(--ui-emerald-50)',
          100: 'var(--ui-emerald-100)',
          600: 'var(--ui-emerald-600)',
          700: 'var(--ui-emerald-700)',
        },
        amber: {
          50: 'var(--ui-amber-50)',
          100: 'var(--ui-amber-100)',
          200: 'var(--ui-amber-200)',
          600: 'var(--ui-amber-600)',
          700: 'var(--ui-amber-700)',
          800: 'var(--ui-amber-800)',
        },
        cyan: {
          100: 'var(--ui-cyan-100)',
        },
      },

      // 豆包式"大圆角"：比 Tailwind 默认更饱满，卡片/输入框/弹层统一变圆
      borderRadius: {
        lg: '14px',
        xl: '20px',
        '2xl': '26px',
        '3xl': '32px',
      },

      // 投影同样按主题给值：深色下必须更重才看得出层次，
      // 浅色下原来那套 90% 透明黑会糊成一团脏。
      boxShadow: {
        sm: 'var(--ui-shadow-sm)',
        DEFAULT: 'var(--ui-shadow)',
        md: 'var(--ui-shadow-md)',
        lg: 'var(--ui-shadow-lg)',
      },
    },
  },

  plugins: [],
}
