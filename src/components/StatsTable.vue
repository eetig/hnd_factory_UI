<script setup>
import { computed } from 'vue'

/**
 * 汇总表：固定「序号 + 列配置」结构的只读表格。
 *
 * 工单报工 / 工单核算 / 原辅料核算 三张表结构完全相同，原先各自复制了一份
 * 40 多行的模板（改一处样式要改三处、还容易漏）。现在只由本组件渲染，
 * 页面只提供 columns 与 rows。
 */
const props = defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  emptyText: { type: String, default: '暂无数据' },
  rowKey: { type: Function, default: null },
})

/**
 * 需要换行的单元格（长物料名）用 max-width 限宽。
 * 这里的类名必须写成完整字面量 —— Tailwind 是静态扫描源码收集类名的，
 * 用字符串拼接出来的类名不会被生成。
 */
const WRAP_CELL_CLASS = {
  'w-[200px]': 'max-w-[200px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700',
  'w-[240px]': 'max-w-[240px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700',
}
const DEFAULT_WRAP_CELL_CLASS =
  'max-w-[200px] whitespace-normal break-words px-3 py-2 text-sm text-slate-700'

// 首列是序号，其余列按配置渲染
const bodyColumns = computed(() => props.columns.filter((column) => column.key !== 'index'))

function headerClass(column) {
  return column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'
}

function cellClass(column) {
  if (column.wrap) return WRAP_CELL_CLASS[column.width] || DEFAULT_WRAP_CELL_CLASS

  if (column.align === 'right') {
    const color = column.emphasis ? 'font-semibold text-sky-700' : 'text-slate-600'
    return `whitespace-nowrap py-2 pl-3 pr-5 text-right text-sm ${color}`
  }

  return 'whitespace-nowrap px-3 py-2 text-sm text-slate-600'
}

function getRowKey(item, index) {
  return props.rowKey ? props.rowKey(item, index) : index
}
</script>

<template>
  <section class="rounded-xl border border-slate-200 bg-white shadow-sm">
    <div class="overflow-x-auto">
      <table class="min-w-full table-fixed divide-y divide-slate-200 text-left">
        <colgroup>
          <col v-for="column in columns" :key="column.key" :class="column.width" />
        </colgroup>
        <thead class="bg-slate-50">
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              class="whitespace-nowrap py-4 text-xs font-semibold uppercase tracking-wide text-slate-500"
              :class="headerClass(column)"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white">
          <tr v-if="rows.length === 0">
            <td :colspan="columns.length" class="px-3 py-16 text-center text-sm text-slate-400">
              {{ emptyText }}
            </td>
          </tr>
          <tr
            v-for="(item, index) in rows"
            :key="getRowKey(item, index)"
            class="transition hover:bg-slate-50"
          >
            <td class="whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-900">
              {{ index + 1 }}
            </td>
            <td v-for="column in bodyColumns" :key="column.key" :class="cellClass(column)">
              {{ item[column.key] }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
