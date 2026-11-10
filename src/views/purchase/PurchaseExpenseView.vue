<script setup>
import PurchaseBoard from '../../components/purchase/PurchaseBoard.vue'

/*
 * 费用申请看板（2026-11-10，变更-182；变更-183 去掉页签）。
 *
 * 使用方的分法：「如果是采购申请，就是在采购看板下。如果是资产申购或是服务采购申请，
 * 就是在费用申请下」。所以这一页和采购看板是**同一个组件**，只把 scope 换成 expense：
 * 只拉 ZCSG + FWCGSQ，列换成他定的三列（待提单 / 待验收 / 已验收，没有超期）。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <PurchaseBoard scope="expense" />
  </div>
</template>
