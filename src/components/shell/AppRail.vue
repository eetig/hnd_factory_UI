<script setup>
import { GROUP_ICON_PATHS } from '../../nav'

/*
 * 最左那条窄栏（2026-11-11，照 DSH 客户端）。
 *
 * 只放「你在哪个模块」：品牌标 + 六个模块图标 + 底部（配色 / 桌面版 / 账号）。
 * 模块里的页面不在这里 —— 那是右边第二列的事。
 */
defineProps({
  groups: { type: Array, default: () => [] },
  currentGroup: { type: String, default: '' },
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['select'])
</script>

<template>
  <div
    class="flex shrink-0 flex-col items-center border-r border-line bg-veil py-3"
    :class="compact ? 'w-[88px]' : 'w-[76px]'"
    role="group"
    aria-label="模块"
  >
    <!-- 品牌标：一个墨块，不做 logo 图片（零资源、深浅底都清楚） -->
    <div
      class="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-[15px] font-bold text-on-brand"
      aria-hidden="true"
    >
      H
    </div>

    <nav class="flex flex-1 flex-col items-center gap-1" aria-label="功能分类">
      <button
        v-for="group in groups"
        :key="group.key"
        type="button"
        :data-group="group.key"
        class="nav-group-btn flex h-11 w-11 items-center justify-center rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink active:scale-[0.97]"
        :class="
          currentGroup === group.key
            ? 'bg-white/85 text-accent-ink ring-1 ring-accent-ink/10'
            : 'text-slate-600 hover:bg-white/55 hover:text-slate-900'
        "
        :title="`${group.label} · ${group.hint}`"
        :aria-label="group.label"
        :aria-current="currentGroup === group.key ? 'true' : undefined"
        @click="emit('select', group.key)"
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
      </button>
    </nav>

    <div class="mt-3 flex flex-col items-center gap-1">
      <slot name="bottom" />
    </div>
  </div>
</template>

<style scoped>
/* 悬停时图标按语义微动（沿用 变更-104 的六条位移，只是从整行搬到了图标条） */
.nav-group-btn svg {
  transform-origin: 50% 50%;
  transition: transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
}
.nav-group-btn[data-group='stats'] svg {
  transform-origin: 50% 100%;
}
.nav-group-btn:hover svg,
.nav-group-btn:focus-visible svg {
  transform: var(--nav-icon-motion, none);
}
.nav-group-btn[data-group='order'] {
  --nav-icon-motion: translateY(-2px) rotate(-8deg);
}
.nav-group-btn[data-group='materials'] {
  --nav-icon-motion: translateY(-3px);
}
.nav-group-btn[data-group='purchase'] {
  --nav-icon-motion: translateX(4px);
}
.nav-group-btn[data-group='equipment'] {
  --nav-icon-motion: rotate(-20deg);
}
.nav-group-btn[data-group='stats'] {
  --nav-icon-motion: scaleY(1.2);
}
.nav-group-btn[data-group='maintain'] {
  --nav-icon-motion: scale(1.08);
}
.nav-group-btn[aria-current='true'] svg {
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .nav-group-btn svg {
    transition: none;
  }
  .nav-group-btn:hover svg,
  .nav-group-btn:focus-visible svg {
    transform: none;
  }
}
</style>
