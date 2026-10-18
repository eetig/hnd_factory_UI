<script setup>
import ImageParse from '../../views/ImageParse.vue'

/*
 * 图片解析（原 WorkOrderList.vue 的 `imageParse` 页签）。
 *
 * ⚠️ **不搬代码**：`views/ImageParse.vue`（1521 行）本来就是独立 view，
 * 与文件导入同属录入入口、沿用同一个权限位（`work_order:import`）。
 *
 * 它 `emit('confirmed')` 的那份通知原先接到 `handleOcrConfirmed` 上 ——
 * 那函数做两件事：置 `importDirty`、重拉各数据集。路由化之后两件都不需要了：
 * 列表页在重新进入时会自己取数（挂载即取），而录入页本身不展示那些列表。
 * 事件仍然照发，只是这里不再有订阅者。
 */
</script>

<template>
  <div>
    <ImageParse />
  </div>
</template>
