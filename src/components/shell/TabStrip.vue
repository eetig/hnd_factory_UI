<script setup>
import { ref } from 'vue'
import { GROUP_ICON_PATHS } from '../../nav'

/*
 * 全局页签条（2026-11-11）：打开过的页面排一行，可切、可关。
 *
 * 与旧的「组内页签」是两种东西：那排只在同一个模块里换表，这排跨模块。
 * 之所以两条都留：模块内的表切换很频繁（工单 / 领料 / 入库），
 * 全塞进全局页签会把十二条挤成一行小字。
 */
defineProps({
  tabs: { type: Array, default: () => [] },
  activeKey: { type: String, default: '' },
  collapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'close', 'expand', 'palette'])

const navRef = ref(null)

/**
 * 鼠标滚轮 → 页签条左右滚动（沿用变更-105 的行为）。
 *
 * 只在「这个方向确实还有内容」时才拦截，滚到头就放行给页面 ——
 * 否则指针停在页签条上时整页都滚不动，用户会以为页面卡住了。
 */
function handleWheel(event) {
  const nav = navRef.value
  if (!nav) return
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

  const maxScroll = nav.scrollWidth - nav.clientWidth
  if (maxScroll <= 0) return

  const atStart = nav.scrollLeft <= 0 && event.deltaY < 0
  const atEnd = nav.scrollLeft >= maxScroll && event.deltaY > 0
  if (atStart || atEnd) return

  event.preventDefault()
  nav.scrollLeft = Math.max(0, Math.min(maxScroll, nav.scrollLeft + event.deltaY))
}
</script>

<template>
  <div class="flex h-11 shrink-0 items-center gap-2 px-2">
    <button
      v-if="collapsed"
      type="button"
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-region hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
      aria-label="展开页面列表"
      @click="emit('expand')"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>

    <div
      ref="navRef"
      class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="已打开的页面"
      @wheel="handleWheel"
    >
      <div
        v-for="tab in tabs"
        :key="tab.key"
        class="group flex shrink-0 items-center rounded-md border transition"
        :class="
          activeKey === tab.key
            ? 'border-white/70 bg-white/80 text-slate-900 shadow-[0_1px_2px_rgba(16,24,40,0.05)]'
            : 'border-transparent text-slate-500 hover:bg-white/45 hover:text-slate-800'
        "
      >
        <button
          type="button"
          role="tab"
          :data-tab-key="tab.key"
          :aria-selected="activeKey === tab.key ? 'true' : 'false'"
          :aria-current="activeKey === tab.key ? 'page' : undefined"
          class="flex shrink-0 items-center gap-1.5 whitespace-nowrap py-1.5 pl-2 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
          :class="[activeKey === tab.key ? 'pr-1 font-medium' : 'pr-2.5']"
          @click="emit('select', tab.key)"
        >
          <!--
            页签前的模块图标（2026-11-11）：跨模块切换时，光看页面名分不清
            「领料汇总」属于工单还是采购 —— 图标给的是组，和左栏同一套图形。
          -->
          <svg
            v-if="GROUP_ICON_PATHS[tab.group]"
            class="h-3.5 w-3.5 shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path :d="GROUP_ICON_PATHS[tab.group]" />
          </svg>
          {{ tab.label }}
        </button>
        <button
          v-if="activeKey === tab.key || tabs.length > 1"
          type="button"
          class="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 opacity-0 transition hover:bg-slate-900/10 hover:text-slate-900 focus:opacity-100 focus:outline-none group-hover:opacity-100"
          :class="activeKey === tab.key ? 'opacity-100' : ''"
          :aria-label="`关闭 ${tab.label}`"
          @click.stop="emit('close', tab.key)"
        >
          <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <span v-if="!tabs.length" class="px-1 text-[13px] text-slate-500">还没有打开的页面</span>
    </div>

    <button
      type="button"
      class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-slate-600 transition hover:bg-region hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
      aria-label="搜索并打开页面（Ctrl+K）"
      @click="emit('palette')"
    >
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <span class="hidden sm:inline">Ctrl K</span>
    </button>

    <div class="flex shrink-0 items-center gap-1 pl-1">
      <slot name="actions" />
    </div>
  </div>
</template>
