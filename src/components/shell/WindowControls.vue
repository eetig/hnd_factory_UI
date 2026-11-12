<script setup>
/**
 * 窗口控制钮：最小化 / 最大化-还原 / 关闭（2026-11-12 从 TitleBar 拆出来）。
 *
 * 为什么要拆：使用方要求「品牌 + 页签」那一条挪到窗口最上面，并把字号压小 ——
 * 也就是不再有「标题栏 + 导航条」两条横带，只留一条。窗口按钮于是从标题栏里
 * 搬进这一条的最右端，单独成组件，AppShell 里一句话就能摆上。
 *
 * 关闭仍然走 `win.close()`：Rust 侧 on_window_event 会拦下 CloseRequested
 * 并发 `app://close-requested`，所以「最小化到托盘 / 退出」的用户设置在桌面版里照旧生效。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const win = ref(null)
const maximized = ref(false)
let unlisten = null

onMounted(async () => {
  try {
    const api = await import('@tauri-apps/api/window')
    win.value = api.getCurrentWindow()
    maximized.value = await win.value.isMaximized()
    unlisten = await win.value.onResized(async () => {
      maximized.value = await win.value.isMaximized()
    })
  } catch {
    // 网页版没有窗口 API：AppShell 用 IS_DESKTOP 挡掉整个组件，这里只是兜底
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
  <!-- 双击窗口按钮不该触发「最大化」以外的窗口行为，所以整块 stop 掉 -->
  <div class="window-controls flex shrink-0 items-center" @dblclick.stop>
    <button type="button" class="window-btn" aria-label="最小化" title="最小化" @click="minimize">
      <svg viewBox="0 0 10 10" class="h-2.5 w-2.5" aria-hidden="true">
        <path d="M1 5h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      </svg>
    </button>
    <button
      type="button"
      class="window-btn"
      :aria-label="maximized ? '向下还原' : '最大化'"
      :title="maximized ? '向下还原' : '最大化'"
      @click="toggleMaximize"
    >
      <svg v-if="!maximized" viewBox="0 0 10 10" class="h-2.5 w-2.5" aria-hidden="true">
        <rect
          x="1.4"
          y="1.4"
          width="7.2"
          height="7.2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.1"
        />
      </svg>
      <svg v-else viewBox="0 0 10 10" class="h-2.5 w-2.5" aria-hidden="true">
        <rect
          x="1.2"
          y="3"
          width="5.8"
          height="5.8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.1"
        />
        <path d="M3.2 3V1.4h5.4v5.4H7" fill="none" stroke="currentColor" stroke-width="1.1" />
      </svg>
    </button>
    <button
      type="button"
      class="window-btn window-btn-close"
      aria-label="关闭"
      title="关闭"
      @click="close"
    >
      <svg viewBox="0 0 10 10" class="h-2.5 w-2.5" aria-hidden="true">
        <path d="M1.6 1.6l6.8 6.8M8.4 1.6l-6.8 6.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.window-btn {
  display: inline-flex;
  height: 26px;
  width: 38px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--color-slate-700, #334155);
  transition: background-color 120ms ease, color 120ms ease;
}
.window-btn:hover {
  background-color: color-mix(in srgb, var(--color-brand) 10%, transparent);
}
.window-btn-close:hover {
  background-color: #e5484d;
  color: #fff;
}
</style>
