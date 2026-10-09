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
  // 窗口底色要跟 uni.scss 的 --ui-scene-bg 对齐（场景是平底，上下同色）。
  //
  // ⚠️ 这里**管不到**手机最底下那条系统导航栏：实测 WebView 只有 837 CSS px
  //    （物理 2720），屏幕是 2772 —— 最后 52 物理像素在 WebView 之外，是 Android
  //    画的原生导航栏，CSS 与 uni 的 API 都够不着。它的颜色跟随**系统**的深浅模式，
  //    不跟 App 主题：手机系统是浅色时，App 切到深色，那条仍然是纯白 rgb(255,255,255)。
  //    真正要动它得走 plus.android 原生命令（Android 15+ 上该 API 已被标记废弃），
  //    属于另一件事，见 2026-10-09 的排查记录。
  const background = light ? '#f2f3f7' : '#0b1322'

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

  // #ifdef APP-PLUS
  // 手机最底下那条约 16px 的**系统导航栏**：实测 WebView 只有 837 CSS px（物理 2720），
  // 屏幕是 2772 —— 它在 WebView 之外，是 Android 自己画的，CSS 和上面的 uni API 都够不着。
  // 它的颜色跟随**系统**深浅模式、不跟 App 主题：系统是浅色时，App 切到深色，那条依然是纯白
  // rgb(255,255,255)，在深色页面上非常扎眼。
  // 只能走 plus.android 的原生接口。⚠️ Android 15+ 上 Window.setNavigationBarColor 已被
  // 标记废弃（对 targetSdk 35+ 无效），所以整段包在 try/catch 里 —— 不生效也不能影响别处。
  try {
    if (typeof plus !== 'undefined' && plus.os && plus.os.name === 'Android') {
      const activity = plus.android.runtimeMainActivity()
      const window = activity.getWindow()
      plus.android.importClass(window)
      const Color = plus.android.importClass('android.graphics.Color')
      window.setNavigationBarColor(Color.parseColor(background))
    }
  } catch {
    // 原生接口不可用（版本/权限/被系统废弃）就保持系统默认色
  }
  // #endif
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
  // 传给 wd-config-provider 的 wot 主题变量。**一律引用 --ui-*，不写颜色字面量**：
  // wot 的每个色值都是 `var(--wot-xxx, 浅色默认)`，所以这里一设，它内部组件（分页器、
  // 输入框、单元格、弹层…）就跟着本仓的调色板走。
  //
  // 历史坑：这里原来写的是 `colorTheme: ACCENT[theme]`，一个 JS 写死的蓝。改香槟金时
  // 它没跟着变，结果 wot 组件还是蓝的（我们的组件是金的）—— 同一支强调色在两处各写一份
  // 必然会漂移，所以改成引用 CSS 变量，单一来源。ACCENT 常量已随之删除。
  //
  // 深色面：wot 自己的默认值是 #131313 一系（纯黑灰），压在墨蓝夜景上是一块突兀的黑；
  // 而本仓的"表面"已经是半透明玻璃了，所以这里也给它半透明叠加层（--ui-raise-2 就是
  // "抬升一层"的语义）—— 否则 wot 组件会变成玻璃上的一块不透明矩形（分页器实测踩过）。
  // 只覆盖深色那套；浅色下 wot 的默认值本身与我们的轻量版相容，不必动。
  //
  // 分页器那几个：wot 的默认值是**黑色系**（文字 rgba(0,0,0,.69)、描边 rgba(0,0,0,.45)），
  // 深色主题下等于看不见 —— 走 var(--ui-*) 之后两套主题各自成立。
  // 这两条的间距也在这里收一收：默认 message-padding 底部还有 16px，叠加调用点容器的
  // padding 后底部会空出一大块（真机截图里那块"多余的白"）。
  const themeVars = computed(() => ({
    colorTheme: 'var(--ui-accent)',
    // wot 主按钮（wd-button type="primary"）的文字色默认取 $-color-white = rgb(255,255,255)。
    // 而它的底取 $-color-theme = 我们的强调色 —— 换香槟金之后就是"金字压白字"1.78:1，
    // 深色主题下"保存/关闭"这类按钮直接看不清。这里把它指到"强调块上的字"那个 token。
    buttonPrimaryColor: 'var(--ui-on-accent)',
    paginationMessageColor: 'var(--ui-text-3)',
    paginationNavColor: 'var(--ui-text-2)',
    paginationNavBorder: '1px solid var(--ui-border)',
    paginationMessagePadding: '2px 0 0 0',
    ...(theme.value === DARK
      ? {
          darkBackground: 'var(--ui-raise-2)',
          darkBackground2: 'var(--ui-raise)',
          darkBackground3: 'var(--ui-raise-2)',
          darkBorderColor: 'var(--ui-border)',
          darkColor: 'var(--ui-text)',
          darkColor3: 'var(--ui-text-2)',
        }
      : {}),
  }))

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
