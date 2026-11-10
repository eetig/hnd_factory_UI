<script setup>
import PurchaseBoard from '../../components/purchase/PurchaseBoard.vue'

/*
 * 采购看板（2026-11-10 变更-183：去掉「看板 / 录入·历史」页签）。
 *
 * 使用方的原话是「不要录入和历史了」，所以这一页只剩看板：
 * 录入/历史那张台账的页面、路由、页签入口都已删除，新增需求走看板右上角的抽屉
 * （抽屉里「再加一条需求」可以接着往同一张 OA 单里补明细）。
 *
 * 薄壳：定高链（`flex h-full flex-col`）留在这里，完整链条在 PurchaseBoard.vue 里。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <PurchaseBoard scope="purchase" />
  </div>
</template>
