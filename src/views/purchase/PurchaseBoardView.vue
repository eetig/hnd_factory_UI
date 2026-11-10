<script setup>
import PurchaseWorkspace from '../../components/purchase/PurchaseWorkspace.vue'

/*
 * 采购工作台（变更-148 的看板 → 2026-11-10 并成「看板 + 录入/历史」两个页签）。
 *
 * 薄壳：定高链交给自己（`flex h-full flex-col`），完整理由在 PurchaseWorkspace.vue 头部。
 * 页签**不是**路由：两个视图共用同一份路由 meta（h1 / 面包屑 / 侧栏高亮都指「采购看板」），
 * 切换只改 `?tab=`，所以刷新与分享都不会丢视图。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <PurchaseWorkspace />
  </div>
</template>
