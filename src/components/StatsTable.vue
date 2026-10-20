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
  /**
   * 是否在表尾画合计行（变更-124）。
   *
   * 判据不是"行数少 / 不分页"，而是**行与行是不是同一个计量对象**：
   * 同一物料的领料汇总，合计有意义；六种不同产品的订单数量，加起来不伦不类
   * （使用方原话，2026-10-20 撤掉了核算三视图的合计行，见 CostingView 的注释）。
   * **分页列表不能开** —— 当前页 10 行求和得到的是「这一页的合计」，换个页码就变，是假数。
   */
  showFooter: { type: Boolean, default: false },
})

/**
 * 需要换行的单元格（长物料名）用 max-width 限宽。
 * 这里的类名必须写成完整字面量 —— Tailwind 是静态扫描源码收集类名的，
 * 用字符串拼接出来的类名不会被生成。
 */
const WRAP_CELL_CLASS = {
  'w-[200px]': 'max-w-[200px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700',
  'w-[240px]': 'max-w-[240px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700',
}
const DEFAULT_WRAP_CELL_CLASS =
  'max-w-[200px] whitespace-normal break-words px-3 py-2.5 text-sm text-slate-700'

// 首列是序号，其余列按配置渲染
const bodyColumns = computed(() => props.columns.filter((column) => column.key !== 'index'))

function headerClass(column) {
  return column.align === 'right' ? 'pl-3 pr-5 text-right' : 'px-3'
}

function cellClass(column) {
  if (column.wrap) return WRAP_CELL_CLASS[column.width] || DEFAULT_WRAP_CELL_CLASS

  if (column.align === 'right') {
    const color = column.emphasis ? 'font-semibold text-brand-ink' : 'text-slate-600'
    return `num whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-sm ${color}`
  }

  return 'whitespace-nowrap px-3 py-2.5 text-sm text-slate-600'
}


/**
 * 可求和的列：右对齐 + 值能转成数字。
 *
 * 为什么要判 `Number.isFinite` 而不是直接加：核算页在货物移动接口失败时，
 * 两列会写字符串 `'—'`（见 CostingView 的 goodsMoveError）。`'—' + 1` 会变成
 * `'—1'`，一路传到页面上就是一根莫名其妙的字符串 —— 这里必须挡掉。
 */
const summableColumns = computed(() => bodyColumns.value.filter((column) => column.align === 'right'))

function numeric(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

const footerTotals = computed(() => {
  const totals = {}
  for (const column of summableColumns.value) {
    let sum = 0
    let seen = 0
    for (const row of props.rows) {
      const n = numeric(row[column.key])
      if (n === null) continue
      sum += n
      seen += 1
    }
    // 一列全是 '—' 时不显示 0，那会被读成"合计为零"
    totals[column.key] = seen > 0 ? sum : null
  }
  return totals
})

/** 有缺失值的行数（任何数值列取不到数）—— 表尾那行小字用它 */
const missingRowCount = computed(
  () =>
    props.rows.filter((row) =>
      summableColumns.value.some((column) => numeric(row[column.key]) === null),
    ).length,
)

const footerNumber = (value) =>
  typeof value === 'number' ? value.toLocaleString('zh-CN') : ''

function getRowKey(item, index) {
  return props.rowKey ? props.rowKey(item, index) : index
}
</script>

<template>
  <section class="rounded-card border border-line bg-raised shadow-card">
    <div class="overflow-x-auto">
      <table class="ledger-table w-full max-w-[1280px] table-fixed text-left">
        <colgroup>
          <col v-for="column in columns" :key="column.key" :class="column.width" />
        </colgroup>
        <thead class="bg-region">
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
        <tbody>
          <tr v-if="rows.length === 0">
            <td :colspan="columns.length" class="px-3 py-16 text-center text-sm text-slate-500">
              {{ emptyText }}
            </td>
          </tr>
          <tr
            v-for="(item, index) in rows"
            :key="getRowKey(item, index)"
            
          >
            <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">
              {{ index + 1 }}
            </td>
            <td v-for="column in bodyColumns" :key="column.key" :class="cellClass(column)">
              {{ item[column.key] }}
            </td>
          </tr>
        </tbody>
        <tfoot v-if="showFooter && rows.length">
          <tr>
            <td class="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-slate-900">合计</td>
            <td
              v-for="column in bodyColumns"
              :key="column.key"
              :class="column.align === 'right' ? 'num px-3 py-2.5 text-sm font-semibold text-slate-900' : ''"
            >
              {{ column.align === 'right' ? footerNumber(footerTotals[column.key]) : '' }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p v-if="showFooter && rows.length" class="border-t border-line px-6 py-2 text-xs text-slate-500">
      共 {{ rows.length }} 行<span v-if="missingRowCount">
        ，其中 {{ missingRowCount }} 行有缺失值（显示为 —，不计入合计）</span
      >
    </p>
  </section>
</template>
