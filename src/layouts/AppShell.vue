<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import request from '../api/request'
import { authState, clearAuth, getDisplayName, getRoleName, isLoggedIn } from '../api/auth'
import { GROUP_ICON_PATHS, lockNeedsAdmin, navItemState, useNav } from '../nav'
import LockNotice from '../components/LockNotice.vue'
import PaletteToggle from '../components/PaletteToggle.vue'
import DesktopPanel from '../components/DesktopPanel.vue'
import OfflineBanner from '../components/OfflineBanner.vue'
import TabStrip from '../components/shell/TabStrip.vue'
import CommandPalette from '../components/shell/CommandPalette.vue'
import WindowControls from '../components/shell/WindowControls.vue'
import { IS_DESKTOP } from '../api/base'
import { appearance, wallpaperCss } from '../desktop/appearance'
import { usePalette } from '../composables/usePalette'
import { windowMaterial } from '../desktop'
import { useOrderFilterUrl } from '../composables/useOrderFilterUrl.js'
import { useWorkspaceTabs } from '../composables/useWorkspaceTabs.js'
import { ElConfigProvider, ElDialog } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'dayjs/locale/zh-cn'
import updateLocale from 'dayjs/plugin/updateLocale'

/*
 * 工作台的**壳**（2026-11-12 第三次重构，用户口径「照搬 DSH 的无侧边栏骨架」）。
 *
 * 结构上只剩三层：
 *   1. 标题栏（仅桌面版：拖拽 + 最小化/最大化/关闭）
 *   2. 一条横向导航条：汉堡菜单 + 应用名 · 全局页签 · 用户头像
 *   3. 内容画布：页面标题、筛选、表格按纵向流依次排，**没有外层卡片壳**
 *
 * 为什么砍掉常驻侧栏：侧栏占 288px，而切模块一天也就几次；
 * 把模块收进汉堡抽屉后，表格多出三列宽度，视线也不再被一列常驻文字分走。
 *
 * 仍然不变的两条（上一版立的规矩）：
 *   · 当前在哪一页**只由路由决定**，抽屉高亮、页签选中、面包屑全从 route 推导；
 *   · 权限显隐读 `authState`（响应式），登录/退出立即生效。
 */

// 日历的周起始日与文案语言（原来在 WorkOrderList 里设，随壳一起搬到顶层，
// 保证任何一页的日期选择器都是同一份口径 —— 与 tests/component/datePickerWheel.spec.js 一致）
dayjs.extend(updateLocale)
dayjs.updateLocale('zh-cn', { weekStart: 1 })
dayjs.locale('zh-cn')

const route = useRoute()
const router = useRouter()

const { visibleGroups } = useNav()

/*
 * 锁定项的弹框（变更-129）。
 * 游客点"需要注册"的功能 → 两个出口（去注册 / 我已注册去登录）；
 * 点采购/设备这种"注册了也打不开的" → 只给"换个管理员账号登录"，不给去注册。
 */
const lockDialogOpen = ref(false)
const lockTarget = ref(null)

function openLock(page) {
  lockTarget.value = page
  lockDialogOpen.value = true
  // 留痕：每会话每功能只记一次（后端有对应端点，游客也能调 —— 它在 WRITE_WHITELIST 里）
  const key = `hnd-locked-reported:${page?.key || ''}`
  try {
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      request.post('/api/audit/locked-click', { pageKey: page?.key || '' }).catch(() => {})
    }
  } catch {
    // 隐私模式下 sessionStorage 不可用；记不到就算了
  }
}

/**
 * 弹框该说哪一句：**未登录一律说"需要注册"**。
 *
 * 对游客来说，采购/设备这种"注册了也打不开"的功能，第一步同样是注册 ——
 * 所以先告诉他注册 + 给入口，注册并登录后再由后端 403 提示需要管理员。
 * 只有**已登录的非管理员**点采购/设备，才直接说"需要管理员"（注册解决不了，别提注册）。
 */
const dialogNeedsAdmin = computed(() => isLoggedIn() && lockNeedsAdmin(lockTarget.value))

function goRegisterFromLock() {
  lockDialogOpen.value = false
  // 带上原本想去的页：注册成功后直接落到那一页，不用再找一遍
  router.push({ path: '/register', query: { redirect: lockTarget.value?.path || route.path } })
}

function goLoginFromLock() {
  lockDialogOpen.value = false
  router.push('/login')
}

