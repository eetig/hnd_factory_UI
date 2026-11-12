<script setup>
/*
 * 领料解析（变更-190）。
 *
 * 只是薄壳：真正的实现在 src/components/pick/PickParsePanel.vue。
 * 这样「图片解析」「领料解析」这类录入页的长相都由组件决定，
 * 视图层只负责挂载与权限/路由的元信息（与 ImageParseView.vue 同一套写法）。
 */
import PickParsePanel from '../../components/pick/PickParsePanel.vue'
</script>

<template>
  <div class="pick-view">
    <PickParsePanel />
  </div>
</template>
