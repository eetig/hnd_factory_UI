<script setup>
import PurchaseBoard from '../../components/purchase/PurchaseBoard.vue'

/*
 * 采购看板（变更-148）。
 *
 * 薄壳：定高链交给自己（`flex h-full flex-col`），完整理由在 PurchaseBoard.vue 头部。
 * 与「采购录入」是**两个平级页面**，不是同一个页面的两个 Tab —— 两页各有自己的
 * 数据视角（看板看未到货、录入看全量并填），Tab 会让两套筛选互相污染。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <PurchaseBoard />
  </div>
</template>
