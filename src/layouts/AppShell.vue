<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import request from '../api/request'
import { clearAuth, getRoleName, isLoggedIn } from '../api/auth'
import { GROUP_ICON_PATHS, useNav } from '../nav'
import { ElConfigProvider, ElTooltip } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'dayjs/locale/zh-cn'
import updateLocale from 'dayjs/plugin/updateLocale'

/*
 * 工作台的**壳**（2026-10 路由化改造）。
 *
 * 左：侧栏（品牌、六个大类、账号块）  右：顶栏（标题 / 面包屑 / 同组页签）+ 主区（<router-view />）。
 *
 * 这次改造把原来那个 4115 行的单文件巨石拆成了「壳 + 14 个路由页」：
 *   · 16 个内容块各自成页，共享状态仍在各自的 composable 里（那几个都是模块级单例）；
 *   · 「页签」不再是组件内的 `activeTab` ref —— **当前在哪一页由路由决定**，
 *     侧栏、页签、面包屑三处高亮全部从 `route` 推导。原先那套
 *     `visibleTabs` / `currentGroup` / `groupTabs` / `mountedTabs` 的推导链条
 *     因此整根消失：路由天然「一次只挂一个页面」，面板叠加这个隐患不再需要
 *     v-if + v-show 两个一起写来防。
 */

// 日历的周起始日与文案语言（原来在 WorkOrderList 里设，随壳一起搬到顶层，
// 保证任何一页的日期选择器都是同一份口径 —— 与 tests/component/datePickerWheel.spec.js 一致）
dayjs.extend(updateLocale)
dayjs.updateLocale('zh-cn', { weekStart: 1 })
dayjs.locale('zh-cn')

const route = useRoute()
const router = useRouter()

const { visibleGroups } = useNav()

/** 当前页面所属的大类（面包屑前半段、侧栏高亮、组内页签都读它） */
const currentGroup = computed(() => route.meta?.group ?? '')
/** 当前页面在 NAV_ITEMS 里的那一条 */
const activeItem = computed(
  () =>
    visibleGroups.value.flatMap((group) => group.items).find((item) => item.path === route.path) ??
    null,
)
/** 当前页标题（主区顶部） */
const pageTitle = computed(() => activeItem.value?.label ?? route.meta?.title ?? '')
/** 面包屑前半段：组名 */
const groupLabel = computed(
  () => visibleGroups.value.find((group) => group.key === currentGroup.value)?.label ?? '',
)
/** 当前组里**可见**的页 —— 组内页签用它 */
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
  const first = visibleGroups.value.find((group) => group.key === key)?.items[0]
  if (first) router.push(first.path)
}

function goToPage(path) {
  if (path !== route.path) router.push(path)
}

// ===== 卡片行横向滚动 =====
// 组内页签一屏可能放不下（工单组有 4 张、设备组 3 张，窄屏照样溢出）。
const tabNavRef = ref(null)

/**
 * 鼠标滚轮 → 页签条左右滚动。
 *
 * 只在「这个方向确实还有内容」时才拦截，滚到头就放行给页面 ——
 * 否则指针停在页签条上时整页都滚不动，用户会以为页面卡住了。
 */
function handleTabWheel(event) {
  const nav = tabNavRef.value
  if (!nav) return

  // 横向滚轮（触控板左右滑）交给浏览器默认行为，不掺和
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

  const maxScroll = nav.scrollWidth - nav.clientWidth
  if (maxScroll <= 0) return // 本来就装得下，不拦截

  const atStart = nav.scrollLeft <= 0 && event.deltaY < 0
  const atEnd = nav.scrollLeft >= maxScroll && event.deltaY > 0
  if (atStart || atEnd) return

  event.preventDefault()
  nav.scrollLeft = Math.max(0, Math.min(maxScroll, nav.scrollLeft + event.deltaY))
}

// 切页后把激活项滚进视野：路由变化可能来自浏览器前进/后退，切到的那一项
// 可能在可视区之外，用户会看不到自己现在在哪一页。
watch(
  () => activeItem.value?.key,
  async () => {
    await nextTick()
    const nav = tabNavRef.value
    const button = nav?.querySelector(`[data-tab-key="${activeItem.value?.key}"]`)
    if (!nav || !button) return

    const left = button.offsetLeft
    const right = left + button.offsetWidth
    if (left < nav.scrollLeft) {
      nav.scrollLeft = left
    } else if (right > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = right - nav.clientWidth
    }
  },
)

