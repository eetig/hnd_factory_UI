<script setup>
import { navItemState } from '../../nav'

/*
 * 第二列（2026-11-11）：品牌 + 当前模块的页面清单 + 底部账号。
 *
 * 与旧侧栏的差别：旧的是「六个模块各自可展开」，一次只展开当前组，组与组之间还会
 * 把高度撑来撑去；这里模块由最左那条图标栏选，本列**只负责一屏清单**，高度恒定。
 *
 * 收起态：本列宽度由外层 aside 收窄，这里只把文字藏掉（图标栏还在）——
 * 收起是「把宽度让回给表格」，不是把导航整个收走。
 */
defineProps({
  group: { type: Object, default: null },
  items: { type: Array, default: () => [] },
  currentPath: { type: String, default: '' },
  collapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['navigate', 'lock', 'collapse'])
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col" role="group" aria-label="页面">
    <div class="flex items-start justify-between gap-2 px-4 pb-3 pt-4">
      <div class="min-w-0">
        <p v-show="!collapsed" class="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
          Factory Ops
        </p>
        <p v-show="!collapsed" class="mt-1 text-lg font-semibold tracking-tight text-slate-800">HND生产助手</p>
        <p v-show="!collapsed" class="mt-0.5 truncate text-xs text-slate-500">工单与物料查询助手</p>
      </div>
      <button
        type="button"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-region hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
        aria-controls="app-sidebar"
        :aria-expanded="collapsed ? 'false' : 'true'"
        :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
        @click="emit('collapse')"
      >
        <svg
          class="h-4 w-4 transition-transform"
          :class="collapsed ? 'rotate-180' : ''"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
    </div>

    <div v-show="!collapsed" class="flex min-h-0 flex-1 flex-col px-3 pt-2">
      <div v-if="group" class="px-1">
        <p class="text-[12px] font-medium uppercase tracking-[0.12em] text-slate-500">{{ group.label }}</p>
        <p v-if="group.hint" class="mt-0.5 text-[11px] text-slate-600">{{ group.hint }}</p>
      </div>

      <nav class="mt-2 min-h-0 flex-1 overflow-y-auto pb-2" :aria-label="`${group?.label || ''}下的页面`">
        <ul class="space-y-0.5">
          <li v-for="page in items" :key="page.key">
            <button
              v-if="navItemState(page) === 'locked'"
              type="button"
              class="block w-full rounded-lg px-2.5 py-2 text-left text-sm text-slate-500 opacity-70 transition hover:bg-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              aria-disabled="true"
              :aria-label="`${page.label}（需注册后可用）`"
              @click="emit('lock', page)"
            >
              {{ page.label }}
            </button>
            <button
              v-else
              type="button"
              class="relative block w-full rounded-lg px-2.5 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
              :class="
                currentPath === page.path
                  ? 'bg-white/80 font-medium text-slate-900 shadow-[0_1px_2px_rgba(16,24,40,0.05)]'
                  : 'text-slate-600 hover:bg-white/45 hover:text-slate-900'
              "
              :aria-current="currentPath === page.path ? 'page' : undefined"
              @click="emit('navigate', page.path)"
            >
              {{ page.label }}
            </button>
          </li>
        </ul>
      </nav>
    </div>

    <div v-show="!collapsed" class="mt-1 px-1 pb-1 pt-2">
      <slot name="footer" />
    </div>
  </div>
</template>
