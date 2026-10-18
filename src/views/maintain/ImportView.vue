<script setup>
import { useRouter } from 'vue-router'
import WorkOrderImport from '../../views/WorkOrderImport.vue'

/*
 * 文件导入（原 WorkOrderList.vue 的 `import` 页签）。
 *
 * ⚠️ **不搬代码**：`views/WorkOrderImport.vue`（627 行）本来就是独立 view，
 * 这一层只做两件事 —— 包上主区容器的形状，以及把它的 `cancel` / `back` 事件
 * 接到路由上（原来这两个事件是 `activeTab.value = 'workOrder'`）。
 *
 * `imported` 事件不再需要处理：改造前它只是置一个 `importDirty` 标记，
 * 让「下次切 Tab 时重拉各数据集」——而现在页面会随路由挂载/卸载，
 * 回到任一列表页都是重新取数，标记与刷新链路一起失去了对象。
 */
const router = useRouter()

/** 取消 / 返回：回到工单汇总（非 admin 时路由守卫会把人送到第一个可见页） */
function backToOrders() {
  router.push('/orders')
}
</script>

<template>
  <div>
    <WorkOrderImport @cancel="backToOrders" @back="backToOrders" />
  </div>
</template>