/** 当前路由是否需要渲染锁定卡（而不是页面本体） */
const routeLocked = computed(() => {
  const item = visibleGroups.value.flatMap((g) => g.items).find((i) => i.path === route.path)
  return item ? navItemState(item) === 'locked' : false
})

/** 当前页面所属的大类（抽屉高亮、面包屑前半段都读它） */
const currentGroup = computed(() => route.meta?.group ?? '')
/** 当前页面在 NAV_ITEMS 里的那一条 */
const activeItem = computed(
  () =>
    visibleGroups.value.flatMap((group) => group.items).find((item) => item.path === route.path) ??
    null,
)
useOrderFilterUrl()

const pageTitle = computed(() => activeItem.value?.label ?? route.meta?.title ?? '')
/** 面包屑前半段：组名 */
const groupLabel = computed(
  () => visibleGroups.value.find((group) => group.key === currentGroup.value)?.label ?? '',
)

function goToPage(path) {
  if (path !== route.path) router.push(path)
}

// ===== 导航抽屉（2026-11-12）=====
/*
 * 抽屉 = 左列模块 + 右列该模块的页。打开时默认停在当前模块，
 * 这样"我只是想换一页"不用先找模块。
 */
const drawerOpen = ref(false)
const drawerGroup = ref(currentGroup.value || visibleGroups.value[0]?.key || '')

watch(
  () => currentGroup.value,
  (value) => {
    if (value) drawerGroup.value = value
  },
)

const drawerGroupObj = computed(
  () => visibleGroups.value.find((group) => group.key === drawerGroup.value) ?? null,
)
const drawerItems = computed(() => drawerGroupObj.value?.items ?? [])

/**
 * 模块分色（2026-11-12 使用方：「导航栏要色彩没色彩，要样式没样式，要动画没动画」）。
 *
 * 概念：车间墙上的**彩色索引标签**——一本台账，六个模块各占一个色的书签。
 * 所以每个模块只给一个色相，色只在「图标底、选中底色、左侧竖条」三处出现，
 * 其余全是纸面中性色；不用渐变、不用阴影，避免又退回彩色大色块。
 * 色相按语义挑：工单=琥珀（单据纸）、物料=青绿（库存/物料牌）、采购=玫红（跟品牌同族）、
 * 设备=靛蓝（机电）、报表=紫（统计）、维护=石板灰（后台）。
 */
const GROUP_TONES = {
  order: '#B45309',
  materials: '#0F766E',
  purchase: '#BE123C',
  equipment: '#4338CA',
  stats: '#7C3AED',
  maintain: '#475569',
}
function toneOf(key) {
  return GROUP_TONES[key] || '#475569'
}

function openDrawer() {
  drawerGroup.value = currentGroup.value || visibleGroups.value[0]?.key || ''
  drawerOpen.value = true
}

/**
 * 拖动窗口（2026-11-12 使用方：「鼠标按住左键不能拖动客户端」）。
 *
 * 为什么不用 `data-tauri-drag-region`：顶栏并成一条之后，中间全是页签和按钮，
 * 真正「空白可拖」的地方几乎为零，光靠属性等于没有拖动区。
 * 这里改成：在顶栏按下左键 → 只要按到的不是控件，就交给系统开始拖动。
 * 判据用 closest 把按钮/链接/输入框/页签排除掉，点这些照常触发点击。
 */
const NO_DRAG_SELECTOR = 'button, a, input, select, textarea, [role="tab"], [role="button"], [data-no-drag]'

async function beginWindowDrag(event) {
  if (!isDesktop || event.button !== 0) return
  if (event.target?.closest?.(NO_DRAG_SELECTOR)) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().startDragging()
  } catch {
    /* 网页版，或窗口已经没了 */
  }
}

/** 顶栏空白处双击 = 最大化 / 还原，跟 Windows 标题栏的习惯一致 */
async function onTopbarDoubleClick(event) {
  if (!isDesktop) return
  if (event.target?.closest?.(NO_DRAG_SELECTOR)) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.toggleMaximize()
  } catch {
    /* 同上 */
  }
}

function pickFromDrawer(path) {
  drawerOpen.value = false
  goToPage(path)
}

function pickGroupInDrawer(key) {
  drawerGroup.value = key
}

/** 抽屉开着时 Esc 关闭；抽屉没开就不抢键盘（Ctrl+K 有自己的处理） */
function onDrawerKeydown(event) {
  if (event.key === 'Escape' && drawerOpen.value) {
    event.stopPropagation()
    drawerOpen.value = false
  }
}