// ===== 账号块 =====
// 权限相关的显隐都读 authState（响应式），登录/退出后立即生效，无需整页刷新
const loggedIn = computed(() => isLoggedIn())
const roleName = computed(() => getRoleName() || '已登录')

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
  // （非 admin 看不见工单组那四页）。查询类接口（物料 / 周统计 / 储罐液位 …）
  // 本就免登录，数据无需重取；写入类按钮随 authState 变化自动隐藏。
  router.replace('/')
}

// ===== 侧栏收起 / 展开（使用方 2026-10-07：点击切换浮动面板 / 图标条）=====

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
 * 收起状态**持久化**：收起的动机是「把 224px 让回给表格」，
 * 刷新一次就自己弹回去，等于每次打开都要重收一遍，那这个功能就白做了。
 */
const collapsed = ref(readCollapsedFlag())

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
  <!--
  ⚠️ **读这一页的模板注释之前，先看这一条**（x-minimalist，2026-10-15）

  本文件有大段注释在描述 036~043 的**液态玻璃**配方：`bg-white/55`、
  `backdrop-blur` 的 32px / 30px 两档任意值、`glass-frost`/`glass-veil`、`border-white`、
  「两档玻璃」「清水档」「边缘光学」……**那些段落现在只是历史记录，不再是现状。**

  现状：三块面板已换成**不透明的面 + 1px 发丝线**（侧栏 `bg-veil`、导航条与主区栏
  `bg-raised`，都配 `border-line` = #EAEAEA），全站**零** `backdrop-*`；
  卡片配方是 `bg-raised` + `border-line`（原 `/95` + `border-white/60` + `blur-xl` 退役）；
  纸是 `bg-canvas`（纯白）+ `.minimal-field` 的一道 α=0.035 暖径向。
  现状以 `DESIGN.md` 与 `src/minimal-field.css` 为准。
  -->
  <el-config-provider :locale="zhCn">
    <!--
      页面底色 = **浅桌面灰 `desk`**（变更-043）。底与卡是两回事，只差一层嵌套却是两种读法 ——
      底变暖是「整屏泛黄」，卡是「有一张纸，东西都放在纸上」。
      卡片四边留 16px，与侧栏浮动面板同一个数 —— 同一种留白不出现两个值。
      **高度写死 100vh − 上下各 16px（main 的 p-4），不是 min-h**（使用方 2026-10-07
      圈着主区要「固定大小」时改的）。原来写的是 min-h，短内容完全看不出区别 ——
      但**下限不是高度**：内容一长纸就跟着长，里面那几级 flex 分配全部落空
      （实测：主区栏 619 → 3157 → 3381px，整页多出一条滚动条）。
      定高之后纸正好是一整屏，页面自己不再滚动，滚动都在两块面板内部。
    -->
    <main class="min-h-screen bg-desk p-4">
      <!--
      外壳**不再限宽居中**（原先这里挂的是 mx-auto max-w-[1600px]）。
      留着它，那块浮动面板离视口左边就是 (视口−1600)/2 + 16 —— 1664 的屏上量出来 48px，
      跟使用方要的「四边 16px」对不上；屏幕越宽偏得越多。
    -->
      <div class="minimal-field flex h-[calc(100vh-2rem)] rounded-card border border-line bg-canvas">
        <!--
        左侧栏：用户信息 + 六个大类 + 账号（dashboard 布局）。

        分组只是「怎么看这些页」，**不新增状态** —— 当前组由路由的 meta.group 推导，
        所以「登录/退出后自动切页」「导入返回跳回工单汇总」这些既有逻辑一行都不用动。

        「藏掉就没法切页」这条已经不成立（2026-10-07 加收起后改）：收起态是**图标条**，
        六个大类各留一个图标、点了照样切组（只列有可见页的组，见 visibleGroups）。
        -->
        <!--
        整块做成**浮动面板**：四边 16px 外边距、圆角 20px、一层低透明度柔和投影。
        sticky 的落点是 **top-0**（与主区那条导航条钉在同一条线上）——
        四边 16px 是**静止**位置，由面板自己的 m-4 给；吸顶位置由 top-* 给，两者互不干扰。

        面板**撑满可用高度**（使用方 2026-10-07 追加）：此前高度跟着内容走，
        aside 被 main 的 min-h-screen 撑满、面板却只有小半截，下面空出一条竖带。

        这个高度是 100vh 减掉**四层** 16px：
          main 的 p-4 (16) + 面板 m-4 (16) + 面板高 + m-4 (16) + p-4 (16) = 100vh
          ⇒ 面板高 = 100vh − 64px = 100vh − 4rem

        flex-col + 导航 flex-1：账号块落到面板底部（内容短时靠底对齐，不浮在半空）。
        整块再兜一层 overflow-y-auto —— 窗口特别矮或以后大类变多时，
        退化成「整面板自己滚」，而不是把内容溢出到圆角外面。

        收窄时额外压一层 overflow-x-hidden：overflow-y 一旦不是 visible，
        overflow-x 就会被算成 auto，200ms 的宽度过渡里文字来不及换行，
        会在面板底部闪出一条横向滚动条。
        -->
        <!--
        收起态 = aside 变窄（88px），不是浮层盖在内容上 —— 使用方选的「内容让位、不重叠」，
        所以面板留在 flex 流内，主区（flex-1）自动把那 136px 拿回去。

        **两个状态的 margin 都是 m-4**，这是关键：面板离卡片内缘恒 16px 是既定口径，
        而面板高度 h-[calc(100vh-4rem)] 里的 4rem 正是 main 的上下 p-4 加这上下两个 m-4。
        收起后的可见窄条是 88 − 16×2 = 56px（与使用方定的「56px 窄条」一致）。

        **展开态 w-72（288px）**：分组块加了 36px 图标之后，224px 下最长那条提示
        「工单、领料、入库与核算」会折行，四条提示两条折行、两条不折，行高参差。
        288px 下文字列是 156px，132px 的提示留出 24px 余量。
        -->
        <aside
          class="shrink-0 transition-[width] duration-200 ease-out"
          :class="collapsed ? 'w-[88px]' : 'w-72'"
        >
          <!--
          侧栏玻璃是变更-037 建的那一层；041 深烟、043 翻浅成轻纱 —— 第三版材质。
          **整组退役**：x-minimalist 不要玻璃。侧栏现在是一块**不透明的暖骨面**
          `bg-veil`（#F7F6F3）+ `border-line`（1px #EAEAEA）+ `rounded-card`；
          与纸的分离比 **1.08**（spec 实算钉 ≥1.08）—— 靠「比纸深半档」，不靠
          填充透明度、不靠模糊、不靠投影。

          · **不许再出现 `backdrop-*`**：整站零 `backdrop-filter` / `backdrop-blur`
            / `backdrop-saturate`（spec 有一条全仓反扫钉着）。
          · 描边是 `border-line` 而不是 `border-white`：白纸上的白边等于没有边，
            发丝线才是这一代唯一的分层手段。
          · 选中指示是 **`bg-brand` 实底**（墨色 #111111 + 纯白字 18.9:1）+ 一圈
            `ring-1 ring-white/20` 描边。
          · **吸顶位置是 `top-0`**（与主区那条导航条对齐）：sticky 的吸附基准是
            **border box**，`m-4` 那 16px **不参与**吸顶。
          -->
          <div
            id="app-sidebar"
            class="sticky top-0 m-4 flex h-[calc(100vh-4rem)] flex-col overflow-x-hidden overflow-y-auto rounded-card border border-line bg-veil"
            :class="collapsed ? 'p-2' : 'p-4'"
          >
            <!--
            收起/展开按钮贴右上角（这个控件的惯例位置），**只与那句英文小字同行**，
            中文那两行单独占满整宽 —— 它当初是为了不让「生产工单与物料数据查询助手」
            被折成「…数据查」/「询助手」。
            -->
            <div
              class="flex items-start gap-2"
              :class="collapsed ? 'justify-center' : 'justify-between'"
            >
              <p
                v-show="!collapsed"
                class="min-w-0 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
              >
                Factory Operations
              </p>
              <!--
              焦点环是**全站统一的 `ring-brand`**（043）：石墨压浅纱 ~13:1。
              这处原先用的是 slate-500，理由是「导航项那批浅色环只有 1.67:1」——
              那批环已在 变更-028 一并修掉，不统一的理由随之消失。
            -->
              <button
                type="button"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-white/45 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]"
                :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
                :aria-expanded="!collapsed"
                aria-controls="app-sidebar"
                @click="toggleSidebar"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path :d="collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'" />
                </svg>
              </button>
            </div>
            <p v-show="!collapsed" class="mt-1 text-lg font-bold tracking-tight text-slate-900">
              HND生产助手
            </p>
            <p v-show="!collapsed" class="mt-1 text-xs text-slate-600">
              生产工单与物料数据查询助手
            </p>

            <!-- 分区之间只用一条细分割线：面板本身已经浮起来了，
               再给每块画边框就成了「面板里套卡片」的双层轮廓，反而糊 -->
            <nav
              class="mt-4 flex-1 space-y-1.5 border-t border-brand/10 pt-4"
              aria-label="功能分类"
            >
              <!--
              收起态与展开态是**同一组按钮**，只是文字部分 v-show 掉、按钮本身
              缩成方块。不做两套（展开一套 / 收起一套）：两套就是同一个导航
              存了两位真值，容易只改一边。

              **因此这里只能 v-show，不能 v-if**：v-if 会把收起态的按钮整个摘掉。

              —— 每个分组是一个**看得见的块**（使用方 2026-10-07：「每个块周围带绿色光晕」）：
              图标进了一个 36px 的圆角方块（未选中白色透块 + slate-600 图标；
              选中反白 + 白图标，压在 brand 行底上 16.83）。

              未选中图标块是 **`bg-white/40` 白色透块**（041 的 `/12` 在浅纱上会被纱吞掉）。
              规则一句话：「**这块料上，抬起来的一律是白色系**」—— 实白给浅底
              （卡片 /95），白透块给纱面（图标块 /40、行 hover /45）。

              选中项**只剩 `bg-brand` 实底 + `ring-1 ring-white/20` 描边**（043 删了
              `shadow-glow` 光晕 —— 石墨实底自己撑得住）。四块一样亮就分不出当前在
              哪一组；收起态也不描边 —— 40px 见方里再套一层环会糊成一团。
              -->
              <el-tooltip
                v-for="group in visibleGroups"
                :key="group.key"
                :content="group.label"
                placement="right"
                :disabled="!collapsed"
                :show-after="200"
              >
                <button
                  type="button"
                  class="rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.99]"
                  :class="[
                    collapsed
                      ? 'mx-auto flex h-10 w-10 items-center justify-center'
                      : 'flex w-full items-center gap-3 px-2.5 py-2.5 text-left',
                    !collapsed && currentGroup === group.key ? 'bg-brand ring-1 ring-white/20' : '',
                    !collapsed && currentGroup !== group.key ? 'hover:bg-white/45' : '',
                  ]"
                  :aria-label="collapsed ? group.label : undefined"
                  :aria-current="currentGroup === group.key ? 'true' : undefined"
                  @click="selectGroup(group.key)"
                >
                  <span
                    class="flex shrink-0 items-center justify-center rounded-md transition-colors"
                    :class="[
                      collapsed ? 'h-10 w-10' : 'h-9 w-9',
                      currentGroup === group.key
                        ? 'bg-white/15 text-white'
                        : 'bg-white/40 text-slate-600',
                      collapsed && currentGroup !== group.key ? 'hover:bg-white/55' : '',
                    ]"
                  >
                    <svg
                      class="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path :d="GROUP_ICON_PATHS[group.key]" />
                    </svg>
                  </span>
                  <span v-show="!collapsed" class="min-w-0">
                    <span
                      class="block text-sm"
                      :class="
                        currentGroup === group.key ? 'font-medium text-white' : 'text-slate-900'
                      "
                      >{{ group.label }}</span
                    >
                    <!-- truncate 是兜底：宽度已按最长的那条提示留足，正常情况下不会省略。
                       它防的是「以后有人把某条提示改长」—— 那时宁可省略号，也不要
                       四条里两条折行、行高变成两种。 -->
                    <!-- 提示行颜色：未选中 slate-600（压浅纱 5.76），选中态转纯白
                       （压**墨色**胶囊 18.88 —— x-minimalist 的主色是 #111111）。
                       选中行的层次由字号（14/12）与字重（medium/normal）承担。 -->
                    <span
                      class="mt-0.5 block truncate text-xs font-normal"
                      :class="currentGroup === group.key ? 'text-white' : 'text-slate-600'"
                      >{{ group.hint }}</span
                    >
                  </span>
                </button>
              </el-tooltip>
            </nav>

            <!--
            账号块放**面板最底**（使用方 2026-10-07：登录按钮放左下角）。
            原先它紧贴在标题下面 —— 那是视线的起点，却摆了个低频操作
            （一人一账号，登录/退出一天用不上一次）。

            它上面原先还有一小块「设置 / 共 N 条工单」，使用方同日划掉了：
            条数在工单汇总的分页器上本来就报（`:total="total"`），侧栏再来一遍是重复的。
            未登录即可只读浏览；写入类功能按权限隐藏。
          -->
            <div class="mt-3 border-t border-brand/10 pt-3 text-sm">
              <!--
              2026-10-07 使用方圈出这一块说「有点丑」，重做的思路是**对齐导航行的形体**：
              上面六组都是「36px 图标块 + 文字」的整行块，这里原先却是两行裸文字。

              身份行**不可点**：它答的是「你是谁」（管理员 / 只读浏览），不是动作 ——
              图标块照给，只是不响应 hover。退出/登录是动作，**整行可点**：
              hover 与导航行同一条（整行 bg-white/45），图标块再转成 rose / brand 实心，
              把「这一下会发生什么」讲清楚。

              收起态**不再另做一套**：行结构不变，文字 v-show 掉、图标块 36 → 40px，
              身份行由 tooltip + role="img" 的 aria-label 报「当前登录：xx」。
              仍然**只有一个按钮**（展开的整行与收起的图标块是同一颗），
              DOM 里「退出登录」不会出现两份。
            -->
              <template v-if="loggedIn">
                <el-tooltip
                  :content="roleName"
                  placement="right"
                  :disabled="!collapsed"
                  :show-after="200"
                >
                  <div
                    class="flex items-center"
                    :class="collapsed ? 'justify-center' : 'gap-3 px-2.5 py-2.5'"
                  >
                    <span
                      class="flex shrink-0 items-center justify-center rounded-md bg-white/40 text-slate-600"
                      :class="collapsed ? 'h-10 w-10' : 'h-9 w-9'"
                      :role="collapsed ? 'img' : undefined"
                      :aria-label="collapsed ? `当前登录：${roleName}` : undefined"
                    >
                      <svg
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path
                          d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 0 1-8 0 4 4 0 0 1 8 0z"
                        />
                      </svg>
                    </span>
                    <span
                      v-show="!collapsed"
                      class="min-w-0 truncate text-sm font-medium text-slate-700"
                    >
                      {{ roleName }}
                    </span>
                  </div>
                </el-tooltip>
                <el-tooltip
                  content="退出登录"
                  placement="right"
                  :disabled="!collapsed"
                  :show-after="200"
                >
                  <button
                    type="button"
                    class="group mt-1 rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]"
                    :class="
                      collapsed
                        ? 'mx-auto flex items-center justify-center'
                        : 'flex w-full items-center gap-3 px-2.5 py-2.5 text-left hover:bg-white/45'
                    "
                    :aria-label="collapsed ? '退出登录' : undefined"
                    @click="handleLogout"
                  >
                    <span
                      class="flex shrink-0 items-center justify-center rounded-md bg-white/40 text-slate-600 transition"
                      :class="
                        collapsed
                          ? 'h-10 w-10 group-hover:bg-white/55'
                          : 'h-9 w-9 group-hover:bg-rose-600 group-hover:text-white'
                      "
                    >
                      <svg
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <path d="M16 17l5-5-5-5" />
                        <path d="M21 12H9" />
                      </svg>
                    </span>
                    <span
                      v-show="!collapsed"
                      class="text-sm text-slate-700 transition group-hover:text-rose-700"
                    >
                      退出登录
                    </span>
                  </button>
                </el-tooltip>
              </template>
              <template v-else>
                <el-tooltip
                  content="只读浏览"
                  placement="right"
                  :disabled="!collapsed"
                  :show-after="200"
                >
                  <div
                    class="flex items-center"
                    :class="collapsed ? 'justify-center' : 'gap-3 px-2.5 py-2.5'"
                  >
                    <span
                      class="flex shrink-0 items-center justify-center rounded-md bg-white/40 text-slate-600"
                      :class="collapsed ? 'h-10 w-10' : 'h-9 w-9'"
                      :role="collapsed ? 'img' : undefined"
                      :aria-label="collapsed ? '未登录，只读浏览' : undefined"
                    >
                      <svg
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path
                          d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 0 1-8 0 4 4 0 0 1 8 0z"
                        />
                      </svg>
                    </span>
                    <span v-show="!collapsed" class="min-w-0 truncate text-sm text-slate-600">
                      只读浏览
                    </span>
                  </div>
                </el-tooltip>
                <el-tooltip
                  content="登录"
                  placement="right"
                  :disabled="!collapsed"
                  :show-after="200"
                >
                  <button
                    type="button"
                    class="group mt-1 rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]"
                    :class="
                      collapsed
                        ? 'mx-auto flex items-center justify-center'
                        : 'flex w-full items-center gap-3 px-2.5 py-2.5 text-left hover:bg-white/45'
                    "
                    :aria-label="collapsed ? '登录' : undefined"
                    @click="goLogin"
                  >
                    <span
                      class="flex shrink-0 items-center justify-center rounded-md bg-brand text-white transition group-hover:bg-brand-deep"
                      :class="collapsed ? 'h-10 w-10' : 'h-9 w-9'"
                    >
                      <svg
                        class="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                      >
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                        <path d="M10 17l5-5-5-5" />
                        <path d="M15 12H3" />
                      </svg>
                    </span>
                    <span v-show="!collapsed" class="text-sm font-medium text-slate-900">
                      登录
                    </span>
                  </button>
                </el-tooltip>
              </template>
            </div>
          </div>
        </aside>

        <!--
        主区**左边不留内边距**：侧栏那块浮动面板自己带 16px 外边距（m-4），
        这里再补一层就成 32px 的缝，跟「四边 16px」对不上。
        py-4 则是与面板的上下 16px 对齐。
      -->
        <!--
          主区列 = **一个定高的纵向 flex**（使用方 2026-10-07 圈着主区指定：
          「红色框选区域**固定大小**」）。

          为什么是 `flex flex-col` + 下一条 `flex-1 min-h-0`，而不是给那块手算一个
          `h-[calc(100vh-…)]`：**导航条的高度不是常数**（页签换行、字体回退都会变），
          把它的高度减进 calc 里，改天导航条长高两行，主区就跟着错位。
          交给 flex 分配：列高由纸的**定高**给（`h-[calc(100vh-2rem)]`），
          导航条占它该占的，**剩下的全归主区栏**。

          ⚠️ 这套分配**只在纸是定高时才成立**。护栏钉的是**整条链**，
          见 tests/unit/visualTokens.spec.js 的「固定大小」那两条。
        -->
        <div class="flex min-w-0 flex-1 flex-col py-4 pr-4 sm:pr-6">
          <!-- 主区顶部：当前页标题 + 面包屑 + **同组页面的页签**。
           页签从顶部横条挪到了这里：切页不必先滚到最底。

           **这一条也包一张卡片**（使用方 2026-10-07 追加）：此前标题与页签直接压在
           纸面上，而它下面的筛选/表格、左边的侧栏面板都是有底的 —— 单这一条裸着，
           就破了「东西都放在纸上」那层意思：**纸是底，抬起来的卡片才是内容**。

           **这一条与侧栏不同料、与主区栏同料**：`bg-raised`（纯白，不透明）
           + `border-line`（1px #EAEAEA）+ `rounded-card`。分层靠**描边与间距**。
           ⚠️ 它和主区栏**必须同串**（两块同料），spec 防「只调一块」。
           ⚠️ 页签里**只有选中的那个有底色**（brand 实底 + 白字），
           未选中的是**透明的** —— 五个白药丸正是使用方圈出来的「很多地方都是白色的」之一。

           **吸顶**：`top-0` 贴着视口最上沿（`top-4` 会漏，正在滚的内容会从导航条
           上方划过去 —— 与 `/intro` 吸顶头部踩过的是同一个坑）。
           `z-30`：吸顶后要压在下面的卡片上；el-dialog / el-select 那类是挂到 body 的
           2000+，不受影响。 -->
          <div
            class="sticky top-0 z-30 mb-4 shrink-0 rounded-card border border-line bg-raised px-6 py-4"
          >
            <h2 class="mb-3 text-xl font-bold tracking-tight text-slate-900">
              {{ pageTitle }}
            </h2>
            <!-- 面包屑（组名 › 页面名）：路由化之后「我在哪」不再由一条页签横条
                 独自回答 —— 顶栏这行是给深链接进来的人看的（侧栏高亮只说明在哪个组）。 -->
            <nav aria-label="面包屑" class="mb-3 flex items-center gap-2 text-xs text-slate-500">
              <span>{{ groupLabel }}</span>
              <span aria-hidden="true">›</span>
              <span class="font-medium text-slate-700">{{ pageTitle }}</span>
            </nav>
            <!--
          横向滚动：
          · overflow-x-auto 会让 overflow-y 也算作 auto，补 pb-px 把边兜回来；
          · 隐藏滚动条：滚动靠滚轮/触控板，一条横杠横在卡片下面反而碍眼。
        -->
            <div
              ref="tabNavRef"
              class="flex gap-2 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="页面切换"
              @wheel="handleTabWheel"
            >
              <button
                v-for="tab in groupItems"
                :key="tab.key"
                :data-tab-key="tab.key"
                type="button"
                :aria-current="activeItem?.key === tab.key ? 'page' : undefined"
                class="shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                :class="
                  activeItem?.key === tab.key
                    ? 'border-brand bg-brand font-medium text-white'
                    : 'border-line text-slate-600 hover:border-slate-300 hover:text-slate-800'
                "
                @click="goToPage(tab.path)"
              >
                {{ tab.label }}
              </button>
            </div>
          </div>

          <!--
          主区栏。

          **固定大小**：`flex-1 min-h-0` —— 高度由 flex 分配（列高减导航条），
          **与里面装的是什么无关**：换页签、有没有数据、表格多少行，
          这一块**始终是同一个大小**，不会这里缩一下那里撑一下。
          `min-h-0` 不能省：flex item 默认 `min-height:auto`，不写它就不肯缩到
          内容以下，「固定」立刻失效（内容长的页会把整页顶出滚动条）。
          内容在自己的滚动条里走（`overflow-y-auto`），**页面本身不滚**。

          链条是四级：**纸定高 → 列 flex-col → 导航条 shrink-0
          → 栏 flex-1/min-h-0/overflow-y-auto**，缺一级整条就退化。

          **x-minimalist：与导航条同料、与侧栏分成两料** —— `bg-raised`（纯白）
          + `border-line` + `rounded-card`，与导航条**必须同串**。
          里面那些卡片（各页的 `<section>`）是同一张白面：
          **这块料上，抬起来的一律是白 + 一道发丝线**。
          -->
          <div class="flex-1 min-h-0 overflow-y-auto rounded-card border border-line bg-raised p-4">
            <!-- 页面的挂载点。路由天然「一次只挂一页」：切走的那页会被卸载，
                 不存在「进来过的面板同时显示、叠在一起」这个隐患（改造前要靠
                 v-if 管存在性 + v-show 管可见性两个一起写才防得住）。
                 代价是页面内的本地状态（滚动位置、未保存的行内编辑）会随切页丢失 ——
                 需要跨页保留的筛选条件已经搬到模块作用域的 composable 里
                 （见 composables/useOrderFilter.js 的头注）。 -->
            <router-view />
          </div>
        </div>
      </div>
    </main>
  </el-config-provider>
</template>
