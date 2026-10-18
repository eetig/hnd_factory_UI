<script setup>
import { onMounted } from 'vue'
import TankLevelPanel from '../../components/TankLevelPanel.vue'
import { useTankLevelData } from '../../composables/useTankLevelData'

/*
 * 月底储罐液位记录（原 WorkOrderList.vue 的 `tankLevel` 页签）。
 *
 * 整个面板在 <TankLevelPanel> 里，它自己从 useTankLevelData() 取数与渲染 ——
 * 这里只留「进这一页才加载」这一个钩子。
 *
 * 改造前这行是 `watch(activeTab)` 里的一句 `ensureTankLevelLoaded()`：面板当时
 * 是 v-show 常驻的，挂载时机与「切到这一页」不是一回事。路由化之后进页即挂载，
 * 钩子换成 onMounted，`ensureTankLevelLoaded` 自身的「只加载一次」语义照旧。
 *
 * 变更-044 的定高方子（卡片撑满、表格区自己滚、分页行钉卡底）在面板文件里。
 */
const { ensureTankLevelLoaded } = useTankLevelData()

onMounted(ensureTankLevelLoaded)
</script>

<template>
  <div class="flex h-full flex-col">
    <TankLevelPanel />
  </div>
</template>
