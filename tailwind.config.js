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
    extend: {},
  },

  plugins: [],
}
