<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import request from '../api/request'
import { authState, clearAuth, getDisplayName, getRoleName, isLoggedIn } from '../api/auth'
import { lockNeedsAdmin, navItemState, useNav } from '../nav'
import LockNotice from '../components/LockNotice.vue'
import PaletteToggle from '../components/PaletteToggle.vue'
import DesktopPanel from '../components/DesktopPanel.vue'
import OfflineBanner from '../components/OfflineBanner.vue'
import AppRail from '../components/shell/AppRail.vue'
import AppSidebar from '../components/shell/AppSidebar.vue'
import TabStrip from '../components/shell/TabStrip.vue'
import CommandPalette from '../components/shell/CommandPalette.vue'
import { usePalette } from '../composables/usePalette'
import { useOrderFilterUrl } from '../composables/useOrderFilterUrl.js'
import { useWorkspaceTabs } from '../composables/useWorkspaceTabs.js'
import { ElConfigProvider, ElDialog, ElTooltip } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'dayjs/locale/zh-cn'
import updateLocale from 'dayjs/plugin/updateLocale'

/*
 * 工作台的**壳**（2026-11-11 第二次重构，照 DSH 客户端）。
 *
 * 三层：最左图标栏选模块 → 第二列列该模块的页 → 主区上方一排全局页签。
 * 与上一版的差别只有「怎么找页面」这一件事：
 *   · 上一版把六个模块纵向摊在一条 288px 的侧栏里，切模块＝展开一组、
 *     把别的组挤下去，找一页要点两三次；
 *   · 这一版模块永远是六个等大的图标（位置不变、肌肉记忆），页清单只有一屏。
 * 页签也从「同组页签」升级成「全局页签」：打开过的页跨模块并排，可以来回跳。
 *
 * 仍然不变的两条：
 *   · 当前在哪一页**只由路由决定**，侧栏高亮、页签选中、面包屑全从 route 推导；
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

/** 当前页面所属的大类（面包屑前半段、图标栏高亮都读它） */
const currentGroup = computed(() => route.meta?.group ?? '')
/** 当前大类本身（第二列的表头读它的 label/hint） */
const currentGroupObj = computed(
  () => visibleGroups.value.find((group) => group.key === currentGroup.value) ?? null,
)
/** 当前页面在 NAV_ITEMS 里的那一条 */
const activeItem = computed(
  () =>
    visibleGroups.value.flatMap((group) => group.items).find((item) => item.path === route.path) ??
    null,
)
/** 当前页标题（主区顶部） */
useOrderFilterUrl()

const pageTitle = computed(() => activeItem.value?.label ?? route.meta?.title ?? '')
/** 面包屑前半段：组名 */
const groupLabel = computed(
  () => visibleGroups.value.find((group) => group.key === currentGroup.value)?.label ?? '',
)
/** 当前组里**可见**的页 —— 第二列清单用它 */
const groupItems = computed(
  () => visibleGroups.value.find((group) => group.key === currentGroup.value)?.items ?? [],
)

/**
 * 切大类：落到该类第一个**可见**页。
 *
 * 不能盲取该类第一个页 —— 非 admin 时「工单」那四页都不可见（决策-004），
 * 那样一点「工单」就会落到一个打不开的地址上。`visibleGroups` 只含可见项，
 * 所以取它的第一项天然是能看的那一页。
 */
function selectGroup(key) {
  /*
   * 变更-129：组内优先挑**马上能用**的那一页；整组都锁定（例如游客点"工单"）
   * 就弹提示，而不是把人推到一个锁定页上 —— 那看起来像点了没反应。
   */
  const items = visibleGroups.value.find((group) => group.key === key)?.items ?? []
  const usable = items.find((item) => navItemState(item) === 'available')
  if (usable) {
    router.push(usable.path)
    return
  }
  if (items[0]) openLock(items[0])
}

function goToPage(path) {
  if (path !== route.path) router.push(path)
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
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown))

// ===== 账号块 =====
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

// ===== 第二列收起 / 展开（使用方 2026-10-07：把宽度让回给表格）=====

const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed'

/** 读写都兜一层：隐私模式下 localStorage 会直接抛（同 useVesselList 的缓存写法）。 */
function readCollapsedFlag() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 收起状态**持久化**：收起的动机是「把 248px 让回给表格」，
 * 刷新一次就自己弹回去，等于每次打开都要重收一遍，那这个功能就白做了。
 */
const collapsed = ref(readCollapsedFlag())

/*
 * 配色（2026-10-23，变更-170）：纸上的 data-palette 由状态驱动，
 * 圆形揭露动画切的就是这个值 —— 值一变，minimal-field.css 里那块的
 * background-image 跟着换，视觉上就是"新配色从按钮铺开"。
 */
const { palette } = usePalette()

watch(collapsed, (value) => {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // 存不进去只是下次打开忘了收起，不影响本次使用
  }
})

