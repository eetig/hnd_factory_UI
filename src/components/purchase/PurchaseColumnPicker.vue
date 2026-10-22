<script setup>
import { computed, ref } from 'vue'
import { ElCheckbox, ElPopover } from 'element-plus'
import {
  ALL_COLUMNS,
  DEFAULT_VISIBLE_KEYS,
  PINNED_COLUMN_KEYS,
  usePurchaseColumns,
} from './usePurchaseColumns.js'

/**
 * 「列」按钮 + 勾选/排序面板（2026-10-18 变更-117 起；2026-10-22 变更-142 加排序）。
 *
 * 交互选择：**icon-only 按钮 + 点开 popover**，不是"表格头右键菜单"——
 * 右键在网页里没有可见入口，使用方不会去试。
 *
 * 排序两种方式都给（使用方 2026-10-22 确认"全按推荐"，推荐的是拖拽）：
 *   · 拖左侧 ⠿ 手柄（鼠标）
 *   · ↑↓ 按钮（键盘可达、触屏好用，也是拖拽的无障碍替代）
 * 序号列固定第一，不可拖、不可移 —— 否则"第几行"会跑到表中间。
 *
 * ⚠️ icon-only 按钮必须有 `aria-label`（Web Interface Guidelines 的硬规则，
 * 也是本仓 `web-design-guidelines` 审查里唯一一类"零容忍"的问题）：屏幕阅读器
 * 读不到图标，只读得到一个没有任何文字的按钮。
 */
const { isVisible, toggle, resetToDefault, columnOrder, moveColumn, dropColumn } =
  usePurchaseColumns()

const open = ref(false)

const visibleCount = computed(() => ALL_COLUMNS.filter((c) => isVisible(c.key)).length)

/** 按用户排的顺序渲染面板（与表格一致，不然面板和表格对不上号） */
const orderedAll = computed(() => {
  const byKey = new Map(ALL_COLUMNS.map((c) => [c.key, c]))
  return columnOrder.value.map((key) => byKey.get(key)).filter(Boolean)
})

/** 可一键回到"默认 8 列 + 默认顺序"——用户把列勾乱/拖乱之后，不该靠记忆还原 */
const isDefault = computed(() => {
  const now = ALL_COLUMNS.filter((c) => isVisible(c.key)).map((c) => c.key).sort().join(',')
  const defaultVisible = now === [...DEFAULT_VISIBLE_KEYS].sort().join(',')
  const defaultOrder =
    columnOrder.value.join(',') === ALL_COLUMNS.map((c) => c.key).join(',')
  return defaultVisible && defaultOrder
})

function onReset() {
  resetToDefault()
}

/** 拖拽状态：draggingKey 是被拖的列，overKey 是当前悬停的目标（只用于高亮） */
const draggingKey = ref('')
const overKey = ref('')

function onDragStart(key, event) {
  if (PINNED_COLUMN_KEYS.includes(key)) {
    event.preventDefault()
    return
  }
  draggingKey.value = key
  // Firefox 不设 dataTransfer 就不触发 drop
  try {
    event.dataTransfer?.setData('text/plain', key)
    event.dataTransfer.effectAllowed = 'move'
  } catch {
    // 老浏览器没有 dataTransfer：忽略，靠 draggingKey 也能走通
  }
}

function onDragOver(key, event) {
  if (!draggingKey.value || draggingKey.value === key) return
  event.preventDefault()
  overKey.value = key
}

function onDrop(key) {
  const dragKey = draggingKey.value
  draggingKey.value = ''
  overKey.value = ''
  if (!dragKey) return
  dropColumn(dragKey, key)
}

function onDragEnd() {
  draggingKey.value = ''
  overKey.value = ''
}

/** ↑↓ 的可用性：固定列、已经在首/尾就禁用 */
function canMove(key, delta) {
  if (PINNED_COLUMN_KEYS.includes(key)) return false
  const order = columnOrder.value
  const at = order.indexOf(key)
  if (at < 0) return false
  const to = at + delta
  if (to < 0 || to >= order.length) return false
  return !PINNED_COLUMN_KEYS.includes(order[to])
}
</script>

<template>
  <el-popover
    v-model:visible="open"
    placement="bottom-end"
    :width="272"
    trigger="click"
    popper-class="purchase-column-popover"
  >
    <template #reference>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none"
        aria-label="列配置：选择显示哪些列、调整顺序"
        :aria-expanded="open"
        title="选择显示哪些列、调整顺序"
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
      <p class="px-1 pb-1 text-xs font-medium text-slate-500">显示的列 · 拖 ⠿ 或 ↑↓ 调顺序</p>

      <div
        v-for="col in orderedAll"
        :key="col.key"
        class="flex items-center gap-1.5 rounded px-1 py-1 text-sm text-slate-700"
        :class="[
          overKey === col.key ? 'bg-region ring-1 ring-brand-ink/40' : 'hover:bg-region',
          draggingKey === col.key ? 'opacity-40' : '',
        ]"
        @dragover="onDragOver(col.key, $event)"
        @drop.prevent="onDrop(col.key)"
      >
        <!-- 拖拽手柄：序号列固定，不显示 -->
        <span
          v-if="!PINNED_COLUMN_KEYS.includes(col.key)"
          class="shrink-0 cursor-grab select-none text-slate-500"
          draggable="true"
          role="button"
          tabindex="0"
          :aria-label="`拖动调整「${col.label}」列的顺序`"
          title="拖动调整顺序"
          @dragstart="onDragStart(col.key, $event)"
          @dragend="onDragEnd"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="9" cy="6" r="1.4" />
            <circle cx="15" cy="6" r="1.4" />
            <circle cx="9" cy="12" r="1.4" />
            <circle cx="15" cy="12" r="1.4" />
            <circle cx="9" cy="18" r="1.4" />
            <circle cx="15" cy="18" r="1.4" />
          </svg>
        </span>
        <span v-else class="w-3.5 shrink-0" aria-hidden="true"></span>

        <el-checkbox
          :model-value="isVisible(col.key)"
          :aria-label="`显示「${col.label}」列`"
          @change="toggle(col.key)"
        />
        <span class="min-w-0 flex-1 truncate">{{ col.label }}</span>

        <template v-if="!PINNED_COLUMN_KEYS.includes(col.key)">
          <button
            type="button"
            class="shrink-0 rounded px-1 text-xs text-slate-500 transition-colors hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none disabled:opacity-40"
            :disabled="!canMove(col.key, -1)"
            :aria-label="`把「${col.label}」列上移一位`"
            title="上移"
            @click="moveColumn(col.key, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            class="shrink-0 rounded px-1 text-xs text-slate-500 transition-colors hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none disabled:opacity-40"
            :disabled="!canMove(col.key, 1)"
            :aria-label="`把「${col.label}」列下移一位`"
            title="下移"
            @click="moveColumn(col.key, 1)"
          >
            ↓
          </button>
        </template>
      </div>

      <div class="flex items-center justify-between border-t border-line px-1 pt-2">
        <button
          type="button"
          class="rounded px-1 text-xs text-slate-500 transition-colors hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:outline-none disabled:text-slate-500"
          :disabled="isDefault"
          @click="onReset"
        >
          恢复默认
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
