<script setup>
import { computed, ref } from 'vue'
import { ElCheckbox, ElPopover } from 'element-plus'
import { ALL_COLUMNS, DEFAULT_VISIBLE_KEYS, useEquipmentColumns } from './useEquipmentColumns.js'

/**
 * 「列」按钮 + 勾选面板（2026-10-18，变更-118），与采购页同一形态。
 *
 * icon-only 按钮必须有 `aria-label`：屏幕阅读器读不到图标，
 * 只会读到一个没有任何文字的按钮（Web Interface Guidelines 的零容忍项）。
 */
const { isVisible, toggle, resetToDefault } = useEquipmentColumns()

const open = ref(false)

const visibleCount = computed(() => ALL_COLUMNS.filter((c) => isVisible(c.key)).length)

const isDefault = computed(() => {
  const now = ALL_COLUMNS.filter((c) => isVisible(c.key))
    .map((c) => c.key)
    .sort()
    .join(',')
  return now === [...DEFAULT_VISIBLE_KEYS].sort().join(',')
})
</script>

<template>
  <el-popover
    v-model:visible="open"
    placement="bottom-end"
    :width="248"
    trigger="click"
    popper-class="equipment-column-popover"
  >
    <template #reference>
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
        aria-label="列配置：选择这张表显示哪些列"
        :aria-expanded="open"
        title="选择显示哪些列"
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        {{ visibleCount }}
      </button>
    </template>

    <div class="space-y-1">
      <p class="px-1 pb-1 text-xs font-medium text-slate-500">显示的列</p>
      <label
        v-for="col in ALL_COLUMNS"
        :key="col.key"
        class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-slate-700 hover:bg-region"
      >
        <el-checkbox
          :model-value="isVisible(col.key)"
          :aria-label="`显示「${col.label}」列`"
          @change="toggle(col.key)"
        />
        <span class="truncate">{{ col.label }}</span>
      </label>
      <div class="flex items-center justify-between border-t border-line px-1 pt-2">
        <button
          type="button"
          class="rounded px-1 text-xs text-slate-500 transition-colors hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none disabled:text-slate-500"
          :disabled="isDefault"
          @click="resetToDefault"
        >
          恢复默认 8 列
        </button>
        <button
          type="button"
          class="rounded px-2 py-0.5 text-xs font-medium text-brand-ink transition-colors hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
          @click="open = false"
        >
          完成
        </button>
      </div>
    </div>
  </el-popover>
</template>