function toggleSidebar() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="min-h-screen bg-desk p-4">
      <div
        class="minimal-field flex h-[calc(100vh-2rem)] overflow-hidden rounded-card border border-line bg-canvas"
        :data-palette="palette"
      >
        <!--
          侧栏 = 图标栏 + 页清单，合成**一个 aside**：
          两块之间的分界靠 1px 竖线，不靠留缝 —— 留缝会把"一条侧栏"拆成两块浮物。
          吸顶与圆角是视觉护栏钉住的（tests/unit/visualTokens.spec.js「侧栏是 veil 面」）。
        -->
        <aside
          id="app-sidebar"
          class="sticky top-0 z-20 flex shrink-0 overflow-hidden rounded-card border border-line bg-veil"
          :class="collapsed ? 'w-[88px]' : 'w-72'"
        >
          <AppRail
            :groups="visibleGroups"
            :current-group="currentGroup"
            :compact="collapsed"
            @select="selectGroup"
          />

          <AppSidebar
            :group="currentGroupObj"
            :items="groupItems"
            :current-path="route.path"
            :collapsed="collapsed"
            @navigate="goToPage"
            @lock="openLock"
            @collapse="toggleSidebar"
          >
            <template #footer>
              <!-- 账号块：登录态读 authState，退出后立刻变回「登录」入口 -->
              <template v-if="loggedIn">
                <div class="flex items-center gap-2.5 rounded-md px-1 py-1.5">
                  <el-tooltip :content="`${displayName} · ${roleName}`" placement="top" :show-after="200">
                    <span
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/55 text-base leading-none ring-1 ring-black/5"
                      role="img"
                      :aria-label="`当前登录：${displayName}（${roleName}）`"
                    >
                      {{ avatarAnimal }}
                    </span>
                  </el-tooltip>
                  <div class="min-w-0 flex-1 leading-tight">
                    <p class="truncate text-sm font-medium text-slate-900">{{ displayName }}</p>
                    <p class="truncate text-xs text-slate-500">{{ roleName }}</p>
                  </div>
                  <el-tooltip content="退出登录" placement="top" :show-after="200">
                    <button
                      type="button"
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink active:scale-[0.96]"
                      aria-label="退出登录"
                      @click="handleLogout"
                    >
                      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <path d="M16 17l5-5-5-5" />
                        <path d="M21 12H9" />
                      </svg>
                    </button>
                  </el-tooltip>
                </div>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="group flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition hover:bg-white/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink active:scale-[0.98]"
                  @click="goLogin"
                >
                  <span
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand transition group-hover:bg-brand-hover"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                      <path d="M10 17l5-5-5-5" />
                      <path d="M15 12H3" />
                    </svg>
                  </span>
                  <span class="text-sm font-medium text-slate-900">登录</span>
                </button>
              </template>
            </template>
          </AppSidebar>
        </aside>

        <!--
          主区列 = **一个定高的纵向 flex**（使用方 2026-10-07：「红色框选区域固定大小」）。
          高度分配交给 flex：纸定高 → 本列 flex-col → 页签条 / 标题卡 shrink-0
          → 内容栏 flex-1 min-h-0 overflow-y-auto。缺一级，「固定」就退化成「跟着内容长」。
        -->
        <div class="flex min-w-0 flex-1 flex-col py-3 pr-3">
          <TabStrip
            :tabs="tabs"
            :active-key="activeKey"
            :collapsed="collapsed"
            @select="selectTab"
            @close="closeTabAndGo"
            @expand="toggleSidebar"
            @palette="paletteOpen = true"
          >
            <template #actions>
              <PaletteToggle />
              <DesktopPanel />
            </template>
          </TabStrip>

          <!--
            标题卡：这一条也包一张卡片（使用方 2026-10-07 追加）—— 纸是底，
            抬起来的卡片才是内容。`bg-raised` + `border-line` 与内容栏同料，分层靠描边。
            页签已经从这张卡里搬走了（上面那条 TabStrip），所以这里只留标题与面包屑。
          -->
          <div
            class="sticky top-0 z-30 mb-3 mt-3 shrink-0 rounded-card border border-line bg-raised px-6 py-4"
          >
            <h1 class="mb-2 text-2xl font-serif font-bold tracking-tight text-slate-900">
              {{ pageTitle }}
            </h1>
            <!-- 面包屑（组名 › 页面名）：给深链接进来的人看的（侧栏高亮只说明在哪个组） -->
            <nav aria-label="面包屑" class="flex min-w-0 items-center gap-2 text-xs text-slate-500">
              <span>{{ groupLabel }}</span>
              <span aria-hidden="true">›</span>
              <span class="font-medium text-slate-700">{{ pageTitle }}</span>
            </nav>
          </div>

          <div class="page-mount flex-1 min-h-0 overflow-y-auto rounded-card border border-line bg-raised p-4">
            <!-- 断网提示（2026-11-11）：桌面版断网时页面能开、接口全失败，
                 让"点了没反应"变成一句人话。网页版同样生效，但只在真的 offline 时出现。 -->
            <OfflineBanner />
            <!-- 锁定页（变更-129）：渲染提示卡而不是页面本体，避免一进来就打一串 401 -->
            <LockNotice
              v-if="routeLocked"
              :page-key="route.meta?.key || ''"
              :need-admin="lockNeedsAdmin(visibleGroups.flatMap((g) => g.items).find((i) => i.path === route.path))"
            />
            <router-view v-else v-slot="{ Component, route: viewRoute }">
              <!-- 变更-105 的 <Transition mode="out-in"> 已在 2026-10-20 摘掉：
                   切回某页会整块空白（老问题，非近期改动）。要淡入请用纯 CSS keyframe。 -->
              <component :is="Component" :key="viewRoute.path" />
            </router-view>
          </div>
        </div>
      </div>
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
</style>
