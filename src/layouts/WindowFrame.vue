<script setup>
/**
 * 壳外的「窗口框」（2026-11-23 新增）。
 *
 * 起因：`decorations: false` 之后，窗口**只有** AppShell 顶栏那一条能拖、
 * 也只有那一条上有最小化/最大化/关闭。壳外的整页（登录 / 注册 / 404 /
 * 落地页 / 下载页）没有那条顶栏 —— 登录页于是既拖不动也关不掉，
 * 只能去任务栏右键。
 *
 * 这里只做两件事，判据与 AppShell 里那两段**完全同一套**：
 *   · 按住非控件区 → `startDragging()`（用 closest 把按钮/链接/输入框/页签排除掉，
 *     点这些照常触发点击）；
 *   · 空白处双击 → `toggleMaximize()`，跟 Windows 标题栏的习惯一致。
 *
 * 按钮本身复用 `WindowControls`：✕ 仍走 `win.close()`，Rust 侧照样拦
 * CloseRequested，所以「最小化到托盘 / 退出」的用户设置在这些页面上也一致，
 * 不会出现「进了登录页，✕ 就变成直接退出」这种双份语义。
 *
 * 为什么包一层 div，而不是给每页各安一份：可拖的区域必须是**整页**——
 * 登录页真正空着的地方是纸面四周，逐页绑等于把同一段 closest 判据抄五遍。
 * 代价只是一层不带样式的 div。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import WindowControls from '../components/shell/WindowControls.vue'
import { IS_TAURI } from '../api/base'

/*
 * 与 AppShell.vue:176 同一条串。两边不许漂：这里放宽了，登录页上点按钮就会
 * 变成拖窗口；那边放宽了，顶栏上的页签同理。
 */
const NO_DRAG_SELECTOR =
  'button, a, input, select, textarea, [role="tab"], [role="button"], [data-no-drag]'

const route = useRoute()

/** 工作台（壳）自带顶栏与窗口钮，这里一律不插手 —— 见 router 里 `meta.shell` */
const isBare = computed(() => !route.matched.some((record) => record.meta?.shell))

/**
 * 落地页 / 下载页自己有一条顶栏，按钮**放进那条栏**比浮在角上更像那么回事：
 * 它们右上角原本就有内容（落地页是「进入工作台」那颗药丸），浮上去会压住它。
 * 路由里声明 `meta.windowChrome: 'inline'` 的页面由页面自己摆，这里只管其余的。
 */
const floatingChrome = computed(() => isBare.value && route.meta?.windowChrome !== 'inline')

async function beginDrag(event) {
  if (!IS_TAURI || !isBare.value || event.button !== 0) return
  if (event.target?.closest?.(NO_DRAG_SELECTOR)) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().startDragging()
  } catch {
    /* 网页版，或窗口已经没了 */
  }
}

async function onDoubleClick(event) {
  if (!IS_TAURI || !isBare.value) return
  if (event.target?.closest?.(NO_DRAG_SELECTOR)) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().toggleMaximize()
  } catch {
    /* 同上 */
  }
}
</script>

<template>
  <div @mousedown="beginDrag" @dblclick="onDoubleClick">
    <slot />

    <!--
      浮在纸面右上角。位置是按登录/注册/404 那三页量的：它们都是
      `main.p-4` 里一张铺满的纸（16px 的 desk 边 + 1px 发丝线 + 20px 圆角），
      纸的右上角本来就空着（内容是居中一列）。

      为什么是 28px 而不是 8px：这 16px 的 desk 边算进窗口之后，`right-4`
      正好落在**纸的上沿那条线上** —— 26px 高的一组会横跨发丝线，✕ 还会戳到
      圆角外头（第一版截图就是这样，看着像没对齐）。28px = 纸内缩 12px，
      整组落在圆角里侧，不再压线。
      z-[70]：桌面端这些页面里最高的常驻层是落地页的 sticky 头（z-40）；
      Element Plus 的弹层走 2000+，仍然盖得住它。
    -->
    <div
      v-if="IS_TAURI && floatingChrome"
      class="fixed right-7 top-7 z-[70] flex items-center"
    >
      <WindowControls tone="muted" />
    </div>
  </div>
</template>
