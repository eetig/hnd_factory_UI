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
    class="titlebar flex h-9 shrink-0 select-none items-center gap-2 pl-2 pr-1"
    data-tauri-drag-region
    @dblclick.self="toggleMaximize"
  >
    <!--
      导航入口（2026-11-12 使用方口径）：「汉堡放在左上角」——
      就放在窗口最左上角这一格，是整屏第一个可点的东西。
      注意不能带 data-tauri-drag-region，否则点击会被拖拽区吃掉；双击也要 stop。
    -->
    <button
      type="button"
      class="titlebar-btn titlebar-btn-nav"
      :aria-expanded="drawerOpen ? 'true' : 'false'"
      aria-controls="app-drawer"
      aria-label="打开导航"
      @click.stop="emit('open-nav')"
      @dblclick.stop
    >
      <svg viewBox="0 0 24 24" class="h-[15px] w-[15px]" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>

    <span
      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-brand text-[11px] font-bold text-white"
      data-tauri-drag-region
    >
      H
    </span>
    <span class="text-[12px] font-medium tracking-tight text-slate-700" data-tauri-drag-region>
      HND 生产助手
    </span>
    <span class="ml-2 truncate text-[11px] text-slate-500" data-tauri-drag-region>
      工单 · 物料 · 采购 · 设备
    </span>

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
/* 汉堡按钮比窗口控制钮瘦一点：它是「入口」，不是「操作」，不该跟最小化/关闭一样重 */
.titlebar-btn-nav {
  width: 26px;
  margin-left: 2px;
  border-radius: 4px;
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
