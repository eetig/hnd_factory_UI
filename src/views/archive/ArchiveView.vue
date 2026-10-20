<script setup>
import ArchivePanel from '../../components/archive/ArchivePanel.vue'

/*
 * 资料归档（变更-126）。与 PurchaseView 一样只做一层包装 ——
 * 面板自己撑满高度（左分类树 + 右列表 + 分页钉底），这里接上定高方子。
 */
</script>

<template>
  <div class="flex h-full flex-col">
    <ArchivePanel />
  </div>
</template>
