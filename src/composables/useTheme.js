import { computed, onUnmounted, ref } from 'vue'
import { getItem, setItem } from '../api/storage'

// ===== 主题状态（深色 / 浅色）=====
//
// 「颜色」不在这里：两套色板都是 CSS 变量（值在 src/uni.scss 的两个
//  theme-*-vars mixin 里，由 src/App.vue 按平台挂到 page 或 body 上），
// 这里只负责切类名与广播。所以切主题是纯运行时的、零成本：没有重新编译，
// 也没有样式重算。
//
// ⚠️ 为什么状态是「每个调用点各自一份 ref + 全局事件广播」，而不是模块级单例：
//   uni-app 的 H5 会把页面与组件切成不同 chunk。实测（headless Chrome 探针）
//   模块级的 computed 在**页面侧不会触发重新渲染** —— 点切换按钮时只有按钮
//   自己的图标翻了面（它和状态在同一个 chunk），页面纹丝不动，连
//   wd-config-provider 的 theme 也没换。改成现在这样后：谁用谁持有一份自己的
//   ref（响应式闭环在**本组件内部**），切换时写存储 + uni.$emit 广播，
//   其它页面/组件用 uni.$on 收到后更新自己的 ref。三端都走 uni 的事件总线，
//   不依赖打包器的分块细节。
//
// 持久化用 src/api/storage（uni.setStorageSync 封装）：H5 落到 localStorage，
// 小程序/App 落到各自的 storage，三端同一份代码。

const THEME_KEY = 'uiTheme'
const THEME_EVENT = 'hnd-theme-change'
const DARK = 'dark'
const LIGHT = 'light'

// 强调色也要按主题换：深色底上用浅蓝，白底上必须压深才够对比度。
// 与 App.vue 里的 --ui-accent 保持同一组值。
const ACCENT = { [DARK]: '#5aa9ff', [LIGHT]: '#2f7fe0' }

// 读持久化的选择；没存过 → 深色（改造前的默认外观）
function readTheme() {
  return getItem(THEME_KEY) === LIGHT ? LIGHT : DARK
}

// 底色与状态栏属于「页面根节点之外」的部分，类名盖不住：
//   · 下拉/上拉回弹时露出来的是 page 自身的背景色 → uni.setBackgroundColor
//   · 状态栏文字颜色是原生设置 → uni.setNavigationBarColor（frontColor 只认 #fff/#000）
// 两端都是尽力而为：H5 端这两个 API 不存在（实测 typeof 是 undefined），直接跳过。
function applyNativeChrome(value) {
  const light = value === LIGHT
  const background = light ? '#f2f3f7' : '#0b0b0e'

  try {
    if (typeof uni !== 'undefined' && typeof uni.setBackgroundColor === 'function') {
      uni.setBackgroundColor({
        backgroundColor: background,
        backgroundColorTop: background,
        backgroundColorBottom: background,
      })
    }
  } catch {
    // 平台不支持就保持 pages.json 里的默认值
  }

  try {
    if (typeof uni !== 'undefined' && typeof uni.setNavigationBarColor === 'function') {
      uni.setNavigationBarColor({
        frontColor: light ? '#000000' : '#ffffff',
        backgroundColor: background,
      })
    }
  } catch {
    // 同上
  }
}

// #ifdef H5
// H5 还要把同一个类挂到 <body> 上：原生标题栏 <uni-page-head> 是
// uni-page-body 的兄弟节点，只有放到共同祖先（body）上，标题栏才读得到变量。
// 类名与页面根 view 上的一致（.theme-light），所以样式只写了一份。
function applyH5BodyClass(value) {
  try {
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('theme-light', value === LIGHT)
    }
  } catch {
    // 取不到 body 就算了：页面部分仍然是正确的
  }
}
// #endif

/**
 * 主题读写。
 * ⚠️ 必须在组件 setup 里调用（内部会注册 onUnmounted 解绑事件监听）。
 */
export function useTheme() {
  const theme = ref(readTheme())

  // 派生值都在这里现算，不要提到模块级 —— 原因见文件头
  const isLight = computed(() => theme.value === LIGHT)
  // 挂在页面根 view 上的类名：浅色才有类，深色靠 App.vue 里 page 的默认值。
  const themeClass = computed(() => (isLight.value ? 'theme-light' : ''))
  // 传给 wd-config-provider：wot-design-uni 内部组件（弹层、日期选择器、toast…）
  // 靠它的 wot-theme-* 类切深浅，我们自己的样式则靠 themeClass。
  const wotTheme = computed(() => theme.value)
  // 让 wot 组件的强调色跟随主题（否则浅色下弹层里还是深色主题那支浅蓝）
  const themeVars = computed(() => ({ colorTheme: ACCENT[theme.value] }))

  function setTheme(value) {
    const next = value === LIGHT ? LIGHT : DARK
    theme.value = next
    setItem(THEME_KEY, next)
    applyNativeChrome(next)
    // #ifdef H5
    applyH5BodyClass(next)
    // #endif
    // 广播给其它页面/组件（本组件的 ref 上面已经更新，不会重复触发）
    try {
      uni.$emit(THEME_EVENT, next)
    } catch {
      // 极端情况下（没有事件总线）就只影响当前组件
    }
  }

  function toggleTheme() {
    setTheme(theme.value === LIGHT ? DARK : LIGHT)
  }

  // 别的页面/组件切了主题 → 更新自己的 ref，本组件随之重新渲染
  const onRemoteChange = (value) => {
    if (value !== undefined && value !== theme.value) theme.value = value
  }
  try {
    uni.$on(THEME_EVENT, onRemoteChange)
    onUnmounted(() => {
      uni.$off(THEME_EVENT, onRemoteChange)
    })
  } catch {
    // 没有事件总线时退化为"只有本组件跟随主题"
  }

  // 进页面时对齐一次：状态栏/页面底色是页面级的，导航到新页面要重设；
  // 同时补偿"在别的页面切了主题、本页还没收到广播"的情况。
  const stored = readTheme()
  if (stored !== theme.value) theme.value = stored
  applyNativeChrome(theme.value)
  // #ifdef H5
  applyH5BodyClass(theme.value)
  // #endif

  return { theme, isLight, themeClass, wotTheme, themeVars, setTheme, toggleTheme }
}
