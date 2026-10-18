<script setup>
import PurchaseTrackingPanel from '../../components/PurchaseTrackingPanel.vue'

/*
 * 采购需求详情（原 WorkOrderList.vue 的 `purchase` 页签）。
 *
 * 面板组件现成可用（需求登记 → 下单 → 到货的流水台账），这里只包一层 ——
 * 包装层接上 038/044/088 那张定高方子（卡片撑满 + 表格区自己滚 + 分页行钉底），
 * 完整链条在面板文件里。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <PurchaseTrackingPanel />
  </div>
</template>
