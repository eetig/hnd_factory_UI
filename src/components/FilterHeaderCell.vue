<script setup>
// 带漏斗的筛选表头：已筛选时显示选中值并高亮，可一键清除
defineProps({
  label: { type: String, required: true },
  selected: { type: String, default: '' },
  hint: { type: String, default: '' }, // 用于「点击选择X」提示与无障碍标签
  maxWidthClass: { type: String, default: 'max-w-[110px]' },
})

const emit = defineEmits(['open', 'clear'])
</script>

<template>
  <span class="inline-flex items-center gap-1">
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-xl transition hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      :class="[maxWidthClass, selected ? 'text-sky-600' : '']"
      :title="selected ? `已筛选：${selected}` : `点击选择${hint || label}`"
      @click="emit('open')"
    >
      <span class="truncate">{{ selected || label }}</span>
      <svg
        class="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
    </button>

    <button
      v-if="selected"
      type="button"
      class="rounded-xl px-1 text-slate-400 transition hover:text-rose-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
      :aria-label="`清除${hint || label}筛选`"
      @click="emit('clear')"
    >
      ×
    </button>
  </span>
</template>
