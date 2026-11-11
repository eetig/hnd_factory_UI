<script setup>
import { computed, nextTick, ref, watch } from 'vue'

/*
 * 命令面板（2026-11-11，照 DSH 客户端）：Ctrl/⌘+K 打开，输入即筛，回车跳转。
 *
 * 为什么值得做：导航是「两级 + 一列清单」，找一个只记得一半名字的页面
 * （「那个…储罐液位」）要点三次；这里是按名字搜，一次到位。
 */
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'pick'])

const keyword = ref('')
const cursor = ref(0)
const inputRef = ref(null)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.items.slice(0, 8)
  return props.items
    .filter((item) =>
      `${item.label} ${item.groupLabel} ${item.path}`.toLowerCase().includes(kw),
    )
    .slice(0, 8)
})

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      keyword.value = ''
      cursor.value = 0
      return
    }
    await nextTick()
    inputRef.value?.focus()
  },
)

watch(keyword, () => {
  cursor.value = 0
})

function close() {
  emit('update:modelValue', false)
}

function pick(item) {
  if (!item) return
  emit('pick', item)
  close()
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (!filtered.value.length) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    cursor.value = (cursor.value + 1) % filtered.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    cursor.value = (cursor.value - 1 + filtered.value.length) % filtered.value.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    pick(filtered.value[cursor.value])
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-[3000] flex items-start justify-center bg-slate-900/25 px-4 pt-[14vh]"
      role="dialog"
      aria-modal="true"
      aria-label="搜索页面"
      @click.self="close"
    >
      <div class="w-full max-w-[520px] overflow-hidden rounded-card border border-line bg-raised shadow-card">
        <div class="flex items-center gap-2 border-b border-line px-3">
          <svg class="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref="inputRef"
            v-model="keyword"
            type="text"
            class="h-11 w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-500"
            placeholder="搜索页面，回车打开"
            aria-label="搜索页面"
            @keydown="onKeydown"
          />
          <kbd class="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-slate-500">Esc</kbd>
        </div>

        <ul v-if="filtered.length" class="max-h-[320px] overflow-y-auto p-1.5" role="listbox">
          <li v-for="(item, index) in filtered" :key="item.key">
            <button
              type="button"
              role="option"
              :aria-selected="index === cursor ? 'true' : 'false'"
              class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition"
              :class="index === cursor ? 'bg-region text-slate-900' : 'text-slate-700'"
              @mouseenter="cursor = index"
              @click="pick(item)"
            >
              <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              <span class="shrink-0 text-[11px] text-slate-500">{{ item.groupLabel }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="px-4 py-6 text-center text-sm text-slate-500">没有匹配的页面</p>
      </div>
    </div>
  </Teleport>
</template>
