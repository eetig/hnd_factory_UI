<script setup>
import { computed, ref } from 'vue'
import { ElCheckbox, ElPopover } from 'element-plus'
import { ALL_COLUMNS, DEFAULT_VISIBLE_KEYS, usePurchaseColumns } from './usePurchaseColumns.js'

/**
 * 「列」按钮 + 勾选面板（2026-10-18，变更-117）。
 *
 * 交互选择：**icon-only 按钮 + 点开 popover**，不是"表格头右键菜单"——
 * 右键在网页里没有可见入口，使用方不会去试。
 *
 * ⚠️ icon-only 按钮必须有 `aria-label`（Web Interface Guidelines 的硬规则，
 * 也是本仓 `web-design-guidelines` 审查里唯一一类"零容忍"的问题）：屏幕阅读器
 * 读不到图标，只读得到一个没有任何文字的按钮。
 */
const { isVisible, toggle, resetToDefault } = usePurchaseColumns()

const open = ref(false)

const visibleCount = computed(() => ALL_COLUMNS.filter((c) => isVisible(c.key)).length)

/** 可一键回到"默认 8 列"——用户把列勾乱之后，不该靠记忆还原 */
const isDefault = computed(() => {
  const now = ALL_COLUMNS.filter((c) => isVisible(c.key)).map((c) => c.key).sort().join(',')
  return now === [...DEFAULT_VISIBLE_KEYS].sort().join(',')
})

function onReset() {
  resetToDefault()
}
</script>

<template>
  <el-popover
    v-model:visible="open"
    placement="bottom-end"
    :width="240"
    trigger="click"
    popper-class="purchase-column-popover"
  >
    <template #reference>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
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
          @click="onReset"
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