// ===== 全局页签（2026-11-11）=====
const { tabs, activeKey, openTab, closeTab } = useWorkspaceTabs()

/** 当前页在页签里的 key：优先用导航项 key（与 nav 一致），否则退回路径 */
const currentTabKey = computed(() => activeItem.value?.key ?? route.path)

watch(
  () => route.path,
  () => {
    openTab({
      key: currentTabKey.value,
      label: pageTitle.value || route.meta?.title || '页面',
      path: route.path,
      group: currentGroup.value,
    })
  },
  { immediate: true },
)

function selectTab(key) {
  const target = tabs.value.find((tab) => tab.key === key)
  if (target) goToPage(target.path)
}

/**
 * 关页签：只有关掉的是**当前页**时才跳转，关别人的页不打扰你正在看的东西。
 * 关完去哪由 closeTab 返回的邻居决定（右边优先，没有就往左），全关光就回首页。
 */
function closeTabAndGo(key) {
  const wasActive = key === activeKey.value
  const nextKey = closeTab(key)
  if (!wasActive) return
  const next = tabs.value.find((tab) => tab.key === nextKey)
  router.push(next?.path ?? '/')
}

// ===== 命令面板（Ctrl/⌘ + K）=====
const paletteOpen = ref(false)

/** 面板里只列**能点的**页：锁定页放进去会变成"点了一下没反应" */
const paletteItems = computed(() =>
  visibleGroups.value.flatMap((group) =>
    group.items
      .filter((item) => navItemState(item) === 'available')
      .map((item) => ({
        key: item.key,
        label: item.label,
        path: item.path,
        groupLabel: group.label,
      })),
  ),
)

function pickFromPalette(item) {
  goToPage(item.path)
}

function onGlobalKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value = !paletteOpen.value
    return
  }
  // Ctrl+B：跟「菜单」入口同一个动作（标题栏 hover 提示里就写着这个键）
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault()
    drawerOpen.value = !drawerOpen.value
    return
  }
  onDrawerKeydown(event)
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown))

// ===== 账号区 =====
// 权限相关的显隐都读 authState（响应式），登录/退出后立即生效，无需整页刷新
const loggedIn = computed(() => isLoggedIn())
const roleName = computed(() => getRoleName() || '已登录')

const displayName = computed(() => getDisplayName() || '用户')
/**
 * 头像：**随机的可爱小动物**（使用方 2026-10-20 要求）。
 *
 * 用确定性"随机"——按账号名做一次 hash 取模，同一个账号每次进来都是同一只动物
 * （真随机会让人以为换了个人）。emoji 而不是图片：零资源、零请求、深浅底都看得清。
 */
