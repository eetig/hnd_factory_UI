<script setup>
import PurchaseWorkspace from '../../components/purchase/PurchaseWorkspace.vue'

/*
 * 费用申请看板（2026-11-10，变更-182）。
 *
 * 使用方的分法：「如果是采购申请，就是在采购看板下。如果是资产申购或是服务采购申请，
 * 就是在费用申请下」。所以这一页和采购看板是**同一套工作台**，只把范围锁成
 * 资产申购(ZCSG) + 服务采购申请(FWCGSQ)，列也换成他定的三列
 * （待提单 / 待验收 / 已验收，没有超期）。
 *
 * 为什么仍走 PurchaseWorkspace 而不是复制一份：两页的页签、懒挂载、深链 `?tab=`
 * 完全一样，复制之后改一处忘一处是必然的。差异全部收在 `scope` 这一个 prop 里。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <PurchaseWorkspace scope="expense" />
  </div>
</template>
