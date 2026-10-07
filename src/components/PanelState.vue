<script setup>
// 面板内的空状态 / 错误状态占位
defineProps({
  type: { type: String, default: 'empty' }, // 'empty' | 'error'
  title: { type: String, required: true },
  description: { type: String, default: '' },
  actionText: { type: String, default: '' },
})

const emit = defineEmits(['action'])
</script>

<template>
  <div class="flex min-h-72 flex-col items-center justify-center px-6 text-center">
    <div
      class="mb-4 flex h-12 w-12 items-center justify-center rounded-full"
      :class="type === 'error' ? 'bg-rose-50 text-rose-500' : 'bg-sky-50 text-sky-600'"
    >
      {{ type === 'error' ? '!' : '∅' }}
    </div>

    <h2 class="text-base font-semibold text-slate-900">{{ title }}</h2>
    <p v-if="description" class="mt-2 text-sm text-slate-500">{{ description }}</p>

    <button
      v-if="actionText"
      type="button"
      class="mt-5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
      @click="emit('action')"
    >
      {{ actionText }}
    </button>
  </div>
</template>
