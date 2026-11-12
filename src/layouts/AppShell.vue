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
import TitleBar from '../components/shell/TitleBar.vue'
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

function openDrawer() {
  drawerGroup.value = currentGroup.value || visibleGroups.value[0]?.key || ''
  drawerOpen.value = true
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

        <TitleBar v-if="isDesktop" />

        <!--
          导航条：汉堡 + 应用名 · 页签 · 头像。
          页签搬到这里（而不是单独一行）之后，纵向只花掉一条 44px 的带子，
          内容画布能多出整整一行表格的高度。
        -->
        <header class="relative z-10 flex shrink-0 items-center gap-3 px-4 py-1.5">
          <span class="flex shrink-0 items-center gap-2">
            <span
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900/90 text-[11px] font-semibold text-white"
              aria-hidden="true"
              >H</span
            >
            <span class="hidden text-sm font-semibold tracking-tight text-slate-900 sm:inline"
              >HND生产助手</span
            >
          </span>

          <span class="h-5 w-px shrink-0 bg-slate-900/8" aria-hidden="true"></span>

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
              class="flex h-9 shrink-0 items-center gap-2 rounded-full pl-1 pr-2 transition hover:bg-white/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
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
            class="ml-1 shrink-0 rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            @click="goLogin"
          >
            登录
          </button>

          <!--
            导航入口（2026-11-12 使用方口径）：「汉堡按钮在右上角」。
            挪到最右侧，跟账号同一组视线；画成 1px 细边方块，
            三条线只留「上、中、下」三段短线，安静一点（线条语言，不抢内容）。
          -->
          <button
            type="button"
            class="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-slate-900/12 text-slate-600 transition hover:border-slate-900/30 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            :aria-expanded="drawerOpen ? 'true' : 'false'"
            aria-controls="app-drawer"
            aria-label="打开导航"
            @click="openDrawer"
          >
            <svg class="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
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
              class="absolute left-0 top-0 flex h-full w-[520px] max-w-[92vw] flex-col overflow-hidden border-r border-slate-900/10 bg-white shadow-[0_0_60px_-12px_rgba(16,24,40,0.35)]"
              role="dialog"
              aria-modal="true"
              aria-label="导航"
            >
          <div class="flex items-center justify-between px-4 py-3">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-[3px] border border-slate-900/12 text-slate-500 transition hover:border-slate-900/30 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              aria-label="关闭导航"
              @click="drawerOpen = false"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <p class="text-[11px] font-medium tracking-[0.22em] text-slate-500">导航</p>
          </div>

          <div class="flex min-h-0 flex-1 gap-1 px-2 pb-3">
            <!-- 模块列 -->
            <div
              class="flex w-[168px] shrink-0 flex-col gap-0.5 overflow-y-auto"
              role="group"
              aria-label="模块"
            >
              <button
                v-for="group in visibleGroups"
                :key="group.key"
                type="button"
                class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                :class="
                  drawerGroup === group.key
                    ? 'bg-slate-900/[0.06] font-medium text-slate-900'
                    : 'text-slate-600 hover:bg-slate-900/[0.04]'
                "
                :data-group="group.key"
                :aria-current="currentGroup === group.key ? 'true' : undefined"
                @click="pickGroupInDrawer(group.key)"
              >
                <svg class="h-4 w-4 shrink-0 opacity-75" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path :d="GROUP_ICON_PATHS[group.key]" />
                </svg>
                <span class="truncate">{{ group.label }}</span>
              </button>
            </div>

            <!-- 页面列 -->
            <div class="flex min-w-0 flex-1 flex-col">
              <p v-if="drawerGroupObj" class="px-2.5 pb-1.5 pt-1 text-[11px] text-slate-500">
                {{ drawerGroupObj.hint }}
              </p>
              <nav
                class="min-h-0 flex-1 overflow-y-auto"
                :aria-label="`${drawerGroupObj?.label || ''}下的页面`"
              >
                <button
                  v-for="item in drawerItems"
                  :key="item.key"
                  type="button"
                  class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                  :class="
                    item.path === route.path
                      ? 'bg-slate-900/[0.06] font-medium text-slate-900'
                      : navItemState(item) === 'locked'
                        ? 'text-slate-500 opacity-70 hover:bg-white/45'
                        : 'text-slate-700 hover:bg-white/55'
                  "
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
            </div>
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
