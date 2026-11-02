<script setup>
import { ElMessage } from 'element-plus'

/*
 * 「本月」快捷按钮（2026-11-02 使用方：「添加一个快捷按钮，点击后就是筛选本月的数据」）。
 *
 * 点一下把区间发成 **本月 1 号 ~ 今天**，由父组件自己写进它的日期状态
 * （组件不直接改 props —— `vue/no-mutating-props` 会拦，而且父组件的状态本来就该父改）。
 *
 * 为什么是"1 号到今天"而不是"整月"：
 * 未来日期没有数据，把结束日放到月底只会查出一段空白；"到今天"与后端各处的
 * 默认口径也一致（统计范围一直是"到今日"）。
 *
 * ⚠️ 提示语里必须写"本月没数据就会是空表"：
 * 月初点它很可能真的没数据（如 11 月 2 号），不解释一句，下一个人会以为按钮坏了。
 */
const emit = defineEmits(['apply'])

function pad(n) {
  return String(n).padStart(2, '0')
}

function apply() {
  const date = new Date()
  const from = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`
  const to = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  ElMessage.success({ message: `已切到本月：${from} ~ ${to}（本月没数据就是空表）`, duration: 2200 })
  emit('apply', { startDate: from, endDate: to })
}
</script>

<template>
  <button
    type="button"
    class="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-slate-400 hover:bg-region hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
    title="把统计范围切到本月 1 号到今天"
    @click="apply"
  >
    本月
  </button>
</template>