const ANIMAL_AVATARS = ['🐱', '🐶', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸']
const avatarAnimal = computed(() => {
  const key = authState.username || displayName.value || ''
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return ANIMAL_AVATARS[hash % ANIMAL_AVATARS.length]
})

function goLogin() {
  router.push('/login')
}

async function handleLogout() {
  try {
    await request.post('/api/logout')
  } catch {
    // 退出接口异常不影响本地凭据清理
  }

  clearAuth()
  // 退出即回到只读浏览：`/` 的 redirect 会把人送到第一个**可见**的页面
  router.replace('/')
}

/*
 * 配色（2026-10-23，变更-170）：纸上的 data-palette 由状态驱动，
 * 圆形揭露动画切的就是这个值 —— 值一变，minimal-field.css 里那块的
 * background-image 跟着换，视觉上就是"新配色从按钮铺开"。
 */
const { palette } = usePalette()

/*
 * 桌面版外壳（2026-11-11）：无边框窗口 + 原生亚克力 + 自绘标题栏 + 壁纸层。
 *
 * 壁纸的模糊是**选图时烤进图片**的，运行期图层上没有任何 filter：
 * 整屏大图每帧重算会让窗口拖动、截图、长列表滚动都发涩。
 */
const isDesktop =
  IS_DESKTOP ||
  (import.meta.env.DEV && new URLSearchParams(window.location.search).has('desktop'))

/*
 * 窗口材质探测（2026-11-12）。亚克力申请失败时窗口是"透穿"而不是"磨砂"，
 * 桌面图标会清清楚楚压在文字下面 —— 那种情况下把纸面转成实色更体面。
 */
const material = ref('unknown')
if (isDesktop) {
  windowMaterial().then((kind) => {
    material.value = kind || 'none'
  })
}

const wallpaperStyle = computed(() => {
  const css = wallpaperCss(appearance)
  if (!css) return null
  return { background: css }
})

/** 纸面不透明度：越小越通透，亚克力/壁纸透上来得越多。 */
const paperStyle = computed(() => {
  // 网页版没有亚克力可透，退回不透明纸色（信息密度优先，不追求通透）
  if (!isDesktop) return { backgroundColor: '#FAFBFC' }
  if (!appearance.enabled) return null
  // 没有系统材质就别硬透：实色纸 + 桌面图标的对比度会打架
  if (material.value === 'none') return { backgroundColor: '#FAFBFC' }
  /*
   * 深色壁纸（夜 / 自定义图）压在地后面时，34% 的通明白纸会让深灰字掉到 4.5:1 以下。
   * 所以对深底抬一个下限：用户仍可往上调，但不会调到"字看不清"。
   */
  const dark = appearance.custom ? true : appearance.wallpaper === 'night'
  const alpha = dark ? Math.max(appearance.veil, 0.78) : appearance.veil
  return { backgroundColor: `rgba(255, 255, 255, ${alpha})` }
})
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="min-h-screen" :class="isDesktop ? (wallpaperStyle ? 'shell-desktop' : 'shell-desktop shell-desktop--plain') : ''">
      <!-- 壁纸层（仅桌面版）：静态图，模糊在选图时就烤好了，运行期不加 filter -->
      <div
        v-if="isDesktop && wallpaperStyle"
        class="wallpaper-layer"
        :style="wallpaperStyle"
        aria-hidden="true"
      ></div>

      <div
        class="shell-paper relative flex h-screen flex-col overflow-hidden"
        :class="isDesktop ? 'shell-paper' : ''"
        :style="paperStyle"
        :data-palette="palette"
      >
        <!--
          弥散光斑（2026-11-12）：用完就扔的一层彩色，压在纸面之上、内容之下。
          纯 CSS 三团 radial，没有位图、没有 filter —— 滚动时合成器不用重算，
          老机器也不掉帧；颜色跟着调色板走（data-palette 在纸容器上）。
        -->
        <div class="shell-glow" aria-hidden="true"></div>

        <!--
          唯一的一条顶栏：侧栏开关 · 品牌 · 页签 · 工具 · 账号 · 窗口按钮。
          2026-11-12 使用方：「红色框选部分能不能挪到最上面去，而且字体太大了太显眼了」——
          原来「标题栏 + 导航条」两条横带合并成这一条；拖动不再靠 `data-tauri-drag-region`
          （整条几乎全是控件，属性等于没有拖动区），改成按下左键时自己判断
          「按到的是不是控件」，见 beginWindowDrag()。
        -->
        <header
          class="shell-topbar relative z-10 flex shrink-0 items-center gap-2.5 px-3 py-1"
          @mousedown="beginWindowDrag"
          @dblclick="onTopbarDoubleClick"
        >
          <!-- 导航入口：桌面版就是窗口左上角第一个可点元素；网页版同样需要它 -->
          <button
            type="button"
            class="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-slate-600 transition hover:bg-slate-900/6 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            :aria-expanded="drawerOpen ? 'true' : 'false'"
            aria-controls="app-drawer"
            aria-label="打开导航"
            data-tip="打开导航　Ctrl+B"
            @click="openDrawer"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <path d="M9 4v16" />
            </svg>
            <!-- 抽屉关着时右上角一个点，提示「这里还能开」；打开就隐掉 -->
            <span v-if="!drawerOpen" class="nav-dot" aria-hidden="true"></span>
          </button>

          <span class="flex shrink-0 items-center gap-1.5">
            <span
              class="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900/90 text-[11px] font-semibold text-white"
              aria-hidden="true"
              >H</span
            >
            <span class="hidden text-[12px] font-medium tracking-tight text-slate-800 sm:inline"
              >HND生产助手</span
            >
          </span>

          <span class="h-4 w-px shrink-0 bg-slate-900/8" aria-hidden="true"></span>

          <TabStrip
            class="min-w-0 flex-1"
            :tabs="tabs"
            :active-key="activeKey"
            @select="selectTab"
            @close="closeTabAndGo"
            @palette="paletteOpen = true"
          />

          <div class="flex shrink-0 items-center gap-1">
            <PaletteToggle />
            <DesktopPanel />
          </div>

          <!-- 账号：登录后是头像 + 名字，点开是菜单；未登录是一个「登录」按钮 -->
          <el-dropdown v-if="loggedIn" trigger="click" @command="(cmd) => cmd === 'logout' && handleLogout()">
            <button
              type="button"
              class="flex h-7 shrink-0 items-center gap-2 rounded-full pl-1 pr-2 transition hover:bg-white/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              :aria-label="`账号菜单：${displayName}（${roleName}）`"
            >
              <span
                class="flex h-7 w-7 items-center justify-center rounded-full bg-white/60 text-sm leading-none ring-1 ring-black/5"
                role="img"
                :aria-label="`当前登录：${displayName}`"
                >{{ avatarAnimal }}</span
              >
              <span class="hidden max-w-[7rem] truncate text-[13px] text-slate-700 md:inline">{{
                displayName
              }}</span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>{{ displayName }} · {{ roleName }}</el-dropdown-item>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button
            v-else
            type="button"
            class="ml-1 shrink-0 rounded-md bg-brand px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            @click="goLogin"
          >
            登录
          </button>

          <!-- 窗口按钮（桌面版）：最右端，紧贴窗口右上角 -->
          <WindowControls v-if="isDesktop" class="-mr-1 ml-0.5" />
        </header>

        <!--
          内容画布：一列纵向流。页面标题、筛选、表格自己排，外面**不再套卡片壳** ——
          卡片只在「表格 / 提示块」这种独立组件上用。左右留白统一 px-7。
        -->
        <div class="page-mount flex min-h-0 flex-1 flex-col overflow-hidden px-7 pb-5 pt-1 relative z-10">
          <div class="mb-3 flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 class="text-[22px] font-semibold tracking-[-0.01em] text-slate-900">
              {{ pageTitle }}
            </h1>
            <!-- 面包屑（组名 › 页面名）：给深链接进来的人看的（抽屉高亮只说明在哪个组） -->
            <nav aria-label="面包屑" class="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
              <span>{{ groupLabel }}</span>
              <span aria-hidden="true">›</span>
              <span class="font-medium text-slate-600">{{ pageTitle }}</span>
            </nav>
          </div>

          <!-- 断网提示（2026-11-11）：桌面版断网时页面能开、接口全失败，
               让"点了没反应"变成一句人话。网页版同样生效，但只在真的 offline 时出现。 -->
          <OfflineBanner />
          <!-- 锁定页（变更-129）：渲染提示卡而不是页面本体，避免一进来就打一串 401 -->
          <LockNotice
            v-if="routeLocked"
            :page-key="route.meta?.key || ''"
            :need-admin="lockNeedsAdmin(visibleGroups.flatMap((g) => g.items).find((i) => i.path === route.path))"
          />
          <div v-else class="flex flex-1 flex-col min-h-0">
          <router-view v-slot="{ Component, route: viewRoute }">
            <!--
              页签缓存（2026-11-11）：单 WebView + <KeepAlive> 按路径缓存页面实例。
              切页签不销毁组件，筛选条件/滚动位置/抄表页的当前块都还在，
              回到这一页是"接着看"而不是"重新加载"。max=8 与页签上限 12 留了余量：
              超过 8 个最久没看的会被丢掉，避免内存一路涨。
            -->
            <KeepAlive :max="8">
              <component :is="Component" :key="viewRoute.path" />
            </KeepAlive>
          </router-view>
          </div>
        </div>
      </div>

      <!--
        导航抽屉（2026-11-12）：左列模块、右列该模块的页。
        遮罩是透明按钮而不是 div —— 键盘用户也能 Tab 到它按 Esc/回车关闭。
      -->
      <Transition name="drawer-fade">
        <div v-if="drawerOpen" class="fixed inset-0 z-40">
          <button
            type="button"
            class="absolute inset-0 cursor-default bg-slate-900/20"
            aria-label="关闭导航"
            @click="drawerOpen = false"
          ></button>
          <Transition name="drawer-slide" appear>
            <div
              id="app-drawer"
              class="drawer-wash absolute left-0 top-0 flex h-full w-[320px] max-w-[86vw] flex-col overflow-hidden border-r border-slate-900/10 shadow-[0_0_60px_-12px_rgba(16,24,40,0.35)]"
              :style="{ '--tone': toneOf(drawerGroup) }"
              role="dialog"
              aria-modal="true"
              aria-label="导航"
            >
          <div class="flex items-center justify-between px-4 pb-2 pt-3">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-[7px] border border-slate-900/12 text-slate-500 transition hover:border-slate-900/30 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              aria-label="关闭导航"
              @click="drawerOpen = false"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <p class="text-[11px] font-medium tracking-[0.22em] text-slate-500">导航</p>
          </div>

          <div
            class="relative flex min-h-0 flex-1 flex-col gap-2 px-2.5 pb-3"
            :style="{ '--tone': toneOf(drawerGroup) }"
          >
            <!-- 模块：一排彩色索引签（代替原来 168px 的模块列，也省掉一半白边） -->
            <div class="flex flex-wrap gap-1.5" role="group" aria-label="模块">
              <button
                v-for="(group, gi) in visibleGroups"
                :key="group.key"
                type="button"
                class="drawer-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                :class="drawerGroup === group.key ? 'is-active' : ''"
                :style="{ '--tone': toneOf(group.key), '--i': gi }"
                :data-group="group.key"
                :aria-current="currentGroup === group.key ? 'true' : undefined"
                @click="pickGroupInDrawer(group.key)"
              >
                <svg
                  class="h-[13px] w-[13px] shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.9"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path :d="GROUP_ICON_PATHS[group.key]" />
                </svg>
                <span class="truncate">{{ group.label }}</span>
              </button>
            </div>

            <!-- 页面：跟随模块色相的彩色弥散底，选中项「浅色底 + 色条」 -->
            <p
              v-if="drawerGroupObj"
              class="drawer-hint flex items-center gap-1.5 px-1 pt-0.5 text-[11px] text-slate-500"
            >
              <span class="drawer-hint-dot" aria-hidden="true"></span>
              {{ drawerGroupObj.hint }}
            </p>
            <nav
              class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
              :aria-label="`${drawerGroupObj?.label || ''}下的页面`"
            >
              <button
                v-for="(item, ii) in drawerItems"
                :key="item.key"
                type="button"
                class="drawer-page flex w-full items-center justify-between gap-2 px-2.5 py-[7px] text-left text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                :class="navItemState(item) === 'locked' ? 'is-locked' : ''"
                :style="{ '--i': ii }"
                :aria-current="item.path === route.path ? 'page' : undefined"
                :aria-disabled="navItemState(item) === 'locked' ? 'true' : undefined"
                @click="navItemState(item) === 'locked' ? (drawerOpen = false, openLock(item)) : pickFromDrawer(item.path)"
              >
                <span class="truncate">{{ item.label }}</span>
                <svg
                  v-if="navItemState(item) === 'locked'"
                  class="h-3.5 w-3.5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              </button>
            </nav>
            <p class="drawer-foot px-1 pt-1 text-[11px] text-slate-500">Ctrl+B 开合</p>
          </div>
          </div>
          </Transition>
        </div>
      </Transition>
    </main>
  </el-config-provider>

  <!-- 命令面板：Ctrl/⌘+K 打开，按名字搜页 -->
  <CommandPalette v-model="paletteOpen" :items="paletteItems" @pick="pickFromPalette" />

  <!-- 锁定项弹框（变更-129）：两个出口，别让已有账号的人被赶去重复注册 -->
  <el-dialog v-model="lockDialogOpen" :title="lockTarget?.label || ''" width="420px" align-center append-to-body>
    <p class="text-sm text-slate-900">
      {{ dialogNeedsAdmin ? '这个功能需要管理员权限' : '这个功能需要注册后才能使用' }}
    </p>
    <template #footer>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <button v-if="!dialogNeedsAdmin" type="button" class="rounded-md border border-line px-3 py-1.5 text-sm text-slate-700 transition hover:bg-region" @click="goLoginFromLock">我已注册，去登录</button>
        <button v-if="!dialogNeedsAdmin" type="button" class="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-ink" @click="goRegisterFromLock">前往注册</button>
        <button v-else type="button" class="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-ink" @click="goLoginFromLock">换个管理员账号登录</button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* ===== 抽屉导航（2026-11-12 重做：彩色索引标签 + 入场节奏） ===== */
/*
 * 规则：色只出现在三处 —— 图标底、选中项底色、左侧竖条。
 * 其余保持纸面中性色，避免整块变成彩色面板。
 */
/* 抽屉关闭时，顶栏图标右上角的小圆点（提示还能打开） */
.nav-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: #c0455f;
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.9);
}

