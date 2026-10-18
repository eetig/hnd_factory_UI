<script setup>
import EquipmentMaintenancePanel from '../../components/EquipmentMaintenancePanel.vue'

/*
 * 设备数据维护（原 WorkOrderList.vue 的 `equipment` 页签）。
 *
 * 2026-10-06：台账原先只读、只能改 SQL，这个页签是它的维护入口。
 * 页签按 equipment:edit 权限显隐（见 nav/index.js），写接口另有 admin 闸门。
 *
 * 变更-088：接上 038/044 那张定高方子（`flex h-full flex-col`）——
 * 使用方 2026-10-16 对这张表说的是同一句话「翻页时不在同一个位置，像在跳动」。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <EquipmentMaintenancePanel />
  </div>
</template>
