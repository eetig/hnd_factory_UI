<script setup>
/**
 * 自绘标题栏（2026-11-11）。
 *
 * 为什么自绘：`decorations: false` 之后 Windows 不再画标题栏，拖拽、最小化、最大化、
 * 关闭这四件事得自己接上。拖拽用 Tauri 的 `data-tauri-drag-region`（由系统处理
 * 拖动，不是 JS 跟鼠标），因此拖动时窗口跟随不抖。
 *
 * 关闭按钮故意走 `win.close()`：Rust 侧 `on_window_event` 会拦下 CloseRequested
 * 并发 `app://close-requested`，也就是仍然按用户设置"最小化到托盘 / 退出"。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({
  /** 抽屉是否打开：只用来给汉堡按钮一个 aria-expanded 状态 */
  drawerOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['open-nav'])

const win = ref(null)
const maximized = ref(false)
let unlisten = null

function bindWindow(api) {
  win.value = api.getCurrentWindow()
}

onMounted(async () => {
  try {
    const api = await import('@tauri-apps/api/window')
    bindWindow(api)
    maximized.value = await win.value.isMaximized()
    unlisten = await win.value.onResized(async () => {
      maximized.value = await win.value.isMaximized()
    })
  } catch {
    // 网页版没有窗口 API：组件本身由 AppShell 用 IS_DESKTOP 挡掉，这里只是兜底
  }
})

onBeforeUnmount(() => {
  if (typeof unlisten === 'function') unlisten()
})

async function minimize() {
  try {
    await win.value?.minimize()
  } catch {
    /* 窗口已经没了 */
  }
}

async function toggleMaximize() {
  try {
    await win.value?.toggleMaximize()
    maximized.value = await win.value.isMaximized()
  } catch {
    /* 同上 */
  }
}

async function close() {
  try {
    await win.value?.close()
  } catch {
    /* 同上 */
  }
}
</script>

<template>
  <header
    class="titlebar flex h-8 shrink-0 select-none items-center gap-2 pl-2 pr-1"
    data-tauri-drag-region
    @dblclick.self="toggleMaximize"
  >
    <!--
      导航入口（2026-11-12 使用方口径，图标随后指定）：窗口左上角第一个可点元素。
      图形是「侧栏开关」——一个圆角方框 + 左侧竖线，比汉堡三条线更像「打开/收起侧栏」；
      悬停给提示（data-tip + ::after 自绘），点开是左侧抽屉。
      注意不能带 data-tauri-drag-region，否则点击会被拖拽区吃掉；双击也要 stop。
    -->
    <button
      type="button"
      class="titlebar-btn titlebar-btn-nav"
      :aria-expanded="drawerOpen ? 'true' : 'false'"
      aria-controls="app-drawer"
      aria-label="菜单：打开导航"
      data-tip="打开导航　Ctrl+B"
      @click.stop="emit('open-nav')"
      @dblclick.stop
    >
      <svg viewBox="0 0 24 24" class="h-[16px] w-[16px]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <path d="M9 4v16" />
      </svg>
    </button>

    <!--
      标题栏只留两样东西：左边「侧栏开关」，右边窗口控制钮。
      2026-11-12 使用方：「文字重复了，而且臃肿，多少无效信息，要简洁明了」——
      应用名和「工单 · 物料 · 采购 · 设备」在这一条里都是重复的（下面导航条已经写着），
      删掉之后这一条就退成一条纯粹的拖动带。
    -->
    <div class="ml-auto flex items-center" data-tauri-drag-region>
      <div class="flex items-center" @dblclick.stop>
        <button
          type="button"
          class="titlebar-btn"
          aria-label="最小化"
          title="最小化"
          @click="minimize"
        >
          <svg viewBox="0 0 10 10" class="h-2.5 w-2.5" aria-hidden="true">
            <path d="M1 5h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
        <button
          type="button"
          class="titlebar-btn"
          :aria-label="maximized ? '向下还原' : '最大化'"
          :title="maximized ? '向下还原' : '最大化'"
          @click="toggleMaximize"
        >
          <svg v-if="!maximized" viewBox="0 0 10 10" class="h-2.5 w-2.5" aria-hidden="true">
            <rect x="1.4" y="1.4" width="7.2" height="7.2" fill="none" stroke="currentColor" stroke-width="1.1" />
          </svg>
          <svg v-else viewBox="0 0 10 10" class="h-2.5 w-2.5" aria-hidden="true">
            <rect x="1.2" y="3" width="5.8" height="5.8" fill="none" stroke="currentColor" stroke-width="1.1" />
            <path d="M3.2 3V1.4h5.4v5.4H7" fill="none" stroke="currentColor" stroke-width="1.1" />
          </svg>
        </button>
        <button
          type="button"
          class="titlebar-btn titlebar-btn-close"
          aria-label="关闭"
          title="关闭"
          @click="close"
        >
          <svg viewBox="0 0 10 10" class="h-2.5 w-2.5" aria-hidden="true">
            <path d="M1.6 1.6l6.8 6.8M8.4 1.6l-6.8 6.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  background-color: color-mix(in srgb, var(--color-veil) 72%, transparent);
}
.titlebar-btn {
  display: inline-flex;
  height: 28px;
  width: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--color-slate-700, #334155);
  transition: background-color 120ms ease, color 120ms ease;
}
/* 菜单入口：方形图标按钮（跟窗口控制钮同一档大小，但只有 28px，轻一档） */
.titlebar-btn-nav {
  position: relative;
  width: 28px;
  height: 24px;
  margin-left: 1px;
  padding: 0;
  border-radius: 4px;
  color: var(--color-slate-600, #475569);
}
.titlebar-btn-nav:hover {
  background-color: color-mix(in srgb, var(--color-slate-900, #0f172a) 6%, transparent);
  color: var(--color-slate-900, #0f172a);
}
/*
 * hover 提示：自己做一层，不用系统 title（系统提示要等 1 秒、样式也不跟主题走）。
 * 定位在按钮正下方 6px，深色底 + 白字，跟「收起侧边栏 Ctrl+B」那种提示同一种观感。
 */
.titlebar-btn-nav::after {
  content: attr(data-tip);
  position: absolute;
  left: -2px;
  top: calc(100% + 6px);
  padding: 4px 8px;
  border-radius: 6px;
  background-color: rgba(15, 23, 42, 0.92);
  color: #fff;
  font-size: 11px;
  line-height: 1.35;
  letter-spacing: 0.02em;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 120ms ease, transform 120ms ease;
  pointer-events: none;
  z-index: 40;
}
.titlebar-btn-nav:hover::after,
.titlebar-btn-nav:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}
.titlebar-btn:hover {
  background-color: color-mix(in srgb, var(--color-brand) 10%, transparent);
}
.titlebar-btn:focus-visible {
  outline: 2px solid var(--color-brand-ink);
  outline-offset: 1px;
}
.titlebar-btn-close:hover {
  background-color: #c8362f;
  color: #fff;
}
</style>
