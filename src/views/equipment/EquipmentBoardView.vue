<script setup>
import EquipmentBoard from '../../components/equipment/EquipmentBoard.vue'

/*
 * 设备看板（变更-150）。薄壳，定高链交给自己；完整理由在 EquipmentBoard.vue 头部。
 * 与「设备数据维护」是**两个平级页面**：看板看"还缺什么"，维护页负责填和筛。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <EquipmentBoard />
  </div>
</template>