.drawer-chip {
  --tone: #475569;
  position: relative;
  color: color-mix(in srgb, var(--tone) 78%, #0f172a);
  background-color: color-mix(in srgb, var(--tone) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--tone) 16%, transparent);
  transition:
    background-color 150ms ease,
    color 150ms ease,
    border-color 150ms ease,
    transform 150ms cubic-bezier(0.23, 1, 0.32, 1);
}
.drawer-chip:hover {
  background-color: color-mix(in srgb, var(--tone) 13%, transparent);
  border-color: color-mix(in srgb, var(--tone) 28%, transparent);
  transform: translateY(-1px);
}
.drawer-chip.is-active {
  background-color: var(--tone);
  border-color: var(--tone);
  color: #fff;
  transform: none;
}
.drawer-chip.is-active svg {
  color: #fff;
}
.drawer-chip svg {
  color: var(--tone);
}

.drawer-hint-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 999px;
  background: var(--tone, #94a3b8);
}
.drawer-hint {
  color: #64748b;
}

.drawer-page {
  position: relative;
  border-radius: 9px;
  color: #475569;
  transition:
    background-color 140ms ease,
    color 140ms ease,
    transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
}
.drawer-page::before {
  content: '';
  position: absolute;
  left: 0;
  top: 26%;
  height: 48%;
  width: 2px;
  border-radius: 2px;
  background: var(--tone, #475569);
  transform: scaleY(0);
  transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
.drawer-page:hover {
  background-color: color-mix(in srgb, var(--tone, #475569) 6%, transparent);
  color: #0f172a;
  transform: translateX(2px);
}
.drawer-page[aria-current='page'] {
  background-color: color-mix(in srgb, var(--tone, #475569) 11%, transparent);
  color: #0f172a;
  font-weight: 500;
  transform: none;
}
.drawer-page[aria-current='page']::before {
  transform: scaleY(1);
}
.drawer-page.is-locked {
  color: #94a3b8;
}
.drawer-page.is-locked:hover {
  background-color: rgba(148, 163, 184, 0.1);
}

/*
 * 入场：每项依次落位（22ms 一档），只动 transform / opacity。
 * 为什么值得做动画：抽屉是「整块滑进来」的，里面的字如果一帧到位，
 * 看上去像贴图；错开一点点，眼睛才会觉得这是一层真的面板。
 */
.drawer-chip,
.drawer-page {
  animation: drawer-item-in 260ms cubic-bezier(0.23, 1, 0.32, 1) backwards;
  animation-delay: calc(var(--i, 0) * 22ms + 40ms);
}
@keyframes drawer-item-in {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .drawer-chip,
  .drawer-page,
  .drawer-page::before {
    animation: none !important;
    transition: none !important;
  }
}

/* 顶栏：跟标题栏以前那层「半透明纱」同色，压住壁纸的顶部，字才清楚 */
.shell-topbar {
  background-color: color-mix(in srgb, var(--color-veil) 72%, transparent);
}

/* 切页淡入（变更-105 的替代品：纯 CSS keyframe，不用 <Transition>） */
.page-mount > :first-child {
  animation: page-fade 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes page-fade {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .page-mount > :first-child {
    animation: none;
  }
}

/* 抽屉：从左边滑出、默认隐藏（2026-11-12 使用方口径） */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 180ms ease;
}
.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}
.drawer-slide-enter-active {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer-slide-leave-active {
  transition: transform 160ms ease-in;
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(-100%);
}

/*
 * 桌面版：窗口是透明 + 原生亚克力的，页面不能再铺一层不透明的桌面底色，
 * 否则亚克力白做了。壁纸层是一张静态图，压在内容和窗口之间。
 */
.shell-desktop {
  background: transparent;
}
/* 关掉壁纸时窗口不能真的空着（那会透出桌面），给一层中性浅灰兜底 */
.shell-desktop--plain {
  background: #eceff4;
}
.wallpaper-layer {
  position: fixed;
  inset: -24px;
  z-index: 0;
  pointer-events: none;
}
.shell-desktop .shell-paper {
  position: relative;
  z-index: 1;
  /* 2026-11-12：外壳那圈"白底板"去掉 —— 内容直接铺在窗口（亚克力）上，不再有浮起的纸卡 */
}
</style>
