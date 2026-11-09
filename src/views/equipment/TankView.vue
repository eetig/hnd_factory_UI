<script setup>
import EquipmentTankPanel from '../../components/equipment/EquipmentTankPanel.vue'

/*
 * 储罐（容器）页签（2026-11-09）。
 *
 * 设备台账那页是**图纸**，这页是**车间里真实存在的罐** —— 每个罐手工指定一张图纸。
 * 使用方原话：「图纸我自行编辑，容器我来指定哪张图纸」。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <EquipmentTankPanel />
  </div>
</template>