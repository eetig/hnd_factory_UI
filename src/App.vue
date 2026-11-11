<template>
  <RouterView />
</template>

<script setup>
import { onMounted } from 'vue'
import { installDesktopCloseBehavior } from './desktop/closeBehavior'

/*
 * 桌面版才有意义：点 ✕ 时问「退出 / 最小化到托盘」。
 * 网页版这个函数直接返回（见 src/desktop/closeBehavior.js 第一行判断）。
 */
onMounted(() => {
  installDesktopCloseBehavior()
})
</script>
