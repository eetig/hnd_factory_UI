<script setup>
import { computed, ref, watch } from 'vue'
import { ElDialog, ElInput } from 'element-plus'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  options: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
  label: { type: String, default: '产成品' },
})

const emit = defineEmits(['update:modelValue', 'select'])

const keyword = ref('')

const filteredOptions = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return props.options
  return props.options.filter((item) => item.toLowerCase().includes(query))
})

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) keyword.value = ''
  },
)

function close() {
  emit('update:modelValue', false)
}

function handleSelect(item) {
  emit('select', item)
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="480px"
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <span class="text-base font-semibold text-slate-900">选择{{ label }}</span>
    </template>

    <el-input
      v-model="keyword"
      :placeholder="`输入关键词搜索${label}`"
      clearable
      autofocus
    />

    <div class="mt-4 max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
      <button
        v-for="item in filteredOptions"
        :key="item"
        type="button"
        class="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left text-sm transition last:border-b-0"
        :class="
          item === selected
            ? 'bg-sky-50 font-medium text-sky-700'
            : 'text-slate-700 hover:bg-slate-50'
        "
        @click="handleSelect(item)"
      >
        <span class="break-words">{{ item }}</span>
        <span v-if="item === selected" class="shrink-0 text-xs text-sky-600">当前</span>
      </button>

      <p v-if="!filteredOptions.length" class="px-4 py-10 text-center text-sm text-slate-400">
        没有匹配的{{ label }}
      </p>
    </div>
  </el-dialog>
</template>
