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
 *
 * ⚠️ 2026-11-21：`close()` 需要 capabilities 里的 `core:window:allow-close`
 * （capabilities/default.json）。1.0.43 及以前漏了这条，IPC 被 ACL 拒，
 * 又被下面的空 catch 吞掉 —— 表现就是"点 ✕ 完全没反应"，一按就是十天。
 * 所以这里执行失败必须喊出来，不许再静默。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

defineProps({
  /**
   * 色调档位（2026-11-23，登录页补窗口钮时加）。
   *
   *   default —— 工作台顶栏那条白底横带里的按钮，跟着栏里的墨色（slate-700）；
   *   muted   —— **浮在纸面上**的那一组（登录 / 注册 / 404）。纸面更亮，又没有
   *              横带把它们框住，同一档墨色看上去像三个洞；压一档到 slate-500
   *              （白底 4.76:1，仍过 AA），hover 再回到墨色 —— 这就是使用方要的
   *              「常显但低对比」。
   */
  tone: { type: String, default: 'default' },
})

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
  if (!win.value) {
    // 没拿到窗口句柄（初始化失败 / 跑在网页版里）也要说话，不能装作点了
    ElMessage.error('当前环境没有窗口控制权限，关不掉')
    return
  }
  try {
    await win.value.close()
  } catch (e) {
    // 1.0.44 之前这里是空 catch：权限缺失 → IPC 被拒 → 界面毫无反应
    ElMessage.error(`关不掉窗口：${e?.message || e}`)
  }
}
</script>

<template>
  <!-- 双击窗口按钮不该触发「最大化」以外的窗口行为，所以整块 stop 掉 -->
  <div
    class="window-controls flex shrink-0 items-center"
    :class="{ 'window-controls--muted': tone === 'muted' }"
    @dblclick.stop
  >
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
/*
 * hover 的淡底（2026-11-23 修）：原来写的是
 * `color-mix(in srgb, var(--color-brand) 10%, transparent)` —— 但 `--color-brand`
 * 这个自定义属性**全项目都没有定义**（品牌色只存在 tailwind.config 和 EP 的
 * `--el-color-primary` 里），所以整条声明是无效值，背景一直是透明的：三颗钮里
 * 只有 ✕ 有 hover 反馈。改成 slate-900 带 fallback，网页版/桌面版都能落地。
 */
.window-btn:hover {
  background-color: color-mix(in srgb, var(--color-slate-900, #0f172a) 8%, transparent);
}
/*
 * 浮在纸面上的那一组（tone="muted"）：默认压一档到 slate-500，
 * hover 才回到墨色。工作台顶栏里的那一组不受影响。
 */
.window-controls--muted .window-btn {
  color: var(--color-slate-500, #64748b);
}
.window-controls--muted .window-btn:hover {
  color: var(--color-slate-900, #0f172a);
}
/*
 * 键盘可达：这三颗钮在登录页是 Tab 序里的第一站，必须看得见焦点。
 * 用 inset 环而不是外扩 —— 贴边摆放时外扩会被窗口边缘切掉。
 */
.window-btn:focus-visible {
  outline: 2px solid var(--color-slate-900, #0f172a);
  outline-offset: -2px;
}
.window-btn-close:hover {
  background-color: #e5484d;
  color: #fff;
}
/*
 * ✕ 的 hover 必须写回来：上面那条 `--muted .window-btn:hover` 的选择器比
 * `.window-btn-close:hover` 多一级，不补这一条，浮在纸面上的 ✕ 会变成
 * 「红底 + 墨色叉」。
 */
.window-controls--muted .window-btn-close:hover {
  color: #fff;
}
</style>
